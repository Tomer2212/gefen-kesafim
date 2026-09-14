import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { MultiSelectChips } from "../MultiSelectChips";

const ROLE_OPTIONS = [
  { value: "owner", label: "בעלים" },
  { value: "manager", label: "מנהל" },
  { value: "advisor", label: "יועץ" },
];

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every(v => bSet.has(v));
}

// Mirrors SchoolPage.jsx's UnsavedChangesModal (leaving a school card mid-edit) so closing
// this settings modal with pending exclusion changes behaves the same way everywhere.
function UnsavedExclusionsModal({ onSave, onDiscard, onCancel, saving }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="unsaved-exclusions-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-5">
        <div>
          <h2 id="unsaved-exclusions-title" className="font-bold text-black text-lg">נא לשים לב!</h2>
          <p className="text-sm text-black mt-1">ההחרגות שהגדרת טרם הוחלו, מה ברצונך לעשות?</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onSave} disabled={saving} className="btn-green-light flex-1 whitespace-nowrap text-sm px-4 py-2">
            {saving ? "שומר..." : "החל החרגות"}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn-ghost flex-1 whitespace-nowrap text-sm px-4 py-2">ביטול</button>
          <button onClick={onDiscard} disabled={saving} className="btn-ghost flex-1 whitespace-nowrap text-sm px-4 py-2">אל תשמור</button>
        </div>
      </div>
    </div>
  );
}

export default function AdvisorFinderSettingsModal({ onClose, users }) {
  const [excludedIds, setExcludedIds] = useState([]);
  const [excludedRoles, setExcludedRoles] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [savedRoles, setSavedRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    axios.get("/schools/advisor-finder/settings")
      .then(res => {
        const ids = res.data?.advisor_finder_excluded_ids || [];
        const roles = res.data?.advisor_finder_excluded_roles || [];
        setExcludedIds(ids);
        setExcludedRoles(roles);
        setSavedIds(ids);
        setSavedRoles(roles);
      })
      .catch(() => setError("טעינת ההגדרות נכשלה"))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = !sameSet(excludedIds, savedIds) || !sameSet(excludedRoles, savedRoles);

  const { ref, handleKeyDown } = useFocusTrap(() => attemptClose());

  // Sends both fields together (the backend replaces both on every PUT) so applying one
  // never silently wipes out the other's current draft value.
  async function applyExclusions() {
    setSaving(true);
    setError("");
    try {
      await axios.put("/schools/advisor-finder/settings", {
        advisor_finder_excluded_ids: excludedIds,
        advisor_finder_excluded_roles: excludedRoles,
      });
      setSavedIds(excludedIds);
      setSavedRoles(excludedRoles);
      setConfirmingClose(false);
      onClose();
    } catch {
      setError("שמירת ההחרגות נכשלה, נסה שוב");
      setSaving(false);
    }
  }

  function attemptClose() {
    if (isDirty) setConfirmingClose(true);
    else onClose();
  }

  function discardAndClose() {
    setExcludedIds(savedIds);
    setExcludedRoles(savedRoles);
    setConfirmingClose(false);
    onClose();
  }

  const userOptions = (users || []).map(u => ({ value: u.id, label: u.full_name || u.email }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) attemptClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="advisor-finder-settings-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-4">
        <h2 id="advisor-finder-settings-title" className="font-bold text-black text-lg">החרג יועצים מאיתור יועץ</h2>
        <p className="text-sm text-black">החרגה של משתמשים שלא יופיעו בתוצאות הבדיקה לפי סוג חשבון (בעלים/מנהל) או משתמשים ספציפיים.</p>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div role="status" aria-label="טוען הגדרות" className="flex justify-center py-6">
            <div aria-hidden="true" className="spinner w-6 h-6" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-black">לפי סוג חשבון</span>
              <MultiSelectChips options={ROLE_OPTIONS} selected={excludedRoles}
                onChange={setExcludedRoles}
                placeholder="בחר סוגי חשבון להחרגה" placeholderClassName="text-slate-500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-black">בחירה ידנית</span>
              <MultiSelectChips options={userOptions} selected={excludedIds}
                onChange={setExcludedIds}
                placeholder="בחר משתמשים להחרגה" placeholderClassName="text-slate-500" searchable />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={attemptClose} className="btn-ghost text-sm px-4 py-2">ביטול</button>
          <button type="button" onClick={applyExclusions} disabled={saving || loading}
            className="btn-blue text-sm px-4 py-2 disabled:opacity-50">
            {saving ? "מחיל..." : "אישור"}
          </button>
        </div>
      </div>

      {confirmingClose && (
        <UnsavedExclusionsModal
          saving={saving}
          onSave={applyExclusions}
          onDiscard={discardAndClose}
          onCancel={() => setConfirmingClose(false)}
        />
      )}
    </div>
  );
}
