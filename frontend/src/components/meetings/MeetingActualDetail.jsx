import { useEffect, useState } from "react";
import axios from "axios";
import { useCallNoteWindows } from "../../context/CallNoteWindowsContext";
import { normalizeTimeValue } from "./TimeInput";

function formatDuration(seconds) {
  if (!seconds) return "0:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatCallTime(iso) {
  return iso ? (iso.slice(11, 16) || "—") : "—";
}

function computeCallEndHM(iso, durationSeconds) {
  if (!iso) return "—";
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "—";
  const total = h * 60 + m + Math.round((durationSeconds || 0) / 60);
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

function NotesCell({ value, onSave }) {
  const [open, setOpen] = useState(false);
  if (value || open) {
    return (
      <textarea
        rows={1}
        defaultValue={value || ""}
        onBlur={e => { if (e.target.value !== (value || "")) onSave(e.target.value); }}
        placeholder="הערה..."
        aria-label="הערה"
        className="w-40 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-lg px-2 py-1 outline-none bg-transparent focus:bg-white resize-y align-top"
      />
    );
  }
  return (
    <button type="button" aria-label="הוספת הערה" onClick={() => setOpen(true)}
      className="text-sm w-6 h-6 flex items-center justify-center rounded-lg font-bold bg-slate-100 text-slate-500 hover:bg-slate-200">
      +
    </button>
  );
}

function OfflineTimeInput({ value, ariaLabel, onSave }) {
  const [local, setLocal] = useState(value || "");
  useEffect(() => { setLocal(value || ""); }, [value]);
  return (
    <input
      type="text" inputMode="numeric" maxLength={5} dir="ltr" autoComplete="off"
      aria-label={ariaLabel}
      value={local}
      onChange={e => setLocal(e.target.value.replace(/[^\d:]/g, "").slice(0, 5))}
      onBlur={() => {
        const n = normalizeTimeValue(local);
        setLocal(n);
        if (n && n !== value) onSave(n);
      }}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      className="w-14 bg-transparent text-sm text-right border-0 outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 hover:bg-slate-100 focus:bg-white"
    />
  );
}

export function MeetingActualDetail({ meeting }) {
  const { openCallNote } = useCallNoteWindows();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [addingOffline, setAddingOffline] = useState(false);
  const [newEntry, setNewEntry] = useState({ start_time: "", end_time: "" });
  const [reassignOpenFor, setReassignOpenFor] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`/schools/${meeting.school_id}/meetings/${meeting.id}/actual-detail`);
      setDetail(res.data);
    } catch {
      setError("שגיאה בטעינת פירוט הפעילות — נסה לרענן");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [meeting.id]);

  async function saveCallNote(callId, notes) {
    try { await axios.patch(`/schools/meetings/${meeting.id}/call-links/${callId}/notes`, { notes }); } catch { /* non-fatal */ }
    load();
  }

  async function patchOffline(entryId, patch) {
    try { await axios.patch(`/schools/${meeting.school_id}/meetings/${meeting.id}/offline-work/${entryId}`, patch); } catch { /* non-fatal */ }
    load();
  }

  async function deleteOffline(entryId) {
    try { await axios.delete(`/schools/${meeting.school_id}/meetings/${meeting.id}/offline-work/${entryId}`); } catch { /* non-fatal */ }
    load();
  }

  async function submitNewEntry() {
    const st = normalizeTimeValue(newEntry.start_time);
    const et = normalizeTimeValue(newEntry.end_time);
    if (!st || !et) return;
    try {
      await axios.post(`/schools/${meeting.school_id}/meetings/${meeting.id}/offline-work`, { start_time: st, end_time: et });
    } catch { /* non-fatal */ }
    setAddingOffline(false);
    setNewEntry({ start_time: "", end_time: "" });
    load();
  }

  async function reassignCall(callId, targetMeetingId) {
    try { await axios.patch(`/schools/meetings/${meeting.id}/call-links/${callId}/reassign`, { target_meeting_id: targetMeetingId }); } catch { /* non-fatal */ }
    setReassignOpenFor(null);
    load();
  }

  if (loading) {
    return (
      <div className="py-6 flex justify-center" role="status" aria-label="טוען פירוט פעילות">
        <div aria-hidden="true" className="spinner w-6 h-6" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-4 text-center" role="alert">
        <p className="text-red-600 text-sm mb-2">{error}</p>
        <button onClick={load} className="btn-blue text-xs px-3 py-1.5">רענן</button>
      </div>
    );
  }

  const calls = detail?.calls || [];
  const offlineEntries = detail?.offline_entries || [];
  const otherMeetings = detail?.other_meetings_same_day || [];

  return (
    <div className="py-4 pr-6" dir="rtl" style={{ maxWidth: "55%" }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-slate-400 border-b border-slate-200">
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">סוג</th>
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">תפקיד צד שני</th>
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">שם צד שני</th>
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">שעת התחלה</th>
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">שעת סיום</th>
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">הערות</th>
            <th scope="col" className="text-right font-medium pb-1.5 pl-2">סה"כ</th>
            <th scope="col" className="text-center font-medium pb-1.5 pl-2">סיכום AI</th>
            <th scope="col" className="text-center font-medium pb-1.5">תמלול</th>
          </tr>
        </thead>
        <tbody>
          {calls.length === 0 && offlineEntries.length === 0 && (
            <tr><td colSpan={9} className="text-center text-slate-400 text-xs py-3">אין פעילות רשומה עבור פגישה זו</td></tr>
          )}
          {calls.map(c => (
            <tr key={c.call_id} className="border-b border-slate-100 last:border-0">
              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap">שיחה</td>
              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap">{c.contact_role || "—"}</td>
              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap">{c.contact_name || "—"}</td>
              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap" dir="ltr">{formatCallTime(c.call_time)}</td>
              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap" dir="ltr">{computeCallEndHM(c.call_time, c.duration_seconds)}</td>
              <td className="py-1.5 pl-2"><NotesCell value={c.notes} onSave={v => saveCallNote(c.call_id, v)} /></td>
              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap" dir="ltr">{formatDuration(c.duration_seconds)}</td>
              <td className="py-1.5 pl-2 text-center">
                {c.ai_summary ? (
                  <button type="button"
                    onClick={() => openCallNote({ windowLabel: "סיכום שיחה", title: c.contact_name || "שיחה", kind: "summary", text: c.ai_summary })}
                    className="text-slate-400 hover:text-blue-600 transition-colors" aria-label="הצג סיכום שיחה">📝</button>
                ) : <span className="text-slate-300 text-xs">—</span>}
              </td>
              <td className="py-1.5 text-center">
                <div className="flex items-center justify-center gap-2">
                  {c.ai_transcript_available ? (
                    <button type="button"
                      onClick={() => openCallNote({ windowLabel: "תמלול שיחה", title: c.contact_name || "שיחה", kind: "transcript", callId: c.call_id })}
                      className="text-slate-400 hover:text-blue-600 transition-colors" aria-label="הצג תמלול שיחה">📝</button>
                  ) : <span className="text-slate-300 text-xs">—</span>}
                  {otherMeetings.length > 0 && (
                    <div className="relative">
                      <button type="button" onClick={() => setReassignOpenFor(reassignOpenFor === c.call_id ? null : c.call_id)}
                        className="text-slate-400 hover:text-slate-700 text-xs" aria-label="העבר שיחה לפגישה אחרת" title="העבר לפגישה אחרת">↔</button>
                      {reassignOpenFor === c.call_id && (
                        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[170px]" dir="rtl">
                          {otherMeetings.map(om => (
                            <button key={om.id} type="button" onClick={() => reassignCall(c.call_id, om.id)}
                              className="w-full text-right px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap">
                              העבר לפגישה {om.start_time || "—"}-{om.end_time || "—"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {offlineEntries.map(e => {
            const [sh, sm] = (e.start_time || "").split(":").map(Number);
            const [eh, em] = (e.end_time || "").split(":").map(Number);
            const durSeconds = (!Number.isNaN(sh) && !Number.isNaN(eh))
              ? Math.max(0, (eh * 60 + em) - (sh * 60 + sm)) * 60
              : 0;
            return (
              <tr key={e.id} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap">עבודה עצמאית</td>
                <td className="py-1.5 pl-2 text-slate-300">—</td>
                <td className="py-1.5 pl-2 text-slate-300">—</td>
                <td className="py-1.5 pl-2">
                  <OfflineTimeInput value={e.start_time} ariaLabel="שעת התחלה" onSave={v => patchOffline(e.id, { start_time: v })} />
                </td>
                <td className="py-1.5 pl-2">
                  <OfflineTimeInput value={e.end_time} ariaLabel="שעת סיום" onSave={v => patchOffline(e.id, { end_time: v })} />
                </td>
                <td className="py-1.5 pl-2"><NotesCell value={e.notes} onSave={v => patchOffline(e.id, { notes: v })} /></td>
                <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap" dir="ltr">{formatDuration(durSeconds)}</td>
                <td className="py-1.5 pl-2 text-center text-slate-300 text-xs">—</td>
                <td className="py-1.5 text-center">
                  <button type="button" onClick={() => deleteOffline(e.id)} aria-label="מחק רשומת עבודה עצמאית"
                    className="text-slate-400 hover:text-red-600 transition-colors text-xs">מחק</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3">
        {addingOffline ? (
          <div className="flex items-center gap-2 text-sm">
            <label className="sr-only" htmlFor="new-offline-start">שעת התחלה</label>
            <input id="new-offline-start" type="text" inputMode="numeric" maxLength={5} dir="ltr" placeholder="שעת התחלה"
              value={newEntry.start_time} onChange={e => setNewEntry(p => ({ ...p, start_time: e.target.value.replace(/[^\d:]/g, "").slice(0, 5) }))}
              className="w-24 text-sm border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400" />
            <span className="text-slate-400">—</span>
            <label className="sr-only" htmlFor="new-offline-end">שעת סיום</label>
            <input id="new-offline-end" type="text" inputMode="numeric" maxLength={5} dir="ltr" placeholder="שעת סיום"
              value={newEntry.end_time} onChange={e => setNewEntry(p => ({ ...p, end_time: e.target.value.replace(/[^\d:]/g, "").slice(0, 5) }))}
              className="w-24 text-sm border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400" />
            <button type="button" onClick={submitNewEntry} className="btn-blue text-xs px-3 py-1.5">שמור</button>
            <button type="button" onClick={() => { setAddingOffline(false); setNewEntry({ start_time: "", end_time: "" }); }}
              className="btn-ghost text-xs px-3 py-1.5">ביטול</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingOffline(true)}
            className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline">
            + הוסף עבודה עצמאית
          </button>
        )}
      </div>
    </div>
  );
}
