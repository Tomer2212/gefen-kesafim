import { useNavigate } from "react-router-dom";
import axios from "axios";

// "הבדיקה עבור X הועלתה בהצלחה/נכשלה" — ephemeral bottom-left popup (no bell entry),
// same visual shell as GoalUpdatePopup. Fired when a background check triggered from a
// meeting-files-arrived notification (run-check-from-uploads) finishes, so the advisor who
// clicked "בצע בדיקה" and immediately navigated away still finds out what happened.
export default function ReconciliationCompletedPopup({ reminder, onDismiss }) {
  const navigate = useNavigate();
  const isFailure = reminder.outcome === "failure";

  function ack() {
    if (reminder.id) axios.patch(`/schools/notifications/${reminder.id}/read`).catch(() => {});
    onDismiss();
  }

  function goToChecks() {
    if (reminder.id) axios.patch(`/schools/notifications/${reminder.id}/read`).catch(() => {});
    navigate(reminder.deeplink || `/school/${reminder.school_id}?tab=checks`);
    onDismiss();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`reconciliation-title-${reminder._key}`}
      dir="rtl"
      className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
    >
      <div className={`border-b px-4 py-2.5 flex items-center gap-2 ${isFailure ? "bg-red-50 border-red-100" : "bg-emerald-50 border-emerald-100"}`}>
        <span className="text-base" aria-hidden="true">{isFailure ? "❌" : "✅"}</span>
        <h3 id={`reconciliation-title-${reminder._key}`} className={`text-sm font-bold flex-1 ${isFailure ? "text-red-800" : "text-emerald-800"}`}>
          {isFailure ? "הבדיקה נכשלה" : "הבדיקה הושלמה"}
        </h3>
        <button
          aria-label="סגור התראה"
          onClick={ack}
          className={isFailure ? "text-red-600 hover:text-red-800 p-0.5 rounded" : "text-emerald-600 hover:text-emerald-800 p-0.5 rounded"}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-slate-700">{reminder.title}</p>
        {isFailure && reminder.reason && (
          <p className="text-xs text-red-600 mt-1.5 leading-relaxed">{reminder.reason}</p>
        )}

        <div className="grid grid-cols-2 gap-1.5 mt-3">
          <button
            onClick={ack}
            className={isFailure
              ? "text-xs font-medium px-2 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 whitespace-nowrap transition-colors"
              : "text-xs font-medium px-2 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap transition-colors"}
          >
            אישור
          </button>
          <button
            onClick={goToChecks}
            className="text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors"
          >
            מעבר לבדיקה
          </button>
        </div>
      </div>
    </div>
  );
}
