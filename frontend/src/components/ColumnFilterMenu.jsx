import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Excel-style header filter/sort menu: a ▽ button that opens a portaled dropdown with
// sort-ascending/descending, a live search box, and a checkbox list of every distinct
// value currently present in the column (select all / individual toggles). Generic over
// any table — the caller supplies the already-computed distinct values (pre-filtered by
// every OTHER active column filter, Excel-style) and owns the actual row filtering/sorting.
export default function ColumnFilterMenu({ label, values, filterSpec, onApply, sortDir, onSort, numeric = false }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftSelected, setDraftSelected] = useState([]);

  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const prevQueryEmptyRef = useRef(true);

  const isFiltered = !!filterSpec;
  const isSorted = sortDir === "asc" || sortDir === "desc";

  useEffect(() => {
    if (!open) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      const insideButton = containerRef.current?.contains(e.target);
      const insideMenu = menuRef.current?.contains(e.target);
      if (!insideButton && !insideMenu) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSearchQuery("");
    prevQueryEmptyRef.current = true;
    setDraftSelected(filterSpec ? filterSpec.selected : values.map(v => v.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedQuery = searchQuery.trim();
  const filteredValues = trimmedQuery
    ? values.filter(v => v.label.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : values;

  // Excel-style: the moment a search starts, the selection snaps to exactly the matching
  // values (so unchecking one then narrows further, and confirming applies only to what's
  // visible) — without this, typing a search narrows what's SHOWN but not what's actually
  // selected, so "אישור" silently re-applies "everything" (looks like nothing happened).
  useEffect(() => {
    if (!open) return;
    const q = searchQuery.trim();
    const wasEmpty = prevQueryEmptyRef.current;
    prevQueryEmptyRef.current = q === "";
    if (q && wasEmpty) {
      const matching = values.filter(v => v.label.toLowerCase().includes(q.toLowerCase())).map(v => v.value);
      setDraftSelected(matching);
    } else if (!q && !wasEmpty) {
      setDraftSelected(filterSpec ? filterSpec.selected : values.map(v => v.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchQuery, values]);

  function toggleValue(v) {
    setDraftSelected(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  function toggleSelectAll() {
    setDraftSelected(prev =>
      filteredValues.every(v => prev.includes(v.value))
        ? prev.filter(v => !filteredValues.some(fv => fv.value === v))
        : [...new Set([...prev, ...filteredValues.map(v => v.value)])]
    );
  }

  function confirm() {
    const allValues = values.map(v => v.value);
    // With an active search: only the checked values among the currently-matching ones —
    // hidden, non-matching values keep whatever selection state they already had.
    const selected = trimmedQuery
      ? filteredValues.filter(v => draftSelected.includes(v.value)).map(v => v.value)
      : draftSelected.filter(v => allValues.includes(v));
    const isAll = allValues.length > 0 && allValues.every(v => selected.includes(v));
    onApply(selected.length === 0 || isAll ? null : { selected });
    setOpen(false);
    setSearchQuery("");
  }

  function clearFilter() {
    onApply(null);
    setDraftSelected(values.map(v => v.value));
  }

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label={`סינון ומיון: ${label}`}
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex items-center justify-center w-5 h-5 rounded transition-colors flex-shrink-0 ${
          isFiltered || isSorted ? "text-blue-600 bg-blue-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        }`}
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill={isFiltered || isSorted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="4 4 20 4 14 13 14 20 10 22 10 13 4 4" />
        </svg>
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 border border-slate-200 rounded-xl bg-white shadow-xl text-right"
          style={{ top: menuPos.top, left: menuPos.left, minWidth: 210, maxWidth: 260 }}
          dir="rtl"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="py-1 border-b border-slate-100">
            <button type="button" onClick={() => { onSort("asc"); setOpen(false); }} className="w-full flex items-center gap-2 text-right px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              {numeric ? "מיין מהקטן לגדול" : "מיין מא׳ עד ת׳"}
            </button>
            <button type="button" onClick={() => { onSort("desc"); setOpen(false); }} className="w-full flex items-center gap-2 text-right px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
              {numeric ? "מיין מהגדול לקטן" : "מיין מת׳ עד א׳"}
            </button>
            {isSorted && (
              <button type="button" onClick={() => { onSort(null); setOpen(false); }} className="w-full text-right px-3 py-1.5 text-xs text-slate-400 hover:text-red-500 hover:bg-slate-50">
                בטל מיון בעמודה זו
              </button>
            )}
            {isFiltered && (
              <button type="button" onClick={clearFilter} className="w-full text-right px-3 py-1.5 text-xs text-slate-400 hover:text-red-500 hover:bg-slate-50">
                בטל סינון בעמודה זו
              </button>
            )}
          </div>

          <div className="p-2 border-b border-slate-100">
            <label htmlFor={`col-filter-search-${label}`} className="sr-only">חיפוש ערכים בעמודה {label}</label>
            <input
              id={`col-filter-search-${label}`}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
              placeholder="חיפוש..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
            />
          </div>

          <label className="flex items-center gap-2.5 px-4 py-1.5 border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
            <input
              type="checkbox"
              checked={filteredValues.length > 0 && filteredValues.every(v => draftSelected.includes(v.value))}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
            />
            <span className="text-sm font-medium text-slate-700">בחר הכל</span>
          </label>

          <div className="overflow-y-auto" style={{ maxHeight: 160 }} role="listbox" aria-multiselectable="true">
            {filteredValues.length === 0 ? (
              <p className="text-xs text-slate-400 px-4 py-3 text-center">אין ערכים להצגה</p>
            ) : (
              filteredValues.map(v => (
                <label key={v.value} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-blue-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftSelected.includes(v.value)}
                    onChange={() => toggleValue(v.value)}
                    className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                  />
                  <span className="text-sm text-slate-700">{v.label}</span>
                </label>
              ))
            )}
          </div>

          <div className="p-2 flex items-center gap-2">
            <button type="button" onClick={confirm} className="btn-blue text-xs px-4 py-1.5 rounded-lg">אישור</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">ביטול</button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
