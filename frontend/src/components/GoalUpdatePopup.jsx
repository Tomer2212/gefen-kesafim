import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const DIVISION_LABELS = {
  tikkon: "תיכון",
  beinayim: "חטיבת ביניים",
  yesodi: "יסודי",
  other: "אחר",
};

// "X יעדים עודכנו אוטומטית לפי בדיקה" — ephemeral bottom-left popup (no bell entry).
// Same visual shell as the meeting-reminder popups; expandable list of exactly which
// goals changed, plus "אישור" (marks the backing notification read + closes) and
// "מעבר ליעדים".
export default function GoalUpdatePopup({ reminder, onDismiss }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const goals = Array.isArray(reminder.goals) ? reminder.goals : [];

  function ack() {
    if (reminder.id) axios.patch(`/schools/notifications/${reminder.id}/read`).catch(() => {});
    onDismiss();
  }

  function goToGoals() {
    if (reminder.id) axios.patch(`/schools/notifications/${reminder.id}/read`).catch(() => {});
    navigate(reminder.deeplink || `/school/${reminder.school_id}?tab=goals`);
    onDismiss();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`goal-update-title-${reminder._key}`}
      dir="rtl"
      className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
    >
      <div className="bg-emerald-50 border-b border-emerald-100 px-4 py-2.5 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">🎯</span>
        <h3 id={`goal-update-title-${reminder._key}`} className="text-sm font-bold text-emerald-800 flex-1">
          עדכון יעדים
        </h3>
        <button
          aria-label="סגור התראה"
          onClick={ack}
          className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-slate-700">{reminder.title}</p>
        {reminder.school_name && (
          <p className="text-xs text-slate-400 mt-0.5">{reminder.school_name}</p>
        )}

        {goals.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"
            >
              {expanded ? "הסתר פירוט" : "הצג פירוט"}
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
                <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {expanded && (
              <ul className="mt-2 flex flex-col gap-1.5 max-h-52 overflow-y-auto pl-1">
                {goals.map((g, i) => (
                  <li key={i} className="text-xs text-slate-600 leading-snug border-r-2 border-slate-100 pr-2">
                    <span className={g.met ? "text-green-600 font-semibold" : "text-red-500 font-semibold"}>
                      {g.met ? "כן" : "לא"}
                    </span>
                    {" · "}
                    {g.label}
                    <span className="text-slate-400">
                      {" — "}
                      {DIVISION_LABELS[g.division_type] || g.division_type}
                      {g.budget_name ? ` / ${g.budget_name}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 mt-3">
          <button
            onClick={ack}
            className="text-xs font-medium px-2 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap transition-colors"
          >
            אישור
          </button>
          <button
            onClick={goToGoals}
            className="text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors"
          >
            מעבר ליעדים
          </button>
        </div>
      </div>
    </div>
  );
}
