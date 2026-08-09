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

export const HEBREW_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

export function formatMeetingDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
