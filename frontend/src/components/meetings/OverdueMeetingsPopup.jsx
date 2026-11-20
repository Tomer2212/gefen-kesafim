import { useFocusTrap } from "../../hooks/useFocusTrap";
import OverdueMeetingsPanel from "./OverdueMeetingsPanel";

// Opened by the Sidebar poll when GET /schools/meetings/overdue-status/my says a window's alert
// hasn't been shown yet (the poll marks it shown, so it opens once — on any device).
export default function OverdueMeetingsPopup({ mode = "personal", onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const summary = mode === "summary";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="overdue-popup-title" onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-5xl max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <div>
          <h2 id="overdue-popup-title" className="font-bold text-slate-900 text-lg">
            {summary ? "סיכום: פגישות שהתאריך שלהן עבר ועדיין בסטטוס 'נקבעה'" : "פגישות שהתאריך שלהן עבר ועדיין בסטטוס 'נקבעה'"}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {summary
              ? "לכל משתמש: כמה פגישות שלו לא עודכנו. לחיצה על משתמש מציגה את הפגישות ומאפשרת לעדכן אותן."
              : "המערכת לא זיהתה שיחות או עבודה עצמית לפגישות האלה, והסטטוס שלהן לא עודכן. מה קרה בכל פגישה?"}
          </p>
        </div>
        <OverdueMeetingsPanel mode={mode} onEmpty={onClose} />
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">אחר כך (נשאר בהתראות)</button>
        </div>
      </div>
    </div>
  );
}
