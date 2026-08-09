// Small "hours + minutes" duration input backed by a single total-minutes value.
// Used for the per-service-type "זמן לפגישה" fields (ליווי section / admin table).
export default function HourMinuteInput({ idPrefix, label, minutes, onChange, inputClassName, disabled = false }) {
  const hours = minutes == null ? "" : Math.floor(minutes / 60);
  const mins = minutes == null ? "" : minutes % 60;

  function emit(nextHours, nextMins) {
    const h = nextHours === "" ? null : Number(nextHours);
    const m = nextMins === "" ? null : Number(nextMins);
    if (h == null && m == null) {
      onChange(null);
    } else {
      onChange((h || 0) * 60 + (m || 0));
    }
  }

  const cls = inputClassName || "w-16 text-sm text-center border rounded-md px-1 py-0.5 bg-transparent border-slate-300 focus:outline-none focus:ring-1 focus:border-blue-400 focus:ring-blue-100";

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={`${idPrefix}-hours`} className="sr-only">{label} - שעות</label>
      <input id={`${idPrefix}-hours`} type="number" min="0" inputMode="numeric" disabled={disabled}
        value={hours} onChange={e => emit(e.target.value, mins)} className={cls} />
      <span className="text-xs text-slate-400">שעות</span>
      <label htmlFor={`${idPrefix}-minutes`} className="sr-only">{label} - דקות</label>
      <input id={`${idPrefix}-minutes`} type="number" min="0" max="59" inputMode="numeric" disabled={disabled}
        value={mins} onChange={e => emit(hours, e.target.value)} className={cls} />
      <span className="text-xs text-slate-400">דקות</span>
    </div>
  );
}
