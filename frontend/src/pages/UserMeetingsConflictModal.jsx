import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { formatMeetingDate } from "../components/meetings/constants";

export default function UserMeetingsConflictModal({ targetUser, meetings, otherUsers, onResolved, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [mode, setMode] = useState("choose"); // choose | transfer | working | done
  const [selectedNewAdvisor, setSelectedNewAdvisor] = useState("");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);

  async function handleTransfer() {
    if (!selectedNewAdvisor) return;
    setMode("working");
    setError("");
    try {
      const res = await axios.post(`/schools/users/${targetUser.id}/meetings/transfer`, { new_advisor_id: selectedNewAdvisor });
      const conflicts = (res.data?.results || []).filter(r => r.conflict);
      setSummary({ type: "transfer", count: res.data?.transferred || 0, conflicts });
      setMode("done");
    } catch (err) {
      setError(err?.response?.data?.detail || "שגיאה בהעברת הפגישות");
      setMode("transfer");
    }
  }

  async function handleCancelMeetings() {
    setMode("working");
    setError("");
    try {
      const res = await axios.post(`/schools/users/${targetUser.id}/meetings/cancel-future`);
      setSummary({ type: "cancel", count: res.data?.cancelled || 0 });
      setMode("done");
    } catch (err) {
      setError(err?.response?.data?.detail || "שגיאה בביטול הפגישות");
      setMode("choose");
    }
  }

  async function handleDownloadPdf() {
    const headers = ["שם מוסד", "עיר", "תאריך", "התחלה", "סיום"];
    const rows = meetings.map(m => [
      m.school_name || "", m.school_city || "",
      m.meeting_date ? formatMeetingDate(m.meeting_date) : "",
      m.start_time || "", m.end_time || "",
    ]);
    try {
      const res = await axios.post(
        "/schools/export-pdf",
        { title: `פגישות עתידיות של ${targetUser.full_name || targetUser.email}`, headers, rows },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = "פגישות_עתידיות.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget && mode !== "working") onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="user-meetings-modal-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 flex flex-col max-h-[85vh]" dir="rtl">
        {mode === "done" ? (
          <>
            <h2 id="user-meetings-modal-title" className="text-lg font-bold text-slate-900 mb-2">בוצע בהצלחה</h2>
            {summary?.type === "transfer" ? (
              <div className="text-sm text-slate-700 mb-4">
                <p>{summary.count} פגישות הועברו בהצלחה.</p>
                {summary.conflicts.length > 0 && (
                  <div role="alert" className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800">
                    <p className="font-semibold mb-1">⚠ שים לב: {summary.conflicts.length} מהפגישות שהועברו מתנגשות עם פגישות קיימות של המשתמש החדש:</p>
                    <ul className="list-disc pr-4">
                      {summary.conflicts.map(c => (
                        <li key={c.meeting_id}>{formatMeetingDate(c.meeting_date)} — {c.school_name}, {c.start_time}–{c.end_time}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-700 mb-4">{summary?.count} פגישות בוטלו ונמחקו, כולל מהיומן החיצוני המחובר.</p>
            )}
            <button onClick={onResolved} className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors">
              המשך למחיקת המשתמש
            </button>
          </>
        ) : (
          <>
            <h2 id="user-meetings-modal-title" className="text-lg font-bold text-slate-900 mb-1">
              ל-{targetUser.full_name || targetUser.email} יש {meetings.length} פגישות עתידיות
            </h2>
            <p className="text-sm text-slate-500 mb-3">לפני מחיקת המשתמש, צריך להחליט מה לעשות עם הפגישות הבאות:</p>

            <div className="overflow-y-auto border border-slate-100 rounded-xl mb-4" style={{ maxHeight: 220 }}>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th scope="col" className="text-right px-3 py-2 font-medium text-slate-600">תאריך</th>
                    <th scope="col" className="text-right px-3 py-2 font-medium text-slate-600">בית ספר</th>
                    <th scope="col" className="text-right px-3 py-2 font-medium text-slate-600">שעות</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map(m => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{m.meeting_date ? formatMeetingDate(m.meeting_date) : "—"}</td>
                      <td className="px-3 py-1.5">{m.school_name}{m.school_city ? `, ${m.school_city}` : ""}</td>
                      <td className="px-3 py-1.5" dir="ltr">{m.start_time}–{m.end_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <div role="alert" className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            {mode === "transfer" ? (
              <div className="flex flex-col gap-2 mb-2">
                <label htmlFor="new-advisor-select" className="text-sm text-slate-700">להעביר את הפגישות למי?</label>
                <select id="new-advisor-select" className="input-field text-sm"
                  value={selectedNewAdvisor} onChange={e => setSelectedNewAdvisor(e.target.value)}>
                  <option value="">בחר משתמש</option>
                  {otherUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                </select>
                <div className="flex gap-2 mt-1">
                  <button onClick={handleTransfer} disabled={!selectedNewAdvisor}
                    className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                    אישור והעברת הפגישות
                  </button>
                  <button onClick={() => setMode("choose")}
                    className="py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors">
                    חזור
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button onClick={() => setMode("transfer")} disabled={mode === "working"}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm transition-colors">
                  העבר את הפגישות למשתמש אחר
                </button>
                <button onClick={handleDownloadPdf}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors">
                  הורד PDF
                </button>
                <button onClick={handleCancelMeetings} disabled={mode === "working"}
                  className="w-full py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors">
                  {mode === "working" ? "מבטל..." : "ביטול הפגישות"}
                </button>
                <button onClick={onClose} className="w-full py-2 text-slate-400 text-xs mt-1">ביטול</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
