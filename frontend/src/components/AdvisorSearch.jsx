import { useState } from "react";

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

export function AdvisorSearch({ schoolId, assigned, users, loadingUsers, onAdd, onRemove, onRetry }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = sortByRole(users).filter(u =>
    !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="relative"
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
    >
      <label htmlFor={`advisor-search-${schoolId}`} className="sr-only">חיפוש יועץ</label>
      <div
        className="input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-text"
        onClick={() => document.getElementById(`advisor-search-${schoolId}`)?.focus()}
      >
        {assigned.map(adv => (
          <span key={adv.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
            {adv.full_name || adv.email}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onRemove(adv.id); }}
              className="hover:text-red-500 transition-colors leading-none text-base"
              aria-label={`הסר ${adv.full_name || adv.email}`}
            >×</button>
          </span>
        ))}
        <input
          id={`advisor-search-${schoolId}`}
          type="text"
          className="flex-1 min-w-[100px] text-sm outline-none bg-transparent border-none p-0"
          placeholder={loadingUsers ? "טוען..." : assigned.length === 0 ? "לחץ לפתיחת רשימה, או הקלד שם לסינון..." : "הוסף יועץ..."}
          disabled={loadingUsers}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="absolute z-20 right-0 left-0 mt-1 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-52 overflow-y-auto shadow-lg">
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
              onMouseDown={e => {
                e.preventDefault();
                onAdd(u.id);
                setQuery("");
              }}
              className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 transition-colors flex items-center justify-between"
            >
              <span>{u.full_name || u.email}</span>
              <span className="text-xs text-slate-400">{ROLE_LABELS[u.role]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
