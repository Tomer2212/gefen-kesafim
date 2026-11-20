import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { supabase } from "../../lib/supabase";

const AUTOMATIONS = [
  {
    key: "meeting_reminders_enabled",
    description: "שליחת תזכורת למשתתפים לפני פגישה",
    hint: "קובע רק את מצב ברירת המחדל של מתג \"תזכורת\" בפגישה חדשה (פגישה עם משתתפים ותאריך עתידי נפתחת עם המתג דלוק). השליחה בפועל תלויה במתג שבשורת הפגישה. פגישה שנקבעת לאותו היום לא תקבל תזכורת.",
  },
  {
    key: "secretary_upload_request_enabled",
    description: "שליחת בקשה למנהלנית להעלאת קבצים יום לפני פגישת גפן/מחוז",
    hint: "פועל באופן עצמאי — המנהלנית/כספים מקבלים את בקשת הקבצים בפגישת גפן/מחוז גם אם מתג התזכורת בשורת הפגישה כבוי.",
  },
  {
    key: "auto_complete_meetings_from_activity_enabled",
    description: "השלמה אוטומטית של סטטוס פגישה כשיש מספיק פעילות (שיחות/עבודה עצמאית) אחרי שעת סיומה",
  },
  {
    key: "overdue_status_alerts_enabled",
    description: "תזכורת לעדכון סטטוס פגישות שהתאריך שלהן עבר",
    hint: "פגישה של שנת הלימודים הנוכחית שהתאריך שלה עבר ועדיין בסטטוס \"נקבעה\" (לא נסגרה אוטומטית ולא עודכנה ידנית). בימים ובשעות שנבחרו, כל יועץ מבצע מקבל התראה וחלונית קופצת עם הפגישות שלו, ויכול לעדכן את הסטטוס במקום. פגישה בלי יועץ — למי שיצר אותה.",
  },
];

// overdue_status_alert_days: 0 = Sunday … 6 = Saturday (backend/overdue_status_alerts.py).
const DAYS = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // window start hours 07–19
const pad = h => String(h).padStart(2, "0");
const hourLabel = h => `${pad(h)}:00–${pad(h + 1)}:00`;

function Chip({ active, disabled, onClick, label, ariaLabel }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} aria-label={ariaLabel}
      className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${
        active ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-300 text-slate-600 hover:border-blue-400"
      }`}>
      {label}
    </button>
  );
}

function OverdueSettings({ settings, save, saving }) {
  const [managers, setManagers] = useState(null);
  const [myId, setMyId] = useState(null);
  const [localError, setLocalError] = useState("");
  const days = settings.overdue_status_alert_days || [];
  const hours = settings.overdue_status_alert_hours || [];
  const recipients = settings.overdue_summary_recipient_ids || [];

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyId(data?.session?.user?.id || null)).catch(() => {});
    axios.get("/schools/users/all")
      .then(res => setManagers((res.data || []).filter(u => u.role === "owner" || u.role === "manager")))
      .catch(() => setManagers([]));
  }, []);

  function toggleIn(list, value, field, emptyMsg) {
    const next = list.includes(value) ? list.filter(x => x !== value) : [...list, value].sort((a, b) => a - b);
    if (!next.length) { setLocalError(emptyMsg); return; }
    setLocalError("");
    save({ [field]: next });
  }

  function toggleSummary() {
    const on = !settings.overdue_summary_enabled;
    const patch = { overdue_summary_enabled: on };
    // First time on: only whoever turned it on (the point is not to flood every manager).
    if (on && !recipients.length && myId) patch.overdue_summary_recipient_ids = [myId];
    save(patch);
  }

  function toggleRecipient(id) {
    const next = recipients.includes(id) ? recipients.filter(x => x !== id) : [...recipients, id];
    save({ overdue_summary_recipient_ids: next });
  }

  const summaryOn = !!settings.overdue_summary_enabled;
  const frequency = settings.overdue_summary_frequency || "weekly";
  return (
    <div className="flex flex-col gap-3 mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-1.5">באילו ימים</p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <Chip key={i} label={d} ariaLabel={`יום ${DAY_NAMES[i]}`} active={days.includes(i)} disabled={saving}
              onClick={() => toggleIn(days, i, "overdue_status_alert_days", "יש להשאיר לפחות יום אחד")} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-1.5">באילו שעות (כל שעה שנבחרה = התראה אחת ביום)</p>
        <div className="flex flex-wrap gap-1.5">
          {HOURS.map(h => (
            <Chip key={h} label={<span dir="ltr">{hourLabel(h)}</span>} ariaLabel={hourLabel(h)} active={hours.includes(h)}
              disabled={saving} onClick={() => toggleIn(hours, h, "overdue_status_alert_hours", "יש להשאיר לפחות שעה אחת")} />
          ))}
        </div>
      </div>
      {localError && <p role="alert" className="text-xs text-red-600">{localError}</p>}

      <div className="border-t border-slate-200 pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-700">סיכום למנהלים</p>
            <p className="text-xs text-slate-400">כמה פגישות לא עודכנו אצל כל משתמש — רק לבעלים/מנהלים שנבחרו.</p>
          </div>
          <button type="button" onClick={toggleSummary} disabled={saving} aria-pressed={summaryOn}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-60 ${
              summaryOn ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-red-50 text-red-600 hover:bg-red-100"
            }`}>
            {summaryOn ? "פעיל" : "כבוי"}
          </button>
        </div>
        {summaryOn && (
          <>
            <fieldset>
              <legend className="text-xs font-semibold text-slate-600 mb-1.5">למי</legend>
              {managers === null ? (
                <div role="status" aria-label="טוען משתמשים"><div aria-hidden="true" className="spinner w-4 h-4" /></div>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {managers.map(u => (
                    <label key={u.id} htmlFor={`overdue-rcpt-${u.id}`} className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input id={`overdue-rcpt-${u.id}`} type="checkbox" checked={recipients.includes(u.id)} disabled={saving}
                        onChange={() => toggleRecipient(u.id)} />
                      {u.full_name || u.email}
                    </label>
                  ))}
                </div>
              )}
              {managers !== null && !recipients.length && (
                <p role="alert" className="text-xs text-amber-700 mt-1">לא נבחר אף נמען — הסיכום לא יישלח.</p>
              )}
            </fieldset>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="overdue-summary-freq" className="block text-xs font-semibold text-slate-600 mb-1">תדירות</label>
                <select id="overdue-summary-freq" value={frequency} disabled={saving}
                  onChange={e => save({ overdue_summary_frequency: e.target.value })} className="input-field text-sm py-1.5">
                  <option value="daily">כל יום</option>
                  <option value="weekly">פעם בשבוע</option>
                </select>
              </div>
              {frequency === "weekly" && (
                <div>
                  <label htmlFor="overdue-summary-day" className="block text-xs font-semibold text-slate-600 mb-1">ביום</label>
                  <select id="overdue-summary-day" value={settings.overdue_summary_weekday ?? 0} disabled={saving}
                    onChange={e => save({ overdue_summary_weekday: Number(e.target.value) })} className="input-field text-sm py-1.5">
                    {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="overdue-summary-hour" className="block text-xs font-semibold text-slate-600 mb-1">בשעה</label>
                <select id="overdue-summary-hour" value={settings.overdue_summary_hour ?? 8} disabled={saving}
                  onChange={e => save({ overdue_summary_hour: Number(e.target.value) })} className="input-field text-sm py-1.5">
                  {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function MeetingAutomationsModal({ onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    axios.get("/schools/meetings/automations")
      .then(res => setSettings(res.data || {}))
      .catch(() => setError("טעינת האוטומציות נכשלה"))
      .finally(() => setLoading(false));
  }, []);

  async function save(patch, key) {
    setSavingKey(key);
    setError("");
    try {
      const res = await axios.put("/schools/meetings/automations", patch);
      // The server may clean the recipients list (owners/managers of this org only).
      setSettings(prev => ({ ...prev, ...patch, ...(res.data?.overdue_summary_recipient_ids
        ? { overdue_summary_recipient_ids: res.data.overdue_summary_recipient_ids } : {}) }));
    } catch {
      setError("עדכון האוטומציה נכשל, נסה שוב");
    } finally {
      setSavingKey(null);
    }
  }

  function toggle(key) {
    return save({ [key]: !settings[key] }, key);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="automations-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-4">
        <h2 id="automations-modal-title" className="font-bold text-slate-900 text-lg">אוטומציות</h2>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div role="status" aria-label="טוען אוטומציות" className="flex justify-center py-6">
            <div aria-hidden="true" className="spinner w-6 h-6" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="text-right py-2 px-2 font-semibold text-slate-600">תיאור</th>
                <th scope="col" className="text-right py-2 px-2 font-semibold text-slate-600 w-28">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {AUTOMATIONS.map(a => {
                const active = !!settings?.[a.key];
                const saving = savingKey === a.key;
                return (
                  <tr key={a.key} className="border-b border-slate-300">
                    <td className="py-3 px-2 text-slate-700">
                      {a.description}
                      {a.hint && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{a.hint}</p>}
                      {a.key === "overdue_status_alerts_enabled" && active && (
                        <OverdueSettings settings={settings} saving={savingKey === "overdue_settings"}
                          save={patch => save(patch, "overdue_settings")} />
                      )}
                    </td>
                    <td className="py-3 px-2 align-top">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggle(a.key)}
                        aria-pressed={active}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-60 ${
                          active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-red-50 text-red-600 hover:bg-red-100"
                        }`}
                      >
                        {saving ? "..." : active ? "פעיל" : "כבוי"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">סגירה</button>
        </div>
      </div>
    </div>
  );
}
