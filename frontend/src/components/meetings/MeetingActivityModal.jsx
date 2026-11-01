import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { History } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { AUTHOR_COLORS, formatUpdateDate } from "../SchoolNotesModal";
import { getStatusDisplay, formatMeetingDate, MEETING_TYPE_OPTIONS, MEETING_SERVICE_TYPE_OPTIONS } from "./constants";

// "תיעוד פעילות" — read-only activity log of one meeting (GET /schools/{sid}/meetings/{mid}/activity).
// Each row = one event (consecutive autosaves are merged server-side). Field-change rows show the
// meeting's columns as they were after the change, with only the changed cells highlighted orange
// (hover/focus shows the previous value). Related actions (notes, offline work, summary, …) show a
// single wide description cell instead.

const CHANGED_BG = "#FED7AA";
const STAGE_LABELS = { tichon: "תיכון", chativa: "חט\"ב", both: "שניהם" };
const TYPE_LABELS = Object.fromEntries(MEETING_TYPE_OPTIONS.map(o => [o.value, o.label]));
const SERVICE_LABELS = Object.fromEntries(MEETING_SERVICE_TYPE_OPTIONS.map(o => [o.value, o.label]));
const SURFACE_LABELS = { school_card: "כרטיס בית ספר", personal: "אזור אישי", admin: "ניהול פגישות" };

function formatSeconds(seconds) {
  if (!seconds) return "0:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function personName(profiles, id) {
  const p = profiles[id];
  return p?.full_name || p?.email || "משתמש לא ידוע";
}

// Columns mirror the meetings table. `fields` = which tracked fields feed the cell (any of them
// changed → the cell is highlighted).
const COLUMNS = [
  { key: "date",     label: "תאריך",       fields: ["meeting_date"],  render: s => formatMeetingDate(s.meeting_date) },
  { key: "status",   label: "סטטוס",       fields: ["status"],        render: s => s.status ? getStatusDisplay(s.status).label : "—" },
  { key: "start",    label: "התחלה",       fields: ["start_time"],    render: s => s.start_time?.slice(0, 5) || "—" },
  { key: "end",      label: "סיום",        fields: ["end_time"],      render: s => s.end_time?.slice(0, 5) || "—" },
  { key: "advisors", label: "יועץ מבצע",   fields: ["advisor_ids"],   render: (s, p) => (s.advisor_ids || []).map(id => personName(p, id)).join(", ") || "—" },
  { key: "participants", label: "משתתפים", fields: ["participants", "stage_scope", "primary_contact_key"],
    render: s => {
      const names = (s.participants || []).map(x => x?.name || x?.label).filter(Boolean).join(", ") || "—";
      return s.stage_scope ? `${names} · ${STAGE_LABELS[s.stage_scope] || s.stage_scope}` : names;
    } },
  { key: "type",     label: "מיקום",       fields: ["meeting_type"],  render: s => s.meeting_type ? (TYPE_LABELS[s.meeting_type] || s.meeting_type) : "—" },
  { key: "service",  label: "סוג",         fields: ["meeting_service_type", "requested_upload_years"],
    render: s => {
      const label = s.meeting_service_type ? (SERVICE_LABELS[s.meeting_service_type] || s.meeting_service_type) : "—";
      const years = s.requested_upload_years || [];
      return years.length ? `${label} · קבצים: ${years.join(", ")}` : label;
    } },
  { key: "reminder", label: "תזכורת",      fields: ["reminder_enabled"], render: s => s.reminder_enabled ? "ON" : "OFF" },
  { key: "year",     label: "שנת לימודים", fields: ["academic_year"], render: s => s.academic_year || "—" },
  { key: "calls_start", label: "תחילת שיחה", fields: ["calls_start_time"], render: s => s.calls_start_time?.slice(0, 5) || "—" },
  { key: "calls_dur",   label: "משך שיחות",  fields: ["calls_duration_seconds"], render: s => formatSeconds(s.calls_duration_seconds) },
];

function actorLabel(ev, profiles) {
  if (ev.actor_type === "school") return "בית הספר";
  if (ev.actor_type === "outlook") return "Outlook";
  if (ev.actor_type === "system") return "המערכת";
  if (ev.actor_type === "unknown") return "לא ידוע";
  return ev.actor_id ? personName(profiles, ev.actor_id) : "—";
}

function actionLabel(ev, profiles, tasks) {
  const meta = ev.meta || {};
  const surface = SURFACE_LABELS[ev.source];
  switch (ev.action) {
    case "created":
      if (ev.source === "import") return "יצירה — ייבוא מאקסל";
      if (ev.source === "task_booking_link") return `יצירה — תיאום עצמי של בית הספר דרך קישור ממשימה${tasks[meta.task_id] ? `: ${tasks[meta.task_id]}` : ""}`;
      if (ev.source === "booking_link") return "יצירה — תיאום עצמי של בית הספר דרך קישור";
      if (surface) return `יצירה — הוספה ידנית ב${surface}`;
      return "יצירה";
    case "updated":
      if (ev.source === "outlook") {
        const owners = (meta.calendar_owner_ids || []).map(id => personName(profiles, id)).join(", ");
        return meta.event_deleted ? `בוטלה ביומן Outlook${owners ? ` של ${owners}` : ""}` : `עדכון מיומן Outlook${owners ? ` של ${owners}` : ""}`;
      }
      if (ev.source === "auto_complete") return "סגירה אוטומטית (לפי שיחות / עבודה אופליין)";
      if (ev.source === "calls_sync") return "עדכון זמני שיחות (Voicenter)";
      if (ev.source === "status_popup") return "עדכון סטטוס מחלונית תזכורת";
      if (ev.source === "user_transfer") return "העברת פגישות בין יועצים";
      if (ev.source === "import_remap") return "מיפוי ערכי ייבוא";
      return surface ? `עדכון — ${surface}` : "עדכון";
    case "moved_year":        return "העברה לשנת לימודים אחרת";
    case "reassigned_school": return "שיוך לבית ספר אחר";
    case "advisor_joined":    return "הצטרף כיועץ מבצע";
    case "deleted":           return "מחיקת הפגישה";
    case "note_added":        return "הוספת הערה";
    case "note_edited":       return "עריכת הערה";
    case "note_deleted":      return "מחיקת הערה";
    case "offline_added":     return "הוספת עבודה אופליין";
    case "offline_edited":    return "עריכת עבודה אופליין";
    case "offline_deleted":   return "מחיקת עבודה אופליין";
    case "summary_uploaded":  return "העלאת הקלטה לסיכום פגישה";
    default:                  return ev.action;
  }
}

function offlineText(entry) {
  if (!entry) return "";
  const range = entry.start_time && entry.end_time ? `${entry.start_time.slice(0, 5)}–${entry.end_time.slice(0, 5)}` : "";
  return [range, entry.notes].filter(Boolean).join(" · ");
}

// Wide description for actions that aren't a change of the meeting's own columns.
function describeOther(ev) {
  const meta = ev.meta || {};
  switch (ev.action) {
    case "note_added":
    case "note_deleted":      return meta.content || "";
    case "note_edited":       return meta.previous_content ? `${meta.content}\n(לפני: ${meta.previous_content})` : meta.content || "";
    case "offline_added":
    case "offline_deleted":   return offlineText(meta.entry);
    case "offline_edited":    return `${offlineText(meta.entry)}${meta.previous ? `\n(לפני: ${offlineText(meta.previous)})` : ""}`;
    case "summary_uploaded":  return meta.retry ? "ניסיון חוזר לעיבוד ההקלטה השמורה" : (meta.file_name || "");
    default:                  return "";
  }
}

const FIELD_ROW_ACTIONS = new Set(["created", "updated", "moved_year", "reassigned_school", "advisor_joined", "deleted"]);

function ChangedCell({ children, before }) {
  return (
    <td className="px-2 py-2 align-top" style={{ background: CHANGED_BG }} title={`לפני: ${before}`} tabIndex={0}>
      <span className="font-semibold text-slate-900">{children}</span>
      <span className="sr-only"> (השתנה, לפני: {before})</span>
    </td>
  );
}

export function MeetingActivityModal({ meeting, waitForSaves, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Let a pending blur-autosave of this row land first, so the log includes it.
      await new Promise(r => setTimeout(r, 0));
      try { await waitForSaves?.(); } catch { /* the save's own error UI handles it */ }
      try {
        const res = await axios.get(`/schools/${meeting.school_id}/meetings/${meeting.id}/activity`);
        if (!cancelled) setData(res.data);
      } catch {
        if (!cancelled) setLoadError("טעינת תיעוד הפעילות נכשלה — נסה שוב");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meeting.id, meeting.school_id]);

  const events = data?.events || [];
  const profiles = data?.profiles || {};
  const tasks = data?.tasks || {};

  // Stable pastel color per actor (by first appearance), only when 2+ actors appear.
  const actorKey = ev => ev.actor_id || ev.actor_type;
  const chrono = [...events].reverse();
  const distinct = [...new Set(chrono.map(actorKey))];
  const colorMap = distinct.length > 1
    ? Object.fromEntries(distinct.map((k, i) => [k, AUTHOR_COLORS[i % AUTHOR_COLORS.length]]))
    : {};

  const created = events.find(e => e.action === "created");
  const lastChange = events.find(e => e.action !== "created");

  return createPortal(
    // Portaled out of the table; stop React events so they never bubble to table-level handlers.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onBlur={e => e.stopPropagation()} onFocus={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="meeting-activity-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full flex flex-col gap-4"
        style={{ maxHeight: "85vh", maxWidth: "1300px" }}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="meeting-activity-title" className="font-bold text-slate-900 text-base">
            תיעוד פעילות — פגישה {meeting.meeting_date ? `מ-${formatMeetingDate(meeting.meeting_date)}` : ""}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגור חלונית" className="btn-ghost text-sm px-3 py-1.5">✕</button>
        </div>

        {!loading && !loadError && created && (
          <div className="text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="font-semibold">נוצרה ע"י {actorLabel(created, profiles)}</span>
              {" · "}{formatUpdateDate(created.created_at)}{" · "}{actionLabel(created, profiles, tasks).replace(/^יצירה — /, "")}
            </span>
            {lastChange && (
              <span>
                <span className="font-semibold">עודכנה לאחרונה ע"י {actorLabel(lastChange, profiles)}</span>
                {" · "}{formatUpdateDate(lastChange.created_at)}
              </span>
            )}
          </div>
        )}

        <div className="overflow-auto flex-1" style={{ minHeight: "120px" }}>
          {loading && <div role="status" aria-label="טוען תיעוד פעילות" className="text-xs text-slate-400 text-center py-6">טוען…</div>}
          {loadError && <div role="alert" className="text-xs text-red-600 text-center py-6">{loadError}</div>}

          {!loading && !loadError && events.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
              <History aria-hidden="true" size={28} />
              <span className="text-sm">אין עדיין פעילות מתועדת</span>
            </div>
          )}

          {!loading && !loadError && events.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-slate-600">
                  <th scope="col" className="px-2 py-2 text-right font-semibold whitespace-nowrap" style={{ width: 110 }}>מועד הפעולה</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold whitespace-nowrap" style={{ width: 120 }}>בוצע ע"י</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold" style={{ minWidth: 160 }}>פעולה</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} scope="col" className="px-2 py-2 text-right font-semibold whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(ev => {
                  const color = colorMap[actorKey(ev)];
                  const isFieldRow = FIELD_ROW_ACTIONS.has(ev.action) && ev.snapshot;
                  const changes = ev.changes || {};
                  const deleted = ev.action === "deleted";
                  return (
                    <tr key={ev.id} className={`border-b border-slate-200 align-top ${deleted ? "bg-red-50" : "even:bg-slate-50/80 hover:bg-blue-50/60"}`}>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-600">{formatUpdateDate(ev.created_at)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className="inline-block rounded px-1.5 py-0.5 font-medium"
                          style={color ? { background: color.bg, color: color.text } : undefined}>
                          {actorLabel(ev, profiles)}
                        </span>
                      </td>
                      <td className={`px-2 py-2 ${deleted ? "text-red-700 font-semibold" : "text-slate-700"}`}>
                        {actionLabel(ev, profiles, tasks)}
                        {ev.action === "reassigned_school" && ev.meta && (
                          <span className="block text-slate-500">{ev.meta.from_school_name || "—"} ← {ev.meta.to_school_name || "—"}</span>
                        )}
                        {ev.merged_count > 1 && <span className="block text-slate-400">({ev.merged_count} שמירות)</span>}
                      </td>
                      {isFieldRow ? COLUMNS.map(c => {
                        const value = c.render(ev.snapshot, profiles);
                        const changedFields = c.fields.filter(f => f in changes);
                        if (changedFields.length > 0 && ev.action !== "created") {
                          const beforeSnap = { ...ev.snapshot };
                          for (const f of changedFields) beforeSnap[f] = changes[f].from;
                          return <ChangedCell key={c.key} before={c.render(beforeSnap, profiles)}>{value}</ChangedCell>;
                        }
                        return <td key={c.key} className="px-2 py-2 text-slate-700">{value}</td>;
                      }) : (
                        <td colSpan={COLUMNS.length} className="px-2 py-2 text-slate-700" style={{ whiteSpace: "pre-wrap" }}>
                          {ev.legacy
                            ? <span className="text-slate-400">נוצרה לפני תחילת התיעוד המלא — פרטי הפגישה בעת היצירה לא נשמרו</span>
                            : describeOther(ev)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-slate-500">
          <span className="inline-block w-3 h-3 rounded-sm align-middle ml-1" style={{ background: CHANGED_BG }} aria-hidden="true" />
          תא מסומן = השדה ששונה בפעולה זו. העבר את העכבר מעליו כדי לראות את הערך הקודם.
        </p>
      </div>
    </div>,
    document.body
  );
}
