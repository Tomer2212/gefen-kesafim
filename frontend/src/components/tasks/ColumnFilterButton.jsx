import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const NUMBER_OPS = [
  { op: "eq", label: "שווה ל..." }, { op: "ne", label: "לא שווה ל..." },
  { op: "gt", label: "גדול מ..." }, { op: "gte", label: "גדול או שווה ל..." },
  { op: "lt", label: "קטן מ..." }, { op: "lte", label: "קטן או שווה ל..." },
];
const DATE_OPS = [
  { op: "on", label: "בתאריך..." }, { op: "before", label: "לפני..." }, { op: "after", label: "אחרי..." },
];

// Per-column sort+filter popover for the redesigned Tasks table — mirrors DashboardPage.jsx's
// ColumnHeaderFilter (funnel icon opens sort-then-filter in one panel), scoped down to this
// table's 3 filter "kinds" (enum/number/date) plus a plain text-contains kind DashboardPage
// doesn't need (its identity/text columns are filtered from a separate advanced-filter panel
// instead — Tasks has no such panel, so text gets a real header filter here).
export default function ColumnFilterButton({ col, filter, onFilterChange, sortDir, onSort, distinctOptions }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState("");
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  const isFiltered = col.kind === "enum" ? !!filter?.values?.size : col.kind === "text" ? !!filter?.value?.trim() : filter?.value !== "" && filter?.value !== undefined && filter?.value !== null;

  useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 240;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const top = Math.min(rect.bottom + 4, window.innerHeight - 320);
    setPos({ left, top, width });
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (panelRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const options = col.kind === "enum" ? (col.options || distinctOptions || []) : [];
  const filteredOptions = useMemo(
    () => options.filter(o => !query.trim() || o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  );

  function toggleValue(value) {
    const current = new Set(filter?.values || []);
    if (current.has(value)) current.delete(value); else current.add(value);
    onFilterChange(current.size ? { values: current } : null);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label={`מיון וסינון — ${col.label}`}
        aria-haspopup="true"
        aria-expanded={open}
        className={`relative inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 ${isFiltered || sortDir ? "text-blue-600" : "text-slate-400"}`}
      >
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 4h18l-7 8v7l-4 2v-9L3 4z" />
        </svg>
        {isFiltered && <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-blue-600" />}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          dir="rtl"
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 90 }}
          className="bg-white border border-slate-200 rounded-xl shadow-xl py-1 text-xs max-h-80 overflow-y-auto"
        >
          <div className="py-1 border-b border-slate-100">
            <button type="button" onClick={() => { onSort("asc"); setOpen(false); }} className="w-full text-right px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
              <span aria-hidden="true">▲</span> מיין מהקטן לגדול
            </button>
            <button type="button" onClick={() => { onSort("desc"); setOpen(false); }} className="w-full text-right px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5">
              <span aria-hidden="true">▼</span> מיין מהגדול לקטן
            </button>
            {sortDir && (
              <button type="button" onClick={() => { onSort(null); setOpen(false); }} className="w-full text-right px-3 py-1.5 hover:bg-slate-50 text-slate-500">
                בטל מיון בעמודה זו
              </button>
            )}
            {isFiltered && (
              <button type="button" onClick={() => onFilterChange(null)} className="w-full text-right px-3 py-1.5 hover:bg-red-50 text-red-600">
                בטל סינון בעמודה זו
              </button>
            )}
          </div>

          {col.kind === "text" && (
            <div className="p-2">
              <label className="sr-only" htmlFor={`colfilter-${col.key}`}>סינון לפי {col.label}</label>
              <input
                id={`colfilter-${col.key}`}
                type="text"
                value={filter?.value || ""}
                onChange={e => onFilterChange(e.target.value ? { value: e.target.value } : null)}
                placeholder="מכיל..."
                className="w-full border border-slate-200 rounded-lg px-2 py-1"
              />
            </div>
          )}

          {(col.kind === "number" || col.kind === "date") && (
            <div className="p-2 space-y-1.5 border-b border-slate-100">
              <label className="sr-only" htmlFor={`colfilter-op-${col.key}`}>תנאי סינון עבור {col.label}</label>
              <select
                id={`colfilter-op-${col.key}`}
                value={filter?.op || (col.kind === "date" ? "on" : "eq")}
                onChange={e => onFilterChange({ ...filter, op: e.target.value, value: filter?.value ?? "" })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 bg-white"
              >
                {(col.kind === "date" ? DATE_OPS : NUMBER_OPS).map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              <label className="sr-only" htmlFor={`colfilter-val-${col.key}`}>ערך</label>
              <input
                id={`colfilter-val-${col.key}`}
                type={col.kind === "date" ? "date" : "number"}
                value={filter?.value ?? ""}
                onChange={e => onFilterChange({ op: filter?.op || (col.kind === "date" ? "on" : "eq"), value: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1"
              />
            </div>
          )}

          {col.kind === "enum" && (
            <div className="p-2">
              {options.length > 6 && (
                <>
                  <label className="sr-only" htmlFor={`colfilter-search-${col.key}`}>חיפוש ערכים בעמודה {col.label}</label>
                  <input
                    id={`colfilter-search-${col.key}`}
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="חיפוש..."
                    className="w-full border border-slate-200 rounded-lg px-2 py-1 mb-1.5"
                  />
                </>
              )}
              <div role="listbox" aria-multiselectable="true" aria-label={`ערכים בעמודה ${col.label}`} className="space-y-0.5">
                {filteredOptions.map(o => (
                  <label key={o.value} className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={!!filter?.values?.has(o.value)} onChange={() => toggleValue(o.value)} className="w-3.5 h-3.5" />
                    {o.label}
                  </label>
                ))}
                {filteredOptions.length === 0 && <p className="text-slate-400 px-1 py-1">אין ערכים תואמים</p>}
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
