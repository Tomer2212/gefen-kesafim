import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

const TYPE_ICONS = {
  update_request_submitted: "✏️",
  update_request_approved:  "✅",
  update_request_rejected:  "❌",
  mention:                  "💬",
  advisor_assigned:         "🏫",
  advisor_removed:          "🚪",
  school_deleted:           "🗑️",
  meeting_reminder:         "🗓️",
  meeting_status_updated:   "✅",
};

function Toast({ notif, onDismiss }) {
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(notif.id), notif.duration || 6000);
    return () => clearTimeout(timerRef.current);
  }, [notif.id, onDismiss]);

  const title  = notif.data?.title  || "התראה חדשה";
  const school = notif.data?.school_name || "";
  const icon   = TYPE_ICONS[notif.type] || "🔔";
  const deeplink = notif.data?.deeplink;

  function handleClick() {
    onDismiss(notif.id);
    navigate(deeplink || "/notifications");
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 w-80 max-w-[calc(100vw-2rem)] cursor-pointer hover:shadow-xl transition-shadow animate-slide-in-left"
      onClick={handleClick}
    >
      <span className="text-xl mt-0.5 flex-shrink-0" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 leading-tight line-clamp-2">{title}</p>
        {school && <p className="text-xs text-slate-500 mt-0.5 truncate">{school}</p>}
      </div>
      <button
        aria-label="סגור התראה"
        className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5 p-0.5 rounded"
        onClick={(e) => { e.stopPropagation(); onDismiss(notif.id); }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
          <path d="M10.5 1.5L1.5 10.5M1.5 1.5L10.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

export default function NotificationToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  const visible = toasts.slice(0, 3);
  const extra   = toasts.length - visible.length;
  const navigate = useNavigate();

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 items-start"
      dir="rtl"
    >
      {visible.map((t) => (
        <Toast key={t.id} notif={t} onDismiss={onDismiss} />
      ))}
      {extra > 0 && (
        <button
          className="text-xs text-blue-600 underline mr-1"
          onClick={() => { toasts.forEach(t => onDismiss(t.id)); navigate("/notifications"); }}
        >
          ועוד {extra} התראות נוספות
        </button>
      )}
    </div>
  );
}
