import { useState } from "react";
import axios from "axios";

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${HH}:${MM}`;
}

const DIRECTION_LABEL = { incoming: "שיחה נכנסת", outgoing: "שיחה יוצאת", internal: "שיחה פנימית" };

/**
 * Interrupting prompt for a call the current advisor made/received with a contact whose
 * number is listed at several schools — one button per candidate school. Small bottom-left
 * card (like UnknownCallPopup). "אחר כך" only hides it for this session; the bell
 * notification for the same call stays until resolved.
 */
export default function AmbiguousCallPopup({ reminder, onDismiss, onSuccess }) {
  const callId = reminder.call_id;
  const schools = reminder.candidate_schools || [];
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  async function handleChoose(school) {
    setBusyId(school.id);
    setError("");
    try {
      await axios.patch(`/calls/calls/${callId}/resolve-contact-school`, { school_id: school.id });
      onSuccess?.(`השיחה שויכה ל${school.name}`);
      onDismiss();
    } catch (err) {
      // 400 here = already resolved (e.g. from the bell while this popup was open) — nothing left to do.
      if (err.response?.status === 400) {
        onSuccess?.("השיחה כבר שויכה לבית ספר");
        onDismiss();
        return;
      }
      setError(err.response?.data?.detail || "שגיאה בשיוך השיחה — נסה שוב");
      setBusyId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={`ambiguous-call-title-${callId}`}
      dir="rtl"
      className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
    >
      <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2.5 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">📞</span>
        <h3 id={`ambiguous-call-title-${callId}`} className="text-sm font-bold text-indigo-800 flex-1">
          לאיזה בית ספר שייכת השיחה?
        </h3>
        <button
          aria-label="סגור"
          onClick={onDismiss}
          className="text-indigo-600 hover:text-indigo-800 p-0.5 rounded"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-slate-700 mb-1">
          שיחה עם <span className="font-semibold">{reminder.contact_name || "איש קשר"}</span>
          {reminder.counterpart_phone_display && (
            <> (<span dir="ltr">{reminder.counterpart_phone_display}</span>)</>
          )}
        </p>
        <p className="text-xs text-slate-500 mb-3">
          {DIRECTION_LABEL[reminder.direction] || "שיחה"}
          {reminder.call_time ? ` · ${fmtDateTime(reminder.call_time)}` : ""}
          {reminder.duration_seconds != null ? ` · משך ${fmtDuration(reminder.duration_seconds)}` : ""}
        </p>
        <p className="text-sm text-slate-700 mb-2">איש הקשר משויך לכמה בתי ספר. בחר/י את בית הספר שאליו שייכת השיחה:</p>
        {error && <p role="alert" className="text-xs text-red-500 mb-2">{error}</p>}
        <div className="flex flex-col gap-1.5">
          {schools.map(s => (
            <button
              key={s.id}
              disabled={busyId !== null}
              onClick={() => handleChoose(s)}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 transition-colors disabled:opacity-50 text-right"
            >
              {busyId === s.id ? "משייך..." : s.name}
            </button>
          ))}
          <button
            disabled={busyId !== null}
            onClick={onDismiss}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            אחר כך (נשאר בהתראות)
          </button>
        </div>
      </div>
    </div>
  );
}
