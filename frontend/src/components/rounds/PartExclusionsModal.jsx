import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { PLAN_PART_LABELS } from "./roundsShared";

// "התאמת פגישות" — which of the meetings its card asks the round doesn't need from one school
// (PATCH /rounds/{id}/part-exclusions/{school_id}, meeting_rounds.part_exclusions). Saved on the
// round at once, so every task of the round follows it — also tasks already sent.
export default function PartExclusionsModal({ roundId, school, names, onSaved, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const options = school.part_options || [];
  const [excluded, setExcluded] = useState(() => new Set(school.excluded_parts || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const newlyExcluded = [...excluded].filter(p => !(school.excluded_parts || []).includes(p));

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await axios.patch(`/rounds/${roundId}/part-exclusions/${school.school_id}`, {
        parts: options.map(o => o.part).filter(p => excluded.has(p)),
      });
      onSaved(r.data);
    } catch (e) {
      setError(typeof e.response?.data?.detail === "string" ? e.response.data.detail : "השמירה נכשלה — נסו שוב.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="part-exclusions-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-3 text-sm">
        <h2 id="part-exclusions-title" className="text-base font-bold text-slate-800">התאמת פגישות — {school.school_name}</h2>
        <p className="text-slate-600">אילו פגישות בית הספר צריך בסבב הזה? מה שלא מסומן לא יבוקש ממנו ולא ייספר כחסר.</p>
        {options.length === 0 ? (
          <p className="text-slate-500">לבית הספר אין סוג שירות בכרטיס, ולכן אין פגישות להתאים.</p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">פגישות נדרשות בסבב</legend>
            {options.map(o => {
              const id = `part-${school.school_id}-${o.part}`;
              const advisors = o.advisor_ids.map(a => names[a]).filter(Boolean).join(", ");
              return (
                <label key={o.part} htmlFor={id} className="flex items-center gap-2 cursor-pointer">
                  <input id={id} type="checkbox" className="accent-blue-600" checked={!excluded.has(o.part)}
                    onChange={e => setExcluded(prev => {
                      const n = new Set(prev);
                      e.target.checked ? n.delete(o.part) : n.add(o.part);
                      return n;
                    })} />
                  <span>פגישת {PLAN_PART_LABELS[o.part] || o.part}{advisors ? ` — ${advisors}` : " — אין יועץ בכרטיס"}</span>
                </label>
              );
            })}
          </fieldset>
        )}
        {options.length > 0 && excluded.size === options.length && (
          <p className="text-slate-600">בית הספר לא צריך אף פגישה בסבב — הוא יסומן "לא נדרשת בסבב".</p>
        )}
        {newlyExcluded.length > 0 && (
          <p className="text-amber-800 bg-amber-50 rounded-lg px-3 py-2 text-xs">
            אם כבר נשלחה לבית הספר בקשה לפגישה שביטלתם והיא עוד לא נקבעה — היא תוסר מהקישור. פגישה שכבר נקבעה לא משתנה.
          </p>
        )}
        <p className="text-xs text-slate-500">נשמר בסבב, וחל על כל המשימות שלו.</p>
        {error && <p role="alert" className="text-red-600 text-xs">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end pt-1">
          <button type="button" disabled={saving || options.length === 0} onClick={save}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white disabled:opacity-40">{saving ? "שומר…" : "שמירה"}</button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-50">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// The message after a save: how many requests already sent were taken off the links.
export function partExclusionsSavedNotice(schoolName, result) {
  const n = result?.removed_requests || 0;
  return `הפגישות של ${schoolName} עודכנו בסבב.` + (n === 1 ? " בקשה אחת שכבר נשלחה הוסרה מהקישור." : n > 1 ? ` ${n} בקשות שכבר נשלחו הוסרו מהקישורים.` : "");
}
