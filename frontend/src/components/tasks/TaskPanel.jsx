import { useEffect, useRef, useState } from "react";
import { useTasks } from "../../context/TasksContext";
import TaskDetailContent from "./TaskDetailContent";

const MIN_WIDTH = 520;
const MIN_HEIGHT = 380;
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 540;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6;

// Renders every open task panel independently — same drag/resize/minimize/pill mechanics as
// CompareResultsWindow.jsx. Pure window chrome now (round: Tasks-table redesign) — the actual
// per-school table/handlers live in TaskDetailContent.jsx, shared verbatim with the redesigned
// table's inline expanded row (TaskRowExpandedDetail.jsx). Kept around (not removed) because
// notification deep-links (NotificationsPage.jsx's "יש בעיות במשימה מתוזמנת") open a task this
// way, independent of whichever row is/isn't expanded in the Tasks tab.
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
  const [taskName, setTaskName] = useState(null);
  const [progressPct, setProgressPct] = useState(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

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

  if (!pos) return null;

  if (minimized) {
    const left = 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP);
    return (
      <button
        type="button"
        onClick={() => setMinimized(taskId, false)}
        dir="rtl"
        aria-label={`שחזור משימה${taskName ? " — " + taskName : ""}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <polyline points="9 3 5 3 5 7" />
          <polyline points="15 3 19 3 19 7" />
          <polyline points="9 21 5 21 5 17" />
          <polyline points="15 21 19 21 19 17" />
        </svg>
        <span className="truncate">{taskName || "משימה"}</span>
        {taskName && (
          <span className="text-xs font-normal text-slate-400 whitespace-nowrap">
            {progressPct ?? 0}%
          </span>
        )}
      </button>
    );
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
        <div className="text-sm font-bold text-slate-800 truncate text-center">{taskName || "טוען..."}</div>
        <div aria-hidden="true" />
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <TaskDetailContent
          taskId={taskId}
          onTaskChange={t => {
            setTaskName(t?.name || null);
            setProgressPct(t?.progress?.action_progress ? t.progress.action_progress.pct : t?.progress?.progress_pct ?? null);
          }}
        />
      </div>

      <div onMouseDown={startResize} aria-hidden="true" className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" style={{ touchAction: "none" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: "absolute", bottom: 2, right: 2, transform: "scaleX(-1)" }}>
          <path d="M12 2 L2 12 M12 7 L7 12" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
