// Excel-style column header filter/sort for the app's big tables (moved as-is from
// DashboardPage.jsx so the home screen's school table and the district/ownership tables share it).
// Rows are {filterValues: {colKey: raw}}; metaList = [{key, label, fmt}].
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONTROL_LETTER_STATUS_MAP, CONTROL_LETTER_STATUS_OPTIONS } from "../controlLetter/constants";
import DateField from "../DateField";

export const TEXT_FMTS = new Set(["text", "textMulti"]);

// Non-empty status values in a fixed order, used to ordinally encode control_letter_status
// for sort/filter (like closure/goal columns' true/false/null → 2/1/0 encoding) — the empty
// "בחר" placeholder is never a real value, so it's excluded and maps to blank (null) instead.
export const CONTROL_LETTER_STATUS_FILTER_ORDER = CONTROL_LETTER_STATUS_OPTIONS.filter(o => o.value).map(o => o.value);

export function dateToNum(iso) {
  if (!iso) return null;
  const n = Number(iso.replaceAll("-", ""));
  return Number.isNaN(n) ? null : n;
}

export function numToISO(n) {
  const s = String(n).padStart(8, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// fmt "time": minutes since midnight, shown "14:30"; typed "14:30" (or "14").
// fmt "duration": seconds, shown "2:30" (m:ss); typed in minutes ("5", "2.5") or as "2:30".
export function fmtClockMinutes(n) {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

export function fmtDurationSeconds(n) {
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function parseClockInput(text) {
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

function parseDurationInput(text) {
  const t = text.trim();
  const m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t.replace(/,/g, ""));
  return Number.isNaN(n) ? null : Math.round(n * 60);
}

export const NUMBER_FILTER_OPERATORS = [
  { op: "eq", label: "שווה ל..." },
  { op: "ne", label: "לא שווה ל..." },
  { op: "gt", label: "גדול מ..." },
  { op: "gte", label: "גדול או שווה ל..." },
  { op: "lt", label: "קטן מ..." },
  { op: "lte", label: "קטן או שווה ל..." },
];
export const OPERATOR_LABEL = Object.fromEntries(NUMBER_FILTER_OPERATORS.map(o => [o.op, o.label]));

// Text-column header filter operators (fmt "text" / "textMulti"). Mirrors the numeric
// submenu but with string predicates — see evalTextCond / passesOneColumnFilter.
export const TEXT_FILTER_OPERATORS = [
  { op: "contains",    label: "מכיל..." },
  { op: "notContains", label: "לא מכיל..." },
  { op: "eq",          label: "שווה ל..." },
  { op: "ne",          label: "לא שווה ל..." },
  { op: "startsWith",  label: "מתחיל ב..." },
  { op: "endsWith",    label: "מסתיים ב..." },
];

export function fmtMoney(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("he-IL");
}

export function fmtPct2(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

export function fmtInt(v) {
  if (v === null || v === undefined) return "—";
  return String(v);
}

export function formatMeetingHours(totalMinutes) {
  if (!totalMinutes || totalMinutes === 0) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} דק'`;
  if (m === 0) return `${h} שעות`;
  return `${h}:${String(m).padStart(2, "0")} שעות`;
}

export function formatFilterValueLabel(raw, fmt) {
  if (fmt === "text" || fmt === "textMulti") return raw === null || raw === undefined ? "" : String(raw);
  if (fmt === "goal") return raw === 2 ? "כן" : raw === 1 ? "לא" : "טרם הוגדר";
  if (fmt === "closure") return raw === 2 ? "סגור" : raw === 1 ? "לא סגור" : "טרם סומן";
  if (fmt === "gefenClosure") return raw === 2 ? "סגור" : raw === 1 ? "לא סגור" : "לא רלוונטי";
  if (fmt === "controlLetterStatus") {
    const value = CONTROL_LETTER_STATUS_FILTER_ORDER[raw - 1];
    return CONTROL_LETTER_STATUS_MAP[value]?.label || "";
  }
  if (fmt === "date") return raw ? formatDDMMYY(numToISO(raw)) : "";
  if (fmt === "hours") return formatMeetingHours(raw);
  if (fmt === "time") return fmtClockMinutes(raw);
  if (fmt === "duration") return fmtDurationSeconds(raw);
  if (fmt === "pct") return fmtPct2(raw);
  if (fmt === "int") return fmtInt(raw);
  return fmtMoney(raw);
}

// Short human summary of a column filter spec, for the "סינונים פעילים" bar above the table.
// allValues = the column's distinct values (same set the header menu lists), so a filter made
// by unchecking one value reads "הכל חוץ מ: X" instead of a long list of the kept ones.
export function describeColumnFilter(spec, fmt, allValues = []) {
  if (!spec) return "";
  const isTextLike = fmt === "text" || fmt === "textMulti";
  if (spec.mode === "values") {
    const selected = spec.selected || [];
    const excluded = allValues.filter(v => !selected.includes(v));
    const useExcluded = excluded.length > 0 && excluded.length < selected.length;
    const labels = (useExcluded ? excluded : selected).map(v =>
      v === "__BLANK__" ? "(ריקים)" : formatFilterValueLabel(isTextLike ? v : Number(v), fmt)
    );
    const shown = labels.slice(0, 3).join(", ");
    const list = labels.length > 3 ? `${shown} ועוד ${labels.length - 3}` : shown;
    return useExcluded ? `הכל חוץ מ: ${list}` : list;
  }
  const ops = isTextLike ? TEXT_FILTER_OPERATORS : NUMBER_FILTER_OPERATORS;
  const describeCond = c => {
    if (!c || !String(c.value ?? "").trim()) return "";
    const opLabel = (ops.find(o => o.op === c.op)?.label || c.op).replace(/\.\.\.$/, "");
    const value = isTextLike ? `"${c.value}"`
      : fmt === "date" ? formatDDMMYY(c.value)
      : fmt === "pct" ? `${c.value}%`
      : fmt === "hours" ? `${c.value} שעות`
      : fmt === "duration" && !String(c.value).includes(":") ? `${c.value} דק'`
      : c.value;
    return `${opLabel} ${value}`;
  };
  const parts = [describeCond(spec.cond1), describeCond(spec.cond2)].filter(Boolean);
  return parts.join(spec.joiner === "OR" ? " או " : " וגם ");
}

// Converts what the user typed in a filter-value input into the raw unit the column is
// stored in: "pct" columns store a 0-1 fraction (user types a percent, e.g. 75 → 0.75),
// "hours" columns store raw minutes (user types decimal hours, e.g. 5.5 → 330).
export function parseFilterInput(rawInput, fmt) {
  if (rawInput === "" || rawInput === null || rawInput === undefined) return null;
  if (fmt === "date") return dateToNum(String(rawInput));
  if (fmt === "time") return parseClockInput(String(rawInput));
  if (fmt === "duration") return parseDurationInput(String(rawInput));
  const n = Number(String(rawInput).replace(/,/g, "").trim());
  if (Number.isNaN(n)) return null;
  if (fmt === "pct") return n / 100;
  if (fmt === "hours") return n * 60;
  return n;
}

export function evalCond(numericValue, cond, fmt) {
  if (!cond || !cond.op) return true;
  const target = parseFilterInput(cond.value, fmt);
  if (target === null) return true; // empty/invalid condition = no-op
  const eps = fmt === "money" || fmt === "pct" ? 1e-6 : 0;
  switch (cond.op) {
    case "eq": return Math.abs(numericValue - target) <= eps;
    case "ne": return Math.abs(numericValue - target) > eps;
    case "gt": return numericValue > target;
    case "gte": return numericValue >= target;
    case "lt": return numericValue < target;
    case "lte": return numericValue <= target;
    default: return true;
  }
}

// A query made only of digits (and phone separators) is matched against the value's digits:
// phones are shown "050-1234567", and a user searching "0501234567" must still find them.
function isDigitQuery(q) { return /\d/.test(q) && /^[\d\s\-+]+$/.test(q); }
function stripPhoneSeparators(v) { return v.replace(/[\s\-+]/g, ""); }

export function textMatchesQuery(text, query) {
  const t = String(text ?? "");
  return isDigitQuery(query) ? stripPhoneSeparators(t).includes(stripPhoneSeparators(query)) : t.includes(query);
}

// String predicate for a "text"/"textMulti" custom condition. Empty value = no-op (true),
// matching evalCond's behavior for numeric columns.
export function evalTextCond(strValue, cond) {
  if (!cond || !cond.op) return true;
  let target = String(cond.value ?? "").trim().toLowerCase();
  if (target === "") return true;
  let v = String(strValue ?? "").toLowerCase();
  if (isDigitQuery(target)) { target = stripPhoneSeparators(target); v = stripPhoneSeparators(v); }
  switch (cond.op) {
    case "eq": return v === target;
    case "ne": return v !== target;
    case "contains": return v.includes(target);
    case "notContains": return !v.includes(target);
    case "startsWith": return v.startsWith(target);
    case "endsWith": return v.endsWith(target);
    default: return true;
  }
}

export function passesOneColumnFilter(rawValue, spec, fmt) {
  if (!spec) return true;

  if (fmt === "textMulti") {
    const arr = Array.isArray(rawValue)
      ? rawValue.filter(x => x !== null && x !== undefined && x !== "")
      : [];
    if (spec.mode === "values") {
      if (arr.length === 0) return spec.selected.includes("__BLANK__");
      return arr.some(x => spec.selected.includes(String(x)));
    }
    if (arr.length === 0) return false;
    return arr.some(x => {
      const r1 = evalTextCond(x, spec.cond1);
      const r2 = evalTextCond(x, spec.cond2);
      return spec.joiner === "OR" ? (r1 || r2) : (r1 && r2);
    });
  }

  const isText = fmt === "text";
  const isBlank = rawValue === null || rawValue === undefined || (isText && rawValue === "");
  if (spec.mode === "values") {
    if (isBlank) return spec.selected.includes("__BLANK__");
    return spec.selected.includes(String(rawValue));
  }
  // mode === "custom" — blanks never satisfy an operator
  if (isBlank) return false;
  if (isText) {
    const r1 = evalTextCond(rawValue, spec.cond1);
    const r2 = evalTextCond(rawValue, spec.cond2);
    return spec.joiner === "OR" ? (r1 || r2) : (r1 && r2);
  }
  const r1 = evalCond(rawValue, spec.cond1, fmt);
  const r2 = evalCond(rawValue, spec.cond2, fmt);
  return spec.joiner === "OR" ? (r1 || r2) : (r1 && r2);
}

export function passesAllColumnFilters(row, columnFilters, metaList, excludeKey = null) {
  for (const [key, spec] of Object.entries(columnFilters)) {
    if (!spec || key === excludeKey) continue;
    const fmt = metaList.find(c => c.key === key)?.fmt;
    if (!passesOneColumnFilter(row.filterValues[key], spec, fmt)) return false;
  }
  return true;
}

// Stacked multi-column sort: sortSpecs[0] is the most-recently-clicked (primary) column,
// later entries are older clicks kept on as tie-breakers. Blank values always sort last,
// regardless of direction, matching Excel.
export function buildRowComparator(sortSpecs, metaList = []) {
  const fmtOf = k => metaList.find(c => c.key === k)?.fmt;
  return (a, b) => {
    for (const { key, dir } of sortSpecs) {
      const fmt = fmtOf(key);
      let va = a.filterValues[key];
      let vb = b.filterValues[key];
      if (Array.isArray(va)) va = va.join(", ");
      if (Array.isArray(vb)) vb = vb.join(", ");
      const aBlank = va === null || va === undefined || va === "";
      const bBlank = vb === null || vb === undefined || vb === "";
      if (aBlank && bBlank) continue;
      if (aBlank) return 1;
      if (bBlank) return -1;
      if (va === vb) continue;
      const cmp = TEXT_FMTS.has(fmt)
        ? String(va).localeCompare(String(vb), "he", { numeric: true })
        : (va < vb ? -1 : 1);
      return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}

// Excel-style header filter/sort icon + dropdown menu for one numeric column. Owns its
// own transient UI state (search text, custom-filter dialog draft) but reads/writes the
// shared columnFilters/sortSpecs state passed down from DashboardPage so multiple columns
// combine correctly (AND across filters, stacked multi-column sort).
export function ColumnHeaderFilter({ colDef, columnFilters, setColumnFilters, sortSpecs, setSortSpecs, openKey, setOpenKey, baseDisplayRows, allFilterMeta }) {
  const { key, label, fmt } = colDef;
  const isOpen = openKey === key;
  const spec = columnFilters[key] || null;
  const sortIndex = sortSpecs.findIndex(s => s.key === key);
  const isSorted = sortIndex !== -1;
  const isFiltered = !!spec;

  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null); // { top, left } in viewport coords, set only while open
  const [subview, setSubview] = useState("main"); // "main" | "custom"
  const [searchQuery, setSearchQuery] = useState("");
  const [draftSelected, setDraftSelected] = useState([]);
  const [numberFiltersOpen, setNumberFiltersOpen] = useState(false);
  const [customCond1, setCustomCond1] = useState({ op: "eq", value: "" });
  const [customJoiner, setCustomJoiner] = useState("AND");
  const [customCond2, setCustomCond2] = useState({ op: "eq", value: "" });

  // The menu is portaled to document.body (fixed positioning) so it always floats above the
  // table regardless of how few rows are visible — an ancestor (the table's glass-card) has
  // overflow-hidden, which was clipping the dropdown when rendered as a normal in-flow child.
  useEffect(() => {
    if (!isOpen) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 290)) });
  }, [isOpen]);

  // Outside-click check now spans two disjoint DOM subtrees (the button in place, the menu
  // portaled to document.body) since a plain containerRef.contains(...) can no longer see it.
  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e) {
      const insideButton = containerRef.current?.contains(e.target);
      const insideMenu = menuRef.current?.contains(e.target);
      if (!insideButton && !insideMenu) setOpenKey(null);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen, setOpenKey]);

  // A stale menu detached from its anchor is worse than a closed one — dismiss on page/table
  // scroll (the portaled menu is fixed-positioned and would drift away from its header).
  // But NOT when the scroll happens inside the menu itself (its value list / custom panel
  // scroll) — that's a capture-phase scroll event on a descendant, and closing on it makes
  // the value list impossible to scroll.
  useEffect(() => {
    if (!isOpen) return;
    function handleScroll(e) {
      const t = e.target;
      if (t instanceof Node && menuRef.current?.contains(t)) return;
      setOpenKey(null);
    }
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [isOpen, setOpenKey]);

  useEffect(() => {
    if (!isOpen) return;
    setSubview("main");
    setSearchQuery("");
    setNumberFiltersOpen(false);
    if (spec?.mode === "custom") {
      setCustomCond1(spec.cond1);
      setCustomJoiner(spec.joiner);
      setCustomCond2(spec.cond2);
    } else {
      setCustomCond1({ op: "eq", value: "" });
      setCustomJoiner("AND");
      setCustomCond2({ op: "eq", value: "" });
    }
    // Only re-run when the menu freshly opens, not on every spec/state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const distinctValues = useMemo(() => {
    if (!isOpen) return [];
    const rowsPassingOthers = baseDisplayRows.filter(row => passesAllColumnFilters(row, columnFilters, allFilterMeta, key));
    const seen = new Map();
    let hasBlank = false;
    const isTextLike = fmt === "text" || fmt === "textMulti";
    for (const row of rowsPassingOthers) {
      const raw = row.filterValues[key];
      const items = Array.isArray(raw) ? raw : [raw];
      if (items.length === 0) { hasBlank = true; continue; }
      for (const item of items) {
        if (item === null || item === undefined || item === "") { hasBlank = true; continue; }
        const k = String(item);
        if (!seen.has(k)) seen.set(k, { value: k, raw: item, label: formatFilterValueLabel(item, fmt) });
      }
    }
    const list = [...seen.values()].sort((a, b) =>
      isTextLike
        ? String(a.label).localeCompare(String(b.label), "he", { numeric: true })
        : a.raw - b.raw
    );
    if (hasBlank) list.push({ value: "__BLANK__", raw: null, label: "(ריקים)" });
    return list;
  }, [isOpen, baseDisplayRows, columnFilters, allFilterMeta, key, fmt]);

  useEffect(() => {
    if (!isOpen) return;
    if (spec?.mode === "values") setDraftSelected(spec.selected);
    else setDraftSelected(distinctValues.map(v => v.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, distinctValues]);

  // Excel-style search behavior: the moment the user starts typing in the value search, the
  // selection snaps to "all currently-matching values" (so pressing אישור/Enter filters to
  // the matches, and unchecking then narrows further). Clearing the search restores the
  // previous full selection. Without this, the hidden non-matching values stay selected and
  // אישור ends up applying "≈everything" = no filter.
  const prevQueryEmptyRef = useRef(true);
  useEffect(() => {
    if (!isOpen) { prevQueryEmptyRef.current = true; return; }
    const q = searchQuery.trim();
    const wasEmpty = prevQueryEmptyRef.current;
    prevQueryEmptyRef.current = q === "";
    if (q && wasEmpty) {
      setDraftSelected(distinctValues.filter(v => textMatchesQuery(v.label, q)).map(v => v.value));
    } else if (!q && !wasEmpty) {
      setDraftSelected(spec?.mode === "values" ? spec.selected : distinctValues.map(v => v.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, searchQuery, distinctValues]);

  function applySort(dir) {
    setSortSpecs(prev => [{ key, dir }, ...prev.filter(s => s.key !== key)]);
    setOpenKey(null);
  }

  function removeSort() {
    setSortSpecs(prev => prev.filter(s => s.key !== key));
  }

  function clearFilter() {
    setColumnFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Reset the menu's own drafts too, in case the user keeps the menu open afterward.
    setSearchQuery("");
    setDraftSelected(distinctValues.map(v => v.value));
    setCustomCond1({ op: "eq", value: "" });
    setCustomJoiner("AND");
    setCustomCond2({ op: "eq", value: "" });
  }

  function toggleValue(v) {
    setDraftSelected(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  // While a search query is active only matching values are shown — and, Excel-style, only
  // those matching values participate in the selection. "(ריקים)" is shown unfiltered only
  // when there is no query.
  const trimmedQuery = searchQuery.trim();
  const filteredDistinctValues = trimmedQuery
    ? distinctValues.filter(v => textMatchesQuery(v.label, trimmedQuery))
    : distinctValues;

  function toggleSelectAll() {
    setDraftSelected(prev =>
      filteredDistinctValues.every(v => prev.includes(v.value))
        ? prev.filter(v => !filteredDistinctValues.some(fv => fv.value === v))
        : [...new Set([...prev, ...filteredDistinctValues.map(v => v.value)])]
    );
  }

  function confirmValues() {
    setColumnFilters(prev => {
      const next = { ...prev };
      const allValues = distinctValues.map(v => v.value);
      // With a search query: the selection is exactly the checked values among the matches
      // (hidden, non-matching values are ignored). Without a query: the checked values.
      const selected = trimmedQuery
        ? filteredDistinctValues.filter(v => draftSelected.includes(v.value)).map(v => v.value)
        : draftSelected.filter(v => allValues.includes(v));
      const isAll = allValues.length > 0 && allValues.every(v => selected.includes(v));
      if (selected.length === 0 || isAll) delete next[key];
      else next[key] = { mode: "values", selected };
      return next;
    });
    setOpenKey(null);
    setSearchQuery("");
  }

  function openCustomDialog(presetOp) {
    if (presetOp === "between") {
      setCustomCond1({ op: "gte", value: "" });
      setCustomJoiner("AND");
      setCustomCond2({ op: "lte", value: "" });
    } else if (presetOp) {
      setCustomCond1(c => ({ ...c, op: presetOp }));
    }
    setSubview("custom");
  }

  function applyCustom() {
    const bothEmpty = !String(customCond1.value ?? "").trim() && !String(customCond2.value ?? "").trim();
    setColumnFilters(prev => {
      const next = { ...prev };
      if (bothEmpty) delete next[key];
      else next[key] = { mode: "custom", cond1: customCond1, joiner: customJoiner, cond2: customCond2 };
      return next;
    });
    setOpenKey(null);
  }

  const isTextLike = fmt === "text" || fmt === "textMulti";
  const customOperators = isTextLike ? TEXT_FILTER_OPERATORS : NUMBER_FILTER_OPERATORS;
  const valuePlaceholder = fmt === "pct" ? "%" : fmt === "hours" ? "שעות" : fmt === "time" ? "שעה" : fmt === "duration" ? "דקות" : isTextLike ? "טקסט" : "ערך";

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        draggable={false}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpenKey(isOpen ? null : key); }}
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
                  {isTextLike ? 'מיין מא׳ עד ת׳' : 'מיין מהקטן לגדול'}
                </button>
                <button type="button" onClick={() => applySort("desc")} className="w-full flex items-center gap-2 text-right px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50">
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  {isTextLike ? 'מיין מת׳ עד א׳' : 'מיין מהגדול לקטן'}
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

              {fmt !== "goal" && fmt !== "closure" && fmt !== "controlLetterStatus" && (
                <div className="border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => setNumberFiltersOpen(o => !o)}
                    aria-expanded={numberFiltersOpen}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50"
                  >
                    {isTextLike ? "מסנני טקסט" : fmt === "date" ? "מסנני תאריכים" : fmt === "time" ? "מסנני שעות" : fmt === "duration" ? "מסנני משך" : "מסנני מספרים"}
                    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: numberFiltersOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  {numberFiltersOpen && (
                    <div className="pb-1">
                      {customOperators.map(o => (
                        <button key={o.op} type="button" onClick={() => openCustomDialog(o.op)} className="w-full text-right px-5 py-1.5 text-sm text-slate-600 hover:bg-blue-50">
                          {o.label}
                        </button>
                      ))}
                      {!isTextLike && (
                        <button type="button" onClick={() => openCustomDialog("between")} className="w-full text-right px-5 py-1.5 text-sm text-slate-600 hover:bg-blue-50">
                          בין...
                        </button>
                      )}
                      <button type="button" onClick={() => openCustomDialog(null)} className="w-full text-right px-5 py-1.5 text-sm text-slate-600 hover:bg-blue-50">
                        מסנן מותאם אישית...
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="p-2 border-b border-slate-100">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmValues(); } }}
                  placeholder="חיפוש..."
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
                  aria-label={`חיפוש ערכים בעמודה ${label}`}
                />
              </div>
              <label className="flex items-center gap-2.5 px-4 py-1.5 border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filteredDistinctValues.length > 0 && filteredDistinctValues.every(v => draftSelected.includes(v.value))}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                />
                <span className="text-sm font-medium text-slate-700">בחר הכל</span>
              </label>
              <div className="overflow-y-auto" style={{ maxHeight: 160 }} role="listbox" aria-multiselectable="true">
                {filteredDistinctValues.length === 0 ? (
                  <p className="text-xs text-slate-400 px-4 py-3 text-center">אין ערכים להצגה</p>
                ) : (
                  filteredDistinctValues.map(v => (
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
              <div className="flex items-center gap-1.5">
                <select value={customCond1.op} onChange={e => setCustomCond1(c => ({ ...c, op: e.target.value }))} className="input-field text-xs flex-shrink-0" style={{ width: 120 }} aria-label="אופרטור תנאי 1">
                  {customOperators.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {fmt === "date"
                  ? <DateField value={customCond1.value} onChange={v => setCustomCond1(c => ({ ...c, value: v }))} className="input-field text-xs w-full" wrapperClassName="relative flex-1 min-w-0" aria-label="ערך תנאי 1" />
                  : <input type="text" value={customCond1.value} onChange={e => setCustomCond1(c => ({ ...c, value: e.target.value }))} className="input-field text-xs flex-1" placeholder={valuePlaceholder} aria-label="ערך תנאי 1" />}
              </div>
              <div className="inline-flex self-center rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold" style={{ direction: "ltr" }}>
                <button type="button" onClick={() => setCustomJoiner("AND")} className={`px-3 py-1 transition-colors ${customJoiner === "AND" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>וגם</button>
                <button type="button" onClick={() => setCustomJoiner("OR")} className={`px-3 py-1 border-r border-slate-200 transition-colors ${customJoiner === "OR" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>או</button>
              </div>
              <div className="flex items-center gap-1.5">
                <select value={customCond2.op} onChange={e => setCustomCond2(c => ({ ...c, op: e.target.value }))} className="input-field text-xs flex-shrink-0" style={{ width: 120 }} aria-label="אופרטור תנאי 2">
                  {customOperators.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {fmt === "date"
                  ? <DateField value={customCond2.value} onChange={v => setCustomCond2(c => ({ ...c, value: v }))} className="input-field text-xs w-full" wrapperClassName="relative flex-1 min-w-0" aria-label="ערך תנאי 2" />
                  : <input type="text" value={customCond2.value} onChange={e => setCustomCond2(c => ({ ...c, value: e.target.value }))} className="input-field text-xs flex-1" placeholder={valuePlaceholder} aria-label="ערך תנאי 2" />}
              </div>
              {fmt === "hours" && <p className="text-xs text-slate-400">לדוגמה: 5.5 (5 שעות ו-30 דק')</p>}
              {fmt === "pct" && <p className="text-xs text-slate-400">הזן אחוז, לדוגמה: 75</p>}
              {fmt === "time" && <p className="text-xs text-slate-400">הזן שעה, לדוגמה: 14:30</p>}
              {fmt === "duration" && <p className="text-xs text-slate-400">הזן דקות, לדוגמה: 5 או 2:30</p>}
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={applyCustom} className="btn-blue text-xs px-4 py-1.5 rounded-lg">החל</button>
                <button type="button" onClick={() => setSubview("main")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">ביטול</button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export function formatDDMMYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
