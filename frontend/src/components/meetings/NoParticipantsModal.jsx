import { useFocusTrap } from "../../hooks/useFocusTrap";

export function NoParticipantsModal({ onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="no-part-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[360px] flex flex-col gap-4">
        <h2 id="no-part-title" className="text-base font-bold text-slate-800 text-center">לא נבחרו משתתפים</h2>
        <p className="text-sm text-slate-600 text-center leading-relaxed">
          טרם נבחרו משתתפים בפגישה. יש לבחור משתתפים ולנסות מחדש.
        </p>
        <div className="flex justify-center mt-1">
          <button type="button" onClick={onClose}
            className="px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}
