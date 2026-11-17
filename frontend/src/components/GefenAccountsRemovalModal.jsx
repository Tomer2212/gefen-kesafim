import { useFocusTrap } from "../hooks/useFocusTrap";

// Shown before saving a "חשבונות במערכת גפן" change that removes (or changes the kind of) an
// account of the year. mode "confirm" (manager+): the removal goes through — an account with
// checks stays as a read-only archive tab. mode "request" (advisor): only a manager may remove,
// so the change can be sent as an update request instead.
export function GefenAccountsRemovalModal({ mode, academicYear, removed, busy = false, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const isRequest = mode === "request";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="gefen-accounts-removal-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-4">
        <h2 id="gefen-accounts-removal-title" className="text-base font-bold text-slate-800">
          {isRequest ? "הסרת חשבון גפן דורשת אישור מנהל" : "הסרת חשבון גפן"}
        </h2>
        <div className="text-sm text-slate-700 flex flex-col gap-2">
          <p>{`בשנת הלימודים ${academicYear} יוסרו החשבונות הבאים:`}</p>
          <ul className="list-disc pr-5 flex flex-col gap-0.5">
            {removed.map(r => (
              <li key={r.label}>
                <span className="font-semibold">{r.label}</span>
                {r.checks_count > 0 ? ` — ${r.checks_count} בדיקות בשנה זו` : " — אין בדיקות בשנה זו"}
              </li>
            ))}
          </ul>
          {removed.some(r => r.checks_count > 0) && (
            <p className="text-slate-600">הבדיקות לא יימחקו: הלשונית של החשבון תישאר כ"ארכיון" לצפייה בלבד, ואם החשבון יוחזר — היא תחזור לפעול.</p>
          )}
          {isRequest && <p className="text-slate-600">ניתן לשלוח את השינוי כבקשת עדכון, והוא יבוצע לאחר אישור מנהל.</p>}
        </div>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onConfirm} disabled={busy}
            className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors">
            {isRequest ? "שלח בקשה למנהל" : "הסר חשבון"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
