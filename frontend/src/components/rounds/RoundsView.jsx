import { useEffect, useState } from "react";
import axios from "axios";
import RoundCreateModal from "./RoundCreateModal";
import RoundDashboard from "./RoundDashboard";
import { formatDateDMY } from "../tasks/taskShared";
import { requirementLabel } from "./roundsShared";

// "סבבי פגישות" view of the school-tasks tab: one card per round (numbers from the round's
// cached columns, refreshed every 5 minutes by the tasks-recompute-progress cron), opening into
// its dashboard. Owners/managers only, like the rest of the tasks area.
export default function RoundsView({ academicYear, openRoundId, setOpenRoundId, onRoundsChanged }) {
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  function load() {
    axios.get("/rounds/", { params: { academic_year: academicYear } })
      .then(r => { setRounds(r.data || []); onRoundsChanged?.(r.data || []); })
      .catch(() => setRounds([]))
      .finally(() => setLoading(false));
  }
  useEffect(() => { setLoading(true); load(); }, [academicYear]);

  if (openRoundId) {
    return <RoundDashboard roundId={openRoundId} onBack={() => { setOpenRoundId(null); load(); }} onChanged={load} />;
  }

  return (
    <div dir="rtl" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-slate-500 max-w-2xl">
          סבב הוא מטרה לתקופה — למשל "פגישות דצמבר לכל בתי הספר הפעילים". הוא מראה מי כבר קבע, מי קיבל בקשה ומי עוד לא טופל, ומונע בקשות כפולות בין המשימות שבתוכו.
        </p>
        <button type="button" onClick={() => setCreating(true)} className="btn-blue text-sm px-4 py-2">+ סבב פגישות חדש</button>
      </div>
      {loading ? (
        <div role="status" aria-label="טוען סבבים" className="text-sm text-slate-400">טוען...</div>
      ) : rounds.length === 0 ? (
        <p className="text-sm text-slate-500 bg-slate-50 rounded-xl px-4 py-6 text-center">עוד אין סבבים בשנה הזו.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rounds.map(r => {
            const pct = r.cached_required ? Math.round((r.cached_booked / r.cached_required) * 100) : 0;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenRoundId(r.id)}
                  className="w-full text-right bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm flex flex-col gap-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">{r.name}</span>
                    {r.status === "closed" && <span className="text-[11px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">סגור</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    <bdi>{formatDateDMY(r.start_date)}</bdi>–<bdi>{formatDateDMY(r.end_date)}</bdi> · {requirementLabel(r.requirement)}
                  </span>
                  <span className="h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                    <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-xs text-slate-600">
                    {r.cached_booked}/{r.cached_required} פגישות נקבעו ({pct}%) · {r.cached_total_schools} בתי ספר
                    {r.cached_untouched > 0 && <> · <b>{r.cached_untouched}</b> טרם טופלו</>}
                    {" · "}{r.task_count || 0} משימות
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <RoundCreateModal
          initialAcademicYear={academicYear}
          onClose={() => setCreating(false)}
          onCreated={(rnd) => { setCreating(false); load(); setOpenRoundId(rnd.id); }}
        />
      )}
    </div>
  );
}
