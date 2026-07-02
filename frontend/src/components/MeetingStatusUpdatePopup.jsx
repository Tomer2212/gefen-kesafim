import { useState } from "react";
import axios from "axios";

const STATUS_OPTIONS_NO = [
  { value: "postponed", label: "נדחתה", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  { value: "cancelled", label: "בוטלה", color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  { value: "other",     label: "אחר",   color: "#475569", bg: "#f8fafc", border: "#e2e8f0" },
];

const STATUS_LABEL = { postponed: "נדחתה", cancelled: "בוטלה", other: "אחר" };

function buildTimestamp(userName) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const HH = String(now.getHours()).padStart(2, "0");
  const MM = String(now.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} - ${HH}:${MM}${userName ? ` - ${userName}` : ""}`;
}

function appendNote(existingNotes, newText, userName) {
  const header = buildTimestamp(userName);
  const entry = `${header}\n${newText}`;
  return existingNotes ? `${existingNotes}\n\n\n${entry}` : entry;
}

export default function MeetingStatusUpdatePopup({ reminder, onDismiss, userName, onSuccess }) {
  const [view, setView] = useState("main"); // "main" | "no" | "time"
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [newStartTime, setNewStartTime] = useState(reminder.start_time || "");
  const [newEndTime, setNewEndTime] = useState(reminder.end_time || "");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);

  async function handleYes() {
    setUpdating(true);
    setError(false);
    try {
      await axios.patch(`/schools/${reminder.school_id}/meetings/${reminder.id}`, {
        status: "completed",
      });
      onSuccess?.("סטטוס הפגישה עודכן בהצלחה לבוצעה!");
      onDismiss(reminder.id);
    } catch {
      setError(true);
      setUpdating(false);
    }
  }

  async function handleUpdateNo() {
    if (!selectedStatus || !noteText.trim()) return;
    setUpdating(true);
    setError(false);
    try {
      await axios.patch(`/schools/${reminder.school_id}/meetings/${reminder.id}`, {
        status: selectedStatus,
        notes: appendNote(reminder.notes || "", noteText.trim(), userName),
      });
      onSuccess?.(`סטטוס הפגישה עודכן בהצלחה ל${STATUS_LABEL[selectedStatus] || selectedStatus}!`);
      onDismiss(reminder.id);
    } catch {
      setError(true);
      setUpdating(false);
    }
  }

  async function handleUpdateTime() {
    if (!newStartTime || !newEndTime) return;
    setUpdating(true);
    setError(false);
    try {
      await axios.patch(`/schools/${reminder.school_id}/meetings/${reminder.id}`, {
        status: "completed",
        start_time: newStartTime,
        end_time: newEndTime,
      });
      onSuccess?.("סטטוס הפגישה עודכן בהצלחה לבוצעה!");
      onDismiss(reminder.id);
    } catch {
      setError(true);
      setUpdating(false);
    }
  }

  const canSubmitNo   = selectedStatus && noteText.trim().length > 0;
  const canSubmitTime = newStartTime && newEndTime;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`status-upd-title-${reminder.id}`}
      dir="rtl"
      className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
    >
      {/* Header */}
      <div className="bg-sky-50 border-b border-sky-100 px-4 py-2.5 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">🔔</span>
        <h3
          id={`status-upd-title-${reminder.id}`}
          className="text-sm font-bold text-sky-800 flex-1"
        >
          עדכון סטטוס פגישה
        </h3>
        <button
          aria-label="סגור"
          onClick={() => onDismiss(reminder.id)}
          className="text-sky-600 hover:text-sky-800 p-0.5 rounded"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        {view === "main" && (
          <>
            <p className="text-sm text-slate-700 mb-3">
              האם הפגישה עם{" "}
              <span className="font-semibold">{reminder.school_name}</span>{" "}
              בוצעה כמתוכנן מ-
              <span className="font-semibold">{reminder.start_time}</span>{" "}
              עד{" "}
              <span className="font-semibold">{reminder.end_time}</span>?
            </p>
            {error && (
              <p role="alert" className="text-xs text-red-500 mb-2">שגיאה בעדכון — נסה שוב</p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                disabled={updating}
                onClick={handleYes}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                כן
              </button>
              <button
                disabled={updating}
                onClick={() => { setError(false); setView("no"); }}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 whitespace-nowrap transition-colors"
              >
                לא
              </button>
              <button
                disabled={updating}
                onClick={() => { setError(false); setView("time"); }}
                className="text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap transition-colors"
              >
                זמן שונה
              </button>
            </div>
          </>
        )}

        {view === "no" && (
          <>
            <p className="text-xs text-slate-500 mb-2">בחר סטטוס:</p>
            <div className="flex gap-1.5 mb-3">
              {STATUS_OPTIONS_NO.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedStatus(opt.value)}
                  className="flex-1 text-xs font-medium px-2 py-1.5 rounded-lg border transition-colors"
                  style={{
                    backgroundColor: selectedStatus === opt.value ? opt.bg : "white",
                    color: selectedStatus === opt.value ? opt.color : "#64748b",
                    borderColor: selectedStatus === opt.value ? opt.border : "#e2e8f0",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <label
              htmlFor={`note-${reminder.id}`}
              className="text-xs text-slate-500 block mb-1"
            >
              הערה <span className="text-red-500">*</span>
            </label>
            <textarea
              id={`note-${reminder.id}`}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="פרט את סיבת הדחיה / ביטול..."
              rows={3}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
            />

            {error && (
              <p role="alert" className="text-xs text-red-500 mt-1">שגיאה בעדכון — נסה שוב</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => setView("main")}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                ← חזרה
              </button>
              <button
                disabled={!canSubmitNo || updating}
                onClick={handleUpdateNo}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                עדכן סטטוס
              </button>
            </div>
          </>
        )}

        {view === "time" && (
          <>
            <p className="text-xs text-slate-500 mb-2">עדכן זמני הפגישה:</p>
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label htmlFor={`start-upd-${reminder.id}`} className="text-xs text-slate-500 block mb-1">
                  התחלה
                </label>
                <input
                  id={`start-upd-${reminder.id}`}
                  type="time"
                  value={newStartTime}
                  onChange={e => setNewStartTime(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div className="flex-1">
                <label htmlFor={`end-upd-${reminder.id}`} className="text-xs text-slate-500 block mb-1">
                  סיום
                </label>
                <input
                  id={`end-upd-${reminder.id}`}
                  type="time"
                  value={newEndTime}
                  onChange={e => setNewEndTime(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-xs text-red-500 mb-2">שגיאה בעדכון — נסה שוב</p>
            )}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setView("main")}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                ← חזרה
              </button>
              <button
                disabled={!canSubmitTime || updating}
                onClick={handleUpdateTime}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
              >
                עדכן סטטוס פגישה לבוצעה
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
