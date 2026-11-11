// "סבבי פגישות" — shared labels (backend/meeting_rounds.py STATUSES, in funnel order).
import { MEETING_SERVICE_TYPE_LABELS } from "../tasks/taskShared";

export const ROUND_STATUS_META = {
  done: { label: "התקיימה", chip: "bg-emerald-100 text-emerald-800", bar: "bg-emerald-600" },
  booked: { label: "נקבעה", chip: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-400" },
  partial: { label: "נקבעה חלקית", chip: "bg-lime-50 text-lime-800", bar: "bg-lime-400" },
  opened: { label: "פתח/ה את הלינק ולא קבע/ה", chip: "bg-amber-50 text-amber-800", bar: "bg-amber-400" },
  requested: { label: "קיבל/ה בקשה, טרם פתח/ה", chip: "bg-sky-50 text-sky-800", bar: "bg-sky-400" },
  problem: { label: "בעיה", chip: "bg-red-50 text-red-700", bar: "bg-red-400" },
  untouched: { label: "טרם טופל", chip: "bg-slate-100 text-slate-700", bar: "bg-slate-300" },
  excluded: { label: "הוחרג מהסבב", chip: "bg-slate-50 text-slate-400", bar: "bg-slate-200" },
};
export const ROUND_STATUS_ORDER = ["done", "booked", "partial", "opened", "requested", "problem", "untouched"];

export const ROUND_PROBLEM_LABELS = {
  missing_service_type: "לא הוגדר סוג שירות בכרטיס",
  send_failed: "השליחה נכשלה",
  missing_contact: "חסר איש קשר",
  incomplete_meeting_config: "חסר יועץ או משך פגישה בכרטיס",
  opted_out: "הוסר/ה מרשימת התפוצה",
};

// "Opened/received but did nothing" for this many days → suggested reminder.
export const STALE_REQUEST_DAYS = 7;

// The dashboard's "which meetings" breakdown — one group per kind of meeting a school is asked
// for. gefen_current splits by whether its גפן and שוטף advisors are the same people.
export const MEETING_KIND_ORDER = ["gefen", "current", "gefen_current_same", "gefen_current_diff", "district", "takuma", "missing"];

export function meetingKindOf(school, requirement) {
  const type = requirement?.meeting_service_type === "by_service" ? school.card_service_type : requirement?.meeting_service_type;
  if (!type || !MEETING_SERVICE_TYPE_LABELS[type]) return "missing";
  if (type === "gefen_current") return school.gefen_current_same ? "gefen_current_same" : "gefen_current_diff";
  return type;
}

export function meetingKindLabel(kind, requirement) {
  switch (kind) {
    case "gefen": return "פגישת גפן";
    case "current": return "פגישת שוטף";
    case "gefen_current_same": return "פגישת גפן+שוטף (אותו יועץ)";
    case "gefen_current_diff":
      return requirement?.meeting_service_type === "by_service" && requirement?.gefen_current_split === "separate"
        ? "גפן+שוטף עם יועצים שונים — פגישות נפרדות"
        : "גפן+שוטף עם יועצים שונים — פגישה אחת עם שניהם";
    case "district": return "פגישת מחוז";
    case "takuma": return "פגישת תקומה";
    default: return "בלי סוג שירות בכרטיס";
  }
}

export function requirementLabel(req) {
  if (!req) return "";
  const type = req.meeting_service_type === "by_service"
    ? `לפי סוג השירות בכרטיס${req.gefen_current_split === "separate" ? " (גפן+שוטף עם יועצים שונים: נפרדות)" : req.gefen_current_split === "combined" ? " (גפן+שוטף עם יועצים שונים: פגישה אחת)" : ""}`
    : `פגישת ${MEETING_SERVICE_TYPE_LABELS[req.meeting_service_type] || req.meeting_service_type}`;
  const count = (req.count_per_school || 1) > 1 ? ` · ${req.count_per_school} פגישות לכל בית ספר` : "";
  return `${type}${count}`;
}

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
