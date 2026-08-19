import { useFocusTrap } from "../../hooks/useFocusTrap";
import TaskDateTimeInput from "./TaskDateTimeInput";

// Extracted from TaskCreateWizard.jsx (was a local, non-exported function) so it can be reused
// as-is by PersonTaskCreateWizard.jsx — same "תזמון" mechanism, same wording, same behavior.
export default function ScheduleCriteriaModal({ value, onChange, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="schedule-criteria-title" onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl w-full max-w-md mx-4 p-6 space-y-3">
        <h3 id="schedule-criteria-title" className="font-bold text-slate-900">תזמון בדיקת הקריטריונים (אופציונלי)</h3>
        <TaskDateTimeInput id="task-scheduled-for-modal" value={value} onChange={onChange} />
        <p className="text-xs text-slate-400">
          אם לא נבחר תאריך — המשימה תיווצר מיד וההודעות יישלחו לכל מי שתואם כרגע. אם נבחר תאריך עתידי — המשימה תיווצר במצב "מתוזמן", ורשימת בתי הספר תיקבע וההודעות יישלחו אוטומטית רק בתאריך שנבחר, לפי מי שיעמוד בקריטריונים אז.
        </p>
        <p className="text-xs text-amber-600">
          לתשומת לבך: ההפעלה בפועל עשויה להתרחש עד כשעה לאחר המועד שנבחר (בהתאם לתדירות הבדיקה האוטומטית של המערכת) — מתאים לתזמון פגישות עתידיות, לא לזמן מדויק לדקה.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          {value && (
            <button type="button" onClick={() => onChange("")} className="text-xs text-slate-500 hover:underline px-2 py-1.5">
              נקה תזמון
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-blue text-sm px-4 py-1.5">אישור</button>
        </div>
      </div>
    </div>
  );
}
