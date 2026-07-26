import { Fragment, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import Sidebar from "../components/Sidebar";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { supabase } from "../lib/supabase";
import AdminCallsTab from "./AdminCallsTab";
import AdminIntegrationsTab from "./AdminIntegrationsTab";
import AdminMeetingsTab from "./AdminMeetingsTab";
import AgentChatWidget from "../components/AgentChatWidget";
import UserMeetingsConflictModal from "./UserMeetingsConflictModal";
import UserSchoolsConflictModal from "./UserSchoolsConflictModal";
import MeetingNavigationGuardModal from "../components/meetings/MeetingNavigationGuardModal";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import { AdvisorSearch } from "../components/AdvisorSearch";
import { AccessSelector } from "../components/AccessSelector";
import TaskListBar from "../components/tasks/TaskListBar";

// --- Admin schools table (ניהול → בתי ספר) ------------------------------------------------

const ADMIN_SCHOOL_STAGE_LABEL = {
  yesodi:      "יסודי",
  beinayim:    "חטיבת ביניים",
  tikkon:      "תיכון",
  sheshshnati: "שש שנתי",
  other:       "אחר",
};

// "Identity" columns mirror the equivalent columns on DashboardPage (same key/label), minus
// "advisor" (not relevant to the admin/financial view) — "שם מוסד" is always the frozen first
// column and isn't part of this movable list.
const ADMIN_IDENTITY_COLUMNS = [
  { key: "symbol",             label: "סמל מוסד" },
  { key: "city",                label: "עיר" },
  { key: "authority",           label: "בעלות" },
  { key: "stage",                label: "שלב מוסד" },
  { key: "meetings_completed",  label: 'סה"כ פגישות שבוצעו' },
  { key: "meetings_hours",      label: 'סה"כ שעות שבוצעו' },
];

const SERVICE_TYPE_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "current", label: "שוטף" },
  { value: "gefen_current", label: "גפן+שוטף" },
];

// "אמצעי הזמנה" — multi-select from a closed list (same field shown in ליווי on SchoolPage,
// backed by school_year_admin_data.order_method as a text[] column).
const FUNDING_METHOD_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "tnufa", label: "תנופה" },
  { value: "tkuma", label: "תקומה" },
  { value: "dokati", label: "דוקאטי" },
  { value: "palg", label: 'פל"ג' },
  { value: "self_managed", label: "ניהול עצמי" },
];

const DOMAIN_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "kesafim2000", label: "כספים2000" },
  { value: "payscool", label: "פייסקול" },
  { value: "schoolcash", label: "סקולקאש" },
];

// New admin/financial columns, per-school-year (stored in school_year_admin_data).
const ADMIN_DATA_COLUMNS = [
  { key: "service_type",          label: "סוג שירות" },
  { key: "requested_price",       label: "מחיר מבוקש" },
  { key: "order_method",          label: "אמצעי הזמנה" },
  { key: "order_amount_gefen",    label: "גובה הזמנה" },
  { key: "hours_ordered",         label: "מספר שעות שהוזמנו" },
  { key: "rate",                  label: "תעריף" },
  { key: "payment_received",      label: "תשלום שהתקבל" },
  { key: "payment_requests_sent", label: "דרישות תשלום שנשלחו" },
  { key: "contract_sent",         label: "חוזה נשלח" },
  { key: "contract_received",     label: "חוזה התקבל" },
  { key: "contract_file",         label: "קובץ חוזה" },
  { key: "receipts_sent",         label: "אסמכתאות שנשלחו" },
];

const ADMIN_ALL_COLUMNS = [...ADMIN_IDENTITY_COLUMNS, ...ADMIN_DATA_COLUMNS];
const ADMIN_DEFAULT_COL_ORDER = ADMIN_ALL_COLUMNS.map(c => c.key);
const ADMIN_DEFAULT_COL_VISIBLE = Object.fromEntries(ADMIN_ALL_COLUMNS.map(c => [c.key, true]));
function isKnownAdminColumnKey(k) { return ADMIN_DEFAULT_COL_ORDER.includes(k); }

// Column-filter type map for the admin schools table (ניהול → בתי ספר). "select" columns use
// raw underlying values (not display labels) so the agent/tool layer can target them directly.
const ADMIN_TEXT_FILTER_COLS = new Set(["symbol", "city", "authority", "contract_file"]);
const ADMIN_NUMBER_FILTER_COLS = new Set([
  "meetings_completed", "meetings_hours", "requested_price", "order_amount_gefen",
  "hours_ordered", "rate", "payment_received", "payment_requests_sent", "receipts_sent",
]);
const ADMIN_SELECT_FILTER_OPTIONS = {
  stage: Object.entries(ADMIN_SCHOOL_STAGE_LABEL).map(([value, label]) => ({ value, label })),
  service_type: SERVICE_TYPE_OPTIONS,
  order_method: FUNDING_METHOD_OPTIONS,
  contract_sent: [{ value: "yes", label: "כן" }, { value: "no", label: "לא" }],
  contract_received: [{ value: "yes", label: "כן" }, { value: "no", label: "לא" }],
};
function getAdminColumnFilterType(key) {
  if (ADMIN_TEXT_FILTER_COLS.has(key)) return "text";
  if (ADMIN_NUMBER_FILTER_COLS.has(key)) return "number";
  if (ADMIN_SELECT_FILTER_OPTIONS[key]) return "select";
  return null;
}
// Raw (non-display) value used for "select" column filtering — distinct from getAdminSortValue,
// which returns display labels / sort-order numbers for those same columns.
function getAdminRawFilterValue(school, yad, key) {
  switch (key) {
    case "stage": return school.stage || null;
    case "service_type": return yad.service_type || null;
    case "order_method": return yad.order_method || [];
    case "contract_sent": case "contract_received":
      return yad[key] === true ? "yes" : yad[key] === false ? "no" : null;
    default: return null;
  }
}
function passesAdminColumnFilters(school, yad, filters, getSortValue) {
  for (const [key, spec] of Object.entries(filters)) {
    if (!spec) continue;
    const type = getAdminColumnFilterType(key);
    if (type === "text") {
      if (!spec.value) continue;
      const cellValue = String(getSortValue(school, key) || "");
      const needle = spec.value.trim();
      if (!needle) continue;
      const matches = spec.op === "equals" ? cellValue === needle : cellValue.includes(needle);
      if (!matches) return false;
    } else if (type === "number") {
      if (spec.value === "" || spec.value === null || spec.value === undefined) continue;
      const cellValue = Number(getSortValue(school, key));
      const target = Number(spec.value);
      if (Number.isNaN(cellValue) || Number.isNaN(target)) return false;
      const ok = spec.op === "eq" ? cellValue === target
        : spec.op === "ne" ? cellValue !== target
        : spec.op === "gt" ? cellValue > target
        : spec.op === "gte" ? cellValue >= target
        : spec.op === "lt" ? cellValue < target
        : spec.op === "lte" ? cellValue <= target
        : true;
      if (!ok) return false;
    } else if (type === "select") {
      if (!spec.values || spec.values.length === 0) continue;
      const raw = getAdminRawFilterValue(school, yad, key);
      const rawArr = Array.isArray(raw) ? raw : [raw];
      if (!rawArr.some(v => spec.values.includes(v))) return false;
    }
  }
  return true;
}

function formatAdminMeetingHours(totalMinutes) {
  if (!totalMinutes) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} דק'`;
  if (m === 0) return `${h} שעות`;
  return `${h}:${String(m).padStart(2, "0")} שעות`;
}

function formatUpdatedAt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("he-IL");
  } catch {
    return "";
  }
}

// Thousands-separated (no decimal) display for amount fields like "גובה הזמנה" — "" for empty.
function formatAmount(v) {
  return v === null || v === undefined || v === "" ? "" : Math.round(Number(v)).toLocaleString("he-IL");
}

// Strips thousands separators back to a plain number (or null if empty) for saving.
function parseAmount(raw) {
  const stripped = String(raw).replace(/,/g, "").trim();
  return stripped === "" ? null : Number(stripped);
}

// Plain/flat field style for the admin table's editable cells (service_type, order_amount_gefen,
// numeric fields, contract_sent/contract_received) — mirrors SchoolPage's editFieldCls (the thin
// border-slate-300 look used in "פרטי מוסד"), instead of the heavier rounded/bordered .input-field
// box, so these columns read like decisive plain values rather than boxy form fields.
const ADMIN_FIELD_CLS = "text-sm text-slate-700 border rounded-md px-2 py-0.5 bg-transparent border-slate-300 focus:outline-none focus:ring-1 focus:border-blue-400 focus:ring-blue-100";

const DIVISION_OPTIONS = [
  { value: "tikkon", label: "חטיבה עליונה" },
  { value: "beinayim", label: "חטיבת ביניים" },
  { value: "yesodi", label: "יסודי" },
  { value: "other", label: "אחר" },
];

const SCHOOL_STAGE_OPTIONS = [
  { value: "",            label: "בחר שלב מוסד",  divisionType: null },
  { value: "yesodi",      label: "יסודי",          divisionType: "yesodi" },
  { value: "beinayim",    label: "חטיבת ביניים",   divisionType: "beinayim" },
  { value: "tikkon",      label: "תיכון",           divisionType: "tikkon" },
  { value: "sheshshnati", label: "שש שנתי",         divisionType: null },
  { value: "other",       label: "אחר",             divisionType: null },
];

const DEFAULT_CUSTOM_DIVISIONS = [
  { id: 1, division_type: "tikkon" },
  { id: 2, division_type: "beinayim" },
];

function validateSecretaryPhone(phone) {
  if (!phone) return "";
  if (phone.length !== 10 || !phone.startsWith("05")) return "10 ספרות, חייב להתחיל ב-05";
  return "";
}

function validateSchoolPhone(phone) {
  if (!phone) return "";
  if (!/^\d{9,10}$/.test(phone)) return "9 או 10 ספרות בלבד";
  return "";
}

const FINANCE_SOFTWARE_OPTIONS = [
  { value: "", label: "בחר" },
  { value: "kesafim2000", label: "כספים 2000" },
  { value: "payscool", label: "פייסקול" },
  { value: "schoolcash", label: "סקולקאש" },
];

const CONTACT_ROWS = [
  { label: "מנהל/ת",        nameField: "principal_name",       phoneField: "principal_phone",       emailField: "principal_email",       dayOffField: "principal_day_off",       coordValue: "principal" },
  { label: "מנהלנ/ית",      nameField: "secretary_name",       phoneField: "secretary_phone",       emailField: "secretary_email",       dayOffField: "secretary_day_off",       coordValue: "secretary" },
  { label: "אחראי/ת כספים", nameField: "finance_contact_name", phoneField: "finance_contact_phone", emailField: "finance_contact_email", dayOffField: "finance_contact_day_off", coordValue: "finance_contact" },
];

const WEEKDAY_OPTIONS = [
  { value: "sun", label: "א" },
  { value: "mon", label: "ב" },
  { value: "tue", label: "ג" },
  { value: "wed", label: "ד" },
  { value: "thu", label: "ה" },
  { value: "fri", label: "ו" },
];
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

const HEBREW_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function DeleteConfirmModal({ title, subtitle, message, error, onConfirm, onCancel, confirming }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
      >
        <div>
          <h2 id="delete-modal-title" className="font-bold text-slate-900 text-lg">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
        {error && <p role="alert" className="text-sm text-red-600 font-medium">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="text-sm px-5 py-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#dc2626" }}
          >
            {confirming ? "מוחק..." : "מחק בכל זאת"}
          </button>
          <button onClick={onCancel} disabled={confirming} className="btn-ghost text-sm px-5 py-2">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleChangeConfirmModal({ userName, oldRole, newRole, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const labels = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-confirm-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-5"
      >
        <h2 id="role-confirm-title" className="font-bold text-slate-900 text-lg">שינוי תפקיד</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          האם אתה בטוח שאתה רוצה לשנות את התפקיד של{" "}
          <span className="font-semibold text-slate-800">{userName}</span>{" "}
          מ<span className="font-semibold text-slate-800">'{labels[oldRole] || oldRole}'</span>{" "}
          ל<span className="font-semibold text-slate-800">'{labels[newRole] || newRole}'</span>?
        </p>
        <div className="flex gap-3">
          <button onClick={onConfirm} className="btn-blue text-sm px-6 py-2">כן</button>
          <button onClick={onCancel} className="btn-ghost text-sm px-6 py-2">לא</button>
        </div>
      </div>
    </div>
  );
}

function validateSymbol(val) {
  if (!val) return "סמל מוסד הוא שדה חובה";
  if (val.length < 5 || val.length > 6) return "נדרש 5 או 6 ספרות";
  return "";
}

const EMPTY_FORM = { name: "", symbol: "", city: "", authority: "", stage: "", finance_software: "", principal_name: "", principal_phone: "", principal_email: "", secretary_name: "", secretary_phone: "", secretary_email: "", finance_contact_name: "", finance_contact_phone: "", finance_contact_email: "", school_phone: "", address: "", district: "", restrict_access_to: [], extra_contacts: [], principal_day_off: [], secretary_day_off: [], finance_contact_day_off: [], meeting_coordinator: null };

const IMPORT_FIELD_CONFIG = [
  { key: "name",                  label: "שם בית ספר",          required: true },
  { key: "symbol",                label: "סמל מוסד",             required: true },
  { key: "city",                  label: "עיר",                  required: false },
  { key: "authority",             label: "בעלות",                required: false },
  { key: "stage",                 label: "שלב מוסד",             required: false, hint: "יסודי / חטיבת ביניים / תיכון / שש שנתי / אחר" },
  { key: "finance_software",      label: "תוכנת כספים",          required: false, hint: "כספים 2000 / פייסקול / סקולקאש" },
  { key: "address",               label: "כתובת",                required: false },
  { key: "district",              label: "מחוז",                 required: false, hint: "צפון / דרום / מרכז / ירושלים / תל-אביב / חיפה / חינוך התיישבותי / חרדי" },
  { key: "school_phone",          label: "טלפון בית הספר",       required: false },
  { key: "principal_name",        label: "שם מנהל/ת",            required: false },
  { key: "principal_phone",       label: "טלפון מנהל/ת",         required: false },
  { key: "secretary_name",        label: "שם מנהלנ/ית",          required: false },
  { key: "secretary_phone",       label: "טלפון מנהלנ/ית",       required: false },
  { key: "finance_contact_name",  label: "שם אחראי/ת כספים",     required: false },
  { key: "finance_contact_phone", label: "טלפון אחראי/ת כספים",  required: false },
  { key: "principal_email",       label: "מייל מנהל/ת",           required: false },
  { key: "secretary_email",       label: "מייל מנהלנ/ית",         required: false },
  { key: "finance_contact_email", label: "מייל אחראי/ת כספים",    required: false },
];

const USER_IMPORT_FIELD_CONFIG = [
  { key: "email",     label: "אימייל",  required: true },
  { key: "full_name", label: "שם מלא",  required: true },
  { key: "role",      label: "תפקיד",   required: false, hint: "יועץ / מנהל / בעלים — ברירת מחדל: יועץ" },
];

function normalizeStage(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const l = t.toLowerCase();
  if (l.includes("יסוד") || l === "yesodi") return "yesodi";
  if (l.includes("ביניים") || l === "beinayim") return "beinayim";
  if (l.includes("תיכון") || l === "tikkon") return "tikkon";
  if (l.includes("שש") || l === "sheshshnati") return "sheshshnati";
  return "other";
}

function normalizeDistrict(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (t.includes("צפון")) return "צפון";
  if (t.includes("דרום")) return "דרום";
  if (t.includes("מרכז")) return "מרכז";
  if (t.includes("ירושלים")) return "ירושלים";
  if (t.includes("תל") || t.includes("ת\"א") || t.includes("תא")) return "תל-אביב";
  if (t.includes("חיפה")) return "חיפה";
  return "";
}

function normalizeFinanceSoftware(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const l = t.toLowerCase();
  if (l.includes("כספים") || l.includes("kesafim")) return "kesafim2000";
  if (l.includes("פייסקול") || l.includes("payscool")) return "payscool";
  if (l.includes("סקולקאש") || l.includes("schoolcash")) return "schoolcash";
  return "";
}

function normalizeRole(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t.includes("בעלים") || t === "owner") return "owner";
  if (t.includes("מנהל") || t === "manager") return "manager";
  return "advisor";
}

function FieldMappingRow({ label, hint, required, headers, previewRow, value, error, onChange }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-44 flex-shrink-0 text-right pt-2">
        <span className="text-sm text-slate-700">{label}</span>
        {required && <span className="text-red-500 mr-1 text-xs">*</span>}
        {hint && <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{hint}</p>}
      </div>
      <div className="flex-1">
        <select
          className={`input-field text-sm ${error ? "border-red-400" : ""}`}
          value={value === null ? "" : String(value)}
          onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">{required ? "— בחר עמודה —" : "— לא ממפה —"}</option>
          {headers.map((h, i) => {
            const preview = previewRow[i] ? String(previewRow[i]).slice(0, 35) : "";
            return (
              <option key={i} value={String(i)}>
                {h || `עמודה ${i + 1}`}{preview ? `  (${preview})` : ""}
              </option>
            );
          })}
        </select>
        {error && <span className="text-xs text-red-500 block mt-0.5" role="alert">נדרש מיפוי</span>}
      </div>
    </div>
  );
}

function ImportMappingModal({ headers, previewRow, totalRows, fieldConfig, confirmLabel, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [mapping, setMapping] = useState(() => Object.fromEntries(fieldConfig.map(f => [f.key, null])));
  const [tried, setTried] = useState(false);

  function handleConfirm() {
    setTried(true);
    if (fieldConfig.some(f => f.required && mapping[f.key] === null)) return;
    onConfirm(mapping);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl w-full flex flex-col"
        style={{ maxWidth: 640, maxHeight: "88vh" }}
      >
        <div className="px-6 pt-5 pb-3 border-b border-slate-100 flex-shrink-0">
          <h2 id="import-modal-title" className="font-bold text-slate-900 text-lg">מיפוי עמודות לייבוא</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            נמצאו <strong>{totalRows}</strong> שורות · התאם כל שדה לעמודה המתאימה בקובץ
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">שדות חובה</p>
          <div className="flex flex-col gap-3 mb-6">
            {fieldConfig.filter(f => f.required).map(f => (
              <FieldMappingRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                required
                headers={headers}
                previewRow={previewRow}
                value={mapping[f.key]}
                error={tried && mapping[f.key] === null}
                onChange={v => setMapping(p => ({ ...p, [f.key]: v }))}
              />
            ))}
          </div>
          <div className="h-px bg-slate-100 mb-5" />
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">שדות אופציונליים</p>
          <div className="flex flex-col gap-3">
            {fieldConfig.filter(f => !f.required).map(f => (
              <FieldMappingRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                headers={headers}
                previewRow={previewRow}
                value={mapping[f.key]}
                onChange={v => setMapping(p => ({ ...p, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3 flex-shrink-0">
          <button onClick={handleConfirm} className="btn-blue text-sm px-5 py-2">
            {confirmLabel}
          </button>
          <button onClick={onCancel} className="btn-ghost text-sm px-5 py-2">ביטול</button>
        </div>
      </div>
    </div>
  );
}

function RecycleBinInfoModal({ schoolName, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="recycle-modal-title">
      <div ref={ref} onKeyDown={handleKeyDown} className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4 text-right" dir="rtl">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🗑️</span>
          <h2 id="recycle-modal-title" className="text-lg font-bold text-slate-900">הועבר לסל המחזור</h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">
          בית הספר <span className="font-semibold">{schoolName}</span> הועבר לסל המחזור ונתוניו יימחקו לחלוטין מהמערכת תוך 30 יום.
        </p>
        <p className="text-sm text-slate-700 leading-relaxed">
          אם תרצו לשחזר את בית הספר, ניתן לבצע זאת בפרק הזמן הזה בלבד דרך אזור <span className="font-medium">ניהול ← בתי ספר ← סל מחזור</span>.
        </p>
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-sm font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
            autoFocus
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}

function RestoreSuccessModal({ schoolName, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="restore-modal-title">
      <div ref={ref} onKeyDown={handleKeyDown} className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4 text-right" dir="rtl">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">✅</span>
          <h2 id="restore-modal-title" className="text-lg font-bold text-slate-900">בית הספר שוחזר בהצלחה</h2>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed">
          בית הספר <span className="font-semibold">{schoolName}</span> שוחזר בהצלחה ומופיע כעת ברשימת בתי הספר הפעילים.
        </p>
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-sm font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
            autoFocus
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}

function UnsavedChangesModal({ onSave, onDiscard, onCancel, saving }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-5"
      >
        <div>
          <h2 id="unsaved-changes-title" className="font-bold text-slate-900 text-lg">שינויים שלא נשמרו</h2>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            ביצעת שינויים שטרם נשמרו. האם לשמור לפני היציאה?
          </p>
        </div>
        <div className="flex flex-row gap-2">
          <button onClick={onSave} disabled={saving}
            className="flex-1 whitespace-nowrap text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors"
            style={{ background: "#16a34a" }}>
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
          <button onClick={onDiscard} disabled={saving}
            className="flex-1 whitespace-nowrap text-sm px-5 py-2.5 rounded-xl font-semibold text-white transition-colors"
            style={{ background: "#dc2626" }}>
            אל תשמור
          </button>
          <button onClick={onCancel} disabled={saving} className="flex-1 whitespace-nowrap btn-ghost text-sm px-5 py-2.5">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

const OVERRIDE_STATE_LABEL = {
  true:  "מורשה תמיד",
  false: "חסום תמיד",
  null:  "ברירת מחדל",
};

function UserPermissionsModal({ user, permDefaults, overrides, loading, saving, onSave, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const roleLabel = { manager: "מנהל", advisor: "יועץ" }[user.role] ?? user.role;

  // Local pending state — only sent to backend on "שמור שינויים"
  const [localOverrides, setLocalOverrides] = useState(() => ({ ...overrides }));
  const [isSavingAll, setIsSavingAll] = useState(false);
  const prevLoadingRef = useRef(loading);

  // Sync localOverrides once the initial load completes
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setLocalOverrides({ ...overrides });
    }
    prevLoadingRef.current = loading;
  }, [loading, overrides]);

  function hasPendingChanges() {
    const keys = new Set([...Object.keys(localOverrides), ...Object.keys(overrides)]);
    for (const k of keys) {
      if (localOverrides[k] !== overrides[k]) return true;
    }
    return false;
  }
  const dirty = hasPendingChanges();

  function setLocalPerm(perm, value) {
    setLocalOverrides(prev => {
      if (value === null) {
        const next = { ...prev };
        delete next[perm];
        return next;
      }
      return { ...prev, [perm]: value };
    });
  }

  function resetAll() {
    setLocalOverrides({});
  }

  async function handleSave() {
    setIsSavingAll(true);
    const keys = new Set([...Object.keys(localOverrides), ...Object.keys(overrides)]);
    const promises = [];
    for (const perm of keys) {
      const newVal = localOverrides[perm];
      const oldVal = overrides[perm];
      if (newVal !== oldVal) {
        promises.push(onSave(perm, newVal !== undefined ? newVal : null));
      }
    }
    await Promise.all(promises);
    setIsSavingAll(false);
    onClose();
  }

  const hasLocalOverrides = Object.keys(localOverrides).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="uperm-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="uperm-title" className="font-bold text-black">הרשאות אישיות — {user.full_name || user.email}</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div role="status" aria-label="טוען הרשאות" className="flex justify-center py-10">
              <div aria-hidden="true" className="spinner w-7 h-7" />
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-4">
                שורות המסומנות בכחול הוגדרו בהתאמה אישית ושונות מברירת המחדל של תפקיד {roleLabel}.
              </p>
              <div className="divide-y divide-slate-100">
                {Object.entries(permDefaults)
                  .filter(([perm]) => !(user.role === "advisor" && ADVISOR_NA_PERMS.has(perm)))
                  .map(([perm, data]) => {
                    const currentOverride = localOverrides[perm]; // true | false | undefined
                    const isCustom = currentOverride !== undefined;
                    const defaultVal = data[user.role];

                    const noClass = isCustom
                      ? (currentOverride === false ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50")
                      : (defaultVal === false ? "bg-red-50 text-red-300" : "bg-white text-slate-400 hover:bg-slate-50");

                    const yesClass = isCustom
                      ? (currentOverride === true ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50")
                      : (defaultVal === true ? "bg-green-50 text-green-400" : "bg-white text-slate-400 hover:bg-slate-50");

                    return (
                      <div key={perm} className={`py-3 flex items-center justify-between gap-4 rounded-lg px-2 -mx-2 transition-colors ${isCustom ? "bg-blue-100" : ""}`}>
                        <p className="text-sm font-medium text-black">{data.label}</p>
                        <div
                          role="group"
                          aria-label={data.label}
                          className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${isSavingAll ? "opacity-50 pointer-events-none" : ""}`}
                          style={{ direction: "ltr" }}
                        >
                          <button
                            onClick={() => setLocalPerm(perm, (currentOverride === false || defaultVal === false) ? null : false)}
                            aria-pressed={currentOverride === false}
                            className={`px-3 py-1.5 transition-colors focus:outline-none ${noClass}`}
                          >לא</button>
                          <button
                            onClick={() => setLocalPerm(perm, (currentOverride === true || defaultVal === true) ? null : true)}
                            aria-pressed={currentOverride === true}
                            className={`px-3 py-1.5 border-r border-slate-200 transition-colors focus:outline-none ${yesClass}`}
                          >כן</button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          {hasLocalOverrides ? (
            <button onClick={resetAll} className="text-sm text-slate-500 hover:text-red-600 transition-colors">
              איפוס הכל לברירת מחדל
            </button>
          ) : <span />}
          <div className="flex items-center gap-3">
            {dirty && (
              <button
                onClick={handleSave}
                disabled={isSavingAll}
                className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
              >
                {isSavingAll ? "שומר..." : "שמור שינויים"}
              </button>
            )}
            <button onClick={onClose} className="btn-ghost px-5 py-2 text-sm">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PERM_GROUPS = [
  {
    label: "בתי ספר",
    perms: ["can_add_school", "can_delete_schools", "can_edit_school_directly", "can_request_school_update", "can_approve_update_requests", "can_delete_own_meetings"],
    advisorNA: new Set(["can_approve_update_requests"]),
  },
  {
    label: "משתמשים",
    perms: ["can_invite_users", "can_delete_users", "can_change_user_role", "can_manage_user_permissions"],
    advisorNA: new Set(["can_invite_users", "can_delete_users", "can_change_user_role", "can_manage_user_permissions"]),
  },
  {
    label: "חיובים",
    perms: ["can_view_billing", "can_manage_billing"],
    advisorNA: new Set(["can_view_billing", "can_manage_billing"]),
    ownerOnly: true,
  },
];
const ADVISOR_NA_PERMS = new Set(PERM_GROUPS.flatMap(g => [...(g.advisorNA || [])]));

const ADMIN_NUMBER_FILTER_OPS = [
  { value: "eq", label: "שווה ל" },
  { value: "ne", label: "שונה מ" },
  { value: "gt", label: "גדול מ" },
  { value: "gte", label: "גדול או שווה ל" },
  { value: "lt", label: "קטן מ" },
  { value: "lte", label: "קטן או שווה ל" },
];

function AdminColumnFilterPopover({ colKey, colLabel, filterType, spec, onChange, onClear, onClose }) {
  if (filterType === "text") {
    const value = spec?.value || "";
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={`admin-filter-${colKey}`} className="text-xs text-slate-500">סינון: {colLabel}</label>
        <input id={`admin-filter-${colKey}`} type="text" autoComplete="off" className="input-field text-sm"
          value={value}
          onChange={e => onChange({ op: "contains", value: e.target.value })} />
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => { onClear(); onClose(); }} className="text-xs text-slate-400 hover:text-slate-600">נקה</button>
          <button type="button" onClick={onClose} className="btn-blue text-xs px-3 py-1">סגור</button>
        </div>
      </div>
    );
  }
  if (filterType === "number") {
    const op = spec?.op || "eq";
    const value = spec?.value ?? "";
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={`admin-filter-op-${colKey}`} className="text-xs text-slate-500">סינון: {colLabel}</label>
        <select id={`admin-filter-op-${colKey}`} className="input-field text-sm"
          value={op}
          onChange={e => onChange({ op: e.target.value, value })}>
          {ADMIN_NUMBER_FILTER_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label htmlFor={`admin-filter-val-${colKey}`} className="sr-only">ערך</label>
        <input id={`admin-filter-val-${colKey}`} type="number" className="input-field text-sm"
          value={value}
          onChange={e => onChange({ op, value: e.target.value })} />
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => { onClear(); onClose(); }} className="text-xs text-slate-400 hover:text-slate-600">נקה</button>
          <button type="button" onClick={onClose} className="btn-blue text-xs px-3 py-1">סגור</button>
        </div>
      </div>
    );
  }
  if (filterType === "select") {
    const options = ADMIN_SELECT_FILTER_OPTIONS[colKey] || [];
    const values = spec?.values || [];
    function toggleValue(v) {
      const next = values.includes(v) ? values.filter(x => x !== v) : [...values, v];
      onChange({ op: "in", values: next });
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">סינון: {colLabel}</p>
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {options.map(o => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded accent-blue-600"
                checked={values.includes(o.value)}
                onChange={() => toggleValue(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => { onClear(); onClose(); }} className="text-xs text-slate-400 hover:text-slate-600">נקה</button>
          <button type="button" onClick={onClose} className="btn-blue text-xs px-3 py-1">סגור</button>
        </div>
      </div>
    );
  }
  return null;
}

export default function AdminPage() {
  const location = useLocation();
  const navigate  = useNavigate();
  const [activeTab, setActiveTabState] = useState(() => new URLSearchParams(location.search).get("tab") || "schools");
  const setActiveTab = (id) => {
    setActiveTabState(id);
    navigate(`/admin?tab=${id}`, { replace: true });
  };
  const importRef = useRef(null);
  const userImportRef = useRef(null);
  const [myRole, setMyRole] = useState("");
  const [myUserId, setMyUserId] = useState(null);
  const [canDeleteSchool, setCanDeleteSchool] = useState(false);
  const [canInviteUsers, setCanInviteUsers] = useState(false);
  const [canDeleteUsers, setCanDeleteUsers] = useState(false);
  const [canManagePermissions, setCanManagePermissions] = useState(false);
  const [canDeleteMeetings, setCanDeleteMeetings] = useState(false);

  // Schools state
  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [schoolForm, setSchoolForm] = useState(EMPTY_FORM);
  const [schoolStage, setSchoolStage] = useState("");
  const [accessLinkedToAdvisors, setAccessLinkedToAdvisors] = useState(false);
  const [customDivisions, setCustomDivisions] = useState(DEFAULT_CUSTOM_DIVISIONS);
  const [editingSchool, setEditingSchool] = useState(null);
  const [showSchoolForm, setShowSchoolForm] = useState(false);
  const [savingSchool, setSavingSchool] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMappingData, setImportMappingData] = useState(null);
  const [importProgressMsg, setImportProgressMsg] = useState("");

  // Admin schools table state (ניהול → בתי ספר: מחירים/חוזים/תשלומים, per school year)
  const [adminAcademicYear, setAdminAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [yearAdminData, setYearAdminData] = useState({}); // school_id -> row
  const [loadingYearAdminData, setLoadingYearAdminData] = useState(false);
  const [adminColOrder, setAdminColOrder] = useState(ADMIN_DEFAULT_COL_ORDER);
  const [adminColVisible, setAdminColVisible] = useState(ADMIN_DEFAULT_COL_VISIBLE);
  const [showAdminColPicker, setShowAdminColPicker] = useState(false);
  const [adminSortKey, setAdminSortKey] = useState(null);
  const [adminSortDir, setAdminSortDir] = useState("asc");
  const [adminSearchQuery, setAdminSearchQuery] = useState("");
  const [adminColumnFilters, setAdminColumnFilters] = useState({}); // {[colKey]: FilterSpec}
  const [openAdminFilterKey, setOpenAdminFilterKey] = useState(null); // only one column's filter popover open at a time
  const [uploadingContractFor, setUploadingContractFor] = useState(null);
  const adminContractInputRef = useRef(null);
  const adminColPickerRef = useRef(null);
  const adminFilterPopoverRef = useRef(null);

  // Accounts state
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [schoolAccounts, setSchoolAccounts] = useState({});
  const [newDivision, setNewDivision] = useState("tikkon");
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({ finance_software: "", tmura_model: false });

  // Advisor selection for new school form (multi-select)
  const [selectedAdvisors, setSelectedAdvisors] = useState([]);

  // Advisors per school in expanded panel
  const [schoolAdvisors, setSchoolAdvisors] = useState({});

  // Draft advisor selection while editing an existing school — kept purely local until
  // saveSchool() diffs it against originalAdvisorIds and only sends the net add/remove
  // calls (and notifications) on save.
  const [draftAdvisorIds, setDraftAdvisorIds] = useState([]);
  const [originalAdvisorIds, setOriginalAdvisorIds] = useState([]);

  // Delete confirmation modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingSchool, setDeletingSchool] = useState(false);
  const [showSchoolFormDots, setShowSchoolFormDots] = useState(false);
  const [recycleInfoSchoolName, setRecycleInfoSchoolName] = useState(null);
  const [restoreSuccessSchoolName, setRestoreSuccessSchoolName] = useState(null);
  const schoolFormDotsRef = useRef(null);

  // Users state
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [overrideCounts, setOverrideCounts] = useState({});  // { [userId]: count }
  const [openActionsMenu, setOpenActionsMenu] = useState(null); // userId of open 3-dot menu
  const [roleError, setRoleError] = useState("");
  const [roleChangeConfirm, setRoleChangeConfirm] = useState(null); // { userId, userName, oldRole, newRole }
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", role: "advisor", control_domains: [] });
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [userImportMappingData, setUserImportMappingData] = useState(null);
  const [importingUsers, setImportingUsers] = useState(false);
  const [userImportResult, setUserImportResult] = useState(null);
  const [userImportProgressMsg, setUserImportProgressMsg] = useState("");
  const [resendingUserId, setResendingUserId] = useState(null);
  const [resendMsg, setResendMsg] = useState(null); // { id, ok }

  // User edit / delete
  const [editingUser, setEditingUser] = useState(null);
  const [editingUserName, setEditingUserName] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [userMeetingsConflict, setUserMeetingsConflict] = useState(null);
  const [userSchoolsConflict, setUserSchoolsConflict] = useState(null);
  const [confirmingUserDelete, setConfirmingUserDelete] = useState(false);
  const [userDeleteError, setUserDeleteError] = useState("");

  const schoolFormDirty = showSchoolForm && (
    editingSchool !== null ||
    !!(schoolForm.name || schoolForm.symbol || schoolStage || selectedAdvisors.length > 0)
  );
  const adminMeetingsRef = useRef(null);
  const [meetingsGuardActive, setMeetingsGuardActive] = useState(false);
  const [meetingGuardBusy, setMeetingGuardBusy] = useState(false);

  const isDirty = schoolFormDirty || editingUser !== null || !!(inviteForm.email || inviteForm.full_name) || meetingsGuardActive;
  const blocker = useBlocker(isDirty);
  const blockSaving = savingSchool || savingUser || inviting;

  async function handleSaveAndProceed() {
    if (showSchoolForm) {
      const saved = await saveSchool();
      if (saved) blocker.proceed?.();
      else blocker.reset?.();
      return;
    }
    if (editingUser !== null) {
      await saveEditUser();
      blocker.proceed?.();
      return;
    }
    if (inviteForm.email && inviteForm.full_name) {
      await inviteUser();
    }
    setInviteForm({ email: "", full_name: "", role: "advisor", control_domains: [] });
    blocker.proceed?.();
  }

  function handleDiscardAndProceed() {
    setShowSchoolForm(false);
    setEditingSchool(null);
    setSchoolForm(EMPTY_FORM);
    setSelectedAdvisors([]);
    setDraftAdvisorIds([]);
    setSchoolStage("");
    setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    setEditingUser(null);
    setEditingUserName("");
    setInviteForm({ email: "", full_name: "", role: "advisor", control_domains: [] });
    setInviteMsg("");
    blocker.proceed?.();
  }

  // Permissions state
  const [permDefaults, setPermDefaults] = useState(null);   // { [key]: { label, manager, advisor } }
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState({});          // { [roleKey]: true }
  const [permError, setPermError] = useState("");
  // Per-user overrides panel
  const [overrideUser, setOverrideUser] = useState(null);    // user object
  const [overrides, setOverrides] = useState({});            // { [perm]: true|false }
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState({});  // { [perm]: true }

  // Billing tab
  const [billingMonthTab, setBillingMonthTab] = useState(null);
  const [billingData] = useState({});                        // { "YYYY-MM": { ... } } — populated when billing DB is connected

  async function loadPermDefaults() {
    setPermLoading(true);
    setPermError("");
    try {
      const res = await axios.get("/schools/permissions/defaults");
      setPermDefaults(res.data);
    } catch {
      setPermError("שגיאה בטעינת ההרשאות — נסה לרענן");
    } finally {
      setPermLoading(false);
    }
  }

  async function savePermDefault(role, permission, allowed) {
    const key = `${role}_${permission}`;
    setPermSaving(s => ({ ...s, [key]: true }));
    // enabling can_manage_billing must also enable can_view_billing
    const alsoEnable = (permission === "can_manage_billing" && allowed) ? "can_view_billing" : null;
    // disabling can_edit_school_directly must also disable can_delete_schools
    const alsoDisable = (permission === "can_edit_school_directly" && !allowed) ? "can_delete_schools" : null;
    // enabling can_edit_school_directly must also enable can_request_school_update (it becomes irrelevant but keep value consistent)
    // no cascade needed — the toggle just grays out; value stays for when direct edit is turned off again
    try {
      await axios.put("/schools/permissions/defaults", { role, permission, allowed });
      setPermDefaults(d => ({ ...d, [permission]: { ...d[permission], [role]: allowed } }));
      if (alsoEnable && permDefaults?.[alsoEnable]?.[role] === false) {
        await axios.put("/schools/permissions/defaults", { role, permission: alsoEnable, allowed: true });
        setPermDefaults(d => ({ ...d, [alsoEnable]: { ...d[alsoEnable], [role]: true } }));
      }
      if (alsoDisable && permDefaults?.[alsoDisable]?.[role] === true) {
        await axios.put("/schools/permissions/defaults", { role, permission: alsoDisable, allowed: false });
        setPermDefaults(d => ({ ...d, [alsoDisable]: { ...d[alsoDisable], [role]: false } }));
      }
    } catch {
      setPermError("שגיאה בשמירה — נסה שוב");
    } finally {
      setPermSaving(s => { const n = { ...s }; delete n[key]; return n; });
    }
  }

  async function openOverridePanel(u) {
    setOverrideUser(u);
    setOverrides({});
    setOverrideLoading(true);
    try {
      const res = await axios.get(`/schools/permissions/overrides/${u.id}`);
      setOverrides(res.data || {});
    } catch {
      /* non-fatal */
    } finally {
      setOverrideLoading(false);
    }
  }

  async function saveOverride(permission, allowed) {
    setOverrideSaving(s => ({ ...s, [permission]: true }));
    try {
      await axios.put(`/schools/permissions/overrides/${overrideUser.id}`, { permission, allowed });
      const userId = overrideUser.id;
      setOverrides(o => {
        const n = { ...o };
        if (allowed === null) delete n[permission];
        else n[permission] = allowed;
        setOverrideCounts(c => ({ ...c, [userId]: Object.keys(n).length }));
        return n;
      });
    } catch {
      /* non-fatal */
    } finally {
      setOverrideSaving(s => { const n = { ...s }; delete n[permission]; return n; });
    }
  }

  useEffect(() => {
    if (!openActionsMenu) return;
    const close = () => setOpenActionsMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openActionsMenu]);

  useEffect(() => {
    loadSchools();
    supabase.auth.getSession().then(({ data }) => {
      const role = data.session?.user?.user_metadata?.role || "";
      setMyRole(role);
      setMyUserId(data.session?.user?.id || null);
      // eagerly load permissions so billing tab visibility is known immediately
      if (!permDefaults && !permLoading) loadPermDefaults();
      // Confirm role from server — JWT user_metadata can be stale after role changes
      axios.get("/schools/users/me").then(res => {
        if (res.data?.role) setMyRole(res.data.role);
        setCanDeleteSchool(!!res.data?.can_delete_schools);
        setCanInviteUsers(!!res.data?.can_invite_users);
        setCanDeleteUsers(!!res.data?.can_delete_users);
        setCanManagePermissions(!!res.data?.can_manage_user_permissions);
        setCanDeleteMeetings(!!res.data?.can_delete_own_meetings);
      }).catch(() => {});
    });
  }, []);
  useEffect(() => { if ((activeTab === "users" || activeTab === "billing") && users.length === 0) loadUsers(); }, [activeTab]);
  useEffect(() => { if (activeTab === "permissions" && !permDefaults && !permLoading) loadPermDefaults(); }, [activeTab]);
  // Advisors must not access the admin area — redirect immediately once role is confirmed
  useEffect(() => { if (myRole === "advisor") navigate("/", { replace: true }); }, [myRole]);

  async function loadYearAdminData(year) {
    setLoadingYearAdminData(true);
    try {
      const res = await axios.get("/schools/year-admin-data", { params: { academic_year: year } });
      setYearAdminData(res.data && typeof res.data === "object" ? res.data : {});
    } catch {
      setYearAdminData({});
    } finally {
      setLoadingYearAdminData(false);
    }
  }
  useEffect(() => {
    if (myRole === "owner" || myRole === "manager") loadYearAdminData(adminAcademicYear);
  }, [adminAcademicYear, myRole]);

  // Restore admin-table column prefs (mirrors DashboardPage's col_order/col_visible pattern,
  // stored under separate keys/columns so the two tables' layouts don't collide).
  useEffect(() => {
    if (!myUserId) return;
    try {
      const savedOrder = JSON.parse(localStorage.getItem(`admin-schools-col-order-${myUserId}`) || "null");
      if (Array.isArray(savedOrder) && savedOrder.length > 0 && savedOrder.every(isKnownAdminColumnKey)) setAdminColOrder(savedOrder);
      const savedVisible = JSON.parse(localStorage.getItem(`admin-schools-col-visible-${myUserId}`) || "null");
      if (savedVisible && typeof savedVisible === "object" && Object.keys(savedVisible).every(isKnownAdminColumnKey)) setAdminColVisible(savedVisible);
    } catch {}
    supabase.from("profiles").select("admin_col_order, admin_col_visible").eq("id", myUserId).single().then(({ data }) => {
      if (data?.admin_col_order && Array.isArray(data.admin_col_order) && data.admin_col_order.length > 0 && data.admin_col_order.every(isKnownAdminColumnKey)) {
        setAdminColOrder(data.admin_col_order);
      }
      if (data?.admin_col_visible && typeof data.admin_col_visible === "object" && Object.keys(data.admin_col_visible).every(isKnownAdminColumnKey)) {
        setAdminColVisible(data.admin_col_visible);
      }
    }).catch(() => {});
  }, [myUserId]);

  useEffect(() => {
    if (!showAdminColPicker) return;
    function handleOutside(e) {
      if (adminColPickerRef.current && !adminColPickerRef.current.contains(e.target)) setShowAdminColPicker(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showAdminColPicker]);

  // Restore admin-table column filters (localStorage only — per-device, mirrors col-order/visible pattern).
  useEffect(() => {
    if (!myUserId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`admin-schools-col-filters-${myUserId}`) || "null");
      if (saved && typeof saved === "object") setAdminColumnFilters(saved);
    } catch {}
  }, [myUserId]);

  useEffect(() => {
    if (!myUserId) return;
    localStorage.setItem(`admin-schools-col-filters-${myUserId}`, JSON.stringify(adminColumnFilters));
  }, [adminColumnFilters, myUserId]);

  useEffect(() => {
    if (!openAdminFilterKey) return;
    function handleOutside(e) {
      if (adminFilterPopoverRef.current && !adminFilterPopoverRef.current.contains(e.target)) setOpenAdminFilterKey(null);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [openAdminFilterKey]);

  function saveAdminColPrefs(order, visible) {
    if (!myUserId) return;
    localStorage.setItem(`admin-schools-col-order-${myUserId}`, JSON.stringify(order));
    localStorage.setItem(`admin-schools-col-visible-${myUserId}`, JSON.stringify(visible));
    supabase.from("profiles").update({ admin_col_order: order, admin_col_visible: visible }).eq("id", myUserId).then(() => {});
  }

  function toggleAdminColVisible(key) {
    setAdminColVisible(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveAdminColPrefs(adminColOrder, next);
      return next;
    });
  }

  function toggleAdminSort(key) {
    if (adminSortKey !== key) { setAdminSortKey(key); setAdminSortDir("asc"); }
    else if (adminSortDir === "asc") setAdminSortDir("desc");
    else { setAdminSortKey(null); setAdminSortDir("asc"); }
  }

  async function saveYearAdminField(schoolId, field, value) {
    setYearAdminData(prev => ({
      ...prev,
      [schoolId]: { ...(prev[schoolId] || {}), school_id: schoolId, [field]: value },
    }));
    try {
      const res = await axios.put(`/schools/${schoolId}/year-admin-data`, { [field]: value }, { params: { academic_year: adminAcademicYear } });
      setYearAdminData(prev => ({ ...prev, [schoolId]: res.data }));
    } catch {
      loadYearAdminData(adminAcademicYear);
    }
  }

  function openContractUpload(schoolId) {
    setUploadingContractFor(schoolId);
    adminContractInputRef.current?.click();
  }

  async function handleContractFileChange(e) {
    const file = e.target.files?.[0];
    const schoolId = uploadingContractFor;
    e.target.value = "";
    setUploadingContractFor(null);
    if (!file || !schoolId) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`/schools/${schoolId}/year-admin-data/contract-file`, formData, {
        params: { academic_year: adminAcademicYear },
      });
      setYearAdminData(prev => ({ ...prev, [schoolId]: { ...(prev[schoolId] || {}), ...res.data } }));
    } catch {
      /* non-fatal — user can retry the upload */
    }
  }

  async function downloadContractFile(schoolId) {
    try {
      const res = await axios.get(`/schools/${schoolId}/year-admin-data/contract-file`, {
        params: { academic_year: adminAcademicYear },
        responseType: "blob",
      });
      const filename = yearAdminData[schoolId]?.contract_file_name || "contract";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    function handler(e) { if (schoolFormDotsRef.current && !schoolFormDotsRef.current.contains(e.target)) setShowSchoolFormDots(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // When "היועצים המלווים שנבחרו" mode is active, keep restrict_access_to in sync with selected advisors
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    const ids = editingSchool ? draftAdvisorIds : selectedAdvisors;
    setSchoolForm(p => ({ ...p, restrict_access_to: ids.length > 0 ? ids : null }));
  }, [selectedAdvisors, draftAdvisorIds, editingSchool, accessLinkedToAdvisors]);

  async function loadSchools() {
    setLoadingSchools(true);
    try {
      const res = await axios.get("/schools/?include_deleted=true");
      setSchools(Array.isArray(res.data) ? res.data : []);
    } finally {
      setLoadingSchools(false);
    }
  }

  async function restoreSchool(schoolId) {
    const school = schools.find(s => s.id === schoolId);
    try {
      await axios.post(`/schools/${schoolId}/restore`);
      await loadSchools();
      if (school?.name) setRestoreSuccessSchoolName(school.name);
    } catch {
      alert("שגיאה בשחזור בית הספר — נסה שוב");
    }
  }

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const [usersRes, countsRes] = await Promise.all([
        axios.get("/schools/users/all"),
        axios.get("/schools/permissions/overrides/counts").catch(() => ({ data: {} })),
      ]);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setOverrideCounts(countsRes.data || {});
    } finally {
      setLoadingUsers(false);
    }
  }

  async function saveSchool() {
    setTriedSave(true);
    if (!schoolForm.name || validateSymbol(schoolForm.symbol)) return;
    if (!editingSchool && schools.some(s => s.symbol === schoolForm.symbol)) return;
    if (!editingSchool && !schoolStage) return;
    if (!editingSchool && selectedAdvisors.length === 0) return;
    if (editingSchool && draftAdvisorIds.length === 0) return;
    if (!editingSchool && (schoolStage === "sheshshnati" || schoolStage === "other") && customDivisions.length === 0) return;
    if (schoolForm.principal_phone && validateSecretaryPhone(schoolForm.principal_phone)) return;
    if (schoolForm.secretary_phone && validateSecretaryPhone(schoolForm.secretary_phone)) return;
    if (schoolForm.finance_contact_phone && validateSecretaryPhone(schoolForm.finance_contact_phone)) return;
    if (schoolForm.school_phone && validateSchoolPhone(schoolForm.school_phone)) return;
    if (!schoolForm.meeting_coordinator) return;
    setSavingSchool(true);
    try {
      if (editingSchool) {
        // Apply only the net advisor changes (adds before removes, so the backend's
        // "last advisor" guard never sees a false zero-advisor state) — this is what
        // keeps notifications limited to real, saved changes instead of every click.
        const added = draftAdvisorIds.filter(id => !originalAdvisorIds.includes(id));
        const removed = originalAdvisorIds.filter(id => !draftAdvisorIds.includes(id));
        try {
          for (const id of added) {
            await axios.post(`/schools/${editingSchool.id}/advisors`, { advisor_id: id });
          }
          for (const id of removed) {
            await axios.delete(`/schools/${editingSchool.id}/advisors/${id}`);
          }
        } catch (err) {
          window.alert(err.response?.data?.detail || "שגיאה בעדכון היועצים המלווים");
          return false;
        }
        await axios.put(`/schools/${editingSchool.id}`, schoolForm);
        const updatedAdvisors = draftAdvisorIds.map(id => users.find(u => u.id === id)).filter(Boolean);
        setSchoolAdvisors(prev => ({ ...prev, [editingSchool.id]: updatedAdvisors }));
        setOriginalAdvisorIds(draftAdvisorIds);
      } else {
        const res = await axios.post("/schools/", { ...schoolForm, stage: schoolStage });
        const newId = res.data.id;
        const stageOption = SCHOOL_STAGE_OPTIONS.find(s => s.value === schoolStage);
        if (stageOption?.divisionType) {
          await axios.post(`/schools/${newId}/accounts`, { division_type: stageOption.divisionType });
        } else {
          for (const div of customDivisions) {
            if (div.division_type) {
              await axios.post(`/schools/${newId}/accounts`, { division_type: div.division_type });
            }
          }
        }
        for (const advisorId of selectedAdvisors) {
          await axios.post(`/schools/${newId}/advisors`, { advisor_id: advisorId });
        }
      }
      setShowSchoolForm(false);
      setEditingSchool(null);
      setSchoolForm(EMPTY_FORM);
      setSelectedAdvisors([]);
      setSchoolStage("");
      setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
      setTriedSave(false);
      await loadSchools();
      return true;
    } finally {
      setSavingSchool(false);
    }
  }

  async function deleteSchool(id) {
    if (!window.confirm("למחוק את בית הספר? פעולה זו תמחק גם את כל החטיבות הקשורות אליו.")) return;
    const school = schools.find(s => s.id === id);
    await axios.delete(`/schools/${id}`);
    await loadSchools();
    if (school?.name) setRecycleInfoSchoolName(school.name);
  }

  function startEdit(school) {
    setAccessLinkedToAdvisors(false);
    setEditingSchool(school);
    setSchoolForm({
      name: school.name || "",
      symbol: school.symbol || "",
      city: school.city || "",
      authority: school.authority || "",
      stage: school.stage || "",
      finance_software: school.finance_software || "",
      principal_name: school.principal_name || "",
      principal_phone: school.principal_phone || "",
      principal_email: school.principal_email || "",
      secretary_name: school.secretary_name || "",
      secretary_phone: school.secretary_phone || "",
      secretary_email: school.secretary_email || "",
      finance_contact_name: school.finance_contact_name || "",
      finance_contact_phone: school.finance_contact_phone || "",
      finance_contact_email: school.finance_contact_email || "",
      school_phone: school.school_phone || "",
      address: school.address || "",
      district: school.district || "",
      restrict_access_to: school.restrict_access_to || null,
      extra_contacts: school.extra_contacts || [],
      principal_day_off: school.principal_day_off || [],
      secretary_day_off: school.secretary_day_off || [],
      finance_contact_day_off: school.finance_contact_day_off || [],
      meeting_coordinator: school.meeting_coordinator || null,
    });
    setTriedSave(false);
    setShowSchoolForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    axios.get(`/schools/${school.id}/advisors`).then(res => {
      const advisors = res.data || [];
      setSchoolAdvisors(prev => ({ ...prev, [school.id]: advisors }));
      const ids = advisors.map(a => a.id);
      setDraftAdvisorIds(ids);
      setOriginalAdvisorIds(ids);
    }).catch(() => {});
    loadUsers();
  }

  async function handleDeleteConfirmed() {
    if (!editingSchool) return;
    setDeletingSchool(true);
    const schoolName = editingSchool.name;
    try {
      await axios.delete(`/schools/${editingSchool.id}`);
      setShowDeleteConfirm(false);
      setShowSchoolForm(false);
      setEditingSchool(null);
      setSchoolForm(EMPTY_FORM);
      setSchoolStage("");
      setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
      await loadSchools();
      setRecycleInfoSchoolName(schoolName);
    } finally {
      setDeletingSchool(false);
    }
  }

  function openNewForm() {
    setEditingSchool(null);
    setSchoolForm(EMPTY_FORM);
    setSelectedAdvisors([]);
    setSchoolStage("");
    setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    setShowSchoolForm(true);
    loadUsers();
  }

  async function toggleExpand(school) {
    if (expandedSchool === school.id) { setExpandedSchool(null); setEditingAccount(null); return; }
    setExpandedSchool(school.id);
    setEditingAccount(null);
    if (!schoolAccounts[school.id]) {
      const res = await axios.get(`/schools/${school.id}/accounts`);
      setSchoolAccounts(prev => ({ ...prev, [school.id]: res.data }));
    }
    const aRes = await axios.get(`/schools/${school.id}/advisors`);
    setSchoolAdvisors(prev => ({ ...prev, [school.id]: aRes.data }));
    if (users.length === 0) loadUsers();
  }

  async function addAdvisorToSchool(schoolId, advisorId) {
    if (!advisorId) return;
    await axios.post(`/schools/${schoolId}/advisors`, { advisor_id: advisorId });
    const res = await axios.get(`/schools/${schoolId}/advisors`);
    setSchoolAdvisors(prev => ({ ...prev, [schoolId]: res.data }));
  }

  async function removeAdvisorFromSchool(schoolId, advisorId) {
    try {
      await axios.delete(`/schools/${schoolId}/advisors/${advisorId}`);
      const res = await axios.get(`/schools/${schoolId}/advisors`);
      setSchoolAdvisors(prev => ({ ...prev, [schoolId]: res.data }));
    } catch (err) {
      window.alert(err.response?.data?.detail || "שגיאה בהסרת היועץ");
    }
  }

  // Expanded-row quick panel has no separate "save" step — every checkbox toggle is applied
  // immediately (unlike the deferred draft used in the edit-school form above).
  async function handleExpandedAdvisorChange(schoolId, newIds) {
    const current = (schoolAdvisors[schoolId] || []).map(a => a.id);
    const added = newIds.filter(id => !current.includes(id));
    const removed = current.filter(id => !newIds.includes(id));
    for (const id of added) await addAdvisorToSchool(schoolId, id);
    for (const id of removed) await removeAdvisorFromSchool(schoolId, id);
  }

  async function addAccount(schoolId) {
    await axios.post(`/schools/${schoolId}/accounts`, { division_type: newDivision });
    const res = await axios.get(`/schools/${schoolId}/accounts`);
    setSchoolAccounts(prev => ({ ...prev, [schoolId]: res.data }));
  }

  async function deleteAccount(schoolId, accountId) {
    await axios.delete(`/schools/${schoolId}/accounts/${accountId}`);
    const res = await axios.get(`/schools/${schoolId}/accounts`);
    setSchoolAccounts(prev => ({ ...prev, [schoolId]: res.data }));
    if (editingAccount === accountId) setEditingAccount(null);
  }

  function startEditAccount(acc) {
    setEditingAccount(acc.id);
    setAccountForm({ finance_software: acc.finance_software || "", tmura_model: acc.tmura_model || false });
  }

  async function saveAccount(schoolId, accountId) {
    await axios.put(`/schools/${schoolId}/accounts/${accountId}`, accountForm);
    const res = await axios.get(`/schools/${schoolId}/accounts`);
    setSchoolAccounts(prev => ({ ...prev, [schoolId]: res.data }));
    setEditingAccount(null);
  }

  const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };

  function requestRoleChange(u, newRole) {
    if (newRole === u.role) return;
    setRoleChangeConfirm({ userId: u.id, userName: u.full_name || u.email, oldRole: u.role, newRole });
  }

  async function confirmRoleChange() {
    if (!roleChangeConfirm) return;
    const { userId, newRole } = roleChangeConfirm;
    setRoleChangeConfirm(null);
    setRoleError("");
    try {
      await axios.patch(`/schools/users/${userId}/role`, { role: newRole });
      await loadUsers();
    } catch (err) {
      const detail = err?.response?.data?.detail || "שגיאה בשינוי תפקיד";
      setRoleError(detail);
    }
  }

  function startEditUser(u) {
    setEditingUser(u);
    setEditingUserName(u.full_name || "");
  }

  async function saveEditUser() {
    if (!editingUser) return;
    setSavingUser(true);
    try {
      await axios.patch(`/schools/users/${editingUser.id}`, { full_name: editingUserName });
      setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, full_name: editingUserName } : u));
      setEditingUser(null);
    } finally {
      setSavingUser(false);
    }
  }

  async function saveUserDomains(u, control_domains) {
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, control_domains } : x));
    try {
      await axios.patch(`/schools/users/${u.id}`, { control_domains });
    } catch {
      loadUsers();
    }
  }

  async function handleDeleteButtonClick(u) {
    setOpenActionsMenu(null);
    try {
      const res = await axios.get(`/schools/users/${u.id}/future-meetings`);
      if (res.data && res.data.length > 0) {
        setUserMeetingsConflict({ user: u, meetings: res.data });
        return;
      }
    } catch {
      // fall through to the sole-schools check if the meetings check itself fails
    }
    await checkSoleSchoolsThenDelete(u);
  }

  async function checkSoleSchoolsThenDelete(u) {
    try {
      const res = await axios.get(`/schools/users/${u.id}/sole-schools`);
      if (res.data && res.data.length > 0) {
        setUserSchoolsConflict({ user: u, schools: res.data });
        return;
      }
    } catch {
      // fall through to the normal delete-confirmation flow if the check itself fails
    }
    setUserToDelete(u);
  }

  async function handleDeleteUser() {
    if (!userToDelete) return;
    setConfirmingUserDelete(true);
    setUserDeleteError("");
    try {
      await axios.delete(`/schools/users/${userToDelete.id}`);
      setUsers(prev => prev.filter(u => u.id !== userToDelete.id));
      setUserToDelete(null);
    } catch (err) {
      setUserDeleteError(err?.response?.data?.detail || "שגיאה במחיקת המשתמש. נסה שנית.");
    } finally {
      setConfirmingUserDelete(false);
    }
  }

  async function inviteUser() {
    setInviting(true);
    setInviteMsg("");
    try {
      await axios.post("/schools/users/invite", inviteForm);
      setInviteMsg("הזמנה נשלחה בהצלחה לאימייל המשתמש");
      setInviteForm({ email: "", full_name: "", role: "advisor", control_domains: [] });
      await loadUsers();
    } catch {
      setInviteMsg("שגיאה בשליחת ההזמנה");
    } finally {
      setInviting(false);
    }
  }

  async function resendInvite(u) {
    setResendingUserId(u.id);
    setResendMsg(null);
    try {
      await axios.post(`/schools/users/${u.id}/resend-invite`);
      setResendMsg({ id: u.id, ok: true });
      setTimeout(() => setResendMsg(null), 4000);
    } catch {
      setResendMsg({ id: u.id, ok: false });
      setTimeout(() => setResendMsg(null), 4000);
    } finally {
      setResendingUserId(null);
    }
  }

  function handleUserImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setUserImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const nonEmpty = allRows.filter(r => r.some(c => String(c).trim() !== ""));
        if (nonEmpty.length < 2) {
          setUserImportResult({ imported: 0, errors: ["הקובץ ריק או לא מכיל נתונים"] });
          return;
        }
        const headers = nonEmpty[0].map(h => String(h).trim());
        const previewRow = nonEmpty[1].map(v => String(v).trim());
        const dataRows = nonEmpty.slice(1);
        setUserImportMappingData({ headers, previewRow, dataRows });
      } catch {
        setUserImportResult({ imported: 0, errors: ["שגיאה בקריאת הקובץ — ודא שמדובר בקובץ Excel תקין"] });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmUserImport(mapping) {
    if (!userImportMappingData) return;
    setUserImportMappingData(null);
    setImportingUsers(true);
    setUserImportResult(null);
    const { dataRows } = userImportMappingData;
    let imported = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      setUserImportProgressMsg(`מזמין... ${i + 1} / ${dataRows.length}`);
      const email = String(row[mapping.email] ?? "").trim();
      const full_name = String(row[mapping.full_name] ?? "").trim();
      const role = mapping.role !== null
        ? normalizeRole(String(row[mapping.role] ?? "").trim())
        : "advisor";

      if (!email || !full_name) {
        errors.push(`שורה ${i + 2}: חסר אימייל או שם מלא`);
        continue;
      }
      try {
        await axios.post("/schools/users/invite", { email, full_name, role });
        imported++;
      } catch (err) {
        const detail = err.response?.data?.detail || "שגיאה לא ידועה";
        errors.push(`שורה ${i + 2} (${email}): ${detail}`);
      }
    }

    setUserImportProgressMsg("");
    setImportingUsers(false);
    setUserImportResult({ imported, errors });
    if (imported > 0) await loadUsers();
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const nonEmpty = allRows.filter(r => r.some(c => String(c).trim() !== ""));
        if (nonEmpty.length < 2) {
          setImportResult({ imported: 0, errors: ["הקובץ ריק או לא מכיל נתונים"] });
          return;
        }
        const headers = nonEmpty[0].map(h => String(h).trim());
        const previewRow = nonEmpty[1].map(v => String(v).trim());
        const dataRows = nonEmpty.slice(1);
        setImportMappingData({ headers, previewRow, dataRows });
      } catch {
        setImportResult({ imported: 0, errors: ["שגיאה בקריאת הקובץ — ודא שמדובר בקובץ Excel תקין"] });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmImport(mapping) {
    if (!importMappingData) return;
    setImportMappingData(null);
    setImporting(true);
    setImportResult(null);
    const { dataRows } = importMappingData;
    let imported = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      setImportProgressMsg(`מייבא... ${i + 1} / ${dataRows.length}`);
      const school = {};
      IMPORT_FIELD_CONFIG.forEach(f => {
        if (mapping[f.key] === null) return;
        const raw = String(row[mapping[f.key]] ?? "").trim();
        if (f.key === "stage") school[f.key] = normalizeStage(raw);
        else if (f.key === "finance_software") school[f.key] = normalizeFinanceSoftware(raw);
        else if (f.key === "district") school[f.key] = normalizeDistrict(raw);
        else if (f.key.includes("phone")) school[f.key] = raw.replace(/\D/g, "");
        else school[f.key] = raw;
      });
      if (!school.name || !school.symbol) {
        errors.push(`שורה ${i + 2}: חסר שם בית ספר או סמל מוסד`);
        continue;
      }
      if (school.secretary_name) school.meeting_coordinator = "secretary";
      else if (school.principal_name) school.meeting_coordinator = "principal";
      else {
        errors.push(`שורה ${i + 2}: לא ניתן לקבוע אחראי/ת לתיאום פגישות (חסר שם מנהלנ/ית או מנהל/ת)`);
        continue;
      }
      try {
        await axios.post("/schools/", school);
        imported++;
      } catch (err) {
        const detail = err.response?.data?.detail || "שגיאה לא ידועה";
        errors.push(`שורה ${i + 2} (${school.name}): ${detail}`);
      }
    }

    setImportProgressMsg("");
    setImporting(false);
    setImportResult({ imported, errors });
    if (imported > 0) await loadSchools();
  }

  const symbolError = validateSymbol(schoolForm.symbol);
  const schoolPhoneError = validateSchoolPhone(schoolForm.school_phone);

  // Compute the months to show in the billing tab (newest first = rightmost in RTL)
  const orgJoinDate = users.length > 0
    ? users.reduce((min, u) => {
        if (!u.created_at) return min;
        const d = new Date(u.created_at);
        return (!min || d < min) ? d : min;
      }, null)
    : null;
  const billingMonths = (() => {
    const today = new Date();
    const result = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      if (orgJoinDate) {
        const orgStart = new Date(orgJoinDate.getFullYear(), orgJoinDate.getMonth(), 1);
        if (d < orgStart) break;
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({ key, year: d.getFullYear(), month: d.getMonth(), label: `${HEBREW_MONTHS[d.getMonth()]} ${d.getFullYear()}` });
    }
    return result;
  })();
  const activeBillingMonth = billingMonthTab && billingMonths.some(m => m.key === billingMonthTab)
    ? billingMonthTab
    : (billingMonths[0]?.key ?? null);

  const showBillingTab = myRole === "owner" || (myRole === "manager" && permDefaults?.can_view_billing?.manager === true);
  const showIntegrationsTab = myRole === "owner" || myRole === "manager";
  const showCallsTab = myRole === "owner" || myRole === "manager";
  const showAgentWidget = myRole === "owner" || myRole === "manager";
  // null=loading, true=allowed, false=denied
  // owner → always true; manager → depends on permDefaults (null while loading → treat as not-yet-known)
  const canAddSchool = myRole === "owner"
    ? true
    : myRole === "manager" && permDefaults !== null
      ? permDefaults?.can_add_school?.manager !== false
      : null;

  const canChangeRole = myRole === "owner"
    ? true
    : myRole === "manager" && permDefaults !== null
      ? permDefaults?.can_change_user_role?.manager === true
      : null;

  // Derived rows for the new admin schools table (active schools only — "סל מחזור" below it
  // is unaffected and keeps reading straight from `schools`).
  const activeAdminSchools = schools.filter(s => s.status === "active" || !s.status);
  const filteredAdminSchools = adminSearchQuery.trim()
    ? activeAdminSchools.filter(s => {
        const q = adminSearchQuery.trim();
        return (s.name || "").includes(q) || (s.symbol || "").includes(q) || (s.city || "").includes(q);
      })
    : activeAdminSchools;
  function getAdminSortValue(school, key) {
    const yad = yearAdminData[school.id] || {};
    switch (key) {
      case "symbol": return school.symbol || "";
      case "city": return school.city || "";
      case "authority": return school.authority || "";
      case "stage": return ADMIN_SCHOOL_STAGE_LABEL[school.stage] || school.stage || "";
      case "meetings_completed": return school.meetings_stats?.completed ?? -1;
      case "meetings_hours": return school.meetings_stats?.total_minutes ?? -1;
      case "contract_sent": case "contract_received":
        return yad[key] === true ? 2 : yad[key] === false ? 1 : 0;
      case "contract_file": return yad.contract_file_name || "";
      case "service_type": {
        const opt = SERVICE_TYPE_OPTIONS.find(o => o.value === yad.service_type);
        return opt ? opt.label : (yad.service_type || "");
      }
      case "order_method": {
        return (yad.order_method || [])
          .map(v => FUNDING_METHOD_OPTIONS.find(o => o.value === v)?.label || v)
          .join(", ");
      }
      default: {
        const v = yad[key];
        return v === undefined || v === null ? "" : v;
      }
    }
  }
  const columnFilteredAdminSchools = Object.keys(adminColumnFilters).length === 0
    ? filteredAdminSchools
    : filteredAdminSchools.filter(s => passesAdminColumnFilters(s, yearAdminData[s.id] || {}, adminColumnFilters, getAdminSortValue));
  const adminColumnFilterActiveKeys = Object.entries(adminColumnFilters)
    .filter(([, spec]) => spec && (spec.value || (spec.values && spec.values.length > 0)))
    .map(([key]) => key);
  const sortedAdminSchools = adminSortKey
    ? [...columnFilteredAdminSchools].sort((a, b) => {
        const va = getAdminSortValue(a, adminSortKey);
        const vb = getAdminSortValue(b, adminSortKey);
        let cmp;
        if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), "he");
        return adminSortDir === "asc" ? cmp : -cmp;
      })
    : columnFilteredAdminSchools;
  const visibleAdminColOrder = adminColOrder.filter(k => adminColVisible[k] && ADMIN_ALL_COLUMNS.some(c => c.key === k));
  const adminColumnCategories = [
    { title: "כללי", cols: ADMIN_IDENTITY_COLUMNS },
    { title: "ניהולי", cols: ADMIN_DATA_COLUMNS },
  ];

  const tabs = [
    { id: "schools", label: "בתי ספר" },
    { id: "users", label: "משתמשים" },
    { id: "meetings", label: "פגישות" },
    ...(showCallsTab ? [{ id: "calls", label: "שיחות" }] : []),
    { id: "permissions", label: "הרשאות" },
    ...(showIntegrationsTab ? [{ id: "integrations", label: "אינטגרציות" }] : []),
    ...(showBillingTab ? [{ id: "billing", label: "חיובים" }] : []),
  ];

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />

      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        {/* Header + tabs — always at a fixed width, independent of how wide the active
            tab's own content area needs to be, so the tab bar never shifts position. */}
        <div className="mx-auto max-w-4xl px-6 pt-10">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">פאנל ניהול</h1>
            <p className="text-slate-500 text-sm mt-1">ניהול בתי ספר, חטיבות ומשתמשים</p>
          </div>

          {/* Tabs */}
          <div className="flex items-end border-b border-slate-200 mb-6 gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === t.id
                    ? "border-blue-600 text-blue-600 font-semibold"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`mx-auto px-6 pb-10 ${
          activeTab === "users" ? "max-w-[95rem]" :
          ["schools", "meetings", "calls"].includes(activeTab) ? "max-w-[100rem]" : "max-w-4xl"
        }`}>
          {/* Schools Tab */}
          {activeTab === "schools" && (
            <div>
              <div className="flex justify-end gap-2 mb-4">
                <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} aria-label="ייבוא בתי ספר מאקסל" />
                <button onClick={() => importRef.current?.click()} disabled={importing} className="btn-ghost text-sm px-4 py-2">
                  {importing ? (importProgressMsg || "מייבא...") : "ייבוא מאקסל"}
                </button>
                <div className="relative group">
                  <button
                    onClick={canAddSchool === true ? openNewForm : undefined}
                    disabled={canAddSchool !== true}
                    className={`btn-blue text-sm px-4 py-2 ${canAddSchool !== true ? "opacity-40 cursor-not-allowed" : ""}`}
                  >+ הוסף בית ספר</button>
                  {canAddSchool === false && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 hidden group-hover:block w-max max-w-xs bg-yellow-50 border border-yellow-300 text-yellow-800 text-xs rounded-lg px-3 py-2 shadow-md whitespace-nowrap">
                      יש לבקש הרשאה מהבעלים כדי להוסיף בית ספר
                    </div>
                  )}
                </div>
              </div>

              {importResult && (
                <div className={`glass-card rounded-xl p-4 mb-4 border ${importResult.errors.length > 0 ? "border-orange-200" : "border-green-200"}`}>
                  <p className="font-medium text-slate-800 text-sm">
                    {importResult.imported > 0 ? `ייובאו ${importResult.imported} בתי ספר בהצלחה` : "לא יובאו בתי ספר"}
                    {importResult.errors.length > 0 && ` · ${importResult.errors.length} שגיאות`}
                  </p>
                  {importResult.errors.map((e, i) => <p key={i} className="text-red-500 text-xs mt-1">{e}</p>)}
                </div>
              )}


              {/* School form */}
              {showSchoolForm && (
                <div className="glass-card rounded-2xl p-6 mb-4">
                  <div className="relative flex items-center justify-center mb-5">
                    <h3 className="font-bold text-slate-800 text-center">
                      {editingSchool ? "עריכת פרטי בית הספר" : "הוספת בית ספר חדש"}
                    </h3>
                    {editingSchool && canDeleteSchool && (
                      <div className="absolute left-0" ref={schoolFormDotsRef}>
                        <button
                          type="button"
                          onClick={() => setShowSchoolFormDots(o => !o)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400"
                          aria-label="אפשרויות נוספות"
                          aria-expanded={showSchoolFormDots}
                        >
                          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                          </svg>
                        </button>
                        {showSchoolFormDots && (
                          <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-xl py-1 shadow-lg border border-slate-100" style={{ minWidth: 150 }} dir="rtl">
                            <button
                              type="button"
                              onClick={() => { setShowDeleteConfirm(true); setShowSchoolFormDots(false); }}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 text-right transition-colors"
                            >
                              מחק בית ספר
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-sm font-semibold text-slate-700 mb-3">פרטי בית הספר</p>

                  {/* 3-column grid matching SchoolPage.jsx edit layout */}
                  <div className="grid grid-cols-3 gap-x-8">
                    {/* Right column: שם | סמל | שלב */}
                    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                      <label htmlFor="school-name" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">שם מוסד:</label>
                      <div className="py-0.5">
                        <input id="school-name" className={`input-field ${triedSave && !schoolForm.name ? "border-red-400" : ""}`}
                          autoComplete="off" value={schoolForm.name}
                          onChange={e => setSchoolForm(p => ({ ...p, name: e.target.value }))} />
                        {triedSave && !schoolForm.name && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                      </div>

                      <label htmlFor="school-symbol" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">סמל מוסד:</label>
                      <div className="py-0.5">
                        <input id="school-symbol" className={`input-field ${(triedSave && symbolError) ? "border-red-400" : ""}`}
                          autoComplete="off" value={schoolForm.symbol}
                          onChange={e => setSchoolForm(p => ({ ...p, symbol: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                          dir="ltr" inputMode="numeric" maxLength={6} />
                        {schoolForm.symbol.length > 0 && symbolError && <span className="text-xs text-red-500 block mt-0.5" role="alert">{symbolError}</span>}
                        {triedSave && !schoolForm.symbol && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                        {!editingSchool && triedSave && schoolForm.symbol && !symbolError && schools.some(s => s.symbol === schoolForm.symbol) && (
                          <span className="text-xs text-red-500 block mt-0.5" role="alert">סמל זה כבר קיים בארגון</span>
                        )}
                      </div>

                      <label htmlFor={editingSchool ? "school-stage-edit" : "school-stage"} className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">שלב מוסד:</label>
                      <div className="py-0.5">
                        {editingSchool ? (
                          <select id="school-stage-edit" className="input-field text-sm"
                            value={schoolForm.stage || ""}
                            onChange={e => setSchoolForm(p => ({ ...p, stage: e.target.value }))}>
                            {SCHOOL_STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        ) : (
                          <>
                            <select id="school-stage"
                              className={`input-field text-sm ${triedSave && !schoolStage ? "border-red-400" : ""}`}
                              value={schoolStage}
                              onChange={e => {
                                setSchoolStage(e.target.value);
                                if (e.target.value === "sheshshnati" || e.target.value === "other") {
                                  setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
                                }
                              }}
                            >
                              {SCHOOL_STAGE_OPTIONS.map(s => (
                                <option key={s.value} value={s.value} disabled={s.value === ""}>{s.label}</option>
                              ))}
                            </select>
                            {triedSave && !schoolStage && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Middle column: עיר | בעלות | מחוז */}
                    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                      <label htmlFor="school-city" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">עיר:</label>
                      <div className="py-0.5">
                        <input id="school-city" className="input-field" autoComplete="off" value={schoolForm.city}
                          onChange={e => setSchoolForm(p => ({ ...p, city: e.target.value }))} />
                      </div>

                      <label htmlFor="school-authority" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">בעלות:</label>
                      <div className="py-0.5">
                        <input id="school-authority" className="input-field" autoComplete="off" value={schoolForm.authority}
                          onChange={e => setSchoolForm(p => ({ ...p, authority: e.target.value }))} />
                      </div>

                      <label htmlFor="school-district" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">מחוז:</label>
                      <div className="py-0.5">
                        <select id="school-district" className="input-field text-sm"
                          value={schoolForm.district}
                          onChange={e => setSchoolForm(p => ({ ...p, district: e.target.value }))}>
                          <option value="">בחר</option>
                          {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Left column: תוכנת כספים | טלפון | כתובת */}
                    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                      <label htmlFor="school-finance-software" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">תוכנת כספים:</label>
                      <div className="py-0.5">
                        <select id="school-finance-software" className="input-field text-sm"
                          value={schoolForm.finance_software}
                          onChange={e => setSchoolForm(p => ({ ...p, finance_software: e.target.value }))}>
                          {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      <label htmlFor="school-phone" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">טלפון בית הספר:</label>
                      <div className="py-0.5">
                        <input id="school-phone"
                          className={`input-field ${schoolForm.school_phone && schoolPhoneError ? "border-red-400" : ""}`}
                          autoComplete="off" value={schoolForm.school_phone}
                          onChange={e => setSchoolForm(p => ({ ...p, school_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                          dir="ltr" inputMode="numeric" />
                        {schoolForm.school_phone && schoolPhoneError && (
                          <span className="text-xs text-red-500 block mt-0.5" role="alert">{schoolPhoneError}</span>
                        )}
                      </div>

                      <label htmlFor="school-address" className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">כתובת:</label>
                      <div className="py-0.5">
                        <input id="school-address" className="input-field" autoComplete="off" value={schoolForm.address}
                          onChange={e => setSchoolForm(p => ({ ...p, address: e.target.value }))} />
                      </div>
                    </div>
                  </div>

                  {/* Custom divisions — new schools with שש שנתי / אחר */}
                  {!editingSchool && (schoolStage === "sheshshnati" || schoolStage === "other") && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs text-slate-800 font-medium mb-2">חטיבות</p>
                      <div className="flex flex-col gap-2 mb-2">
                        {customDivisions.map((div, idx) => (
                          <div key={div.id} className="flex gap-2 items-center">
                            <label htmlFor={`custom-div-${div.id}`} className="sr-only">סוג חטיבה</label>
                            <select id={`custom-div-${div.id}`} className="input-field text-sm flex-1"
                              value={div.division_type}
                              onChange={e => setCustomDivisions(prev => prev.map((d, i) => i === idx ? { ...d, division_type: e.target.value } : d))}>
                              {DIVISION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>
                            <button type="button"
                              onClick={() => setCustomDivisions(prev => prev.filter((_, i) => i !== idx))}
                              className="text-red-400 hover:text-red-600 text-xl leading-none w-7 flex-shrink-0"
                              aria-label="הסר חטיבה">×</button>
                          </div>
                        ))}
                      </div>
                      <button type="button"
                        onClick={() => setCustomDivisions(prev => [...prev, { id: Date.now(), division_type: "tikkon" }])}
                        className="btn-ghost text-xs px-3 py-1.5">+ הוסף שורה</button>
                      {triedSave && customDivisions.length === 0 && (
                        <p className="text-xs text-red-500 mt-1" role="alert">יש להוסיף לפחות חטיבה אחת</p>
                      )}
                    </div>
                  )}

                  {/* Contact table — אנשי קשר */}
                  <div className="mt-16 mb-2">
                    <p className="text-sm font-semibold text-slate-700 mb-4">אנשי קשר</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th scope="col" className="text-right pb-2 text-xs text-slate-500 font-semibold w-28"></th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">שם</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">טלפון</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">מייל</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">יום חופשי</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-500 font-semibold">אחראי תיאום פגישות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CONTACT_ROWS.map(row => (
                          <tr key={row.nameField} className="border-t border-slate-100">
                            <td className="py-2 pr-1 text-xs text-slate-700 font-medium whitespace-nowrap">{row.label}</td>
                            <td className="py-2 px-2">
                              <label htmlFor={`contact-name-${row.nameField}`} className="sr-only">{row.label} שם</label>
                              <input
                                id={`contact-name-${row.nameField}`}
                                className="input-field text-sm"
                                autoComplete="off"
                                value={schoolForm[row.nameField]}
                                onChange={e => setSchoolForm(p => ({ ...p, [row.nameField]: e.target.value }))}
                                placeholder="שם..."
                              />
                            </td>
                            <td className="py-2 px-2">
                              <label htmlFor={`contact-phone-${row.phoneField}`} className="sr-only">{row.label} טלפון</label>
                              <input
                                id={`contact-phone-${row.phoneField}`}
                                className={`input-field text-sm ${schoolForm[row.phoneField] && validateSecretaryPhone(schoolForm[row.phoneField]) ? "border-red-400" : ""}`}
                                autoComplete="off"
                                value={schoolForm[row.phoneField]}
                                onChange={e => setSchoolForm(p => ({
                                  ...p,
                                  [row.phoneField]: e.target.value.replace(/\D/g, "").slice(0, 10),
                                }))}
                                placeholder="טלפון..."
                                dir="ltr"
                                inputMode="numeric"
                              />
                              {schoolForm[row.phoneField] && validateSecretaryPhone(schoolForm[row.phoneField]) && (
                                <span className="text-xs text-red-500 block mt-0.5" role="alert">{validateSecretaryPhone(schoolForm[row.phoneField])}</span>
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <label htmlFor={`contact-email-${row.emailField}`} className="sr-only">{row.label} מייל</label>
                              <input
                                id={`contact-email-${row.emailField}`}
                                className="input-field text-sm"
                                autoComplete="off"
                                value={schoolForm[row.emailField]}
                                onChange={e => setSchoolForm(p => ({ ...p, [row.emailField]: e.target.value }))}
                                placeholder="מייל..."
                                dir="ltr"
                                type="email"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                                selected={schoolForm[row.dayOffField] || []}
                                onChange={v => setSchoolForm(p => ({ ...p, [row.dayOffField]: v }))} />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <label htmlFor={`admin-coord-${row.coordValue}`} className="sr-only">{row.label} אחראי/ת לתיאום פגישות</label>
                              <input id={`admin-coord-${row.coordValue}`} type="radio" name="admin-meeting-coordinator"
                                className="w-4 h-4 accent-blue-600"
                                checked={schoolForm.meeting_coordinator === row.coordValue}
                                disabled={!schoolForm[row.nameField]}
                                onChange={() => setSchoolForm(p => ({ ...p, meeting_coordinator: row.coordValue }))} />
                            </td>
                          </tr>
                        ))}

                        {/* Extra contact rows */}
                        {(schoolForm.extra_contacts || []).map((ec, i) => (
                          <tr key={`extra-${i}`} className="border-t border-slate-100">
                            <td className="py-1.5 pr-1">
                              <label htmlFor={`extra-role-${i}`} className="sr-only">תפקיד</label>
                              <input id={`extra-role-${i}`} className="input-field text-sm" value={ec.role}
                                onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], role: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                                autoComplete="off" placeholder="תפקיד..." />
                            </td>
                            <td className="py-1.5 px-2">
                              <label htmlFor={`extra-name-${i}`} className="sr-only">שם</label>
                              <input id={`extra-name-${i}`} className="input-field text-sm" value={ec.name}
                                onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], name: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                                autoComplete="off" placeholder="שם..." />
                            </td>
                            <td className="py-1.5 px-2">
                              <label htmlFor={`extra-phone-${i}`} className="sr-only">טלפון</label>
                              <input id={`extra-phone-${i}`} className="input-field text-sm" value={ec.phone}
                                onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], phone: e.target.value.replace(/\D/g, "").slice(0, 10) }; return { ...p, extra_contacts: ec2 }; })}
                                dir="ltr" inputMode="numeric" autoComplete="off" placeholder="טלפון..." />
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1">
                                <label htmlFor={`extra-email-${i}`} className="sr-only">מייל</label>
                                <input id={`extra-email-${i}`} className="input-field text-sm" value={ec.email}
                                  onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], email: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                                  dir="ltr" type="email" autoComplete="off" placeholder="מייל..." />
                                <button type="button"
                                  onClick={() => setSchoolForm(p => {
                                    let coord = p.meeting_coordinator;
                                    if (coord === `extra:${i}`) coord = null;
                                    else if (coord?.startsWith("extra:")) {
                                      const j = Number(coord.split(":")[1]);
                                      if (j > i) coord = `extra:${j - 1}`;
                                    }
                                    return { ...p, extra_contacts: (p.extra_contacts || []).filter((_, j) => j !== i), meeting_coordinator: coord };
                                  })}
                                  className="text-slate-400 hover:text-red-500 flex-shrink-0 mr-1 text-base leading-none"
                                  aria-label="הסר שורת איש קשר">✕</button>
                              </div>
                            </td>
                            <td className="py-1.5 px-2">
                              <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                                selected={ec.day_off || []}
                                onChange={v => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], day_off: v }; return { ...p, extra_contacts: ec2 }; })} />
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <label htmlFor={`admin-coord-extra-${i}`} className="sr-only">איש קשר נוסף {i + 1} אחראי/ת לתיאום פגישות</label>
                              <input id={`admin-coord-extra-${i}`} type="radio" name="admin-meeting-coordinator"
                                className="w-4 h-4 accent-blue-600"
                                checked={schoolForm.meeting_coordinator === `extra:${i}`}
                                disabled={!ec.name}
                                onChange={() => setSchoolForm(p => ({ ...p, meeting_coordinator: `extra:${i}` }))} />
                            </td>
                          </tr>
                        ))}

                        {/* Add contact button */}
                        {(schoolForm.extra_contacts || []).length < 3 && (
                          <tr>
                            <td colSpan={6} className="pt-3 pb-1">
                              <button type="button"
                                onClick={() => setSchoolForm(p => ({ ...p, extra_contacts: [...(p.extra_contacts || []), { role: "", name: "", phone: "", email: "" }] }))}
                                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors">
                                <span aria-hidden="true">+</span> הוסף איש קשר
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {triedSave && !schoolForm.meeting_coordinator && (
                      <p className="text-xs text-red-500 mt-1.5" role="alert">יש לבחור אחראי/ת לתיאום פגישות</p>
                    )}
                  </div>

                  {/* ליווי */}
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-sm font-semibold text-slate-700 mb-4">ליווי</p>
                    <div className="grid grid-cols-2 gap-6">
                      {/* יועצים אחראיים */}
                      <div>
                        <p className="text-xs text-slate-800 mb-2 font-medium">
                          יועצים אחראיים {!editingSchool && <span className="text-red-500">*</span>}
                        </p>
                        {editingSchool ? (
                          <>
                            <AdvisorSearch
                              schoolId={editingSchool.id}
                              selectedIds={draftAdvisorIds}
                              users={users}
                              loadingUsers={loadingUsers}
                              onChange={setDraftAdvisorIds}
                              onRetry={loadUsers}
                              invalid={triedSave && draftAdvisorIds.length === 0}
                            />
                            {triedSave && draftAdvisorIds.length === 0 && (
                              <span className="text-xs text-red-500 mt-1 block" role="alert">יש לבחור לפחות יועץ אחד</span>
                            )}
                          </>
                        ) : (
                          <>
                            <AdvisorSearch
                              schoolId="new"
                              selectedIds={selectedAdvisors}
                              users={users}
                              loadingUsers={loadingUsers}
                              onRetry={loadUsers}
                              invalid={triedSave && selectedAdvisors.length === 0}
                              onChange={newIds => {
                                setSelectedAdvisors(newIds);
                                if (newIds.length === 0) {
                                  setAccessLinkedToAdvisors(false);
                                  setSchoolForm(p => ({ ...p, restrict_access_to: [] }));
                                } else if (selectedAdvisors.length === 0) {
                                  setAccessLinkedToAdvisors(true);
                                }
                              }}
                            />
                            {triedSave && selectedAdvisors.length === 0 && (
                              <span className="text-xs text-red-500 mt-1 block" role="alert">יש לבחור לפחות יועץ אחד</span>
                            )}
                          </>
                        )}
                      </div>

                      {/* גישה */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <p className="text-xs text-slate-800 font-medium">גישה</p>
                          <span
                            title="בחר למי תהיה גישה לצפות בנתוני בית הספר. 'כולם' מאפשר לכל היועצים במערכת לראות את בית הספר."
                            className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-xs flex items-center justify-center flex-shrink-0 cursor-help"
                            aria-label="מידע על הגדרת גישה"
                          >?</span>
                        </div>
                        <AccessSelector
                          restrictTo={schoolForm.restrict_access_to}
                          users={users}
                          loadingUsers={loadingUsers}
                          onChange={val => { setAccessLinkedToAdvisors(false); setSchoolForm(p => ({ ...p, restrict_access_to: val })); }}
                          onSelectAdvisors={() => setAccessLinkedToAdvisors(true)}
                          schoolAdvisors={
                            (editingSchool ? draftAdvisorIds : selectedAdvisors)
                              .map(id => users.find(u => u.id === id)).filter(Boolean)
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3 mt-5">
                    <button onClick={saveSchool} disabled={savingSchool} className={`${editingSchool ? "btn-green-light" : "btn-blue"} text-sm px-5 py-2`}>
                      {savingSchool ? "שומר..." : editingSchool ? "שמור שינויים" : "שמור"}
                    </button>
                    <button onClick={() => { setShowSchoolForm(false); setDraftAdvisorIds(originalAdvisorIds); }} className="btn-ghost text-sm px-5 py-2">ביטול</button>
                  </div>
                </div>
              )}

              {!showSchoolForm && loadingSchools && (
                <div role="status" aria-label="טוען בתי ספר" className="flex justify-center py-10">
                  <div aria-hidden="true" className="spinner w-8 h-8" />
                </div>
              )}

              {!showSchoolForm && (
              <>
              <input ref={adminContractInputRef} type="file" className="hidden" onChange={handleContractFileChange} aria-label="העלאת קובץ חוזה" />

              <TaskListBar />

              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <label htmlFor="admin-schools-search" className="sr-only">חיפוש בתי ספר</label>
                  <input
                    id="admin-schools-search"
                    type="text"
                    value={adminSearchQuery}
                    onChange={e => setAdminSearchQuery(e.target.value)}
                    placeholder="חיפוש לפי שם, סמל או עיר..."
                    className="input-field text-sm w-56"
                  />
                  <div className="relative" ref={adminColPickerRef}>
                    <button type="button" onClick={() => setShowAdminColPicker(o => !o)} className="btn-ghost text-xs px-3 py-1.5"
                      aria-haspopup="true" aria-expanded={showAdminColPicker}>
                      עמודות לתצוגה
                    </button>
                    {showAdminColPicker && (
                      <div className="absolute z-30 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-2 w-64 max-h-96 overflow-y-auto" dir="rtl">
                        {adminColumnCategories.map(cat => (
                          <div key={cat.title} className="px-3 py-1">
                            <p className="text-xs font-semibold text-slate-400 mt-1 mb-1">{cat.title}</p>
                            {cat.cols.map(col => (
                              <label key={col.key} className="flex items-center gap-2 py-1 text-sm text-slate-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!adminColVisible[col.key]}
                                  onChange={() => toggleAdminColVisible(col.key)}
                                  className="w-4 h-4 rounded accent-blue-600"
                                />
                                {col.label}
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <AcademicYearSelector value={adminAcademicYear} onChange={setAdminAcademicYear} />
              </div>

              {schools.some(s => s.status === "pending_deletion") && (
                <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                  🏫 בתי ספר פעילים ({activeAdminSchools.length})
                </h3>
              )}

              <div className="glass-card rounded-2xl overflow-hidden relative mb-3">
                {loadingYearAdminData && sortedAdminSchools.length === 0 ? (
                  <div role="status" aria-label="טוען נתוני ניהול" className="flex justify-center py-10">
                    <div aria-hidden="true" className="spinner w-8 h-8" />
                  </div>
                ) : sortedAdminSchools.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-slate-500">לא נמצאו בתי ספר</p>
                  </div>
                ) : (
                  <div className="overflow-auto dash-scroll-x max-h-[70vh]">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr
                          className="border-b border-slate-200"
                          style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" }}
                        >
                          <th scope="col" className="text-right px-5 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap"
                            style={{ position: "sticky", right: 0, zIndex: 11, background: "rgba(241,245,249,0.97)", minWidth: "14rem" }}>שם מוסד</th>
                          {visibleAdminColOrder.map((key, i) => {
                            const col = ADMIN_ALL_COLUMNS.find(c => c.key === key);
                            const isLast = i === visibleAdminColOrder.length - 1;
                            const isSorted = adminSortKey === key;
                            const filterType = getAdminColumnFilterType(key);
                            const isFiltered = adminColumnFilterActiveKeys.includes(key);
                            return (
                              <th key={key} scope="col"
                                className={`text-right px-4 py-3 font-semibold select-none text-slate-900 whitespace-nowrap ${isLast ? "" : "border-l border-slate-200"}`}>
                                <div className="flex items-center gap-1">
                                  <button type="button" onClick={() => toggleAdminSort(key)}
                                    className={`flex items-center gap-1 hover:text-blue-600 ${isSorted ? "text-blue-600" : ""}`}>
                                    <span className="whitespace-nowrap">{col.label}</span>
                                    {isSorted && (
                                      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        {adminSortDir === "asc" ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
                                      </svg>
                                    )}
                                  </button>
                                  {filterType && (
                                    <div className="relative">
                                      <button type="button"
                                        onClick={() => setOpenAdminFilterKey(o => o === key ? null : key)}
                                        className={`p-0.5 rounded hover:bg-slate-200 ${isFiltered ? "text-blue-600" : "text-slate-400"}`}
                                        aria-label={`סינון לפי ${col.label}`}
                                        aria-haspopup="true"
                                        aria-expanded={openAdminFilterKey === key}
                                      >
                                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                          <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
                                        </svg>
                                      </button>
                                      {openAdminFilterKey === key && (
                                        <div ref={adminFilterPopoverRef}
                                          className="absolute z-30 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-56 font-normal normal-case" dir="rtl">
                                          <AdminColumnFilterPopover
                                            colKey={key}
                                            colLabel={col.label}
                                            filterType={filterType}
                                            spec={adminColumnFilters[key]}
                                            onChange={spec => setAdminColumnFilters(prev => ({ ...prev, [key]: spec }))}
                                            onClear={() => setAdminColumnFilters(prev => { const next = { ...prev }; delete next[key]; return next; })}
                                            onClose={() => setOpenAdminFilterKey(null)}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                          <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold whitespace-nowrap">פעולות</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAdminSchools.map(school => {
                          const yad = yearAdminData[school.id] || {};
                          const rowKey = `${school.id}-${adminAcademicYear}`;
                          return (
                            <Fragment key={school.id}>
                              <tr className="group border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                <td className="px-5 py-3 border-l border-slate-100 bg-white group-hover:bg-slate-50 whitespace-nowrap"
                                  style={{ position: "sticky", right: 0, zIndex: 5, minWidth: "14rem" }}>
                                  <span className="font-semibold text-slate-900">{school.name}</span>
                                </td>
                                {visibleAdminColOrder.map((key, i) => {
                                  const isLast = i === visibleAdminColOrder.length - 1;
                                  const tdClass = `px-4 py-2 text-slate-600 ${isLast ? "" : "border-l border-slate-100"}`;
                                  if (key === "symbol") return <td key={key} className={tdClass}><span className="font-mono">{school.symbol || "—"}</span></td>;
                                  if (key === "city") return <td key={key} className={tdClass}>{school.city || "—"}</td>;
                                  if (key === "authority") return <td key={key} className={tdClass}>{school.authority || "—"}</td>;
                                  if (key === "stage") return <td key={key} className={tdClass}>{ADMIN_SCHOOL_STAGE_LABEL[school.stage] || school.stage || "—"}</td>;
                                  if (key === "meetings_completed") return <td key={key} className={tdClass}>{school.meetings_stats ? String(school.meetings_stats.completed) : "—"}</td>;
                                  if (key === "meetings_hours") return <td key={key} className={tdClass}>{school.meetings_stats ? formatAdminMeetingHours(school.meetings_stats.total_minutes) : "—"}</td>;
                                  if (key === "service_type") return (
                                    <td key={key} className={tdClass}>
                                      <label htmlFor={`svc-${rowKey}`} className="sr-only">סוג שירות</label>
                                      <select id={`svc-${rowKey}`} className={`${ADMIN_FIELD_CLS} w-28`}
                                        value={yad.service_type || ""}
                                        onChange={e => saveYearAdminField(school.id, "service_type", e.target.value || null)}>
                                        <option value="">בחר</option>
                                        {SERVICE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                      </select>
                                    </td>
                                  );
                                  if (key === "order_method") return (
                                    <td key={key} className={tdClass}>
                                      <MultiSelectChips key={rowKey} compact className="w-36" options={FUNDING_METHOD_OPTIONS}
                                        selected={yad.order_method || []}
                                        onChange={v => saveYearAdminField(school.id, "order_method", v.length ? v : null)} />
                                    </td>
                                  );
                                  if (key === "order_amount_gefen") return (
                                    <td key={key} className={tdClass}>
                                      <input
                                        key={rowKey}
                                        type="text"
                                        inputMode="numeric"
                                        defaultValue={formatAmount(yad.order_amount_gefen)}
                                        onBlur={e => {
                                          const v = parseAmount(e.target.value);
                                          e.target.value = formatAmount(v);
                                          if (v !== (yad.order_amount_gefen ?? null)) saveYearAdminField(school.id, "order_amount_gefen", v);
                                        }}
                                        title={yad.order_amount_gefen_updated_by_name ? `${yad.order_amount_gefen_updated_by_name} - ${formatUpdatedAt(yad.order_amount_gefen_updated_at)}` : ""}
                                        aria-label="גובה הזמנה"
                                        className={`${ADMIN_FIELD_CLS} w-24`}
                                      />
                                    </td>
                                  );
                                  if (["requested_price", "hours_ordered", "rate", "payment_received", "payment_requests_sent", "receipts_sent"].includes(key)) return (
                                    <td key={key} className={tdClass}>
                                      <input
                                        key={rowKey}
                                        type="number"
                                        defaultValue={yad[key] ?? ""}
                                        onBlur={e => {
                                          const v = e.target.value === "" ? null : Number(e.target.value);
                                          if (v !== (yad[key] ?? null)) saveYearAdminField(school.id, key, v);
                                        }}
                                        aria-label={ADMIN_DATA_COLUMNS.find(c => c.key === key)?.label}
                                        className={`${ADMIN_FIELD_CLS} no-spinner w-24`}
                                      />
                                    </td>
                                  );
                                  if (key === "contract_sent" || key === "contract_received") return (
                                    <td key={key} className={tdClass}>
                                      <label htmlFor={`${key}-${rowKey}`} className="sr-only">{ADMIN_DATA_COLUMNS.find(c => c.key === key)?.label}</label>
                                      <select id={`${key}-${rowKey}`} className={`${ADMIN_FIELD_CLS} w-20`}
                                        value={yad[key] === true ? "yes" : yad[key] === false ? "no" : ""}
                                        onChange={e => saveYearAdminField(school.id, key, e.target.value === "yes" ? true : e.target.value === "no" ? false : null)}>
                                        <option value="">—</option>
                                        <option value="yes">כן</option>
                                        <option value="no">לא</option>
                                      </select>
                                    </td>
                                  );
                                  if (key === "contract_file") return (
                                    <td key={key} className={tdClass}>
                                      {yad.contract_file_name ? (
                                        <div className="flex items-center gap-2">
                                          <button type="button" onClick={() => downloadContractFile(school.id)} className="text-xs text-blue-600 hover:underline truncate max-w-[100px]">
                                            {yad.contract_file_name}
                                          </button>
                                          <button type="button" onClick={() => openContractUpload(school.id)} className="text-xs text-slate-400 hover:text-slate-600">החלף</button>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => openContractUpload(school.id)} className="btn-ghost text-xs px-2 py-1">העלה קובץ</button>
                                      )}
                                    </td>
                                  );
                                  return <td key={key} className={tdClass}>—</td>;
                                })}
                                <td className="px-4 py-2">
                                  <div className="flex gap-2">
                                    <button onClick={() => toggleExpand(school)} className="btn-ghost text-xs px-3 py-1.5">
                                      {expandedSchool === school.id ? "סגור" : "חטיבות"}
                                    </button>
                                    <button onClick={() => startEdit(school)} className="btn-ghost text-xs px-3 py-1.5">✏️ ערוך</button>
                                  </div>
                                </td>
                              </tr>
                              {expandedSchool === school.id && (
                                <tr className="border-b border-slate-100 bg-slate-50/70">
                                  <td colSpan={visibleAdminColOrder.length + 2} className="px-6 py-4">
                                    <p className="text-xs text-slate-800 mb-3 font-medium">חטיבות / חשבונות גפן</p>
                                    <div className="flex flex-col gap-2 mb-4">
                                      {(schoolAccounts[school.id] || []).length === 0 && (
                                        <p className="text-sm text-slate-400">אין חטיבות מוגדרות</p>
                                      )}
                                      {(schoolAccounts[school.id] || []).map(acc => (
                                        <div key={acc.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                                          <div className="flex items-center justify-between px-4 py-2.5">
                                            <span className="text-sm font-medium text-slate-800">
                                              {acc.custom_label || DIVISION_OPTIONS.find(d => d.value === acc.division_type)?.label || acc.division_type}
                                            </span>
                                            <div className="flex gap-2 items-center">
                                              {acc.finance_software && (
                                                <span className="text-xs text-slate-800">{FINANCE_SOFTWARE_OPTIONS.find(o => o.value === acc.finance_software)?.label}</span>
                                              )}
                                              {acc.tmura_model && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">מודל תמרוץ</span>
                                              )}
                                              <button onClick={() => editingAccount === acc.id ? setEditingAccount(null) : startEditAccount(acc)} className="text-xs text-blue-500 hover:text-blue-600">✏️</button>
                                              <button onClick={() => deleteAccount(school.id, acc.id)} className="text-xs text-red-500 hover:text-red-600">הסר</button>
                                            </div>
                                          </div>
                                          {editingAccount === acc.id && (
                                            <div className="px-4 pb-3 pt-1 border-t border-slate-100 bg-slate-50/60 flex gap-3 items-end flex-wrap">
                                              <div className="flex flex-col gap-1">
                                                <label htmlFor={`fs-${acc.id}`} className="text-xs text-slate-800">תוכנת כספים</label>
                                                <select id={`fs-${acc.id}`} className="input-field text-sm"
                                                  value={accountForm.finance_software}
                                                  onChange={e => setAccountForm(p => ({ ...p, finance_software: e.target.value }))}>
                                                  {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                              </div>
                                              <div className="flex items-center gap-2 pb-1">
                                                <input type="checkbox" id={`tmura-${acc.id}`}
                                                  checked={accountForm.tmura_model}
                                                  onChange={e => setAccountForm(p => ({ ...p, tmura_model: e.target.checked }))}
                                                  className="w-4 h-4 rounded" />
                                                <label htmlFor={`tmura-${acc.id}`} className="text-sm text-slate-700">עמד במודל התמרוץ</label>
                                              </div>
                                              <button onClick={() => saveAccount(school.id, acc.id)} className="btn-blue text-xs px-3 py-1.5">שמור</button>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                    <div className="flex gap-2">
                                      <label htmlFor={`division-select-${school.id}`} className="sr-only">סוג חטיבה</label>
                                      <select id={`division-select-${school.id}`} value={newDivision} onChange={e => setNewDivision(e.target.value)} className="input-field text-sm flex-1">
                                        {DIVISION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                                      </select>
                                      <button onClick={() => addAccount(school.id)} className="btn-blue text-sm px-4 py-2">+ הוסף</button>
                                    </div>

                                    <div className="mt-4 pt-3 border-t border-slate-100">
                                      <p className="text-xs text-slate-800 mb-2 font-medium">יועצים מוקצים</p>
                                      <AdvisorSearch
                                        schoolId={school.id}
                                        selectedIds={(schoolAdvisors[school.id] || []).map(a => a.id)}
                                        users={users}
                                        loadingUsers={loadingUsers}
                                        onChange={newIds => handleExpandedAdvisorChange(school.id, newIds)}
                                        onRetry={loadUsers}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {schools.some(s => s.status === "pending_deletion") && (
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                    🗑️ סל מחזור ({schools.filter(s => s.status === "pending_deletion").length})
                  </h3>
                  <div className="flex flex-col gap-3">
                    {schools.filter(s => s.status === "pending_deletion").map(school => {
                      const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(school.deleted_at)) / 86400000));
                      return (
                        <div key={school.id} className="glass-card rounded-2xl overflow-hidden opacity-50 grayscale">
                          <div className="flex items-center justify-between px-6 py-4 gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="font-bold text-slate-900">{school.name}</span>
                                {school.symbol && <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">סמל {school.symbol}</span>}
                                {school.city && <span className="text-xs text-slate-800">{school.city}</span>}
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">מיועד למחיקה</span>
                                <span className="text-xs text-slate-500">{daysLeft} ימים נותרו</span>
                              </div>
                            </div>
                            {myRole === "owner" && (
                              <button
                                onClick={() => restoreSchool(school.id)}
                                className="btn-ghost text-xs px-3 py-1.5 text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
                                aria-label={`שחזר את ${school.name}`}
                              >
                                שחזר
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </>
              )}
            </div>
          )}

          {/* Users Tab */}
          {activeTab === "users" && (
            <div>
              {(myRole === "owner" || canInviteUsers) && (
                <>
                  <div className="flex justify-end mb-4">
                    <input ref={userImportRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUserImport} aria-label="ייבוא משתמשים מאקסל" />
                    <button onClick={() => userImportRef.current?.click()} disabled={importingUsers} className="btn-ghost text-sm px-4 py-2">
                      {importingUsers ? (userImportProgressMsg || "מייבא...") : "ייבוא מאקסל"}
                    </button>
                  </div>

                  {userImportResult && (
                    <div className={`glass-card rounded-xl p-4 mb-4 border ${userImportResult.errors.length > 0 ? "border-orange-200" : "border-green-200"}`}>
                      <p className="font-medium text-slate-800 text-sm">
                        {userImportResult.imported > 0 ? `הוזמנו ${userImportResult.imported} משתמשים בהצלחה` : "לא הוזמנו משתמשים"}
                        {userImportResult.errors.length > 0 && ` · ${userImportResult.errors.length} שגיאות`}
                      </p>
                      {userImportResult.errors.map((e, i) => <p key={i} className="text-red-500 text-xs mt-1">{e}</p>)}
                    </div>
                  )}

                  <div className="glass-card rounded-2xl p-6 mb-6">
                    <h3 className="font-bold text-slate-800 mb-4">הזמן משתמש חדש</h3>
                    <div className="grid grid-cols-5 gap-4 items-end">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="invite-name" className="text-xs text-slate-800">שם מלא *</label>
                        <input id="invite-name" className="input-field" value={inviteForm.full_name}
                          onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))} placeholder="שם מלא" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="invite-email" className="text-xs text-slate-800">אימייל *</label>
                        <input id="invite-email" className="input-field" type="email" dir="ltr" value={inviteForm.email}
                          onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="invite-role" className="text-xs text-slate-800">תפקיד</label>
                        <select id="invite-role" className="input-field text-sm" value={inviteForm.role}
                          onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}>
                          <option value="advisor">יועץ</option>
                          <option value="manager">מנהל</option>
                          {myRole === "owner" && <option value="owner">בעלים</option>}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-slate-800">תחומי שליטה</span>
                        <MultiSelectChips neutral options={DOMAIN_OPTIONS}
                          selected={inviteForm.control_domains}
                          onChange={v => setInviteForm(p => ({ ...p, control_domains: v }))}
                          placeholder="בחר תחומים" />
                      </div>
                      <button onClick={inviteUser} disabled={!inviteForm.email || !inviteForm.full_name || inviting} className="btn-blue text-sm px-5 py-2">
                        {inviting ? "שולח..." : "שלח הזמנה"}
                      </button>
                    </div>
                    {inviteMsg && (
                      <div className="mt-3">
                        <span className={`text-sm ${inviteMsg.includes("שגיאה") ? "text-red-500" : "text-green-600"}`}>{inviteMsg}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {loadingUsers && (
                <div role="status" aria-label="טוען משתמשים" className="flex justify-center py-10">
                  <div aria-hidden="true" className="spinner w-8 h-8" />
                </div>
              )}

              {roleError && (
                <p role="alert" className="text-sm text-red-600 font-medium bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">
                  {roleError}
                </p>
              )}

              <div className="glass-card rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">שם</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">אימייל</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">תפקיד</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">סטטוס</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">תחומי שליטה</th>
                      <th scope="col" className="px-5 py-3 text-center text-slate-500 font-medium whitespace-nowrap">הרשאות בהתאמה אישית</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByRole(users).map(u => (
                      <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 whitespace-nowrap">
                          {editingUser?.id === u.id ? (
                            <div className="flex items-center gap-2">
                              <label htmlFor={`edit-name-${u.id}`} className="sr-only">שם מלא</label>
                              <input id={`edit-name-${u.id}`} autoFocus className="input-field text-sm"
                                value={editingUserName}
                                onChange={e => setEditingUserName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveEditUser(); if (e.key === "Escape") setEditingUser(null); }}
                              />
                              <button onClick={saveEditUser} disabled={savingUser} className="btn-blue text-xs px-3 py-1.5 flex-shrink-0">
                                {savingUser ? "..." : "שמור"}
                              </button>
                              <button onClick={() => setEditingUser(null)} className="btn-ghost text-xs px-3 py-1.5 flex-shrink-0">ביטול</button>
                            </div>
                          ) : (
                            <span className="text-slate-900">{u.full_name || "—"}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap" dir="ltr">{u.email}</td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <label htmlFor={`role-${u.id}`} className="sr-only">תפקיד {u.full_name || u.email}</label>
                            <select id={`role-${u.id}`} value={u.role}
                              onChange={e => requestRoleChange(u, e.target.value)}
                              disabled={canChangeRole !== true || (myRole === "manager" && u.role === "owner") || (myRole === "manager" && u.id === myUserId)}
                              title={
                                myRole === "manager" && u.id === myUserId ? "מנהל לא יכול לשנות את תפקיד עצמו" :
                                canChangeRole !== true ? "אין הרשאה לשנות תפקידים" :
                                myRole === "manager" && u.role === "owner" ? "מנהל לא יכול לשנות תפקיד של בעלים" :
                                undefined
                              }
                              className={`text-sm text-slate-700 border border-slate-200 rounded-lg px-2 py-1 bg-white ${canChangeRole !== true || (myRole === "manager" && u.role === "owner") || (myRole === "manager" && u.id === myUserId) ? "opacity-40 cursor-not-allowed" : ""}`}>
                              <option value="advisor">יועץ</option>
                              <option value="manager">מנהל</option>
                              {(myRole === "owner" || u.role === "owner") && <option value="owner">בעלים</option>}
                            </select>
                          </div>
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {u.status === "pending" ? (
                            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                              style={{ background: "rgba(245,158,11,0.12)", color: "#b45309" }}>
                              ממתין לאישור
                            </span>
                          ) : (
                            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                              style={{ background: "rgba(34,197,94,0.12)", color: "#15803d" }}>
                              רשום
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <MultiSelectChips compact options={DOMAIN_OPTIONS}
                            selected={u.control_domains || []}
                            onChange={v => saveUserDomains(u, v)}
                            placeholder="בחר תחומים"
                            emptyIcon />
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap relative">
                          <div className={`flex gap-1 items-center justify-center ${(myRole === "owner" || canDeleteUsers) ? "pl-9" : ""}`}>
                            {u.status === "pending" && (
                              <>
                                <button
                                  onClick={() => resendInvite(u)}
                                  disabled={resendingUserId === u.id}
                                  className="text-xs px-3 py-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40"
                                >
                                  {resendingUserId === u.id ? "שולח..." : "שלח מחדש"}
                                </button>
                                {resendMsg?.id === u.id && (
                                  <span className={`text-xs font-medium ${resendMsg.ok ? "text-green-600" : "text-red-500"}`}>
                                    {resendMsg.ok ? "✓ נשלח" : "שגיאה"}
                                  </span>
                                )}
                              </>
                            )}
                            {u.role !== "owner" && (
                              <button onClick={() => openOverridePanel(u)}
                                aria-label={`הרשאות אישיות: ${u.full_name || u.email}`}
                                className="text-xs px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5">
                                {overrideCounts[u.id] > 0 && (
                                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-blue-500 text-white rounded-full leading-none">
                                    {overrideCounts[u.id]}
                                  </span>
                                )}
                                הוסף
                              </button>
                            )}
                          </div>
                          {(myRole === "owner" || canDeleteUsers) && (
                            <div className="absolute left-2 top-1/2 -translate-y-1/2" onClick={e => e.stopPropagation()}>
                              <div className="relative">
                                <button
                                  onClick={() => setOpenActionsMenu(openActionsMenu === u.id ? null : u.id)}
                                  aria-label="פעולות נוספות"
                                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                                >
                                  <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                                  </svg>
                                </button>
                                {openActionsMenu === u.id && (
                                  <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-slate-100 py-1 min-w-[80px]">
                                    <button
                                      onClick={() => handleDeleteButtonClick(u)}
                                      className="w-full text-right px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                                    >מחק</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* Billing Tab */}
          {activeTab === "billing" && (
            <div>
              {loadingUsers && billingMonths.length === 0 ? (
                <div role="status" aria-label="טוען נתוני חיובים" className="flex justify-center py-16">
                  <div aria-hidden="true" className="spinner w-8 h-8" />
                </div>
              ) : (
                <>
                  {/* Month sub-tabs */}
                  <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto" role="tablist" aria-label="בחירת חודש חיוב">
                    {billingMonths.map(({ key, label }) => (
                      <button
                        key={key}
                        role="tab"
                        aria-selected={activeBillingMonth === key}
                        onClick={() => setBillingMonthTab(key)}
                        className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-all ${
                          activeBillingMonth === key
                            ? "border-blue-600 text-blue-600 font-semibold"
                            : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Month content */}
                  {activeBillingMonth && (
                    <div className="glass-card rounded-2xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">תקופת חיוב</th>
                            <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">מספר בתי ספר</th>
                            <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">חיוב</th>
                            <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">אמצעי תשלום</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const found = billingMonths.find(m => m.key === activeBillingMonth);
                            const data = billingData[activeBillingMonth];
                            return (
                              <tr className="border-b border-slate-50">
                                <td className="px-5 py-4 text-slate-700 font-medium">{found?.label ?? activeBillingMonth}</td>
                                <td className="px-5 py-4 text-slate-400">{data?.school_count != null ? data.school_count : "—"}</td>
                                <td className="px-5 py-4 text-slate-400">{data?.billing_amount != null ? `₪${data.billing_amount.toLocaleString("he-IL")}` : "—"}</td>
                                <td className="px-5 py-4 text-slate-400">{data?.payment_method ?? "—"}</td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Meetings Tab */}
          {activeTab === "meetings" && (
            <AdminMeetingsTab
              ref={adminMeetingsRef}
              users={users}
              loadingUsers={loadingUsers}
              loadUsers={loadUsers}
              canDeleteMeetings={canDeleteMeetings}
              onIncompleteChange={setMeetingsGuardActive}
            />
          )}

          {/* Calls Tab */}
          {activeTab === "calls" && showCallsTab && (
            <AdminCallsTab users={users} />
          )}

          {/* Integrations Tab */}
          {activeTab === "integrations" && showIntegrationsTab && (
            <AdminIntegrationsTab />
          )}

          {/* Permissions Tab */}
          {activeTab === "permissions" && (
            <div>
              {permError && <div role="alert" className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{permError}</div>}
              {permLoading ? (
                <div role="status" aria-label="טוען הרשאות" className="flex justify-center py-16">
                  <div aria-hidden="true" className="spinner w-8 h-8" />
                </div>
              ) : permDefaults && (() => {
                function PermToggle({ role, perm, data }) {
                  const key = `${role}_${perm}`;
                  const saving = permSaving[key];
                  const deleteBlocked = perm === "can_delete_schools" && role === "manager" && !permDefaults.can_edit_school_directly?.[role];
                  const requestBlocked = perm === "can_request_school_update" && permDefaults.can_edit_school_directly?.[role] === true;
                  const advisorNA = role === "advisor" && ADVISOR_NA_PERMS.has(perm);
                  const noPermEdit = myRole === "manager" && !canManagePermissions;
                  const editBlocked = deleteBlocked;
                  const allowed = editBlocked ? false : data[role];
                  const disabled = saving || editBlocked || noPermEdit;
                  if (requestBlocked || advisorNA) {
                    return <span className="text-xs text-slate-400 italic">לא רלוונטי</span>;
                  }
                  return (
                    <div
                      role="group"
                      aria-label={data.label}
                      title={deleteBlocked ? "לא ניתן להפעיל מחיקה כאשר עריכה ישירה מכובה" : undefined}
                      className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
                      style={{ direction: "ltr" }}
                    >
                      <button
                        onClick={() => !disabled && allowed && savePermDefault(role, perm, false)}
                        aria-pressed={!allowed}
                        className={`px-3 py-1.5 transition-colors focus:outline-none ${!allowed ? "bg-red-100 text-red-700" : "bg-white text-slate-400 hover:bg-slate-50"}`}
                      >לא</button>
                      <button
                        onClick={() => !disabled && !allowed && savePermDefault(role, perm, true)}
                        aria-pressed={allowed}
                        className={`px-3 py-1.5 border-r border-slate-200 transition-colors focus:outline-none ${allowed ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50"}`}
                      >כן</button>
                    </div>
                  );
                }


                const colCount = myRole === "owner" ? 3 : 2;
                return (
                  <div className="glass-card rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ backgroundColor: "#1e3a5f" }}>
                          <th scope="col" className="text-right px-5 py-3 font-semibold text-white w-full">הרשאה</th>
                          {myRole === "owner" && (
                            <th scope="col" className="px-5 py-3 font-semibold text-white whitespace-nowrap text-center">מנהל</th>
                          )}
                          <th scope="col" className="px-5 py-3 font-semibold text-white whitespace-nowrap text-center">יועץ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PERM_GROUPS.filter(g => !(myRole === "manager" && g.ownerOnly)).map(group => (
                          <Fragment key={group.label}>
                            <tr>
                              <td colSpan={colCount} className="px-5 pt-6 pb-1.5">
                                <span className="font-bold text-slate-700 border-b border-slate-200 pb-1 block" style={{ fontSize: "1.4em" }}>{group.label}</span>
                              </td>
                            </tr>
                            {group.perms.map(perm => {
                              const data = permDefaults[perm];
                              if (!data) return null;
                              return (
                                <tr key={perm} className="border-b border-slate-100 hover:bg-slate-50/50">
                                  <td className="px-5 py-3 text-slate-700">{data.label}</td>
                                  {myRole === "owner" && (
                                    <td className="px-5 py-3 text-center">
                                      <PermToggle role="manager" perm={perm} data={data} />
                                    </td>
                                  )}
                                  <td className="px-5 py-3 text-center">
                                    {group.advisorNA.has(perm)
                                      ? <span className="text-xs text-slate-400 italic">לא רלוונטי</span>
                                      : <PermToggle role="advisor" perm={perm} data={data} />
                                    }
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {importMappingData && (
        <ImportMappingModal
          headers={importMappingData.headers}
          previewRow={importMappingData.previewRow}
          totalRows={importMappingData.dataRows.length}
          fieldConfig={IMPORT_FIELD_CONFIG}
          confirmLabel={`ייבא ${importMappingData.dataRows.length} בתי ספר`}
          onConfirm={confirmImport}
          onCancel={() => setImportMappingData(null)}
        />
      )}
      {userImportMappingData && (
        <ImportMappingModal
          headers={userImportMappingData.headers}
          previewRow={userImportMappingData.previewRow}
          totalRows={userImportMappingData.dataRows.length}
          fieldConfig={USER_IMPORT_FIELD_CONFIG}
          confirmLabel={`הזמן ${userImportMappingData.dataRows.length} משתמשים`}
          onConfirm={confirmUserImport}
          onCancel={() => setUserImportMappingData(null)}
        />
      )}
      {showDeleteConfirm && editingSchool && (
        <DeleteConfirmModal
          title="מחיקת בית ספר"
          subtitle={editingSchool.name}
          message="מחיקת בית הספר תגרום למחיקת כלל הנתונים עליו."
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setShowDeleteConfirm(false)}
          confirming={deletingSchool}
        />
      )}
      {recycleInfoSchoolName && (
        <RecycleBinInfoModal
          schoolName={recycleInfoSchoolName}
          onClose={() => setRecycleInfoSchoolName(null)}
        />
      )}
      {restoreSuccessSchoolName && (
        <RestoreSuccessModal
          schoolName={restoreSuccessSchoolName}
          onClose={() => setRestoreSuccessSchoolName(null)}
        />
      )}
      {userToDelete && (
        <DeleteConfirmModal
          title="מחיקת משתמש"
          subtitle={userToDelete.full_name || userToDelete.email}
          message="מחיקת המשתמש תסיר את גישתו למערכת לצמיתות."
          error={userDeleteError}
          onConfirm={handleDeleteUser}
          onCancel={() => { setUserToDelete(null); setUserDeleteError(""); }}
          confirming={confirmingUserDelete}
        />
      )}
      {userMeetingsConflict && (
        <UserMeetingsConflictModal
          targetUser={userMeetingsConflict.user}
          meetings={userMeetingsConflict.meetings}
          otherUsers={users.filter(u => u.id !== userMeetingsConflict.user.id)}
          onClose={() => setUserMeetingsConflict(null)}
          onResolved={() => {
            const u = userMeetingsConflict.user;
            setUserMeetingsConflict(null);
            checkSoleSchoolsThenDelete(u);
          }}
        />
      )}
      {userSchoolsConflict && (
        <UserSchoolsConflictModal
          targetUser={userSchoolsConflict.user}
          schools={userSchoolsConflict.schools}
          otherUsers={users.filter(u => u.id !== userSchoolsConflict.user.id)}
          onClose={() => setUserSchoolsConflict(null)}
          onResolved={() => {
            const u = userSchoolsConflict.user;
            setUserSchoolsConflict(null);
            setUserToDelete(u);
          }}
        />
      )}
      {blocker.state === "blocked" && meetingsGuardActive && (
        <MeetingNavigationGuardModal
          missingFields={adminMeetingsRef.current?.getMissingFields?.() || []}
          busy={meetingGuardBusy}
          onStay={() => blocker.reset?.()}
          onSaveAndLeave={() => blocker.proceed?.()}
          onDiscardAndLeave={async () => {
            setMeetingGuardBusy(true);
            await adminMeetingsRef.current?.discardIncompleteMeetings?.();
            setMeetingGuardBusy(false);
            blocker.proceed?.();
          }}
        />
      )}
      {blocker.state === "blocked" && !meetingsGuardActive && (
        <UnsavedChangesModal
          onSave={handleSaveAndProceed}
          onDiscard={handleDiscardAndProceed}
          onCancel={() => blocker.reset?.()}
          saving={blockSaving}
        />
      )}

      {/* Per-user permissions override modal */}
      {overrideUser && permDefaults && (
        <UserPermissionsModal
          user={overrideUser}
          permDefaults={permDefaults}
          overrides={overrides}
          loading={overrideLoading}
          saving={overrideSaving}
          onSave={saveOverride}
          onClose={() => setOverrideUser(null)}
        />
      )}

      {roleChangeConfirm && (
        <RoleChangeConfirmModal
          userName={roleChangeConfirm.userName}
          oldRole={roleChangeConfirm.oldRole}
          newRole={roleChangeConfirm.newRole}
          onConfirm={confirmRoleChange}
          onCancel={() => setRoleChangeConfirm(null)}
        />
      )}

      {showAgentWidget && (
        <AgentChatWidget
          activeTab={activeTab}
          setAdminColumnFilters={setAdminColumnFilters}
          setAdminSearchQuery={setAdminSearchQuery}
          setAdminSortKey={setAdminSortKey}
          setAdminSortDir={setAdminSortDir}
          adminMeetingsRef={adminMeetingsRef}
          onNavigateToTab={setActiveTab}
        />
      )}
    </div>
  );
}
