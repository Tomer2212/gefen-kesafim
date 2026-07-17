import { useEffect, useRef, useState } from "react";
import { DayScheduleBlocks } from "./DayScheduleBlocks";
import { HEBREW_MONTHS } from "./constants";
import { classifyDay, computeSegments, fetchMonthBusyByDay } from "./dayScheduleUtils";

const DOT_COLOR = { green: "bg-green-500", orange: "bg-amber-500", red: "bg-red-500" };

export function DatePickerPopover({ value, onChange, onClose, advisorId }) {
  const today = new Date();
  const initDate = value ? new Date(value) : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  // Map of day-of-month -> [{ startHM, endHM, subject }] busy time ranges for that day.
  const [busyByDay, setBusyByDay] = useState({});
  const [hoverDay, setHoverDay] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Free/Busy overlay — shows which days (and exact time ranges) the advisor already
  // has Outlook events on, so scheduling doesn't require leaving the app to check.
  useEffect(() => {
    let cancelled = false;
    fetchMonthBusyByDay(advisorId, viewYear, viewMonth).then(byDay => { if (!cancelled) setBusyByDay(byDay); });
    return () => { cancelled = true; };
  }, [advisorId, viewYear, viewMonth]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sunday..6=Saturday
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const blanks = firstDay; // week starts on Sunday, so blanks = day-of-week of the 1st
  const cells = [...Array(blanks).fill(null), ...Array(daysInMonth).fill(0).map((_, i) => i + 1)];

  function select(day) {
    const d = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(d);
    onClose();
  }

  const selected = value ? new Date(value) : null;

  return (
    <div ref={ref} className="absolute z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3" style={{ top: "calc(100% + 4px)", right: 0, width: 390 }} dir="rtl">
      <div className="flex items-center justify-between mb-2 gap-1">
        <button type="button" onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 text-xs font-bold">→</button>
        <span className="text-sm font-semibold text-slate-700">{HEBREW_MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 text-xs font-bold">←</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-slate-400 mb-1">
        {["א","ב","ג","ד","ה","ו","ש"].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />;
          const isSelected = selected && selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
          const isToday = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
          const dow = new Date(viewYear, viewMonth, day).getDay(); // 0=Sun..6=Sat
          const isWorkday = advisorId && dow >= 0 && dow <= 4; // Sunday–Thursday
          const dotStatus = isWorkday ? classifyDay(busyByDay[day]) : null;
          return (
            <button key={day} type="button" onClick={() => select(day)}
              onMouseEnter={() => setHoverDay(day)}
              onMouseLeave={() => setHoverDay(h => h === day ? null : h)}
              title={dotStatus ? "פרטי הזמינות של היועץ למטה" : undefined}
              className={`relative w-7 h-7 rounded-lg text-xs font-medium transition-colors mx-auto
                ${isSelected ? "bg-blue-600 text-white" : isToday ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100 text-slate-700"}`}>
              {day}
              {dotStatus && (
                <span aria-hidden="true" className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : DOT_COLOR[dotStatus]}`} />
              )}
            </button>
          );
        })}
      </div>
      {advisorId && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100 text-[9px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" /> פנוי</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" /> חלקית</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden="true" /> עמוס</span>
        </div>
      )}
      {advisorId && (() => {
        const displayDay = hoverDay ?? (selected && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear ? selected.getDate() : null);
        const segments = displayDay ? computeSegments(busyByDay[displayDay]) : null;
        return (
          <div className="mt-2 pt-2 border-t border-slate-100 text-[11px]" style={{ minHeight: 60 }}>
            {!displayDay ? (
              <div className="text-slate-400 flex items-center justify-center text-center px-4 py-4">
                רחף/י מעל יום כדי לראות את לוח הזמנים המלא (08:00–19:00)
              </div>
            ) : (
              <>
                <span className="text-black block mb-1">לוח זמנים ב-{displayDay}/{viewMonth + 1}:</span>
                <DayScheduleBlocks segments={segments} />
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
