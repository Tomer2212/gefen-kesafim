import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";
import OnboardingToast from "../components/OnboardingToast";
import { useFocusTrap } from "../hooks/useFocusTrap";

const DIVISION_LABEL = {
  tikkon: "חטיבה עליונה",
  beinayim: "חטיבת ביניים",
  yesodi: "יסודי",
  other: "אחר",
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
  principals: [], secretaries: [], financeContacts: [], advisors: [],
  accessAdvisors: [],
};

const EMPTY_QUERIES = {
  names: "", symbols: "", stages: "", divisions: "",
  cities: "", authorities: "", financeSoftwares: "", addresses: "",
  principals: "", secretaries: "", financeContacts: "", advisors: "",
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
  { key: "advisors",        label: "יועץ מלווה",     checkbox: true,                            getOptions: () => [] },
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

const MOVABLE_COLUMNS = [
  { key: "advisor",             label: "יועץ מלווה" },
  { key: "symbol",              label: "סמל מוסד" },
  { key: "city",                label: "עיר" },
  { key: "authority",           label: "בעלות" },
  { key: "stage",               label: "שלב מוסד" },
  { key: "meetings_completed",  label: 'סה"כ פגישות שבוצעו' },
  { key: "meetings_hours",      label: 'סה"כ שעות שבוצעו' },
];
const DEFAULT_COL_ORDER = MOVABLE_COLUMNS.map(c => c.key);

function formatMeetingHours(totalMinutes) {
  if (!totalMinutes || totalMinutes === 0) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} דק'`;
  if (m === 0) return `${h} שעות`;
  return `${h}:${String(m).padStart(2, "0")} שעות`;
}

function renderCell(school, key, meetingsStats = {}) {
  switch (key) {
    case "advisor":
      return (school.advisor_schools || []).map(as => as.profiles).filter(Boolean).map(p => p.full_name || p.email).join(", ") || "—";
    case "symbol":
      return <span className="font-mono">{school.symbol || "—"}</span>;
    case "city":
      return school.city || "—";
    case "authority":
      return school.authority || "—";
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

function renderCellText(school, key, meetingsStats = {}) {
  switch (key) {
    case "advisor":
      return (school.advisor_schools || []).map(as => as.profiles).filter(Boolean).map(p => p.full_name || p.email).join(", ") || "";
    case "symbol":
      return school.symbol || "";
    case "city":
      return school.city || "";
    case "authority":
      return school.authority || "";
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

  // Advisors — compare by UUID (advisor_id in advisor_schools)
  const advisorIds = (school.advisor_schools || []).map(as => as.advisor_id).filter(Boolean);
  if (filters.advisors.length > 0) {
    if (!filters.advisors.some(f => advisorIds.includes(f.value))) return false;
  }

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
  const [showFilters, setShowFilters] = useState(false);
  const [filtersPersistKey, setFiltersPersistKey] = useState(null);
  const [colOrder, setColOrder] = useState(DEFAULT_COL_ORDER);
  const [colVisible, setColVisible] = useState(Object.fromEntries(DEFAULT_COL_ORDER.map(k => [k, true])));
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showColPicker, setShowColPicker] = useState(false);
  const [colPickerQuery, setColPickerQuery] = useState("");
  const colPickerRef = useRef(null);
  const loadAbortRef = useRef(null);
  const [userId, setUserId] = useState(null);
  const [canDelete, setCanDelete] = useState(false);
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
      sessionStorage.setItem(filtersPersistKey, JSON.stringify({ searchQuery, filters, queries, showFilters }));
    } catch {}
  }, [filtersPersistKey, searchQuery, filters, queries, showFilters]);

  function saveColPrefs(order, visible) {
    if (!userId) return;
    localStorage.setItem(`dashboard-col-order-${userId}`, JSON.stringify(order));
    localStorage.setItem(`dashboard-col-visible-${userId}`, JSON.stringify(visible));
    supabase.from("profiles").update({ col_order: order, col_visible: visible }).eq("id", userId).then(() => {});
  }

  function handleColDrop(toIndex) {
    if (dragIndex === null || dragIndex === toIndex) return;
    const next = [...colOrder];
    [next[dragIndex], next[toIndex]] = [next[toIndex], next[dragIndex]];
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

  useEffect(() => {
    if (!showColPicker) return;
    function handleOutside(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setShowColPicker(false);
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
    const deletedCount = ids.length;
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map(id => axios.delete(`/schools/${id}`)));
      setShowBulkDeleteConfirm(false);
      setSelectedIds({});
      setSelectMode(false);
      await loadSchools();
      setRecycleInfoCount(deletedCount);
    } catch {
      // silently ignore
    } finally {
      setBulkDeleting(false);
    }
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
        const res = await axios.get("/schools/", { signal: controller.signal });
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
        }
      } catch {}

      // Load localStorage prefs immediately (synchronous, no wait)
      const savedOrder = JSON.parse(localStorage.getItem(`dashboard-col-order-${uid}`) || "null");
      if (Array.isArray(savedOrder) && savedOrder.length === DEFAULT_COL_ORDER.length && savedOrder.every(k => DEFAULT_COL_ORDER.includes(k)))
        setColOrder(savedOrder);
      const savedVisible = JSON.parse(localStorage.getItem(`dashboard-col-visible-${uid}`) || "null");
      if (savedVisible && typeof savedVisible === "object" && DEFAULT_COL_ORDER.every(k => k in savedVisible))
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
            prefs.col_order.length === DEFAULT_COL_ORDER.length &&
            prefs.col_order.every(k => DEFAULT_COL_ORDER.includes(k))) {
          setColOrder(prefs.col_order);
          localStorage.setItem(`dashboard-col-order-${uid}`, JSON.stringify(prefs.col_order));
        }
        if (prefs?.col_visible && typeof prefs.col_visible === "object" &&
            DEFAULT_COL_ORDER.every(k => k in prefs.col_visible)) {
          setColVisible(prefs.col_visible);
          localStorage.setItem(`dashboard-col-visible-${uid}`, JSON.stringify(prefs.col_visible));
        }
      }

      await schoolsPromise;
    }
    init();
  }, [navigate]);

  const visibleColOrder = colOrder.filter(k => colVisible[k]);
  const hiddenColCount = Object.values(colVisible).filter(v => !v).length;

  const orgUserOptions = allOrgUsers.map(u => ({ value: u.id, label: u.full_name || u.email }));
  const filterOptions = Object.fromEntries(
    FILTER_CONFIG.map(cfg => [
      cfg.key,
      (cfg.key === "accessAdvisors" || cfg.key === "advisors")
        ? orgUserOptions
        : cfg.getOptions(schools),
    ])
  );

  const activeChipCount = Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);
  const activeQueryCount = Object.values(queries).reduce((sum, q) => sum + (q.trim() ? 1 : 0), 0);
  const activeFilterCount = activeChipCount + activeQueryCount;
  const hasAnyFilter = !!searchQuery.trim() || activeFilterCount > 0;

  const filteredSchools = schools.filter(school => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = school.name?.toLowerCase().includes(q);
      const matchSymbol = school.symbol?.includes(q);
      const matchAdvisor = (school.advisor_schools || []).some(
        as => as.profiles?.full_name?.toLowerCase().includes(q)
      );
      if (!matchName && !matchSymbol && !matchAdvisor) return false;
    }
    return applyFilters(school, filters, queries);
  });

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
  }

  function exportSelectedToExcel() {
    const selected = filteredSchools.filter(s => selectedIds[s.id]);
    const colLabels = [
      "שם מוסד",
      ...visibleColOrder.map(key => MOVABLE_COLUMNS.find(c => c.key === key)?.label || key),
    ];
    const rows = selected.map(school => [
      school.name || "",
      ...visibleColOrder.map(key => renderCellText(school, key, meetingsStats)),
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
      ...visibleColOrder.map(key => MOVABLE_COLUMNS.find(c => c.key === key)?.label || key),
    ];
    const rows = selected.map(school => [
      school.name || "",
      ...visibleColOrder.map(key => renderCellText(school, key, meetingsStats)),
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
      ...visibleColOrder.map(key => MOVABLE_COLUMNS.find(c => c.key === key)?.label || key),
    ];
    const rows = filteredSchools.map(school => [
      school.name || "",
      ...visibleColOrder.map(key => renderCellText(school, key, meetingsStats)),
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
        <div className="max-w-5xl mx-auto px-6 py-10">
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
                    {showColPicker && (
                      <div className="absolute right-0 top-full mt-1.5 z-20 glass-card rounded-xl py-2 shadow-lg" style={{ minWidth: 190 }} dir="rtl">
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
                        {MOVABLE_COLUMNS.filter(col =>
                          !colPickerQuery.trim() || col.label.includes(colPickerQuery.trim())
                        ).map(col => (
                          <label key={col.key} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={colVisible[col.key]}
                              onChange={() => toggleColVisible(col.key)}
                              className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                            />
                            <span className="text-sm text-slate-700">{col.label}</span>
                          </label>
                        ))}
                        {MOVABLE_COLUMNS.filter(col =>
                          !colPickerQuery.trim() || col.label.includes(colPickerQuery.trim())
                        ).length === 0 && (
                          <p className="text-xs text-slate-400 px-4 py-2">לא נמצאו עמודות</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeFilterCount > 0 && (
                    <button onClick={() => { setFilters(EMPTY_FILTERS); setQueries(EMPTY_QUERIES); }} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1">
                      נקה סינון
                    </button>
                  )}

                  {selectMode && Object.values(selectedIds).some(Boolean) && (
                    <>
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
                <div className="glass-card rounded-2xl p-5 mt-2" style={{ background: "rgba(248,250,252,0.92)" }}>
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
                  </div>
                  <div className="flex justify-end mt-4 pt-3 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => { setFilters(EMPTY_FILTERS); setQueries(EMPTY_QUERIES); setSearchQuery(""); }}
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
                {hasAnyFilter
                  ? `סה"כ ${filteredSchools.length} בתי ספר מתוך ${schools.length}`
                  : `סה"כ ${schools.length} בתי ספר`}
              </p>
              <div className="glass-card rounded-2xl overflow-hidden">
                {filteredSchools.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-slate-500">
                      {hasAnyFilter ? "לא נמצאו בתי ספר התואמים לסינון" : "לא נמצאו בתי ספר"}
                    </p>
                    {hasAnyFilter && (
                      <button onClick={clearAll} className="btn-ghost text-sm px-4 py-2 mt-3">נקה סינון</button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr
                          className="border-b border-slate-200"
                          style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" }}
                        >
                          {selectMode && <th scope="col" className="w-10 px-3 py-3 border-l border-slate-200" />}
                          <th scope="col" className="text-right px-5 py-3 text-slate-900 font-semibold border-l border-slate-200">שם מוסד</th>
                          {visibleColOrder.map((key, i) => {
                            const col = MOVABLE_COLUMNS.find(c => c.key === key);
                            const isLast = i === visibleColOrder.length - 1 && !selectMode;
                            const origIndex = colOrder.indexOf(key);
                            const isDragging = dragIndex === origIndex;
                            const isOver = dragOverIndex === origIndex && dragIndex !== origIndex;
                            return (
                              <th key={key} scope="col"
                                draggable
                                title="גרור לשינוי סדר"
                                onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragIndex(origIndex); }}
                                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIndex(origIndex); }}
                                onDrop={e => { e.preventDefault(); handleColDrop(origIndex); setDragIndex(null); setDragOverIndex(null); }}
                                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                                className={[
                                  "text-right px-4 py-3 font-semibold select-none transition-all cursor-grab active:cursor-grabbing",
                                  isLast ? "" : "border-l border-slate-200",
                                  isDragging ? "opacity-30 bg-slate-100" : "",
                                  isOver ? "bg-blue-50 text-blue-600 border-b-2 border-blue-400" : "text-slate-900",
                                ].filter(Boolean).join(" ")}
                              >
                                {col.label}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSchools.map((school) => {
                          const isSelected = !!selectedIds[school.id];
                          return (
                            <tr
                              key={school.id}
                              className={`border-b border-slate-100 transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"} ${selectMode ? "cursor-default" : "cursor-pointer"}`}
                              onClick={() => { if (!selectMode) navigate(`/school/${school.id}`, { state: { school } }); }}
                              role={selectMode ? undefined : "button"}
                              tabIndex={selectMode ? undefined : 0}
                              aria-label={selectMode ? undefined : `פתח פרטי בית ספר ${school.name}`}
                              onKeyDown={e => !selectMode && e.key === "Enter" && navigate(`/school/${school.id}`, { state: { school } })}
                            >
                              {selectMode && (
                                <td className="px-3 py-3 border-l border-slate-100 text-center">
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
                              <td className="px-5 py-3 border-l border-slate-100">
                                <span className="font-semibold text-slate-900">{school.name}</span>
                              </td>
                              {visibleColOrder.map((key, i) => (
                                <td key={key}
                                  className={`px-5 py-3 text-slate-600${(i < visibleColOrder.length - 1 || selectMode) ? " border-l border-slate-100" : ""}`}>
                                  {renderCell(school, key, meetingsStats)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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

      {isOwner && onboardingDismissed !== null && (
        <OnboardingToast
          dismissed={onboardingDismissed}
          onDismissed={key => setOnboardingDismissed(prev => ({ ...prev, [key]: true }))}
        />
      )}
    </div>
  );
}
