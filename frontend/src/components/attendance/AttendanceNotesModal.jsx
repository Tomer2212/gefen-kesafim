import { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// מודאל הערות מינימלי לשורת יום בשעון הנוכחות.
export default function AttendanceNotesModal({ dateLabel, value, readOnly, onSave, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [text, setText] = useState(value || "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-notes-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5"
      >
        <h2 id="attendance-notes-title" className="text-lg font-semibold text-slate-800 mb-1">
          הערות
        </h2>
        {dateLabel && <p className="text-sm text-slate-500 mb-3">{dateLabel}</p>}
        <label htmlFor="attendance-notes-text" className="sr-only">
          טקסט ההערה
        </label>
        <textarea
          id="attendance-notes-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={readOnly}
          rows={6}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 resize-y disabled:bg-slate-50"
          placeholder={readOnly ? "" : "כתוב/כתבי הערה ליום זה…"}
        />
        <div className="flex items-center gap-2 mt-4">
          {!readOnly && (value || "").trim() && (
            <button
              type="button"
              onClick={() => onSave("")}
              className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
            >
              הסר הערה
            </button>
          )}
          <div className="flex justify-end gap-2 ms-auto">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {readOnly ? "סגור" : "ביטול"}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onSave(text)}
                className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                שמור הערות
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
