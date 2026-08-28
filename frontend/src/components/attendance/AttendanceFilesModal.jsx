import { useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const ALLOWED = [".pdf", ".jpg", ".jpeg", ".png"];
const MAX_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// מודאל קבצים מצורפים לשורת יום (קבלות חניה, אישורי מחלה/מילואים וכו').
export default function AttendanceFilesModal({
  dateLabel,
  files = [],
  readOnly,
  onUpload,
  onDelete,
  onDownload,
  onClose,
}) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handlePick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED.includes(ext)) {
      setError("סוג קובץ לא נתמך — PDF, JPG או PNG בלבד");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("הקובץ גדול מדי — עד 10MB");
      return;
    }
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err?.response?.data?.detail || "העלאת הקובץ נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    setError("");
    setBusy(true);
    try {
      await onDelete(id);
    } catch (err) {
      setError(err?.response?.data?.detail || "מחיקת הקובץ נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-files-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5"
      >
        <h2 id="attendance-files-title" className="text-lg font-semibold text-slate-800 mb-1">
          קבצים מצורפים
        </h2>
        {dateLabel && <p className="text-sm text-slate-500 mb-3">{dateLabel}</p>}

        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {files.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">אין קבצים ליום זה</p>
        ) : (
          <ul className="divide-y divide-slate-100 mb-3">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => onDownload(f)}
                  className="text-sm text-blue-600 hover:underline truncate flex-1 text-right"
                  title={f.filename}
                >
                  {f.filename}
                </button>
                <span className="text-xs text-slate-400 shrink-0">{fmtSize(f.size)}</span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleDelete(f.id)}
                    disabled={busy}
                    aria-label={`הסר את ${f.filename}`}
                    className="text-xs shrink-0 px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    הסר
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handlePick}
          className="hidden"
        />

        <div className="flex justify-between items-center mt-4">
          {!readOnly ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "מעלה…" : "+ הוסף קובץ"}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
