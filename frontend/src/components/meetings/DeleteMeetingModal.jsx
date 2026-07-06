import { useFocusTrap } from "../../hooks/useFocusTrap";

export function DeleteMeetingModal({ onConfirm, onCancel, confirmText, titleText }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="del-meeting-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] flex flex-col gap-4">
        <h2 id="del-meeting-title" className="text-base font-bold text-slate-800 text-center">{titleText || "מחיקת פגישה"}</h2>
        <p className="text-sm text-slate-600 text-center">{confirmText || "האם למחוק את הפגישה לצמיתות? לא ניתן לשחזר פעולה זו."}</p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onConfirm}
            className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
            מחק
          </button>
          <button type="button" onClick={onCancel}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
