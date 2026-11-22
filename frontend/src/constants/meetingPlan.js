// תוכנית פגישות — how many meetings a school needs in each month of the year, per service type.
// Mirrors backend/meeting_plan.py (stored as school_year_admin_data.meeting_plan =
// {gefen: {"09": 1, ...}, current: {...}, district: {...}, physical: {gefen: ["12"]}}) — keep the
// two in sync. `physical` = months in which one of that type's meetings must be in person —
// information for the rounds (pre-marks in-person schools for the manager), never booked from.

export const PLAN_TYPES = ["gefen", "current", "district"];
export const PLAN_TYPE_LABELS = { gefen: "גפן", current: "שוטף", district: "מחוז" };
// Academic-year order: September first.
export const ACADEMIC_MONTHS = ["09", "10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08"];
export const MONTH_SHORT = {
  "09": "ספט׳", "10": "אוק׳", "11": "נוב׳", "12": "דצמ׳", "01": "ינו׳", "02": "פבר׳",
  "03": "מרץ", "04": "אפר׳", "05": "מאי", "06": "יוני", "07": "יולי", "08": "אוג׳",
};
export const MAX_PER_MONTH = 9;

// `total` meetings spread evenly over the year from September: 12 → every month, 6 → every
// second month, 4 → the first month of every quarter (same as meeting_plan.spread).
export function spreadPlan(total) {
  const n = Math.round(Number(total) || 0);
  const out = {};
  for (let i = 0; i < Math.max(0, n); i++) {
    const m = ACADEMIC_MONTHS[Math.floor((i * 12) / n)];
    out[m] = Math.min((out[m] || 0) + 1, MAX_PER_MONTH);
  }
  return out;
}

// Months with no meeting dropped, empty types dropped, physical marks kept only on months that
// have a meeting, {} → null (same as normalize_plan).
export function normalizePlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  const out = {};
  for (const t of PLAN_TYPES) {
    const months = {};
    for (const m of ACADEMIC_MONTHS) {
      const n = Math.min(Math.max(0, Math.round(Number(plan[t]?.[m]) || 0)), MAX_PER_MONTH);
      if (n) months[m] = n;
    }
    if (Object.keys(months).length) out[t] = months;
  }
  const physical = {};
  for (const t of PLAN_TYPES) {
    const marked = plan.physical?.[t] || [];
    const keep = ACADEMIC_MONTHS.filter(m => marked.includes(m) && out[t]?.[m]);
    if (keep.length) physical[t] = keep;
  }
  if (Object.keys(physical).length) out.physical = physical;
  return Object.keys(out).length ? out : null;
}

export function physicalMonths(plan, type) {
  return plan?.physical?.[type] || [];
}

export function typeTotal(plan, type) {
  return Object.values(plan?.[type] || {}).reduce((a, b) => a + b, 0);
}

function sameMonths(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}

// The named rhythm a type's months follow, if any.
export const RHYTHMS = [
  { total: 12, label: "כל חודש" },
  { total: 6, label: "כל חודשיים" },
  { total: 4, label: "כל רבעון" },
];
export function rhythmLabel(months) {
  const r = RHYTHMS.find(x => sameMonths(months || {}, spreadPlan(x.total)));
  return r ? r.label : null;
}

// One line for a cell/tile: "כל רבעון · 4" or "ספט׳, דצמ׳ (2)·…". "" when the type has no plan.
export function planTypeSummary(plan, type) {
  const months = plan?.[type];
  const total = typeTotal(plan, type);
  if (!total) return "";
  const physical = physicalMonths(plan, type);
  const physicalText = physical.length ? ` · פיזית: ${physical.map(m => MONTH_SHORT[m]).join(", ")}` : "";
  const rhythm = rhythmLabel(months);
  if (rhythm) return `${rhythm} · ${total} בשנה${physicalText}`;
  const list = ACADEMIC_MONTHS.filter(m => months[m]).map(m => months[m] > 1 ? `${MONTH_SHORT[m]} ×${months[m]}` : MONTH_SHORT[m]);
  return `${total} בשנה · ${list.join(", ")}${physicalText}`;
}

// All types in one line (tables): "גפן: כל רבעון · 4 בשנה | שוטף: …".
export function planSummary(plan) {
  return PLAN_TYPES.filter(t => typeTotal(plan, t)).map(t => `${PLAN_TYPE_LABELS[t]}: ${planTypeSummary(plan, t)}`).join(" | ");
}

// The allocation vs. the plan of a type — null when there's nothing to compare.
export function allocationGap(plan, type, allocation) {
  if (allocation == null || allocation === "") return null;
  const total = typeTotal(plan, type);
  if (!total) return null;
  return total - Math.round(Number(allocation) || 0);
}
