import { useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { MEETING_SERVICE_TYPE_OPTIONS, formatMeetingDate, getStatusDisplay } from "./constants";

// "זו אותה פגישה?" — opened by MeetingsTable when a save returns overlapping_meetings: the school
// already has a meeting at that time (or one without hours that day). Offered first: join the
// existing meeting instead of keeping a second one for the same conversation; a genuinely
// separate meeting (another role holder) stays, and that pair is never asked about again.
// See backend/meeting_overlaps.py. Portaled to <body>.

function hoursText(m) {
  if (m.start_time && m.end_time) return `${m.start_time.slice(0, 5)}–${m.end_time.slice(0, 5)}`;
  if (m.calls_start_time && m.calls_duration_seconds) return `לא הוזנו שעות (שיחות בפועל מ-${m.calls_start_time.slice(0, 5)})`;
  return "לא הוזנו שעות";
}

export default function OverlappingMeetingModal({ meeting, overlaps, schoolName, clientSurface, beforeMerge, onMerged, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { ref, handleKeyDown } = useFocusTrap(() => { if (!busy) onClose(); });
  const config = clientSurface ? { headers: { "X-Client-Surface": clientSurface } } : undefined;
  const base = `/schools/${meeting.school_id}/meetings/${meeting.id}`;
  const myIds = meeting.advisor_ids || [];
  const alreadyIn = o => myIds.length > 0 && myIds.every(id => o.advisors.some(a => a.id === id));

  async function run(action, fallback) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : fallback);
      setBusy(false);
    }
  }

  const merge = o => run(async () => {
    // A save of this row still on its way must not reach the server after the row is gone.
    try { await beforeMerge?.(); } catch { /* the save's own error UI handles it */ }
    const res = await axios.post(`${base}/merge-into/${o.id}`, null, config);
    onMerged(res.data);
  }, "ההצטרפות לפגישה הקיימת נכשלה — נסו שוב.");

  const keepSeparate = () => run(async () => {
    await axios.post(`${base}/confirm-separate`, { other_ids: overlaps.map(o => o.id) }, config);
    onClose();
  }, "שמירת הבחירה נכשלה — נסו שוב.");

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" dir="rtl"
      onMouseDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      onBlur={e => e.stopPropagation()} onFocus={e => e.stopPropagation()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="overlapping-meeting-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="overlapping-meeting-title" className="text-base font-bold text-slate-800">
            {overlaps.every(alreadyIn) ? "כבר רשומה לך פגישה" : "כבר רשומה פגישה"}{schoolName ? ` עם ${schoolName}` : ""} בזמן שחופף לפגישה שרשמת
          </h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="סגור ואחליט אחר כך" className="btn-ghost text-sm px-2 py-1">✕</button>
        </div>
        <p className="text-sm text-slate-600">
          הפגישה שרשמת: {formatMeetingDate(meeting.meeting_date)}, {hoursText(meeting)}.
          אם מדובר <b>באותה פגישה</b>, יש להשתמש בפגישה הקיימת במקום לרשום פגישה נוספת.
          רק אם זו <b>פגישה נפרדת</b>, עם בעל תפקיד אחר, יש להשאיר גם את הפגישה החדשה.
        </p>

        {overlaps.map(o => (
          <section key={o.id} aria-label={`פגישה קיימת ${hoursText(o)}`} className="rounded-xl border border-slate-200 p-3.5 flex flex-col gap-2 text-sm text-slate-700">
            <p className="font-semibold text-slate-800">
              {formatMeetingDate(o.meeting_date)} · {hoursText(o)} · {getStatusDisplay(o.status).label}
            </p>
            <p>יועצים מבצעים: {o.advisors.map(a => a.full_name).filter(Boolean).join(", ") || "—"}</p>
            <p>משתתפים: {o.participants.map(p => [p.name, p.label && `(${p.label})`].filter(Boolean).join(" ")).filter(Boolean).join(", ") || "—"}</p>
            <p>סוג: {MEETING_SERVICE_TYPE_OPTIONS.find(x => x.value === o.meeting_service_type)?.label || "—"}</p>
            <button type="button" onClick={() => merge(o)} disabled={busy} className="btn-blue text-sm px-4 py-2.5">
              {busy ? "רק רגע..." : alreadyIn(o) ? "זו אותה פגישה — השתמש בפגישה הקיימת" : "זו אותה פגישה — הצטרף לפגישה הקיימת"}
            </button>
          </section>
        ))}

        <p className="text-xs text-slate-500">
          ההערות, העבודה העצמאית והשיחות שנרשמו בפגישה החדשה יעברו לפגישה הקיימת, ופרטים שחסרים בה (כמו שעות) יושלמו ממנה. הפגישה החדשה תוסר.
        </p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={keepSeparate} disabled={busy} className="btn-ghost text-sm px-4 py-2.5">
          זו פגישה נפרדת — השאר את שתי הפגישות
        </button>
      </div>
    </div>,
    document.body,
  );
}
