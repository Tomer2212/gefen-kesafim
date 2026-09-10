import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  MEETING_STATUS_OPTIONS,
  MEETING_TYPE_OPTIONS,
  MEETING_SERVICE_TYPE_OPTIONS,
} from "./constants";

const KEEP_RAW = "__keep__";
const FIELD_META = [
  { key: "status", label: "סטטוס", options: MEETING_STATUS_OPTIONS },
  { key: "meeting_type", label: "מיקום", options: MEETING_TYPE_OPTIONS },
  { key: "meeting_service_type", label: "סוג", options: MEETING_SERVICE_TYPE_OPTIONS },
];

// Standalone screen: map the free-text status / מיקום / סוג values on already-imported
// meetings to canonical values, so filtering works for them. Mirrors the mapping section in
// MeetingImportProblemsModal but operates on data already in the DB (GET unrecognized-values
// / POST remap-values). Opened from the "ניהול פגישות" toolbar.
export default function ImportValueMappingModal({ onClose, onDone }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null); // { status:[{value,count,suggestion}], meeting_type:[...], meeting_service_type:[...] }
  const [choices, setChoices] = useState({}); // `${field}|${value}` -> canonical | KEEP_RAW
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [doneMsg, setDoneMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await axios.get("/schools/meetings/import/unrecognized-values");
        if (alive) setData(res.data);
      } catch (e) {
        if (alive) setError(e?.response?.data?.detail ? String(e.response.data.detail) : "שגיאה בטעינת הערכים");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const meta of FIELD_META) {
      for (const it of (data[meta.key] || [])) {
        out.push({ ...meta, ...it });
      }
    }
    return out;
  }, [data]);

  const anyToMap = rows.length > 0;
  const chosenCount = rows.filter(r => choices[`${r.key}|${r.value}`]).length;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const payload = { status: {}, meeting_type: {}, meeting_service_type: {} };
    for (const r of rows) {
      const c = choices[`${r.key}|${r.value}`];
      if (c && c !== KEEP_RAW) payload[r.key][r.value] = c;
    }
    try {
      const res = await axios.post("/schools/meetings/import/remap-values", payload);
      const total = Object.values(res.data.updated || {}).reduce((a, b) => a + b, 0);
      setDoneMsg(`עודכנו ${total} פגישות.`);
      onDone?.();
    } catch (e) {
      setError(e?.response?.data?.detail ? String(e.response.data.detail) : "שמירת המיפוי נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="value-map-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="value-map-title" className="font-bold text-slate-800">מיפוי ערכים מיובאים</h2>
          <p className="text-xs text-slate-500 mt-1">ערכים חופשיים שיובאו מאקסל ולא זוהו אוטומטית — מיפוי לקטגוריה מוכרת מאפשר לסנן אותם. הניסוח המקורי נשמר.</p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2 text-sm">
          {loading && <p role="status" className="text-slate-400 py-4">טוען...</p>}
          {error && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {doneMsg && <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{doneMsg}</p>}
          {!loading && !error && !anyToMap && !doneMsg && (
            <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">כל הערכים המיובאים מזוהים — אין מה למפות ✓</p>
          )}
          {!doneMsg && rows.map(r => (
            <div key={`${r.key}|${r.value}`} className="flex items-center gap-2 flex-wrap bg-white rounded-lg border border-slate-200 px-2.5 py-2">
              <span className="text-xs text-slate-500">{r.label}:</span>
              <b className="text-xs text-slate-800">"{r.value}"</b>
              <span className="text-xs text-slate-400">({r.count} פגישות)</span>
              <select aria-label={`מיפוי הערך ${r.value}`}
                value={choices[`${r.key}|${r.value}`] ?? (r.suggestion || "")}
                onChange={e => setChoices(prev => ({ ...prev, [`${r.key}|${r.value}`]: e.target.value }))}
                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white mr-auto">
                <option value="" disabled>בחר קטגוריה...</option>
                {r.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                <option value={KEEP_RAW}>השאר כטקסט חופשי</option>
              </select>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">
            {doneMsg ? "סגור" : "ביטול"}
          </button>
          {!doneMsg && anyToMap && (
            <button type="button" onClick={handleSave} disabled={saving || chosenCount === 0}
              className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? "שומר..." : `החל מיפוי (${chosenCount})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
