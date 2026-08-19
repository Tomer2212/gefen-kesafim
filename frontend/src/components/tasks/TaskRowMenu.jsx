import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 3-dot per-row actions menu for the redesigned Tasks table — same portaled/positioned pattern
// as FieldPickerButton.jsx, sized for a short fixed list rather than a wide categorized panel.
// `onEdit` is optional — only PersonTaskRow.jsx passes it (and only when the current user is
// the task's creator), opening a full edit form (not just the name) for the person-tasks
// feature. School-tasks' TaskRow.jsx never passes it, so this menu is unchanged there.
// `onDelete` is now also optional — PersonTaskRow.jsx omits it (hiding the item entirely,
// not just disabling it) when the current user is neither the task's creator nor an owner, so
// the button never appears for someone it would just reject anyway.
// `onRestoreName` is optional — PersonTaskRow.jsx passes it only in אזור אישי, only when the
// current user has a personal nickname set for this task (see PersonTaskDetailContent's
// "display_name"/"has_name_override" — a purely personal override, never the real task name).
export default function TaskRowMenu({ pinned, onRename, onEdit, onTogglePin, onDelete, onRestoreName }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 190;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const top = Math.min(rect.bottom + 4, window.innerHeight - 140);
    setPos({ left, top, width });
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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label="פעולות נוספות למשימה"
        aria-haspopup="true"
        aria-expanded={open}
        className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg w-7 h-7 flex items-center justify-center"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="menu"
          dir="rtl"
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 80 }}
          className="bg-white border border-slate-200 rounded-xl shadow-xl py-1 text-sm"
        >
          {onRename && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onRename(); }}
              className="w-full text-right px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              ערוך שם משימה
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onTogglePin(); }}
            className="w-full text-right px-3 py-2 text-slate-700 hover:bg-slate-50"
          >
            {pinned ? "בטל נעיצה" : "נעץ"}
          </button>
          {onEdit && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onEdit(); }}
              className="w-full text-right px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              ערוך משימה
            </button>
          )}
          {onRestoreName && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onRestoreName(); }}
              className="w-full text-right px-3 py-2 text-slate-700 hover:bg-slate-50"
            >
              שחזר שם מקורי
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full text-right px-3 py-2 text-red-600 hover:bg-red-50"
            >
              מחק משימה
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
