import { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import DirectStyleDateInput from "./DirectStyleDateInput";

// Extracted from TaskCreateWizard.jsx (was a local, non-exported function) so it can be reused
// as-is by PersonTaskCreateWizard.jsx — same "תזמון" mechanism, same wording, same behavior.

// Every hour-of-day from 08:00 to 19:00 (a task is being scheduled during working hours, not
// overnight), labeled as a rounded range ("08:00–09:00") rather than an exact minute —
// activation always lands on the range's start hour regardless, since the periodic background
// check that activates scheduled tasks never fires at an exact minute anyway. Picking an exact
// minute here would just be misleading precision.
// ⁦/⁩ (LRI/PDI) isolate the LTR range from the surrounding RTL text so the browser's bidi
// algorithm can't visually swap the start/end hours (same fix as taskShared.js's meetingDateRange).
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const h = i + 8;
  const start = String(h).padStart(2, "0");
  const end = String(h + 1).padStart(2, "0");
  return { value: `${start}:00`, label: `⁦${start}:00–${end}:00⁩` };
});

function parseScheduledFor(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}$/.exec(value || "");
  return m ? { date: m[1], hour: `${m[2]}:00` } : { date: "", hour: "" };
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Single-select dropdown for the rounded-hour range, mirroring the same "button + absolute
// popover list" pattern already used elsewhere (e.g. ConditionGroupsEditor.jsx's
// TypeaheadValueInput) — no calendar-grid-style picker makes sense here since it's just 24
// fixed options, not an open-ended value.
function HourRangePicker({ date, value, onChange }) {
  const [open, setOpen] = useState(false);
  const isToday = date === todayIso();
  const nowHour = new Date().getHours();
  const options = HOUR_OPTIONS.filter(o => !isToday || parseInt(o.value, 10) > nowHour);
  const selected = options.find(o => o.value === value);
  return (
    <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="w-full text-sm border border-black rounded-lg pl-7 pr-2.5 py-1.5 text-right bg-white relative">
        {selected ? selected.label : "בחר טווח שעה"}
        <span aria-hidden="true" className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400">🕐</span>
      </button>
      {open && (
        <div role="listbox" className="absolute z-30 right-0 left-0 mt-1 border border-black rounded-lg bg-white shadow-lg max-h-56 overflow-y-auto">
          {options.map(o => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
              className="w-full text-right px-3 py-1.5 text-sm hover:bg-blue-50">
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// This modal is only ever mounted while open (callers render it as `{showScheduleModal && <.../>}`),
// so a plain useState initializer already gives us "draft starts from the real value every time
// the modal opens" for free — no separate open/close-triggered reset effect needed. Nothing here
// reaches the caller's actual `value`/`onChange` until "אישור" is clicked; "ביטול" just closes,
// discarding the draft.
export default function ScheduleCriteriaModal({ value, onChange, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [draft, setDraft] = useState(() => parseScheduledFor(value));

  function commit() {
    onChange(draft.date && draft.hour ? `${draft.date}T${draft.hour}` : "");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="schedule-criteria-title" onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl w-full max-w-md mx-4 p-6 space-y-3">
        <h3 id="schedule-criteria-title" className="font-bold text-slate-900 text-center">תזמון משימה</h3>
        <p className="text-xs text-black">הגדירו זמן עתידי לביצוע הסינון ותחילת המשימה.</p>
        <p className="text-xs text-black">הסבר: המערכת תתזמן את סינון בתי הספר לזמן שיוגדר ולאחר מכן המשימה תעבור למצב פעיל.</p>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <label htmlFor="task-scheduled-for-date" className="block text-xs font-semibold text-black mb-1">תאריך</label>
            <DirectStyleDateInput
              id="task-scheduled-for-date"
              value={draft.date}
              onChange={date => setDraft(d => ({ date, hour: date === d.date ? d.hour : "" }))}
            />
          </div>
          <div className="flex-1">
            <span className="block text-xs font-semibold text-black mb-1">טווח שעה</span>
            <HourRangePicker date={draft.date} value={draft.hour} onChange={hour => setDraft(d => ({ ...d, hour }))} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 pt-1">
          {(draft.date || draft.hour) && (
            <button type="button" onClick={() => setDraft({ date: "", hour: "" })} className="text-xs text-slate-500 hover:underline px-2 py-1.5">
              נקה תזמון
            </button>
          )}
          <div className="flex justify-center gap-2">
            <button type="button" onClick={commit} className="btn-blue text-sm px-4 py-1.5">אישור</button>
            <button type="button" onClick={onClose} className="text-sm px-4 py-1.5 border border-black rounded-full hover:bg-slate-50">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}
