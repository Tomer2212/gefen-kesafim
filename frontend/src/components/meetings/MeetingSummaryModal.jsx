import { useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// Entry point for "סיכום פגישה" — not a content viewer. Choosing "לכתוב הערה" just
// delegates to the existing notes modal (same onOpenNotes/onSave already wired for the
// "הערות" column); choosing "להעלות הקלטה" uploads audio for background transcription +
// AI summarization, whose result later lands in the meeting's regular notes field.
export function MeetingSummaryModal({ meeting, onClose, onOpenNotes, onSave, onUploadStarted }) {
  const [mode, setMode] = useState("choice"); // "choice" | "uploading"
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  function handleWriteNote() {
    onClose();
    onOpenNotes(meeting.id, meeting.notes || "", val => onSave({ ...meeting, notes: val }));
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      await axios.post(`/schools/meetings/${meeting.id}/summary/recording`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploadStarted?.(meeting.id);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || "שגיאה בהעלאת ההקלטה, נסה שוב");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="summary-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
        <h2 id="summary-modal-title" className="font-bold text-slate-900">סיכום פגישה</h2>

        {mode === "choice" && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={handleWriteNote}
              className="btn-ghost text-sm px-4 py-3 text-right border border-slate-200 rounded-xl hover:border-blue-300">
              📝 לכתוב הערה
            </button>
            <button type="button" onClick={() => setMode("uploading")}
              className="btn-ghost text-sm px-4 py-3 text-right border border-slate-200 rounded-xl hover:border-blue-300">
              🎙 להעלות הקלטה
            </button>
          </div>
        )}

        {mode === "uploading" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              ההקלטה תתומלל ותסוכם אוטומטית באמצעות בינה מלאכותית. הסיכום ייכתב כהערה לפגישה תוך כדקה-שתיים.
            </p>
            <label htmlFor="summary-audio-input" className="sr-only">קובץ הקלטה</label>
            <input id="summary-audio-input" ref={fileInputRef} type="file" accept="audio/*"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white" />
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setMode("choice")} disabled={busy}
                className="btn-ghost text-sm px-4 py-2">חזרה</button>
              <button type="button" onClick={handleUpload} disabled={!file || busy}
                className="btn-blue text-sm px-4 py-2 disabled:opacity-50">
                {busy ? "מעלה..." : "העלאה"}
              </button>
            </div>
          </div>
        )}

        {mode === "choice" && (
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">ביטול</button>
          </div>
        )}
      </div>
    </div>
  );
}
