import { useFocusTrap } from "../../hooks/useFocusTrap";

export default function MeetingNavigationGuardModal({ missingFields, busy, onStay, onSaveAndLeave, onDiscardAndLeave }) {
  const { ref, handleKeyDown } = useFocusTrap(onStay);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-nav-guard-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-5"
      >
        <div>
          <h2 id="meeting-nav-guard-title" className="font-bold text-slate-900 text-lg">פגישה לא הושלמה</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            טרם הוגדרו לפגישה השדות הבאים: {missingFields.join("، ")}.
            <br />מעבר לעמוד אחר מבלי להשלים אותם עלול לגרום למחיקת הפגישה. כיצד תרצה לפעול?
          </p>
        </div>
        <div className="flex flex-row gap-2">
          <button onClick={onStay} disabled={busy}
            className="flex-1 whitespace-nowrap text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#16a34a" }}>
            הישאר בעמוד
          </button>
          <button onClick={onSaveAndLeave} disabled={busy}
            className="flex-1 whitespace-nowrap text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#2563eb" }}>
            שמור ועבור
          </button>
          <button onClick={onDiscardAndLeave} disabled={busy}
            className="flex-1 whitespace-nowrap text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#dc2626" }}>
            {busy ? "מוחק..." : "עבור בכל זאת"}
          </button>
        </div>
      </div>
    </div>
  );
}
