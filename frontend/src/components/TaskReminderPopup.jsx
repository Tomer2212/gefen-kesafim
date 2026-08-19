import { useNavigate } from "react-router-dom";

// "יש לך משימה" — fires alongside MeetingReminderPopup (same instant, see Sidebar.jsx's
// checkMeetingReminders) when the current user has an active, not-yet-completed person-task
// target for the meeting's school. Same visual shell as MeetingReminderPopup.jsx (bottom-left
// toast stack), distinct blue header so the two are visually distinguishable when stacked.
export default function TaskReminderPopup({ reminder, onDismiss }) {
  const navigate = useNavigate();
  const taskNames = reminder.task_names || [];
  const summary = taskNames.length === 1
    ? `יש לך משימה פעילה לביצוע עבור בית הספר ${reminder.school_name}: "${taskNames[0]}".`
    : `יש לך ${taskNames.length} משימות פעילות לביצוע עבור בית הספר ${reminder.school_name}.`;

  function handleGoToSchool() {
    navigate(`/school/${reminder.school_id}?tab=tasks`);
    onDismiss();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`task-reminder-title-${reminder._key}`}
      dir="rtl"
      className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
    >
      <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">✅</span>
        <h3 id={`task-reminder-title-${reminder._key}`} className="text-sm font-bold text-blue-800 flex-1">
          משימה לביצוע
        </h3>
        <button
          aria-label="סגור תזכורת"
          onClick={onDismiss}
          className="text-blue-600 hover:text-blue-800 p-0.5 rounded"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-slate-700 mb-3">{summary}</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={onDismiss}
            className="text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors"
          >
            סגור
          </button>
          <button
            onClick={handleGoToSchool}
            className="text-xs font-medium px-2 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap transition-colors"
          >
            מעבר למשימות ביה"ס
          </button>
        </div>
      </div>
    </div>
  );
}
