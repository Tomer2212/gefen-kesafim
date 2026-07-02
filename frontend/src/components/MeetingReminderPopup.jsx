import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const MEETING_STATUS_OPTIONS = [
  { value: "scheduled",  label: "נקבעה",  color: "#c2410c", bg: "#fff7ed", dot: "#f97316" },
  { value: "completed",  label: "בוצעה",  color: "#15803d", bg: "#f0fdf4", dot: "#22c55e" },
  { value: "cancelled",  label: "בוטלה",  color: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" },
  { value: "postponed",  label: "נדחתה",  color: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" },
  { value: "other",      label: "אחר",    color: "#475569", bg: "#f8fafc", dot: "#94a3b8" },
];

const SNOOZE_OPTIONS = [5, 10, 15, 30];

const STATUS_LABEL = {
  scheduled: "נקבעה", completed: "בוצעה", cancelled: "בוטלה",
  postponed: "נדחתה", other: "אחר",
};

export default function MeetingReminderPopup({ reminder, onDismiss, onSuccess }) {
  const navigate = useNavigate();
  const [view, setView] = useState("main"); // "main" | "status" | "snooze" | "snooze-confirm"
  const [snoozeMinutes, setSnoozeMinutes] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState(false);

  const minsUntil = Math.ceil(reminder.msUntil / 60000);

  async function handleStatusSelect(status) {
    setStatusUpdating(true);
    setStatusError(false);
    try {
      await axios.put(`/schools/${reminder.school_id}/meetings/${reminder.id}`, { status });
      onSuccess?.(`סטטוס הפגישה עודכן בהצלחה ל${STATUS_LABEL[status] || status}!`);
      onDismiss(reminder.id);
    } catch {
      setStatusError(true);
      setStatusUpdating(false);
    }
  }

  function handleSnoozeSelect(mins) {
    setSnoozeMinutes(mins);
    setView("snooze-confirm");
    const key = `reminder-${reminder.id}-${reminder.meeting_date}-${reminder.start_time}`;
    const meetingTime = new Date(`${reminder.meeting_date}T${reminder.start_time}:00`);
    const showAfter = meetingTime.getTime() - mins * 60000;
    sessionStorage.setItem(key, `snooze:${showAfter}`);
    setTimeout(() => onDismiss(reminder.id), 2000);
  }

  function handleGoToSchool() {
    navigate(`/school/${reminder.school_id}?tab=meetings`);
    onDismiss(reminder.id);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`meeting-reminder-title-${reminder.id}`}
      dir="rtl"
      className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
    >
      <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">🗓️</span>
        <h3
          id={`meeting-reminder-title-${reminder.id}`}
          className="text-sm font-bold text-amber-800 flex-1"
        >
          תזכורת
        </h3>
        <button
          aria-label="סגור תזכורת"
          onClick={() => onDismiss(reminder.id)}
          className="text-amber-600 hover:text-amber-800 p-0.5 rounded"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        {view === "main" && (
          <>
            <p className="text-sm text-slate-700 mb-3">
              פגישה בעוד{" "}
              <span className="font-semibold">{minsUntil}</span>{" "}
              דקות עם בית הספר{" "}
              <span className="font-semibold">{reminder.school_name}</span>.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => onDismiss(reminder.id)}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors"
              >
                סגור
              </button>
              <button
                onClick={handleGoToSchool}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap transition-colors"
              >
                מעבר לכרטיס ביה"ס
              </button>
              <button
                onClick={() => setView("status")}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap transition-colors"
              >
                עדכון סטטוס פגישה
              </button>
              <button
                onClick={() => setView("snooze")}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 whitespace-nowrap transition-colors"
              >
                הזכר בהמשך
              </button>
            </div>
          </>
        )}

        {view === "status" && (
          <>
            <p className="text-xs text-slate-500 mb-2">בחר סטטוס חדש לפגישה:</p>
            <div className="flex flex-col gap-1">
              {MEETING_STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  disabled={statusUpdating}
                  onClick={() => handleStatusSelect(opt.value)}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg text-right flex items-center gap-2 hover:opacity-80 transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: opt.bg, color: opt.color }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: opt.dot }}
                    aria-hidden="true"
                  />
                  {opt.label}
                </button>
              ))}
            </div>
            {statusError && (
              <p role="alert" className="text-xs text-red-500 mt-2">שגיאה בעדכון — נסה שוב</p>
            )}
            <button
              onClick={() => setView("main")}
              className="mt-2 text-xs text-slate-400 hover:text-slate-600"
            >
              ← חזרה
            </button>
          </>
        )}

        {view === "snooze" && (
          <>
            <p className="text-xs text-slate-500 mb-2">קבל תזכורת:</p>
            <div className="flex flex-col gap-1">
              {SNOOZE_OPTIONS.map(mins => (
                <button
                  key={mins}
                  onClick={() => handleSnoozeSelect(mins)}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 text-right transition-colors"
                >
                  {mins} דקות לפני הפגישה
                </button>
              ))}
            </div>
            <button
              onClick={() => setView("main")}
              className="mt-2 text-xs text-slate-400 hover:text-slate-600"
            >
              ← חזרה
            </button>
          </>
        )}

        {view === "snooze-confirm" && (
          <div className="flex flex-col items-center justify-center py-2 gap-2 text-center">
            <span className="text-2xl" aria-hidden="true">✅</span>
            <p className="text-sm font-semibold text-slate-700">
              נשלח לך תזכורת {snoozeMinutes} דקות לפני הפגישה!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
