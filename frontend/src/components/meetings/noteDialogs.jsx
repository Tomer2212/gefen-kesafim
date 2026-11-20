import { Component } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// Shared by the meeting-notes window and the "סגירת שנה" tab's notes: the editor footer
// (save / cancel + status), the "save changes?" prompt and the delete confirmation.

// The notes window is mounted app-wide, so an editor failure (e.g. a stale tab requesting a lazy chunk
// that a newer deploy replaced) must stay inside the editor slot instead of unmounting the app.
export class EditorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error("RichNoteEditor failed:", err); }
  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
          <span>{this.props.message || "טעינת עורך ההערות נכשלה — רענון הדף יטען אותו מחדש (טיוטה שהקלדת שמורה)"}</span>
          <button type="button" onClick={() => window.location.reload()}
                  className="shrink-0 rounded-md bg-red-600 text-white font-semibold px-2 py-1 hover:bg-red-700">
            רענן
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function formatTime(d) {
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export function EditorFooter({ editing, onSave, onCancel }) {
  const { saving, dirty, savedAt, error } = editing;
  let status = null;
  if (error) {
    status = <span role="alert" className="text-red-600">{error}</span>;
  } else if (saving) {
    status = <span className="text-slate-500">שומר…</span>;
  } else if (dirty) {
    status = (
      <span className="text-amber-700 flex items-center gap-1.5">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-amber-500" />יש שינויים שלא נשמרו
      </span>
    );
  } else if (savedAt) {
    status = <span className="text-emerald-700">✓ נשמר ב-{formatTime(savedAt)}</span>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" onClick={onSave} disabled={saving} className="btn-blue text-xs px-4 py-1.5 disabled:opacity-60">
        {saving ? "שומר…" : "שמור"}
      </button>
      <button type="button" onClick={onCancel}
        className="text-xs px-3 py-1.5 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 font-semibold transition-colors">
        {dirty ? "ביטול" : "סגירה"}
      </button>
      <div className="text-[11px] min-w-0 flex-1" aria-live="polite">{status}</div>
    </div>
  );
}

// Word/Excel-style "save changes?" prompt — Esc / backdrop = back to editing (nothing is lost).
export function UnsavedChangesDialog({ onSave, onDiscard, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm" style={{ zIndex: 70 }} dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="unsaved-note-title" aria-describedby="unsaved-note-desc"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl p-6 w-[380px] flex flex-col gap-4">
        <h2 id="unsaved-note-title" className="text-base font-bold text-slate-800 text-center">לשמור את השינויים?</h2>
        <p id="unsaved-note-desc" className="text-sm text-slate-600 text-center leading-relaxed">
          בהערה יש שינויים שעדיין לא נשמרו. אם לא תשמור — הם יימחקו.
        </p>
        <div className="flex gap-2 justify-center mt-1 flex-wrap">
          <button type="button" onClick={onSave} className="btn-blue text-sm px-5 py-2">שמור</button>
          <button type="button" onClick={onDiscard}
            className="px-4 py-2 rounded-full border border-red-300 hover:bg-red-50 text-red-600 text-sm font-semibold transition-colors">
            אל תשמור
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            חזרה לעריכה
          </button>
        </div>
      </div>
    </div>
  );
}

// Mounted only while open, so useFocusTrap's mount-time auto-focus fires fresh every time.
// Focus starts on "לא" (useFocusTrap focuses the first button), so Enter / Esc / a backdrop click
// all keep the note.
export function DeleteConfirmDialog({ title, authorName, onCancel, onConfirm }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm" style={{ zIndex: 70 }} dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="delete-note-confirm-title" aria-describedby="delete-note-confirm-desc"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl p-6 w-[380px] max-w-[calc(100vw-32px)] flex flex-col gap-4">
        <h2 id="delete-note-confirm-title" className="text-base font-bold text-slate-800 text-center">{title}</h2>
        <p id="delete-note-confirm-desc" className="text-sm text-slate-600 text-center leading-relaxed">
          {authorName && <>זו הערה של <strong>{authorName}</strong>.<br /></>}
          האם למחוק את ההערה באופן סופי?
        </p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onCancel}
            className="px-6 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            לא
          </button>
          <button type="button" onClick={onConfirm}
            className="px-6 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
            כן
          </button>
        </div>
      </div>
    </div>
  );
}
