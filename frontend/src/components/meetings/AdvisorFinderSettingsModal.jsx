import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { MultiSelectChips } from "../MultiSelectChips";

const ROLE_OPTIONS = [
  { value: "owner", label: "בעלים" },
  { value: "manager", label: "מנהל" },
  { value: "advisor", label: "יועץ" },
];

export default function AdvisorFinderSettingsModal({ onClose, users }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [excludedIds, setExcludedIds] = useState([]);
  const [excludedRoles, setExcludedRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get("/schools/advisor-finder/settings")
      .then(res => {
        setExcludedIds(res.data?.advisor_finder_excluded_ids || []);
        setExcludedRoles(res.data?.advisor_finder_excluded_roles || []);
      })
      .catch(() => setError("טעינת ההגדרות נכשלה"))
      .finally(() => setLoading(false));
  }, []);

  // Always sends both fields together (the backend replaces both on every PUT) so a change to
  // one never silently wipes out the other's current value.
  async function save(patch) {
    const nextIds = patch.advisor_finder_excluded_ids ?? excludedIds;
    const nextRoles = patch.advisor_finder_excluded_roles ?? excludedRoles;
    setExcludedIds(nextIds);
    setExcludedRoles(nextRoles);
    setSaving(true);
    setError("");
    try {
      await axios.put("/schools/advisor-finder/settings", {
        advisor_finder_excluded_ids: nextIds,
        advisor_finder_excluded_roles: nextRoles,
      });
    } catch {
      setError("שמירת ההגדרות נכשלה, נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  const userOptions = (users || []).map(u => ({ value: u.id, label: u.full_name || u.email }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="advisor-finder-settings-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-4">
        <h2 id="advisor-finder-settings-title" className="font-bold text-slate-900 text-lg">החרג יועצים מאיתור יועץ</h2>
        <p className="text-sm text-slate-500">משתמשים/סוגי חשבון ברשימות אלו לא יוצגו לעולם בתוצאות איתור יועץ (למשל בעלים/מנהלים שלא אמורים לקיים פגישות עם בתי ספר).</p>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div role="status" aria-label="טוען הגדרות" className="flex justify-center py-6">
            <div aria-hidden="true" className="spinner w-6 h-6" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">החרג סוג חשבון שלם {saving && "(שומר...)"}</span>
              <MultiSelectChips options={ROLE_OPTIONS} selected={excludedRoles}
                onChange={v => save({ advisor_finder_excluded_roles: v })}
                placeholder="בחר סוגי חשבון להחרגה" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">החרג משתמשים ספציפיים {saving && "(שומר...)"}</span>
              <MultiSelectChips options={userOptions} selected={excludedIds}
                onChange={v => save({ advisor_finder_excluded_ids: v })}
                placeholder="בחר משתמשים להחרגה" />
            </div>
          </>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">סגירה</button>
        </div>
      </div>
    </div>
  );
}
