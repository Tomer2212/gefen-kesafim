import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MEETING_STATUS_OPTIONS,
  MEETING_TYPE_OPTIONS,
  MEETING_SERVICE_TYPE_OPTIONS,
  formatMeetingDate,
} from "./constants";

// Excel-style per-column filter + sort for the meetings table (MeetingsTable.jsx), modeled on
// DashboardPage.jsx's ColumnHeaderFilter but trimmed for categorical / text / date / time
// columns (no numeric-operator submenu). All state (columnFilters, sortSpecs) is owned by
// MeetingsTable and passed down so multiple columns combine: AND across filters, stacked
// multi-column sort (sortSpecs[0] = primary / most-recently clicked).

const STATUS_ORDER = MEETING_STATUS_OPTIONS.map(o => o.value); // ordinal encoding for sort
const TYPE_LABEL = Object.fromEntries(MEETING_TYPE_OPTIONS.map(o => [o.value, o.label]));
const SERVICE_LABEL = Object.fromEntries(MEETING_SERVICE_TYPE_OPTIONS.map(o => [o.value, o.label]));

// One raw comparable value per filterable meeting column — computed once per row so the
// filter/sort/value-list logic never needs to know where a value comes from. Blank = null.
// status/reminder are numeric (logical order, not alphabetical); the rest are strings.
export function computeMeetingFilterValues(m, { schoolLabel } = {}) {
  const advisors = (m.advisor_profiles || [])
    .map(p => p.full_name || p.email)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "he"));
  const sIdx = m.status ? STATUS_ORDER.indexOf(m.status) : -1;
  return {
    date: m.meeting_date || null,
    status: sIdx >= 0 ? sIdx : (m.status ? 99 : null),
    start: m.start_time || null,
    end: m.end_time || null,
    advisor: advisors.length ? advisors.join(", ") : null,
    type: m.meeting_type || null,
    service_type: m.meeting_service_type || null,
    reminder: m.reminder_enabled ? 1 : 0,
    school: schoolLabel || null,
  };
}

// Display label for one raw value in the checkbox list.
export function meetingFilterValueLabel(key, raw) {
  if (raw === null || raw === undefined || raw === "") return "(ריקים)";
  if (key === "date") return formatMeetingDate(raw);
  if (key === "status") return MEETING_STATUS_OPTIONS[raw]?.label || "אחר";
  if (key === "type") return TYPE_LABEL[raw] || raw;
  if (key === "service_type") return SERVICE_LABEL[raw] || raw;
  if (key === "reminder") return raw === 1 ? "מופעלת" : "כבויה";
  return String(raw);
}

function passesOne(raw, spec) {
  const blank = raw === null || raw === undefined || raw === "";
  if (spec.mode === "values") {
    if (blank) return spec.selected.includes("__BLANK__");
    return spec.selected.includes(String(raw));
  }
  if (spec.mode === "dateRange") {
    if (blank) return false;
    const v = String(raw);
    if (spec.op === "before") return spec.d1 ? v < spec.d1 : true;
    if (spec.op === "after") return spec.d1 ? v > spec.d1 : true;
    if (spec.op === "between") {
      if (spec.d1 && v < spec.d1) return false;
      if (spec.d2 && v > spec.d2) return false;
      return true;
    }
  }
  return true;
}

// AND across every active column filter. `excludeKey` lets a column's own menu compute the
// list of still-available values ignoring its own filter (Excel behavior).
export function passesMeetingColumnFilters(filterValues, columnFilters, excludeKey = null) {
  for (const [key, spec] of Object.entries(columnFilters || {})) {
    if (!spec || key === excludeKey) continue;
    if (!passesOne(filterValues[key], spec)) return false;
  }
  return true;
}

// Stacked multi-column sort; blanks always sort last regardless of direction (Excel).
export function buildMeetingRowComparator(sortSpecs) {
  return (a, b) => {
    for (const { key, dir } of sortSpecs) {
      const va = a.filterValues[key];
      const vb = b.filterValues[key];
      const aB = va === null || va === undefined || va === "";
      const bB = vb === null || vb === undefined || vb === "";
      if (aB && bB) continue;
      if (aB) return 1;
      if (bB) return -1;
      let cmp;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "he");
      if (cmp === 0) continue;
      return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}

function sortLabels(type) {
  if (type === "date" || type === "time") return ["מיין מהמוקדם למאוחר", "מיין מהמאוחר למוקדם"];
  if (type === "text") return ["מיין מא׳ עד ת׳", "מיין מת׳ עד א׳"];
  return ["מיין מהקטן לגדול", "מיין מהגדול לקטן"];
}

const DATE_OPS = [
  { op: "before", label: "לפני תאריך..." },
  { op: "after", label: "אחרי תאריך..." },
  { op: "between", label: "בין תאריכים..." },
];

export function MeetingColumnMenu({
  colKey, label, type = "text",
  columnFilters, setColumnFilters, sortSpecs, setSortSpecs,
  openKey, setOpenKey, rows,
}) {
  const isOpen = openKey === colKey;
  const spec = columnFilters[colKey] || null;
  const sortIndex = sortSpecs.findIndex(s => s.key === colKey);
  const isSorted = sortIndex !== -1;
  const isFiltered = !!spec;

  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  const [subview, setSubview] = useState("main"); // "main" | "date"
  const [searchQuery, setSearchQuery] = useState("");
  const [draftSelected, setDraftSelected] = useState([]);
  const [dateDraft, setDateDraft] = useState({ op: "before", d1: "", d2: "" });

  useEffect(() => {
    if (!isOpen) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 290)) });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e) {
      const insideBtn = containerRef.current?.contains(e.target);
      const insideMenu = menuRef.current?.contains(e.target);
      if (!insideBtn && !insideMenu) setOpenKey(null);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen, setOpenKey]);

  useEffect(() => {
    if (!isOpen) return;
    function handleScroll() { setOpenKey(null); }
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [isOpen, setOpenKey]);

  useEffect(() => {
    if (!isOpen) return;
    setSubview("main");
    setSearchQuery("");
    if (spec?.mode === "dateRange") setDateDraft({ op: spec.op, d1: spec.d1 || "", d2: spec.d2 || "" });
    else setDateDraft({ op: "before", d1: "", d2: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const distinctValues = useMemo(() => {
    if (!isOpen) return [];
    const pool = (rows || []).filter(r => passesMeetingColumnFilters(r.filterValues, columnFilters, colKey));
    const seen = new Map();
    let hasBlank = false;
    for (const r of pool) {
      const raw = r.filterValues[colKey];
      if (raw === null || raw === undefined || raw === "") { hasBlank = true; continue; }
      const k = String(raw);
      if (!seen.has(k)) seen.set(k, { value: k, raw, label: meetingFilterValueLabel(colKey, raw) });
    }
    const list = [...seen.values()].sort((a, b) =>
      (typeof a.raw === "number" && typeof b.raw === "number")
        ? a.raw - b.raw
        : String(a.raw).localeCompare(String(b.raw), "he")
    );
    if (hasBlank) list.push({ value: "__BLANK__", raw: null, label: "(ריקים)" });
    return list;
  }, [isOpen, rows, columnFilters, colKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (spec?.mode === "values") setDraftSelected(spec.selected);
    else setDraftSelected(distinctValues.map(v => v.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, distinctValues]);

  const [ascLabel, descLabel] = sortLabels(type);

  function applySort(dir) {
    setSortSpecs(prev => [{ key: colKey, dir }, ...prev.filter(s => s.key !== colKey)]);
    setOpenKey(null);
  }
  function removeSort() {
    setSortSpecs(prev => prev.filter(s => s.key !== colKey));
  }
  function clearFilter() {
    setColumnFilters(prev => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
    setDraftSelected(distinctValues.map(v => v.value));
    setDateDraft({ op: "before", d1: "", d2: "" });
  }
  function toggleValue(v) {
    setDraftSelected(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  const filteredDistinct = distinctValues.filter(v =>
    v.value === "__BLANK__" || !searchQuery.trim() || v.label.includes(searchQuery.trim())
  );

  function toggleSelectAll() {
    setDraftSelected(prev =>
      filteredDistinct.every(v => prev.includes(v.value))
        ? prev.filter(v => !filteredDistinct.some(fv => fv.value === v))
        : [...new Set([...prev, ...filteredDistinct.map(v => v.value)])]
    );
  }

  function confirmValues() {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (draftSelected.length === distinctValues.length) delete next[colKey];
      else next[colKey] = { mode: "values", selected: draftSelected };
      return next;
    });
    setOpenKey(null);
  }

  function applyDateFilter() {
    const { op, d1, d2 } = dateDraft;
    const empty = op === "between" ? (!d1 && !d2) : !d1;
    setColumnFilters(prev => {
      const next = { ...prev };
      if (empty) delete next[colKey];
      else next[colKey] = { mode: "dateRange", op, d1, d2 };
      return next;
    });
    setOpenKey(null);
  }

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpenKey(isOpen ? null : colKey); }}
        aria-label={`סינון ומיון: ${label}`}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`relative flex items-center justify-center w-5 h-5 rounded transition-colors flex-shrink-0 ${
          isFiltered || isSorted ? "text-blue-600 bg-blue-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        }`}
      >
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="4 4 20 4 14 13 14 20 10 22 10 13 4 4" />
        </svg>
        {isSorted && (
          <span className="absolute -top-1.5 -left-1.5 text-[9px] font-bold leading-none w-3 h-3 rounded-full bg-blue-600 text-white flex items-center justify-center">
            {sortIndex + 1}
          </span>
        )}
      </button>
      {isOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 border border-slate-200 rounded-xl bg-white shadow-xl text-right"
          style={{ top: menuPos.top, left: menuPos.left, minWidth: 230, maxWidth: 280 }}
          dir="rtl"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {subview === "main" ? (
            <>
              <div className="py-1 border-b border-slate-100">
                <button type="button" onClick={() => applySort("asc")} className="w-full flex items-center gap-2 text-right px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50">
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  {ascLabel}
                </button>
                <button type="button" onClick={() => applySort("desc")} className="w-full flex items-center gap-2 text-right px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50">
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  {descLabel}
                </button>
                {isSorted && (
                  <button type="button" onClick={removeSort} className="w-full text-right px-3 py-1.5 text-xs text-slate-400 hover:text-red-500 hover:bg-slate-50">
                    בטל מיון בעמודה זו
                  </button>
                )}
                {isFiltered && (
                  <button type="button" onClick={clearFilter} className="w-full text-right px-3 py-1.5 text-xs text-slate-400 hover:text-red-500 hover:bg-slate-50">
                    בטל סינון בעמודה זו
                  </button>
                )}
              </div>

              {type === "date" && (
                <div className="border-b border-slate-100 py-1">
                  {DATE_OPS.map(o => (
                    <button
                      key={o.op}
                      type="button"
                      onClick={() => { setDateDraft(d => ({ ...d, op: o.op })); setSubview("date"); }}
                      className="w-full text-right px-3 py-1.5 text-sm text-slate-600 hover:bg-blue-50"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="p-2 border-b border-slate-100">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="חיפוש..."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
                  aria-label={`חיפוש ערכים בעמודה ${label}`}
                />
              </div>
              <label className="flex items-center gap-2.5 px-4 py-1.5 border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filteredDistinct.length > 0 && filteredDistinct.every(v => draftSelected.includes(v.value))}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                />
                <span className="text-sm font-medium text-slate-700">בחר הכל</span>
              </label>
              <div className="overflow-y-auto" style={{ maxHeight: 160 }} role="listbox" aria-multiselectable="true">
                {filteredDistinct.length === 0 ? (
                  <p className="text-xs text-slate-400 px-4 py-3 text-center">אין ערכים להצגה</p>
                ) : (
                  filteredDistinct.map(v => (
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
                <button type="button" onClick={confirmValues} className="btn-blue text-xs px-4 py-1.5 rounded-lg">אישור</button>
                <button type="button" onClick={() => setOpenKey(null)} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">ביטול</button>
              </div>
            </>
          ) : (
            <div className="p-3 flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                <span>{DATE_OPS.find(o => o.op === dateDraft.op)?.label}</span>
                <input
                  type="date"
                  value={dateDraft.d1}
                  onChange={e => setDateDraft(d => ({ ...d, d1: e.target.value }))}
                  className="input-field text-xs"
                  aria-label="תאריך התחלה"
                />
              </label>
              {dateDraft.op === "between" && (
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  <span>עד תאריך</span>
                  <input
                    type="date"
                    value={dateDraft.d2}
                    onChange={e => setDateDraft(d => ({ ...d, d2: e.target.value }))}
                    className="input-field text-xs"
                    aria-label="תאריך סיום"
                  />
                </label>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={applyDateFilter} className="btn-blue text-xs px-4 py-1.5 rounded-lg">החל</button>
                <button type="button" onClick={() => setSubview("main")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">חזרה</button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
