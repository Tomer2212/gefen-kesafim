import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ALL_TASK_COLUMNS } from "./taskColumns";

const DEFAULT_LS_KEY = "admin_tasks_col_visible";

export function loadColVisible(columns = ALL_TASK_COLUMNS, storageKey = DEFAULT_LS_KEY) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return Object.fromEntries(columns.map(c => [c.key, c.key in saved ? saved[c.key] : c.defaultVisible]));
  } catch {
    return Object.fromEntries(columns.map(c => [c.key, c.defaultVisible]));
  }
}

// "עמודות להצגה" picker — same principle as DashboardPage.jsx's column picker (portaled panel,
// checkbox per column, select-all/clear-all). Generic over `columns`/`storageKey` so both the
// school-task table and the person-task table (and any future task-like table) share this one
// component instead of forking it.
export default function ColumnPickerButton({ colVisible, setColVisible, size = "sm", columns = ALL_TASK_COLUMNS, storageKey = DEFAULT_LS_KEY }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 260;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPos({ left, top: rect.bottom + 4, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (panelRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function persist(next) {
    setColVisible(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* non-fatal */ }
  }
  function toggle(key) {
    persist({ ...colVisible, [key]: !colVisible[key] });
  }
  function selectAll() {
    persist(Object.fromEntries(columns.map(c => [c.key, true])));
  }
  function clearAll() {
    persist(Object.fromEntries(columns.map(c => [c.key, false])));
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex items-center gap-1.5 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 ${size === "md" ? "text-sm px-4 py-2" : "text-xs px-3 py-1.5"}`}
      >
        <svg aria-hidden="true" width={size === "md" ? "15" : "13"} height={size === "md" ? "15" : "13"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
        </svg>
        עמודות להצגה
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          dir="rtl"
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 90 }}
          className="bg-white border border-slate-200 rounded-xl shadow-xl p-2 text-xs max-h-96 overflow-y-auto"
        >
          <div className="space-y-0.5">
            {columns.map(c => (
              <label key={c.key} className="flex items-center gap-1.5 px-1.5 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={!!colVisible[c.key]} onChange={() => toggle(c.key)} className="w-3.5 h-3.5" />
                {c.label}
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 mt-1.5 pt-1.5 px-1">
            <button type="button" onClick={clearAll} className="text-slate-500 hover:underline">נקה בחירה</button>
            <button type="button" onClick={selectAll} className="text-blue-600 hover:underline">בחר הכל</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
