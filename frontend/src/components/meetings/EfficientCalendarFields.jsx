import { useState } from "react";
import EfficientCalendarGuideWindow from "./EfficientCalendarGuideWindow";

// "יומן יעיל" — the two required questions of a booking-link meeting request (task wizard's
// ConditionGroupsEditor + DirectCoordinationModal). They feed backend/slot_policy.py: which
// times the school's link may offer, so short meetings never leave an advisor's day full of
// gaps too short for anything else. Values mirror slot_policy.MIN_FREE_WINDOW_OPTIONS /
// START_GRID_OPTIONS; null = not answered yet (the callers block "next" until both are set).
export const MIN_FREE_WINDOW_OPTIONS = [
  { value: 0, label: "ללא הגבלה (השעה הפנויה המוקדמת ביותר)" },
  { value: 30, label: "30 דק'" },
  { value: 60, label: "שעה" },
  { value: 90, label: "שעה וחצי" },
  { value: 120, label: "שעתיים" },
  { value: 180, label: "3 שעות" },
];
const START_GRID_OPTIONS = [
  { value: 30, label: "כל חצי שעה" },
  { value: 60, label: "רק בשעה עגולה" },
];

export function isEfficientCalendarComplete(minFreeWindow, startGrid) {
  return minFreeWindow !== null && minFreeWindow !== undefined && startGrid !== null && startGrid !== undefined;
}

export default function EfficientCalendarFields({ idPrefix, minFreeWindow, startGrid, onMinFreeWindowChange, onStartGridChange, showErrors }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const windowMissing = showErrors && (minFreeWindow === null || minFreeWindow === undefined);
  const gridMissing = showErrors && (startGrid === null || startGrid === undefined);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <label htmlFor={`${idPrefix}-min-window`} className="text-xs font-medium text-black">
            יומן יעיל: מה הרווח הקצר ביותר שמותר להשאיר בין פגישות ביומן היועץ? <span className="text-red-600">(שדה חובה)</span>
          </label>
          <button type="button" onClick={() => setHelpOpen(true)} aria-label='הסבר מלא על "יומן יעיל"'
            className="w-5 h-5 shrink-0 rounded-full border border-slate-400 text-[11px] font-bold text-slate-600 hover:bg-slate-100">
            ?
          </button>
        </div>
        <select id={`${idPrefix}-min-window`} aria-describedby={`${idPrefix}-min-window-hint`}
          value={minFreeWindow === null || minFreeWindow === undefined ? "" : String(minFreeWindow)}
          onChange={e => onMinFreeWindowChange(e.target.value === "" ? null : Number(e.target.value))}
          className={`text-sm border rounded-lg px-2.5 py-1.5 w-80 max-w-full bg-white ${windowMissing ? "border-red-400" : "border-black"}`}>
          <option value="" disabled>בחר</option>
          {MIN_FREE_WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p id={`${idPrefix}-min-window-hint`} className="text-[11px] text-slate-500">
          לבתי הספר יוצעו רק שעות שצמודות לפגישה אחרת, או שמשאירות לפניהן ואחריהן לפחות את הזמן הזה — כך תמיד יישאר מקום לפגישה באורך שבחרתם.
        </p>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-medium text-black">
          שעת התחלה של הפגישה <span className="text-red-600">(שדה חובה)</span>
        </legend>
        <div className={`flex gap-2 ${gridMissing ? "border border-red-400 rounded-lg p-1.5 -m-1.5" : ""}`}>
          {START_GRID_OPTIONS.map(opt => (
            <button key={opt.value} type="button"
              aria-pressed={startGrid === opt.value}
              onClick={() => onStartGridChange(opt.value)}
              className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                startGrid === opt.value
                  ? "bg-blue-600 border-blue-600 text-white font-semibold"
                  : "border-black text-black hover:bg-slate-50"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">בשני המצבים מותר גם מועד שצמוד בדיוק לפגישה קיימת.</p>
      </fieldset>
      {helpOpen && <EfficientCalendarGuideWindow onClose={() => setHelpOpen(false)} />}
    </>
  );
}
