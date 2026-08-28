// שעון נוכחות — קבועים ועוזרי חישוב משותפים לאזור האישי ולניהול.
export { HEBREW_MONTHS } from "../meetings/constants";

export const DAY_TYPES = [
  { value: "work_home", label: "עבודה מהבית" },
  { value: "field", label: "שטח" },
  { value: "vacation", label: "חופש" },
  { value: "sick", label: "ימי מחלה" },
  { value: "reserve", label: "מילואים" },
  { value: "other", label: "אחר-הערות" },
];

export const DAY_TYPE_LABEL = Object.fromEntries(DAY_TYPES.map((d) => [d.value, d.label]));

export const WEEKDAY_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// 'YYYY-MM' של החודש הנוכחי (זמן מקומי — המשתמשים בישראל).
export function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyLabel(monthKey, hebrewMonths) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${hebrewMonths[m - 1]} ${y}`;
}

// כל ימי החודש הקלנדרי: [{ date:'YYYY-MM-DD', dow:0-6, weekday, isWeekend }]
export function buildMonthDays(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const out = [];
  for (let day = 1; day <= last; day++) {
    const d = new Date(y, m - 1, day);
    const dow = d.getDay(); // 0=ראשון ... 6=שבת
    out.push({
      date: `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      dow,
      weekday: WEEKDAY_HE[dow],
      isWeekend: dow === 5 || dow === 6, // שישי/שבת
    });
  }
  return out;
}

function hhmmToMin(v) {
  if (!v || typeof v !== "string") return null;
  const parts = v.split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// תומך משמרת שחוצה חצות: אם הסיום <= ההתחלה, מוסיפים 24 שעות.
export function computeWorkMinutes(start, end) {
  const a = hhmmToMin(start);
  const b = hhmmToMin(end);
  if (a === null || b === null) return null;
  let diff = b - a;
  if (diff <= 0) diff += 1440;
  return diff;
}

// דקות → "HH:MM" (שעות יכולות לעבור 24 בסיכומים).
export function formatMinutes(min) {
  if (min === null || min === undefined || Number.isNaN(min)) return "";
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const WORK_TYPES = new Set(["work_home", "field"]);

// מקביל ל-_summary ב-backend (attendance_router.py).
export function monthSummary(entries) {
  let totalWorkMinutes = 0;
  let workDays = 0;
  let sickDays = 0;
  let reserveDays = 0;
  let vacationDays = 0;
  for (const e of entries || []) {
    const dt = e.day_type;
    if (dt === "sick") sickDays++;
    else if (dt === "reserve") reserveDays++;
    else if (dt === "vacation") vacationDays++;
    if (WORK_TYPES.has(dt) && e.start_time && e.end_time) {
      const wm = e.work_minutes ?? computeWorkMinutes(e.start_time, e.end_time) ?? 0;
      totalWorkMinutes += wm;
      workDays++;
    }
  }
  return {
    totalWorkMinutes,
    workDays,
    sickDays,
    reserveDays,
    vacationDays,
    avgMinutesPerDay: workDays ? Math.round(totalWorkMinutes / workDays) : 0,
  };
}
