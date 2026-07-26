import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useTasks } from "../../context/TasksContext";
import TaskMissingContactModal from "./TaskMissingContactModal";
import { describeCondition, firstDisplayGroupConditions } from "./taskShared";

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

  async function handleBulkSend() {
    setSending(true);
    setLastSendWasScheduled(!!scheduleSendAt);
    try {
      await axios.post(`/tasks/${taskId}/send`, {
        scheduled_at: scheduleSendAt ? new Date(scheduleSendAt).toISOString() : null,
      });
      setScheduleSendAt("");
      loadTask();
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
      setSending(false);
      loadTask();
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

  const conditions = task ? firstDisplayGroupConditions(task.criteria) : [];
  const rows = task?.progress?.schools || [];

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
            <b className="text-slate-700">{task.scheduled_for ? new Date(task.scheduled_for).toLocaleString("he-IL") : ""}</b>,
            לפי מי שיעמוד בקריטריונים באותו מועד.
          </p>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0 flex items-center gap-4 flex-wrap text-xs text-slate-500">
            <span>סה"כ בתי ספר: <b className="text-slate-700">{task.progress.total}</b></span>
            <span>הושלמו: <b className="text-emerald-600">{task.progress.completed}</b></span>
            <span>טרם הושלמו: <b className="text-amber-600">{task.progress.total - task.progress.completed}</b></span>
            <span className="mr-auto font-semibold text-blue-700">{task.progress.progress_pct}% התקדמות</span>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b border-slate-200">
                <tr>
                  <th scope="col" className="text-right px-4 py-2 font-semibold text-slate-600">בית ספר</th>
                  {conditions.map((c, i) => (
                    <th key={i} scope="col" className="text-center px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                      {describeCondition(c)}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.school_id} className="border-b border-slate-50">
                    <td className="px-4 py-2 text-slate-800">{r.school_name}</td>
                    {r.condition_results.map((ok, i) => (
                      <td key={i} className="text-center px-3 py-2" aria-label={ok ? "בוצע" : "טרם בוצע"}>
                        {ok ? (
                          <span aria-hidden="true" className="text-emerald-600 font-bold">✓</span>
                        ) : (
                          <span aria-hidden="true" className="text-red-500 font-bold">✕</span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-left">
                      {!r.done && (
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
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 flex-shrink-0 flex items-center justify-end gap-2 flex-wrap">
            <label htmlFor={`schedule-send-${taskId}`} className="text-xs text-slate-500">
              תזמון שליחה (אופציונלי)
            </label>
            <input
              id={`schedule-send-${taskId}`}
              type="datetime-local"
              value={scheduleSendAt}
              onChange={e => setScheduleSendAt(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
            />
            <button
              type="button"
              onClick={handleBulkSend}
              disabled={sending || task.progress.total === task.progress.completed}
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
