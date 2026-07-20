import { useState, useRef } from "react";

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

// Controlled multi-select: selectedIds (user IDs) + onChange(newIds). Callers decide whether
// onChange writes to local draft state (deferred until an outer "שמור" save) or fires API
// calls immediately — this component only ever reports the full new selection.
// Structurally mirrors AccessSelector (closed chip box + dropdown search + אישור footer) so
// the two "ליווי" fields look and behave identically.
export function AdvisorSearch({ schoolId, selectedIds, users, loadingUsers, onChange, onRetry, invalid }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const ids = selectedIds || [];
  const selectedUsers = ids.map(id => users.find(u => u.id === id)).filter(Boolean);
  const filtered = sortByRole(users).filter(u =>
    !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase())
  );

  function toggle(id) {
    onChange(ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <div
        className={`input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer ${invalid ? "border-red-400" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selectedUsers.length === 0 && (
          <span className="text-sm text-slate-400">{loadingUsers ? "טוען..." : "לחץ לבחירת יועץ..."}</span>
        )}
        {selectedUsers.map(u => (
          <span key={u.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
            {u.full_name || u.email}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); toggle(u.id); }}
              className="hover:text-red-500 transition-colors leading-none text-base"
              aria-label={`הסר ${u.full_name || u.email}`}
            >×</button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute z-20 right-0 left-0 mt-1 border border-slate-200 rounded-xl bg-white shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <label htmlFor={`advisor-search-${schoolId}`} className="sr-only">חיפוש יועץ</label>
            <input
              id={`advisor-search-${schoolId}`}
              type="search"
              className="input-field text-sm"
              placeholder="חפש יועץ..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-50" role="listbox" aria-multiselectable="true">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">
                {query.trim() ? "לא נמצאו יועצים" : users.length === 0 ? (
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); if (onRetry) onRetry(); }}
                    className="text-blue-500 hover:text-blue-700 underline"
                  >טעינה נכשלה — לחץ לניסיון חוזר</button>
                ) : "לא נמצאו יועצים"}
              </div>
            ) : filtered.map(u => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={ids.includes(u.id)}
                onMouseDown={e => { e.preventDefault(); toggle(u.id); }}
                className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 transition-colors flex items-center gap-2"
              >
                <span className={`w-4 h-4 rounded border flex-shrink-0 ${ids.includes(u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                <span>{u.full_name || u.email}</span>
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
