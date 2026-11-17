import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

// "ייבוא פרטים מקובץ של הארגון": the org's own Excel (by "סמל מוסד") fills its own directory
// copies. The org confirms it may use the data (recorded server-side). Clients are never changed.
export default function DirectoryOrgImportModal({ onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [file, setFile] = useState(null);
  const [rights, setRights] = useState(false);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(apply) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("apply", apply ? "true" : "false");
      form.append("rights_confirmed", rights ? "true" : "false");
      // A whole-country file takes about a minute to apply — longer than the default 45 s.
      const res = await axios.post("/directory/org-import", form, { timeout: 300000 });
      setSummary(res.data);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : detail?.problems?.join(" · ") || "הייבוא נכשל. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="org-import-title" onKeyDown={handleKeyDown}
        onMouseDown={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" dir="rtl">
        <h2 id="org-import-title" className="text-lg font-bold text-slate-900 mb-2">ייבוא פרטים מקובץ של הארגון</h2>
        <p className="text-sm text-slate-600 mb-3">
          הקובץ מעדכן רק את העותקים של הארגון שלכם, לפי עמודת "סמל מוסד". תאים ריקים לא מוחקים מידע, ובתי ספר שכבר ברשימת הלקוחות לא משתנים.
          עמודות מוכרות: שם מוסד, עיר, כתובת, מחוז, טלפון בית הספר, ושם/טלפון/מייל של מנהל/ת, מנהלנ/ית ואחראי/ת כספים.
        </p>
        <label htmlFor="org-import-file" className="block text-sm text-slate-700 mb-1">קובץ אקסל</label>
        <input id="org-import-file" type="file" accept=".xlsx" className="text-sm mb-3"
          onChange={e => { setFile(e.target.files?.[0] || null); setSummary(null); }} />
        <label className="flex items-start gap-2 text-sm text-slate-700 mb-4">
          <input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} className="mt-1" />
          אני מאשר/ת שלארגון יש זכות להשתמש בנתונים שבקובץ. האישור נשמר יחד עם שמי, התאריך והקובץ.
        </label>

        {summary && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 mb-4">
            <p className="font-semibold mb-1">{summary.applied ? "הייבוא בוצע" : "תצוגה מקדימה – עדיין לא נשמר דבר"}</p>
            <ul className="space-y-0.5">
              <li>שורות בקובץ: {summary.rows}</li>
              <li>{summary.applied ? "נוצרו" : "ייווצרו"} עותקים חדשים: {summary.create}</li>
              <li>{summary.applied ? "עודכנו" : "יעודכנו"} עותקים קיימים: {summary.update}</li>
              <li>בתי ספר ברשימת הלקוחות (לא ישתנו): {summary.skipped_clients}</li>
              <li>סמלים שלא נמצאו במאגר: {summary.not_in_directory}</li>
            </ul>
            {summary.columns?.length > 0 && <p className="text-xs text-slate-500 mt-1">עמודות שזוהו: {summary.columns.join(", ")}</p>}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">
            {summary?.applied ? "סגירה" : "ביטול"}
          </button>
          {!summary?.applied && (
            <button type="button" disabled={!file || !rights || busy} onClick={() => send(!!summary)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy ? (summary ? "מייבא… (קובץ גדול יכול לקחת כדקה)" : "בודק…") : summary ? "בצע ייבוא" : "בדוק קובץ"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
