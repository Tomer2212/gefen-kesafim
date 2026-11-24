import { useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// "מחק" on a meeting with more than one performing advisor. An advisor can only remove themselves
// (the meeting stays with the others); an owner/manager may also delete it for everyone. The
// server enforces it (schools_router.delete_meeting, 409 multiple_advisors).
// advisors: [{id, full_name}]. onLeave / onDeleteAll return promises; a rejection is shown here.
export default function SharedMeetingDeleteModal({ advisors, currentUserId, isManager, onLeave, onDeleteAll, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { ref, handleKeyDown } = useFocusTrap(() => { if (!busy) onClose(); });
  const isMine = advisors.some(a => a.id === currentUserId);
  const names = list => list.map(a => a.full_name || "משתמש").join(", ");
  const others = advisors.filter(a => a.id !== currentUserId);

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError((typeof detail === "string" ? detail : detail?.message) || "הפעולה נכשלה, נסה שוב");
      setBusy(false);
    }
  }

  const deleteAllButton = (
    <button type="button" onClick={() => run(onDeleteAll)} disabled={busy}
      className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium text-sm transition-colors">
      מחק את הפגישה לכולם
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="shared-delete-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <h2 id="shared-delete-title" className="text-base font-bold text-slate-900">
          {isManager ? "בפגישה זו יש יותר מיועץ מבצע אחד" : "לא ניתן למחוק את הפגישה"}
        </h2>
        {isMine ? (
          <p className="text-sm text-slate-700">
            {isManager ? `מלבדך, יועצים מבצעים בפגישה: ${names(others)}. ` : `הפגישה לא ניתנת למחיקה מלאה, משום שמלבדך יש בה יועצים מבצעים נוספים: ${names(others)}. `}
            ניתן להסיר <b>רק אותך</b>, והפגישה תישאר כרגיל אצל {names(others)}.
          </p>
        ) : (
          <p className="text-sm text-slate-700">הפגישה תימחק לצמיתות אצל כל היועצים המבצעים: <b>{names(advisors)}</b>, וגם מהיומנים שלהם.</p>
        )}
        {isMine && isManager && (
          <p className="text-xs text-red-700">מחיקה לכולם תסיר את הפגישה לצמיתות גם אצל {names(others)} ומהיומנים שלהם.</p>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-col gap-2">
          {isMine && (
            <button type="button" onClick={() => run(onLeave)} disabled={busy} className="btn-blue w-full text-sm px-4 py-2.5">
              הסר אותי בלבד
            </button>
          )}
          {isManager && deleteAllButton}
          <button type="button" onClick={onClose} disabled={busy}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
