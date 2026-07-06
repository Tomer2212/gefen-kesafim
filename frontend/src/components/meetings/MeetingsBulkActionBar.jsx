
const DOWNLOAD_ICON = (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export function MeetingsBulkActionBar({
  selectedCount, canDelete, onBulkDelete, onClearSelection,
  onExportExcel, onExportPdf, onSendBulkReminder,
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="glass-card rounded-xl px-4 py-2.5 mb-3 flex items-center justify-between" dir="rtl">
      <span className="text-sm text-slate-600 font-medium">נבחרו {selectedCount} פגישות</span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSendBulkReminder}
          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors"
          style={{ background: "#0284c7" }}
        >
          שלח תזכורת לעדכון סטטוס
        </button>
        <button
          type="button"
          onClick={onExportPdf}
          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
          style={{ background: "#b45309" }}
          aria-label="הורד PDF"
        >
          {DOWNLOAD_ICON}
          הורד PDF
        </button>
        <button
          type="button"
          onClick={onExportExcel}
          className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors flex items-center gap-1.5"
          style={{ background: "#16a34a" }}
          aria-label="הורד EXCEL"
        >
          {DOWNLOAD_ICON}
          הורד EXCEL
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
        >
          ביטול סימון
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onBulkDelete}
            className="text-xs px-3 py-1.5 rounded-xl font-semibold text-white transition-colors"
            style={{ background: "#dc2626" }}
          >
            מחק
          </button>
        )}
      </div>
    </div>
  );
}
