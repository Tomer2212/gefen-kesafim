import { useState } from "react";
import { CallSummaryModal } from "./CallSummaryModal";

const STATUS_LABELS = {
  ANSWER: { label: "נענתה", bg: "#dcfce7", color: "#15803d", dot: "#22c55e" },
  NOANSWER: { label: "לא נענתה", bg: "#f1f5f9", color: "#64748b", dot: "#94a3b8" },
  BUSY: { label: "תפוס", bg: "#fef9c3", color: "#a16207", dot: "#eab308" },
  ABANDONE: { label: "ננטשה", bg: "#fee2e2", color: "#b91c1c", dot: "#ef4444" },
  CANCEL: { label: "בוטלה", bg: "#f1f5f9", color: "#64748b", dot: "#94a3b8" },
};
const DEFAULT_STATUS = { label: "לא ידוע", bg: "#f1f5f9", color: "#64748b", dot: "#94a3b8" };

const DIRECTION_LABELS = {
  incoming: { label: "נכנסת", bg: "#dbeafe", color: "#1d4ed8" },
  outgoing: { label: "יוצאת", bg: "#ede9fe", color: "#6d28d9" },
  internal: { label: "פנימית", bg: "#f1f5f9", color: "#64748b" },
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
}
function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDuration(seconds) {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
// Israeli numbers arrive with a "972" international prefix — display them the way
// they're dialed locally instead ("0XX-XXXXXXX"). Any other country code is shown as-is.
function formatPhone(raw) {
  if (!raw) return "—";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function computeEndTimeIso(startIso, durationSeconds) {
  if (!startIso) return null;
  const d = new Date(startIso);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + (durationSeconds || 0) * 1000).toISOString();
}

export function CallRow({ call }) {
  const [playing, setPlaying] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const direction = DIRECTION_LABELS[call.direction] || DIRECTION_LABELS.internal;
  const status = STATUS_LABELS[call.status] || DEFAULT_STATUS;
  const endIso = computeEndTimeIso(call.start_time, call.duration_seconds);
  const advisorLabel = call.advisor_profile?.full_name || call.advisor_profile?.email || call.representative_name || "—";

  return (
    <>
      {showSummary && <CallSummaryModal call={call} onClose={() => setShowSummary(false)} />}
      <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group">
      <td className="py-2.5 px-2">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ background: direction.bg, color: direction.color }}>
          {direction.label}
        </span>
      </td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatPhone(call.counterpart_phone)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">{advisorLabel}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">{formatDate(call.start_time)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatTime(call.start_time)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatDuration(call.duration_seconds)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatTime(endIso)}</td>
      <td className="py-2.5 px-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
          style={{ background: status.bg, color: status.color }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: status.dot }} aria-hidden="true" />
          {status.label}
        </span>
      </td>
      <td className="py-2.5 px-2 text-center">
        {call.recording_url ? (
          playing ? (
            <audio controls autoPlay src={call.recording_url} style={{ height: 28, width: 180 }} onEnded={() => setPlaying(false)} />
          ) : (
            <button type="button" onClick={() => setPlaying(true)} aria-label="נגן הקלטה"
              className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none">
              ▶
            </button>
          )
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-2.5 px-2 text-sm text-slate-500 max-w-[220px] truncate">
        {call.ai_summary ? (
          <button type="button" onClick={() => setShowSummary(true)}
            className="text-right hover:text-blue-600 transition-colors truncate max-w-full" title={call.ai_summary}>
            {call.ai_summary}
          </button>
        ) : call.ai_summary_available ? (
          <span className="text-amber-600 text-xs">סיכום קיים — לא זמין להצגה עדיין</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-2.5 px-2 text-sm text-slate-500 whitespace-nowrap">{call.department_name || "—"}</td>
      </tr>
    </>
  );
}
