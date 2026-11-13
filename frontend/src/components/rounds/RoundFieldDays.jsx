import { useEffect, useState } from "react";
import axios from "axios";
import DirectStyleDateInput from "../tasks/DirectStyleDateInput";
import { formatDateDMY } from "../tasks/taskShared";

// "ימי שטח" of a round: per advisor with physical schools in it — how much in-person meeting
// time is still needed, a suggested number of days, and the days set. A physical task of the
// round offers each school only its advisor's field days, and on those days the advisor isn't
// offered for remote meetings on any link. Data: GET/POST/DELETE /rounds/{id}/field-days.
const WEEKDAYS = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

function weekday(iso) {
  return WEEKDAYS[new Date(`${iso}T12:00:00`).getDay()];
}

// refreshKey: the round's updated_at — a round edit (physical schools, who visits) reloads this.
// onData / onError: every (re)load is reported to the dashboard, so its physical-task buttons know
// at once whether field days are missing, without a request of their own on click.
export default function RoundFieldDays({ roundId, exemptIds = [], onExemptChange, refreshKey, onData, onError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [draftDay, setDraftDay] = useState({}); // {advisor_id: "YYYY-MM-DD"}
  const [busyId, setBusyId] = useState(null);

  function load() {
    axios.get(`/rounds/${roundId}/field-days`)
      .then(r => { setData(r.data); onData?.(r.data); })
      .catch(() => { setError("טעינת ימי השטח נכשלה."); onError?.(); });
  }
  useEffect(() => { load(); }, [roundId, refreshKey]);

  async function addDay(advisorId) {
    const day = draftDay[advisorId];
    if (!day) return;
    setBusyId(advisorId);
    setError("");
    try {
      await axios.post(`/rounds/${roundId}/field-days`, { advisor_id: advisorId, days: [day] });
      setDraftDay(prev => ({ ...prev, [advisorId]: "" }));
      load();
    } catch {
      setError("הוספת יום השטח נכשלה — נסו שוב.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeDay(id) {
    setBusyId(id);
    try {
      await axios.delete(`/rounds/${roundId}/field-days/${id}`);
      load();
    } finally {
      setBusyId(null);
    }
  }

  // Removing an advisor who doesn't go out (e.g. the שוטף advisor of a גפן+שוטף school when only
  // the גפן advisor visits): no field days are asked of them, and a physical meeting is offered
  // on the remaining advisors' field days. Reversible.
  async function setExempt(advisorId, exempt) {
    setBusyId(advisorId);
    setError("");
    try {
      const next = exempt ? [...new Set([...exemptIds, advisorId])] : exemptIds.filter(id => id !== advisorId);
      await axios.patch(`/rounds/${roundId}`, { field_exempt_advisor_ids: next });
      onExemptChange?.();
      load();
    } catch {
      setError("השמירה נכשלה — נסו שוב.");
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;
  if (!data.advisors.length) return null;

  return (
    <section aria-labelledby="round-field-days-title" className="flex flex-col gap-2">
      <h3 id="round-field-days-title" className="font-bold text-slate-800 text-sm">ימי שטח (פגישות פיזיות)</h3>
      <p className="text-xs text-slate-500">
        בית ספר עם פגישה פיזית יוכל לקבוע רק בימי השטח של היועץ שלו, ובימים האלה לא יוצעו ליועץ פגישות מרחוק באף לינק.
        ההמלצה מחושבת לפי זמן הפגישות שעוד לא נקבעו, כ-{Math.round(data.field_day_meeting_minutes / 60)} שעות פגישות ליום (כולל נסיעות) — הערכה בלבד.
      </p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-col gap-2">
        {data.advisors.map(a => {
          const short = !a.exempt && a.suggested_days > a.days.length;
          if (a.exempt) {
            return (
              <div key={a.advisor_id} className="border border-slate-200 bg-slate-50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-500">
                  <b className="text-slate-700">{a.name}</b> — הוסר/ה מימי השטח (לא מגיע/ה לבתי הספר; צריך/ה רק להיות פנוי/ה בזמן הפגישה)
                </span>
                <button type="button" disabled={busyId === a.advisor_id} onClick={() => setExempt(a.advisor_id, false)}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap">החזר לימי השטח</button>
              </div>
            );
          }
          return (
            <div key={a.advisor_id} className={`border rounded-xl p-3 flex flex-col gap-2 ${short ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
                <span className="font-semibold">{a.advisor_id === "__none__" ? <span className="text-red-600">בתי ספר בלי יועץ בכרטיס</span> : a.name}</span>
                <span className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-slate-600">
                    {a.schools.length} בתי ספר פיזיים · {Math.round(a.minutes / 6) / 10} שעות פגישות שעוד לא נקבעו · מומלץ {a.suggested_days} ימים · הוגדרו {a.days.length}
                  </span>
                  {a.advisor_id !== "__none__" && (
                    <button type="button" disabled={busyId === a.advisor_id} onClick={() => setExempt(a.advisor_id, true)}
                      aria-label={`הסרת ${a.name} מימי השטח`}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                      הסר — לא מגיע/ה לשטח
                    </button>
                  )}
                </span>
              </div>
              {short && a.advisor_id !== "__none__" && (
                <p className="text-xs text-amber-800">כנראה צריך עוד {a.suggested_days - a.days.length} ימי שטח כדי שכל בתי הספר יוכלו לקבוע.</p>
              )}
              <p className="text-[11px] text-slate-500">{a.schools.map(s => s.school_name + (s.city ? ` (${s.city})` : "")).join(" · ")}</p>
              {a.advisor_id !== "__none__" && (
                <div className="flex items-center gap-2 flex-wrap">
                  {a.days.map(d => (
                    <span key={d.id} className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-800 rounded-full px-2 py-1">
                      יום {weekday(d.day)} <bdi>{formatDateDMY(d.day)}</bdi>
                      <button type="button" aria-label={`הסרת יום השטח ${formatDateDMY(d.day)}`} disabled={busyId === d.id}
                        onClick={() => removeDay(d.id)} className="text-violet-500 hover:text-red-600">✕</button>
                    </span>
                  ))}
                  <span className="flex items-end gap-1.5">
                    <span className="flex flex-col gap-0.5">
                      <label htmlFor={`field-day-${a.advisor_id}`} className="text-[11px] text-slate-500">הוספת יום</label>
                      <DirectStyleDateInput id={`field-day-${a.advisor_id}`} value={draftDay[a.advisor_id] || ""}
                        onChange={v => setDraftDay(prev => ({ ...prev, [a.advisor_id]: v }))} />
                    </span>
                    <button type="button" disabled={!draftDay[a.advisor_id] || busyId === a.advisor_id} onClick={() => addDay(a.advisor_id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40">הוסף</button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
