import { useEffect, useRef, useState } from "react";

export function UserMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function toggle(o) {
    const exists = selected.some(s => s.key === o.key);
    if (exists && selected.length <= 1) return; // must keep at least one user
    onChange(exists ? selected.filter(s => s.key !== o.key) : [...selected, o]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="w-full text-sm cursor-pointer px-1.5 py-0.5 rounded hover:ring-1 hover:ring-slate-300 min-h-[24px] transition-all whitespace-nowrap"
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0
          ? <span className="text-slate-400 text-lg font-light leading-none">+</span>
          : <span className="text-slate-700">{selected.map(s => s.name).join(", ")}</span>
        }
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[210px] max-h-60 overflow-y-auto">
          {options.length === 0
            ? <div className="px-4 py-3 text-xs text-slate-400">אין משתמשים עם גישה לבית ספר זה</div>
            : options.map(o => (
              <button key={o.key} type="button"
                className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); toggle(o); }}>
                <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => s.key === o.key) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                <span className="text-slate-700">{o.name}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}
