import { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// Entry-point fork shown before TaskCreateWizard opens — two sequential questions rather than
// one three-option screen (UX refinement after user testing): (1) who is this for — schools
// vs. advisors, (2) only if schools was chosen, what kind of task — scheduling meetings vs.
// sending a message. Deciding this here, before any wizard state exists, keeps the wizard
// itself simple (it always knows exactly which of its two tracks to render).
// The per-advisor path is still a placeholder reserving its future navigation slot.
export default function TaskTypeChooser({ onClose, onChooseSchools }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [level, setLevel] = useState(1);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-type-chooser-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {level === 2 && (
              <button type="button" onClick={() => setLevel(1)} aria-label="חזרה" className="text-slate-400 hover:text-slate-600">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            )}
            <h2 id="task-type-chooser-title" className="font-bold text-black">
              {level === 1 ? "יצירת משימה — מי צריך לבצע אותה?" : "יצירת משימה — מה סוג המשימה?"}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {level === 1 && (
          <div className="p-6 grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={() => setLevel(2)}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
            >
              <div className="font-semibold text-slate-800 mb-1">בתי ספר</div>
              <div className="text-sm text-slate-500">קביעת פגישות או שליחת הודעות לבתי ספר לפי קריטריונים.</div>
            </button>

            <div className="text-right border border-slate-100 rounded-xl p-4 bg-slate-50 opacity-60 cursor-not-allowed" aria-disabled="true">
              <div className="font-semibold text-slate-500 mb-1">משימה על יועץ / קבוצת יועצים <span className="text-xs font-normal">(בקרוב)</span></div>
              <div className="text-sm text-slate-400">הטלת משימה אישית על משתמש במערכת, עם דדליין ומעקב השלמה — בפיתוח.</div>
            </div>
          </div>
        )}

        {level === 2 && (
          <div className="p-6 grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={() => onChooseSchools(true)}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
            >
              <div className="font-semibold text-slate-800 mb-1">קביעת פגישות</div>
              <div className="text-sm text-slate-500">בחירת בתי ספר (סינון או ידנית) ושליחת בקשה לקביעת פגישה — הצלחה נקבעת אוטומטית: נקבעה פגישה בטווח שהוגדר.</div>
            </button>

            <button
              type="button"
              onClick={() => onChooseSchools(false)}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
            >
              <div className="font-semibold text-slate-800 mb-1">שליחת הודעה</div>
              <div className="text-sm text-slate-500">שליחת הודעות לפי קריטריונים לכל מטרה אחרת — למשל "כל מי שלא שלח חוזה". תוכל להגדיר בעצמך מה נחשב הצלחה.</div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
