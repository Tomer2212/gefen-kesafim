import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";

export default function UserSchoolsConflictModal({ targetUser, schools, otherUsers, onResolved, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [selectedNewAdvisor, setSelectedNewAdvisor] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function handleTransfer() {
    if (!selectedNewAdvisor) return;
    setWorking(true);
    setError("");
    try {
      await axios.post(`/schools/users/${targetUser.id}/schools/transfer`, { new_advisor_id: selectedNewAdvisor });
      onResolved();
    } catch (err) {
      setError(err?.response?.data?.detail || "שגיאה בהעברת בתי הספר");
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget && !working) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="user-schools-modal-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 flex flex-col max-h-[85vh]" dir="rtl">
        <h2 id="user-schools-modal-title" className="text-lg font-bold text-slate-900 mb-1">
          {targetUser.full_name || targetUser.email} הוא היועץ המלווה היחיד של {schools.length} בתי ספר
        </h2>
        <p className="text-sm text-slate-500 mb-3">
          לא ניתן למחוק את המשתמש לפני שמעבירים את בתי הספר הבאים ליועץ אחר — בית ספר לא יכול להישאר ללא יועץ מלווה.
        </p>

        <div className="overflow-y-auto border border-slate-100 rounded-xl mb-4" style={{ maxHeight: 220 }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th scope="col" className="text-right px-3 py-2 font-medium text-slate-600">בית ספר</th>
                <th scope="col" className="text-right px-3 py-2 font-medium text-slate-600">עיר</th>
              </tr>
            </thead>
            <tbody>
              {schools.map(s => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{s.name}</td>
                  <td className="px-3 py-1.5">{s.city || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div role="alert" className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex flex-col gap-2 mb-2">
          <label htmlFor="new-school-advisor-select" className="text-sm text-slate-700">להעביר את בתי הספר האלה למי?</label>
          <select id="new-school-advisor-select" className="input-field text-sm"
            value={selectedNewAdvisor} onChange={e => setSelectedNewAdvisor(e.target.value)}>
            <option value="">בחר משתמש</option>
            {otherUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
          <div className="flex gap-2 mt-1">
            <button onClick={handleTransfer} disabled={!selectedNewAdvisor || working}
              className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
              {working ? "מעביר..." : "אישור והעברת בתי הספר"}
            </button>
            <button onClick={onClose} disabled={working}
              className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-medium transition-colors">
              ביטול
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
