import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useRowVirtualizer } from "../../hooks/useRowVirtualizer";
import DirectStyleDateInput from "../tasks/DirectStyleDateInput";

// Same option values used on the school card (AdminPage.jsx / SchoolPage.jsx) for these
// fields — kept as local constants here (rather than importing across pages) since they're
// just static Hebrew label lists, already duplicated per-surface in the codebase.
const SCOPE_FIELDS = [
  { value: "sector", label: "מגזר", options: ["יהודי", "ערבי", "צ'רקסי", "בדואי", "דרוזי"] },
  { value: "district", label: "מחוז", options: ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"] },
  { value: "stage", label: "שלב חינוכי", options: [
    { value: "yesodi", label: "יסודי" }, { value: "beinayim", label: "חטיבת ביניים" },
    { value: "tikkon", label: "תיכון" }, { value: "sheshshnati", label: "שש שנתי" }, { value: "other", label: "אחר" },
  ] },
  { value: "supervision", label: "פיקוח", options: ["ממלכתי", "ממלכתי דתי", "חרדי"] },
  { value: "authority", label: "בעלות", freeText: true },
  { value: "city", label: "עיר", freeText: true },
];

function scopeFieldLabel(field) {
  return SCOPE_FIELDS.find(f => f.value === field)?.label || field;
}

function formatRange(startDate, endDate) {
  const f = d => { const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };
  return startDate === endDate ? f(startDate) : `${f(startDate)} – ${f(endDate)}`;
}

// Distinct, sorted values for a school field (e.g. "city"/"authority"), mirroring the
// dedupe + Hebrew-locale sort used by DashboardPage.jsx's advanced-filter distinctValues.
function distinctSchoolValues(schools, field) {
  const seen = new Map();
  for (const s of schools) {
    const v = (s?.[field] || "").trim();
    if (v && !seen.has(v)) seen.set(v, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "he"));
}

// Searchable multi-select for free-text scope fields (city/authority), sourced from the
// distinct values present across the org's schools. Mirrors AdvisorSearch.jsx's pattern:
// closed trigger box with chips, portal-rendered dropdown with a live-filtering search
// input, list virtualized via the shared useRowVirtualizer hook since the distinct-value
// list can get long.
const SCOPE_ROW_HEIGHT = 36;
const SCOPE_LIST_MAX_HEIGHT = 176; // matches the old max-h-44

function FreeTextScopePicker({ label, allValues, values, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const scrollRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allValues.filter(v => v.toLowerCase().includes(q)) : allValues;
  }, [allValues, query]);

  const { virtualizer, items, padTop, padBottom } = useRowVirtualizer(filtered, {
    estimateSize: SCOPE_ROW_HEIGHT, scrollRef, getItemKey: v => v,
  });

  // The scroll container's height must come from `filtered.length` (known synchronously),
  // not from its own rendered content via max-height + overflow-auto: with no items painted
  // yet, that would collapse the container to 0px, which the virtualizer would then measure
  // as a 0-height viewport, computing zero visible items and keeping it collapsed forever.
  const listHeight = filtered.length === 0 ? 56 : Math.min(filtered.length * SCOPE_ROW_HEIGHT, SCOPE_LIST_MAX_HEIGHT);

  function toggle(v) {
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);
  }

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
    const handler = e => { if (!dropdownRef.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [open]);

  return (
    <div>
      <label htmlFor={`blocked-date-scope-trigger-${label}`} className="block text-xs font-medium text-slate-500 mb-1">
        {`ערכים חסומים עבור "${label}"`}
      </label>
      <div
        id={`blocked-date-scope-trigger-${label}`}
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        className="w-full min-h-[34px] flex flex-wrap items-center gap-1.5 text-sm border border-slate-300 rounded-lg px-3 py-1.5 cursor-pointer bg-white"
      >
        {values.length === 0 && <span className="text-slate-400">לחץ לבחירת ערכים...</span>}
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-full px-2.5 py-1">
            {v}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); toggle(v); }}
              aria-label={`הסר ${v}`}
              className="text-slate-400 hover:text-red-600"
            >×</button>
          </span>
        ))}
      </div>
      {open && pos && createPortal(
        <div ref={dropdownRef} className="fixed z-[9999] border border-slate-200 rounded-xl bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 220) }}>
          <div className="p-2 border-b border-slate-100">
            <label htmlFor={`blocked-date-scope-search-${label}`} className="sr-only">{`חיפוש ${label}`}</label>
            <input
              id={`blocked-date-scope-search-${label}`}
              type="search"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
              placeholder={`חפש ${label}...`}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5"
            />
          </div>
          <div ref={scrollRef} style={{ height: listHeight }} className="overflow-y-auto" role="listbox" aria-multiselectable="true">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">לא נמצאו ערכים</div>
            ) : (
              <div style={{ height: padTop }} />
            )}
            {items.map(item => {
              const v = filtered[item.index];
              const checked = values.includes(v);
              return (
                <button
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onMouseDown={e => { e.preventDefault(); toggle(v); }}
                  className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 transition-colors flex items-center gap-2"
                >
                  <span className={`w-4 h-4 rounded border flex-shrink-0 ${checked ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                  <span>{v}</span>
                </button>
              );
            })}
            {filtered.length > 0 && <div style={{ height: padBottom }} />}
          </div>
          <div className="p-2 border-t border-slate-100 flex justify-end">
            <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(false); }} className="btn-blue text-xs px-3 py-1.5">אישור</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ScopeValuesPicker({ field, values, onChange, schools }) {
  const def = SCOPE_FIELDS.find(f => f.value === field);
  if (!def) return null;

  if (def.freeText) {
    const allValues = distinctSchoolValues(schools || [], field);
    return <FreeTextScopePicker label={def.label} allValues={allValues} values={values} onChange={onChange} />;
  }

  const opts = def.options.map(o => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map(o => {
        const checked = values.includes(o.value);
        return (
          <label key={o.value} className={`text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer border transition-colors ${
            checked ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
          }`}>
            <input
              type="checkbox" className="sr-only" checked={checked}
              onChange={() => onChange(checked ? values.filter(v => v !== o.value) : [...values, o.value])}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

function AddBlockedDateForm({ onCreated, onCancel, schools }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [scoped, setScoped] = useState(false);
  const [scopeField, setScopeField] = useState("sector");
  const [scopeValues, setScopeValues] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!startDate || !endDate) { setError("יש לבחור טווח תאריכים"); return; }
    if (endDate < startDate) { setError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה"); return; }
    if (!reason.trim()) { setError("יש להזין הערה — היא זו שתוצג למשתמש כשינסה לקבוע פגישה בתאריך זה"); return; }
    if (scoped && scopeValues.length === 0) { setError("יש לבחור לפחות ערך אחד עבור הפלח שנבחר"); return; }
    setSaving(true);
    try {
      const res = await axios.post("/schools/blocked-dates", {
        start_date: startDate, end_date: endDate, reason: reason.trim(),
        scope_field: scoped ? scopeField : null,
        scope_values: scoped ? scopeValues : null,
      });
      onCreated(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "שמירת הטווח נכשלה, נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3 bg-slate-50">
      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-end gap-3">
        <div>
          <label htmlFor="blocked-date-start" className="block text-xs font-medium text-slate-500 mb-1">מתאריך</label>
          <DirectStyleDateInput id="blocked-date-start" value={startDate} onChange={setStartDate} />
        </div>
        <div>
          <label htmlFor="blocked-date-end" className="block text-xs font-medium text-slate-500 mb-1">עד תאריך</label>
          <DirectStyleDateInput id="blocked-date-end" value={endDate} onChange={setEndDate} />
        </div>
      </div>
      <div>
        <label htmlFor="blocked-date-reason" className="block text-xs font-medium text-slate-500 mb-1">הערה (חובה)</label>
        <input
          id="blocked-date-reason" type="text" value={reason} onChange={e => setReason(e.target.value)}
          placeholder='למשל: "חג הסוכות — בתי הספר סגורים"'
          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5"
        />
      </div>
      <div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={scoped} onChange={e => setScoped(e.target.checked)} />
          הגבל לפלח מסוים (במקום כל בתי הספר)
        </label>
      </div>
      {scoped && (
        <div className="flex flex-col gap-2">
          <div>
            <label htmlFor="blocked-date-scope-field" className="block text-xs font-medium text-slate-500 mb-1">שדה</label>
            <select
              id="blocked-date-scope-field" value={scopeField}
              onChange={e => { setScopeField(e.target.value); setScopeValues([]); }}
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5"
            >
              {SCOPE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <ScopeValuesPicker field={scopeField} values={scopeValues} onChange={setScopeValues} schools={schools} />
        </div>
      )}
      <div className="flex justify-end gap-2 mt-1">
        <button type="button" onClick={onCancel} className="btn-ghost text-sm px-4 py-2">ביטול</button>
        <button type="submit" disabled={saving} className="btn-blue text-sm px-4 py-2 disabled:opacity-60">
          {saving ? "שומר..." : "שמירה"}
        </button>
      </div>
    </form>
  );
}

export default function BlockedDatesModal({ onClose, schools }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  function load() {
    axios.get("/schools/blocked-dates")
      .then(res => setRows(res.data || []))
      .catch(() => setError("טעינת התאריכים החסומים נכשלה"));
  }

  useEffect(load, []);

  async function handleDelete(id) {
    try {
      await axios.delete(`/schools/blocked-dates/${id}`);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch {
      setError("מחיקת הטווח נכשלה, נסה שוב");
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="blocked-dates-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <h2 id="blocked-dates-modal-title" className="font-bold text-slate-900 text-lg">תאריכים חסומים לקביעת פגישות</h2>
        <p className="text-sm text-slate-500 -mt-2">
          תאריך חסום לא יוצג כלל כאפשרות בקישורי תיאום עצמי, באיתור יועץ ובמשימות שמייצרות קישורי תיאום.
          בקביעה ידנית תוצג אזהרה עם אפשרות להמשיך בכל זאת.
        </p>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {rows === null ? (
          <div role="status" aria-label="טוען תאריכים חסומים" className="flex justify-center py-6">
            <div aria-hidden="true" className="spinner w-6 h-6" />
          </div>
        ) : rows.length === 0 && !showAddForm ? (
          <p className="text-sm text-slate-400 text-center py-4">אין תאריכים חסומים מוגדרים</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map(r => (
              <li key={r.id} className="flex items-start justify-between gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{formatRange(r.start_date, r.end_date)}</div>
                  <div className="text-sm text-slate-600">{r.reason}</div>
                  {r.scope_field && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      רק עבור {scopeFieldLabel(r.scope_field)}: {(r.scope_values || []).join(", ")}
                    </div>
                  )}
                </div>
                {pendingDeleteId === r.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => handleDelete(r.id)} className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1">אישור מחיקה</button>
                    <button type="button" onClick={() => setPendingDeleteId(null)} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1">ביטול</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPendingDeleteId(r.id)} aria-label={`מחק תאריך חסום ${formatRange(r.start_date, r.end_date)}`}
                    className="text-slate-400 hover:text-red-600 shrink-0 px-1">
                    <span aria-hidden="true">🗑️</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {showAddForm ? (
          <AddBlockedDateForm
            onCreated={row => { setRows(prev => [...(prev || []), row].sort((a, b) => a.start_date < b.start_date ? -1 : 1)); setShowAddForm(false); }}
            onCancel={() => setShowAddForm(false)}
            schools={schools}
          />
        ) : (
          <button type="button" onClick={() => setShowAddForm(true)} className="btn-ghost text-sm px-4 py-2 self-start">
            <span aria-hidden="true">+</span> הוסף תאריך חסום
          </button>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">סגירה</button>
        </div>
      </div>
    </div>
  );
}
