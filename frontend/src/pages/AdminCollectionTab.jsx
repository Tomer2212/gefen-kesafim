import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";

const COLLECTION_COLUMNS = [
  { key: "gefen_organized",      label: "גפן מסודר" },
  { key: "gefen_hours_reported", label: "שעות גפן מדווחות" },
  { key: "amount_paid",          label: "סכום ששולם" },
  { key: "remaining_to_pay",     label: "נותר לתשלום" },
  { key: "payment_method",       label: "אמצעי תשלום" },
  { key: "invoice_number",       label: "מס' חשבונית עסקה" },
  { key: "deposit_date",         label: "תאריך הפקדה" },
];

const CLIENT_STATUS_OPTIONS = [
  { value: "active",      label: "פעיל" },
  { value: "inactive",    label: "לא פעיל" },
  { value: "in_progress", label: "בתהליך" },
  { value: "former",      label: "לקוח עבר" },
];

function ColumnPickerButton({ colVisible, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-ghost text-xs px-3 py-1.5"
        aria-haspopup="true"
        aria-expanded={open}
      >
        עמודות לתצוגה
      </button>
      {open && (
        <div
          className="absolute z-30 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-2 w-64 max-h-96 overflow-y-auto"
          dir="rtl"
        >
          <div className="px-3 py-1">
            {COLLECTION_COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 py-1 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!colVisible[col.key]}
                  onChange={() => onToggle(col.key)}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ALL_STATUS_OPTION = { value: "__all__", label: "כולם" };

function ClientStatusFilter({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) setDraft(selected);
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

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="input-field text-sm text-right"
        style={{ minWidth: 160 }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected.length > 0 ? (
          <span className="text-slate-700">סטטוס לקוח: {selected.length} נבחרו</span>
        ) : (
          <span className="text-slate-300 select-none">סטטוס לקוח: הכל</span>
        )}
      </button>
      {open && (
        <div
          className="absolute z-40 right-0 top-full mt-1 border border-slate-200 rounded-xl bg-white shadow-xl"
          style={{ minWidth: 180 }}
          dir="rtl"
        >
          <div className="overflow-y-auto" style={{ maxHeight: 180 }} role="listbox" aria-multiselectable="true">
            {[ALL_STATUS_OPTION, ...CLIENT_STATUS_OPTIONS].map(opt => (
              <label key={opt.value} className="flex items-center gap-2.5 px-4 py-2 hover:bg-blue-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={opt.value === "__all__" ? draft.length === 0 : draft.some(s => s.value === opt.value)}
                  onChange={() => (opt.value === "__all__" ? setDraft([]) : toggleItem(opt))}
                  className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                />
                <span className="text-sm text-slate-700">{opt.label}</span>
              </label>
            ))}
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
  );
}

export default function AdminCollectionTab() {
  const [schools, setSchools] = useState([]);
  const [yearAdminData, setYearAdminData] = useState({});
  const [loading, setLoading] = useState(true);
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [colVisible, setColVisible] = useState(() =>
    Object.fromEntries(COLLECTION_COLUMNS.map(c => [c.key, true]))
  );
  const [statusFilter, setStatusFilter] = useState([
    { value: "active", label: "פעיל" },
  ]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [schoolsRes, yearDataRes] = await Promise.all([
          axios.get("/schools/"),
          axios.get("/schools/year-admin-data", { params: { academic_year: academicYear } }),
        ]);
        if (cancelled) return;
        setSchools(Array.isArray(schoolsRes.data) ? schoolsRes.data : []);
        setYearAdminData(yearDataRes.data || {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [academicYear]);

  function toggleCol(key) {
    setColVisible(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const visibleColumns = COLLECTION_COLUMNS.filter(c => colVisible[c.key]);

  const filteredSchools = statusFilter.length === 0
    ? schools
    : schools.filter(s => {
        const status = yearAdminData[s.id]?.client_status;
        return statusFilter.some(f => f.value === status);
      });

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <ClientStatusFilter selected={statusFilter} onChange={setStatusFilter} />
          <ColumnPickerButton colVisible={colVisible} onToggle={toggleCol} />
        </div>
        <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
      </div>

      <div className="glass-card rounded-2xl overflow-hidden relative mb-3">
        {loading ? (
          <div role="status" aria-label="טוען נתוני גבייה" className="flex justify-center py-10">
            <div aria-hidden="true" className="spinner w-8 h-8" />
          </div>
        ) : filteredSchools.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-500">לא נמצאו בתי ספר</p>
          </div>
        ) : (
          <div className="overflow-auto dash-scroll-x max-h-[70vh]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr
                  className="border-b border-slate-200"
                  style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" }}
                >
                  <th
                    scope="col"
                    className="text-right px-5 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap"
                    style={{ position: "sticky", right: 0, zIndex: 11, background: "rgba(241,245,249,0.97)", minWidth: "14rem" }}
                  >
                    שם מוסד
                  </th>
                  {visibleColumns.map((col, i) => {
                    const isLast = i === visibleColumns.length - 1;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className={`text-right px-4 py-3 font-semibold select-none text-slate-900 whitespace-nowrap ${isLast ? "" : "border-l border-slate-200"}`}
                      >
                        {col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredSchools.map(school => (
                  <tr key={school.id} className="group border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td
                      className="px-5 py-3 border-l border-slate-100 bg-white group-hover:bg-slate-50 whitespace-nowrap"
                      style={{ position: "sticky", right: 0, zIndex: 5, minWidth: "14rem" }}
                    >
                      <span className="font-semibold text-slate-900">{school.name}</span>
                    </td>
                    {visibleColumns.map((col, i) => {
                      const isLast = i === visibleColumns.length - 1;
                      return (
                        <td key={col.key} className={`px-4 py-2 text-slate-600 ${isLast ? "" : "border-l border-slate-100"}`}>
                          —
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
