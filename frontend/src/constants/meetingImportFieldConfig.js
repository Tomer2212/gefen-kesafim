// Column-mapping field config for the "ייבוא פגישות" (import meetings) flow in
// AdminMeetingsTab.jsx, consumed by the shared ImportMappingModal (components/ImportMappingModal.jsx).
// Mirrors the shape of IMPORT_FIELD_CONFIG / USER_IMPORT_FIELD_CONFIG in AdminPage.jsx:
// { key, label, required, hint }. Fields whose relevance depends on the chosen mode (past/future)
// are filtered out of the config passed to ImportMappingModal by ImportMeetingsModal.jsx itself
// (advisor_name_or_email is future-only, advisor_name_text/reminder_enabled interplay is
// past-vs-future, etc.) — this file just declares the full superset.

export const MEETING_IMPORT_FIELD_CONFIG = [
  { key: "meeting_date",          label: "תאריך פגישה",              required: true, hint: "DD/MM/YYYY או YYYY-MM-DD" },
  { key: "school_name",           label: "שם מוסד",                   required: true },
  { key: "school_symbol",         label: "סמל מוסד",                  required: true, hint: "מזהה בית הספר במערכת" },
  { key: "start_time",            label: "שעת התחלה",                 required: true, hint: "HH:MM" },
  { key: "end_time",              label: "שעת סיום",                  required: true, hint: "HH:MM" },
  { key: "stage_scope",           label: "היקף פגישה (שש-שנתי)",      required: false, hint: "תיכון / חטיבת ביניים / שתיהן" },
  { key: "advisor_name_or_email", label: "יועץ מבצע",                 required: true, hint: "שם מלא או מייל של יועץ קיים במערכת" },
  { key: "advisor_name_text",     label: "יועץ מבצע",                 required: true, hint: "יישמר כטקסט חופשי, ללא שיוך למשתמש קיים" },
  { key: "meeting_type",          label: "מיקום פגישה",               required: false, hint: "פיזי / מרחוק" },
  { key: "meeting_service_type",  label: "סוג פגישה",                 required: true, hint: "גפן / שוטף / גפן+שוטף / מחוז — נושא הפגישה הספציפי, לא סוג השירות הקבוע של בית הספר" },
  { key: "participant_name",      label: "שם איש קשר משתתף",          required: false, hint: "איש הקשר מטעם בית הספר שהשתתף/ישתתף בפגישה" },
  { key: "participant_phone",     label: "טלפון איש קשר משתתף",       required: false },
  { key: "participant_email",     label: "מייל איש קשר משתתף",        required: false, hint: "בפגישות עתידיות ישמש גם כנמען להזמנת Outlook" },
  { key: "notes",                 label: "הערות",                     required: false },
  { key: "status",                label: "סטטוס",                     required: true, hint: "נקבעה / בוצעה / בוטלה / נדחתה / אחר" },
];

export function normalizeImportStageScope(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (t === "tichon" || t === "chativa" || t === "both") return t;
  if (t.includes("שתי")) return "both";
  if (t.includes("תיכון") || t.includes("עליונה")) return "tichon";
  if (t.includes("ביניים") || t.includes("חטיבה")) return "chativa";
  return null;
}

export function normalizeImportMeetingType(raw) {
  const t = String(raw || "").trim();
  if (t === "physical" || t === "remote") return t;
  if (t.includes("פיזי")) return "physical";
  if (t.includes("מרחוק")) return "remote";
  return null;
}

export function normalizeImportServiceType(raw) {
  const t = String(raw || "").trim();
  if (["gefen", "current", "gefen_current", "district"].includes(t)) return t;
  if (t.includes("גפן") && t.includes("שוטף")) return "gefen_current";
  if (t.includes("גפן")) return "gefen";
  if (t.includes("שוטף")) return "current";
  if (t.includes("מחוז")) return "district";
  return null;
}

export function normalizeImportStatus(raw) {
  const t = String(raw || "").trim();
  if (["scheduled", "completed", "cancelled", "postponed", "other"].includes(t)) return t;
  if (t === "נקבעה") return "scheduled";
  if (t === "בוצעה") return "completed";
  if (t === "בוטלה") return "cancelled";
  if (t === "נדחתה") return "postponed";
  if (t === "אחר") return "other";
  return null;
}

// Best-effort date normalization to YYYY-MM-DD before sending to the backend — the backend
// also tolerates DD/MM/YYYY etc, but normalizing client-side lets the UI show a clean preview.
export function normalizeImportDate(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return t; // leave as-is; backend has its own tolerant parser
}
