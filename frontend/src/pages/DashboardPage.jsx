import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";
import OnboardingToast from "../components/OnboardingToast";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ACADEMIC_YEARS, DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import { CONTROL_LETTER_STATUS_MAP, CONTROL_LETTER_STATUS_OPTIONS } from "../components/controlLetter/constants";
import { MEETING_SERVICE_TYPE_BREAKDOWN_COL_ORDER } from "../components/meetings/constants";

// Fallback list so "סוג תקציב" has real options even before check_metrics has any rows
// for the org (brand-new table, only populated going forward by new checks) — matches
// normalize_budget_name's target names in backend/zihuy_core.py.
const DEFAULT_BUDGET_TYPES = ["גפן", "דוקאטי", "תנופה", "גפן חירום", "פל\"ג", "כללי"];

function matchesBudgetType(combo, budgetTypes) {
  if (!budgetTypes.length) return true;
  return budgetTypes.some(b => b.value === combo.budget_name);
}

// Evaluates a chain of goal conditions left-to-right with user-chosen AND/OR connectors
// (no operator precedence — each connector combines the running result with the next condition).
function evalGoalConditions(school, combo, conditions) {
  if (!conditions.length) return true;
  let result = null;
  conditions.forEach((c, i) => {
    const findStatus = budgetName => (school.goal_statuses || []).find(g =>
      g.goal_key === c.goalKey &&
      g.division_type === combo.division_type &&
      g.budget_name === budgetName
    );
    // Schools with no check/budget history yet used to have their goal saved under an empty
    // budget_name (a GoalsTab bug, now fixed to default to "גפן" like everywhere else) — fall
    // back to that legacy blank value so goals saved before the fix still match here too.
    const status = findStatus(combo.budget_name) || findStatus("");
    const met = status ? status.met : null;
    let condResult = true;
    if (c.met === "true") condResult = met === true;
    else if (c.met === "false") condResult = met === false;
    else if (c.met === "unset") condResult = met === null || met === undefined;
    result = i === 0 ? condResult : (c.connector === "OR" ? (result || condResult) : (result && condResult));
  });
  return result;
}

const DIVISION_LABEL = {
  tikkon: "חטיבה עליונה",
  beinayim: "חטיבת ביניים",
  yesodi: "יסודי",
  other: "אחר",
  sheshshnati: "שש שנתי",
};

const SCHOOL_STAGE_LABEL = {
  yesodi:      "יסודי",
  beinayim:    "חטיבת ביניים",
  tikkon:      "תיכון",
  sheshshnati: "שש שנתי",
  other:       "אחר",
};

const FINANCE_SOFTWARE_LABEL = {
  kesafim2000: "כספים 2000",
  payscool:    "פייסקול",
  schoolcash:  "סקולקאש",
};

const EMPTY_FILTERS = {
  names: [], symbols: [], stages: [], divisions: [],
  cities: [], authorities: [], financeSoftwares: [], addresses: [],
  principals: [], secretaries: [], financeContacts: [],
  advisorGefen: [], advisorCurrent: [], advisorDistrict: [],
  accessAdvisors: [],
};

const EMPTY_QUERIES = {
  names: "", symbols: "", stages: "", divisions: "",
  cities: "", authorities: "", financeSoftwares: "", addresses: "",
  principals: "", secretaries: "", financeContacts: "",
  advisorGefen: "", advisorCurrent: "", advisorDistrict: "",
  accessAdvisors: "",
};

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))].sort();
}

const FILTER_CONFIG = [
  { key: "names",           label: "שם בית ספר",    openOnFocus: false, getOptions: s => uniq(s.map(x => x.name)).map(v => ({ value: v, label: v })) },
  { key: "symbols",         label: "סמל מוסד",       openOnFocus: false, getOptions: s => uniq(s.map(x => x.symbol)).map(v => ({ value: v, label: v })) },
  { key: "stages",          label: "שלב מוסד",       openOnFocus: false, getOptions: s => uniq(s.map(x => x.stage)).map(v => ({ value: v, label: SCHOOL_STAGE_LABEL[v] || v })) },
  { key: "divisions",       label: "חטיבות",         openOnFocus: false, getOptions: s => uniq(s.flatMap(x => (x.gefen_accounts || []).map(a => a.division_type))).map(v => ({ value: v, label: DIVISION_LABEL[v] || v })) },
  { key: "cities",          label: "עיר",            openOnFocus: false, getOptions: s => uniq(s.map(x => x.city)).map(v => ({ value: v, label: v })) },
  { key: "authorities",     label: "בעלות",           openOnFocus: false, getOptions: s => uniq(s.map(x => x.authority)).map(v => ({ value: v, label: v })) },
  { key: "financeSoftwares",label: "תוכנת כספים",   checkbox: true,     getOptions: s => uniq(s.map(x => x.finance_software)).map(v => ({ value: v, label: FINANCE_SOFTWARE_LABEL[v] || v })) },
  { key: "addresses",       label: "כתובת",          openOnFocus: false, getOptions: s => uniq(s.map(x => x.address)).map(v => ({ value: v, label: v })) },
  { key: "principals",      label: "מנהל/ת",         openOnFocus: false, getOptions: s => uniq(s.map(x => x.principal_name)).map(v => ({ value: v, label: v })) },
  { key: "secretaries",     label: "מנהלנ/ית",       openOnFocus: false, getOptions: s => uniq(s.map(x => x.secretary_name)).map(v => ({ value: v, label: v })) },
  { key: "financeContacts", label: "אחראי/ת כספים",  openOnFocus: false, getOptions: s => uniq(s.map(x => x.finance_contact_name)).map(v => ({ value: v, label: v })) },
  { key: "advisorGefen",    label: "יועץ מלווה [גפן]",   checkbox: true,                          getOptions: () => [] },
  { key: "advisorCurrent",  label: "יועץ מלווה [שוטף]",  checkbox: true,                          getOptions: () => [] },
  { key: "advisorDistrict", label: "יועץ מלווה [מחוז]",  checkbox: true,                          getOptions: () => [] },
  { key: "accessAdvisors", label: "גישה",            checkbox: true, showAllOption: true,       getOptions: () => [] },
];

const ALL_OPTION = { value: "__all__", label: "כולם" };

function CheckboxFilterField({ label, options, selected, onChange, showAllOption }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) { setDraft(selected); setSearchQuery(""); }
  }, [selected, open]);

  function openDropdown() { setDraft(selected); setOpen(true); }

  function confirm() { onChange(draft); setOpen(false); }

  function clear() { setDraft([]); }

  function toggleItem(opt) {
    setDraft(prev =>
      prev.some(s => s.value === opt.value)
        ? prev.filter(s => s.value !== opt.value)
        : [...prev, opt]
    );
  }

  const filteredOptions = options.filter(opt =>
    !searchQuery.trim() || opt.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  function renderItem(opt) {
    return (
      <label
        key={opt.value}
        className="flex items-center gap-2.5 px-4 py-2 hover:bg-blue-50 cursor-pointer"
      >
        <input
          type="checkbox"
          checked={draft.some(s => s.value === opt.value)}
          onChange={() => toggleItem(opt)}
          className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
        />
        <span className="text-sm text-slate-700">{opt.label}</span>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openDropdown())}
          className="input-field text-sm w-full text-right"
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {selected.length > 0 ? (
            <span className="text-slate-700">{selected.length} נבחרו</span>
          ) : (
            <span className="text-slate-300 select-none">—</span>
          )}
        </button>
        {open && (
          <div
            className="absolute z-40 right-0 left-0 bottom-full mb-1 border border-slate-200 rounded-xl bg-white shadow-xl"
            style={{ minWidth: 180 }}
          >
            <div className="p-2 border-b border-slate-100">
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חיפוש..."
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
                aria-label={`חיפוש ${label}`}
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 150 }} role="listbox" aria-multiselectable="true">
              {showAllOption && !searchQuery.trim() && renderItem(ALL_OPTION)}
              {filteredOptions.length === 0 && !(showAllOption && !searchQuery.trim()) ? (
                <p className="text-xs text-slate-400 px-4 py-3 text-center">לא נמצאו תוצאות</p>
              ) : (
                filteredOptions.map(opt => renderItem(opt))
              )}
            </div>
            <div className="p-2 border-t border-slate-100 flex items-center gap-2">
              <button type="button" onClick={confirm} className="btn-blue text-xs px-4 py-1.5 rounded-lg">
                אישור
              </button>
              <button type="button" onClick={clear} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">
                נקה סינון
              </button>
            </div>
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {selected.map(s => (
            <span
              key={s.value}
              className="inline-flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}
            >
              {s.label}
              <button
                type="button"
                onClick={() => onChange(selected.filter(x => x.value !== s.value))}
                className="hover:text-red-500 leading-none"
                aria-label={`הסר ${s.label}`}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterField({ label, options, selected, onChange, query, onQueryChange, openOnFocus }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const suggestions = options
    .filter(opt => !selected.some(s => s.value === opt.value))
    .filter(opt => !query.trim() || opt.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  function select(opt) {
    if (!selected.some(s => s.value === opt.value)) onChange([...selected, opt]);
    onQueryChange("");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div
        ref={containerRef}
        className="relative"
        onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
      >
        <input
          type="text"
          className="input-field text-sm"
          value={query}
          onChange={e => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => { if (openOnFocus) setOpen(true); }}
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <div className="absolute z-30 right-0 left-0 mt-1 border border-slate-200 rounded-xl bg-white shadow-lg max-h-40 overflow-y-auto">
            {suggestions.map(opt => (
              <button
                key={opt.value}
                type="button"
                onMouseDown={e => { e.preventDefault(); select(opt); }}
                className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {selected.map(s => (
            <span key={s.value} className="inline-flex items-center gap-0.5 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
              {s.label}
              <button
                type="button"
                onClick={() => onChange(selected.filter(x => x.value !== s.value))}
                className="hover:text-red-500 leading-none"
                aria-label={`הסר ${s.label}`}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AccordionSection({ title, isOpen, onToggle, badge, children }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full bg-blue-100 text-blue-700 leading-none">
              {badge}
            </span>
          )}
        </span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {isOpen && <div className="px-4 pb-4 pt-1 border-t border-slate-100">{children}</div>}
    </div>
  );
}

function GoalPicker({ goalDefinitions, addedKeys, onAdd }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const available = goalDefinitions.filter(g =>
    !addedKeys.includes(g.key) && (!query.trim() || g.label.includes(query.trim()))
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input-field text-sm w-full text-right"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        + הוסף יעד לסינון
      </button>
      {open && (
        <div className="absolute z-40 right-0 left-0 top-full mt-1 border border-slate-200 rounded-xl bg-white shadow-xl">
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חיפוש..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
              aria-label="חיפוש יעד"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }} role="listbox">
            {available.length === 0 ? (
              <p className="text-xs text-slate-400 px-4 py-3 text-center">אין יעדים נוספים להוספה</p>
            ) : (
              available.map(g => (
                <button
                  key={g.key}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); onAdd(g.key); setQuery(""); }}
                  className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 transition-colors"
                >
                  {g.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GoalConditionRow({ condition, index, label, onChangeMet, onChangeConnector, onRemove }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {index > 0 && (
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0" style={{ direction: "ltr" }}>
          <button
            type="button"
            onClick={() => onChangeConnector("AND")}
            className={`px-2.5 py-1 transition-colors ${condition.connector === "AND" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >וגם</button>
          <button
            type="button"
            onClick={() => onChangeConnector("OR")}
            className={`px-2.5 py-1 border-r border-slate-200 transition-colors ${condition.connector === "OR" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >או</button>
        </div>
      )}
      <span className="text-sm text-slate-700 flex-1" style={{ minWidth: 160 }}>{label}</span>
      <select
        value={condition.met}
        onChange={e => onChangeMet(e.target.value)}
        className="input-field text-sm"
        style={{ maxWidth: 130 }}
        aria-label={`מצב עמידה ביעד: ${label}`}
      >
        <option value="">הכל</option>
        <option value="true">עומד</option>
        <option value="false">לא עומד</option>
        <option value="unset">לא סומן</option>
      </select>
      <button
        type="button"
        onClick={onRemove}
        className="text-slate-400 hover:text-red-500 px-1 leading-none"
        aria-label={`הסר תנאי ${label}`}
      >×</button>
    </div>
  );
}

// Per-service-type "פגישות/שעות שבוצעו" columns — one count + one hours column per bucket
// (גפן / שוטף / גפן+שוטף / מחוז / ללא סוג). Off by default; values come from
// school.meetings_stats.by_type[<key>]. Kept adjacent to the two aggregate meetings columns.
const MEETING_TYPE_BREAKDOWN_COLUMNS = MEETING_SERVICE_TYPE_BREAKDOWN_COL_ORDER.flatMap(t => [
  { key: `meetings_completed_${t.key}`, label: `סה"כ פגישות ${t.label} שבוצעו`, breakdownType: t.key, breakdownMetric: "completed" },
  { key: `meetings_hours_${t.key}`,     label: `סה"כ שעות ${t.label} שבוצעו`,   breakdownType: t.key, breakdownMetric: "total_minutes" },
]);
const MEETING_TYPE_BREAKDOWN_COL_META = Object.fromEntries(
  MEETING_TYPE_BREAKDOWN_COLUMNS.map(c => [c.key, c])
);

// Column-picker groups (see columnCategories below). MOVABLE_COLUMNS stays the flat
// concatenation of all three so the rest of the file (DEFAULT_COL_ORDER, colVisible init,
// back-fill) keeps working unchanged.
const GENERAL_COLUMNS = [
  { key: "symbol",              label: "סמל מוסד" },
  { key: "city",                label: "עיר" },
  { key: "authority",           label: "בעלות" },
  { key: "stage",               label: "שלב מוסד" },
  { key: "district",            label: "מחוז" },
  { key: "finance_software",    label: "תוכנת כספים" },
  { key: "advisor_gefen",       label: "יועץ מלווה [גפן]" },
  { key: "advisor_current",     label: "יועץ מלווה [שוטף]" },
  { key: "advisor_district",    label: "יועץ מלווה [מחוז]" },
];
const ALLOCATION_COLUMNS = [
  { key: "meeting_allocation_gefen",    label: "הקצאת פגישות [גפן]" },
  { key: "meeting_allocation_current",  label: "הקצאת פגישות [שוטף]" },
  { key: "meeting_allocation_district", label: "הקצאת פגישות [מחוז]" },
  { key: "meeting_duration_gefen",      label: "הקצאת זמן פגישה [גפן]" },
  { key: "meeting_duration_current",    label: "הקצאת זמן פגישה [שוטף]" },
  { key: "meeting_duration_district",   label: "הקצאת זמן פגישה [מחוז]" },
];
const MEETINGS_DONE_COLUMNS = [
  { key: "meetings_completed",  label: 'סה"כ פגישות שבוצעו' },
  { key: "meetings_hours",      label: 'סה"כ שעות שבוצעו' },
  ...MEETING_TYPE_BREAKDOWN_COLUMNS.map(c => ({ key: c.key, label: c.label })),
];

const MOVABLE_COLUMNS = [...GENERAL_COLUMNS, ...ALLOCATION_COLUMNS, ...MEETINGS_DONE_COLUMNS];

// New MOVABLE_COLUMNS keys added after users may already have saved col prefs — must be
// back-filled into a restored colOrder/colVisible (see effect below), like the other
// late-added column groups.
const NEWLY_ADDED_MOVABLE_COLUMNS = [
  { key: "district",         label: "מחוז" },
  { key: "finance_software", label: "תוכנת כספים" },
];

// Optional columns showing summary data from the last real check run (check_metrics),
// for the "active" budget (default "גפן", overridden when exactly one budget type is
// selected in the advanced filter). Off by default — see colVisible init below.
const SUMMARY_COLUMNS = [
  { key: "summary_budget_amount",           label: "גובה תקציב",                     field: "budget_amount",           fmt: "money" },
  { key: "summary_planned_amount",           label: "סכום שתוכנן",                    field: "planned_amount",          fmt: "money" },
  { key: "summary_pct_plan",                 label: "אחוז תכנון",                     field: "pct_plan",                fmt: "pct"   },
  { key: "summary_fixed_gap_abs",            label: "נותר לתכנון קבוע",                field: "fixed_gap_abs",           fmt: "money" },
  { key: "summary_flexible_remaining",       label: "נותר לתכנון גמיש",                field: "flexible_remaining",      fmt: "money" },
  { key: "summary_sum_chayav",               label: "סכום חייב בדיווח",                field: "sum_chayav",              fmt: "money" },
  { key: "summary_sum_divuach",              label: "סכום שדווח",                     field: "sum_divuach",             fmt: "money" },
  { key: "summary_pct_divuach",              label: "אחוז דיווח כללי",                 field: "pct_divuach",             fmt: "pct"   },
  { key: "summary_pct_tanuz",                label: "אחוז דיווח למודל תמרוץ",          field: "pct_tanuz",               fmt: "pct"   },
  { key: "summary_rejected_count",           label: "אסמכתאות שנדחו כמות",             field: "rejected_count",          fmt: "int"   },
  { key: "summary_rejected_sum",             label: "אסמכתאות שנדחו סכום",             field: "rejected_sum",            fmt: "money" },
  { key: "summary_no_pdf_count",             label: "ללא PDF כמות",                    field: "no_pdf_count",            fmt: "int"   },
  { key: "summary_no_pdf_sum",               label: "ללא PDF סכום",                    field: "no_pdf_sum",              fmt: "money" },
  { key: "summary_partial_count",            label: "דיווח חסר כמות תוכניות",          field: "partial_count",           fmt: "int"   },
  { key: "summary_partial_sum",              label: "דיווח חסר סכום",                 field: "partial_sum",             fmt: "money" },
  { key: "summary_finance_not_gefen_count",  label: "קיים בכספים לא בגפן כמות",        field: "finance_not_gefen_count", fmt: "int"   },
  { key: "summary_finance_not_gefen_sum",    label: "קיים בכספים לא בגפן סכום",        field: "finance_not_gefen_sum",   fmt: "money" },
  { key: "summary_gefen_not_finance_count",  label: "קיים בגפן לא בכספים כמות",        field: "gefen_not_finance_count", fmt: "int"   },
  { key: "summary_gefen_not_finance_sum",    label: "קיים בגפן לא בכספים סכום",        field: "gefen_not_finance_sum",   fmt: "money" },
];

// "סגירת שנה" columns — closure status/notes toward parents and toward the authority, per
// school+academic_year (school_year_admin_data). Grouped under the "בדיקות" column-picker
// category (at the end), like SUMMARY_COLUMNS, but not part of SUMMARY_COLUMNS itself since
// they're flat per-school fields, not per-division/budget — they must never trigger the
// "split into one row per budget combo" behavior that a visible SUMMARY_COLUMNS column does.
const CLOSURE_COLUMNS = [
  { key: "closure_parents_status",   label: "סגירת שנה-הורים",       field: "closure_parents_status",   fmt: "closure" },
  { key: "closure_parents_notes",    label: "הערות סגירה-הורים",     field: "closure_parents_notes",    fmt: "text"     },
  { key: "closure_authority_status", label: "סגירת שנה-רשות",        field: "closure_authority_status", fmt: "closure" },
  { key: "closure_authority_notes",  label: "הערות סגירה-רשות",      field: "closure_authority_notes",  fmt: "text"     },
];

// "מכתב בקרה" columns — one fixed row per division_type (school_id, division). A school
// may have up to 2 rows (שש-שנתי); the single value shown here is picked by
// pickPrimaryControlLetter (open status first, otherwise most recent received_date).
const CONTROL_LETTER_COLUMNS = [
  { key: "control_letter_received_date",  label: "מכתב בקרה - תאריך קבלה",   field: "received_date",             fmt: "date" },
  { key: "control_letter_days_to_answer", label: "מכתב בקרה - ימים לתשובה",  field: "days_to_answer",            fmt: "int"  },
  { key: "control_letter_target_date",    label: "מכתב בקרה - תאריך יעד",    field: "target_date",               fmt: "date" },
  { key: "control_letter_status",         label: "מכתב בקרה - סטטוס",        field: "status",                    fmt: "controlLetterStatus" },
  { key: "control_letter_notes",          label: "מכתב בקרה - הערות",        field: "notes",                     fmt: "text" },
  { key: "control_letter_original_file",  label: "מכתב בקרה - מכתב מקורי",   field: "original_letter_file_name", fmt: "file" },
  { key: "control_letter_response_file",  label: "מכתב בקרה - מכתב תשובה",   field: "response_letter_file_name", fmt: "file" },
];

const DEFAULT_VISIBLE_MOVABLE_KEYS = ["symbol", "stage", "city", "meetings_completed", "authority", "meetings_hours"];

const ALL_COLUMNS = [...MOVABLE_COLUMNS, ...SUMMARY_COLUMNS, ...CLOSURE_COLUMNS, ...CONTROL_LETTER_COLUMNS];
const DEFAULT_COL_ORDER = ALL_COLUMNS.map(c => c.key);

// Goal columns ("goal_<goalKey>") are built dynamically from an async-loaded endpoint, so
// they can never be part of the static DEFAULT_COL_ORDER — saved col_order/col_visible
// validation accepts them by prefix instead of requiring an exact DEFAULT_COL_ORDER match.
function isKnownColumnKey(k) {
  return DEFAULT_COL_ORDER.includes(k) || (typeof k === "string" && k.startsWith("goal_"));
}

// Columns that get the Excel-style header filter/sort icon — every SUMMARY_COLUMNS entry
// plus the two numeric MOVABLE_COLUMNS ("hours" is a distinct fmt: raw value is minutes,
// user-facing input/comparisons are done in decimal hours).
const FILTER_COLUMN_META = [
  { key: "meetings_completed", label: 'סה"כ פגישות שבוצעו', fmt: "int" },
  { key: "meetings_hours", label: 'סה"כ שעות שבוצעו', fmt: "hours" },
  ...MEETING_TYPE_BREAKDOWN_COLUMNS.map(c => ({
    key: c.key, label: c.label, fmt: c.breakdownMetric === "completed" ? "int" : "hours",
  })),
  ...SUMMARY_COLUMNS,
  { key: "closure_parents_status",   label: "סגירת שנה-הורים", fmt: "closure" },
  { key: "closure_authority_status", label: "סגירת שנה-רשות",  fmt: "closure" },
  { key: "meeting_allocation_gefen",    label: "הקצאת פגישות [גפן]",  fmt: "int" },
  { key: "meeting_allocation_current",  label: "הקצאת פגישות [שוטף]", fmt: "int" },
  { key: "meeting_allocation_district", label: "הקצאת פגישות [מחוז]", fmt: "int" },
  { key: "meeting_duration_gefen",      label: "הקצאת זמן פגישה [גפן]",   fmt: "hours" },
  { key: "meeting_duration_current",    label: "הקצאת זמן פגישה [שוטף]",  fmt: "hours" },
  { key: "meeting_duration_district",   label: "הקצאת זמן פגישה [מחוז]",  fmt: "hours" },
  { key: "control_letter_received_date",  label: "מכתב בקרה - תאריך קבלה",  fmt: "date" },
  { key: "control_letter_target_date",    label: "מכתב בקרה - תאריך יעד",   fmt: "date" },
  { key: "control_letter_days_to_answer", label: "מכתב בקרה - ימים לתשובה", fmt: "int"  },
  { key: "control_letter_status",         label: "מכתב בקרה - סטטוס",       fmt: "controlLetterStatus" },
];
const FILTER_COLUMN_KEYS = new Set(FILTER_COLUMN_META.map(c => c.key));

// Non-empty status values in a fixed order, used to ordinally encode control_letter_status
// for sort/filter (like closure/goal columns' true/false/null → 2/1/0 encoding) — the empty
// "בחר" placeholder is never a real value, so it's excluded and maps to blank (null) instead.
const CONTROL_LETTER_STATUS_FILTER_ORDER = CONTROL_LETTER_STATUS_OPTIONS.filter(o => o.value).map(o => o.value);

function dateToNum(iso) {
  if (!iso) return null;
  const n = Number(iso.replaceAll("-", ""));
  return Number.isNaN(n) ? null : n;
}

function numToISO(n) {
  const s = String(n).padStart(8, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const NUMBER_FILTER_OPERATORS = [
  { op: "eq", label: "שווה ל..." },
  { op: "ne", label: "לא שווה ל..." },
  { op: "gt", label: "גדול מ..." },
  { op: "gte", label: "גדול או שווה ל..." },
  { op: "lt", label: "קטן מ..." },
  { op: "lte", label: "קטן או שווה ל..." },
];
const OPERATOR_LABEL = Object.fromEntries(NUMBER_FILTER_OPERATORS.map(o => [o.op, o.label]));

function fmtMoney(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("he-IL");
}

function fmtPct2(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtInt(v) {
  if (v === null || v === undefined) return "—";
  return String(v);
}

// Resolves which check_metrics row backs a summary column for a given school row —
// the combo itself when the row is already split by division/budget, otherwise the
// entry matching the active budget (default "גפן", or the single selected filter budget).
function getSummaryMetricsRow(school, combo, activeSummaryBudget) {
  if (combo) return combo;
  return (school.check_metrics || []).find(m => m.budget_name === activeSummaryBudget) || null;
}

function renderSummaryValue(school, colDef, combo, activeSummaryBudget, emptyValue) {
  const row = getSummaryMetricsRow(school, combo, activeSummaryBudget);
  const v = row ? row[colDef.field] : undefined;
  if (colDef.fmt === "pct") return v === null || v === undefined ? emptyValue : fmtPct2(v);
  if (colDef.fmt === "int") return v === null || v === undefined ? emptyValue : fmtInt(v);
  return v === null || v === undefined ? emptyValue : fmtMoney(v);
}

function formatMeetingHours(totalMinutes) {
  if (!totalMinutes || totalMinutes === 0) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} דק'`;
  if (m === 0) return `${h} שעות`;
  return `${h}:${String(m).padStart(2, "0")} שעות`;
}

function formatFilterValueLabel(raw, fmt) {
  if (fmt === "goal") return raw === 2 ? "כן" : raw === 1 ? "לא" : "טרם הוגדר";
  if (fmt === "closure") return raw === 2 ? "סגור" : raw === 1 ? "לא סגור" : "טרם סומן";
  if (fmt === "controlLetterStatus") {
    const value = CONTROL_LETTER_STATUS_FILTER_ORDER[raw - 1];
    return CONTROL_LETTER_STATUS_MAP[value]?.label || "";
  }
  if (fmt === "date") return raw ? formatDDMMYY(numToISO(raw)) : "";
  if (fmt === "hours") return formatMeetingHours(raw);
  if (fmt === "pct") return fmtPct2(raw);
  if (fmt === "int") return fmtInt(raw);
  return fmtMoney(raw);
}

// Resolves a goal's met/not-met/unset status for a school row — same lookup evalGoalConditions
// already uses (school.goal_statuses is a flat array scoped by division_type+budget_name),
// so goal columns stay consistent with the existing "סינון לפי יעד" advanced-filter behavior
// and with the manually-toggled "כן"/"לא" values from the school's "יעדים" tab.
function getGoalStatus(school, combo, goalKey, activeSummaryBudget) {
  const budgetName = combo ? combo.budget_name : activeSummaryBudget;
  const divisionType = combo ? combo.division_type : null;
  const statuses = school.goal_statuses || [];
  const findWithBudget = want => statuses.find(g =>
    g.goal_key === goalKey &&
    g.budget_name === want &&
    (divisionType === null || g.division_type === divisionType)
  );
  // Schools with no check/budget history yet used to have their goal saved under an empty
  // budget_name (a GoalsTab bug, now fixed to default to "גפן" like everywhere else) — fall
  // back to that legacy blank value so goals saved before the fix still display correctly.
  const entry = findWithBudget(budgetName) || findWithBudget("");
  return entry ? entry.met : null;
}

// One raw numeric value per filterable column, uniformly (school.check_metrics/combo
// for the 19 SUMMARY_COLUMNS, meetingsStats for the 2 movable ones, goal_statuses for the
// dynamic goal columns) — computed once per row so filtering/sorting/value-list logic never
// needs to know where a value comes from. Goal columns are ordinally encoded (0=טרם הוגדר,
// 1=לא, 2=כן) for sort — never null, since "not yet set" is itself a valid distinct state.
function computeFilterValues(school, combo, meetingsStats, activeSummaryBudget, goalColumns = []) {
  const out = {};
  const stats = meetingsStats[school.id];
  out.meetings_completed = stats ? stats.completed ?? null : null;
  out.meetings_hours = stats ? stats.total_minutes ?? null : null;
  for (const col of MEETING_TYPE_BREAKDOWN_COLUMNS) {
    const bucket = stats?.by_type?.[col.breakdownType];
    out[col.key] = bucket ? bucket[col.breakdownMetric] ?? null : null;
  }
  const metricsRow = getSummaryMetricsRow(school, combo, activeSummaryBudget);
  for (const col of SUMMARY_COLUMNS) {
    const v = metricsRow ? metricsRow[col.field] : undefined;
    out[col.key] = v === undefined ? null : v;
  }
  for (const gc of goalColumns) {
    const met = getGoalStatus(school, combo, gc.goalKey, activeSummaryBudget);
    out[gc.key] = met === true ? 2 : met === false ? 1 : 0;
  }
  const closure = school.year_closure || {};
  out.closure_parents_status = closure.closure_parents_status === true ? 2 : closure.closure_parents_status === false ? 1 : 0;
  out.closure_authority_status = closure.closure_authority_status === true ? 2 : closure.closure_authority_status === false ? 1 : 0;
  for (const k of ["meeting_allocation_gefen", "meeting_allocation_current", "meeting_allocation_district",
                    "meeting_duration_gefen", "meeting_duration_current", "meeting_duration_district"]) {
    out[k] = closure[k] ?? null;
  }
  out.control_letter_received_date = dateToNum(controlLetterFieldValue(school, "received_date"));
  out.control_letter_target_date = dateToNum(controlLetterFieldValue(school, "target_date"));
  out.control_letter_days_to_answer = controlLetterFieldValue(school, "days_to_answer");
  const clStatus = controlLetterFieldValue(school, "status");
  out.control_letter_status = clStatus ? CONTROL_LETTER_STATUS_FILTER_ORDER.indexOf(clStatus) + 1 : null;
  return out;
}

// Converts what the user typed in a filter-value input into the raw unit the column is
// stored in: "pct" columns store a 0-1 fraction (user types a percent, e.g. 75 → 0.75),
// "hours" columns store raw minutes (user types decimal hours, e.g. 5.5 → 330).
function parseFilterInput(rawInput, fmt) {
  if (rawInput === "" || rawInput === null || rawInput === undefined) return null;
  if (fmt === "date") return dateToNum(String(rawInput));
  const n = Number(String(rawInput).replace(/,/g, "").trim());
  if (Number.isNaN(n)) return null;
  if (fmt === "pct") return n / 100;
  if (fmt === "hours") return n * 60;
  return n;
}

function evalCond(numericValue, cond, fmt) {
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

function passesOneColumnFilter(rawValue, spec, fmt) {
  if (!spec) return true;
  const isBlank = rawValue === null || rawValue === undefined;
  if (spec.mode === "values") {
    if (isBlank) return spec.selected.includes("__BLANK__");
    return spec.selected.includes(String(rawValue));
  }
  // mode === "custom" — blanks never satisfy a numeric operator
  if (isBlank) return false;
  const r1 = evalCond(rawValue, spec.cond1, fmt);
  const r2 = evalCond(rawValue, spec.cond2, fmt);
  return spec.joiner === "OR" ? (r1 || r2) : (r1 && r2);
}

function passesAllColumnFilters(row, columnFilters, metaList, excludeKey = null) {
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
function buildRowComparator(sortSpecs) {
  return (a, b) => {
    for (const { key, dir } of sortSpecs) {
      const va = a.filterValues[key];
      const vb = b.filterValues[key];
      const aBlank = va === null || va === undefined;
      const bBlank = vb === null || vb === undefined;
      if (aBlank && bBlank) continue;
      if (aBlank) return 1;
      if (bBlank) return -1;
      if (va === vb) continue;
      const cmp = va < vb ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}

// Excel-style header filter/sort icon + dropdown menu for one numeric column. Owns its
// own transient UI state (search text, custom-filter dialog draft) but reads/writes the
// shared columnFilters/sortSpecs state passed down from DashboardPage so multiple columns
// combine correctly (AND across filters, stacked multi-column sort).
function ColumnHeaderFilter({ colDef, columnFilters, setColumnFilters, sortSpecs, setSortSpecs, openKey, setOpenKey, baseDisplayRows, allFilterMeta }) {
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

  // A stale menu detached from its anchor is worse than a closed one — dismiss on any scroll
  // (page or the table's own horizontal/vertical scroll container).
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
    for (const row of rowsPassingOthers) {
      const raw = row.filterValues[key];
      if (raw === null || raw === undefined) { hasBlank = true; continue; }
      const k = String(raw);
      if (!seen.has(k)) seen.set(k, { value: k, raw, label: formatFilterValueLabel(raw, fmt) });
    }
    const list = [...seen.values()].sort((a, b) => a.raw - b.raw);
    if (hasBlank) list.push({ value: "__BLANK__", raw: null, label: "(ריקים)" });
    return list;
  }, [isOpen, baseDisplayRows, columnFilters, allFilterMeta, key, fmt]);

  useEffect(() => {
    if (!isOpen) return;
    if (spec?.mode === "values") setDraftSelected(spec.selected);
    else setDraftSelected(distinctValues.map(v => v.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, distinctValues]);

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
    setDraftSelected(distinctValues.map(v => v.value));
    setCustomCond1({ op: "eq", value: "" });
    setCustomJoiner("AND");
    setCustomCond2({ op: "eq", value: "" });
  }

  function toggleValue(v) {
    setDraftSelected(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  const filteredDistinctValues = distinctValues.filter(v =>
    v.value === "__BLANK__" || !searchQuery.trim() || v.label.includes(searchQuery.trim())
  );

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
      if (draftSelected.length === distinctValues.length) delete next[key];
      else next[key] = { mode: "values", selected: draftSelected };
      return next;
    });
    setOpenKey(null);
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

  const valuePlaceholder = fmt === "pct" ? "%" : fmt === "hours" ? "שעות" : "ערך";

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
                  מיין מהקטן לגדול
                </button>
                <button type="button" onClick={() => applySort("desc")} className="w-full flex items-center gap-2 text-right px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50">
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                  מיין מהגדול לקטן
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
                    {fmt === "date" ? "מסנני תאריכים" : "מסנני מספרים"}
                    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: numberFiltersOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  {numberFiltersOpen && (
                    <div className="pb-1">
                      {NUMBER_FILTER_OPERATORS.map(o => (
                        <button key={o.op} type="button" onClick={() => openCustomDialog(o.op)} className="w-full text-right px-5 py-1.5 text-sm text-slate-600 hover:bg-blue-50">
                          {o.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => openCustomDialog("between")} className="w-full text-right px-5 py-1.5 text-sm text-slate-600 hover:bg-blue-50">
                        בין...
                      </button>
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
                  {NUMBER_FILTER_OPERATORS.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                <input type={fmt === "date" ? "date" : "text"} value={customCond1.value} onChange={e => setCustomCond1(c => ({ ...c, value: e.target.value }))} className="input-field text-xs flex-1" placeholder={valuePlaceholder} aria-label="ערך תנאי 1" />
              </div>
              <div className="inline-flex self-center rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold" style={{ direction: "ltr" }}>
                <button type="button" onClick={() => setCustomJoiner("AND")} className={`px-3 py-1 transition-colors ${customJoiner === "AND" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>וגם</button>
                <button type="button" onClick={() => setCustomJoiner("OR")} className={`px-3 py-1 border-r border-slate-200 transition-colors ${customJoiner === "OR" ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>או</button>
              </div>
              <div className="flex items-center gap-1.5">
                <select value={customCond2.op} onChange={e => setCustomCond2(c => ({ ...c, op: e.target.value }))} className="input-field text-xs flex-shrink-0" style={{ width: 120 }} aria-label="אופרטור תנאי 2">
                  {NUMBER_FILTER_OPERATORS.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                <input type={fmt === "date" ? "date" : "text"} value={customCond2.value} onChange={e => setCustomCond2(c => ({ ...c, value: e.target.value }))} className="input-field text-xs flex-1" placeholder={valuePlaceholder} aria-label="ערך תנאי 2" />
              </div>
              {fmt === "hours" && <p className="text-xs text-slate-400">לדוגמה: 5.5 (5 שעות ו-30 דק')</p>}
              {fmt === "pct" && <p className="text-xs text-slate-400">הזן אחוז, לדוגמה: 75</p>}
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

function formatDDMMYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

// Calendar-day addition (not business days) — received_date + days_to_answer.
function addDaysISO(iso, days) {
  if (!iso || days === null || days === undefined || days === "") return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Number(days));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// A school may have up to 2 control_letters rows (one per division, שש-שנתי). The dashboard/
// admin tables show a single value per school: prefer a row whose status is still "open"
// (בתהליך/בעיה/תיקון נוסף), otherwise the row with the most recent received_date.
function pickPrimaryControlLetter(rows) {
  if (!rows || rows.length === 0) return null;
  const openStatuses = new Set(["in_progress", "problem", "further_fix"]);
  const open = rows.filter(r => openStatuses.has(r.status));
  const pool = open.length ? open : rows;
  return pool.reduce((latest, r) => {
    if (!latest) return r;
    if (!r.received_date) return latest;
    if (!latest.received_date) return r;
    return r.received_date > latest.received_date ? r : latest;
  }, null);
}

function controlLetterFieldValue(school, field) {
  const primary = pickPrimaryControlLetter(school.control_letters);
  if (!primary) return null;
  if (field === "target_date") return addDaysISO(primary.received_date, primary.days_to_answer);
  return primary[field] ?? null;
}

function renderClosureStatusBadge(value) {
  if (value === true) return <span className="text-green-600 font-semibold">סגור</span>;
  if (value === false) return <span className="text-red-600 font-semibold">לא סגור</span>;
  return "—";
}

function meetingBreakdownValue(school, key, meetingsStats, emptyText) {
  const col = MEETING_TYPE_BREAKDOWN_COL_META[key];
  if (!col) return undefined;
  const bucket = meetingsStats[school.id]?.by_type?.[col.breakdownType];
  if (!bucket) return emptyText;
  return col.breakdownMetric === "completed"
    ? String(bucket.completed ?? 0)
    : formatMeetingHours(bucket.total_minutes ?? 0);
}

function renderCell(school, key, meetingsStats = {}, combo = null, activeSummaryBudget = "גפן", goalColumnsByKey = {}) {
  const summaryCol = SUMMARY_COLUMNS.find(c => c.key === key);
  if (summaryCol) return renderSummaryValue(school, summaryCol, combo, activeSummaryBudget, "—");
  const breakdown = meetingBreakdownValue(school, key, meetingsStats, "—");
  if (breakdown !== undefined) return breakdown;
  if (goalColumnsByKey[key]) {
    const met = getGoalStatus(school, combo, goalColumnsByKey[key], activeSummaryBudget);
    return met === true ? "כן" : met === false ? "לא" : "טרם הוגדר";
  }
  const closure = school.year_closure || {};
  switch (key) {
    case "closure_parents_status":
      return renderClosureStatusBadge(closure.closure_parents_status);
    case "closure_authority_status":
      return renderClosureStatusBadge(closure.closure_authority_status);
    case "closure_parents_notes":
    case "closure_authority_notes": {
      const text = closure[key] || "";
      if (!text) return "—";
      const truncated = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      return <span title={text}>{truncated}</span>;
    }
    case "meeting_allocation_gefen": case "meeting_allocation_current": case "meeting_allocation_district":
      return closure[key] ?? "—";
    case "meeting_duration_gefen": case "meeting_duration_current": case "meeting_duration_district":
      return formatMeetingHours(closure[key]);
    default: break;
  }
  switch (key) {
    case "control_letter_received_date": case "control_letter_target_date": {
      const iso = controlLetterFieldValue(school, key === "control_letter_target_date" ? "target_date" : "received_date");
      return iso ? formatDDMMYY(iso) : "—";
    }
    case "control_letter_days_to_answer": {
      const v = controlLetterFieldValue(school, "days_to_answer");
      return v ?? "—";
    }
    case "control_letter_status": {
      const v = controlLetterFieldValue(school, "status");
      const s = CONTROL_LETTER_STATUS_MAP[v || ""] || CONTROL_LETTER_STATUS_MAP[""];
      if (!v) return "—";
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} aria-hidden="true" />
          {s.label}
        </span>
      );
    }
    case "control_letter_notes": {
      const text = controlLetterFieldValue(school, "notes") || "";
      if (!text) return "—";
      const truncated = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      return <span title={text}>{truncated}</span>;
    }
    case "control_letter_original_file":
      return controlLetterFieldValue(school, "original_letter_file_name") || "—";
    case "control_letter_response_file":
      return controlLetterFieldValue(school, "response_letter_file_name") || "—";
    default: break;
  }
  switch (key) {
    case "advisor_gefen":
      return (school.advisors_gefen || []).map(p => p.full_name || p.email).join(", ") || "—";
    case "advisor_current":
      return (school.advisors_current || []).map(p => p.full_name || p.email).join(", ") || "—";
    case "advisor_district":
      return (school.advisors_district || []).map(p => p.full_name || p.email).join(", ") || "—";
    case "symbol":
      return <span className="font-mono">{school.symbol || "—"}</span>;
    case "city":
      return school.city || "—";
    case "authority":
      return school.authority || "—";
    case "district":
      return school.district || "—";
    case "finance_software":
      return FINANCE_SOFTWARE_LABEL[school.finance_software] || school.finance_software || "—";
    case "stage":
      return SCHOOL_STAGE_LABEL[school.stage] || school.stage || "—";
    case "meetings_completed": {
      const s = meetingsStats[school.id];
      return s ? String(s.completed) : "—";
    }
    case "meetings_hours": {
      const s = meetingsStats[school.id];
      return s ? formatMeetingHours(s.total_minutes) : "—";
    }
    default:
      return "—";
  }
}

function renderCellText(school, key, meetingsStats = {}, combo = null, activeSummaryBudget = "גפן", goalColumnsByKey = {}) {
  const summaryCol = SUMMARY_COLUMNS.find(c => c.key === key);
  if (summaryCol) return renderSummaryValue(school, summaryCol, combo, activeSummaryBudget, "");
  const breakdown = meetingBreakdownValue(school, key, meetingsStats, "");
  if (breakdown !== undefined) return breakdown;
  if (goalColumnsByKey[key]) {
    const met = getGoalStatus(school, combo, goalColumnsByKey[key], activeSummaryBudget);
    return met === true ? "כן" : met === false ? "לא" : "טרם הוגדר";
  }
  const closure = school.year_closure || {};
  switch (key) {
    case "closure_parents_status":
      return closure.closure_parents_status === true ? "סגור" : closure.closure_parents_status === false ? "לא סגור" : "";
    case "closure_authority_status":
      return closure.closure_authority_status === true ? "סגור" : closure.closure_authority_status === false ? "לא סגור" : "";
    case "closure_parents_notes":
    case "closure_authority_notes":
      return closure[key] || "";
    case "meeting_allocation_gefen": case "meeting_allocation_current": case "meeting_allocation_district":
      return closure[key] ?? "";
    case "meeting_duration_gefen": case "meeting_duration_current": case "meeting_duration_district":
      return closure[key] ? formatMeetingHours(closure[key]) : "";
    default: break;
  }
  switch (key) {
    case "control_letter_received_date": case "control_letter_target_date": {
      const iso = controlLetterFieldValue(school, key === "control_letter_target_date" ? "target_date" : "received_date");
      return iso ? formatDDMMYY(iso) : "";
    }
    case "control_letter_days_to_answer": {
      const v = controlLetterFieldValue(school, "days_to_answer");
      return v === null || v === undefined ? "" : String(v);
    }
    case "control_letter_status": {
      const v = controlLetterFieldValue(school, "status");
      return v ? (CONTROL_LETTER_STATUS_MAP[v]?.label || v) : "";
    }
    case "control_letter_notes":
      return controlLetterFieldValue(school, "notes") || "";
    case "control_letter_original_file":
      return controlLetterFieldValue(school, "original_letter_file_name") || "";
    case "control_letter_response_file":
      return controlLetterFieldValue(school, "response_letter_file_name") || "";
    default: break;
  }
  switch (key) {
    case "advisor_gefen":
      return (school.advisors_gefen || []).map(p => p.full_name || p.email).join(", ") || "";
    case "advisor_current":
      return (school.advisors_current || []).map(p => p.full_name || p.email).join(", ") || "";
    case "advisor_district":
      return (school.advisors_district || []).map(p => p.full_name || p.email).join(", ") || "";
    case "symbol":
      return school.symbol || "";
    case "city":
      return school.city || "";
    case "authority":
      return school.authority || "";
    case "district":
      return school.district || "";
    case "finance_software":
      return FINANCE_SOFTWARE_LABEL[school.finance_software] || school.finance_software || "";
    case "stage":
      return SCHOOL_STAGE_LABEL[school.stage] || school.stage || "";
    case "meetings_completed": {
      const s = meetingsStats[school.id];
      return s ? String(s.completed) : "";
    }
    case "meetings_hours": {
      const s = meetingsStats[school.id];
      return s ? formatMeetingHours(s.total_minutes) : "";
    }
    default:
      return "";
  }
}

function applyFilters(school, filters, queries) {
  // For a single-value field: chips = exact match; no chips = partial text match on query
  const matchText = (selected, query, rawValue, labelValue) => {
    if (selected.length > 0) return selected.some(f => f.value === (rawValue || ""));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return (rawValue || "").toLowerCase().includes(q) ||
             (labelValue || "").toLowerCase().includes(q);
    }
    return true;
  };

  if (!matchText(filters.names,           queries.names,           school.name)) return false;
  if (!matchText(filters.symbols,         queries.symbols,         school.symbol)) return false;
  if (!matchText(filters.stages,          queries.stages,          school.stage,            SCHOOL_STAGE_LABEL[school.stage])) return false;
  if (!matchText(filters.cities,          queries.cities,          school.city)) return false;
  if (!matchText(filters.authorities,     queries.authorities,     school.authority)) return false;
  if (!matchText(filters.financeSoftwares,queries.financeSoftwares,school.finance_software, FINANCE_SOFTWARE_LABEL[school.finance_software])) return false;
  if (!matchText(filters.addresses,       queries.addresses,       school.address)) return false;
  if (!matchText(filters.principals,      queries.principals,      school.principal_name)) return false;
  if (!matchText(filters.secretaries,     queries.secretaries,     school.secretary_name)) return false;
  if (!matchText(filters.financeContacts, queries.financeContacts, school.finance_contact_name)) return false;

  // Divisions — array field
  const divValues = (school.gefen_accounts || []).map(a => a.division_type);
  if (filters.divisions.length > 0) {
    if (!filters.divisions.some(f => divValues.includes(f.value))) return false;
  } else if (queries.divisions.trim()) {
    const q = queries.divisions.trim().toLowerCase();
    if (!divValues.some(v => (DIVISION_LABEL[v] || v).toLowerCase().includes(q))) return false;
  }

  // Advisors — compare by UUID, per service type (school_advisors_gefen/current/district)
  const advisorGefenIds = (school.advisors_gefen || []).map(a => a.id);
  if (filters.advisorGefen.length > 0 && !filters.advisorGefen.some(f => advisorGefenIds.includes(f.value))) return false;
  const advisorCurrentIds = (school.advisors_current || []).map(a => a.id);
  if (filters.advisorCurrent.length > 0 && !filters.advisorCurrent.some(f => advisorCurrentIds.includes(f.value))) return false;
  const advisorDistrictIds = (school.advisors_district || []).map(a => a.id);
  if (filters.advisorDistrict.length > 0 && !filters.advisorDistrict.some(f => advisorDistrictIds.includes(f.value))) return false;

  // Access (גישה) — null=open to all; specific UUID=restricted access
  // "כולם" option matches schools with null (open to all)
  // Specific advisor matches schools open to all (null) OR with that advisor explicitly listed
  if (filters.accessAdvisors.length > 0) {
    const rat = school.restrict_access_to;
    const isOpenToAll = rat === null || rat === undefined;
    const allSelected = filters.accessAdvisors.some(f => f.value === "__all__");
    const specificAdvisors = filters.accessAdvisors.filter(f => f.value !== "__all__");
    const matchesAll = allSelected && isOpenToAll;
    const matchesSpecific = specificAdvisors.length > 0 && (
      isOpenToAll || specificAdvisors.some(f => Array.isArray(rat) && rat.includes(f.value))
    );
    if (!matchesAll && !matchesSpecific) return false;
  }

  return true;
}

function RecycleBinInfoModal({ count, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
         role="dialog" aria-modal="true" aria-labelledby="recycle-modal-title">
      <div ref={ref} onKeyDown={handleKeyDown}
           className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4 text-right" dir="rtl">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🗑️</span>
          <h2 id="recycle-modal-title" className="text-lg font-bold text-slate-900">הועברו לסל המחזור</h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">
          {count === 1 ? "בית הספר הועבר לסל המחזור" : `${count} בתי ספר הועברו לסל המחזור`}
          {" "}ונתוניהם יימחקו לחלוטין מהמערכת תוך 30 יום.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          לשחזור ניתן לבצע זאת בפרק הזמן הזה בלבד דרך אזור{" "}
          <span className="font-medium">ניהול ← בתי ספר ← סל מחזור</span>.
        </p>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} autoFocus
            className="px-6 py-2 rounded-xl text-sm font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors">
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ title, subtitle, message, onConfirm, onCancel, confirming }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
      >
        <div>
          <h2 id="delete-modal-title" className="font-bold text-slate-900 text-lg">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="text-sm px-5 py-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#dc2626" }}
          >
            {confirming ? "מוחק..." : "מחק בכל זאת"}
          </button>
          <button onClick={onCancel} disabled={confirming} className="btn-ghost text-sm px-5 py-2">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

function AccessSelector({ restrictTo, users, loadingUsers, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Owners always have full access — exclude them from the selector
  const nonOwnerUsers = users.filter(u => u.role !== "owner");

  const isAll = restrictTo === null || restrictTo === undefined;
  // Also strip any owner IDs that may exist in stored data
  const selected = (restrictTo || []).filter(id => nonOwnerUsers.some(u => u.id === id));

  return (
    <div
      ref={containerRef}
      className="relative"
      onFocus={() => setOpen(true)}
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <div
        className="input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer"
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
          const u = nonOwnerUsers.find(u => u.id === id);
          return u ? (
            <span key={id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
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
        {!isAll && (
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
            <label htmlFor="access-selector-search-dash" className="sr-only">חיפוש</label>
            <input
              id="access-selector-search-dash"
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
            {sortByRole(loadingUsers ? [] : nonOwnerUsers)
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
                  <span className={`w-4 h-4 rounded border flex-shrink-0 ${selected.includes(u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                  {u.full_name || u.email}
                  <span className="text-xs text-slate-400 mr-auto">{ROLE_LABELS[u.role]}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BulkAccessModal({ schools, users, loadingUsers, onClose, onSaved }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  // If every selected school currently shares the exact same restrict_access_to, prefill it.
  // Otherwise default to "כולם" (null) rather than an arbitrary value.
  const initialValue = useMemo(() => {
    if (schools.length === 0) return null;
    const normalize = v => (v === null || v === undefined ? null : [...v].sort());
    const first = normalize(schools[0].restrict_access_to);
    const allSame = schools.every(s => JSON.stringify(normalize(s.restrict_access_to)) === JSON.stringify(first));
    return allSame ? first : null;
  }, [schools]);

  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    // Sent sequentially, not via Promise.all/allSettled — the backend shares a single
    // Supabase httpx client singleton per process (see CLAUDE.md Architecture Invariant #8),
    // and firing many PUTs at once against it caused every single one to fail together.
    let failed = 0;
    for (const s of schools) {
      try {
        await axios.put(`/schools/${s.id}`, { name: s.name, restrict_access_to: value });
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      setError(`העדכון נכשל עבור ${failed} מתוך ${schools.length} בתי ספר. נסה שוב.`);
      setSaving(false);
      return;
    }
    await onSaved();
    setSaving(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-access-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
      >
        <div>
          <h2 id="bulk-access-modal-title" className="font-bold text-slate-900 text-lg">עריכת גישה</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {schools.length === 1 ? "1 בית ספר מסומן" : `${schools.length} בתי ספר מסומנים`}
          </p>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          הבחירה למטה תחליף את הגדרת הגישה הקיימת בכל בתי הספר המסומנים.
        </p>
        <AccessSelector restrictTo={value} users={users} loadingUsers={loadingUsers} onChange={setValue} />
        {error && (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-blue text-sm px-5 py-2 disabled:opacity-60"
          >
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
          <button onClick={onClose} disabled={saving} className="btn-ghost text-sm px-5 py-2">
            ביטול
          </button>
        </div>
        {saving && (
          <span role="status" aria-label="שומר שינויי גישה" className="sr-only">שומר שינויים</span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [schools, setSchools] = useState([]);
  const [allOrgUsers, setAllOrgUsers] = useState([]);
  const [meetingsStats, setMeetingsStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [queries, setQueries] = useState(EMPTY_QUERIES);
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [budgetTypes, setBudgetTypes] = useState([]);
  const [goalConditions, setGoalConditions] = useState([]);
  const [goalDefinitions, setGoalDefinitions] = useState([]);
  const [openSections, setOpenSections] = useState({ main: true, goals: false });
  const [columnFilters, setColumnFilters] = useState({}); // {[colKey]: FilterSpec}
  const [sortSpecs, setSortSpecs] = useState([]); // [{key,dir}], index 0 = primary (most-recently clicked)
  const [openColFilterKey, setOpenColFilterKey] = useState(null); // only one column's filter menu open at a time
  const didMountAcademicYearRef = useRef(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filtersPersistKey, setFiltersPersistKey] = useState(null);
  const [colOrder, setColOrder] = useState(DEFAULT_COL_ORDER);
  const [colVisible, setColVisible] = useState(() => ({
    ...Object.fromEntries(MOVABLE_COLUMNS.map(c => [c.key, DEFAULT_VISIBLE_MOVABLE_KEYS.includes(c.key)])),
    ...Object.fromEntries(SUMMARY_COLUMNS.map(c => [c.key, false])),
    ...Object.fromEntries(CLOSURE_COLUMNS.map(c => [c.key, false])),
    ...Object.fromEntries(CONTROL_LETTER_COLUMNS.map(c => [c.key, false])),
  }));
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dragOverSide, setDragOverSide] = useState(null); // "left" | "right" — which half of the hovered column the cursor is over
  const [showColPicker, setShowColPicker] = useState(false);
  const [colPickerQuery, setColPickerQuery] = useState("");
  const [colPickerPos, setColPickerPos] = useState(null); // { top, right } in viewport coords
  const colPickerRef = useRef(null);
  const colPickerMenuRef = useRef(null);
  const tableScrollRef = useRef(null);
  const loadAbortRef = useRef(null);
  const [userId, setUserId] = useState(null);
  const [canDelete, setCanDelete] = useState(false);
  const [canEditSchools, setCanEditSchools] = useState(false);
  // "צפייה בכרטיס בית ספר" permission (default ON — optimistic so rows stay clickable
  // during load). When resolved to false, rows are shown but locked (lock icon, no
  // navigation); a fast click before it resolves still hits the server 403 + no-access screen.
  const [canOpenSchoolCard, setCanOpenSchoolCard] = useState(true);
  const [showBulkAccessModal, setShowBulkAccessModal] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const tableMenuRef = useRef(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingSchool, setDeletingSchool] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [recycleInfoCount, setRecycleInfoCount] = useState(0);
  const [trialInfo, setTrialInfo] = useState(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [canAddSchool, setCanAddSchool] = useState(null); // null=loading, true=allowed, false=denied

  useEffect(() => {
    if (!filtersPersistKey) return;
    try {
      sessionStorage.setItem(filtersPersistKey, JSON.stringify({
        searchQuery, filters, queries, showFilters,
        academicYear, budgetTypes, goalConditions, openSections,
        columnFilters, sortSpecs,
      }));
    } catch {}
  }, [filtersPersistKey, searchQuery, filters, queries, showFilters, academicYear, budgetTypes, goalConditions, openSections, columnFilters, sortSpecs]);

  // Left/right arrow keys scroll the main schools table horizontally, without needing to
  // first click/focus the scroll container — skipped while typing in a text field so cursor
  // movement there isn't hijacked.
  useEffect(() => {
    function handleKeyDown(e) {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key === "ArrowRight") { e.preventDefault(); tableScrollRef.current?.scrollBy({ left: 60 }); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); tableScrollRef.current?.scrollBy({ left: -60 }); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  function saveColPrefs(order, visible) {
    if (!userId) return;
    localStorage.setItem(`dashboard-col-order-${userId}`, JSON.stringify(order));
    localStorage.setItem(`dashboard-col-visible-${userId}`, JSON.stringify(visible));
    supabase.from("profiles").update({ col_order: order, col_visible: visible }).eq("id", userId).then(() => {});
  }

  function handleColDrop(toIndex, side) {
    if (dragIndex === null || dragIndex === toIndex) return;
    const next = [...colOrder];
    const [moved] = next.splice(dragIndex, 1);
    const targetKey = colOrder[toIndex];
    const targetPos = next.indexOf(targetKey);
    const insertAt = side === "left" ? targetPos + 1 : targetPos;
    next.splice(insertAt, 0, moved);
    setColOrder(next);
    saveColPrefs(next, colVisible);
  }

  function toggleColVisible(key) {
    setColVisible(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveColPrefs(colOrder, next);
      return next;
    });
  }

  // "עמודות להצגה" panel is portaled to document.body (fixed positioning, right edge
  // aligned with the schools table's own right edge — not centered under the toggle button)
  // so it's never covered by the sidebar (aside has z-40) and its width is always predictable
  // regardless of where the button happens to sit in the toolbar.
  useEffect(() => {
    if (!showColPicker) return;
    const buttonRect = colPickerRef.current?.getBoundingClientRect();
    if (!buttonRect) return;
    const tableRight = tableScrollRef.current?.getBoundingClientRect().right ?? buttonRect.right;
    setColPickerPos({ top: buttonRect.bottom + 6, right: window.innerWidth - tableRight });
  }, [showColPicker]);

  useEffect(() => {
    if (!showColPicker) return;
    function handleOutside(e) {
      const insideButton = colPickerRef.current?.contains(e.target);
      const insideMenu = colPickerMenuRef.current?.contains(e.target);
      if (!insideButton && !insideMenu) setShowColPicker(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showColPicker]);

  useEffect(() => {
    if (!showTableMenu) return;
    function handleOutside(e) {
      if (tableMenuRef.current && !tableMenuRef.current.contains(e.target)) setShowTableMenu(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showTableMenu]);

  useEffect(() => {
    return () => { loadAbortRef.current?.abort(); };
  }, []);

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeletingSchool(true);
    try {
      await axios.delete(`/schools/${deleteTarget.id}`);
      setDeleteTarget(null);
      setSelectedIds(prev => { const next = { ...prev }; delete next[deleteTarget.id]; return next; });
      await loadSchools();
    } catch {
      // silently ignore
    } finally {
      setDeletingSchool(false);
    }
  }

  async function handleBulkDeleteConfirmed() {
    const ids = Object.entries(selectedIds).filter(([, v]) => v).map(([id]) => id);
    setBulkDeleting(true);
    // Sent sequentially, not via Promise.all — the backend shares a single Supabase httpx
    // client singleton per process, and firing many deletes at once made them all fail
    // together (same root cause found and fixed for the bulk access-edit modal).
    const failedIds = [];
    for (const id of ids) {
      try {
        await axios.delete(`/schools/${id}`);
      } catch {
        failedIds.push(id);
      }
    }
    setShowBulkDeleteConfirm(false);
    setSelectedIds(prev => {
      const next = { ...prev };
      ids.forEach(id => { if (!failedIds.includes(id)) delete next[id]; });
      return next;
    });
    if (failedIds.length === 0) setSelectMode(false);
    await loadSchools();
    const succeeded = ids.length - failedIds.length;
    if (succeeded > 0) setRecycleInfoCount(succeeded);
    setBulkDeleting(false);
  }

  async function loadSchools() {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setLoading(true);
    setSlowLoading(false);
    setError("");
    const slowTimer = setTimeout(() => setSlowLoading(true), 8000);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await axios.get("/schools/", { signal: controller.signal, params: { academic_year: academicYear } });
        clearTimeout(slowTimer);
        const schoolsData = Array.isArray(res.data) ? res.data : [];
        setSchools(schoolsData);
        const stats = {};
        for (const s of schoolsData) {
          if (s.meetings_stats) stats[s.id] = s.meetings_stats;
        }
        setMeetingsStats(stats);
        setSlowLoading(false);
        setLoading(false);
        return;
      } catch (err) {
        if (err.name === "CanceledError" || err.code === "ERR_CANCELED") {
          clearTimeout(slowTimer);
          return;
        }
        const is5xx = err.response?.status >= 500;
        if (attempt === 0 && is5xx) {
          setRetrying(true);
          await new Promise(r => setTimeout(r, 400));
          setRetrying(false);
          if (controller.signal.aborted) {
            clearTimeout(slowTimer);
            return;
          }
          continue;
        }
        clearTimeout(slowTimer);
        if (!err.response) {
          setError("לא ניתן להתחבר לשרת — ודא שהשרת פועל ולחץ על רענן");
        } else if (is5xx) {
          setError(`שגיאה בשרת (${err.response.status}) — נסה לרענן את הדף`);
        } else {
          setError(`שגיאה בטעינת בתי הספר (${err.response.status})`);
        }
      }
    }
    setSlowLoading(false);
    setLoading(false);
  }

  useEffect(() => {
    if (!didMountAcademicYearRef.current) { didMountAcademicYearRef.current = true; return; }
    loadSchools();
  }, [academicYear]);

  useEffect(() => {
    axios.get("/schools/goal-definitions").then(r => {
      setGoalDefinitions(Array.isArray(r.data) ? r.data : []);
    }).catch(() => {});
  }, []);

  // One dashboard column per planning/reporting goal ("תכנון 40%", "דיווח 25%"...), built
  // dynamically from goalDefinitions (loaded async above) rather than duplicating
  // GOAL_DEFINITIONS on the frontend — matches the existing goal-filter dropdown's approach.
  const goalColumns = useMemo(() => goalDefinitions.map(g => ({
    key: `goal_${g.key}`,
    label: `${g.kind === "planning" ? "תכנון" : "דיווח"} ${g.goal_number}%`,
    goalKey: g.key,
    fmt: "goal",
  })), [goalDefinitions]);
  const goalColumnsByKey = useMemo(() => Object.fromEntries(goalColumns.map(c => [c.key, c.goalKey])), [goalColumns]);
  const dynamicAllColumns = useMemo(() => [...ALL_COLUMNS, ...goalColumns], [goalColumns]);
  const allFilterColumnMeta = useMemo(() => [...FILTER_COLUMN_META, ...goalColumns], [goalColumns]);
  const allFilterColumnKeys = useMemo(() => new Set(allFilterColumnMeta.map(c => c.key)), [allFilterColumnMeta]);
  const columnCategories = useMemo(() => [
    { title: "כללי", cols: GENERAL_COLUMNS },
    { title: "הקצאות", cols: ALLOCATION_COLUMNS },
    { title: "פגישות שבוצעו", cols: MEETINGS_DONE_COLUMNS },
    { title: "בדיקות", cols: [...SUMMARY_COLUMNS, ...CLOSURE_COLUMNS] },
    { title: "יעדים", cols: goalColumns },
    { title: "מכתב בקרה", cols: CONTROL_LETTER_COLUMNS },
  ], [goalColumns]);

  // Goal columns only become known once goalDefinitions loads (after mount); CLOSURE_COLUMNS
  // are static but a user with previously-saved col_order/col_visible (from before this
  // feature existed) has a restored colOrder that doesn't contain them either — in both cases
  // back-fill any missing keys into colOrder/colVisible (hidden by default, like
  // SUMMARY_COLUMNS) so they show up in "עמודות להצגה" without disturbing already-restored
  // user preferences. colOrder/colVisible are deps (not just goalColumns) specifically so this
  // also re-runs once right after restoration overwrites them — the missing-check guard makes
  // this converge after one extra render instead of looping.
  useEffect(() => {
    const candidates = [...NEWLY_ADDED_MOVABLE_COLUMNS, ...MEETING_TYPE_BREAKDOWN_COLUMNS, ...CLOSURE_COLUMNS, ...CONTROL_LETTER_COLUMNS, ...goalColumns];
    const missingOrder = candidates.map(c => c.key).filter(k => !colOrder.includes(k));
    const missingVisible = candidates.filter(c => !(c.key in colVisible));
    if (missingOrder.length === 0 && missingVisible.length === 0) return;
    const nextOrder = missingOrder.length ? [...colOrder, ...missingOrder] : colOrder;
    const nextVisible = missingVisible.length
      ? { ...colVisible, ...Object.fromEntries(missingVisible.map(c => [c.key, false])) }
      : colVisible;
    setColOrder(nextOrder);
    setColVisible(nextVisible);
    saveColPrefs(nextOrder, nextVisible);
  }, [goalColumns, colOrder, colVisible]);

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }
      const uid = session.user.id;
      setUserId(uid);
      const key = `dashboard-filters-${uid}`;
      setFiltersPersistKey(key);
      const roleValue = session.user.user_metadata?.role || "advisor";
      setRole(roleValue);
      // canAddSchool is determined after /users/me confirms the real role (JWT may be stale)

      // Restore filter state from sessionStorage
      try {
        const saved = sessionStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.searchQuery !== undefined) setSearchQuery(parsed.searchQuery);
          if (parsed.filters) setFilters(parsed.filters);
          if (parsed.queries) setQueries(parsed.queries);
          if (parsed.showFilters !== undefined) setShowFilters(parsed.showFilters);
          if (parsed.academicYear && ACADEMIC_YEARS.includes(parsed.academicYear)) setAcademicYear(parsed.academicYear);
          if (Array.isArray(parsed.budgetTypes)) setBudgetTypes(parsed.budgetTypes);
          if (Array.isArray(parsed.goalConditions)) setGoalConditions(parsed.goalConditions);
          if (parsed.openSections) setOpenSections(o => ({ ...o, ...parsed.openSections }));
          if (parsed.columnFilters && typeof parsed.columnFilters === "object") {
            const cleaned = Object.fromEntries(
              Object.entries(parsed.columnFilters).filter(([k]) => FILTER_COLUMN_KEYS.has(k) || k.startsWith("goal_"))
            );
            setColumnFilters(cleaned);
          }
          if (Array.isArray(parsed.sortSpecs)) {
            setSortSpecs(parsed.sortSpecs.filter(s =>
              s && (FILTER_COLUMN_KEYS.has(s.key) || String(s.key).startsWith("goal_")) && (s.dir === "asc" || s.dir === "desc")
            ));
          }
        }
      } catch {}

      // Load localStorage prefs immediately (synchronous, no wait)
      const savedOrder = JSON.parse(localStorage.getItem(`dashboard-col-order-${uid}`) || "null");
      if (Array.isArray(savedOrder) && savedOrder.length > 0 && savedOrder.every(isKnownColumnKey))
        setColOrder(savedOrder);
      const savedVisible = JSON.parse(localStorage.getItem(`dashboard-col-visible-${uid}`) || "null");
      if (savedVisible && typeof savedVisible === "object" && Object.keys(savedVisible).every(isKnownColumnKey))
        setColVisible(savedVisible);

      // Start schools loading immediately
      const schoolsPromise = loadSchools();

      // Call /me first: confirms the role from the backend and warms the
      // _profile_cache so the subsequent /users/all call never hits a cold cache.
      const isManagerFrontend = roleValue === "owner" || roleValue === "manager";
      let confirmedIsManager = false;
      try {
        const meRes = await axios.get("/schools/users/me");
        const confirmedRole = meRes.data?.role || roleValue;
        setRole(confirmedRole);
        setCanDelete(!!meRes.data?.can_delete_schools);
        setCanEditSchools(!!meRes.data?.can_edit_school_directly);
        setCanOpenSchoolCard(meRes.data?.can_view_school_card !== false);
        confirmedIsManager = confirmedRole === "owner" || confirmedRole === "manager";
        if (confirmedRole === "owner" && meRes.data?.org?.subscription_status === "trial") {
          setTrialInfo(meRes.data.org);
        }
        if (confirmedRole === "owner") {
          setIsOwner(true);
          setOnboardingDismissed(meRes.data?.onboarding_dismissed || {});
        }
        // Determine canAddSchool using server-confirmed role (not stale JWT)
        if (confirmedRole === "owner") {
          setCanAddSchool(true);
        } else {
          try {
            const permRes = await axios.get("/schools/permissions/defaults");
            const permKey = confirmedRole === "manager" ? "manager" : "advisor";
            setCanAddSchool(permRes.data?.can_add_school?.[permKey] !== false);
          } catch { setCanAddSchool(true); }
        }
      } catch {
        confirmedIsManager = isManagerFrontend;
        setCanAddSchool(roleValue === "owner" ? true : null);
      }

      const [usersResult, prefsResult] = await Promise.allSettled([
        confirmedIsManager ? axios.get("/schools/users/all") : Promise.resolve({ data: [] }),
        supabase.from("profiles").select("col_order, col_visible").eq("id", uid).single(),
      ]);

      if (usersResult.status === "fulfilled") {
        setAllOrgUsers(Array.isArray(usersResult.value.data) ? usersResult.value.data : []);
      }
      if (prefsResult.status === "fulfilled") {
        const prefs = prefsResult.value.data;
        if (prefs?.col_order && Array.isArray(prefs.col_order) &&
            prefs.col_order.length > 0 && prefs.col_order.every(isKnownColumnKey)) {
          setColOrder(prefs.col_order);
          localStorage.setItem(`dashboard-col-order-${uid}`, JSON.stringify(prefs.col_order));
        }
        if (prefs?.col_visible && typeof prefs.col_visible === "object" &&
            Object.keys(prefs.col_visible).every(isKnownColumnKey)) {
          setColVisible(prefs.col_visible);
          localStorage.setItem(`dashboard-col-visible-${uid}`, JSON.stringify(prefs.col_visible));
        }
      }

      await schoolsPromise;
    }
    init();
  }, [navigate]);

  const visibleColOrder = colOrder.filter(k => colVisible[k] && dynamicAllColumns.some(c => c.key === k));
  const hiddenColCount = Object.values(colVisible).filter(v => !v).length;

  const orgUserOptions = allOrgUsers.map(u => ({ value: u.id, label: u.full_name || u.email }));
  const filterOptions = Object.fromEntries(
    FILTER_CONFIG.map(cfg => [
      cfg.key,
      (cfg.key === "accessAdvisors" || cfg.key === "advisorGefen" || cfg.key === "advisorCurrent" || cfg.key === "advisorDistrict")
        ? orgUserOptions
        : cfg.getOptions(schools),
    ])
  );

  const budgetTypeOptions = uniq([
    ...DEFAULT_BUDGET_TYPES,
    ...schools.flatMap(s => (s.check_metrics || []).map(m => m.budget_name)),
  ]).map(v => ({ value: v, label: v }));

  // Default budget for summary columns is "גפן", overridden only when the advanced
  // filter narrows "סוג תקציב" down to exactly one selection.
  const activeSummaryBudget = budgetTypes.length === 1 ? budgetTypes[0].value : "גפן";
  const hasVisibleSummaryCol = SUMMARY_COLUMNS.some(c => colVisible[c.key]) || goalColumns.some(c => colVisible[c.key]);
  const advancedFilterActive = goalConditions.length > 0 || hasVisibleSummaryCol;

  const activeChipCount = Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);
  const activeQueryCount = Object.values(queries).reduce((sum, q) => sum + (q.trim() ? 1 : 0), 0);
  const advancedActiveCount = (budgetTypes.length > 0 ? 1 : 0) + goalConditions.length;
  const columnFilterActiveCount = Object.keys(columnFilters).length + sortSpecs.length;
  const activeFilterCount = activeChipCount + activeQueryCount + advancedActiveCount + columnFilterActiveCount;
  const hasAnyFilter = !!searchQuery.trim() || activeFilterCount > 0;

  const filteredSchools = schools.filter(school => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = school.name?.toLowerCase().includes(q);
      const matchSymbol = school.symbol?.includes(q);
      const matchAdvisor = [
        ...(school.advisors_gefen || []), ...(school.advisors_current || []), ...(school.advisors_district || []),
      ].some(p => p.full_name?.toLowerCase().includes(q));
      if (!matchName && !matchSymbol && !matchAdvisor) return false;
    }
    return applyFilters(school, filters, queries);
  });

  // When a checks/goals filter (or a visible summary column) is active, split each school
  // into one row per division+budget combination that matches — otherwise keep one row per
  // school. When only a summary column forced the split (no explicit single-budget filter),
  // narrow combos down to the active summary budget so turning on a column alone doesn't
  // explode a school into one row per unrelated budget — only per division (e.g. six-year
  // schools running "גפן" separately for each division).
  const baseDisplayRows = !advancedFilterActive
    ? filteredSchools.map(school => ({
        school, combo: null, rowKey: school.id,
        filterValues: computeFilterValues(school, null, meetingsStats, activeSummaryBudget, goalColumns),
      }))
    : filteredSchools.flatMap(school => {
        let combos = (school.check_metrics && school.check_metrics.length
          ? school.check_metrics
          : [{ division_type: school.stage, budget_name: "כללי" }]
        );
        if (hasVisibleSummaryCol && budgetTypes.length !== 1) {
          const narrowed = combos.filter(combo => combo.budget_name === activeSummaryBudget);
          // No real goal filter is driving the split — a school without any "גפן" check
          // yet must still show up (with "—" summary values), not disappear from the list.
          combos = narrowed.length > 0
            ? narrowed
            : (goalConditions.length > 0 ? [] : [{ division_type: school.stage, budget_name: activeSummaryBudget }]);
        }
        combos = combos
          .filter(combo => matchesBudgetType(combo, budgetTypes))
          .filter(combo => evalGoalConditions(school, combo, goalConditions));
        return combos.map(combo => ({
          school,
          combo,
          rowKey: `${school.id}:${combo.division_type}:${combo.budget_name}`,
          filterValues: computeFilterValues(school, combo, meetingsStats, activeSummaryBudget, goalColumns),
        }));
      });

  // Excel-style per-column header filters/sort, layered on top of baseDisplayRows — all
  // active column filters combine with AND (order-independent), then the stacked
  // multi-column sort (sortSpecs[0] = primary) is applied.
  const finalDisplayRows = useMemo(() => {
    const filtered = baseDisplayRows.filter(row => passesAllColumnFilters(row, columnFilters, allFilterColumnMeta));
    if (sortSpecs.length === 0) return filtered;
    return [...filtered].sort(buildRowComparator(sortSpecs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDisplayRows, columnFilters, sortSpecs, allFilterColumnMeta]);

  const visibleSchoolIds = useMemo(
    () => [...new Set(finalDisplayRows.map(r => r.school.id))],
    [finalDisplayRows]
  );
  const allVisibleSelected = visibleSchoolIds.length > 0 && visibleSchoolIds.every(id => selectedIds[id]);
  const someVisibleSelected = visibleSchoolIds.some(id => selectedIds[id]);

  function toggleSelectAllVisible() {
    setSelectedIds(prev => {
      const next = { ...prev };
      if (allVisibleSelected) {
        visibleSchoolIds.forEach(id => { delete next[id]; });
      } else {
        visibleSchoolIds.forEach(id => { next[id] = true; });
      }
      return next;
    });
  }

  function setFilter(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function setQuery(key, val) {
    setQueries(q => ({ ...q, [key]: val }));
  }

  function clearAll() {
    setSearchQuery("");
    setFilters(EMPTY_FILTERS);
    setQueries(EMPTY_QUERIES);
    setBudgetTypes([]);
    setGoalConditions([]);
    setColumnFilters({});
    setSortSpecs([]);
  }

  function addGoalCondition(goalKey) {
    setGoalConditions(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, goalKey, met: "", connector: "AND" }]);
  }

  function exportSelectedToExcel() {
    const selected = filteredSchools.filter(s => selectedIds[s.id]);
    const colLabels = [
      "שם מוסד",
      ...visibleColOrder.map(key => dynamicAllColumns.find(c => c.key === key)?.label || key),
    ];
    const rows = selected.map(school => [
      school.name || "",
      ...visibleColOrder.map(key => renderCellText(school, key, meetingsStats, null, activeSummaryBudget, goalColumnsByKey)),
    ]);
    const wsData = [colLabels, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = colLabels.map(() => ({ wch: 22 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "בתי ספר");
    XLSX.writeFile(wb, "בתי_ספר_נבחרים.xlsx");
  }

  async function exportSelectedToPdf() {
    const selected = filteredSchools.filter(s => selectedIds[s.id]);
    const headers = [
      "שם מוסד",
      ...visibleColOrder.map(key => dynamicAllColumns.find(c => c.key === key)?.label || key),
    ];
    const rows = selected.map(school => [
      school.name || "",
      ...visibleColOrder.map(key => renderCellText(school, key, meetingsStats, null, activeSummaryBudget, goalColumnsByKey)),
    ]);
    try {
      const res = await axios.post(
        "/schools/export-pdf",
        { title: `רשימת בתי ספר נבחרים (${selected.length})`, headers, rows },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "בתי_ספר_נבחרים.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    }
  }

  function exportToExcel() {
    const colLabels = [
      "שם מוסד",
      ...visibleColOrder.map(key => dynamicAllColumns.find(c => c.key === key)?.label || key),
    ];
    const rows = filteredSchools.map(school => [
      school.name || "",
      ...visibleColOrder.map(key => renderCellText(school, key, meetingsStats, null, activeSummaryBudget, goalColumnsByKey)),
    ]);
    const wsData = [colLabels, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = colLabels.map(() => ({ wch: 22 }));
    ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "בתי ספר");
    XLSX.writeFile(wb, "רשימת_בתי_ספר.xlsx");
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />

      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        {trialInfo && (() => {
          const daysLeft = Math.ceil((new Date(trialInfo.trial_ends_at) - Date.now()) / 86400000);
          const urgent = daysLeft <= 3;
          return (
            <div className={`px-6 py-3 flex items-center gap-3 text-sm font-medium ${urgent ? "bg-red-500 text-white" : "bg-amber-400 text-amber-900"}`}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              {daysLeft > 0
                ? `תקופת הניסיון שלך: נותרו עוד ${daysLeft} ${daysLeft === 1 ? "יום" : "ימים"}`
                : "תקופת הניסיון שלך הסתיימה"}
            </div>
          );
        })()}
        <div className="max-w-[100rem] mx-auto px-6 py-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">בתי הספר שלי</h1>
              <p className="text-slate-500 text-sm mt-1">בחר בית ספר כדי לצפות בפרטיו או לבצע בדיקה</p>
            </div>
            {canAddSchool === true && (
              <button
                onClick={() => navigate("/school/new")}
                className="btn-blue text-sm px-4 py-2"
              >+ הוסף בית ספר</button>
            )}
          </div>

          {/* Search + filter controls */}
          {!loading && !error && schools.length > 0 && (
            <div className="mb-4">
              {/* Search bar */}
              <div className="relative mb-2">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                  </svg>
                </div>
                <input
                  type="search"
                  id="school-search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="חיפוש לפי שם בית ספר, סמל מוסד, שם יועץ..."
                  className="input-field pl-12"
                  aria-label="חיפוש בתי ספר"
                />
              </div>

              {/* Filter toggle row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowFilters(o => !o)}
                    aria-expanded={showFilters}
                    className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium ${showFilters || activeFilterCount > 0 ? "btn-blue" : "btn-ghost"}`}
                  >
                    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                    סינון מתקדם
                    {activeFilterCount > 0 && (
                      <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full bg-white/80 text-blue-700 leading-none">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>

                  {/* Column visibility picker */}
                  <div className="relative" ref={colPickerRef}>
                    <button
                      onClick={() => { setShowColPicker(o => !o); setColPickerQuery(""); }}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium btn-ghost"
                      aria-expanded={showColPicker}
                    >
                      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                        <line x1="15" y1="3" x2="15" y2="21"/>
                      </svg>
                      עמודות להצגה
                    </button>
                    {showColPicker && colPickerPos && createPortal(
                      <div
                        ref={colPickerMenuRef}
                        className="fixed z-50 glass-card rounded-xl py-2 shadow-lg"
                        style={{ top: colPickerPos.top, right: colPickerPos.right, minWidth: 820, maxWidth: "95vw" }}
                        dir="rtl"
                      >
                        <div className="px-3 pb-2">
                          <input
                            type="search"
                            autoFocus
                            value={colPickerQuery}
                            onChange={e => setColPickerQuery(e.target.value)}
                            placeholder="חיפוש עמודה..."
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
                            aria-label="חיפוש עמודה"
                          />
                        </div>
                        <div className="px-2 max-h-[70vh] overflow-y-auto">
                          {columnCategories.map((cat, ci) => {
                            const matches = cat.cols.filter(col =>
                              !colPickerQuery.trim() || col.label.includes(colPickerQuery.trim())
                            );
                            if (matches.length === 0) return null;
                            return (
                              <div key={cat.title} className={ci === 0 ? "mb-2" : "mb-2 mt-5"}>
                                <p className="text-xs font-semibold text-black px-2 pt-2 pb-1 text-center">{cat.title}</p>
                                <div className="grid grid-cols-3 gap-x-6 gap-y-0.5">
                                  {matches.map(col => (
                                    <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={!!colVisible[col.key]}
                                        onChange={() => toggleColVisible(col.key)}
                                        className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                                      />
                                      <span className="text-sm text-slate-700 whitespace-nowrap">{col.label}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {columnCategories.every(cat =>
                          cat.cols.filter(col => !colPickerQuery.trim() || col.label.includes(colPickerQuery.trim())).length === 0
                        ) && (
                          <p className="text-xs text-slate-400 px-4 py-2">לא נמצאו עמודות</p>
                        )}
                        <div className="flex justify-end gap-1 px-3 pt-2 mt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              const next = Object.fromEntries(dynamicAllColumns.map(c => [c.key, false]));
                              setColVisible(next);
                              saveColPrefs(colOrder, next);
                            }}
                            className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1"
                          >
                            נקה בחירה
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = Object.fromEntries(dynamicAllColumns.map(c => [c.key, true]));
                              setColVisible(next);
                              saveColPrefs(colOrder, next);
                            }}
                            className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1"
                          >
                            בחר הכל
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeFilterCount > 0 && (
                    <button onClick={() => { setFilters(EMPTY_FILTERS); setQueries(EMPTY_QUERIES); setBudgetTypes([]); setGoalConditions([]); setColumnFilters({}); setSortSpecs([]); }} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1">
                      נקה סינון
                    </button>
                  )}

                  {selectMode && Object.values(selectedIds).some(Boolean) && (
                    <>
                      {(role === "owner" || (role === "manager" && canEditSchools)) && (
                        <button
                          onClick={() => setShowBulkAccessModal(true)}
                          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
                          style={{ background: "#1d4ed8" }}
                          aria-label="עריכת גישה לבתי ספר מסומנים"
                        >
                          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>
                          </svg>
                          גישה
                        </button>
                      )}
                      <button
                        onClick={exportSelectedToPdf}
                        className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
                        style={{ background: "#b45309" }}
                        aria-label="הורד PDF"
                      >
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        הורד PDF
                      </button>
                      <button
                        onClick={exportSelectedToExcel}
                        className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
                        style={{ background: "#16a34a" }}
                        aria-label="הורד EXCEL"
                      >
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        הורד EXCEL
                      </button>
                      <button
                        onClick={() => { setSelectedIds({}); setSelectMode(false); }}
                        className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        ביטול סימון
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => setShowBulkDeleteConfirm(true)}
                          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors"
                          style={{ background: "#dc2626" }}
                        >
                          מחק
                        </button>
                      )}
                    </>
                  )}

                  {/* Three-dot menu */}
                  <div className="relative" ref={tableMenuRef}>
                    <button
                      onClick={() => setShowTableMenu(o => !o)}
                      className="btn-ghost p-1.5 rounded-xl flex items-center justify-center"
                      aria-label="אפשרויות נוספות"
                      aria-expanded={showTableMenu}
                    >
                      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                      </svg>
                    </button>
                    {showTableMenu && (
                      <div className="absolute left-0 top-full mt-1.5 z-20 glass-card rounded-xl py-1 shadow-lg" style={{ minWidth: 180 }} dir="rtl">
                        <button
                          onClick={() => { exportToExcel(); setShowTableMenu(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-right"
                        >
                          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          הורד לאקסל
                        </button>
                        <button
                          onClick={() => { setSelectMode(o => !o); setSelectedIds({}); setShowTableMenu(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-right"
                        >
                          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="5" width="4" height="4" rx="1"/><line x1="10" y1="7" x2="21" y2="7"/>
                            <rect x="3" y="11" width="4" height="4" rx="1"/><line x1="10" y1="13" x2="21" y2="13"/>
                            <rect x="3" y="17" width="4" height="4" rx="1"/><line x1="10" y1="19" x2="21" y2="19"/>
                          </svg>
                          {selectMode ? "סיים סימון" : "סמן בית ספר"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Advanced filter panel */}
              {showFilters && (
                <div className="flex flex-col gap-3 mt-2">
                  <AccordionSection
                    title="ראשי"
                    isOpen={openSections.main}
                    onToggle={() => setOpenSections(o => ({ ...o, main: !o.main }))}
                    badge={activeChipCount + activeQueryCount + (budgetTypes.length > 0 ? 1 : 0)}
                  >
                    <div className="grid grid-cols-4 gap-4">
                      {FILTER_CONFIG.map(cfg =>
                        cfg.checkbox ? (
                          <CheckboxFilterField
                            key={cfg.key}
                            label={cfg.label}
                            options={filterOptions[cfg.key]}
                            selected={filters[cfg.key]}
                            onChange={val => setFilter(cfg.key, val)}
                            showAllOption={cfg.showAllOption}
                          />
                        ) : (
                          <FilterField
                            key={cfg.key}
                            label={cfg.label}
                            options={filterOptions[cfg.key]}
                            selected={filters[cfg.key]}
                            onChange={val => setFilter(cfg.key, val)}
                            query={queries[cfg.key]}
                            onQueryChange={val => setQuery(cfg.key, val)}
                            openOnFocus={cfg.openOnFocus}
                          />
                        )
                      )}

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="dashboard-academic-year" className="text-xs font-semibold text-slate-600">שנת לימודים</label>
                        <select
                          id="dashboard-academic-year"
                          value={academicYear}
                          onChange={e => setAcademicYear(e.target.value)}
                          className="input-field text-sm w-full text-right"
                        >
                          {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>

                      <CheckboxFilterField
                        label="סוג תקציב"
                        options={budgetTypeOptions}
                        selected={budgetTypes}
                        onChange={setBudgetTypes}
                      />
                    </div>
                  </AccordionSection>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => { setFilters(EMPTY_FILTERS); setQueries(EMPTY_QUERIES); setSearchQuery(""); setBudgetTypes([]); setGoalConditions([]); setColumnFilters({}); setSortSpecs([]); }}
                      className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors px-2 py-1 rounded-lg hover:bg-slate-100"
                    >
                      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                      ניקוי סינון
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading && (
            <div role="status" aria-label="טוען בתי ספר" className="flex flex-col items-center justify-center py-20 gap-3">
              <div aria-hidden="true" className="spinner w-10 h-10" />
              {retrying && <p className="text-slate-500 text-sm">מנסה להתחבר מחדש...</p>}
              {slowLoading && !retrying && (
                <p className="text-slate-400 text-sm text-center">
                  השרת מתעורר — עשוי לקחת עד 30 שניות בפעם הראשונה ביום
                </p>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="glass-card rounded-2xl p-6 text-center">
              <p className="text-red-600 mb-3">{error}</p>
              <button onClick={() => loadSchools()} className="btn-blue text-sm px-4 py-2">רענן</button>
            </div>
          )}

          {!loading && !error && schools.length === 0 && (
            <div className="glass-card rounded-2xl p-12 text-center">
              <p className="text-slate-500 text-lg">אין בתי ספר משויכים לחשבונך</p>
              {canAddSchool === true && (
                <button
                  onClick={() => navigate("/school/new")}
                  className="btn-blue px-6 py-2 text-sm mt-4"
                >הוסף בית ספר ראשון</button>
              )}
            </div>
          )}

          {!loading && !error && schools.length > 0 && (
            <>
              <p className="text-sm text-slate-500 mb-2">
                {advancedFilterActive
                  ? `סה"כ ${finalDisplayRows.length} שורות (${filteredSchools.length} בתי ספר) מתוך ${schools.length}`
                  : hasAnyFilter
                  ? `סה"כ ${filteredSchools.length} בתי ספר מתוך ${schools.length}`
                  : `סה"כ ${schools.length} בתי ספר`}
              </p>
              <div className="glass-card rounded-2xl overflow-hidden relative">
                {finalDisplayRows.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-slate-500">
                      {hasAnyFilter ? "לא נמצאו בתי ספר התואמים לסינון" : "לא נמצאו בתי ספר"}
                    </p>
                    {hasAnyFilter && (
                      <button onClick={clearAll} className="btn-ghost text-sm px-4 py-2 mt-3">נקה סינון</button>
                    )}
                  </div>
                ) : (
                  <div ref={tableScrollRef} className="overflow-auto dash-scroll-x max-h-[70vh]">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr
                          className="border-b border-slate-200"
                          style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" }}
                        >
                          {selectMode && (
                            <th scope="col" className="w-10 px-3 py-3 border-l border-slate-200 text-center"
                              style={{ position: "sticky", right: 0, zIndex: 11, background: "rgba(241,245,249,0.97)" }}>
                              <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                                onChange={toggleSelectAllVisible}
                                className="w-4 h-4 rounded accent-blue-600"
                                aria-label={allVisibleSelected ? "בטל בחירת כל בתי הספר המוצגים" : "בחר את כל בתי הספר המוצגים"}
                              />
                            </th>
                          )}
                          <th scope="col" className="text-right px-5 py-3 text-slate-900 font-semibold border-l border-slate-200"
                            style={{ position: "sticky", right: selectMode ? "2.5rem" : 0, zIndex: 11, background: "rgba(241,245,249,0.97)" }}>שם מוסד</th>
                          {advancedFilterActive && (
                            <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200">סוג תקציב</th>
                          )}
                          {visibleColOrder.map((key, i) => {
                            const col = dynamicAllColumns.find(c => c.key === key);
                            const isLast = i === visibleColOrder.length - 1 && !selectMode;
                            const origIndex = colOrder.indexOf(key);
                            const isDragging = dragIndex === origIndex;
                            const isOver = dragOverIndex === origIndex && dragIndex !== origIndex;
                            return (
                              <th key={key} scope="col"
                                draggable
                                title="גרור לשינוי סדר"
                                onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragIndex(origIndex); }}
                                onDragOver={e => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const side = (e.clientX - rect.left) < rect.width / 2 ? "left" : "right";
                                  setDragOverIndex(origIndex);
                                  setDragOverSide(side);
                                }}
                                onDrop={e => { e.preventDefault(); handleColDrop(origIndex, dragOverSide); setDragIndex(null); setDragOverIndex(null); setDragOverSide(null); }}
                                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); setDragOverSide(null); }}
                                className={[
                                  "text-right px-4 py-3 font-semibold select-none transition-all cursor-grab active:cursor-grabbing",
                                  isLast ? "" : "border-l border-slate-200",
                                  isDragging ? "opacity-30 bg-slate-100" : "",
                                  isOver ? "bg-blue-50 text-blue-600" : "text-slate-900",
                                  isOver && dragOverSide === "left" ? "border-l-4 border-l-blue-500" : "",
                                  isOver && dragOverSide === "right" ? "border-r-4 border-r-blue-500" : "",
                                ].filter(Boolean).join(" ")}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span>{col.label}</span>
                                  {allFilterColumnKeys.has(key) && (
                                    <ColumnHeaderFilter
                                      colDef={allFilterColumnMeta.find(c => c.key === key)}
                                      columnFilters={columnFilters}
                                      setColumnFilters={setColumnFilters}
                                      sortSpecs={sortSpecs}
                                      setSortSpecs={setSortSpecs}
                                      openKey={openColFilterKey}
                                      setOpenKey={setOpenColFilterKey}
                                      baseDisplayRows={baseDisplayRows}
                                      allFilterMeta={allFilterColumnMeta}
                                    />
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {finalDisplayRows.map(({ school, combo, rowKey }) => {
                          const isSelected = !!selectedIds[school.id];
                          return (
                            <tr
                              key={rowKey}
                              className={`group border-b border-slate-100 transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"} ${(selectMode || !canOpenSchoolCard) ? "cursor-default" : "cursor-pointer"}`}
                              onClick={() => { if (!selectMode && canOpenSchoolCard) navigate(`/school/${school.id}`, { state: { school } }); }}
                              role={(selectMode || !canOpenSchoolCard) ? undefined : "button"}
                              tabIndex={(selectMode || !canOpenSchoolCard) ? undefined : 0}
                              aria-label={(selectMode || !canOpenSchoolCard) ? undefined : `פתח פרטי בית ספר ${school.name}`}
                              onKeyDown={e => !selectMode && canOpenSchoolCard && e.key === "Enter" && navigate(`/school/${school.id}`, { state: { school } })}
                            >
                              {selectMode && (
                                <td className={`px-3 py-3 border-l border-slate-100 text-center ${isSelected ? "bg-blue-50" : "bg-white group-hover:bg-slate-50"}`}
                                  style={{ position: "sticky", right: 0, zIndex: 5 }}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => setSelectedIds(prev => ({ ...prev, [school.id]: !prev[school.id] }))}
                                    onClick={e => e.stopPropagation()}
                                    className="w-4 h-4 rounded accent-blue-600"
                                    aria-label={`בחר ${school.name}`}
                                  />
                                </td>
                              )}
                              <td className={`px-5 py-3 border-l border-slate-100 ${isSelected ? "bg-blue-50" : "bg-white group-hover:bg-slate-50"}`}
                                style={{ position: "sticky", right: selectMode ? "2.5rem" : 0, zIndex: 5 }}>
                                <span className="font-semibold text-slate-900 inline-flex items-center gap-1.5">
                                  {!canOpenSchoolCard && (
                                    <svg aria-label="אין לך הרשאה לצפות בכרטיס בית ספר" role="img"
                                      className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" viewBox="0 0 24 24"
                                      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <title>אין לך הרשאה לצפות בכרטיס בית ספר</title>
                                      <rect x="3" y="11" width="18" height="11" rx="2" />
                                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                  )}
                                  {school.name}
                                </span>
                              </td>
                              {advancedFilterActive && (
                                <td className="px-4 py-3 border-l border-slate-100 text-slate-600">
                                  <div className="flex flex-col gap-0.5 text-xs">
                                    <span className="font-medium text-slate-700">
                                      {combo.budget_name} · {DIVISION_LABEL[combo.division_type] || combo.division_type}
                                    </span>
                                  </div>
                                </td>
                              )}
                              {visibleColOrder.map((key, i) => (
                                <td key={key}
                                  className={`px-5 py-3 text-slate-600${(i < visibleColOrder.length - 1 || selectMode) ? " border-l border-slate-100" : ""}`}>
                                  {renderCell(school, key, meetingsStats, combo, activeSummaryBudget, goalColumnsByKey)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {finalDisplayRows.length > 0 && (
                  <>
                    <button type="button"
                      aria-label="גלול ימינה"
                      onClick={() => tableScrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
                      style={{ position: "absolute", bottom: 2, right: 2, height: 14, width: 18, zIndex: 25 }}
                      className="flex items-center justify-center rounded bg-white/80 text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shadow-sm">
                      <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <button type="button"
                      aria-label="גלול שמאלה"
                      onClick={() => tableScrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
                      style={{ position: "absolute", bottom: 2, left: 2, height: 14, width: 18, zIndex: 25 }}
                      className="flex items-center justify-center rounded bg-white/80 text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shadow-sm">
                      <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <DeleteConfirmModal
          title="מחיקת בית ספר"
          subtitle={deleteTarget.name}
          message="מחיקת בית הספר תגרום למחיקת כלל הנתונים עליו לצמיתות."
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteTarget(null)}
          confirming={deletingSchool}
        />
      )}

      {showBulkDeleteConfirm && (
        <DeleteConfirmModal
          title="מחיקת בתי ספר"
          subtitle={`${Object.values(selectedIds).filter(Boolean).length} בתי ספר מסומנים`}
          message="מחיקת בתי הספר תגרום למחיקת כלל הנתונים עליהם לצמיתות."
          onConfirm={handleBulkDeleteConfirmed}
          onCancel={() => setShowBulkDeleteConfirm(false)}
          confirming={bulkDeleting}
        />
      )}

      {recycleInfoCount > 0 && (
        <RecycleBinInfoModal
          count={recycleInfoCount}
          onClose={() => setRecycleInfoCount(0)}
        />
      )}

      {showBulkAccessModal && (
        <BulkAccessModal
          schools={filteredSchools.filter(s => selectedIds[s.id])}
          users={allOrgUsers}
          loadingUsers={false}
          onClose={() => setShowBulkAccessModal(false)}
          onSaved={loadSchools}
        />
      )}

      {isOwner && onboardingDismissed !== null && (
        <OnboardingToast
          dismissed={onboardingDismissed}
          onDismissed={key => setOnboardingDismissed(prev => ({ ...prev, [key]: true }))}
        />
      )}
    </div>
  );
}
