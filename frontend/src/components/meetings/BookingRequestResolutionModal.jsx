import { useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// "מחליפה או נוספת?" — opened by MeetingRow when a save of a staff-made meeting returns
// open_booking_requests: the school still has an open booking request (a task's or a direct-
// coordination link) whose dates include this meeting's date. Only the person booking knows
// whether this meeting is that request done another way (e.g. by phone) or an extra one; the
// answer decides whether the link closes, whether the task counts it, and whether the advisor's
// calendar keeps room for it ("יומן יעיל"). See backend/booking_requests.py.
// Portaled to <body> (MeetingRow renders inside a <tr>).

const SERVICE_LABELS = { gefen: "גפן", current: "שוטף", gefen_current: "גפן+שוטף", district: "מחוז", takuma: "תקומה" };

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export default function BookingRequestResolutionModal({ schoolId, meetingId, schoolName, requests, clientSurface, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [answered, setAnswered] = useState({}); // {token_id:range_key: "replaces" | "additional"}
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState("");

  async function answer(req, decision) {
    const key = `${req.token_id}:${req.range_key}`;
    setSavingKey(key);
    setError("");
    try {
      await axios.post(`/schools/${schoolId}/meetings/${meetingId}/booking-request-resolutions`,
        { token_id: req.token_id, range_key: req.range_key, decision },
        clientSurface ? { headers: { "X-Client-Surface": clientSurface } } : undefined);
      const next = { ...answered, [key]: decision };
      setAnswered(next);
      if (requests.every(r => next[`${r.token_id}:${r.range_key}`])) onClose();
    } catch {
      setError("שמירת הבחירה נכשלה — נסו שוב.");
    } finally {
      setSavingKey(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" dir="rtl"
      onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="booking-request-resolution-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <h2 id="booking-request-resolution-title" className="text-base font-bold text-slate-800">
          לבית הספר{schoolName ? ` ${schoolName}` : ""} יש בקשה פתוחה לקביעת פגישה
        </h2>
        <p className="text-sm text-slate-600">
          בית הספר עדיין מתבקש לקבוע פגישה דרך לינק, בטווח התאריכים של הפגישה שאתה קובע עכשיו.
          האם הפגישה הזו באה <b>במקום</b> הבקשה (למשל, נקבעה בטלפון), או שזו <b>פגישה נוספת</b>?
        </p>

        {requests.map(req => {
          const key = `${req.token_id}:${req.range_key}`;
          const done = answered[key];
          return (
            <section key={key} className="rounded-xl border border-slate-200 p-3.5 flex flex-col gap-2.5">
              <p className="text-sm text-slate-800">
                <b>{req.label || `פגישת ${SERVICE_LABELS[req.service_type] || ""}`}</b>
                {" "}בין <bdi>{formatDate(req.start_date)}</bdi> ל-<bdi>{formatDate(req.end_date)}</bdi>
                <span className="text-slate-500"> · {req.task_name ? `משימה: ${req.task_name}` : "תיאום עצמי"}</span>
              </p>
              {done ? (
                <p role="status" className="text-xs font-semibold text-emerald-700">
                  ✓ נשמר: {done === "replaces" ? "הפגישה מחליפה את הבקשה" : "פגישה נוספת — הבקשה נשארת פתוחה"}
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button type="button" disabled={!!savingKey} onClick={() => answer(req, "replaces")}
                    className="text-right rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-100 px-3 py-2 disabled:opacity-50">
                    <span className="block text-sm font-semibold text-blue-900">מחליפה את הבקשה</span>
                    <span className="block text-[11px] text-blue-800">הבקשה נסגרת: בית הספר לא יתבקש לקבוע דרך הלינק, והמשימה תיחשב כהושלמה עבורו.</span>
                  </button>
                  <button type="button" disabled={!!savingKey} onClick={() => answer(req, "additional")}
                    className="text-right rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-2 disabled:opacity-50">
                    <span className="block text-sm font-semibold text-slate-800">פגישה נוספת</span>
                    <span className="block text-[11px] text-slate-600">הבקשה נשארת פתוחה, ובית הספר עדיין יתבקש לקבוע דרך הלינק.</span>
                  </button>
                </div>
              )}
            </section>
          );
        })}

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <p className="text-[11px] text-slate-500">הבחירה נרשמת ב"תיעוד פעילות" של הפגישה.</p>
        <button type="button" onClick={onClose}
          className="self-center px-5 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
          אחליט אחר כך
        </button>
      </div>
    </div>,
    document.body,
  );
}
