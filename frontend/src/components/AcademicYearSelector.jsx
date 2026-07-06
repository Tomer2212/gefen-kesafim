import { useEffect, useRef, useState } from "react";
import { ACADEMIC_YEARS } from "../constants/academicYears";

export function AcademicYearSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-all"
      >
        <span>{value}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="listbox" className="absolute z-30 left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[100px]">
          {ACADEMIC_YEARS.map(year => (
            <button
              key={year}
              type="button"
              role="option"
              aria-selected={value === year}
              onMouseDown={e => { e.preventDefault(); onChange(year); setOpen(false); }}
              className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${value === year ? "text-blue-600 font-semibold" : "text-slate-700"}`}
            >
              {year}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
