import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function taskNameTakenMessage(name) {
  return `השם "${name.trim()}" כבר תפוס על ידי משימה אחרת בסבב הזה. יש להגדיר שם אחר למשימה.`;
}

// The server's refusal of a name another task of the same round already has (create / rename).
export function isTaskNameTaken(err) {
  return err?.response?.status === 409 && err.response.data?.detail?.code === "task_name_taken";
}

// A portal, since it also opens from inside a table row (TaskRow).
export default function TaskNameTakenModal({ name, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="task-name-taken-title"
        aria-describedby="task-name-taken-text" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 id="task-name-taken-title" className="font-bold text-slate-800 mb-2">שם המשימה תפוס</h2>
        <p id="task-name-taken-text" className="text-sm text-slate-600 leading-relaxed mb-5">{taskNameTakenMessage(name)}</p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700">
            הבנתי
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
