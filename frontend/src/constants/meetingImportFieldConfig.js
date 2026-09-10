// Column-mapping field config for the "ייבוא פגישות" (import meetings) flow in
// AdminMeetingsTab.jsx, consumed by the shared ImportMappingModal (components/ImportMappingModal.jsx).
// Mirrors the shape of IMPORT_FIELD_CONFIG / USER_IMPORT_FIELD_CONFIG in AdminPage.jsx:
// { key, label, required, hint }. Fields whose relevance depends on the chosen mode (past/future)
// are filtered out of the config passed to ImportMappingModal by ImportMeetingsModal.jsx itself
// (advisor_name_or_email is future-only, advisor_name_text/reminder_enabled interplay is
// past-vs-future, etc.) — this file just declares the full superset.

// Row count per chunked HTTP request for the validate/commit calls (ImportMeetingsModal.jsx /
// MeetingImportProblemsModal.jsx). Large files (2000+ rows) take longer server-side than the
// axios timeout allows when sent as one giant request — splitting into sequential chunks keeps
// each request well under the timeout while giving visible progress.
export const MEETING_IMPORT_CHUNK_SIZE = 200;

export const MEETING_IMPORT_FIELD_CONFIG = [
  { key: "meeting_date",          label: "תאריך פגישה",              required: true, hint: "DD/MM/YYYY או YYYY-MM-DD" },
  { key: "school_name",           label: "שם מוסד",                   required: true },
  { key: "school_symbol",         label: "סמל מוסד",                  required: true, hint: "מזהה בית הספר במערכת" },
  { key: "start_time",            label: "שעת התחלה",                 required: true, hint: "HH:MM או HH:MM AM/PM" },
  { key: "end_time",              label: "שעת סיום",                  required: true, hint: "HH:MM או HH:MM AM/PM" },
  { key: "planned_duration_hours", label: "זמן פגישה מתוכנן (שעות)",  required: false, hint: "מספר שעות, למשל 0.25 לרבע שעה — שעת הסיום תחושב אוטומטית משעת ההתחלה" },
  { key: "actual_duration_hours", label: "זמן פגישה בפועל (שעות)",   required: false, hint: "אותו עיקרון כמו 'מתוכנן' — כמות השעות שבאמת ארכה הפגישה" },
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

// Hebrew final-form letters -> regular form, so substring matching isn't defeated by
// "התקיים" (final-mem) not being a prefix of "התקיימה" (regular-mem). Mirror of
// backend/meeting_labels.py _definalize — keep the two synonym sets in sync.
const _FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
function definalize(s) {
  return String(s).replace(/[ךםןףץ]/g, c => _FINALS[c]);
}
function matchSynonyms(raw, table) {
  if (raw == null) return null;
  const t = definalize(String(raw).trim().toLowerCase());
  if (!t) return null;
  for (const [keys, canonical] of table) {
    for (const key of keys) {
      if (t.includes(definalize(key.toLowerCase()))) return canonical;
    }
  }
  return null;
}

const _STATUS_SYNONYMS = [
  [["אחר", "other"], "other"],
  [["בוטל", "מבוטל", "ביטול", "cancel"], "cancelled"],
  [["נדח", "דחיי", "דחייה", "postpon"], "postponed"],
  [["בוצע", "התקיי", "הושלמ", "נערכ", "קוימ", "complete", "done"], "completed"],
  [["נקבע", "מתוכנ", "מתוזמ", "עתידי", "טרמ", "schedul", "planned"], "scheduled"],
];
const _TYPE_SYNONYMS = [
  [["מרחוק", "טלפו", "זומ", "zoom", "וידאו", "video", "online", "אונלי", "remote"], "remote"],
  [["פיזי", "שטח", "פרונטל", "פנימ אל פנימ", "פנימ", "בבית הספר", "physical", "in person", "onsite"], "physical"],
];
const _SERVICE_TYPE_SYNONYMS = [
  [["מחוז", "district"], "district"],
  [["גפנ", 'גפ"נ', "גפ״נ", "מכתב בקרה", "gefen"], "gefen"],
  [["שוטפ", "סגירת שנה", "current"], "current"],
];

export function normalizeImportMeetingType(raw) {
  const t = String(raw || "").trim();
  if (t === "physical" || t === "remote") return t;
  return matchSynonyms(raw, _TYPE_SYNONYMS);
}

export function normalizeImportServiceType(raw) {
  const t = String(raw || "").trim();
  if (["gefen", "current", "gefen_current", "district"].includes(t)) return t;
  const d = definalize(t.toLowerCase());
  const hasGefen = d.includes("גפנ") || d.includes('גפ"נ') || d.includes("gefen");
  const hasCurrent = d.includes("שוטפ") || d.includes("current");
  if (hasGefen && hasCurrent) return "gefen_current";
  return matchSynonyms(raw, _SERVICE_TYPE_SYNONYMS);
}

export function normalizeImportStatus(raw) {
  const t = String(raw || "").trim();
  if (["scheduled", "completed", "cancelled", "postponed", "other"].includes(t)) return t;
  return matchSynonyms(raw, _STATUS_SYNONYMS);
}

// Best-effort date normalization to YYYY-MM-DD before sending to the backend — purely
// cosmetic (lets the UI show a clean preview); the backend's _parse_import_date is the real
// authority and independently handles the same format variants (plus raw Excel serials),
// so a value this function can't normalize is still sent through as-is and re-parsed there.
export function normalizeImportDate(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m) {
    const [, d, mo, yRaw] = m;
    // Mirrors Python strptime's %y pivot: 2-digit years 00-68 -> 20xx, 69-99 -> 19xx.
    const y = yRaw.length === 4 ? yRaw : String(Number(yRaw) <= 68 ? 2000 + Number(yRaw) : 1900 + Number(yRaw));
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return t; // leave as-is; backend has its own tolerant parser (including Excel serials)
}
