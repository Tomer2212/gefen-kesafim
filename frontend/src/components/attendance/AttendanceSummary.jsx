import { monthSummary, formatMinutes } from "./attendanceConstants";

function Stat({ label, value }) {
  return (
    <div className="bg-white/70 rounded-lg px-2 py-1.5 text-center border border-slate-100">
      <div className="text-base font-semibold text-slate-800 tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

// כרטיס סיכום חודשי קומפקטי מתחת לטבלה (קבוע — תמיד גלוי).
export default function AttendanceSummary({ entries }) {
  const s = monthSummary(entries);
  return (
    <div className="glass-card rounded-xl p-3 mt-2 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-500 shrink-0">סיכום החודש</span>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 flex-1">
        <Stat label="סה״כ שעות עבודה" value={formatMinutes(s.totalWorkMinutes) || "00:00"} />
        <Stat label="ימי עבודה בפועל" value={s.workDays} />
        <Stat label="ממוצע שעות ליום" value={formatMinutes(s.avgMinutesPerDay) || "00:00"} />
        <Stat label="ימי מחלה" value={s.sickDays} />
        <Stat label="ימי מילואים" value={s.reserveDays} />
        <Stat label="ימי חופש" value={s.vacationDays} />
      </div>
    </div>
  );
}
