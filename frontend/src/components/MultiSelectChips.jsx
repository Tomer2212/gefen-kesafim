import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Generic controlled multi-select: options ({value,label}[]) + selected (string[]) + onChange(newArray).
// Structurally mirrors AccessSelector.jsx (closed chip box + dropdown checkbox-list + אישור footer).
// `compact`: matches the smaller/plain field style used in "פרטי מוסד" (SchoolPage ליווי grid)
// instead of the default glassy .input-field look used elsewhere (AdminPage ניהול table).
// `neutral`: forces the gray/neutral chip color (same one `compact` uses) while keeping the
// full-size `.input-field` box — for places that need input-field sizing without the legacy
// blue chip highlight (e.g. "תחומי שליטה" in the invite-user form).
// `emptyIcon`: when nothing is selected, show a small "+" icon button instead of the full
// box with placeholder text — used where the column should stay compact until populated.
//
// The dropdown is rendered via a portal into <body> with `position: fixed`, positioned from
// the trigger's bounding rect — same reasoning as DatePickerPopover.jsx: a plain
// `position: absolute` dropdown gets silently clipped/covered by any ancestor `.glass-card`
// (backdrop-filter creates a new stacking context, so a sibling card painted later can cover
// it regardless of z-index).
export function MultiSelectChips({ options, selected, onChange, placeholder = "בחר", className = "", compact = false, neutral = false, emptyIcon = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const sel = selected || [];

  const boxCls = compact
    ? "w-full text-sm border border-slate-300 rounded-md px-2 py-0.5 bg-transparent flex flex-wrap items-center gap-1 min-h-[26px] cursor-pointer focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100"
    : "input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer";
  const chipCls = (compact || neutral)
    ? "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
    : "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full";
  const chipStyle = (compact || neutral) ? {} : { background: "rgba(0,112,243,0.08)", color: "#1d4ed8" };
  const checkedBoxCls = (compact || neutral) ? "bg-slate-500 border-slate-500" : "bg-blue-500 border-blue-500";

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // A fixed-position dropdown doesn't move with its trigger — scrolling the page (or any
  // scrollable ancestor) would otherwise leave it floating over the wrong spot. Closing it
  // matches the convention already used by DatePickerPopover.jsx.
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [open]);

  const showIconOnly = emptyIcon && sel.length === 0;

  return (
    <div className={`relative ${className}`}>
      {showIconOnly ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={placeholder}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
        </button>
      ) : (
        <div
          ref={triggerRef}
          className={boxCls}
          role="button"
          tabIndex={0}
          onClick={() => setOpen(o => !o)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {sel.length === 0 ? (
            <span className="text-sm text-slate-400">{placeholder}</span>
          ) : sel.map(v => {
            const opt = options.find(o => o.value === v);
            return (
              <span key={v} className={chipCls} style={chipStyle}>
                {opt ? opt.label : v}
                <button
                  type="button"
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange(sel.filter(i => i !== v)); }}
                  className="hover:text-red-500 leading-none"
                  aria-label={`הסר ${opt ? opt.label : v}`}
                >×</button>
              </span>
            );
          })}
        </div>
      )}

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] border border-slate-200 rounded-xl bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 160) }}
        >
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-50" role="listbox">
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={sel.includes(o.value)}
                onClick={() => {
                  const newSel = sel.includes(o.value) ? sel.filter(i => i !== o.value) : [...sel, o.value];
                  onChange(newSel);
                }}
                className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2"
              >
                <span className={`w-4 h-4 rounded border flex-shrink-0 ${sel.includes(o.value) ? checkedBoxCls : "border-slate-300"}`} aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-blue text-xs px-3 py-1.5"
            >אישור</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
