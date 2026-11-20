import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { MEETING_SERVICE_TYPE_OPTIONS, MEETING_TYPE_OPTIONS, STATUS_MAP } from "./constants";

// "פגישות שהתאריך שלהן עבר ועדיין נקבעה" (backend/overdue_status_alerts.py) — the live list behind
// the bell notification and the popup. mode="personal": the caller's own meetings;
// mode="summary": owners/managers, grouped per responsible user. Updates go through
// PATCH /schools/meetings/overdue-status/{id} (logged as source "overdue_alert").

const NEW_STATUSES = ["completed", "cancelled", "postponed", "other"];
const SERVICE_LABEL = Object.fromEntries(MEETING_SERVICE_TYPE_OPTIONS.map(o => [o.value, o.label]));
const TYPE_LABEL = Object.fromEntries(MEETING_TYPE_OPTIONS.map(o => [o.value, o.label]));

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function formatTime(start, end) {
  const s = (start || "").slice(0, 5);
  const e = (end || "").slice(0, 5);
  if (!s) return "—";
  return e ? `${s}–${e}` : s;
}

function cardLink(m) {
  if (m.school_client_type && m.school_client_type !== "school") return `/client/${m.school_id}`;
  const year = m.academic_year ? `&year=${encodeURIComponent(m.academic_year)}` : "";
  return `/school/${m.school_id}?tab=meetings${year}`;
}

export function OverdueMeetingsTable({ meetings, onDone, idPrefix = "overdue" }) {
  const [drafts, setDrafts] = useState({}); // {id: {status, note}}
  const [saving, setSaving] = useState({});
  const [errors, setErrors] = useState({});
  const [doneIds, setDoneIds] = useState({}); // {id: label}

  function setDraft(id, patch) {
    setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  }

  async function save(m) {
    const d = drafts[m.id] || {};
    if (!d.status) return;
    setSaving(prev => ({ ...prev, [m.id]: true }));
    setErrors(prev => ({ ...prev, [m.id]: "" }));
    try {
      const res = await axios.patch(`/schools/meetings/overdue-status/${m.id}`, { status: d.status, note: d.note || null });
      const noteLost = res.data?.note_saved === false ? " — ההערה לא נשמרה, יש להוסיף אותה בכרטיס" : "";
      setDoneIds(prev => ({ ...prev, [m.id]: `עודכנה ל${STATUS_MAP[d.status]?.label || d.status}${noteLost}` }));
      onDone?.(m.id);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 409 && detail?.code === "already_updated") {
        setDoneIds(prev => ({ ...prev, [m.id]: `כבר עודכנה (${STATUS_MAP[detail.status]?.label || detail.status})` }));
        onDone?.(m.id);
      } else {
        setErrors(prev => ({ ...prev, [m.id]: typeof detail === "string" ? detail : "העדכון נכשל, נסה שוב" }));
      }
    } finally {
      setSaving(prev => ({ ...prev, [m.id]: false }));
    }
  }

  const pending = meetings.filter(m => !doneIds[m.id] && drafts[m.id]?.status);

  async function saveAll() {
    for (const m of pending) await save(m);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">בית ספר</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">תאריך</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">שעה</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">סוג</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">יועץ מבצע</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">סטטוס חדש</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">הערה (לא חובה)</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            {meetings.map(m => {
              const done = doneIds[m.id];
              const d = drafts[m.id] || {};
              const selectId = `${idPrefix}-status-${m.id}`;
              const noteId = `${idPrefix}-note-${m.id}`;
              const type = [SERVICE_LABEL[m.meeting_service_type], TYPE_LABEL[m.meeting_type]].filter(Boolean).join(" · ");
              return (
                <tr key={m.id} className={`border-t border-slate-100 ${done ? "bg-emerald-50/60" : ""}`}>
                  <td className="px-3 py-2 text-slate-800">
                    {m.school_id ? (
                      <Link to={cardLink(m)}>{m.school_name || "—"}</Link>
                    ) : (m.school_name || "—")}
                  </td>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{formatDate(m.meeting_date)}</td>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap" dir="ltr">{formatTime(m.start_time, m.end_time)}</td>
                  <td className="px-3 py-2 text-slate-600">{type || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{m.advisor_names?.length ? m.advisor_names.join(", ") : "ללא יועץ"}</td>
                  {done ? (
                    <td colSpan={3} className="px-3 py-2 text-emerald-700 font-semibold">✓ {done}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2">
                        <label htmlFor={selectId} className="sr-only">סטטוס חדש לפגישה עם {m.school_name}</label>
                        <select id={selectId} value={d.status || ""} disabled={saving[m.id]}
                          onChange={e => setDraft(m.id, { status: e.target.value })}
                          className="input-field text-sm py-1.5 min-w-[7rem]">
                          <option value="">בחר…</option>
                          {NEW_STATUSES.map(s => <option key={s} value={s}>{STATUS_MAP[s]?.label || s}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <label htmlFor={noteId} className="sr-only">הערה לפגישה עם {m.school_name}</label>
                        <input id={noteId} type="text" value={d.note || ""} disabled={saving[m.id]}
                          onChange={e => setDraft(m.id, { note: e.target.value })}
                          className="input-field text-sm py-1.5 min-w-[9rem]" />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => save(m)} disabled={!d.status || saving[m.id]}
                            className="btn-blue text-xs px-3 py-1.5 disabled:opacity-50">
                            {saving[m.id] ? "..." : "עדכן"}
                          </button>
                          <Link to={cardLink(m)} className="text-xs text-blue-700 hover:underline">פתח בכרטיס</Link>
                        </div>
                        {errors[m.id] && <p role="alert" className="text-xs text-red-600 mt-1">{errors[m.id]}</p>}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pending.length > 1 && (
        <div className="flex justify-end">
          <button type="button" onClick={saveAll} className="btn-blue text-sm px-4 py-2">
            עדכן את כל {pending.length} השורות שנבחר להן סטטוס
          </button>
        </div>
      )}
      <p className="text-xs text-slate-400">אם הפגישה התקיימה בתאריך אחר, יש לעדכן את התאריך דרך "פתח בכרטיס".</p>
    </div>
  );
}

function SummaryUsers({ users }) {
  const [openId, setOpenId] = useState(users.length === 1 ? users[0].user_id : null);
  return (
    <ul className="flex flex-col gap-2">
      {users.map(u => {
        const open = openId === u.user_id;
        return (
          <li key={u.user_id} className="rounded-xl border border-slate-200">
            <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : u.user_id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-right hover:bg-slate-50 rounded-xl">
              <span className="font-semibold text-slate-800">{u.name || "משתמש"}</span>
              <span className="text-slate-500">
                {u.count === 1 ? "פגישה אחת" : `${u.count} פגישות`}
                {u.oldest_date && ` · הוותיקה מ-${formatDate(u.oldest_date)}`}
                <span aria-hidden="true" className="mr-2">{open ? "▲" : "▼"}</span>
              </span>
            </button>
            {open && (
              <div className="px-3 pb-3">
                <OverdueMeetingsTable meetings={u.meetings} idPrefix={`overdue-sum-${u.user_id}`} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function OverdueMeetingsPanel({ mode = "personal", onEmpty }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // A ref, so an inline onEmpty from the parent never re-triggers the load.
  const onEmptyRef = useRef(onEmpty);
  onEmptyRef.current = onEmpty;

  useEffect(() => {
    let cancelled = false;
    const url = mode === "summary" ? "/schools/meetings/overdue-status/by-user" : "/schools/meetings/overdue-status/my";
    axios.get(url)
      .then(res => {
        if (cancelled) return;
        const rows = mode === "summary" ? (res.data?.users || []) : (res.data?.meetings || []);
        setData(rows);
        if (!rows.length) onEmptyRef.current?.();
      })
      .catch(() => { if (!cancelled) setError("טעינת הרשימה נכשלה"); });
    return () => { cancelled = true; };
  }, [mode]);

  if (error) return <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>;
  if (data === null) {
    return (
      <div role="status" aria-label="טוען פגישות" className="flex justify-center py-6">
        <div aria-hidden="true" className="spinner w-6 h-6" />
      </div>
    );
  }
  if (!data.length) {
    return <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">✓ אין פגישות שממתינות לעדכון סטטוס.</p>;
  }
  return mode === "summary" ? <SummaryUsers users={data} /> : <OverdueMeetingsTable meetings={data} />;
}
