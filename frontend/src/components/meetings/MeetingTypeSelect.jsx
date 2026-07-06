import { useEffect, useRef, useState } from "react";
import { MEETING_TYPE_OPTIONS } from "./constants";

export function MeetingTypeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selected = MEETING_TYPE_OPTIONS.find(o => o.value === value);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="w-full text-right text-sm px-0 py-0.5 rounded hover:ring-1 hover:ring-slate-300 transition-all cursor-pointer min-h-[24px]"
        onClick={() => setOpen(o => !o)}>
        {selected
          ? <span className="text-slate-700">{selected.label}</span>
          : <span className="text-slate-400 text-lg font-light leading-none">+</span>}
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[100px]">
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onChange(""); setOpen(false); }}
            className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">
            בחר
          </button>
          {MEETING_TYPE_OPTIONS.map(o => (
            <button key={o.value} type="button"
              onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
              className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${value === o.value ? "text-blue-600 font-semibold" : "text-slate-700"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
