export const MEETING_STATUS_OPTIONS = [
  { value: "scheduled",  label: "נקבעה",   color: "#c2410c", bg: "#fff7ed", dot: "#f97316" },
  { value: "completed",  label: "בוצעה",   color: "#15803d", bg: "#f0fdf4", dot: "#22c55e" },
  { value: "cancelled",  label: "בוטלה",   color: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" },
  { value: "postponed",  label: "נדחתה",   color: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" },
  { value: "other",      label: "אחר",     color: "#475569", bg: "#f8fafc", dot: "#94a3b8" },
];
export const STATUS_MAP = Object.fromEntries(MEETING_STATUS_OPTIONS.map(s => [s.value, s]));

export const MEETING_TYPE_OPTIONS = [
  { value: "physical", label: "פיזי" },
  { value: "remote",   label: "מרחוק" },
];

// Same value set as school-level service_type (school_year_admin_data.service_type) — kept
// identical so a school's default can be copied onto a new meeting without mapping.
export const MEETING_SERVICE_TYPE_OPTIONS = [
  { value: "gefen",         label: "גפן" },
  { value: "current",       label: "שוטף" },
  { value: "gefen_current", label: "גפן+שוטף" },
  { value: "district",      label: "מחוז" },
];

// Default for a new meeting's "סוג" field: copy the school's own service_type as-is. All four
// values now map cleanly to a default advisor (see resolveDefaultAdvisorIds below), so there's
// no more ambiguous case to leave blank.
export function defaultMeetingServiceType(schoolServiceType) {
  return schoolServiceType || null;
}

// Given a meeting's service type and the school's three per-service-type advisor lists
// (arrays of profile objects, as returned by GET /schools/{id}/advisors/{service_type}),
// returns the deduplicated union of advisor IDs that should default into "יועץ מבצע".
// gefen_current merges both the gefen and current lists (same advisor in both counted once).
export function resolveDefaultAdvisorIds(serviceType, { gefenAdvisors = [], currentAdvisors = [], districtAdvisors = [] }) {
  let list;
  if (serviceType === "gefen") list = gefenAdvisors;
  else if (serviceType === "current") list = currentAdvisors;
  else if (serviceType === "district") list = districtAdvisors;
  else if (serviceType === "gefen_current") list = [...gefenAdvisors, ...currentAdvisors];
  else list = [];
  return [...new Set(list.map(a => a.id))];
}

export const STATUS_SORT_ORDER = { completed: 0, scheduled: 1, postponed: 2, other: 3 };

// Ordered service-type buckets for the "פגישות שבוצעו" breakdown — the detail rows above the
// meetings-table summary footer, and the matching optional columns on DashboardPage / AdminPage.
// "none" = meeting_service_type is empty/null (a meeting whose "סוג" was never set).
export const MEETING_SERVICE_TYPE_BREAKDOWN = [
  { key: "gefen",         label: "גפן" },
  { key: "current",       label: "שוטף" },
  { key: "gefen_current", label: "גפן+שוטף" },
  { key: "district",      label: "מחוז" },
  { key: "none",          label: "ללא סוג" },
];

// Column-picker ordering for the per-service-type "פגישות/שעות שבוצעו" breakdown columns on
// DashboardPage / AdminPage. Same buckets as MEETING_SERVICE_TYPE_BREAKDOWN, but מחוז comes
// before גפן+שוטף (product request). MEETING_SERVICE_TYPE_BREAKDOWN itself is left untouched
// since it drives the meetings-table summary footer order.
export const MEETING_SERVICE_TYPE_BREAKDOWN_COL_ORDER = [
  { key: "gefen",         label: "גפן" },
  { key: "current",       label: "שוטף" },
  { key: "district",      label: "מחוז" },
  { key: "gefen_current", label: "גפן+שוטף" },
  { key: "none",          label: "ללא סוג" },
];

// minutes → "H:MM שעות" / "H שעות" / "M דק'" (same wording as the summary footer's total).
export function formatMeetingMinutes(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} דק'`;
  if (m === 0) return `${h} שעות`;
  return `${h}:${String(m).padStart(2, "0")} שעות`;
}

export const HEBREW_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export function formatMeetingDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
