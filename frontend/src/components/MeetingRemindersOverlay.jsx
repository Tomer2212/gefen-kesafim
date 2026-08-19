import { useState, useCallback } from "react";
import { useMeetingReminders } from "../context/MeetingRemindersContext";
import MeetingReminderPopup from "./MeetingReminderPopup";
import MeetingStatusUpdatePopup from "./MeetingStatusUpdatePopup";
import TaskReminderPopup from "./TaskReminderPopup";

const HEADER_META = {
  status: { icon: "🔔", label: "עדכון סטטוס פגישה", cls: "bg-sky-50 border-sky-100 text-sky-800 hover:bg-sky-100" },
  task: { icon: "✅", label: "משימה לביצוע", cls: "bg-blue-50 border-blue-100 text-blue-800 hover:bg-blue-100" },
  reminder: { icon: "🗓️", label: "תזכורת", cls: "bg-amber-50 border-amber-100 text-amber-800 hover:bg-amber-100" },
};

function ReminderHeaderOnly({ reminder, onClick }) {
  const meta = HEADER_META[reminder._type] || HEADER_META.reminder;

  return (
    <button
      onClick={onClick}
      dir="rtl"
      className={`flex items-center gap-2 border rounded-xl shadow-lg px-4 py-2.5 w-80 max-w-[calc(100vw-2rem)] transition-shadow hover:shadow-xl cursor-pointer ${meta.cls}`}
      aria-label={`הצג: ${meta.label} — ${reminder.school_name || ""}`}
    >
      <span className="text-base flex-shrink-0" aria-hidden="true">{meta.icon}</span>
      <span className="text-sm font-bold flex-1 text-right">
        {meta.label}
        {reminder.school_name && (
          <span className="font-normal text-xs opacity-70 mr-1.5">— {reminder.school_name}</span>
        )}
      </span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="flex-shrink-0 opacity-50">
        <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

export default function MeetingRemindersOverlay() {
  const { reminders, activeKey, setActiveKey, dismiss, userName } = useMeetingReminders();
  const [successToasts, setSuccessToasts] = useState([]);

  const showSuccess = useCallback((msg) => {
    const id = Date.now();
    setSuccessToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setSuccessToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  if (!reminders.length && !successToasts.length) return null;

  // Render newest first in DOM (top of container) → oldest last (bottom of container = closest to screen)
  const ordered = [...reminders].reverse();

  return (
    <div className="fixed bottom-4 left-4 z-[52] flex flex-col gap-1.5 items-start">
      {successToasts.map(t => (
        <div
          key={t.id}
          role="status"
          dir="rtl"
          className="flex items-center gap-2 bg-white border border-green-200 rounded-xl shadow-lg px-4 py-2.5 w-80 max-w-[calc(100vw-2rem)]"
        >
          <span aria-hidden="true" className="text-base flex-shrink-0">✅</span>
          <p className="text-sm font-medium text-green-800">{t.msg}</p>
        </div>
      ))}

      {ordered.map(r => {
        if (r._key !== activeKey) {
          return (
            <ReminderHeaderOnly
              key={r._key}
              reminder={r}
              onClick={() => setActiveKey(r._key)}
            />
          );
        }
        const onDismiss = () => dismiss(r._key);
        if (r._type === "task") {
          return <TaskReminderPopup key={r._key} reminder={r} onDismiss={onDismiss} />;
        }
        return r._type === "reminder"
          ? <MeetingReminderPopup key={r._key} reminder={r} onDismiss={onDismiss} onSuccess={showSuccess} />
          : <MeetingStatusUpdatePopup key={r._key} reminder={r} onDismiss={onDismiss} userName={userName} onSuccess={showSuccess} />;
      })}
    </div>
  );
}
