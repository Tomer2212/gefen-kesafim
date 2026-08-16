import { useFocusTrap } from "../../hooks/useFocusTrap";

// Shared between TaskPanel.jsx (manual resend past the threshold) and TaskCreateWizard.jsx's
// review step (pre-creation check, since creation now sends immediately — round-2 redesign).
// Label props default to the send-time wording; the wizard overrides them for creation-time.
export default function OutlookLimitModal({
  warning, primaryLoading, secondaryLoading, onConfirm, onSwitchChannel, onClose,
  primaryLabel = "המשך בכל זאת דרך Outlook",
  primaryLoadingLabel = "שולח...",
  secondaryLabel = "עבור למייל רגיל (Resend) ושלח",
  secondaryLoadingLabel = "מעביר ערוץ...",
}) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outlook-limit-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
      >
        <h2 id="outlook-limit-title" className="font-bold text-slate-800 mb-2">חריגה מסף האזהרה לשליחה דרך Outlook</h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-5">{warning.message}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={primaryLoading}
            className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {primaryLoading ? primaryLoadingLabel : primaryLabel}
          </button>
          <button
            type="button"
            onClick={onSwitchChannel}
            disabled={secondaryLoading || primaryLoading}
            className="text-sm px-4 py-2 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
          >
            {secondaryLoading ? secondaryLoadingLabel : secondaryLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
