import { useState } from "react";
import axios from "axios";
import { useCallNoteWindows } from "../../context/CallNoteWindowsContext";
import { SchoolPickerModal } from "../meetings/SchoolPickerCell";

const STATUS_LABELS = {
  ANSWER: { label: "נענתה", dot: "#22c55e" },
  NOANSWER: { label: "לא נענתה", dot: "#94a3b8" },
  BUSY: { label: "תפוס", dot: "#eab308" },
  ABANDONE: { label: "ננטשה", dot: "#ef4444" },
  CANCEL: { label: "אין מענה", dot: "#94a3b8" },
};
const DEFAULT_STATUS = { label: "לא ידוע", dot: "#94a3b8" };

function ArrowIcon({ pointing, color }) {
  const d = pointing === "left" ? "M20 12H4m6-6l-6 6 6 6" : "M4 12h16m-6-6l6 6-6 6";
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

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

function buildWindowTitle(call, advisorLabel) {
  const parts = [formatDate(call.start_time), advisorLabel];
  if (call.contact_name) parts.push(call.contact_name);
  parts.push(formatPhone(call.counterpart_phone));
  return parts.join(" - ");
}

export function CallRow({ call, onDelete, hideSchoolColumn, canManage = true, schoolId }) {
  const { openCallNote } = useCallNoteWindows();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkSchools, setLinkSchools] = useState(null);
  const status = STATUS_LABELS[call.status] || DEFAULT_STATUS;
  const endIso = computeEndTimeIso(call.start_time, call.duration_seconds);
  const advisorLabel = call.advisor_profile?.full_name || call.advisor_profile?.email || call.representative_name || "—";
  const windowTitle = buildWindowTitle(call, advisorLabel);

  return (
    <>
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }} dir="rtl">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-call-title" className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-4">
            <h2 id="delete-call-title" className="font-bold text-slate-900">
              {schoolId ? "הסרת שיחה מכרטיס בית הספר" : "מחיקת נתוני שיחה"}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {schoolId
                ? "השיחה תוסר מטאב \"שיחות\" של בית הספר הזה בלבד — היא תישאר מוצגת כרגיל באזור \"ניהול\"-\"שיחות\", ובכל בית ספר אחר שהיא משויכת אליו."
                : "האם אתה בטוח שברצונך למחוק את הסיכום והתמלול השמורים אצלנו לשיחה זו? השיחה עצמה תישאר שמורה במערכת Voicenter — הפעולה מוחקת רק את הנתונים המוצגים כאן."}
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost text-sm px-4 py-2">ביטול</button>
              <button type="button"
                onClick={async () => {
                  try {
                    if (schoolId) {
                      await axios.post(`/voicenter/calls/${call.call_id}/exclude-from-school`, { school_id: schoolId });
                    } else {
                      await axios.delete(`/voicenter/calls/${call.call_id}`);
                    }
                  } catch { /* non-fatal for UI */ }
                  setConfirmDelete(false);
                  onDelete?.(call.call_id);
                }}
                className="text-sm px-4 py-2 rounded-xl font-medium text-white bg-red-600 hover:bg-red-700 transition-colors">
                {schoolId ? "הסר" : "מחק"}
              </button>
            </div>
          </div>
        </div>
      )}
      {linkModalOpen && (
        linkSchools ? (
          <SchoolPickerModal
            schools={linkSchools}
            title="שיוך שיחה לבית ספר"
            submittingLabel="משייך..."
            onCancel={() => setLinkModalOpen(false)}
            onConfirm={async s => {
              try { await axios.post(`/voicenter/calls/${call.call_id}/link-school`, { school_id: s.id }); } catch { /* non-fatal for UI */ }
              setLinkModalOpen(false);
            }}
          />
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }} dir="rtl">
            <div role="status" aria-label="טוען בתי ספר" className="glass-card rounded-2xl p-6"><div aria-hidden="true" className="spinner w-6 h-6" /></div>
          </div>
        )
      )}
      <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group">
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">{formatDate(call.start_time)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatTime(call.start_time)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatTime(endIso)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatDuration(call.duration_seconds)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">{advisorLabel}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">
        {call.direction === "outgoing" ? (
          <span className="inline-flex items-center gap-1">יוצאת<ArrowIcon pointing="left" color="#16a34a" /></span>
        ) : call.direction === "incoming" ? (
          <span className="inline-flex items-center gap-1">נכנסת<ArrowIcon pointing="right" color="#dc2626" /></span>
        ) : (
          <span className="text-slate-500">פנימית</span>
        )}
      </td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap" dir="ltr">{formatPhone(call.counterpart_phone)}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">{call.contact_name || "—"}</td>
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">
        {call.pending_school_resolution
          ? <span className="text-amber-600 text-xs font-medium">ממתין לשיוך</span>
          : (call.contact_role || "—")}
      </td>
      {!hideSchoolColumn && (
        <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">
          {call.pending_school_resolution
            ? <span className="text-amber-600 text-xs font-medium">ממתין לשיוך</span>
            : (call.school_name || "—")}
        </td>
      )}
      <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: status.dot }} aria-hidden="true" />
          {status.label}
        </span>
      </td>
      <td className="py-2.5 px-2 text-center">
        {call.ai_summary ? (
          <button type="button"
            onClick={() => openCallNote({ windowLabel: "סיכום שיחה", title: windowTitle, kind: "summary", text: call.ai_summary })}
            className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none" aria-label="הצג סיכום שיחה">
            📝
          </button>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-2.5 px-2 text-center">
        {call.ai_transcript_available ? (
          <button type="button"
            onClick={() => openCallNote({ windowLabel: "תמלול שיחה", title: windowTitle, kind: "transcript", callId: call.call_id })}
            className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none" aria-label="הצג תמלול שיחה">
            📝
          </button>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="py-2.5 px-2 text-center relative">
        {canManage && (
        <button type="button" onClick={() => setMenuOpen(v => !v)} aria-label="פעולות נוספות"
          className="text-slate-400 hover:text-slate-700 transition-colors text-base leading-none px-1.5">
          ⋮
        </button>
        )}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px]" dir="rtl">
              {!schoolId && (
                <button type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    setLinkModalOpen(true);
                    if (!linkSchools) {
                      try {
                        const res = await axios.get("/schools/");
                        setLinkSchools((res.data || []).filter(s => s.status !== "deleted"));
                      } catch {
                        setLinkSchools([]);
                      }
                    }
                  }}
                  className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  שייך שיחה לבית ספר
                </button>
              )}
              <button type="button"
                onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                className="w-full text-right px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                {schoolId ? "הסר שיחה מכרטיס בית הספר" : "מחק נתוני שיחה"}
              </button>
            </div>
          </>
        )}
      </td>
      </tr>
    </>
  );
}
