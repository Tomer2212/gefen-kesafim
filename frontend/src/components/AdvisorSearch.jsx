import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

// Controlled multi-select: selectedIds (user IDs) + onChange(newIds). Callers decide whether
// onChange writes to local draft state (deferred until an outer "שמור" save) or fires API
// calls immediately — this component only ever reports the full new selection.
// Structurally mirrors AccessSelector (closed chip box + dropdown search + אישור footer) so
// the two "ליווי" fields look and behave identically.
// `compact`: matches the smaller/plain field style used in "פרטי מוסד" (SchoolPage ליווי grid)
// instead of the default glassy .input-field look used elsewhere (AdminPage, DashboardPage, ...).
//
// The dropdown is rendered via a portal into <body> with `position: fixed`, positioned from
// the trigger's bounding rect — same reasoning as MultiSelectChips.jsx / DatePickerPopover.jsx:
// a plain `position: absolute` dropdown gets silently clipped/covered by any ancestor
// `.glass-card` (backdrop-filter creates a new stacking context, so a sibling card painted
// later can cover it regardless of z-index).
export function AdvisorSearch({ schoolId, selectedIds, users, loadingUsers, onChange, onRetry, invalid, compact = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  const ids = selectedIds || [];
  const selectedUsers = ids.map(id => users.find(u => u.id === id)).filter(Boolean);
  const filtered = sortByRole(users).filter(u =>
    !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase())
  );

  function toggle(id) {
    onChange(ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }

  const boxCls = compact
    ? `w-full text-sm border rounded-md px-2 py-0.5 bg-transparent flex flex-wrap items-center gap-1 min-h-[26px] cursor-pointer focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 ${invalid ? "border-red-400" : "border-slate-300"}`
    : `input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer ${invalid ? "border-red-400" : ""}`;
  const chipCls = compact
    ? "inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md flex-shrink-0 bg-slate-100 text-slate-700 border border-slate-200"
    : "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full flex-shrink-0";
  const chipStyle = compact ? {} : { background: "rgba(0,112,243,0.08)", color: "#1d4ed8" };
  const checkedBoxCls = compact ? "bg-slate-500 border-slate-500" : "bg-blue-500 border-blue-500";

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

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
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
        {selectedUsers.length === 0 && (
          <span className="text-sm text-slate-400">{loadingUsers ? "טוען..." : "לחץ לבחירת יועץ..."}</span>
        )}
        {selectedUsers.map(u => (
          <span key={u.id} className={chipCls} style={chipStyle}>
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
      {open && pos && createPortal(
        <div ref={dropdownRef} className="fixed z-[9999] border border-slate-200 rounded-xl bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 220) }}>
          <div className="p-2 border-b border-slate-100">
            <label htmlFor={`advisor-search-${schoolId}`} className="sr-only">חיפוש יועץ</label>
            <input
              id={`advisor-search-${schoolId}`}
              type="search"
              autoFocus
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
                <span className={`w-4 h-4 rounded border flex-shrink-0 ${ids.includes(u.id) ? checkedBoxCls : "border-slate-300"}`} aria-hidden="true" />
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
        </div>,
        document.body,
      )}
    </div>
  );
}
