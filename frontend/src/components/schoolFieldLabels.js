// Hebrew labels + value formatting for school-card fields. Shared by NotificationsPage (update
// request diffs) and SchoolActivityModal ("תיעוד פעולות"). Covers every field SchoolPage.jsx's
// `editForm` can send as a proposed change, the "פרטי ליווי" year fields, the typed advisor
// lists (virtual `advisors_<type>` fields of the activity log) and the profile self-service
// fields. A field missing here falls back to showing its raw code name — keep in sync.
import { SLOT_LABELS } from "./meetings/meetingCoordinatorSlots";
import { GEFEN_FILES_SLOT_LABELS } from "./meetings/gefenFilesResponsibleSlots";

export const FIELD_LABEL = {
  name: "שם מוסד", symbol: "סמל מוסד", city: "עיר", authority: "בעלות",
  stage: "שלב מוסד", finance_software: "תוכנת כספים", finance_software_other_text: "תוכנת כספים - פירוט",
  address: "כתובת", district: "מחוז", notes: "הערות", school_phone: "טלפון בית הספר",
  education_authority: "רשות חינוך", sector: "מגזר", supervision: "פיקוח",
  grade_levels: "שכבות לימוד", study_days: "ימי לימוד", student_count: "מס' תלמידים",
  restrict_access_to: "הרשאת גישה",
  // principal
  principal_name: "שם מנהל/ת", principal_phone: "טלפון מנהל/ת", principal_email: "מייל מנהל/ת",
  principal_day_off: "יום חופשי (מנהל/ת)", principal_same_person: "אותו מנהל/ת לשתי החטיבות",
  principal_chativa_name: "שם מנהל/ת חט\"ב", principal_chativa_phone: "טלפון מנהל/ת חט\"ב",
  principal_chativa_email: "מייל מנהל/ת חט\"ב", principal_chativa_day_off: "יום חופשי (מנהל/ת חט\"ב)",
  // secretary
  secretary_name: "שם מנהלנ/ית", secretary_phone: "טלפון מנהלנ/ית", secretary_email: "מייל מנהלנ/ית",
  secretary_day_off: "יום חופשי (מנהלנ/ית)", secretary_same_person: "אות/ה מנהלנ/ית לשתי החטיבות",
  secretary_chativa_name: "שם מנהלנ/ית חט\"ב", secretary_chativa_phone: "טלפון מנהלנ/ית חט\"ב",
  secretary_chativa_email: "מייל מנהלנ/ית חט\"ב", secretary_chativa_day_off: "יום חופשי (מנהלנ/ית חט\"ב)",
  // finance contact
  finance_contact_name: "שם אחראי/ת כספים", finance_contact_phone: "טלפון אחראי/ת כספים",
  finance_contact_email: "מייל אחראי/ת כספים", finance_contact_day_off: "יום חופשי (אחראי/ת כספים)",
  finance_same_person: "אות/ה אחראי/ת כספים לשתי החטיבות",
  finance_contact_chativa_name: "שם אחראי/ת כספים חט\"ב", finance_contact_chativa_phone: "טלפון אחראי/ת כספים חט\"ב",
  finance_contact_chativa_email: "מייל אחראי/ת כספים חט\"ב", finance_contact_chativa_day_off: "יום חופשי (אחראי/ת כספים חט\"ב)",
  // extra contacts / meeting coordination
  extra_contacts: "אנשי קשר נוספים", meeting_coordinator: "מתאם פגישות",
  meeting_coordinators: "מתאמי פגישות", gefen_files_responsible: "אחראי/ת קבצי גפן",
  // "פרטי ליווי" (school_year_admin_data)
  client_status: "סטטוס לקוח", service_type: "סוג שירות", order_amount_gefen: "מחיר כולל מע\"מ",
  order_method: "אופן מימון", order_method_other_text: "אופן מימון - פירוט",
  meeting_allocation_gefen: "הקצאת פגישות (גפן)", meeting_allocation_current: "הקצאת פגישות (שוטף)",
  meeting_allocation_district: "הקצאת פגישות (מחוז)",
  meeting_duration_gefen: "זמן לפגישה (גפן)", meeting_duration_current: "זמן לפגישה (שוטף)",
  meeting_duration_district: "זמן לפגישה (מחוז)",
  // typed advisor lists (activity log only)
  advisors_gefen: "יועץ מלווה (גפן)", advisors_current: "יועץ מלווה (שוטף)", advisors_district: "יועץ מלווה (מחוז)",
  // profile self-service fields
  work_phone: "טלפון עבודה", control_domains: "תחומי ידע",
};

export const VALUE_LABEL = {
  // stage
  yesodi: "יסודי", beinayim: "חטיבת ביניים", tikkon: "תיכון",
  sheshshnati: "שש-שנתי", other: "אחר",
  // finance_software / control_domains
  kesafim2000: "כספים 2000", payscool: "פייסקול", schoolcash: "סקולקאש",
  gefen: "גפן",
};

const WEEKDAY_LABEL = { sun: "א", mon: "ב", tue: "ג", wed: "ד", thu: "ה", fri: "ו", sat: "ש" };

const COORD_ROLE_LABEL = {
  principal: "מנהל/ת", principal_chativa: "מנהל/ת חט\"ב",
  secretary: "מנהלנ/ית", secretary_chativa: "מנהלנ/ית חט\"ב",
  finance_contact: "אחראי/ת כספים", finance_contact_chativa: "אחראי/ת כספים חט\"ב",
};

const CLIENT_STATUS_LABEL = { active: "פעיל", inactive: "לא פעיל", in_progress: "בתהליך", former: "לקוח עבר" };
const SERVICE_TYPE_LABEL = { gefen: "גפן", current: "שוטף", gefen_current: "גפן+שוטף", district: "מחוז", takuma: "תקומה" };
const FUNDING_METHOD_LABEL = { private: "פרטי", authority: "רשות", district: "מחוז", other: "אחר" };

function coordRoleLabel(ref) {
  if (!ref) return "—";
  if (typeof ref === "string" && ref.startsWith("extra:")) {
    return `איש קשר נוסף ${Number(ref.split(":")[1]) + 1}`;
  }
  return COORD_ROLE_LABEL[ref] || String(ref);
}

function formatWeekdays(val) {
  if (!Array.isArray(val) || val.length === 0) return "—";
  return val.map(v => WEEKDAY_LABEL[v] ?? String(v)).join(", ");
}

function formatBool(val) {
  if (val === null || val === undefined || val === "") return "—";
  return val ? "כן" : "לא";
}

function formatSlotMap(val, slotLabels) {
  if (!val || typeof val !== "object" || Object.keys(val).length === 0) return "—";
  return Object.entries(val)
    .filter(([, ref]) => ref)
    .map(([slot, ref]) => `${slotLabels[slot] || slot}: ${coordRoleLabel(ref)}`)
    .join("; ") || "—";
}

function formatEnum(map) {
  return (val) => (val === null || val === undefined || val === "" ? "—" : map[val] ?? String(val));
}

function formatAmount(val) {
  if (val === null || val === undefined || val === "") return "—";
  const n = Number(val);
  return Number.isFinite(n) ? `₪${n.toLocaleString("he-IL")}` : String(val);
}

function formatMinutes(val) {
  if (val === null || val === undefined || val === "") return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

// Per-field custom formatters for values that aren't plain scalars/enums.
const FIELD_FORMATTERS = {
  principal_day_off: formatWeekdays, secretary_day_off: formatWeekdays, finance_contact_day_off: formatWeekdays,
  principal_chativa_day_off: formatWeekdays, secretary_chativa_day_off: formatWeekdays, finance_contact_chativa_day_off: formatWeekdays,
  study_days: formatWeekdays,
  grade_levels: (val) => (Array.isArray(val) && val.length ? val.join(", ") : "—"),
  principal_same_person: formatBool, secretary_same_person: formatBool, finance_same_person: formatBool,
  restrict_access_to: (val) => (val == null ? "כולם" : `${val.length} יועצים נבחרו`),
  extra_contacts: (val) => {
    if (!Array.isArray(val) || val.length === 0) return "—";
    return val.map(ec => `${ec?.role || "איש קשר נוסף"}: ${ec?.name || "—"}`).join("; ");
  },
  meeting_coordinator: coordRoleLabel,
  meeting_coordinators: (val) => formatSlotMap(val, SLOT_LABELS),
  gefen_files_responsible: (val) => formatSlotMap(val, GEFEN_FILES_SLOT_LABELS),
  client_status: formatEnum(CLIENT_STATUS_LABEL),
  service_type: formatEnum(SERVICE_TYPE_LABEL),
  order_method: (val) => (Array.isArray(val) && val.length ? val.map(v => FUNDING_METHOD_LABEL[v] ?? v).join(", ") : "—"),
  order_amount_gefen: formatAmount,
  meeting_duration_gefen: formatMinutes, meeting_duration_current: formatMinutes, meeting_duration_district: formatMinutes,
};

// Fields whose value is a list of profile ids — shown as names when a profiles map is given.
const USER_LIST_FIELDS = new Set(["restrict_access_to", "advisors_gefen", "advisors_current", "advisors_district"]);

/** Formats a field value for display. `ctx.profiles` ({id: {full_name}}) turns user-id lists
 *  (access / advisors) into names; without it the legacy count-style text is kept. */
export function formatFieldValue(val, field, ctx) {
  if (ctx?.profiles && USER_LIST_FIELDS.has(field)) {
    if (field === "restrict_access_to" && val == null) return "כולם";
    if (!Array.isArray(val) || val.length === 0) return "—";
    return val.map(id => ctx.profiles[id]?.full_name || ctx.profiles[id]?.email || "משתמש לא ידוע").join(", ");
  }
  if (field && FIELD_FORMATTERS[field]) return FIELD_FORMATTERS[field](val);
  if (Array.isArray(val)) {
    return val.length ? val.map(v => VALUE_LABEL[v] ?? String(v)).join(", ") : "—";
  }
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "object") return "—";
  if (typeof val === "boolean") return formatBool(val);
  return VALUE_LABEL[val] ?? String(val);
}

export function fieldLabel(field) {
  return FIELD_LABEL[field] || field;
}
