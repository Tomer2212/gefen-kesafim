import { Fragment, useEffect, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import TaskMissingContactModal from "./TaskMissingContactModal";
import TaskDateTimeInput from "./TaskDateTimeInput";
import OutlookLimitModal from "./OutlookLimitModal";
import TaskMeetingResolutionModal from "./TaskMeetingResolutionModal";
import ConditionGroupsEditor, { newConditionGroup } from "./ConditionGroupsEditor";
import { describeCondition, describeConditionColumn, firstDisplayGroupConditions } from "./taskShared";

// "DD/MM/YY בשעה HH:MM", bidi-isolated like taskShared.js's own date formatting — used only for
// the round-7 send-status tooltip (full timestamps, unlike formatDateDMY's date-only ISO input).
function formatDateTimeDMY(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `⁦${dd}/${mm}/${yy} בשעה ${hh}:${mi}⁩`;
}

// Round 7 — only the two 100%-reliable signals (link actually visited / meeting actually
// booked), deliberately no "email opened" pixel-tracking state (declined for its structural
// unreliability — many mail clients block remote images by default).
function meetingLinkStatusLabel(sendStatus) {
  const mp = sendStatus?.meeting_progress;
  if (!mp) return null; // not a meeting-scheduling task message — nothing to show
  if (mp.total > 0 && mp.done >= mp.total) return `נקבעו כל הפגישות (${mp.done}/${mp.total})`;
  if (sendStatus.link_viewed_at) return `נפתח הקישור ${formatDateTimeDMY(sendStatus.link_viewed_at)}`;
  return "טרם נפתח הקישור";
}

// Shared by both the on-screen table and stage_rows (six-year split) cells, so the ✓/✕
// rendering stays identical whether a condition's result came from the school-level
// condition_results or a per-stage row's own condition_results. Always a plain checkmark/X per
// explicit product decision — never the X/Y fraction badge (multi-required-count conditions
// still resolve to a single ok/not-ok via _resolve_condition, so this loses no information
// about whether the condition is met, only the intermediate count breakdown).
function renderConditionCell(res) {
  return res.ok ? (
    <span aria-hidden="true" className="text-emerald-600 font-bold">✓</span>
  ) : (
    <span aria-hidden="true" className="text-red-500 font-bold">✕</span>
  );
}

// Extracted out of TaskPanel.jsx (round: Tasks-table redesign) so the exact same per-school
// table/handlers can be hosted both inside the floating window (TaskPanel.jsx, still used for
// notification deep-links) AND inline inside a redesigned task row (TaskRowExpandedDetail.jsx) —
// zero duplicated logic between the two hosts. Self-contained: only needs `taskId`; `onTaskChange`
// is optional, called with the freshly-loaded task on every load so a host that shows its own
// title bar (TaskPanel.jsx) can stay in sync without duplicating the fetch itself.
export default function TaskDetailContent({ taskId, onTaskChange }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingRow, setSendingRow] = useState(null);
  const [missingContact, setMissingContact] = useState(null); // {schoolIds, channel, recipientRole}
  const [optedOutAlert, setOptedOutAlert] = useState(null); // school_name of a resend that was skipped due to opt-out
  const [scheduleSendAt, setScheduleSendAt] = useState(""); // datetime-local string, empty = send now
  const [lastSendWasScheduled, setLastSendWasScheduled] = useState(false);
  const [exclusionEditFor, setExclusionEditFor] = useState(null); // school_id or null
  const [exclusionInput, setExclusionInput] = useState("");
  const [rowFilterText, setRowFilterText] = useState("");
  const [rowStatusFilter, setRowStatusFilter] = useState(""); // "" | "done" | "not_done"
  const [sortSpec, setSortSpec] = useState(null); // {key: "school_name"|"symbol"|"authority", dir: "asc"|"desc"}
  const [outlookLimitWarning, setOutlookLimitWarning] = useState(null); // {message, count, threshold} or null
  const [switchingChannel, setSwitchingChannel] = useState(false);
  const [fieldOptions, setFieldOptions] = useState([]);
  const [meetingTypes, setMeetingTypes] = useState([]);
  const [goalOptions, setGoalOptions] = useState([]);
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [budgetNameOptions, setBudgetNameOptions] = useState([]);
  const [controlLetterFields, setControlLetterFields] = useState([]);
  const [goalValueOptions, setGoalValueOptions] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  // Auto-opened when the loaded task has has_meeting_send_problems (a scheduled task that got
  // held back because something broke between creation and its scheduled send time — see
  // backend _try_activate_scheduled_task) — same screen a red badge on the task row, or a
  // task_send_problems notification, both land on too. Meeting tasks only: the live "בעיות"
  // screen (TaskMeetingResolutionModal) is built for meeting-requirement data and doesn't apply
  // to a general task's contact problems — see retryingGeneralTask below for that case instead.
  const [showProblemsModal, setShowProblemsModal] = useState(false);
  const [retryingGeneralTask, setRetryingGeneralTask] = useState(false);

  // In-row "סנן בתי ספר" — full field-catalog parity with the audience/success-criteria builder
  // (school/contacts/financial/goals/control-letters/meetings), which is why it needs a real
  // server-side evaluation (POST /tasks/{taskId}/schools/filter) rather than a client-side
  // predicate over the already-fetched (partial) row data.
  const [showSchoolFilter, setShowSchoolFilter] = useState(false);
  const [filterGroups, setFilterGroups] = useState(() => [newConditionGroup(["field"])]);
  const [filterResultIds, setFilterResultIds] = useState(null); // null = inactive (show all), else Set
  const [filtering, setFiltering] = useState(false);

  function loadTask() {
    setLoading(true);
    axios.get(`/tasks/${taskId}`)
      .then(r => {
        setTask(r.data);
        onTaskChange?.(r.data);
        if (r.data?.has_meeting_send_problems && r.data?.is_meeting_task) setShowProblemsModal(true);
      })
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }

  async function retryGeneralTaskNow() {
    setRetryingGeneralTask(true);
    try {
      await axios.post(`/tasks/${taskId}/retry-now`);
    } finally {
      setRetryingGeneralTask(false);
      loadTask();
    }
  }

  useEffect(() => { loadTask(); }, [taskId]);
  useEffect(() => { axios.get("/schools/users/all").then(r => setOrgUsers(r.data || [])).catch(() => {}); }, []);

  // For resolving field/goal/control-letter condition values (e.g. "gefen", a goal_key, a
  // division_type) to their Hebrew label in column headers/exports — same payload
  // TaskCreateWizard already fetches.
  useEffect(() => {
    axios.get("/tasks/field-options").then(r => {
      setFieldOptions(r.data?.fields || []);
      setMeetingTypes(r.data?.meeting_types || []);
      setGoalOptions(r.data?.goal_options || []);
      setDivisionOptions(r.data?.division_options || []);
      setBudgetNameOptions(r.data?.budget_name_options || []);
      setControlLetterFields(r.data?.control_letter_fields || []);
      setGoalValueOptions(r.data?.goal_value_options || []);
    }).catch(() => {});
  }, []);
  const taskFieldMeta = { fieldOptions, goalOptions, divisionOptions, controlLetterFields };

  async function handleBulkSend(confirmOutlookLimit = false) {
    setSending(true);
    setLastSendWasScheduled(!!scheduleSendAt);
    try {
      await axios.post(`/tasks/${taskId}/send`, {
        scheduled_at: scheduleSendAt ? new Date(scheduleSendAt).toISOString() : null,
        confirm_outlook_limit: confirmOutlookLimit,
      });
      setScheduleSendAt("");
      setOutlookLimitWarning(null);
      loadTask();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.outlook_limit_exceeded) {
        setOutlookLimitWarning(detail);
      } else if (err?.response?.status === 409 && detail?.missing_contact_school_ids) {
        setMissingContact({
          schoolIds: detail.missing_contact_school_ids,
          channel: task.message_config?.channel,
          recipientRole: task.message_config?.recipient_role,
        });
      }
    } finally {
      setSending(false);
      loadTask();
    }
  }

  async function switchToResendAndSend() {
    setSwitchingChannel(true);
    try {
      await axios.patch(`/tasks/${taskId}`, {
        message_config: { ...task.message_config, channel: "email_resend" },
      });
      setOutlookLimitWarning(null);
      await handleBulkSend(false);
    } finally {
      setSwitchingChannel(false);
    }
  }

  async function handleRowSend(schoolId) {
    setSendingRow(schoolId);
    setOptedOutAlert(null);
    try {
      await axios.post(`/tasks/${taskId}/schools/${schoolId}/send`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.opted_out) {
        const schoolName = task?.progress?.schools?.find(r => r.school_id === schoolId)?.school_name || schoolId;
        setOptedOutAlert(schoolName);
      } else if (err?.response?.status === 409 && detail?.missing_contact_school_ids) {
        setMissingContact({
          schoolIds: detail.missing_contact_school_ids,
          channel: task.message_config?.channel,
          recipientRole: task.message_config?.recipient_role,
        });
      }
    } finally {
      setSendingRow(null);
      loadTask();
    }
  }

  async function saveExclusions(schoolId, nextEmails) {
    await axios.put(`/tasks/${taskId}/schools/${schoolId}/note`, { excluded_emails: nextEmails });
    loadTask();
  }

  async function saveNote(schoolId, note) {
    await axios.put(`/tasks/${taskId}/schools/${schoolId}/note`, { note });
    loadTask();
  }

  function addExclusion(schoolId, currentEmails) {
    const email = exclusionInput.trim().toLowerCase();
    if (!email) return;
    setExclusionInput("");
    saveExclusions(schoolId, [...new Set([...currentEmails, email])]);
  }

  function removeExclusion(schoolId, currentEmails, email) {
    saveExclusions(schoolId, currentEmails.filter(e => e !== email));
  }

  async function applySchoolFilter() {
    setFiltering(true);
    try {
      const res = await axios.post(`/tasks/${taskId}/schools/filter`, {
        criteria: { groups: filterGroups.filter(g => g.conditions.length > 0) },
      });
      setFilterResultIds(new Set(res.data?.school_ids || []));
    } catch {
      // non-fatal — leave the previous filter state as-is rather than silently showing "all"
    } finally {
      setFiltering(false);
    }
  }

  function clearSchoolFilter() {
    setFilterGroups([newConditionGroup(["field"])]);
    setFilterResultIds(null);
  }

  if (loading) {
    return (
      <div role="status" aria-label="טוען משימה" className="flex-1 flex items-center justify-center py-10">
        <div aria-hidden="true" className="spinner w-7 h-7" />
      </div>
    );
  }
  if (!task) {
    return <div className="flex-1 flex items-center justify-center text-sm text-red-600 py-10">שגיאה בטעינת המשימה</div>;
  }
  if (task.status === "scheduled") {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center py-10">
        <p className="text-sm text-slate-500">
          המשימה מתוזמנת — רשימת בתי הספר תיקבע אוטומטית ב-
          <b className="text-slate-700"><bdi>{task.scheduled_for ? new Date(task.scheduled_for).toLocaleString("he-IL") : ""}</bdi></b>,
          לפי מי שיעמוד בקריטריונים באותו מועד.
        </p>
      </div>
    );
  }

  const trackSuccess = task.progress.track_success !== false;
  // Round-2 redesign: success_criteria is an independent tree from task.criteria (targeting) —
  // describing columns from task.criteria would show the wrong conditions once the two trees
  // diverge (see get_task's effective_success_criteria). Empty when track_success is off —
  // there's no success tree to describe, so the per-condition columns are hidden entirely
  // rather than rendered empty (see displayRows/table below).
  const conditions = trackSuccess ? firstDisplayGroupConditions(task.effective_success_criteria) : [];
  const rows = task.progress.schools || [];

  const displayRows = rows
    .filter(r => {
      if (filterResultIds !== null && !filterResultIds.has(r.school_id)) return false;
      if (rowStatusFilter === "done" && !r.done) return false;
      if (rowStatusFilter === "not_done" && r.done) return false;
      if (!rowFilterText.trim()) return true;
      const q = rowFilterText.trim().toLowerCase();
      return [r.school_name, r.symbol, r.authority].some(v => (v || "").toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (!sortSpec) return 0;
      const av = (a[sortSpec.key] || "").toString();
      const bv = (b[sortSpec.key] || "").toString();
      const cmp = av.localeCompare(bv, "he");
      return sortSpec.dir === "asc" ? cmp : -cmp;
    });

  function toggleSort(key) {
    setSortSpec(prev => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function exportToExcel() {
    const colLabels = ["בית ספר", "סמל מוסד", "שלב לימוד", "בעלות", ...conditions.map(c => describeCondition(c, taskFieldMeta)), "שליחה", "הערות"];
    const sendLabel = r => r.send_status?.status === "sent" ? "נשלח" : r.send_status?.status === "failed" ? "נכשל" : r.send_status?.status === "skipped" ? "דולג" : r.send_status ? "ממתין" : r.skip_reason === "already_done" ? "אין צורך" : "—";
    // Round 17 — a school needing a per-stage split (see stage_rows) exports as two rows (one
    // per stage), same as the on-screen table; everyone else exports as a single row exactly
    // like before, just with the new "שלב לימוד" column filled from r.stage_label.
    const wsData = [colLabels, ...displayRows.flatMap(r => {
      const stageRows = r.stage_rows && r.stage_rows.length === 2 ? r.stage_rows : null;
      if (!stageRows) {
        return [[
          r.school_name || "", r.symbol || "", r.stage_label || "", r.authority || "",
          ...r.condition_results.map((res, i) => (
            conditions[i]?.type === "meeting"
              ? (res.meeting_exists ? "יש" : "אין")
              : (res.ok ? "בוצע" : "טרם בוצע")
          )),
          sendLabel(r), r.note || "",
        ]];
      }
      return stageRows.map(sr => [
        r.school_name || "", r.symbol || "", sr.stage_label || "", r.authority || "",
        ...sr.condition_results.map((res, i) => (
          res.not_applicable ? "—" : conditions[i]?.type === "meeting" ? (res.ok ? "יש" : "אין") : (res.ok ? "בוצע" : "טרם בוצע")
        )),
        sendLabel(r), r.note || "",
      ]);
    })];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = colLabels.map(() => ({ wch: 20 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "משימה");
    XLSX.writeFile(wb, `${task.name || "משימה"}.xlsx`);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0 flex items-center gap-4 flex-wrap text-xs text-slate-500">
        <span>סה"כ בתי ספר: <b className="text-slate-700">{task.progress.total}</b></span>
        {trackSuccess ? (
          <>
            <span>הושלמו: <b className="text-emerald-600">{task.progress.completed}</b></span>
            <span>טרם הושלמו: <b className="text-amber-600">{task.progress.total - task.progress.completed}</b></span>
            {task.progress.action_progress && (
              <span>
                פעולות: <b className="text-slate-700">{task.progress.action_progress.completed}</b> מתוך <b className="text-slate-700">{task.progress.action_progress.required}</b>
              </span>
            )}
            <span className="mr-auto font-semibold text-blue-700">
              {task.progress.action_progress ? task.progress.action_progress.pct : task.progress.progress_pct}% התקדמות
            </span>
          </>
        ) : (
          <>
            <span>נשלחו: <b className="text-emerald-600">{task.message_summary?.sent ?? 0}</b></span>
            <span className="mr-auto text-slate-400">משימה זו עוקבת אחרי שליחה בלבד, ללא מדד הצלחה</span>
          </>
        )}
      </div>

      {task.needs_outlook_confirmation && (
        <div role="alert" className="px-4 py-2.5 border-b border-slate-100 flex-shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs bg-amber-50">
          <span className="text-amber-800 font-medium">המשימה חורגת מסף האזהרה לשליחה דרך Outlook — נדרש אישור ידני לפני שההודעות ייצאו.</span>
          <button
            type="button"
            onClick={() => handleBulkSend(true)}
            disabled={sending}
            className="text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 whitespace-nowrap"
          >
            {sending ? "שולח..." : "אשר שליחה"}
          </button>
        </div>
      )}

      {optedOutAlert && (
        <div role="alert" className="px-4 py-2.5 border-b border-slate-100 flex-shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs bg-amber-50">
          <span className="text-amber-800 font-medium">
            ההודעה ל{optedOutAlert} לא נשלחה — בית הספר ביקש הסרה מרשימת התפוצה, עד ששדה "סטטוס לקוח" שלו יהפוך ל"פעיל".
          </span>
          <button
            type="button"
            onClick={() => setOptedOutAlert(null)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 whitespace-nowrap"
          >
            סגור
          </button>
        </div>
      )}

      {task.has_meeting_send_problems && (
        <div role="alert" className="px-4 py-2.5 border-b border-slate-100 flex-shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs bg-red-50">
          <span className="text-red-700 font-medium">
            {task.is_meeting_task
              ? 'קיימות בעיות שמונעות את שליחת המשימה — מוצגות בחלונית "בעיות".'
              : "קיימות בעיות (לרוב: איש קשר חסר) שמונעות את שליחת המשימה — תקן בכרטיס בית הספר ונסה שוב."}
          </span>
          {task.is_meeting_task ? (
            <button
              type="button"
              onClick={() => setShowProblemsModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
            >
              פתח מסך בעיות
            </button>
          ) : (
            <button
              type="button"
              onClick={retryGeneralTaskNow}
              disabled={retryingGeneralTask}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap"
            >
              {retryingGeneralTask ? "בודק..." : "בדוק ושלח עכשיו"}
            </button>
          )}
        </div>
      )}

      {task.message_summary?.queued > 0 && (
        <div role="status" className="px-4 py-2 border-b border-slate-100 flex-shrink-0 flex items-center gap-3 flex-wrap text-xs bg-slate-50">
          <span className="font-semibold text-slate-600">סטטוס שליחת הודעות:</span>
          <span className="text-emerald-600">נשלחו בפועל: <b>{task.message_summary.sent}</b></span>
          {task.message_summary.failed > 0 && (
            <span className="text-red-600">נכשלו: <b>{task.message_summary.failed}</b></span>
          )}
          {task.message_summary.pending > 0 && (
            <span className="text-amber-600">ממתינות: <b>{task.message_summary.pending}</b></span>
          )}
          {task.message_summary.outlook_pending > 0 && (
            <span className="text-amber-600">ממתינות לאישור שליחה (Outlook): <b>{task.message_summary.outlook_pending}</b></span>
          )}
        </div>
      )}

      <div className="px-4 py-2 border-b border-slate-100 flex-shrink-0 flex items-center gap-2 flex-wrap text-xs">
        <label htmlFor={`task-row-filter-${taskId}`} className="sr-only">חיפוש בטבלה</label>
        <input
          id={`task-row-filter-${taskId}`}
          type="text"
          value={rowFilterText}
          onChange={e => setRowFilterText(e.target.value)}
          placeholder="חיפוש בית ספר / סמל / בעלות..."
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 flex-1 min-w-[10rem]"
        />
        <label htmlFor={`task-row-status-${taskId}`} className="sr-only">סינון לפי סטטוס</label>
        <select
          id={`task-row-status-${taskId}`}
          value={rowStatusFilter}
          onChange={e => setRowStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
        >
          <option value="">הכל</option>
          <option value="done">הושלמו</option>
          <option value="not_done">טרם הושלמו</option>
        </select>
        <button
          type="button"
          onClick={() => setShowSchoolFilter(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${filterResultIds !== null ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          סנן בתי ספר{filterResultIds !== null ? ` (${filterResultIds.size})` : ""}
        </button>
        <button
          type="button"
          onClick={exportToExcel}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap mr-auto"
        >
          ייצוא לאקסל
        </button>
      </div>

      {showSchoolFilter && (
        <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0 bg-slate-50/70 space-y-2">
          <ConditionGroupsEditor
            groups={filterGroups} setGroups={setFilterGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes}
            goalOptions={goalOptions} divisionOptions={divisionOptions} budgetNameOptions={budgetNameOptions}
            controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
            addConditionLabel="+ הוסף תנאי סינון (וגם)"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applySchoolFilter}
              disabled={filtering}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {filtering ? "מסנן..." : "החל סינון"}
            </button>
            {filterResultIds !== null && (
              <button type="button" onClick={clearSchoolFilter} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-100">
                נקה סינון
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b border-slate-200">
            <tr>
              <th scope="col" className="text-right px-4 py-2 font-semibold text-slate-600">
                <button type="button" onClick={() => toggleSort("school_name")} className="hover:text-blue-700 flex items-center gap-1">
                  בית ספר {sortSpec?.key === "school_name" && (sortSpec.dir === "asc" ? "▲" : "▼")}
                </button>
              </th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                <button type="button" onClick={() => toggleSort("symbol")} className="hover:text-blue-700 flex items-center gap-1">
                  סמל מוסד {sortSpec?.key === "symbol" && (sortSpec.dir === "asc" ? "▲" : "▼")}
                </button>
              </th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">שלב לימוד</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                <button type="button" onClick={() => toggleSort("authority")} className="hover:text-blue-700 flex items-center gap-1">
                  בעלות {sortSpec?.key === "authority" && (sortSpec.dir === "asc" ? "▲" : "▼")}
                </button>
              </th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">הערות</th>
              {conditions.map((c, i) => {
                const { title, range } = describeConditionColumn(c, taskFieldMeta);
                return (
                  <th key={i} scope="col" className="text-center px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                    <div>{title}</div>
                    {range && <div className="font-normal text-slate-400 text-[11px] mt-0.5"><bdi>{range}</bdi></div>}
                  </th>
                );
              })}
              <th scope="col" className="text-center px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">שליחה</th>
              <th scope="col" className="text-center px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">החרגות</th>
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {displayRows.map(r => {
              // Round 17 — six-year schools with a stage-specific meeting requirement
              // (tichon/chativa/separate) render as 2 adjacent rows (one per principal)
              // instead of 1, per stage_rows from compute_task_progress. School-level
              // columns (name/symbol/authority/note/send-status/exclusions/action) span
              // both rows via rowSpan on the FIRST row only; "שלב לימוד" and any
              // stage-specific condition column differ per row; a "merged" condition
              // (shared by both stages) also spans both rows, same as the school-level ones.
              const stageRows = r.stage_rows && r.stage_rows.length === 2 ? r.stage_rows : null;
              const rowCount = stageRows ? 2 : 1;
              return (
              <Fragment key={r.school_id}>
              {Array.from({ length: rowCount }).map((_, rowIdx) => {
                const isFirst = rowIdx === 0;
                const stageLabel = stageRows ? stageRows[rowIdx].stage_label : r.stage_label;
                const rowConditionResults = stageRows ? stageRows[rowIdx].condition_results : r.condition_results;
                const rowDone = stageRows ? rowConditionResults.every(res => res.not_applicable || res.ok) : r.done;
                return (
                <tr key={rowIdx} className={`border-b border-slate-50 ${rowDone ? "bg-emerald-50/60" : ""}`}>
                  {isFirst && <td className="px-4 py-2 text-slate-800" rowSpan={rowCount}>{r.school_name}</td>}
                  {isFirst && <td className="px-3 py-2 text-slate-600" rowSpan={rowCount}><bdi>{r.symbol || "—"}</bdi></td>}
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{stageLabel || "—"}</td>
                  {isFirst && <td className="px-3 py-2 text-slate-600" rowSpan={rowCount}>{r.authority || "—"}</td>}
                  {isFirst && (
                    <td className="px-2 py-1.5" rowSpan={rowCount}>
                      <label htmlFor={`task-note-${r.school_id}`} className="sr-only">הערה עבור {r.school_name}</label>
                      <textarea
                        id={`task-note-${r.school_id}`}
                        key={`${r.school_id}-${r.note || ""}`}
                        rows={2}
                        defaultValue={r.note || ""}
                        onBlur={e => { if (e.target.value !== (r.note || "")) saveNote(r.school_id, e.target.value); }}
                        placeholder="הערה..."
                        className="w-56 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-lg px-2 py-1 outline-none bg-transparent focus:bg-white resize-y align-top"
                      />
                    </td>
                  )}
                  {rowConditionResults.map((res, i) => {
                    if (res.not_applicable) {
                      return <td key={i} className="text-center px-3 py-2 text-slate-300">—</td>;
                    }
                    if (stageRows && res.merged) {
                      if (!isFirst) return null;
                      return (
                        <td key={i} className="text-center px-3 py-2" rowSpan={rowCount} aria-label={res.ok ? "בוצע" : "טרם בוצע"}>
                          {renderConditionCell(res)}
                        </td>
                      );
                    }
                    return (
                      <td key={i} className="text-center px-3 py-2" aria-label={res.ok ? "בוצע" : "טרם בוצע"}>
                        {renderConditionCell(res)}
                      </td>
                    );
                  })}
                  {isFirst && (
                    <td className="text-center px-3 py-2 whitespace-nowrap" rowSpan={rowCount}>
                      {!r.send_status ? (
                        r.skip_reason === "already_done" ? (
                          <span className="relative group inline-block">
                            <span className="text-slate-400 font-medium text-xs cursor-default">אין צורך</span>
                            <div className="pointer-events-none absolute -top-2 right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-400 text-amber-950 text-[11px] font-medium px-2 py-1.5 rounded-md shadow-lg whitespace-nowrap z-10 text-right">
                              בית הספר עמד ביעד עוד לפני שהוגדרה המשימה.
                            </div>
                          </span>
                        ) : r.skip_reason === "opted_out" ? (
                          <span className="relative group inline-block">
                            <span className="text-slate-400 font-medium text-xs cursor-default">הוסר מרשימת תפוצה</span>
                            <div className="pointer-events-none absolute -top-2 right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-400 text-amber-950 text-[11px] font-medium px-2 py-1.5 rounded-md shadow-lg whitespace-nowrap z-10 text-right">
                              בית הספר ביקש הסרה מרשימת התפוצה — לא נשלחה הודעה, עד ששדה "סטטוס לקוח" יהפוך ל"פעיל".
                            </div>
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )
                      ) : r.send_status.status === "sent" ? (
                        <span className="relative group inline-block">
                          <span className="text-emerald-600 font-bold text-xs cursor-default">✓ נשלח</span>
                          <div className="pointer-events-none absolute -top-2 right-full mr-1 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-400 text-amber-950 text-[11px] font-medium px-2 py-1.5 rounded-md shadow-lg whitespace-nowrap z-10 text-right space-y-0.5">
                            <div>זמן שליחה: {formatDateTimeDMY(r.send_status.sent_at)}</div>
                            {meetingLinkStatusLabel(r.send_status) && <div>סטטוס: {meetingLinkStatusLabel(r.send_status)}</div>}
                            {/* Round 15 — Outlook bounced (NDR), sent instead via the automatic Resend fallback. */}
                            {r.send_status.fallback_used && <div>⚠ נשלח דרך Resend (Outlook נכשל, גיבוי אוטומטי)</div>}
                          </div>
                        </span>
                      ) : r.send_status.status === "failed" ? (
                        <span className="text-red-600 font-bold text-xs" title={r.send_status.error || ""}>✕ נכשל</span>
                      ) : r.send_status.status === "skipped" ? (
                        <span className="text-slate-400 font-bold text-xs">דולג</span>
                      ) : r.send_status.status === "outlook_pending" ? (
                        <span className="text-amber-600 font-bold text-xs" title="נשלח דרך Outlook — ממתין לאישור שהמייל אכן הגיע (לא רק שהתקבל לשליחה)">⏳ ממתין לאישור</span>
                      ) : (
                        <span className="text-amber-600 font-bold text-xs">⏳ ממתין</span>
                      )}
                    </td>
                  )}
                  {isFirst && (
                    <td className="text-center px-3 py-2 whitespace-nowrap" rowSpan={rowCount}>
                      <button
                        type="button"
                        onClick={() => setExclusionEditFor(exclusionEditFor === r.school_id ? null : r.school_id)}
                        className="text-xs text-slate-500 hover:text-slate-700 underline decoration-dotted"
                      >
                        {r.excluded_emails?.length ? `${r.excluded_emails.length} מוחרגים` : "אין"}
                      </button>
                    </td>
                  )}
                  {isFirst && (
                    <td className="px-3 py-2 text-left" rowSpan={rowCount}>
                      {/* r.done is null (not false) when track_success is off — always show
                          the resend button then, since there's no "done" concept to hide it
                          behind. Written explicitly rather than relying on `null` being
                          falsy, so the intent survives the next reader. */}
                      {(!trackSuccess || !r.done) && (
                        <button
                          type="button"
                          onClick={() => handleRowSend(r.school_id)}
                          disabled={sendingRow === r.school_id}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60 whitespace-nowrap"
                        >
                          {sendingRow === r.school_id ? "שולח..." : "שלח תזכורת"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                );
              })}
              {exclusionEditFor === r.school_id && (
                <tr className="border-b border-slate-100 bg-slate-50">
                  <td colSpan={conditions.length + 8} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="text-slate-500 font-medium whitespace-nowrap">כתובות מוחרגות מהמשימה הזו:</span>
                      {(r.excluded_emails || []).map(email => (
                        <span key={email} className="bg-white border border-slate-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                          {email}
                          <button
                            type="button"
                            onClick={() => removeExclusion(r.school_id, r.excluded_emails, email)}
                            aria-label={`הסר החרגה עבור ${email}`}
                            className="text-slate-400 hover:text-red-600"
                          >×</button>
                        </span>
                      ))}
                      <label htmlFor={`exclude-email-${r.school_id}`} className="sr-only">כתובת מייל להחרגה</label>
                      <input
                        id={`exclude-email-${r.school_id}`}
                        type="email"
                        value={exclusionInput}
                        onChange={e => setExclusionInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExclusion(r.school_id, r.excluded_emails || []); } }}
                        placeholder="כתובת מייל להחרגה"
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400"
                      />
                      <button
                        type="button"
                        onClick={() => addExclusion(r.school_id, r.excluded_emails || [])}
                        className="text-xs px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium"
                      >הוסף</button>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-slate-100 flex-shrink-0 flex items-center justify-end gap-2 flex-wrap">
        <label htmlFor={`schedule-send-${taskId}`} className="text-xs text-slate-500">
          תזמון שליחה (אופציונלי)
        </label>
        <TaskDateTimeInput
          id={`schedule-send-${taskId}`}
          value={scheduleSendAt}
          onChange={setScheduleSendAt}
          className="text-xs"
        />
        <button
          type="button"
          onClick={() => handleBulkSend()}
          disabled={sending || (trackSuccess && task.progress.total === task.progress.completed)}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {sending
            ? "שולח..."
            : scheduleSendAt
              ? "תזמן שליחה גורפת"
              : "שליחת הודעה גורפת לכל מי שטרם הושלם"}
        </button>
      </div>
      {lastSendWasScheduled && !sending && (
        <p role="status" className="px-4 pb-2 text-xs text-emerald-600 text-left">
          ההודעות תוזמנו לשליחה במועד שנבחר.
        </p>
      )}

      {outlookLimitWarning && (
        <OutlookLimitModal
          warning={outlookLimitWarning}
          primaryLoading={sending}
          secondaryLoading={switchingChannel}
          onConfirm={() => handleBulkSend(true)}
          onSwitchChannel={switchToResendAndSend}
          onClose={() => setOutlookLimitWarning(null)}
        />
      )}
      {missingContact && task && (
        <TaskMissingContactModal
          taskId={taskId}
          schools={missingContact.schoolIds.map(id => ({
            id, name: task.progress.schools.find(r => r.school_id === id)?.school_name || id,
          }))}
          channel={missingContact.channel}
          recipientRole={missingContact.recipientRole}
          onClose={() => setMissingContact(null)}
          onRetry={async () => {
            setMissingContact(null);
            await handleBulkSend();
          }}
        />
      )}
      {showProblemsModal && task && (
        <TaskMeetingResolutionModal
          taskId={taskId}
          orgUsers={orgUsers}
          onProceed={() => { setShowProblemsModal(false); loadTask(); }}
          onClose={() => setShowProblemsModal(false)}
        />
      )}
    </div>
  );
}
