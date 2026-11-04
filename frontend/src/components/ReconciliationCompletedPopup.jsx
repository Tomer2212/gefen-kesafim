import { useNavigate } from "react-router-dom";
import axios from "axios";

// "הבדיקה עבור X הועלתה בהצלחה/נכשלה" — ephemeral bottom-left popup (no bell entry),
// same visual shell as GoalUpdatePopup. Fired when a background check triggered from a
// meeting-files-arrived notification (run-check-from-uploads) finishes, so the advisor who
// clicked "בצע בדיקה" and immediately navigated away still finds out what happened.
// "needs_classification" means the check isn't saved yet: it waits for rows only the advisor
// can classify, so the deeplink reopens ClassifyModal (resume_run) instead of the history.
export default function ReconciliationCompletedPopup({ reminder, onDismiss }) {
  const navigate = useNavigate();
  const isFailure = reminder.outcome === "failure";
  const needsClassification = reminder.outcome === "needs_classification";
  const heading = isFailure ? "הבדיקה נכשלה" : needsClassification ? "הבדיקה ממתינה לסיווג" : "הבדיקה הושלמה";
  const headerClass = isFailure
    ? "bg-red-50 border-red-100"
    : needsClassification ? "bg-amber-50 border-amber-100" : "bg-emerald-50 border-emerald-100";
  const headingClass = isFailure ? "text-red-800" : needsClassification ? "text-amber-800" : "text-emerald-800";
  const closeClass = isFailure
    ? "text-red-600 hover:text-red-800 p-0.5 rounded"
    : needsClassification ? "text-amber-600 hover:text-amber-800 p-0.5 rounded" : "text-emerald-600 hover:text-emerald-800 p-0.5 rounded";
  const ackClass = isFailure
    ? "text-xs font-medium px-2 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 whitespace-nowrap transition-colors"
    : needsClassification
      ? "text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors"
      : "text-xs font-medium px-2 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap transition-colors";
  const goClass = needsClassification
    ? "text-xs font-medium px-2 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 whitespace-nowrap transition-colors"
    : "text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors";

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
      <div className={`border-b px-4 py-2.5 flex items-center gap-2 ${headerClass}`}>
        <span className="text-base" aria-hidden="true">{isFailure ? "❌" : needsClassification ? "⚠️" : "✅"}</span>
        <h3 id={`reconciliation-title-${reminder._key}`} className={`text-sm font-bold flex-1 ${headingClass}`}>
          {heading}
        </h3>
        <button
          aria-label="סגור התראה"
          onClick={ack}
          className={closeClass}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-slate-700">{reminder.title}</p>
        {isFailure && reminder.reason && (
          <p className="text-xs text-red-600 mt-1.5 leading-relaxed whitespace-pre-line">{reminder.reason}</p>
        )}
        {needsClassification && (
          <p className="text-xs text-amber-800 mt-1.5 leading-relaxed">
            כדי לשמור את הבדיקה יש לסווג {reminder.pending_rows === 1 ? "שורה אחת" : `${reminder.pending_rows} שורות`} שהמערכת לא זיהתה.
            אפשר לחזור לזה גם מאוחר יותר דרך ההתראה על הקבצים.
          </p>
        )}
        {reminder.skipped_files?.length > 0 && (
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            קבצים שלא זוהו ולא נכללו בבדיקה: {reminder.skipped_files.join(", ")}
          </p>
        )}

        <div className="grid grid-cols-2 gap-1.5 mt-3">
          <button
            onClick={ack}
            className={ackClass}
          >
            {needsClassification ? "אחר כך" : "אישור"}
          </button>
          <button
            onClick={goToChecks}
            className={goClass}
          >
            {needsClassification ? "השלמת הסיווג" : "מעבר לבדיקה"}
          </button>
        </div>
      </div>
    </div>
  );
}
