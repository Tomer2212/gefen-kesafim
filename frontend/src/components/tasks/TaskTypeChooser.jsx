import { useState } from "react";
import { School, UserCog, CalendarClock, MessageSquareText } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// Entry-point fork shown before TaskCreateWizard/PersonTaskCreateWizard opens — two sequential
// questions rather than one three-option screen (UX refinement after user testing): (1) who is
// this for — schools vs. org staff, (2) only if schools was chosen, what kind of task —
// scheduling meetings vs. sending a message. Deciding this here, before any wizard state
// exists, keeps each wizard simple (it always knows exactly which track to render).
export default function TaskTypeChooser({ onClose, onChooseSchools, onChooseUsers }) {
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4"
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
              {level === 1 ? "משימה חדשה — מי צריך לבצע אותה?" : "משימה חדשה — מה סוג המשימה?"}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {level === 1 && (
          <div className="p-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setLevel(2)}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800 mb-1">בתי ספר</div>
                <div className="text-sm text-slate-500 space-y-0.5">
                  <div>קביעת פגישות</div>
                  <div>שליחת הודעות</div>
                </div>
              </div>
              <School aria-hidden="true" className="text-blue-500 shrink-0" size={28} strokeWidth={1.75} />
            </button>

            <button
              type="button"
              onClick={() => onChooseUsers()}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800 mb-1">יועצים</div>
                <div className="text-sm text-slate-500">יועץ ספציפי / כלל היועצים המלווים מסוג מסוים [גפן, שוטף, מחוז]</div>
              </div>
              <UserCog aria-hidden="true" className="text-blue-500 shrink-0" size={28} strokeWidth={1.75} />
            </button>
          </div>
        )}

        {level === 2 && (
          <div className="p-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onChooseSchools(true)}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800 mb-1">קביעת פגישות</div>
                <div className="text-sm text-slate-500">שיבוץ עצמי של בתי הספר בטווח תאריכים מוגדר מראש.</div>
              </div>
              <CalendarClock aria-hidden="true" className="text-blue-500 shrink-0" size={28} strokeWidth={1.75} />
            </button>

            <button
              type="button"
              onClick={() => onChooseSchools(false)}
              className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800 mb-1">שליחת הודעה</div>
                <div className="text-sm text-slate-500">תפוצה רחבה לבתי ספר לפי סינון מדויק.</div>
              </div>
              <MessageSquareText aria-hidden="true" className="text-blue-500 shrink-0" size={28} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
