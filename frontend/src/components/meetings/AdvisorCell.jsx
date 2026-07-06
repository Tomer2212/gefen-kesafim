import { useEffect, useRef, useState } from "react";

export function AdvisorCell({ value, usersWithAccess, usersWithoutAccess, onChange, onRequestAccess }) {
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) { setOpen(false); setShowOthers(false); } }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // value = array of profile objects [{id, full_name, email}]
  const selected = value || [];

  function toggle(user, hasAccess) {
    const exists = selected.some(s => s.id === user.id);
    const newSelected = exists
      ? selected.filter(s => s.id !== user.id)
      : [...selected, { id: user.id, full_name: user.full_name, email: user.email }];
    if (!exists && !hasAccess) onRequestAccess?.(user.id, user.full_name || user.email);
    onChange(newSelected);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="w-full text-right text-sm px-1.5 py-0.5 rounded hover:ring-1 hover:ring-slate-300 transition-all cursor-pointer min-h-[24px]"
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0
          ? <span className="text-slate-400 text-lg font-light leading-none">+</span>
          : <span className="text-slate-700">{selected.map(s => s.full_name || s.email).join(", ")}</span>}
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[210px] max-h-60 overflow-y-auto">
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onChange([]); }}
            className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">
            בחר
          </button>
          {(usersWithAccess || []).map(u => (
            <button key={u.id} type="button"
              onMouseDown={e => { e.preventDefault(); toggle(u, true); }}
              className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2">
              <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => s.id === u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
              <span className="text-slate-700">{u.full_name || u.email}</span>
            </button>
          ))}
          {(usersWithoutAccess || []).length > 0 && !showOthers && (
            <button type="button"
              onMouseDown={e => { e.preventDefault(); setShowOthers(true); }}
              className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50 flex items-center justify-between border-t border-slate-100 mt-0.5 pt-2">
              <span aria-hidden="true" className="text-xs opacity-60">›</span>
              <span>אחר</span>
            </button>
          )}
          {showOthers && (usersWithoutAccess || []).length > 0 && (
            <>
              <div className="border-t border-slate-100 mt-0.5 pt-1">
                <p className="px-3 py-0.5 text-[11px] text-slate-400">ללא גישה לבית הספר:</p>
              </div>
              {(usersWithoutAccess || []).map(u => (
                <div key={u.id} className="relative group/noAccess">
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); toggle(u, false); }}
                    className="w-full text-right px-3 py-2 text-sm text-slate-400 hover:bg-orange-50 flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => s.id === u.id) ? "bg-orange-400 border-orange-400" : "border-slate-300"}`} aria-hidden="true" />
                    {u.full_name || u.email}
                  </button>
                  <div className="hidden group-hover/noAccess:block absolute right-full top-0 mr-2 bg-slate-800 text-white text-xs rounded-lg p-2 w-52 z-50 leading-snug pointer-events-none" dir="rtl">
                    ליועץ זה אין גישה לבית הספר. במידה ותבחרו בו, תישלח בקשה לגורם המאשר.
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
