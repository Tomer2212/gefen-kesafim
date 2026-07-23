import { useState, useRef } from "react";

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

// Controlled: restrictTo (null = "כולם", or array of user IDs) + onChange(newVal).
// Structurally mirrors AdvisorSearch (closed chip box + dropdown search + אישור footer) so
// the two "ליווי" fields look and behave identically.
// `compact`: matches the smaller/plain field style used in "פרטי מוסד" (SchoolPage ליווי grid)
// instead of the default glassy .input-field look used elsewhere (AdminPage, DashboardPage, ...).
export function AccessSelector({ restrictTo, users, loadingUsers, onChange, schoolAdvisors, onSelectAdvisors, compact = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const isAll = restrictTo === null || restrictTo === undefined;
  const selected = restrictTo || [];

  const boxCls = compact
    ? "w-full text-sm border border-slate-300 rounded-md px-2 py-0.5 bg-transparent flex flex-wrap items-center gap-1 min-h-[26px] cursor-pointer focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100"
    : "input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer";
  const chipCls = compact
    ? "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
    : "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full";
  const chipStyle = compact ? {} : { background: "rgba(0,112,243,0.08)", color: "#1d4ed8" };
  const checkedBoxCls = compact ? "bg-slate-500 border-slate-500" : "bg-blue-500 border-blue-500";

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <div
        className={boxCls}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {isAll ? (
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.12)", color: "#15803d" }}>
            כולם
          </span>
        ) : selected.map(id => {
          const u = users.find(u => u.id === id);
          return u ? (
            <span key={id} className={chipCls} style={chipStyle}>
              {u.full_name || u.email}
              <button
                type="button"
                onMouseDown={e => { e.stopPropagation(); e.preventDefault(); const n = selected.filter(i => i !== id); onChange(n.length === 0 ? null : n); }}
                className="hover:text-red-500 leading-none"
                aria-label={`הסר ${u.full_name || u.email} מרשימת הגישה`}
              >×</button>
            </span>
          ) : null;
        })}
        {selected.length > 0 && (
          <button
            type="button"
            onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange(null); }}
            className="text-xs text-slate-400 hover:text-slate-600 mr-auto px-1"
            aria-label="אפס לכולם"
          >↺ כולם</button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 right-0 left-0 mt-1 border border-slate-200 rounded-xl bg-white shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <label htmlFor="access-selector-search" className="sr-only">חיפוש</label>
            <input
              id="access-selector-search"
              type="search"
              className="input-field text-sm"
              placeholder="חפש יועץ..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-50" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={isAll}
              onMouseDown={e => { e.preventDefault(); onChange(null); setOpen(false); }}
              className="w-full text-right px-4 py-2.5 text-sm hover:bg-green-50 flex items-center gap-2"
            >
              <span className={`w-4 h-4 rounded border flex-shrink-0 ${isAll ? "bg-green-500 border-green-500" : "border-slate-300"}`} aria-hidden="true" />
              <span className="font-medium">כולם</span>
              <span className="text-xs text-slate-400 mr-auto">ללא הגבלה</span>
            </button>
            {schoolAdvisors && schoolAdvisors.length > 0 && (
              <button
                type="button"
                role="option"
                onMouseDown={e => {
                  e.preventDefault();
                  if (onSelectAdvisors) {
                    onSelectAdvisors();
                  } else {
                    const ids = schoolAdvisors.map(a => a.id).filter(Boolean);
                    onChange(ids.length > 0 ? ids : null);
                  }
                  setOpen(false);
                }}
                className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="w-4 h-4 rounded border border-slate-300 flex-shrink-0" aria-hidden="true" />
                <span className="font-medium">היועצים המלווים שנבחרו</span>
                <span className="text-xs text-slate-400 mr-auto">{schoolAdvisors.length} יועצים</span>
              </button>
            )}
            {sortByRole(loadingUsers ? [] : users)
              .filter(u => !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase()))
              .map(u => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(u.id)}
                  onMouseDown={e => {
                    e.preventDefault();
                    const newSel = selected.includes(u.id) ? selected.filter(i => i !== u.id) : [...selected, u.id];
                    onChange(newSel.length === 0 ? null : newSel);
                  }}
                  className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2"
                >
                  <span className={`w-4 h-4 rounded border flex-shrink-0 ${selected.includes(u.id) ? checkedBoxCls : "border-slate-300"}`} aria-hidden="true" />
                  {u.full_name || u.email}
                  <span className="text-xs text-slate-400 mr-auto">{ROLE_LABELS[u.role]}</span>
                </button>
              ))}
          </div>
          <div className="p-2 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); setOpen(false); }}
              className="btn-blue text-xs px-3 py-1.5"
            >אישור</button>
          </div>
        </div>
      )}
    </div>
  );
}
