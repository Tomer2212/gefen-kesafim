import { Fragment, useEffect, useRef, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { useTasks } from "../../context/TasksContext";
import TaskMissingContactModal from "./TaskMissingContactModal";
import TaskDateTimeInput from "./TaskDateTimeInput";
import OutlookLimitModal from "./OutlookLimitModal";
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

const MIN_WIDTH = 520;
const MIN_HEIGHT = 380;
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 540;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6;

// Renders every open task panel independently — same drag/resize/minimize/pill
// mechanics as CompareResultsWindow.jsx, but with a fully white background (per
// spec) and task-specific content (live progress table + send actions) instead
// of a check comparison.
export default function TaskPanel() {
  const { taskWindows } = useTasks();
  const minimizedIds = taskWindows.filter(w => w.minimized).map(w => w.taskId);

  return (
    <>
      {taskWindows.map(w => (
        <TaskWindowItem
          key={w.taskId}
          taskId={w.taskId}
          minimized={w.minimized}
          minimizedOrder={minimizedIds.indexOf(w.taskId)}
        />
      ))}
    </>
  );
}

function TaskWindowItem({ taskId, minimized, minimizedOrder }) {
  const { closeTask, setMinimized } = useTasks();
  const [pos, setPos] = useState(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingRow, setSendingRow] = useState(null);
  const [missingContact, setMissingContact] = useState(null); // {schoolIds, channel, recipientRole}
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
  const [goalOptions, setGoalOptions] = useState([]);
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [controlLetterFields, setControlLetterFields] = useState([]);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  function loadTask() {
    setLoading(true);
    axios.get(`/tasks/${taskId}`)
      .then(r => setTask(r.data))
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTask(); }, [taskId]);

  // For resolving field/goal/control-letter condition values (e.g. "gefen", a goal_key, a
  // division_type) to their Hebrew label in column headers/exports — same payload
  // TaskCreateWizard already fetches.
  useEffect(() => {
    axios.get("/tasks/field-options").then(r => {
      setFieldOptions(r.data?.fields || []);
      setGoalOptions(r.data?.goal_options || []);
      setDivisionOptions(r.data?.division_options || []);
      setControlLetterFields(r.data?.control_letter_fields || []);
    }).catch(() => {});
  }, []);
  const taskFieldMeta = { fieldOptions, goalOptions, divisionOptions, controlLetterFields };

  useEffect(() => {
    if (pos === null) {
      const idNum = typeof taskId === "number" ? taskId : taskId.length;
      const cascade = (idNum % CASCADE_CYCLE) * CASCADE_STEP;
      const x = Math.max(16, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2) + cascade);
      const y = Math.max(16, Math.round((window.innerHeight - DEFAULT_HEIGHT) / 3) + cascade);
      setPos({ x, y });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startDrag(e) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);
  }
  function onDrag(e) {
    const d = dragRef.current;
    if (!d) return;
    const maxX = window.innerWidth - 120;
    const maxY = window.innerHeight - 60;
    setPos({
      x: Math.min(Math.max(0, d.origX + (e.clientX - d.startX)), maxX),
      y: Math.min(Math.max(0, d.origY + (e.clientY - d.startY)), maxY),
    });
  }
  function stopDrag() {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
  }
  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height };
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
  }
  function onResize(e) {
    const r = resizeRef.current;
    if (!r) return;
    setSize({
      width: Math.max(MIN_WIDTH, r.origW + (e.clientX - r.startX)),
      height: Math.max(MIN_HEIGHT, r.origH + (e.clientY - r.startY)),
    });
  }
  function stopResize() {
    resizeRef.current = null;
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }
  useEffect(() => () => {
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", stopDrag);
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }, []);

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
    try {
      await axios.post(`/tasks/${taskId}/schools/${schoolId}/send`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.missing_contact_school_ids) {
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

  if (!pos) return null;

  if (minimized) {
    const left = 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP);
    return (
      <button
        type="button"
        onClick={() => setMinimized(taskId, false)}
        dir="rtl"
        aria-label={`שחזור משימה${task?.name ? " — " + task.name : ""}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <polyline points="9 3 5 3 5 7" />
          <polyline points="15 3 19 3 19 7" />
          <polyline points="9 21 5 21 5 17" />
          <polyline points="15 21 19 21 19 17" />
        </svg>
        <span className="truncate">{task?.name || "משימה"}</span>
        {task && (
          <span className="text-xs font-normal text-slate-400 whitespace-nowrap">
            {task.progress?.progress_pct ?? 0}%
          </span>
        )}
      </button>
    );
  }

  const trackSuccess = task?.progress?.track_success !== false;
  // Round-2 redesign: success_criteria is an independent tree from task.criteria (targeting) —
  // describing columns from task.criteria would show the wrong conditions once the two trees
  // diverge (see get_task's effective_success_criteria). Empty when track_success is off —
  // there's no success tree to describe, so the per-condition columns are hidden entirely
  // rather than rendered empty (see displayRows/table below).
  const conditions = (task && trackSuccess) ? firstDisplayGroupConditions(task.effective_success_criteria) : [];
  const rows = task?.progress?.schools || [];

  const displayRows = rows
    .filter(r => {
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
    const colLabels = ["בית ספר", "סמל מוסד", "בעלות", ...conditions.map(c => describeCondition(c, taskFieldMeta)), "שליחה", "הערות"];
    const wsData = [colLabels, ...displayRows.map(r => [
      r.school_name || "", r.symbol || "", r.authority || "",
      ...r.condition_results.map((res, i) => (
        conditions[i]?.type === "meeting"
          ? (res.meeting_exists ? "יש" : "אין")
          : (res.ok ? "בוצע" : "טרם בוצע")
      )),
      r.send_status?.status === "sent" ? "נשלח" : r.send_status?.status === "failed" ? "נכשל" : r.send_status?.status === "skipped" ? "דולג" : r.send_status ? "ממתין" : "—",
      r.note || "",
    ])];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = colLabels.map(() => ({ wch: 20 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "משימה");
    XLSX.writeFile(wb, `${task?.name || "משימה"}.xlsx`);
  }

  return (
    <div
      role="region"
      aria-label="חלון משימה"
      dir="rtl"
      style={{ position: "fixed", left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: 60 }}
      className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200"
    >
      <div
        onMouseDown={startDrag}
        className="grid items-center px-4 py-3 border-b border-slate-200 cursor-move select-none flex-shrink-0 bg-slate-50"
        style={{ gridTemplateColumns: "1fr auto 1fr" }}
      >
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => closeTask(taskId)} aria-label="סגור חלון משימה" className="text-slate-400 hover:text-slate-700">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => setMinimized(taskId, true)} aria-label="מזער חלון משימה" className="text-slate-400 hover:text-slate-700">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="19" />
            </svg>
          </button>
        </div>
        <div className="text-sm font-bold text-slate-800 truncate text-center">{task?.name || "טוען..."}</div>
        <div aria-hidden="true" />
      </div>

      {loading ? (
        <div role="status" aria-label="טוען משימה" className="flex-1 flex items-center justify-center">
          <div aria-hidden="true" className="spinner w-7 h-7" />
        </div>
      ) : !task ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-600">שגיאה בטעינת המשימה</div>
      ) : task.status === "scheduled" ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <p className="text-sm text-slate-500">
            המשימה מתוזמנת — רשימת בתי הספר תיקבע אוטומטית ב-
            <b className="text-slate-700"><bdi>{task.scheduled_for ? new Date(task.scheduled_for).toLocaleString("he-IL") : ""}</bdi></b>,
            לפי מי שיעמוד בקריטריונים באותו מועד.
          </p>
        </div>
      ) : (
        <>
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
              onClick={exportToExcel}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap mr-auto"
            >
              ייצוא לאקסל
            </button>
          </div>

          <div className="flex-1 overflow-auto">
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
                {displayRows.map(r => (
                  <Fragment key={r.school_id}>
                  <tr className="border-b border-slate-50">
                    <td className="px-4 py-2 text-slate-800">{r.school_name}</td>
                    <td className="px-3 py-2 text-slate-600"><bdi>{r.symbol || "—"}</bdi></td>
                    <td className="px-3 py-2 text-slate-600">{r.authority || "—"}</td>
                    <td className="px-2 py-1.5">
                      <label htmlFor={`task-note-${r.school_id}`} className="sr-only">הערה עבור {r.school_name}</label>
                      <input
                        id={`task-note-${r.school_id}`}
                        key={`${r.school_id}-${r.note || ""}`}
                        type="text"
                        defaultValue={r.note || ""}
                        onBlur={e => { if (e.target.value !== (r.note || "")) saveNote(r.school_id, e.target.value); }}
                        placeholder="הערה..."
                        className="w-32 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-lg px-2 py-1 outline-none bg-transparent focus:bg-white"
                      />
                    </td>
                    {r.condition_results.map((res, i) => (
                      <td key={i} className="text-center px-3 py-2" aria-label={res.ok ? "בוצע" : "טרם בוצע"}>
                        {conditions[i]?.type === "meeting" && res.required_count ? (
                          <span className={`font-bold text-xs rounded-full px-2 py-0.5 ${res.actual_count >= res.required_count ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}`}>
                            {res.actual_count}/{res.required_count}
                          </span>
                        ) : res.ok ? (
                          <span aria-hidden="true" className="text-emerald-600 font-bold">✓</span>
                        ) : (
                          <span aria-hidden="true" className="text-red-500 font-bold">✕</span>
                        )}
                      </td>
                    ))}
                    <td className="text-center px-3 py-2 whitespace-nowrap">
                      {!r.send_status ? (
                        <span className="text-slate-300 text-xs">—</span>
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
                    <td className="text-center px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setExclusionEditFor(exclusionEditFor === r.school_id ? null : r.school_id)}
                        className="text-xs text-slate-500 hover:text-slate-700 underline decoration-dotted"
                      >
                        {r.excluded_emails?.length ? `${r.excluded_emails.length} מוחרגים` : "אין"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-left">
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
                  </tr>
                  {exclusionEditFor === r.school_id && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={conditions.length + 7} className="px-4 py-2.5">
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
                ))}
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
        </>
      )}

      <div onMouseDown={startResize} aria-hidden="true" className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" style={{ touchAction: "none" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", bottom: 2, right: 2, transform: "scaleX(-1)" }}>
          <path d="M12 2 L2 12 M12 7 L7 12" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

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
    </div>
  );
}
