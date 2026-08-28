import { Fragment, useEffect, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import TaskMissingContactModal from "./TaskMissingContactModal";
import TaskDateTimeInput from "./TaskDateTimeInput";
import OutlookLimitModal from "./OutlookLimitModal";
import TaskMeetingResolutionModal from "./TaskMeetingResolutionModal";
import ConditionGroupsEditor, { newConditionGroup } from "./ConditionGroupsEditor";
import ColumnPickerButton, { loadColVisible } from "./ColumnPickerButton";
import { describeCondition, describeConditionColumn, firstDisplayGroupConditions, formatDateDMY } from "./taskShared";

// The per-school table's middle band — every column between the fixed "בית ספר" (always first)
// and the fixed "הערות" onward. Toggle visibility + drag-reorder among themselves, same idea as
// DashboardPage.jsx's main table. Preferences persist per-browser in localStorage.
// `perStageRow`: rendered on every sub-row of a six-year school (value differs per stage);
// every other column spans both sub-rows via rowSpan on the first row only.
const DETAIL_MOVABLE_COLUMNS = [
  { key: "symbol", label: "סמל מוסד", defaultVisible: true, perStageRow: false, value: r => r.symbol || "—", cell: r => <bdi>{r.symbol || "—"}</bdi> },
  { key: "stage_label", label: "שלב לימוד", defaultVisible: true, perStageRow: true, value: (r, sl) => sl || "—", cell: (r, sl) => sl || "—" },
  { key: "authority", label: "בעלות", defaultVisible: true, perStageRow: false, value: r => r.authority || "—", cell: r => r.authority || "—" },
  { key: "district", label: "מחוז", defaultVisible: false, perStageRow: false, value: r => r.district || "—", cell: r => r.district || "—" },
  { key: "city", label: "עיר", defaultVisible: false, perStageRow: false, value: r => r.city || "—", cell: r => r.city || "—" },
];
const DETAIL_COL_ORDER_LS_KEY = "taskDetailColOrder_v1";
const DETAIL_COL_VISIBLE_LS_KEY = "taskDetailColVisible_v1";
function loadDetailColOrder() {
  const dflt = DETAIL_MOVABLE_COLUMNS.map(c => c.key);
  try {
    const saved = JSON.parse(localStorage.getItem(DETAIL_COL_ORDER_LS_KEY) || "null");
    if (Array.isArray(saved) && saved.length === dflt.length && dflt.every(k => saved.includes(k))) return saved;
  } catch { /* fall through to default */ }
  return dflt;
}

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

// Shown both in the "החרגות" column-header tooltip and at the top of the per-school editor
// popover — kept in one place so they never drift.
const EXCLUSION_HELP_TEXT =
  "הגדרת בתי ספר שלא יקבלו תזכורת גורפת לביצוע המשימה — באופן חד-פעמי, עד תאריך מסוים, או לצמיתות.";

// Single "DD/MM/YY" field — slashes are auto-inserted as digits are typed (no separate
// day/month/year boxes). A 2-digit year is expanded to 20XX. Nothing is applied until the
// explicit "אישור" button is pressed (never on blur), so a half-typed value can't fire.
function formatDmy(raw) {
  const d = raw.replace(/\D/g, "").slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
function DmyDateInput({ onCommit }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState(false);

  function confirm() {
    const parts = text.split("/").map(s => s.trim()).filter(Boolean);
    if (parts.length !== 3 || parts.some(p => !/^\d+$/.test(p))) { setErr(true); return; }
    let [d, m, y] = parts.map(Number);
    if (y < 100) y += 2000;
    const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = new Date(y, m - 1, d);
    const ok = dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (!ok || dt < today) { setErr(true); return; }
    setErr(false);
    onCommit(iso);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          dir="ltr"
          inputMode="numeric"
          placeholder="DD/MM/YY"
          value={text}
          onChange={e => { setText(formatDmy(e.target.value)); setErr(false); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
          className={`w-24 text-xs text-center tracking-wider border rounded-lg px-2 py-1 outline-none focus:border-blue-400 ${err ? "border-red-400" : "border-slate-300"}`}
        />
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={confirm}
          className="text-xs px-3 py-1 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700"
        >
          אישור
        </button>
      </div>
      {err && <span className="text-[10px] text-red-500">תאריך לא תקין</span>}
    </div>
  );
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
  const [broadcastSkipAlert, setBroadcastSkipAlert] = useState(null); // free-text message for a broadcast-skip conflict / save error
  const [scheduleSendAt, setScheduleSendAt] = useState(""); // datetime-local string, empty = send now
  // Result banner after a bulk send: { scheduled, skipped: [{id, name}] } | null
  const [bulkSendResult, setBulkSendResult] = useState(null);
  const [broadcastSkipEditFor, setBroadcastSkipEditFor] = useState(null); // school_id or null
  const [broadcastSkipDraftMode, setBroadcastSkipDraftMode] = useState(null); // 'until' picker open
  const [rowFilterText, setRowFilterText] = useState("");
  const [rowStatusFilter, setRowStatusFilter] = useState(""); // "" | "done" | "not_done"
  const [sortSpec, setSortSpec] = useState(null); // {key, dir: "asc"|"desc"}
  // "עמודות להצגה" — visibility + drag order for the movable middle band (DETAIL_MOVABLE_COLUMNS).
  const [detailColVisible, setDetailColVisible] = useState(() => loadColVisible(DETAIL_MOVABLE_COLUMNS, DETAIL_COL_VISIBLE_LS_KEY));
  const [detailColOrder, setDetailColOrder] = useState(loadDetailColOrder);
  const [dragColKey, setDragColKey] = useState(null);
  const [dragOverColKey, setDragOverColKey] = useState(null);
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

  // Quick-filter chips (left of the free-text search) — a shortcut for the most common fields
  // without opening "סינון מתקדם". {field: string[]} of selected values; combined with the
  // advanced filterGroups into ONE AND'd server-side criteria via runCombinedFilter().
  const QUICK_FILTER_FIELDS = [
    { field: "authority", label: "בעלות" },
    { field: "stage", label: "שלב מוסד" },
    { field: "city", label: "עיר" },
    { field: "district", label: "מחוז" },
    { field: "client_status", label: "סטטוס לקוח" },
    { field: "service_type", label: "סוג שירות" },
  ];
  const [quickFilters, setQuickFilters] = useState({}); // {field: [value, ...]}
  const [openQuickField, setOpenQuickField] = useState(null); // which chip's popover is open
  const [openStatusFilter, setOpenStatusFilter] = useState(false); // "סטטוס" dropdown open
  // Distinct values for the text fields (authority/city) that have no options catalog — pulled
  // once from GET /schools/ (same source DashboardPage uses), lazily on first popover open.
  const [quickTextValues, setQuickTextValues] = useState(null); // {authority: [...], city: [...]} | null
  const [openNoteIds, setOpenNoteIds] = useState(() => new Set()); // school_ids whose note box is expanded

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

  useEffect(() => {
    setBulkSendResult(null);
    setBroadcastSkipAlert(null);
    setBroadcastSkipEditFor(null);
    loadTask();
  }, [taskId]);
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
    const wasScheduled = !!scheduleSendAt;
    try {
      const res = await axios.post(`/tasks/${taskId}/send`, {
        scheduled_at: scheduleSendAt ? new Date(scheduleSendAt).toISOString() : null,
        confirm_outlook_limit: confirmOutlookLimit,
      });
      setScheduleSendAt("");
      setOutlookLimitWarning(null);
      setBulkSendResult({ scheduled: wasScheduled, skipped: res.data?.broadcast_skipped_schools || [] });
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
        // A 409 for missing contacts can still carry a broadcast-skipped list — surface it too.
        if (detail.broadcast_skipped_schools?.length) {
          setBulkSendResult({ scheduled: wasScheduled, skipped: detail.broadcast_skipped_schools });
        }
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
    setBroadcastSkipAlert(null);
    try {
      await axios.post(`/tasks/${taskId}/schools/${schoolId}/send`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.opted_out) {
        const schoolName = task?.progress?.schools?.find(r => r.school_id === schoolId)?.school_name || schoolId;
        setOptedOutAlert(schoolName);
      } else if (err?.response?.status === 409 && detail?.broadcast_skipped) {
        const schoolName = task?.progress?.schools?.find(r => r.school_id === schoolId)?.school_name || schoolId;
        setBroadcastSkipAlert(`${schoolName} מוחרג מתזכורות גורפות — הסר את ההחרגה בעמודת "החרגות" כדי לשלוח לו תזכורת.`);
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

  async function saveNote(schoolId, note) {
    await axios.put(`/tasks/${taskId}/schools/${schoolId}/note`, { note });
    loadTask();
  }

  async function saveBroadcastSkip(schoolId, mode, until = null) {
    setBroadcastSkipAlert(null);
    try {
      await axios.put(`/tasks/${taskId}/schools/${schoolId}/broadcast-skip`, { mode, until });
    } catch (err) {
      setBroadcastSkipAlert(err?.response?.data?.detail || "שמירת ההחרגה נכשלה");
      return;
    }
    setBroadcastSkipEditFor(null);
    setBroadcastSkipDraftMode(null);
    loadTask();
  }

  // "חד פעמי" / "עד DD/MM/YY" / "גורף" chip label for an active broadcast-skip.
  function broadcastSkipLabel(bs) {
    if (bs?.mode === "once") return "חד פעמי";
    if (bs?.mode === "forever") return "גורף";
    if (bs?.mode === "until") return `עד ${formatDateDMY(bs.until)}`;
    return "";
  }

  // Merges the advanced builder (filterGroups) and the quick chips (quickFiltersOverride ??
  // quickFilters) into one AND'd criteria tree and evaluates it server-side. The criteria model
  // is groups(OR-ed) of conditions(AND-ed), so "field ∈ {a,b} AND otherField ∈ {c,d}" needs a
  // DNF cross-product: every advanced group is duplicated once per combination of picked
  // quick-field values. Called on every quick-chip toggle and from "החל סינון".
  async function runCombinedFilter(quickFiltersOverride) {
    const quick = quickFiltersOverride ?? quickFilters;
    const activeQuick = Object.entries(quick).filter(([, vals]) => (vals || []).length > 0);
    // Drop half-built rows from the advanced builder (a blank "בחר שדה" condition) — an empty
    // field key evaluates to False server-side and would zero out the whole AND.
    const conditionMeaningful = c =>
      c.type === "goal" ? !!c.goal_key : c.type === "meeting" ? true : !!c.field;
    const baseGroups = filterGroups
      .map(g => (g.conditions || []).filter(conditionMeaningful))
      .filter(conds => conds.length > 0);
    const baseCombos = baseGroups.length > 0 ? baseGroups : [[]];

    if (activeQuick.length === 0 && baseGroups.length === 0) {
      setFilterResultIds(null); // nothing active → show all
      return;
    }

    // cross-product of one picked value per active quick field
    let quickCombos = [[]];
    for (const [field, vals] of activeQuick) {
      quickCombos = quickCombos.flatMap(combo =>
        vals.map(v => [...combo, { type: "field", field, op: "eq", value: v }]),
      );
    }

    const groups = baseCombos.flatMap(base =>
      quickCombos.map(qc => ({ conditions: [...base, ...qc] })),
    );
    if (groups.length > 200) return; // safety valve — absurd selection, don't hammer the server

    setFiltering(true);
    try {
      const res = await axios.post(`/tasks/${taskId}/schools/filter`, { criteria: { groups } });
      setFilterResultIds(new Set(res.data?.school_ids || []));
    } catch {
      // non-fatal — leave the previous filter state as-is rather than silently showing "all"
    } finally {
      setFiltering(false);
    }
  }

  async function applySchoolFilter() {
    await runCombinedFilter();
    // Auto-collapse the builder once applied — the results are what the user wants to see now,
    // not the builder. Reopen anytime via the "סינון מתקדם" toggle.
    setShowSchoolFilter(false);
  }

  function setQuickFilterValues(field, values) {
    const next = { ...quickFilters, [field]: values };
    if (!values.length) delete next[field];
    setQuickFilters(next);
    runCombinedFilter(next);
  }

  function clearSchoolFilter() {
    setFilterGroups([newConditionGroup(["field"])]);
    setQuickFilters({});
    setFilterResultIds(null);
  }

  // Lazy one-shot fetch of distinct authority/city values for the quick chips (text fields with
  // no options catalog). Same endpoint DashboardPage.jsx reads.
  function ensureQuickTextValues() {
    if (quickTextValues !== null) return;
    setQuickTextValues({ authority: [], city: [] }); // mark in-flight so we don't refetch
    axios.get("/schools/")
      .then(r => {
        const rows = r.data || [];
        const distinct = key => [...new Set(rows.map(s => (s[key] || "").trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, "he"));
        setQuickTextValues({ authority: distinct("authority"), city: distinct("city") });
      })
      .catch(() => {});
  }

  function quickOptionsFor(field) {
    if (field === "authority" || field === "city") {
      return (quickTextValues?.[field] || []).map(v => ({ value: v, label: v }));
    }
    return (fieldOptions.find(f => f.field === field)?.options) || [];
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

  // Movable middle-band columns in their current (user-dragged) order, visible ones only.
  const visibleMovableCols = detailColOrder
    .map(k => DETAIL_MOVABLE_COLUMNS.find(c => c.key === k))
    .filter(c => c && detailColVisible[c.key]);

  function moveDetailCol(fromKey, toKey) {
    if (!fromKey || fromKey === toKey) return;
    setDetailColOrder(prev => {
      const next = prev.filter(k => k !== fromKey);
      const idx = next.indexOf(toKey);
      next.splice(idx < 0 ? next.length : idx, 0, fromKey);
      try { localStorage.setItem(DETAIL_COL_ORDER_LS_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
      return next;
    });
  }

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
    // Export mirrors the on-screen table: the same movable columns, in the same order, that are
    // currently visible (see "עמודות להצגה").
    const colLabels = ["בית ספר", ...visibleMovableCols.map(c => c.label), ...conditions.map(c => describeCondition(c, taskFieldMeta)), "שליחה", "הערות"];
    const sendLabel = r => r.send_status?.status === "sent" ? "נשלח" : r.send_status?.status === "failed" ? "נכשל" : r.send_status?.status === "skipped" ? "דולג" : r.send_status ? "ממתין" : r.skip_reason === "already_done" ? "אין צורך" : "—";
    // Round 17 — a school needing a per-stage split (see stage_rows) exports as two rows (one
    // per stage), same as the on-screen table; a perStageRow column is filled from that stage's
    // own stage_label, every other column repeats the school-level value.
    const wsData = [colLabels, ...displayRows.flatMap(r => {
      const stageRows = r.stage_rows && r.stage_rows.length === 2 ? r.stage_rows : null;
      if (!stageRows) {
        return [[
          r.school_name || "",
          ...visibleMovableCols.map(c => c.value(r, r.stage_label)),
          ...r.condition_results.map((res, i) => (
            conditions[i]?.type === "meeting"
              ? (res.meeting_exists ? "יש" : "אין")
              : (res.ok ? "בוצע" : "טרם בוצע")
          )),
          sendLabel(r), r.note || "",
        ]];
      }
      return stageRows.map(sr => [
        r.school_name || "",
        ...visibleMovableCols.map(c => c.value(r, sr.stage_label)),
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
            <span>הושלמו: <b className="text-slate-700">{task.progress.completed}</b></span>
            <span>טרם הושלמו: <b className="text-slate-700">{task.progress.total - task.progress.completed}</b></span>
            {task.progress.action_progress && (
              <span>
                פעולות: <b className="text-slate-700">{task.progress.action_progress.completed}</b> מתוך <b className="text-slate-700">{task.progress.action_progress.required}</b>
              </span>
            )}
            <span className="font-bold text-slate-900">
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

      {broadcastSkipAlert && (
        <div role="alert" className="px-4 py-2.5 border-b border-slate-100 flex-shrink-0 flex items-center justify-between gap-3 flex-wrap text-xs bg-amber-50">
          <span className="text-amber-800 font-medium">{broadcastSkipAlert}</span>
          <button
            type="button"
            onClick={() => setBroadcastSkipAlert(null)}
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
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-1/4 min-w-[10rem]"
        />

        {/* Quick-filter chips — shortcut per common field; multi-select checkboxes; all AND'd
            together (and with "סינון מתקדם") via runCombinedFilter. */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_FILTER_FIELDS.map(({ field, label }) => {
            const selected = quickFilters[field] || [];
            const options = quickOptionsFor(field);
            const open = openQuickField === field;
            return (
              <div
                key={field}
                className="relative"
                onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpenQuickField(null); }}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    setOpenQuickField(open ? null : field);
                    if (!open) ensureQuickTextValues();
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap border ${
                    selected.length
                      ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}{selected.length ? ` (${selected.length})` : ""}
                  <span aria-hidden="true" className="mr-1 opacity-60">▾</span>
                </button>
                {open && (
                  <div className="absolute z-30 top-full mt-1 right-0 min-w-[12rem] max-h-56 overflow-auto border border-slate-200 rounded-lg bg-white shadow-lg p-1.5">
                    {options.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-slate-400">אין ערכים</div>
                    ) : options.map(o => {
                      const checked = selected.includes(o.value);
                      return (
                        <label key={o.value} className="flex items-center gap-2 px-2 py-1 text-xs text-slate-700 hover:bg-blue-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setQuickFilterValues(
                              field,
                              checked ? selected.filter(v => v !== o.value) : [...selected, o.value],
                            )}
                            className="w-3.5 h-3.5 rounded accent-blue-600"
                          />
                          <span>{o.label}</span>
                        </label>
                      );
                    })}
                    {selected.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setQuickFilterValues(field, [])}
                        className="w-full text-right px-2 py-1 mt-1 text-xs text-slate-500 hover:bg-slate-100 rounded border-t border-slate-100"
                      >
                        נקה {label}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* "סטטוס" dropdown — resting label is always "סטטוס" (matches the quick-filter chips);
            options are הכל / הושלמו / טרם הושלמו, "הכל" (value "") being the default. */}
        <div
          className="relative"
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpenStatusFilter(false); }}
        >
          <button
            type="button"
            aria-expanded={openStatusFilter}
            onClick={() => setOpenStatusFilter(v => !v)}
            className={`text-xs px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap border ${
              rowStatusFilter
                ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            סטטוס{rowStatusFilter === "done" ? ": הושלמו" : rowStatusFilter === "not_done" ? ": טרם הושלמו" : ""}
            <span aria-hidden="true" className="mr-1 opacity-60">▾</span>
          </button>
          {openStatusFilter && (
            <div className="absolute z-30 top-full mt-1 right-0 min-w-[10rem] border border-slate-200 rounded-lg bg-white shadow-lg p-1.5">
              {[
                { value: "", label: "הכל" },
                { value: "done", label: "הושלמו" },
                { value: "not_done", label: "טרם הושלמו" },
              ].map(o => (
                <button
                  key={o.value || "all"}
                  type="button"
                  onClick={() => { setRowStatusFilter(o.value); setOpenStatusFilter(false); }}
                  className={`w-full text-right px-2 py-1 text-xs rounded hover:bg-blue-50 ${rowStatusFilter === o.value ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-700"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSchoolFilter(v => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap ${filterResultIds !== null ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"}`}
        >
          סינון מתקדם{filterResultIds !== null ? ` (${filterResultIds.size})` : ""}
        </button>
        <ColumnPickerButton
          columns={DETAIL_MOVABLE_COLUMNS}
          storageKey={DETAIL_COL_VISIBLE_LS_KEY}
          colVisible={detailColVisible}
          setColVisible={setDetailColVisible}
        />
        <button
          type="button"
          onClick={exportToExcel}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
        >
          ייצוא לאקסל
        </button>
      </div>

      {showSchoolFilter && (
        <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0 bg-slate-50/70">
          {/* Capped at half the width and anchored to the start (right, RTL) — the builder never
              needs the full row, and a full-bleed panel reads as disproportionate. */}
          <div className="w-full max-w-[50%] space-y-2">
          <ConditionGroupsEditor
            groups={filterGroups} setGroups={setFilterGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes}
            goalOptions={goalOptions} divisionOptions={divisionOptions} budgetNameOptions={budgetNameOptions}
            controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
            addConditionLabel="+ הוסף תנאי סינון (וגם)"
            groupToneClassName="bg-slate-100"
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
            <button
              type="button"
              onClick={() => setShowSchoolFilter(false)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
            >
              ביטול
            </button>
            {filterResultIds !== null && (
              <button type="button" onClick={clearSchoolFilter} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-100">
                נקה סינון
              </button>
            )}
          </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-white border-t-2 border-b-2 border-slate-300">
            <tr>
              <th scope="col" className="text-right px-4 py-2 font-semibold text-slate-600">
                <button type="button" onClick={() => toggleSort("school_name")} className="hover:text-blue-700 flex items-center gap-1">
                  בית ספר {sortSpec?.key === "school_name" && (sortSpec.dir === "asc" ? "▲" : "▼")}
                </button>
              </th>
              {visibleMovableCols.map(col => (
                <th
                  key={col.key}
                  scope="col"
                  draggable
                  onDragStart={() => setDragColKey(col.key)}
                  onDragOver={e => { e.preventDefault(); if (dragColKey && dragOverColKey !== col.key) setDragOverColKey(col.key); }}
                  onDrop={e => { e.preventDefault(); moveDetailCol(dragColKey, col.key); setDragColKey(null); setDragOverColKey(null); }}
                  onDragEnd={() => { setDragColKey(null); setDragOverColKey(null); }}
                  title="גרור כדי לשנות את סדר העמודות"
                  className={`text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap cursor-grab select-none ${dragColKey === col.key ? "opacity-40" : ""} ${dragOverColKey === col.key && dragColKey && dragColKey !== col.key ? "border-r-2 border-blue-400 bg-blue-50/60" : ""}`}
                >
                  <button type="button" onClick={() => toggleSort(col.key)} className="hover:text-blue-700 flex items-center gap-1">
                    {col.label} {sortSpec?.key === col.key && (sortSpec.dir === "asc" ? "▲" : "▼")}
                  </button>
                </th>
              ))}
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
              <th
                scope="col"
                className="group relative text-center px-3 py-2 font-semibold text-slate-600 whitespace-nowrap cursor-help"
              >
                החרגה מתזכורות
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 w-64 opacity-0 group-hover:opacity-100 transition-opacity bg-yellow-200 text-yellow-900 border border-yellow-300 text-[11px] font-medium px-2.5 py-2 rounded-lg shadow-lg z-[60] text-right whitespace-normal leading-snug"
                >
                  {EXCLUSION_HELP_TEXT}
                </span>
              </th>
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r, groupIdx) => {
              // Zebra striping by school group (both sub-rows of a six-year school share the
              // shade) so the eye tracks a row's values across the wide table. A completed
              // school stays green — that signal wins over the stripe.
              const zebra = groupIdx % 2 === 1 ? "bg-slate-50/70" : "bg-white";
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
                <tr key={rowIdx} className={`border-b border-slate-100 ${rowDone ? "bg-emerald-50/60" : zebra}`}>
                  {isFirst && <td className="px-4 py-2 text-slate-800" rowSpan={rowCount}>{r.school_name}</td>}
                  {visibleMovableCols.map(col => (
                    col.perStageRow
                      ? <td key={col.key} className="px-3 py-2 text-slate-600 whitespace-nowrap">{col.cell(r, stageLabel)}</td>
                      : (isFirst ? <td key={col.key} className="px-3 py-2 text-slate-600 whitespace-nowrap" rowSpan={rowCount}>{col.cell(r, stageLabel)}</td> : null)
                  ))}
                  {isFirst && (
                    <td className="px-2 py-1.5" rowSpan={rowCount}>
                      {(r.note || openNoteIds.has(r.school_id)) ? (
                        <>
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
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`הוספת הערה עבור ${r.school_name}`}
                          onClick={() => setOpenNoteIds(prev => new Set(prev).add(r.school_id))}
                          className="text-sm w-6 h-6 flex items-center justify-center rounded-lg font-bold bg-slate-100 text-slate-500 hover:bg-slate-200"
                        >
                          +
                        </button>
                      )}
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
                      {/* A school that has fully completed the task is no longer a reminder
                          target, so it gets no exclusion control at all. */}
                      {r.done ? (
                        <span className="text-slate-300 text-xs">—</span>
                      ) : (
                      <div
                        className="relative inline-block"
                        onBlur={e => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            setBroadcastSkipEditFor(null);
                            setBroadcastSkipDraftMode(null);
                          }
                        }}
                      >
                        {r.broadcast_skip?.active ? (
                          <button
                            type="button"
                            onClick={() => setBroadcastSkipEditFor(broadcastSkipEditFor === r.school_id ? null : r.school_id)}
                            className="text-xs px-2 py-1 rounded-lg font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap"
                          >
                            {broadcastSkipLabel(r.broadcast_skip)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`החרגת ${r.school_name} מתזכורת גורפת`}
                            onClick={() => setBroadcastSkipEditFor(broadcastSkipEditFor === r.school_id ? null : r.school_id)}
                            className="text-sm w-6 h-6 flex items-center justify-center rounded-lg font-bold bg-slate-100 text-slate-500 hover:bg-slate-200 mx-auto"
                          >
                            +
                          </button>
                        )}
                        {/* Anchored so it expands toward the table body (physical right of this
                            near-the-left-edge column) instead of off-screen to the left, and
                            layered above the sticky header (z-20) and every row. */}
                        {broadcastSkipEditFor === r.school_id && (
                          <div className="absolute z-[70] top-full mt-2 left-0 w-96 max-w-[92vw] border border-slate-200 rounded-lg bg-white shadow-xl p-4 text-right whitespace-normal break-words">
                            <div className="text-sm font-bold text-slate-800">החרגה מתזכורת - {r.school_name}</div>
                            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{EXCLUSION_HELP_TEXT}</p>
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                type="button"
                                onClick={() => saveBroadcastSkip(r.school_id, "once")}
                                className={`text-xs px-3 py-1 rounded-full border transition-colors ${r.broadcast_skip?.mode === "once" ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-slate-300 text-slate-700 hover:bg-blue-50"}`}
                              >
                                חד פעמי
                              </button>
                              <button
                                type="button"
                                onClick={() => setBroadcastSkipDraftMode(broadcastSkipDraftMode === "until" ? null : "until")}
                                className={`text-xs px-3 py-1 rounded-full border transition-colors ${(r.broadcast_skip?.mode === "until" || broadcastSkipDraftMode === "until") ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-slate-300 text-slate-700 hover:bg-blue-50"}`}
                              >
                                עד תאריך מסוים
                              </button>
                              <button
                                type="button"
                                onClick={() => saveBroadcastSkip(r.school_id, "forever")}
                                className={`text-xs px-3 py-1 rounded-full border transition-colors ${r.broadcast_skip?.mode === "forever" ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-slate-300 text-slate-700 hover:bg-blue-50"}`}
                              >
                                לצמיתות
                              </button>
                              {r.broadcast_skip?.active && (
                                <button
                                  type="button"
                                  onClick={() => saveBroadcastSkip(r.school_id, null)}
                                  className="text-xs px-3 py-1 rounded-full border border-red-300 text-red-600 hover:bg-red-50"
                                >
                                  בטל החרגה
                                </button>
                              )}
                            </div>
                            {broadcastSkipDraftMode === "until" && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-[11px] text-slate-500 whitespace-nowrap">עד תאריך:</span>
                                <DmyDateInput onCommit={iso => saveBroadcastSkip(r.school_id, "until", iso)} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                    </td>
                  )}
                  {isFirst && (
                    <td className="px-3 py-2 text-left" rowSpan={rowCount}>
                      {/* r.done is null (not false) when track_success is off — always show
                          the resend button then, since there's no "done" concept to hide it
                          behind. Written explicitly rather than relying on `null` being
                          falsy, so the intent survives the next reader. */}
                      {r.broadcast_skip?.active ? (
                        <span className="text-xs text-slate-400 whitespace-nowrap">מוחרג מתזכורות</span>
                      ) : (!trackSuccess || !r.done) && (
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
      {bulkSendResult && !sending && (
        <div role="status" className="px-4 pb-2 pt-1 text-xs text-right">
          <div className="flex items-start justify-between gap-3">
            <span className="text-emerald-600 font-medium">
              {bulkSendResult.scheduled ? "התזכורת תוזמנה לשליחה במועד שנבחר." : "התזכורת נשלחה בהצלחה."}
            </span>
            <button
              type="button"
              onClick={() => setBulkSendResult(null)}
              className="text-slate-400 hover:text-slate-600 whitespace-nowrap"
            >
              סגור
            </button>
          </div>
          {bulkSendResult.skipped?.length > 0 && (
            <div className="mt-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              {bulkSendResult.skipped.length} בתי ספר לא קיבלו תזכורת עקב החרגה:{" "}
              {bulkSendResult.skipped.map(s => s.name).filter(Boolean).join(", ")}
            </div>
          )}
        </div>
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
