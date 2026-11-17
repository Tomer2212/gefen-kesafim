import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

// School card strip for the national directory ("מאגר בתי ספר"):
// - a 'directory' copy (not in the client list): "מהמאגר – לא ברשימת הלקוחות" + "הוסף לרשימת הלקוחות"
// - a client linked to the directory: "החזר למאגר" (hides it from lists; history stays)
// Both actions are manager+ (the server enforces it too).
function AddToClientsModal({ schoolId, academicYear, onDone, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [clientStatus, setClientStatus] = useState("in_progress");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await axios.post(`/directory/client-list/${schoolId}`, { action: "add", client_status: clientStatus, academic_year: academicYear });
      onDone({ status: "active", client_status: clientStatus });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError((typeof detail === "string" ? detail : detail?.message) || "הפעולה נכשלה. נסו שוב.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="add-to-clients-title" onKeyDown={handleKeyDown}
        onMouseDown={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" dir="rtl">
        <h2 id="add-to-clients-title" className="text-lg font-bold text-slate-900 mb-2">הוספה לרשימת הלקוחות</h2>
        <p className="text-sm text-slate-600 mb-4">
          בית הספר יופיע בלוח הבית, במשימות ובסבבים כמו כל לקוח. הפגישות, השיחות והבדיקות שכבר תועדו נשארות בכרטיס.
        </p>
        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-slate-700 mb-2">סטטוס לקוח ({academicYear})</legend>
          {[["in_progress", "בתהליך"], ["active", "פעיל (דורש יועץ מלווה בפרטי הליווי)"]].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-slate-700 mb-1.5">
              <input type="radio" name="client-status" value={value} checked={clientStatus === value} onChange={() => setClientStatus(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">ביטול</button>
          <button type="button" disabled={busy} onClick={submit}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {busy ? "שומר…" : "הוסף לרשימת הלקוחות"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SchoolDirectoryBanner({ school, role, academicYear, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canManage = role === "owner" || role === "manager";
  if (!school) return null;
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
      {canManage && (
        <button type="button" onClick={() => setAdding(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          הוסף לרשימת הלקוחות
        </button>
      )}
      {adding && (
        <AddToClientsModal schoolId={school.id} academicYear={academicYear}
          onClose={() => setAdding(false)}
          onDone={change => { setAdding(false); onChanged(change); }} />
      )}
    </div>
  );
}
