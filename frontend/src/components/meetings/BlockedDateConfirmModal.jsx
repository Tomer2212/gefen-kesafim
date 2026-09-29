import { useFocusTrap } from "../../hooks/useFocusTrap";

export default function BlockedDateConfirmModal({ reason, onKeepAnyway, onPickAnother, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="blocked-date-confirm-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-4">
        <h2 id="blocked-date-confirm-title" className="font-bold text-slate-900 text-base">
          <span aria-hidden="true">⚠️</span> שים לב! תאריך זה הוגדר כחסום לקביעת פגישות
        </h2>
        <p className="text-sm text-slate-600">
          בשל: <span className="font-medium text-slate-800">{reason}</span>. כיצד תרצה לפעול?
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onKeepAnyway} className="btn-blue text-sm px-4 py-2 w-full">קבע בכל זאת</button>
          <button type="button" onClick={onPickAnother} className="btn-ghost text-sm px-4 py-2 w-full">החלף תאריך</button>
          <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600 px-4 py-2 w-full">ביטול</button>
        </div>
      </div>
    </div>
  );
}
