import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
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

function ScopeValuesPicker({ field, values, onChange }) {
  const def = SCOPE_FIELDS.find(f => f.value === field);
  const [freeTextInput, setFreeTextInput] = useState("");
  if (!def) return null;

  if (def.freeText) {
    return (
      <div>
        <label htmlFor="blocked-date-scope-value-input" className="block text-xs font-medium text-slate-500 mb-1">
          {`ערכים חסומים עבור "${def.label}"`}
        </label>
        <div className="flex gap-2">
          <input
            id="blocked-date-scope-value-input" type="text" value={freeTextInput}
            onChange={e => setFreeTextInput(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = freeTextInput.trim();
              if (v && !values.includes(v)) onChange([...values, v]);
              setFreeTextInput("");
            }}
            placeholder="הקלד ערך ולחץ Enter"
            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5"
          />
        </div>
        {values.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {values.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-full px-2.5 py-1">
                {v}
                <button type="button" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`הסר ${v}`} className="text-slate-400 hover:text-red-600">×</button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
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

function AddBlockedDateForm({ onCreated, onCancel }) {
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
          <ScopeValuesPicker field={scopeField} values={scopeValues} onChange={setScopeValues} />
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

export default function BlockedDatesModal({ onClose }) {
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
