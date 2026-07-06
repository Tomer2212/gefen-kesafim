import { useEffect, useRef, useState } from "react";
import { HEBREW_MONTHS } from "./constants";

export function DatePickerPopover({ value, onChange, onClose }) {
  const today = new Date();
  const initDate = value ? new Date(value) : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const blanks = (firstDay === 0 ? 6 : firstDay - 1);
  const cells = [...Array(blanks).fill(null), ...Array(daysInMonth).fill(0).map((_, i) => i + 1)];

  function select(day) {
    const d = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(d);
    onClose();
  }

  const selected = value ? new Date(value) : null;

  return (
    <div ref={ref} className="absolute z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3" style={{ top: "calc(100% + 4px)", right: 0, minWidth: 260 }} dir="rtl">
      <div className="flex items-center justify-between mb-2 gap-1">
        <button type="button" onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 text-xs font-bold">→</button>
        <span className="text-sm font-semibold text-slate-700">{HEBREW_MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 text-xs font-bold">←</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-slate-400 mb-1">
        {["ב","ג","ד","ה","ו","ש","א"].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />;
          const isSelected = selected && selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
          const isToday = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
          return (
            <button key={day} type="button" onClick={() => select(day)}
              className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors mx-auto
                ${isSelected ? "bg-blue-600 text-white" : isToday ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100 text-slate-700"}`}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
