import { useState } from "react";
import axios from "axios";

// School card strip for the national directory ("מאגר בתי ספר"):
// - a 'directory' copy (not in the client list): "מהמאגר – לא ברשימת הלקוחות" + "הוסף לרשימת הלקוחות",
//   which opens the card's onboarding mode (fill the mandatory fields, then add) — anyone allowed
//   to add schools; hidden while that mode is open (its own panel takes over).
// - a client linked to the directory: "החזר למאגר" (hides it from lists; history stays) — manager+.
// The server enforces both permissions too.
export default function SchoolDirectoryBanner({ school, role, canAddSchool, onboarding, onStartOnboarding, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canManage = role === "owner" || role === "manager";
  if (!school || onboarding) return null;
  const isCopy = school.status === "directory";
  if (!isCopy && !(canManage && school.directory_linked && school.status === "active")) return null;

  async function returnToDirectory() {
    if (!window.confirm("להחזיר את בית הספר למאגר? הוא ייעלם מלוח הבית, מהמשימות ומהסבבים. כל מה שתועד בכרטיס נשמר.")) return;
    setBusy(true);
    setError("");
    try {
      await axios.post(`/directory/client-list/${school.id}`, { action: "return" });
      onChanged({ status: "directory" });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError((typeof detail === "string" ? detail : detail?.message) || "הפעולה נכשלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  if (!isCopy) {
    return (
      <div className="mb-4 flex items-center justify-end gap-3">
        {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
        <button type="button" disabled={busy} onClick={returnToDirectory}
          className="text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-50">
          החזר למאגר
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-blue-900">בית ספר מהמאגר – לא ברשימת הלקוחות</p>
        <p className="text-xs text-blue-800/80">הכרטיס הזה פרטי לארגון שלכם. הוא לא מופיע בלוח הבית, במשימות ובסבבים.</p>
      </div>
      {canAddSchool && (
        <button type="button" onClick={onStartOnboarding}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          הוסף לרשימת הלקוחות
        </button>
      )}
    </div>
  );
}
