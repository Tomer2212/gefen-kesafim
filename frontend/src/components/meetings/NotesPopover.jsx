import { useEffect, useRef, useState } from "react";

export function NotesPopover({ value, canEdit, onSave, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value || "");
  const containerRef = useRef(null);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => { setLocal(value || ""); }, [value]);

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
      if (canEdit && localRef.current !== (value || "")) onSave(localRef.current);
    }
    function h(e) { if (!containerRef.current?.contains(e.target)) close(); }
    document.addEventListener("mousedown", h);
    return () => {
      document.removeEventListener("mousedown", h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    if (!value) {
      return canEdit ? (
        <button type="button" aria-label={ariaLabel || "הוספת הערה"} onClick={() => setOpen(true)}
          className="text-sm w-6 h-6 flex items-center justify-center rounded-lg font-bold bg-slate-100 text-slate-500 hover:bg-slate-200">
          +
        </button>
      ) : <span className="text-slate-300 text-xs">—</span>;
    }
    return (
      <button type="button" onClick={() => setOpen(true)}
        aria-label={canEdit ? "עריכת הערה" : "הצגת הערה"}
        className="block max-w-[140px] truncate text-right text-xs text-slate-600 hover:text-blue-700 hover:underline">
        {value}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <div className="absolute z-30 right-0 top-0 -mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-72" dir="rtl">
        {canEdit ? (
          <textarea
            autoFocus
            rows={6}
            value={local}
            onChange={e => setLocal(e.target.value)}
            placeholder="הערה..."
            aria-label={ariaLabel || "הערה"}
            className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 resize-y"
          />
        ) : (
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}
