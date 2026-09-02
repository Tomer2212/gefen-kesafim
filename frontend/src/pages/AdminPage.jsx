import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import { Building2, Phone, Handshake, UsersRound } from "lucide-react";
import Sidebar from "../components/Sidebar";

// ── Shared visual language with SchoolPage.jsx's "פרטי בית הספר" tab ──
const SECTION_TITLE_CLS = "text-[23px] font-bold text-black flex items-center gap-2";
function sectionIcon(Icon, accentCls) {
  return (
    <span aria-hidden="true" className={`inline-flex items-center justify-center p-2 rounded-xl flex-shrink-0 ${accentCls}`}>
      <Icon className="w-4 h-4" strokeWidth={2} />
    </span>
  );
}
function sectionTitle(Icon, text, accentCls) {
  return <p className={SECTION_TITLE_CLS}>{text}{sectionIcon(Icon, accentCls)}</p>;
}
const SECTION_HEADER_CLS = "flex items-center justify-between pb-3 mb-4 border-b border-slate-200/60";
const TILE_CLS = "bg-slate-100/70 border border-slate-200/90 rounded-xl py-3.5 px-3 min-h-[76px]";
const TILE_LABEL_CLS = "text-[13px] font-medium text-gray-500 mb-1 block";
const OUTLINE_BTN_CLS = "border border-slate-300 hover:border-slate-400 text-slate-700 bg-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-all";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ImportMappingModal } from "../components/ImportMappingModal";
import { SchoolImportProblemsModal } from "../components/SchoolImportProblemsModal";
import { supabase } from "../lib/supabase";
import AdminCallsTab from "./AdminCallsTab";
import AdminCollectionTab from "./AdminCollectionTab";
import AdminPerformanceTab from "./AdminPerformanceTab";
import AdminIntegrationsTab from "./AdminIntegrationsTab";
import AdminMeetingsTab from "./AdminMeetingsTab";
import AdminAttendanceTab from "./AdminAttendanceTab";
import AgentChatWidget from "../components/AgentChatWidget";
import UserMeetingsConflictModal from "./UserMeetingsConflictModal";
import { SchoolNotesModal } from "../components/SchoolNotesModal";
import UserSchoolsConflictModal from "./UserSchoolsConflictModal";
import MeetingNavigationGuardModal from "../components/meetings/MeetingNavigationGuardModal";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import { DOMAIN_OPTIONS } from "../constants/domains";
import { CONTROL_LETTER_STATUS_MAP } from "../components/controlLetter/constants";
import { MEETING_SERVICE_TYPE_BREAKDOWN_COL_ORDER } from "../components/meetings/constants";
import { AdvisorSearch } from "../components/AdvisorSearch";
import HourMinuteInput from "../components/HourMinuteInput";
import { AccessSelector } from "../components/AccessSelector";
import AdminTasksTab from "./AdminTasksTab";

// Plain-text-looking single-select dropdown (portal-based, like MultiSelectChips) used for the
// "תפקיד" column — looks like static text until clicked, opens a wide modern popover instead of
// the browser's native <select> list.
function RoleSelect({ value, options, onChange, disabled, title, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width * 1.3 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`text-sm text-slate-900 bg-transparent border-0 p-0 m-0 text-right ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:text-blue-600"}`}
      >
        {current ? current.label : value}
      </button>
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] border border-slate-200 rounded-2xl bg-white shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 150) }}
        >
          <div className="py-1.5" role="listbox">
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-right px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors hover:bg-blue-50 ${o.value === value ? "text-blue-600 font-semibold bg-blue-50/60" : "text-slate-700"}`}
              >
                {o.label}
                {o.value === value && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// Portal-based "..." row actions menu (like RoleSelect above) — rendered into <body> with
// `position: fixed` so it never gets silently clipped/covered by a sibling table row (plain
// `position: absolute` dropdowns nested in the table lose click hit-testing to later DOM
// siblings that also happen to be positioned elements — see MultiSelectChips.jsx for the same
// issue with a different symptom).
function UserActionsMenu({ open, onToggle, onClose, showResend, resending, resendResult, onResend, onDelete, ariaLabel }) {
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = () => onClose();
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [open, onClose]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          role="menu"
          className="fixed z-[9999] bg-white rounded-xl shadow-lg border border-slate-100 py-1 min-w-[120px]"
          style={{ top: pos.top, left: pos.left }}
        >
          {showResend && (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={onResend}
                disabled={resending}
                className="w-full text-right px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40"
              >
                {resending ? "שולח..." : "שלח מחדש"}
              </button>
              {resendResult && (
                <p className={`px-4 pb-1 text-xs font-medium ${resendResult === "ok" ? "text-green-600" : "text-red-500"}`}>
                  {resendResult === "ok" ? "✓ נשלח" : "שגיאה"}
                </p>
              )}
              <div className="border-t border-slate-100 my-1" />
            </>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={onDelete}
            className="w-full text-right px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
          >
            מחק
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

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
// Per-service-type "פגישות/שעות שבוצעו" columns (גפן / שוטף / גפן+שוטף / מחוז / ללא סוג) —
// mirror DashboardPage's MEETING_TYPE_BREAKDOWN_COLUMNS. Off by default here (unlike the rest
// of the admin columns, which default on) — see ADMIN_DEFAULT_COL_VISIBLE below.
const MEETING_TYPE_BREAKDOWN_COLUMNS = MEETING_SERVICE_TYPE_BREAKDOWN_COL_ORDER.flatMap(t => [
  { key: `meetings_completed_${t.key}`, label: `סה"כ פגישות ${t.label} שבוצעו`, breakdownType: t.key, breakdownMetric: "completed" },
  { key: `meetings_hours_${t.key}`,     label: `סה"כ שעות ${t.label} שבוצעו`,   breakdownType: t.key, breakdownMetric: "total_minutes" },
]);
const MEETING_TYPE_BREAKDOWN_COL_META = Object.fromEntries(
  MEETING_TYPE_BREAKDOWN_COLUMNS.map(c => [c.key, c])
);
const MEETING_TYPE_BREAKDOWN_KEYS = MEETING_TYPE_BREAKDOWN_COLUMNS.map(c => c.key);

// Column-picker groups, mirroring DashboardPage's "כללי" / "הקצאות" / "פגישות שבוצעו".
const ADMIN_IDENTITY_COLUMNS = [
  { key: "symbol",             label: "סמל מוסד" },
  { key: "city",                label: "עיר" },
  { key: "authority",           label: "בעלות" },
  { key: "stage",                label: "שלב מוסד" },
  { key: "district",            label: "מחוז" },
  { key: "finance_software",    label: "תוכנת כספים" },
  { key: "advisor_gefen",       label: "יועץ מלווה [גפן]" },
  { key: "advisor_current",     label: "יועץ מלווה [שוטף]" },
  { key: "advisor_district",    label: "יועץ מלווה [מחוז]" },
];
const ADMIN_ALLOCATION_COLUMNS = [
  { key: "meeting_allocation_gefen",   label: "הקצאת פגישות [גפן]" },
  { key: "meeting_allocation_current", label: "הקצאת פגישות [שוטף]" },
  { key: "meeting_allocation_district", label: "הקצאת פגישות [מחוז]" },
  { key: "meeting_duration_gefen",     label: "הקצאת זמן פגישה [גפן]" },
  { key: "meeting_duration_current",   label: "הקצאת זמן פגישה [שוטף]" },
  { key: "meeting_duration_district",  label: "הקצאת זמן פגישה [מחוז]" },
];
const ADMIN_MEETINGS_DONE_COLUMNS = [
  { key: "meetings_completed",  label: 'סה"כ פגישות שבוצעו' },
  { key: "meetings_hours",      label: 'סה"כ שעות שבוצעו' },
  ...MEETING_TYPE_BREAKDOWN_COLUMNS.map(c => ({ key: c.key, label: c.label })),
];

const SERVICE_TYPE_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "current", label: "שוטף" },
  { value: "gefen_current", label: "גפן+שוטף" },
  { value: "district", label: "מחוז" },
];

// The 3 per-service-type "יועץ מלווה [גפן/שוטף/מחוז]" lists (school_advisors_gefen/current/
// district) — same set used on SchoolPage's ליווי sub-sections.
const SERVICE_TYPE_TABS = [
  { key: "gefen", label: "גפן" },
  { key: "current", label: "שוטף" },
  { key: "district", label: "מחוז" },
];

// "אמצעי הזמנה" — multi-select from a closed list (same field shown in ליווי on SchoolPage,
// backed by school_year_admin_data.order_method as a text[] column).
const FUNDING_METHOD_OPTIONS = [
  { value: "private", label: "פרטי" },
  { value: "authority", label: "רשות" },
  { value: "district", label: "מחוז" },
];

const CLIENT_STATUS_OPTIONS = [
  { value: "active", label: "פעיל" },
  { value: "inactive", label: "לא פעיל" },
  { value: "in_progress", label: "בתהליך" },
  { value: "former", label: "לקוח עבר" },
];

// Which of the 3 typed advisor lists are mandatory, given the school's own "סוג שירות" value —
// gefen_current requires both גפן and שוטף advisors to be set. Mirrors SchoolPage.jsx/AddSchoolPage.jsx.
function activeServiceTypes(serviceType) {
  if (serviceType === "gefen") return ["gefen"];
  if (serviceType === "current") return ["current"];
  if (serviceType === "district") return ["district"];
  if (serviceType === "gefen_current") return ["gefen", "current"];
  return [];
}

// New admin/financial columns, per-school-year (stored in school_year_admin_data).
const ADMIN_DATA_COLUMNS = [
  { key: "service_type",          label: "סוג שירות" },
  { key: "requested_price",       label: "מחיר מבוקש" },
  { key: "order_method",          label: "אמצעי הזמנה" },
  { key: "order_amount_gefen",    label: 'מחיר כולל מע"מ' },
  { key: "hours_ordered",         label: "מספר שעות שהוזמנו" },
  { key: "rate",                  label: "תעריף" },
  { key: "payment_received",      label: "תשלום שהתקבל" },
  { key: "payment_requests_sent", label: "דרישות תשלום שנשלחו" },
  { key: "contract_sent",         label: "חוזה נשלח" },
  { key: "contract_received",     label: "חוזה התקבל" },
  { key: "contract_file",         label: "קובץ חוזה" },
  { key: "receipts_sent",         label: "אסמכתאות שנשלחו" },
  { key: "closure_parents_status",   label: "סגירת שנה-הורים" },
  { key: "closure_parents_notes",    label: "הערות סגירה-הורים" },
  { key: "closure_authority_status", label: "סגירת שנה-רשות" },
  { key: "closure_authority_notes",  label: "הערות סגירה-רשות" },
  { key: "quarterly_notes_1", label: "הערות רבעוניות - רבעון 1" },
  { key: "quarterly_notes_2", label: "הערות רבעוניות - רבעון 2" },
  { key: "quarterly_notes_3", label: "הערות רבעוניות - רבעון 3" },
  { key: "quarterly_notes_4", label: "הערות רבעוניות - רבעון 4" },
];

// "מכתב בקרה" columns — sourced from school.control_letters (one fixed row per division,
// embedded on the schools list, same as year_closure). A school may have 2 rows (שש-שנתי);
// this compact table shows a single picked value (see pickPrimaryControlLetter in
// DashboardPage.jsx) and is read-only here — editing happens per-division from the school's
// own "מכתב בקרה" tab, where each division has its own row.
const ADMIN_CONTROL_LETTER_COLUMNS = [
  { key: "control_letter_received_date",  label: "מכתב בקרה - תאריך קבלה" },
  { key: "control_letter_days_to_answer", label: "מכתב בקרה - ימים לתשובה" },
  { key: "control_letter_target_date",    label: "מכתב בקרה - תאריך יעד" },
  { key: "control_letter_status",         label: "מכתב בקרה - סטטוס" },
  { key: "control_letter_notes",          label: "מכתב בקרה - הערות" },
  { key: "control_letter_original_file",  label: "מכתב בקרה - מכתב מקורי" },
  { key: "control_letter_response_file",  label: "מכתב בקרה - מכתב תשובה" },
];

function formatDDMMYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function addDaysISO(iso, days) {
  if (!iso || days === null || days === undefined || days === "") return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Number(days));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Same picking rule as DashboardPage.jsx's pickPrimaryControlLetter — a school may have up
// to 2 control_letters rows (one per division); prefer an "open" one, else the most recent.
function pickPrimaryControlLetter(rows) {
  if (!rows || rows.length === 0) return null;
  const openStatuses = new Set(["in_progress", "problem", "further_fix"]);
  const open = rows.filter(r => openStatuses.has(r.status));
  const pool = open.length ? open : rows;
  return pool.reduce((latest, r) => {
    if (!latest) return r;
    if (!r.received_date) return latest;
    if (!latest.received_date) return r;
    return r.received_date > latest.received_date ? r : latest;
  }, null);
}

function controlLetterFieldValue(school, field) {
  const primary = pickPrimaryControlLetter(school.control_letters);
  if (!primary) return null;
  if (field === "target_date") return addDaysISO(primary.received_date, primary.days_to_answer);
  return primary[field] ?? null;
}

const ADMIN_ALL_COLUMNS = [
  ...ADMIN_IDENTITY_COLUMNS, ...ADMIN_ALLOCATION_COLUMNS, ...ADMIN_MEETINGS_DONE_COLUMNS,
  ...ADMIN_DATA_COLUMNS, ...ADMIN_CONTROL_LETTER_COLUMNS,
];
const ADMIN_DEFAULT_COL_ORDER = ADMIN_ALL_COLUMNS.map(c => c.key);
const ADMIN_DEFAULT_COL_VISIBLE = {
  ...Object.fromEntries(ADMIN_ALL_COLUMNS.map(c => [c.key, true])),
  // The per-service-type meeting breakdown columns are the one exception — hidden by default,
  // opt-in via "עמודות לתצוגה" (matches DashboardPage, where they're also off by default).
  ...Object.fromEntries(MEETING_TYPE_BREAKDOWN_KEYS.map(k => [k, false])),
};
function isKnownAdminColumnKey(k) { return ADMIN_DEFAULT_COL_ORDER.includes(k); }

// Column-filter type map for the admin schools table (ניהול → בתי ספר). "select" columns use
// raw underlying values (not display labels) so the agent/tool layer can target them directly.
const ADMIN_TEXT_FILTER_COLS = new Set([
  "symbol", "city", "authority", "contract_file",
  "quarterly_notes_1", "quarterly_notes_2", "quarterly_notes_3", "quarterly_notes_4",
]);
const ADMIN_NUMBER_FILTER_COLS = new Set([
  "meetings_completed", "meetings_hours", "requested_price", "order_amount_gefen",
  "hours_ordered", "rate", "payment_received", "payment_requests_sent", "receipts_sent",
  "meeting_allocation_gefen", "meeting_allocation_current", "meeting_allocation_district",
  ...MEETING_TYPE_BREAKDOWN_KEYS,
]);
// Advisor-name multi-select filter columns — options are populated dynamically at render
// time from the currently-loaded schools/users (see ADMIN_SELECT_FILTER_OPTIONS usage below).
const ADMIN_ADVISOR_FILTER_COLS = new Set(["advisor_gefen", "advisor_current", "advisor_district"]);
const ADMIN_SELECT_FILTER_OPTIONS = {
  stage: Object.entries(ADMIN_SCHOOL_STAGE_LABEL).map(([value, label]) => ({ value, label })),
  service_type: SERVICE_TYPE_OPTIONS,
  order_method: FUNDING_METHOD_OPTIONS,
  contract_sent: [{ value: "yes", label: "כן" }, { value: "no", label: "לא" }],
  contract_received: [{ value: "yes", label: "כן" }, { value: "no", label: "לא" }],
  closure_parents_status: [{ value: "yes", label: "סגור" }, { value: "no", label: "לא סגור" }],
  closure_authority_status: [{ value: "yes", label: "סגור" }, { value: "no", label: "לא סגור" }],
};
function getAdminColumnFilterType(key) {
  if (ADMIN_TEXT_FILTER_COLS.has(key)) return "text";
  if (ADMIN_NUMBER_FILTER_COLS.has(key)) return "number";
  if (ADMIN_ADVISOR_FILTER_COLS.has(key)) return "select";
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
    case "advisor_gefen": return (school.advisors_gefen || []).map(a => a.id);
    case "advisor_current": return (school.advisors_current || []).map(a => a.id);
    case "advisor_district": return (school.advisors_district || []).map(a => a.id);
    case "contract_sent": case "contract_received":
    case "closure_parents_status": case "closure_authority_status":
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

// Thousands-separated (no decimal) display for amount fields like "מחיר כולל מע"מ" — "" for empty.
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

const PRINCIPAL_TICHON_ROW  = { label: "מנהל/ת חט\"ע", nameField: "principal_name",         phoneField: "principal_phone",         emailField: "principal_email",         dayOffField: "principal_day_off",         coordValue: "principal" };
const PRINCIPAL_SINGLE_ROW  = { label: "מנהל/ת",       nameField: "principal_name",         phoneField: "principal_phone",         emailField: "principal_email",         dayOffField: "principal_day_off",         coordValue: "principal" };
const PRINCIPAL_CHATIVA_ROW = { label: "מנהל/ת חט\"ב", nameField: "principal_chativa_name", phoneField: "principal_chativa_phone", emailField: "principal_chativa_email", dayOffField: "principal_chativa_day_off", coordValue: "principal_chativa" };

const CONTACT_ROWS = [
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

const STUDY_DAY_OPTIONS = [
  ...WEEKDAY_OPTIONS,
  { value: "sat", label: "ש" },
];

const SECTOR_OPTIONS = [
  { value: "", label: "בחר" },
  { value: "יהודי", label: "יהודי" },
  { value: "ערבי", label: "ערבי" },
  { value: "צ'רקסי", label: "צ'רקסי" },
  { value: "בדואי", label: "בדואי" },
  { value: "דרוזי", label: "דרוזי" },
];

const SUPERVISION_OPTIONS = [
  { value: "", label: "בחר" },
  { value: "ממלכתי", label: "ממלכתי" },
  { value: "ממלכתי דתי", label: "ממלכתי דתי" },
  { value: "חרדי", label: "חרדי" },
];

const GRADE_LEVEL_OPTIONS = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "יא", "יב"].map(
  (label) => ({ value: label, label })
);

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

const EMPTY_FORM = { name: "", symbol: "", city: "", authority: "", stage: "", finance_software: "", principal_name: "", principal_phone: "", principal_email: "", secretary_name: "", secretary_phone: "", secretary_email: "", finance_contact_name: "", finance_contact_phone: "", finance_contact_email: "", school_phone: "", address: "", district: "", restrict_access_to: [], extra_contacts: [], principal_day_off: [], secretary_day_off: [], finance_contact_day_off: [], meeting_coordinator: null, principal_chativa_name: "", principal_chativa_phone: "", principal_chativa_email: "", principal_chativa_day_off: [], principal_same_person: true, education_authority: "", sector: "", supervision: "", grade_levels: [], study_days: [], student_count: "" };

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
  { key: "principal_email",       label: "מייל מנהל/ת",           required: false },
  { key: "secretary_name",        label: "שם מנהלנ/ית",          required: false },
  { key: "secretary_phone",       label: "טלפון מנהלנ/ית",       required: false },
  { key: "secretary_email",       label: "מייל מנהלנ/ית",         required: false },
  { key: "finance_contact_name",  label: "שם אחראי/ת כספים",     required: false },
  { key: "finance_contact_phone", label: "טלפון אחראי/ת כספים",  required: false },
  { key: "finance_contact_email", label: "מייל אחראי/ת כספים",    required: false },
  { key: "meeting_coordinator",   label: "מתאם פגישות",           required: true, ranked: 3, hint: "מנהל/ת / מנהלנ/ית / אחראי/ת כספים — או שם/מייל/טלפון של איש קשר. עד 3 עמודות לפי סדר עדיפות (נופל לעמודה הבאה רק כשהתא ריק / שגיאה / 0)" },
  { key: "service_type",          label: "סוג שירות",             required: true, hint: "גפן / שוטף / גפן+שוטף / מחוז" },
  { key: "client_status",         label: "סטטוס לקוח",            required: true, hint: "פעיל / לא פעיל / בתהליך / לקוח עבר" },
  { key: "advisor_gefen",         label: "יועץ מלווה — גפן",      required: true, hint: "שם מלא / אימייל / טלפון — אחד או כמה, מופרדים בפסיק (ניתן להשאיר תא ריק בשורה שלא נדרש לה)" },
  { key: "advisor_current",       label: "יועץ מלווה — שוטף",     required: true, hint: "שם מלא / אימייל / טלפון — אחד או כמה, מופרדים בפסיק (ניתן להשאיר תא ריק בשורה שלא נדרש לה)" },
  { key: "advisor_district",      label: "יועץ מלווה — מחוז",     required: true, hint: "שם מלא / אימייל / טלפון — אחד או כמה, מופרדים בפסיק (ניתן להשאיר תא ריק בשורה שלא נדרש לה)" },
  { key: "education_authority",    label: "רשות חינוך",           required: false },
  { key: "sector",                label: "מגזר",                 required: false, hint: "יהודי / ערבי / צ'רקסי / בדואי / דרוזי" },
  { key: "supervision",           label: "פיקוח",                required: false, hint: "ממלכתי / ממלכתי דתי / חרדי" },
  { key: "grade_levels",          label: "שכבות לימוד",          required: false, hint: "רשימה מופרדת בפסיקים מתוך א,ב,ג,ד,ה,ו,ז,ח,ט,י,יא,יב" },
  { key: "study_days",            label: "ימי לימוד",            required: false, hint: "רשימה מופרדת בפסיקים מתוך א,ב,ג,ד,ה,ו,ש" },
  { key: "student_count",         label: "מס' תלמידים",          required: false, hint: "מספר בלבד" },
  { key: "meeting_allocation_gefen",    label: "הקצאת פגישות [גפן]",    required: false, hint: "מספר" },
  { key: "meeting_allocation_current",  label: "הקצאת פגישות [שוטף]",   required: false, hint: "מספר" },
  { key: "meeting_allocation_district", label: "הקצאת פגישות [מחוז]",   required: false, hint: "מספר" },
  { key: "meeting_duration_gefen",      label: "זמן לפגישה [גפן]",      required: false, hint: 'שעות:דקות ("1:30"), דקות ("90") או "שעה וחצי"' },
  { key: "meeting_duration_current",    label: "זמן לפגישה [שוטף]",     required: false, hint: 'שעות:דקות ("1:30"), דקות ("90") או "שעה וחצי"' },
  { key: "meeting_duration_district",   label: "זמן לפגישה [מחוז]",     required: false, hint: 'שעות:דקות ("1:30"), דקות ("90") או "שעה וחצי"' },
  { key: "general_notes",         label: "הערות כלליות",         required: false, hint: "טקסט חופשי — יתווסף לאזור ההערות בכרטיס בית הספר בשם \"מיובא מאקסל\"" },
];

const USER_IMPORT_FIELD_CONFIG = [
  { key: "email",       label: "אימייל",         required: true },
  { key: "full_name",   label: "שם מלא",         required: true },
  { key: "role",        label: "תפקיד",          required: false, hint: "יועץ / מנהל / בעלים — ברירת מחדל: יועץ" },
  { key: "work_phone",  label: "טלפון עבודה",    required: false, hint: "10 ספרות המתחילות ב-05" },
];

// ---------------------------------------------------------------------------
// Excel-import recognition for closed-vocabulary columns.
// Every matcher returns { value, status }: "ok" = recognized (or the cell is
// empty / an error) | "none" = the cell holds something we could not map with
// confidence — raised in the interactive problems modal. Empty is never a problem.
// ---------------------------------------------------------------------------

// A cell that carries no real value: blank, an Excel formula error (#N/A, #REF!,
// #VALUE!, …), the literal words n/a / null / none, or a lone dash. Treated as
// "not filled in" for EVERY column. (A lone "0" is only treated as empty in the
// meeting-coordinator ranked fallback — handled there, not here.)
function isBlankOrError(v) {
  const t = String(v ?? "").trim();
  if (!t) return true;
  if (/^[-–—]+$/.test(t)) return true;
  if (["n/a", "na", "null", "none", "nan", "#value"].includes(t.toLowerCase())) return true;
  if (/^#[a-z0-9_/]*[!?]?$/i.test(t)) return true; // #N/A #REF! #NAME? #DIV/0! #GETTING_DATA …
  return false;
}

// Ordered-rules matcher: first rule whose token list hits the normalized key wins.
function matchClosed(raw, rules, emptyValue = "") {
  if (isBlankOrError(raw)) return { value: emptyValue, status: "ok" };
  const key = normFinanceKey(raw); // lowercase + strip spaces / punctuation / quotes
  if (!key) return { value: emptyValue, status: "ok" };
  for (const rule of rules) {
    if (rule.tokens.some(tok => key.includes(tok))) return { value: rule.value, status: "ok" };
  }
  return { value: emptyValue, status: "none" };
}

const STAGE_RULES = [
  { value: "tikkon",      tokens: ["עליונה", "חטע", "חטיבהעליונה", "תיכון", "תיכונית", "tichon", "tikon", "highschool"] },
  { value: "beinayim",    tokens: ["חטיבתביניים", "חטב", "ביניים", "beinayim", "middleschool"] },
  { value: "yesodi",      tokens: ["יסודי", "יסודית", "יסוד", "yesodi", "elementary", "primary"] },
  { value: "sheshshnati", tokens: ["שששנתי", "ששסנתי", "6שנתי", "שישנתי", "sheshshnati", "sixyear"] },
  { value: "other",       tokens: ["אחר", "אחרת", "other", "misc"] },
];
const matchStage = (raw) => matchClosed(raw, STAGE_RULES, "");

const DISTRICT_RULES = [
  { value: "תל-אביב",        tokens: ["תלאביב", "תל", "telaviv"] },
  { value: "צפון",            tokens: ["צפון", "צפוני", "north"] },
  { value: "דרום",            tokens: ["דרום", "דרומי", "south"] },
  { value: "ירושלים",         tokens: ["ירושלים", "ירושלם", "jerusalem"] },
  { value: "חיפה",            tokens: ["חיפה", "haifa"] },
  { value: "חינוך התיישבותי", tokens: ["התיישבותי", "חינוךהתיישבותי", "חנה", "התיישבות"] },
  { value: "חרדי",            tokens: ["חרדי", "חרדית", "מחוזחרדי"] },
  { value: "מרכז",            tokens: ["מרכז", "מרכזי", "center", "central"] },
];
const matchDistrict = (raw) => matchClosed(raw, DISTRICT_RULES, "");

const SECTOR_RULES = [
  { value: "יהודי",  tokens: ["יהוד", "jewish"] },
  { value: "ערבי",   tokens: ["ערב", "arab"] },
  { value: "צ'רקסי", tokens: ["צרקס", "circass"] },
  { value: "בדואי",  tokens: ["בדוא", "בדוו", "bedou"] },
  { value: "דרוזי",  tokens: ["דרוז", "druze", "druz"] },
];
const matchSector = (raw) => matchClosed(raw, SECTOR_RULES, "");

const SUPERVISION_RULES = [
  { value: "ממלכתי דתי", tokens: ["דתי", "ממד"] },
  { value: "ממלכתי",     tokens: ["ממלכתי", "ממלכתית", "state"] },
  { value: "חרדי",       tokens: ["חרדי", "חרדית", "עצמאי", "מעיין", "ביתיעקב", "חבד"] },
];
const matchSupervision = (raw) => matchClosed(raw, SUPERVISION_RULES, "");

// Service type needs a combo case (גפן + שוטף → gefen_current), so it isn't a plain ordered list.
const SVC_GEFEN = ["גפן", "gefen", "gefn"];
const SVC_CURRENT = ["שוטף", "שטף", "current", "shotef", "ongoing"];
const SVC_DISTRICT = ["מחוז", "מחוזי", "district", "machoz"];
function matchServiceType(raw) {
  if (isBlankOrError(raw)) return { value: null, status: "ok" };
  const key = normFinanceKey(raw);
  if (!key) return { value: null, status: "ok" };
  const hasG = SVC_GEFEN.some(t => key.includes(t));
  const hasC = SVC_CURRENT.some(t => key.includes(t));
  const hasD = SVC_DISTRICT.some(t => key.includes(t));
  if (hasG && hasC) return { value: "gefen_current", status: "ok" };
  if (hasG) return { value: "gefen", status: "ok" };
  if (hasC) return { value: "current", status: "ok" };
  if (hasD) return { value: "district", status: "ok" };
  return { value: null, status: "none" };
}

function matchClientStatus(raw) {
  if (isBlankOrError(raw)) return { value: null, status: "ok" };
  const key = normFinanceKey(raw);
  if (!key) return { value: null, status: "ok" };
  if ((key.includes("לא") && key.includes("פעיל")) || key.includes("inactive")) return { value: "inactive", status: "ok" };
  if (key.includes("פעיל") || key.includes("active")) return { value: "active", status: "ok" };
  if (key.includes("תהליך") || key.includes("הליך") || key.includes("בטיפול") || key.includes("inprogress") || key.includes("process")) return { value: "in_progress", status: "ok" };
  if (key.includes("עבר") || key.includes("לשעבר") || key.includes("ישן") || key.includes("former") || key.includes("past")) return { value: "former", status: "ok" };
  return { value: null, status: "none" };
}

const COORD_RULES = [
  { value: "secretary",       tokens: ["מנהלנ", "מזכיר", "מזכ", "secretary"] },
  { value: "finance_contact", tokens: ["כספים", "גזבר", "חשב", "הנהח", "הנהלתחשבונות", "finance", "bookkeep", "treasurer", "accountant"] },
  { value: "principal",       tokens: ["מנהל", "מנכ", "principal", "director", "headmaster"] },
];
// Role-word only. Returns "principal" | "secretary" | "finance_contact" | null.
const matchCoordinatorWord = (raw) => matchClosed(raw, COORD_RULES, null).value;

// Full coordinator resolution: role word first, then an exact identity match
// (name / email / phone) against THIS row's own imported contacts.
// -> { role, via: "word" | "identity" } | null (unresolved → problems modal).
function resolveCoordinator(raw, school) {
  if (isBlankOrError(raw)) return null;
  const t = String(raw).trim();
  const byWord = matchCoordinatorWord(t);
  if (byWord) return { role: byWord, via: "word" };
  const recs = [
    { role: "principal",       name: school.principal_name,       email: school.principal_email,       phone: school.principal_phone },
    { role: "secretary",       name: school.secretary_name,       email: school.secretary_email,       phone: school.secretary_phone },
    { role: "finance_contact", name: school.finance_contact_name, email: school.finance_contact_email, phone: school.finance_contact_phone },
  ];
  const hits = new Set();
  if (t.includes("@")) {
    const k = normEmailKey(t);
    for (const r of recs) if (r.email && normEmailKey(r.email) === k) hits.add(r.role);
  } else {
    const digits = t.replace(/[\s\-()+.]/g, "");
    if (digits.length >= 9 && /^\d+$/.test(digits)) {
      const k = normPhoneKey(t);
      for (const r of recs) if (r.phone && normPhoneKey(r.phone) === k) hits.add(r.role);
    } else {
      const k = normNameKey(t);
      for (const r of recs) if (r.name && normNameKey(r.name) === k) hits.add(r.role);
    }
  }
  return hits.size === 1 ? { role: [...hits][0], via: "identity" } : null;
}

// --- list-valued columns: grade levels & study days -------------------------
const GRADE_ORDER = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "יא", "יב"];
const GRADE_BY_DIGIT = { "1": "א", "2": "ב", "3": "ג", "4": "ד", "5": "ה", "6": "ו", "7": "ז", "8": "ח", "9": "ט", "10": "י", "11": "יא", "12": "יב" };
function normGradeToken(tok) {
  const s = String(tok || "").replace(/כית(ות|ה)?/g, "").replace(/["'׳״]/g, "").replace(/\s+/g, "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return GRADE_BY_DIGIT[s] || null;
  return GRADE_ORDER.includes(s) ? s : null;
}
const DAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_ALIASES = [
  { value: "sun", toks: ["א", "ראשון", "1", "sun"] },
  { value: "mon", toks: ["ב", "שני", "2", "mon"] },
  { value: "tue", toks: ["ג", "שלישי", "3", "tue"] },
  { value: "wed", toks: ["ד", "רביעי", "4", "wed"] },
  { value: "thu", toks: ["ה", "חמישי", "5", "thu"] },
  { value: "fri", toks: ["ו", "שישי", "6", "fri"] },
  { value: "sat", toks: ["ש", "שבת", "7", "sat"] },
];
function normDayToken(tok) {
  const s = String(tok || "").replace(/^יום/, "").replace(/["'׳״]/g, "").replace(/\s+/g, "").trim().toLowerCase();
  if (!s) return null;
  for (const d of DAY_ALIASES) if (d.toks.includes(s)) return d.value;
  return null;
}
function matchTokenList(raw, order, normTok) {
  if (isBlankOrError(raw)) return { value: [], status: "ok", unknown: [] };
  const out = [];
  const unknown = [];
  for (const p of String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean)) {
    const rm = p.match(/^(.+?)\s*(?:-|–|—|עד)\s*(.+)$/);
    if (rm) {
      const a = normTok(rm[1]);
      const b = normTok(rm[2]);
      const ia = a ? order.indexOf(a) : -1;
      const ib = b ? order.indexOf(b) : -1;
      if (ia !== -1 && ib !== -1) {
        const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
        out.push(...order.slice(lo, hi + 1));
        continue;
      }
      unknown.push(p);
      continue;
    }
    const v = normTok(p);
    if (v) out.push(v); else unknown.push(p);
  }
  const value = [...new Set(out)].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  return { value, status: unknown.length > 0 ? "none" : "ok", unknown };
}
const matchGradeLevels = (raw) => matchTokenList(raw, GRADE_ORDER, normGradeToken);
const matchStudyDays = (raw) => matchTokenList(raw, DAY_ORDER, normDayToken);

// --- numeric columns: meeting allocation (count) & duration (minutes) -------
function matchMeetingAllocation(raw) {
  if (isBlankOrError(raw)) return { value: null, status: "ok" };
  const s = String(raw).replace(/[^\d.,]/g, "").replace(/,/g, ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? { value: n, status: "ok" } : { value: null, status: "none" };
}
// Flexible: "90" · "1:30" · "1.5" / "1.5 שעות" · "45 דק'" · "2 שעות" · "שעה וחצי" · "חצי שעה" · "שעתיים"
function matchMeetingDuration(raw) {
  if (isBlankOrError(raw)) return { value: null, status: "ok" };
  const key = String(raw).replace(/\s+/g, "");
  const ok = (v) => (v > 0 ? { value: Math.round(v), status: "ok" } : { value: null, status: "none" });
  const hm = key.match(/^(\d{1,2}):(\d{1,2})$/);
  if (hm) return ok((+hm[1]) * 60 + (+hm[2]));
  if (key === "שעה") return { value: 60, status: "ok" };
  if (key === "שעתיים") return { value: 120, status: "ok" };
  if (key.includes("חצישעה")) return { value: 30, status: "ok" };
  const frac = key.includes("שלושתרבעי") ? 0.75 : key.includes("וחצי") ? 0.5 : key.includes("ורבע") ? 0.25 : 0;
  const hasHourWord = /שע(ה|ות|תיים)/.test(key);
  const hasMinWord = key.includes("דק");
  if (hasHourWord) {
    const h = key.match(/(\d+(?:[.,]\d+)?)/);
    let hours = h ? parseFloat(h[1].replace(",", ".")) : (key.includes("שעתיים") ? 2 : 1);
    hours += frac;
    let mins = 0;
    const mm = key.match(/(\d+)דק/);
    if (mm) mins = +mm[1];
    return ok(hours * 60 + mins);
  }
  if (hasMinWord) {
    const mm = key.match(/(\d+)/);
    if (mm) return ok(+mm[1]);
  }
  if (/^\d+[.,]\d+$/.test(key)) return ok(parseFloat(key.replace(",", ".")) * 60);
  if (/^\d+$/.test(key)) {
    const n = +key;
    if (n >= 15 && n <= 600 && n % 5 === 0) return { value: n, status: "ok" };
    return { value: null, status: "none" }; // bare small integer (e.g. "2") — hours or minutes? ask
  }
  return { value: null, status: "none" };
}

// Finance-software column (Excel import). Strip every space/dash/punctuation, then
// substring-match against a generous alias list per canonical value. A value that
// is present but matches 0 aliases — or matches 2+ — is treated as "unrecognized"
// and raised in the interactive problems modal (an empty cell is fine).
const FINANCE_SOFTWARE_ALIASES = {
  kesafim2000: ["כספים2000", "כספים", "כספי2000", "כספיים2000", "כספיםאלפיים", "תוכנתכספים", "kesafim2000", "kesafim", "ksafim2000", "ksafim", "caspim2000", "2000"],
  payscool: ["פייסקול", "פיסקול", "פייסקל", "פייסכול", "פייסקולתשלומים", "payscool", "payscol", "payschool", "payskool", "payscul", "pyscool", "paycool"],
  schoolcash: ["סקולקאש", "סקולקש", "סקולכאש", "סקולק", "סקולקאשאונליין", "schoolcash", "scoolcash", "schoolcach", "skoolcash", "schoolkash", "schoolcashonline"],
};

function normFinanceKey(raw) {
  return String(raw || "").toLowerCase().replace(/[\s\-_.,'"׳״()/\\]+/g, "");
}

// -> { value, status }. status: "ok" (matched, or empty) | "none" (present but not confidently recognized).
function matchFinanceSoftware(raw) {
  const key = normFinanceKey(raw);
  if (!key) return { value: "", status: "ok" };
  const hits = Object.entries(FINANCE_SOFTWARE_ALIASES)
    .filter(([, aliases]) => aliases.some(a => key.includes(a)))
    .map(([value]) => value);
  if (hits.length === 1) return { value: hits[0], status: "ok" };
  return { value: "", status: "none" };
}

// Kept for any non-import caller; import uses matchFinanceSoftware.
function normalizeFinanceSoftware(raw) {
  return matchFinanceSoftware(raw).value;
}

function normalizeRole(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t.includes("בעלים") || t === "owner") return "owner";
  if (t.includes("מנהל") || t === "manager") return "manager";
  return "advisor";
}

// ---------------------------------------------------------------------------
// Advisor-cell matching for the school Excel import.
// A "יועץ מלווה [גפן/שוטף/מחוז]" cell may contain one or more system users,
// identified by an EXACT match on full name, email, or phone — separated by
// a comma/semicolon, or (best effort) glued together with no separator.
// ---------------------------------------------------------------------------
const normNameKey = (s) => String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const normEmailKey = (s) => String(s || "").replace(/\s+/g, "").trim().toLowerCase();
function normPhoneKey(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (/^972\d{9}$/.test(d)) d = "0" + d.slice(3);
  return d;
}
const EMAIL_RE = /[^\s,;]+@[^\s,;]+\.[^\s,;]+/g;
const PHONE_RE = /(?:\+?972[-\s]?|0)\d(?:[-\s]?\d){7,9}/g;

// Build lookup maps { key -> [userId, ...] } so name/email/phone collisions surface as "ambiguous".
function buildUserMatchIndex(users) {
  const byName = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  let maxNameWords = 1;
  const push = (map, key, id) => {
    if (!key) return;
    const arr = map.get(key);
    if (arr) { if (!arr.includes(id)) arr.push(id); } else map.set(key, [id]);
  };
  for (const u of users || []) {
    const nk = normNameKey(u.full_name);
    if (nk) { push(byName, nk, u.id); maxNameWords = Math.max(maxNameWords, nk.split(" ").length); }
    push(byEmail, normEmailKey(u.email), u.id);
    const pk = normPhoneKey(u.work_phone);
    if (pk.length >= 9) push(byPhone, pk, u.id);
  }
  return { byName, byEmail, byPhone, maxNameWords: Math.min(maxNameWords, 6) };
}

// Classify + look up a single already-isolated token. Returns { status, ids }.
function matchAdvisorToken(token, idx) {
  const t = String(token || "").trim();
  if (!t) return { status: "none", ids: [] };
  let hit;
  if (t.includes("@")) hit = idx.byEmail.get(normEmailKey(t));
  else {
    const digits = t.replace(/[\s\-()+.]/g, "");
    if (digits.length >= 9 && /^\d+$/.test(digits)) hit = idx.byPhone.get(normPhoneKey(t));
    else hit = idx.byName.get(normNameKey(t));
  }
  if (!hit || hit.length === 0) return { status: "none", ids: [] };
  if (hit.length === 1) return { status: "ok", ids: [hit[0]] };
  return { status: "ambiguous", ids: hit.slice() };
}

// Best-effort split of a separator-less part that did not match as a whole:
// peel emails/phones, then greedily partition the remaining words against known
// full names (longest match first). Only succeeds if the ENTIRE part is consumed.
function smartSplitPart(part, idx) {
  let rest = ` ${part} `;
  const ids = [];
  const problems = [];
  for (const re of [EMAIL_RE, PHONE_RE]) {
    const found = rest.match(re) || [];
    for (const frag of found) {
      const m = matchAdvisorToken(frag, idx);
      if (m.status === "ok") { ids.push(m.ids[0]); rest = rest.replace(frag, " "); }
      else if (m.status === "ambiguous") { problems.push({ kind: "advisor_ambiguous", token: frag.trim(), candidateIds: m.ids }); rest = rest.replace(frag, " "); }
    }
  }
  const words = rest.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let i = 0;
  let ok = true;
  while (i < words.length) {
    let matched = false;
    for (let take = Math.min(idx.maxNameWords, words.length - i); take >= 1; take--) {
      const cand = words.slice(i, i + take).join(" ");
      const hit = idx.byName.get(normNameKey(cand));
      if (hit && hit.length === 1) { ids.push(hit[0]); i += take; matched = true; break; }
      if (hit && hit.length > 1) { problems.push({ kind: "advisor_ambiguous", token: cand, candidateIds: hit.slice() }); i += take; matched = true; break; }
    }
    if (!matched) { ok = false; break; }
  }
  if (ok && ids.length + problems.length >= 1) return { ids, problems };
  return { ids: [], problems: [{ kind: "advisor_unresolved", token: String(part).trim() }] };
}

// Resolve a whole advisor cell -> { ids: [unique userId...], problems: [...] }.
function resolveAdvisorCell(rawCell, idx) {
  const raw = String(rawCell || "").replace(/ /g, " ").trim();
  if (!raw) return { ids: [], problems: [] };
  const parts = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const ids = [];
  const problems = [];
  for (const part of parts) {
    const m = matchAdvisorToken(part, idx);
    if (m.status === "ok") { ids.push(m.ids[0]); continue; }
    if (m.status === "ambiguous") { problems.push({ kind: "advisor_ambiguous", token: part, candidateIds: m.ids }); continue; }
    const s = smartSplitPart(part, idx);
    ids.push(...s.ids);
    problems.push(...s.problems);
  }
  return { ids: [...new Set(ids)], problems };
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

function AddUserModal({
  inviteForm, setInviteForm, myRole, inviteUser, inviting, inviteMsg, WORK_PHONE_REGEX,
  userImportRef, handleUserImport, importingUsers, userImportProgressMsg, userImportResult,
  onClose,
}) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="add-user-modal-title">
      <div ref={ref} onKeyDown={handleKeyDown} className="bg-white rounded-2xl shadow-2xl w-full max-w-[76.8rem] p-6 flex flex-col gap-4 text-right max-h-[90vh] overflow-y-auto" dir="rtl">
        <div className="flex items-center justify-between gap-4">
          <h2 id="add-user-modal-title" className="text-lg font-bold text-slate-900">הזמן משתמש חדש</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            <input ref={userImportRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUserImport} aria-label="ייבוא משתמשים מאקסל" />
            <button onClick={() => userImportRef.current?.click()} disabled={importingUsers} className="btn-ghost text-sm px-4 py-2">
              {importingUsers ? (userImportProgressMsg || "מייבא...") : "ייבוא מאקסל"}
            </button>
            <button
              onClick={onClose}
              aria-label="סגור"
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {userImportResult && (
          <div className={`glass-card rounded-xl p-4 border ${userImportResult.errors.length > 0 ? "border-orange-200" : "border-green-200"}`}>
            <p className="font-medium text-slate-800 text-sm">
              {userImportResult.imported > 0 ? `הוזמנו ${userImportResult.imported} משתמשים בהצלחה` : "לא הוזמנו משתמשים"}
              {userImportResult.errors.length > 0 && ` · ${userImportResult.errors.length} שגיאות`}
            </p>
            {userImportResult.errors.map((e, i) => <p key={i} className="text-red-500 text-xs mt-1">{e}</p>)}
          </div>
        )}

        <div className="grid grid-cols-6 gap-4 items-end">
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
            <label htmlFor="invite-phone" className="text-xs text-slate-800">טלפון עבודה</label>
            <input id="invite-phone" className="input-field" type="tel" inputMode="numeric" dir="ltr"
              value={inviteForm.work_phone}
              onChange={e => setInviteForm(p => ({ ...p, work_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
              maxLength={10} />
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
            <span className="text-xs text-slate-800">תחומי ידע</span>
            <MultiSelectChips neutral options={DOMAIN_OPTIONS}
              selected={inviteForm.control_domains}
              onChange={v => setInviteForm(p => ({ ...p, control_domains: v }))}
              placeholder="בחר תחומים" />
          </div>
          <button onClick={inviteUser} disabled={!inviteForm.email || !inviteForm.full_name || inviting || (inviteForm.work_phone && !WORK_PHONE_REGEX.test(inviteForm.work_phone))} className="btn-blue text-sm px-5 py-2">
            {inviting ? "שולח..." : "שלח הזמנה"}
          </button>
        </div>
        {inviteForm.work_phone && !WORK_PHONE_REGEX.test(inviteForm.work_phone) && (
          <p role="alert" className="text-xs text-red-500">יש להזין 10 ספרות המתחילות ב-05</p>
        )}
        {inviteMsg && (
          <div>
            <span className={`text-sm ${inviteMsg.includes("שגיאה") ? "text-red-500" : "text-green-600"}`}>{inviteMsg}</span>
          </div>
        )}
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
    perms: ["can_view_school_card", "can_add_school", "can_delete_schools", "can_edit_school_directly", "can_request_school_update", "can_approve_update_requests", "can_delete_own_meetings"],
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
  {
    label: "פגישות",
    perms: ["can_edit_meeting_automations"],
    advisorNA: new Set(["can_edit_meeting_automations"]),
  },
  {
    label: "שיחות",
    perms: ["can_remove_call_from_school"],
    advisorNA: new Set(),
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

function AdminColumnFilterPopover({ colKey, colLabel, filterType, spec, onChange, onClear, onClose, options: optionsProp }) {
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
    const options = optionsProp || ADMIN_SELECT_FILTER_OPTIONS[colKey] || [];
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
  // Pending interactive-resolution state for the school import: { rows: [planRow, ...] }.
  // When set, <SchoolImportProblemsModal> is shown and blocks the commit until every
  // row is either fully resolved or excluded.
  const [importPlan, setImportPlan] = useState(null);

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
  const [editingAdminNotesKey, setEditingAdminNotesKey] = useState(null); // `${schoolId}:${field}` of the notes cell currently in edit mode
  const [quarterlyNotesSummary, setQuarterlyNotesSummary] = useState({}); // school_id -> {"1":{count,latest_segment}, "2":..., "3":..., "4":...}
  const [showSchoolNotesModalFor, setShowSchoolNotesModalFor] = useState(null); // {schoolId, quarter} | null — focused-quarter notes modal
  const [myFullName, setMyFullName] = useState("");
  const adminContractInputRef = useRef(null);
  const adminColPickerRef = useRef(null);
  const adminFilterPopoverRef = useRef(null);

  // Accounts state
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [schoolAccounts, setSchoolAccounts] = useState({});
  const [newDivision, setNewDivision] = useState("tikkon");
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({ finance_software: "", tmura_model: false });

  // Advisors per school in expanded panel
  const [schoolAdvisors, setSchoolAdvisors] = useState({});

  // Per-service-type "יועץ מלווה [גפן/שוטף/מחוז]" advisors in the expanded panel — replaces
  // the old single general list there, one independent set per service type per school.
  const [typedSchoolAdvisors, setTypedSchoolAdvisors] = useState({});

  // Per-service-type "יועץ מלווה [גפן/שוטף/מחוז]" draft selection for the school form
  // (add + edit) — same pattern as SchoolPage.jsx/AddSchoolPage.jsx: diffed against
  // originalTypedAdvisorIds and only the net add/remove calls sent on save.
  const EMPTY_TYPED_ADVISOR_IDS = { gefen: [], current: [], district: [] };
  const [draftTypedAdvisorIds, setDraftTypedAdvisorIds] = useState(EMPTY_TYPED_ADVISOR_IDS);
  const [originalTypedAdvisorIds, setOriginalTypedAdvisorIds] = useState(EMPTY_TYPED_ADVISOR_IDS);

  // "פרטי ליווי" draft form for the school form (add + edit) — school_year_admin_data fields,
  // same shape as AddSchoolPage.jsx's yearAdminForm. Loaded from the server when editing an
  // existing school, sent as one PUT .../year-admin-data on save (not per-field, unlike
  // SchoolPage.jsx's own ליווי tab which saves each field immediately on change).
  const EMPTY_YEAR_ADMIN_FORM = {
    client_status: null, service_type: null, order_method: [], order_amount_gefen: null,
    meeting_allocation_gefen: null, meeting_allocation_current: null, meeting_allocation_district: null,
    meeting_duration_gefen: null, meeting_duration_current: null, meeting_duration_district: null,
  };
  const [yearAdminForm, setYearAdminForm] = useState(EMPTY_YEAR_ADMIN_FORM);

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
  const [voicenterEnabled, setVoicenterEnabled] = useState(false);
  const [voicenterKnownReps, setVoicenterKnownReps] = useState([]); // [{ representative_code, representative_name }]
  const [voicenterMappings, setVoicenterMappings] = useState([]); // [{ id, representative_code, representative_name, advisor_id }]
  const [openActionsMenu, setOpenActionsMenu] = useState(null); // userId of open 3-dot menu
  const [roleError, setRoleError] = useState("");
  const [roleChangeConfirm, setRoleChangeConfirm] = useState(null); // { userId, userName, oldRole, newRole }
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", role: "advisor", control_domains: [], work_phone: "" });
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [phoneDrafts, setPhoneDrafts] = useState({});
  const [phoneErrors, setPhoneErrors] = useState({});
  const [phoneEditingIds, setPhoneEditingIds] = useState(() => new Set());
  const WORK_PHONE_REGEX = /^05\d{8}$/;
  function formatWorkPhone(phone) {
    if (!phone) return "";
    return `${phone.slice(0, 3)}-${phone.slice(3)}`;
  }
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

  // Union of the 3 typed advisor lists — source for "גישה" when linked to "היועצים המלווים",
  // same pattern as AddSchoolPage.jsx's draftLinkedAdvisorIds.
  const draftLinkedAdvisorIds = [...new Set([
    ...draftTypedAdvisorIds.gefen, ...draftTypedAdvisorIds.current, ...draftTypedAdvisorIds.district,
  ])];

  const schoolFormDirty = showSchoolForm && (
    editingSchool !== null ||
    !!(schoolForm.name || schoolForm.symbol || schoolStage || draftLinkedAdvisorIds.length > 0)
  );

  const effectiveSchoolFormStage = editingSchool ? schoolForm.stage : schoolStage;
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
    setInviteForm({ email: "", full_name: "", role: "advisor", control_domains: [], work_phone: "" });
    blocker.proceed?.();
  }

  function handleDiscardAndProceed() {
    setShowSchoolForm(false);
    setEditingSchool(null);
    setSchoolForm(EMPTY_FORM);
    setDraftTypedAdvisorIds(EMPTY_TYPED_ADVISOR_IDS);
    setOriginalTypedAdvisorIds(EMPTY_TYPED_ADVISOR_IDS);
    setYearAdminForm(EMPTY_YEAR_ADMIN_FORM);
    setSchoolStage("");
    setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    setEditingUser(null);
    setEditingUserName("");
    setInviteForm({ email: "", full_name: "", role: "advisor", control_domains: [], work_phone: "" });
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
        setMyFullName(res.data?.full_name || "");
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

  // Quarterly notes have no academic-year dimension (perpetual per-school bucket), so this
  // only needs to (re)load when the schools list itself changes, not per selected year.
  useEffect(() => {
    if ((myRole === "owner" || myRole === "manager") && schools.length > 0) {
      loadQuarterlyNotesSummary(schools.map(s => s.id));
    }
  }, [schools, myRole]);

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

  // A user with previously-saved admin_col_order/admin_col_visible (from before the closure
  // columns existed) has a restored adminColOrder that doesn't contain those keys — toggling
  // their visibility checkbox would flip adminColVisible but the column still wouldn't render,
  // since the render list is `adminColOrder.filter(k => adminColVisible[k] && ...)`. Back-fill
  // any missing ADMIN_ALL_COLUMNS keys in (hidden by default) once restoration settles. The
  // missing-check guard makes this converge after one extra render instead of looping.
  useEffect(() => {
    const missingOrder = ADMIN_DEFAULT_COL_ORDER.filter(k => !adminColOrder.includes(k));
    const missingVisible = ADMIN_ALL_COLUMNS.filter(c => !(c.key in adminColVisible));
    if (missingOrder.length === 0 && missingVisible.length === 0) return;
    const nextOrder = missingOrder.length ? [...adminColOrder, ...missingOrder] : adminColOrder;
    const nextVisible = missingVisible.length
      ? { ...adminColVisible, ...Object.fromEntries(missingVisible.map(c => [c.key, false])) }
      : adminColVisible;
    setAdminColOrder(nextOrder);
    setAdminColVisible(nextVisible);
    saveAdminColPrefs(nextOrder, nextVisible);
  }, [adminColOrder, adminColVisible]);

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

  async function loadQuarterlyNotesSummary(schoolIds) {
    if (!schoolIds || schoolIds.length === 0) return;
    try {
      const { data } = await axios.post("/schools/notes/quarterly-summary/batch", { school_ids: schoolIds });
      setQuarterlyNotesSummary(data && typeof data === "object" ? data : {});
    } catch {
      setQuarterlyNotesSummary({});
    }
  }

  async function createQuarterlyNote(schoolId, quarter, content) {
    try {
      const { data } = await axios.post(`/schools/${schoolId}/notes`, { note_type: "quarterly", quarter: Number(quarter), content });
      setQuarterlyNotesSummary(prev => ({
        ...prev,
        [schoolId]: {
          ...(prev[schoolId] || {}),
          [quarter]: { count: 1, latest_segment: { ...data, author_name: myFullName, author_role: myRole } },
        },
      }));
    } catch {
      alert("שמירת ההערה נכשלה — נסה שוב");
    }
  }

  async function saveQuarterlyNoteEdit(schoolId, segmentId, quarter, content) {
    try {
      await axios.patch(`/schools/${schoolId}/notes/segments/${segmentId}`, { content });
      setQuarterlyNotesSummary(prev => ({
        ...prev,
        [schoolId]: {
          ...(prev[schoolId] || {}),
          [quarter]: {
            ...(prev[schoolId]?.[quarter] || { count: 1 }),
            latest_segment: { ...(prev[schoolId]?.[quarter]?.latest_segment || {}), content },
          },
        },
      }));
    } catch {
      alert("עריכת ההערה נכשלה — אין הרשאה או שגיאה זמנית");
    }
  }

  function openContractUpload(schoolId) {
    setUploadingContractFor(schoolId);
    adminContractInputRef.current?.click();
  }

  async function downloadControlLetterFile(schoolId, divisionType, kind, fileName) {
    try {
      const res = await axios.get(`/schools/${schoolId}/control-letters/${divisionType}/${kind}-file`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "control-letter.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal */
    }
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

  // When "היועצים המלווים שנבחרו" mode is active, keep restrict_access_to in sync with the
  // union of the 3 typed advisor lists.
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    setSchoolForm(p => ({ ...p, restrict_access_to: draftLinkedAdvisorIds.length > 0 ? draftLinkedAdvisorIds : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTypedAdvisorIds, accessLinkedToAdvisors]);

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
      const [usersRes, countsRes, voicenterSettingsRes] = await Promise.all([
        axios.get("/schools/users/all"),
        axios.get("/schools/permissions/overrides/counts").catch(() => ({ data: {} })),
        axios.get("/voicenter/settings").catch(() => ({ data: { enabled: false } })),
      ]);
      setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setOverrideCounts(countsRes.data || {});
      const enabled = !!voicenterSettingsRes.data?.enabled;
      setVoicenterEnabled(enabled);
      if (enabled) {
        const [repsRes, mappingsRes] = await Promise.all([
          axios.get("/voicenter/known-reps").catch(() => ({ data: [] })),
          axios.get("/voicenter/mappings").catch(() => ({ data: [] })),
        ]);
        setVoicenterKnownReps(Array.isArray(repsRes.data) ? repsRes.data : []);
        setVoicenterMappings(Array.isArray(mappingsRes.data) ? mappingsRes.data : []);
      }
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadVoicenterMappings() {
    try {
      const res = await axios.get("/voicenter/mappings");
      setVoicenterMappings(Array.isArray(res.data) ? res.data : []);
    } catch {
      /* non-fatal */
    }
  }

  async function saveUserVoicenterMapping(u, newCodes) {
    const current = voicenterMappings.filter(m => m.advisor_id === u.id);
    const currentCodes = current.map(m => m.representative_code);
    const added = newCodes.filter(c => !currentCodes.includes(c));
    const removed = current.filter(m => !newCodes.includes(m.representative_code));
    try {
      for (const code of added) {
        const rep = voicenterKnownReps.find(r => r.representative_code === code);
        await axios.post("/voicenter/mappings", {
          representative_code: code,
          representative_name: rep?.representative_name || null,
          advisor_id: u.id,
        });
      }
      for (const m of removed) {
        await axios.delete(`/voicenter/mappings/${m.id}`);
      }
    } finally {
      // A code added here may have been reassigned away from another user (upsert is keyed
      // by representative_code, not advisor_id) — refetch the full list so that user's row
      // updates too, not just this one.
      loadVoicenterMappings();
    }
  }

  async function saveSchool() {
    setTriedSave(true);
    if (!schoolForm.name || validateSymbol(schoolForm.symbol)) return;
    if (!editingSchool && schools.some(s => s.symbol === schoolForm.symbol)) return;
    if (!editingSchool && !schoolStage) return;
    const requiredServiceTypes = activeServiceTypes(yearAdminForm.service_type);
    if (yearAdminForm.client_status === "active" && requiredServiceTypes.some(t => draftTypedAdvisorIds[t].length === 0)) return;
    if (!editingSchool && (schoolStage === "sheshshnati" || schoolStage === "other") && customDivisions.length === 0) return;
    if (schoolForm.principal_phone && validateSecretaryPhone(schoolForm.principal_phone)) return;
    if (schoolForm.secretary_phone && validateSecretaryPhone(schoolForm.secretary_phone)) return;
    if (schoolForm.finance_contact_phone && validateSecretaryPhone(schoolForm.finance_contact_phone)) return;
    if (effectiveSchoolFormStage === "sheshshnati" && !schoolForm.principal_same_person
        && schoolForm.principal_chativa_phone && validateSecretaryPhone(schoolForm.principal_chativa_phone)) return;
    if (schoolForm.school_phone && validateSchoolPhone(schoolForm.school_phone)) return;
    if (!schoolForm.meeting_coordinator) return;
    // "אותו מנהל/ת לשתי החטיבות" — the חט"ב fields are hidden in the UI, so keep them
    // in sync with the חט"ע ones rather than sending stale/blank data.
    const chativaSync = (effectiveSchoolFormStage === "sheshshnati" && schoolForm.principal_same_person)
      ? {
          principal_chativa_name: schoolForm.principal_name,
          principal_chativa_phone: schoolForm.principal_phone,
          principal_chativa_email: schoolForm.principal_email,
          principal_chativa_day_off: schoolForm.principal_day_off,
        }
      : {};
    const studentCountValue = schoolForm.student_count === "" || schoolForm.student_count == null
      ? null
      : parseInt(schoolForm.student_count, 10);
    setSavingSchool(true);
    try {
      if (editingSchool) {
        // Apply only the net advisor changes per type (adds before removes, so the backend's
        // "last advisor" guard never sees a false zero-advisor state) — this is what keeps
        // notifications limited to real, saved changes instead of every click. Each typed
        // assign/unassign call also keeps the general advisor_schools access table in sync
        // server-side, so there's no separate flat-advisor diff to send here anymore.
        try {
          for (const t of ["gefen", "current", "district"]) {
            const addedT = draftTypedAdvisorIds[t].filter(id => !originalTypedAdvisorIds[t].includes(id));
            const removedT = originalTypedAdvisorIds[t].filter(id => !draftTypedAdvisorIds[t].includes(id));
            for (const id of addedT) {
              await axios.post(`/schools/${editingSchool.id}/advisors/${t}`, { advisor_id: id });
            }
            for (const id of removedT) {
              await axios.delete(`/schools/${editingSchool.id}/advisors/${t}/${id}`);
            }
          }
        } catch (err) {
          window.alert(err.response?.data?.detail || "שגיאה בעדכון היועצים המלווים");
          return false;
        }
        await axios.put(`/schools/${editingSchool.id}`, { ...schoolForm, ...chativaSync, student_count: studentCountValue });
        await axios.put(`/schools/${editingSchool.id}/year-admin-data`, yearAdminForm, { params: { academic_year: DEFAULT_ACADEMIC_YEAR } });
        try {
          const res = await axios.get(`/schools/${editingSchool.id}/advisors`);
          setSchoolAdvisors(prev => ({ ...prev, [editingSchool.id]: res.data || [] }));
        } catch {
          // non-fatal — schoolAdvisors just stays at its previous value until next reload
        }
        setOriginalTypedAdvisorIds(draftTypedAdvisorIds);
      } else {
        const res = await axios.post("/schools/", { ...schoolForm, ...chativaSync, stage: schoolStage, student_count: studentCountValue });
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
        for (const t of ["gefen", "current", "district"]) {
          for (const advisorId of draftTypedAdvisorIds[t]) {
            await axios.post(`/schools/${newId}/advisors/${t}`, { advisor_id: advisorId });
          }
        }
        await axios.put(`/schools/${newId}/year-admin-data`, yearAdminForm, { params: { academic_year: DEFAULT_ACADEMIC_YEAR } });
      }
      setShowSchoolForm(false);
      setEditingSchool(null);
      setSchoolForm(EMPTY_FORM);
      setDraftTypedAdvisorIds(EMPTY_TYPED_ADVISOR_IDS);
      setOriginalTypedAdvisorIds(EMPTY_TYPED_ADVISOR_IDS);
      setYearAdminForm(EMPTY_YEAR_ADMIN_FORM);
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
      principal_chativa_name: school.principal_chativa_name || "",
      principal_chativa_phone: school.principal_chativa_phone || "",
      principal_chativa_email: school.principal_chativa_email || "",
      principal_chativa_day_off: school.principal_chativa_day_off || [],
      principal_same_person: school.principal_same_person !== false,
      education_authority: school.education_authority || "",
      sector: school.sector || "",
      supervision: school.supervision || "",
      grade_levels: school.grade_levels || [],
      study_days: school.study_days || [],
      student_count: school.student_count ?? "",
    });
    setTriedSave(false);
    setShowSchoolForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    axios.get(`/schools/${school.id}/advisors`).then(res => {
      setSchoolAdvisors(prev => ({ ...prev, [school.id]: res.data || [] }));
    }).catch(() => {});
    axios.get(`/schools/${school.id}/year-admin-data`, { params: { academic_year: DEFAULT_ACADEMIC_YEAR } })
      .then(res => setYearAdminForm({ ...EMPTY_YEAR_ADMIN_FORM, ...(res.data || {}) }))
      .catch(() => setYearAdminForm(EMPTY_YEAR_ADMIN_FORM));
    Promise.allSettled([
      axios.get(`/schools/${school.id}/advisors/gefen`),
      axios.get(`/schools/${school.id}/advisors/current`),
      axios.get(`/schools/${school.id}/advisors/district`),
    ]).then(([g, c, d]) => {
      const ids = {
        gefen: g.status === "fulfilled" ? (g.value.data || []).map(a => a.id) : [],
        current: c.status === "fulfilled" ? (c.value.data || []).map(a => a.id) : [],
        district: d.status === "fulfilled" ? (d.value.data || []).map(a => a.id) : [],
      };
      setDraftTypedAdvisorIds(ids);
      setOriginalTypedAdvisorIds(ids);
    });
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
    setSchoolStage("");
    setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    setDraftTypedAdvisorIds(EMPTY_TYPED_ADVISOR_IDS);
    setOriginalTypedAdvisorIds(EMPTY_TYPED_ADVISOR_IDS);
    setYearAdminForm(EMPTY_YEAR_ADMIN_FORM);
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
    const [g, c, d] = await Promise.all([
      axios.get(`/schools/${school.id}/advisors/gefen`),
      axios.get(`/schools/${school.id}/advisors/current`),
      axios.get(`/schools/${school.id}/advisors/district`),
    ]);
    setTypedSchoolAdvisors(prev => ({ ...prev, [school.id]: { gefen: g.data || [], current: c.data || [], district: d.data || [] } }));
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

  // Same pattern as handleExpandedAdvisorChange, per service type (gefen/current/district).
  async function handleExpandedTypedAdvisorChange(schoolId, serviceType, newIds) {
    const current = (typedSchoolAdvisors[schoolId]?.[serviceType] || []).map(a => a.id);
    const added = newIds.filter(id => !current.includes(id));
    const removed = current.filter(id => !newIds.includes(id));
    for (const id of added) await axios.post(`/schools/${schoolId}/advisors/${serviceType}`, { advisor_id: id });
    for (const id of removed) {
      try {
        await axios.delete(`/schools/${schoolId}/advisors/${serviceType}/${id}`);
      } catch (err) {
        window.alert(err.response?.data?.detail || "שגיאה בהסרת היועץ");
      }
    }
    const [tRes, gRes] = await Promise.all([
      axios.get(`/schools/${schoolId}/advisors/${serviceType}`),
      axios.get(`/schools/${schoolId}/advisors`),
    ]);
    setTypedSchoolAdvisors(prev => ({ ...prev, [schoolId]: { ...(prev[schoolId] || {}), [serviceType]: tRes.data } }));
    setSchoolAdvisors(prev => ({ ...prev, [schoolId]: gRes.data }));
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

  function startEditPhone(u) {
    setPhoneDrafts(p => ({ ...p, [u.id]: u.work_phone || "" }));
    setPhoneEditingIds(prev => new Set(prev).add(u.id));
  }

  function cancelEditPhone(u) {
    setPhoneDrafts(p => { const n = { ...p }; delete n[u.id]; return n; });
    setPhoneErrors(p => { const n = { ...p }; delete n[u.id]; return n; });
    setPhoneEditingIds(prev => { const n = new Set(prev); n.delete(u.id); return n; });
  }

  async function saveUserPhone(u) {
    const draft = phoneDrafts[u.id];
    if (draft === undefined) { cancelEditPhone(u); return; }
    const value = draft.trim();
    if (value !== "" && !WORK_PHONE_REGEX.test(value)) {
      setPhoneErrors(p => ({ ...p, [u.id]: "יש להזין 10 ספרות המתחילות ב-05" }));
      return;
    }
    setPhoneErrors(p => { const n = { ...p }; delete n[u.id]; return n; });
    setPhoneDrafts(p => { const n = { ...p }; delete n[u.id]; return n; });
    setPhoneEditingIds(prev => { const n = new Set(prev); n.delete(u.id); return n; });
    if (value === (u.work_phone || "")) return;
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, work_phone: value } : x));
    try {
      await axios.patch(`/schools/users/${u.id}`, { work_phone: value });
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
    if (inviteForm.work_phone && !WORK_PHONE_REGEX.test(inviteForm.work_phone)) {
      setInviteMsg("שגיאה: טלפון עבודה חייב להיות 10 ספרות המתחילות ב-05");
      return;
    }
    setInviting(true);
    setInviteMsg("");
    try {
      await axios.post("/schools/users/invite", inviteForm);
      setInviteMsg("הזמנה נשלחה בהצלחה לאימייל המשתמש");
      setInviteForm({ email: "", full_name: "", role: "advisor", control_domains: [], work_phone: "" });
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
      const work_phone = mapping.work_phone !== null
        ? String(row[mapping.work_phone] ?? "").replace(/\D/g, "").slice(0, 10)
        : "";

      if (!email || !full_name) {
        errors.push(`שורה ${i + 2}: חסר אימייל או שם מלא`);
        continue;
      }
      if (work_phone && !WORK_PHONE_REGEX.test(work_phone)) {
        errors.push(`שורה ${i + 2} (${email}): טלפון עבודה לא תקין — נדרשות 10 ספרות המתחילות ב-05`);
        continue;
      }
      try {
        await axios.post("/schools/users/invite", { email, full_name, role, work_phone });
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

  // Fields that don't belong on the SchoolIn payload (POST /schools/) — they're written
  // separately to school_year_admin_data / the typed advisor endpoints after creation.
  const IMPORT_YEAR_ADMIN_KEYS = ["service_type", "client_status"];
  const IMPORT_ADVISOR_KEYS = { advisor_gefen: "gefen", advisor_current: "current", advisor_district: "district" };

  const COORDINATOR_NAME_FIELD = { principal: "principal_name", secretary: "secretary_name", finance_contact: "finance_contact_name" };

  // Closed-vocabulary columns and how to recognize / resolve them in the modal.
  const CLOSED_FIELD_SPECS = {
    stage:           { label: "שלב מוסד",  target: "school",    match: matchStage,       kind: "select", allowEmpty: true,  options: () => SCHOOL_STAGE_OPTIONS.filter(o => o.value) },
    district:        { label: "מחוז",      target: "school",    match: matchDistrict,    kind: "select", allowEmpty: true,  options: () => DISTRICT_OPTIONS.map(d => ({ value: d, label: d })) },
    sector:          { label: "מגזר",      target: "school",    match: matchSector,      kind: "select", allowEmpty: true,  options: () => SECTOR_OPTIONS.filter(o => o.value) },
    supervision:     { label: "פיקוח",     target: "school",    match: matchSupervision, kind: "select", allowEmpty: true,  options: () => SUPERVISION_OPTIONS.filter(o => o.value) },
    service_type:    { label: "סוג שירות", target: "yearAdmin", match: matchServiceType, kind: "select", allowEmpty: false, options: () => SERVICE_TYPE_OPTIONS },
    client_status:   { label: "סטטוס לקוח", target: "yearAdmin", match: matchClientStatus, kind: "select", allowEmpty: false, options: () => CLIENT_STATUS_OPTIONS },
    grade_levels:    { label: "שכבות לימוד", target: "school",  match: matchGradeLevels, kind: "chips",  options: () => GRADE_LEVEL_OPTIONS },
    study_days:      { label: "ימי לימוד", target: "school",    match: matchStudyDays,   kind: "chips",  options: () => STUDY_DAY_OPTIONS },
    meeting_allocation_gefen:    { label: "הקצאת פגישות [גפן]",  target: "yearAdmin", match: matchMeetingAllocation, kind: "number" },
    meeting_allocation_current:  { label: "הקצאת פגישות [שוטף]", target: "yearAdmin", match: matchMeetingAllocation, kind: "number" },
    meeting_allocation_district: { label: "הקצאת פגישות [מחוז]", target: "yearAdmin", match: matchMeetingAllocation, kind: "number" },
    meeting_duration_gefen:      { label: "זמן לפגישה [גפן]",   target: "yearAdmin", match: matchMeetingDuration,  kind: "duration" },
    meeting_duration_current:    { label: "זמן לפגישה [שוטף]",  target: "yearAdmin", match: matchMeetingDuration,  kind: "duration" },
    meeting_duration_district:   { label: "זמן לפגישה [מחוז]",  target: "yearAdmin", match: matchMeetingDuration,  kind: "duration" },
  };

  // Parse one mapped Excel row into a structured plan row (no network calls, no writes).
  function parseImportRow(row, i, mapping, idx) {
    const school = {};
    const yearAdmin = {};
    const advisorRaw = { gefen: "", current: "", district: "" };
    const rawByKey = {};
    let coordinatorRaw = "";
    let generalNotes = "";
    let financeSoftwareRaw = "";
    IMPORT_FIELD_CONFIG.forEach(f => {
      // meeting_coordinator: up to 3 ranked columns — take the first that is not
      // blank / an Excel error / a lone 0 (a broken lookup result).
      if (f.key === "meeting_coordinator") {
        const cols = Array.isArray(mapping[f.key]) ? mapping[f.key] : [mapping[f.key]];
        for (const c of cols) {
          if (c === null || c === undefined) continue;
          const v = String(row[c] ?? "").trim();
          if (isBlankOrError(v) || /^0+(\.0+)?$/.test(v)) continue;
          coordinatorRaw = v;
          break;
        }
        return;
      }
      if (mapping[f.key] === null || mapping[f.key] === undefined) return;
      let raw = String(row[mapping[f.key]] ?? "").trim();
      if (isBlankOrError(raw)) raw = "";
      if (f.key === "finance_software") { financeSoftwareRaw = raw; return; }
      if (f.key === "general_notes") { generalNotes = raw; return; }
      if (IMPORT_ADVISOR_KEYS[f.key]) { advisorRaw[IMPORT_ADVISOR_KEYS[f.key]] = raw; return; }
      if (CLOSED_FIELD_SPECS[f.key]) { rawByKey[f.key] = raw; return; }
      if (f.key === "student_count") {
        const n = parseInt(raw.replace(/\D/g, ""), 10);
        school[f.key] = Number.isFinite(n) ? n : null;
        if (raw && !Number.isFinite(n)) rawByKey[f.key] = raw; // has text but no digits → resolve in modal
        return;
      }
      if (f.key.includes("phone")) { school[f.key] = raw.replace(/\D/g, ""); return; }
      school[f.key] = raw;
    });

    // Resolve every closed-vocabulary field; collect the ones we could not map.
    const fieldIssues = [];
    for (const [key, spec] of Object.entries(CLOSED_FIELD_SPECS)) {
      if (!(key in rawByKey)) continue;
      const res = spec.match(rawByKey[key]);
      const bucket = spec.target === "yearAdmin" ? yearAdmin : school;
      bucket[key] = res.value;
      if (res.status === "none") {
        fieldIssues.push({
          field: key, label: spec.label, target: spec.target, kind: spec.kind,
          allowEmpty: !!spec.allowEmpty, raw: rawByKey[key],
          options: spec.options ? spec.options() : undefined,
          recognized: res.value, unknown: res.unknown || [],
        });
      }
    }
    if ("student_count" in rawByKey) {
      fieldIssues.push({ field: "student_count", label: "מס' תלמידים", target: "school", kind: "number", raw: rawByKey.student_count });
    }

    const coordRes = resolveCoordinator(coordinatorRaw, school);
    const coordinator = coordRes?.role || null;
    const coordinatorName = coordinator ? (school[COORDINATOR_NAME_FIELD[coordinator]] || "") : "";

    const advisorBase = {};
    const advisorProblems = {};
    for (const t of ["gefen", "current", "district"]) {
      const r = resolveAdvisorCell(advisorRaw[t], idx);
      advisorBase[t] = r.ids;
      advisorProblems[t] = r.problems.map(p => ({ ...p, type: t, typeLabel: SERVICE_TYPE_TABS.find(s => s.key === t)?.label || t }));
    }
    const requiredTypes = yearAdmin.client_status === "active" ? activeServiceTypes(yearAdmin.service_type) : [];

    const financeSoftware = matchFinanceSoftware(financeSoftwareRaw);
    school.finance_software = financeSoftware.value;

    const problems = [];
    if (!school.name || !school.symbol) problems.push({ kind: "missing_identity" });
    if (!coordinator || !coordinatorName) {
      problems.push({ kind: "coordinator_issue", suggestedRole: coordinator || "", suggestedName: coordinatorName, raw: coordinatorRaw });
    }
    if (financeSoftware.status === "none") problems.push({ kind: "finance_software_issue", raw: financeSoftwareRaw });
    for (const fi of fieldIssues) problems.push({ kind: "field_issue", field: fi.field });
    for (const t of ["gefen", "current", "district"]) problems.push(...advisorProblems[t]);
    for (const t of requiredTypes) {
      if (advisorBase[t].length === 0 && advisorProblems[t].length === 0) {
        problems.push({ kind: "advisor_missing_required", type: t, typeLabel: SERVICE_TYPE_TABS.find(s => s.key === t)?.label || t });
      }
    }

    return {
      rowIndex: i, excelRow: i + 2,
      school, yearAdmin, coordinatorRaw, coordinator, coordinatorName, coordinatorVia: coordRes?.via || null, generalNotes,
      financeSoftwareRaw, financeSoftwareIssue: financeSoftware.status === "none",
      fieldIssues, advisorRaw, advisorBase, advisorProblems, requiredTypes, problems,
      name: school.name || "", symbol: school.symbol || "",
    };
  }

  // Build final straight from the parsed row (fast path — no problems to resolve).
  function baseFinal(planRow) {
    return {
      school: { ...planRow.school, meeting_coordinator: planRow.coordinator },
      yearAdmin: { ...planRow.yearAdmin },
      advisorIdsByType: {
        gefen: [...planRow.advisorBase.gefen],
        current: [...planRow.advisorBase.current],
        district: [...planRow.advisorBase.district],
      },
    };
  }

  async function confirmImport(mapping) {
    if (!importMappingData) return;
    const { dataRows } = importMappingData;
    setImportMappingData(null);
    setImportResult(null);
    // The org users list is loaded lazily (only on the משתמשים/billing tabs). The import
    // needs it to match advisor cells by name/email/phone — fetch it now if it's empty.
    let userList = users;
    if (!userList || userList.length === 0) {
      setImportProgressMsg("טוען משתמשים...");
      try {
        const res = await axios.get("/schools/users/all");
        userList = Array.isArray(res.data) ? res.data : [];
        setUsers(userList);
      } catch {
        userList = [];
      }
      setImportProgressMsg("");
    }
    const idx = buildUserMatchIndex(userList);
    const rows = dataRows.map((row, i) => parseImportRow(row, i, mapping, idx));
    if (rows.some(r => r.problems.length > 0)) {
      setImportPlan({ rows });
      return;
    }
    commitSchoolImport(rows.map(r => ({ ...r, final: baseFinal(r) })));
  }

  // Write phase — shared by the fast path and the modal's "onCommit". Each row must
  // already carry `final` = { school, coordinator?, advisorIdsByType }.
  async function commitSchoolImport(resolvedRows) {
    setImportPlan(null);
    setImporting(true);
    setImportResult(null);
    let imported = 0;
    const errors = [];
    for (let n = 0; n < resolvedRows.length; n++) {
      const r = resolvedRows[n];
      setImportProgressMsg(`מייבא... ${n + 1} / ${resolvedRows.length}`);
      const school = { ...r.final.school };
      if (r.final.coordinator) {
        school.meeting_coordinator = r.final.coordinator.role;
        school[COORDINATOR_NAME_FIELD[r.final.coordinator.role]] = r.final.coordinator.name;
      }
      if (!school.name || !school.symbol || !school.meeting_coordinator || !school[COORDINATOR_NAME_FIELD[school.meeting_coordinator]]) {
        errors.push(`שורה ${r.excelRow}: חסרים פרטי חובה (שם / סמל / מתאם פגישות) — לא יובאה`);
        continue;
      }
      try {
        const res = await axios.post("/schools/", school);
        const newId = res.data.id;
        imported++;
        const yearAdmin = r.final.yearAdmin || r.yearAdmin || {};
        if (Object.values(yearAdmin).some(v => v !== null && v !== undefined && v !== "")) {
          try {
            await axios.put(`/schools/${newId}/year-admin-data`, yearAdmin, { params: { academic_year: DEFAULT_ACADEMIC_YEAR } });
          } catch {
            errors.push(`שורה ${r.excelRow} (${school.name}): שמירת נתוני השנה (סוג שירות / סטטוס / הקצאות) נכשלה`);
          }
        }
        for (const t of ["gefen", "current", "district"]) {
          for (const advisorId of (r.final.advisorIdsByType[t] || [])) {
            try {
              await axios.post(`/schools/${newId}/advisors/${t}`, { advisor_id: advisorId });
            } catch {
              const label = SERVICE_TYPE_TABS.find(s => s.key === t)?.label || t;
              errors.push(`שורה ${r.excelRow} (${school.name}): שיוך יועץ ${label} נכשל`);
            }
          }
        }
        const notes = String(r.generalNotes || "").trim();
        if (notes) {
          try {
            await axios.post(`/schools/${newId}/notes`, { note_type: "general", content: notes, imported_from_excel: true });
          } catch {
            errors.push(`שורה ${r.excelRow} (${school.name}): שמירת ההערה הכללית נכשלה`);
          }
        }
      } catch (err) {
        const detail = err.response?.data?.detail || "שגיאה לא ידועה";
        errors.push(`שורה ${r.excelRow} (${school.name}): ${detail}`);
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
  const showAttendanceTab = myRole === "owner" || myRole === "manager";
  const showCallsTab = myRole === "owner" || myRole === "manager";
  const showPerformanceTab = myRole === "owner" || myRole === "manager";
  const showCollectionTab = myRole === "owner" || myRole === "manager";
  const AGENT_WIDGET_ENABLED = false; // temporarily hidden from frontend while under improvement — flip to true to restore
  const showAgentWidget = AGENT_WIDGET_ENABLED && (myRole === "owner" || myRole === "manager");
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
    const breakdownCol = MEETING_TYPE_BREAKDOWN_COL_META[key];
    if (breakdownCol) {
      return school.meetings_stats?.by_type?.[breakdownCol.breakdownType]?.[breakdownCol.breakdownMetric] ?? -1;
    }
    switch (key) {
      case "symbol": return school.symbol || "";
      case "city": return school.city || "";
      case "authority": return school.authority || "";
      case "district": return school.district || "";
      case "finance_software":
        return FINANCE_SOFTWARE_OPTIONS.find(o => o.value === school.finance_software)?.label || school.finance_software || "";
      case "stage": return ADMIN_SCHOOL_STAGE_LABEL[school.stage] || school.stage || "";
      case "meetings_completed": return school.meetings_stats?.completed ?? -1;
      case "meetings_hours": return school.meetings_stats?.total_minutes ?? -1;
      case "contract_sent": case "contract_received":
      case "closure_parents_status": case "closure_authority_status":
        return yad[key] === true ? 2 : yad[key] === false ? 1 : 0;
      case "contract_file": return yad.contract_file_name || "";
      case "control_letter_received_date": return formatDDMMYY(controlLetterFieldValue(school, "received_date"));
      case "control_letter_target_date": return formatDDMMYY(controlLetterFieldValue(school, "target_date"));
      case "control_letter_days_to_answer": return controlLetterFieldValue(school, "days_to_answer") ?? -1;
      case "control_letter_status": {
        const v = controlLetterFieldValue(school, "status");
        return v ? (CONTROL_LETTER_STATUS_MAP[v]?.label || v) : "";
      }
      case "control_letter_notes": return controlLetterFieldValue(school, "notes") || "";
      case "control_letter_original_file": return controlLetterFieldValue(school, "original_letter_file_name") || "";
      case "control_letter_response_file": return controlLetterFieldValue(school, "response_letter_file_name") || "";
      case "service_type": {
        const opt = SERVICE_TYPE_OPTIONS.find(o => o.value === yad.service_type);
        return opt ? opt.label : (yad.service_type || "");
      }
      case "order_method": {
        return (yad.order_method || [])
          .map(v => FUNDING_METHOD_OPTIONS.find(o => o.value === v)?.label || v)
          .join(", ");
      }
      case "advisor_gefen": return (school.advisors_gefen || []).map(a => a.full_name || a.email).join(", ");
      case "advisor_current": return (school.advisors_current || []).map(a => a.full_name || a.email).join(", ");
      case "advisor_district": return (school.advisors_district || []).map(a => a.full_name || a.email).join(", ");
      case "quarterly_notes_1": case "quarterly_notes_2": case "quarterly_notes_3": case "quarterly_notes_4": {
        const q = key.slice(-1);
        const summary = quarterlyNotesSummary[school.id]?.[q];
        if (!summary || !summary.count) return "";
        return summary.latest_segment?.content || `(${summary.count} הערות)`;
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
  // Dynamic filter options for the 3 advisor-name columns — deduplicated {id, name} pairs
  // collected from every school's already-loaded advisors_gefen/current/district list.
  function adminAdvisorFilterOptions(key) {
    const field = key === "advisor_gefen" ? "advisors_gefen" : key === "advisor_current" ? "advisors_current" : "advisors_district";
    const map = new Map();
    for (const s of schools) {
      for (const a of (s[field] || [])) map.set(a.id, a.full_name || a.email);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "he"));
  }
  const visibleAdminColOrder = adminColOrder.filter(k => adminColVisible[k] && ADMIN_ALL_COLUMNS.some(c => c.key === k));
  const adminColumnCategories = [
    { title: "כללי", cols: ADMIN_IDENTITY_COLUMNS },
    { title: "הקצאות", cols: ADMIN_ALLOCATION_COLUMNS },
    { title: "פגישות שבוצעו", cols: ADMIN_MEETINGS_DONE_COLUMNS },
    { title: "ניהולי", cols: ADMIN_DATA_COLUMNS },
  ];

  const tabs = [
    { id: "schools", label: "בתי ספר" },
    { id: "users", label: "משתמשים" },
    { id: "tasks", label: "משימות" },
    { id: "meetings", label: "פגישות" },
    ...(showCallsTab ? [{ id: "calls", label: "שיחות" }] : []),
    ...(showPerformanceTab ? [{ id: "performance", label: "ביצועים" }] : []),
    ...(showAttendanceTab ? [{ id: "attendance", label: "שעון נוכחות" }] : []),
    ...(showCollectionTab ? [{ id: "collection", label: "גבייה" }] : []),
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
          ["schools", "meetings", "calls", "performance", "collection", "tasks", "attendance"].includes(activeTab) ? "max-w-[100rem]" : "max-w-4xl"
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
                <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6 mb-4">
                  <div className={SECTION_HEADER_CLS}>
                    {sectionTitle(Building2, editingSchool ? "עריכת פרטי בית הספר" : "הוספת בית ספר חדש", "bg-blue-50 text-blue-600")}
                    {editingSchool && canDeleteSchool && (
                      <div className="relative" ref={schoolFormDotsRef}>
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

                  {/* 3×3 tile grid — same visual language as SchoolPage.jsx's פרטי מוסד */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className={TILE_CLS}>
                      <label htmlFor="school-name" className={TILE_LABEL_CLS}>שם מוסד</label>
                      <input id="school-name" className={`input-field ${triedSave && !schoolForm.name ? "border-red-400" : ""}`}
                        autoComplete="off" value={schoolForm.name}
                        onChange={e => setSchoolForm(p => ({ ...p, name: e.target.value }))} />
                      {triedSave && !schoolForm.name && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-city" className={TILE_LABEL_CLS}>עיר</label>
                      <input id="school-city" className="input-field" autoComplete="off" value={schoolForm.city}
                        onChange={e => setSchoolForm(p => ({ ...p, city: e.target.value }))} />
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-finance-software" className={TILE_LABEL_CLS}>תוכנת כספים</label>
                      <select id="school-finance-software" className="input-field text-sm"
                        value={schoolForm.finance_software}
                        onChange={e => setSchoolForm(p => ({ ...p, finance_software: e.target.value }))}>
                        {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-symbol" className={TILE_LABEL_CLS}>סמל מוסד</label>
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

                    <div className={TILE_CLS}>
                      <label htmlFor="school-authority" className={TILE_LABEL_CLS}>בעלות</label>
                      <input id="school-authority" className="input-field" autoComplete="off" value={schoolForm.authority}
                        onChange={e => setSchoolForm(p => ({ ...p, authority: e.target.value }))} />
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-phone" className={TILE_LABEL_CLS}>טלפון בית הספר</label>
                      <input id="school-phone"
                        className={`input-field ${schoolForm.school_phone && schoolPhoneError ? "border-red-400" : ""}`}
                        autoComplete="off" value={schoolForm.school_phone}
                        onChange={e => setSchoolForm(p => ({ ...p, school_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                        dir="ltr" inputMode="numeric" />
                      {schoolForm.school_phone && schoolPhoneError && (
                        <span className="text-xs text-red-500 block mt-0.5" role="alert">{schoolPhoneError}</span>
                      )}
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor={editingSchool ? "school-stage-edit" : "school-stage"} className={TILE_LABEL_CLS}>שלב מוסד</label>
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

                    <div className={TILE_CLS}>
                      <label htmlFor="school-district" className={TILE_LABEL_CLS}>מחוז</label>
                      <select id="school-district" className="input-field text-sm"
                        value={schoolForm.district}
                        onChange={e => setSchoolForm(p => ({ ...p, district: e.target.value }))}>
                        <option value="">בחר</option>
                        {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-address" className={TILE_LABEL_CLS}>כתובת</label>
                      <input id="school-address" className="input-field" autoComplete="off" value={schoolForm.address}
                        onChange={e => setSchoolForm(p => ({ ...p, address: e.target.value }))} />
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-education-authority" className={TILE_LABEL_CLS}>רשות חינוך</label>
                      <input id="school-education-authority" className="input-field" autoComplete="off" value={schoolForm.education_authority}
                        onChange={e => setSchoolForm(p => ({ ...p, education_authority: e.target.value }))} />
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-sector" className={TILE_LABEL_CLS}>מגזר</label>
                      <select id="school-sector" className="input-field text-sm"
                        value={schoolForm.sector}
                        onChange={e => setSchoolForm(p => ({ ...p, sector: e.target.value }))}>
                        {SECTOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-supervision" className={TILE_LABEL_CLS}>פיקוח</label>
                      <select id="school-supervision" className="input-field text-sm"
                        value={schoolForm.supervision}
                        onChange={e => setSchoolForm(p => ({ ...p, supervision: e.target.value }))}>
                        {SUPERVISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={TILE_CLS}>
                      <span className={`${TILE_LABEL_CLS} block`}>שכבות לימוד</span>
                      <MultiSelectChips compact options={GRADE_LEVEL_OPTIONS}
                        selected={schoolForm.grade_levels || []}
                        onChange={v => setSchoolForm(p => ({ ...p, grade_levels: v }))} />
                    </div>

                    <div className={TILE_CLS}>
                      <span className={`${TILE_LABEL_CLS} block`}>ימי לימוד</span>
                      <MultiSelectChips compact options={STUDY_DAY_OPTIONS}
                        selected={schoolForm.study_days || []}
                        onChange={v => setSchoolForm(p => ({ ...p, study_days: v }))} />
                    </div>

                    <div className={TILE_CLS}>
                      <label htmlFor="school-student-count" className={TILE_LABEL_CLS}>מס' תלמידים</label>
                      <input id="school-student-count" className="input-field" autoComplete="off" value={schoolForm.student_count}
                        onChange={e => setSchoolForm(p => ({ ...p, student_count: e.target.value.replace(/\D/g, "") }))}
                        inputMode="numeric" />
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
                        className={OUTLINE_BTN_CLS}>+ הוסף שורה</button>
                      {triedSave && customDivisions.length === 0 && (
                        <p className="text-xs text-red-500 mt-1" role="alert">יש להוסיף לפחות חטיבה אחת</p>
                      )}
                    </div>
                  )}

                  {/* Contact table — אנשי קשר */}
                  <div className="mt-10 mb-2 pt-6 border-t border-slate-200/60">
                    <div className={SECTION_HEADER_CLS}>
                      {sectionTitle(Phone, "אנשי קשר", "bg-indigo-50 text-indigo-600")}
                    </div>
                    <table className="w-full text-sm border border-slate-200 border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-100 divide-x divide-slate-200">
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 whitespace-nowrap w-28"></th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">שם</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">טלפון</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">מייל</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">יום חופשי</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">מתאם פגישות</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {[
                          effectiveSchoolFormStage === "sheshshnati" ? PRINCIPAL_TICHON_ROW : PRINCIPAL_SINGLE_ROW,
                          ...(effectiveSchoolFormStage === "sheshshnati" && !schoolForm.principal_same_person ? [PRINCIPAL_CHATIVA_ROW] : []),
                          ...CONTACT_ROWS,
                        ].map(row => (
                          <tr key={row.nameField} className="divide-x divide-slate-200">
                            <td className="py-3 pr-1 text-sm font-normal text-gray-900 align-top">{row.label}</td>
                            <td className="py-3 px-2">
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
                            <td className="py-3 px-2">
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
                            <td className="py-3 px-2">
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
                            <td className="py-3 px-2">
                              <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                                selected={schoolForm[row.dayOffField] || []}
                                onChange={v => setSchoolForm(p => ({ ...p, [row.dayOffField]: v }))} />
                            </td>
                            <td className="py-3 px-2 text-center">
                              <label htmlFor={`admin-coord-${row.coordValue}`} className="sr-only">{row.label} אחראי/ת לתיאום פגישות</label>
                              <input id={`admin-coord-${row.coordValue}`} type="radio" name="admin-meeting-coordinator"
                                className="w-4 h-4 accent-blue-600"
                                checked={schoolForm.meeting_coordinator === row.coordValue}
                                disabled={!schoolForm[row.nameField]}
                                onChange={() => setSchoolForm(p => ({ ...p, meeting_coordinator: row.coordValue }))} />
                            </td>
                          </tr>
                        ))}

                        {effectiveSchoolFormStage === "sheshshnati" && (
                          <tr className="divide-x divide-slate-200">
                            <td></td>
                            <td colSpan={5} className="py-3 px-2">
                              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                                <input type="checkbox" className="w-3.5 h-3.5 rounded accent-blue-600"
                                  checked={!!schoolForm.principal_same_person}
                                  onChange={e => setSchoolForm(p => ({ ...p, principal_same_person: e.target.checked }))} />
                                אותו מנהל/ת לשתי החטיבות
                              </label>
                            </td>
                          </tr>
                        )}

                        {/* Extra contact rows */}
                        {(schoolForm.extra_contacts || []).map((ec, i) => (
                          <tr key={`extra-${i}`} className="divide-x divide-slate-200">
                            <td className="py-3 pr-1">
                              <label htmlFor={`extra-role-${i}`} className="sr-only">תפקיד</label>
                              <input id={`extra-role-${i}`} className="input-field text-sm" value={ec.role}
                                onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], role: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                                autoComplete="off" placeholder="תפקיד..." />
                            </td>
                            <td className="py-3 px-2">
                              <label htmlFor={`extra-name-${i}`} className="sr-only">שם</label>
                              <input id={`extra-name-${i}`} className="input-field text-sm" value={ec.name}
                                onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], name: e.target.value }; return { ...p, extra_contacts: ec2 }; })}
                                autoComplete="off" placeholder="שם..." />
                            </td>
                            <td className="py-3 px-2">
                              <label htmlFor={`extra-phone-${i}`} className="sr-only">טלפון</label>
                              <input id={`extra-phone-${i}`} className="input-field text-sm" value={ec.phone}
                                onChange={e => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], phone: e.target.value.replace(/\D/g, "").slice(0, 10) }; return { ...p, extra_contacts: ec2 }; })}
                                dir="ltr" inputMode="numeric" autoComplete="off" placeholder="טלפון..." />
                            </td>
                            <td className="py-3 px-2">
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
                            <td className="py-3 px-2">
                              <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                                selected={ec.day_off || []}
                                onChange={v => setSchoolForm(p => { const ec2 = [...(p.extra_contacts || [])]; ec2[i] = { ...ec2[i], day_off: v }; return { ...p, extra_contacts: ec2 }; })} />
                            </td>
                            <td className="py-3 px-2 text-center">
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
                                className={`${OUTLINE_BTN_CLS} inline-flex items-center gap-1`}>
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

                  {/* פרטי ליווי — school_year_admin_data fields, same tiles as SchoolPage.jsx/AddSchoolPage.jsx */}
                  <div className="mt-10 pt-6 border-t border-slate-200/60">
                    <div className={SECTION_HEADER_CLS}>
                      {sectionTitle(Handshake, "פרטי ליווי", "bg-emerald-50 text-emerald-600")}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className={TILE_CLS}>
                        <label htmlFor="admin-ys-client-status" className={TILE_LABEL_CLS}>סטטוס לקוח</label>
                        <select id="admin-ys-client-status" className="input-field text-sm"
                          value={yearAdminForm.client_status || ""}
                          onChange={e => setYearAdminForm(p => ({ ...p, client_status: e.target.value || null }))}>
                          <option value="">בחר</option>
                          {CLIENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      <div className={TILE_CLS}>
                        <label htmlFor="admin-ys-service-type" className={TILE_LABEL_CLS}>סוג שירות</label>
                        <select id="admin-ys-service-type" className="input-field text-sm"
                          value={yearAdminForm.service_type || ""}
                          onChange={e => setYearAdminForm(p => ({ ...p, service_type: e.target.value || null }))}>
                          <option value="">בחר</option>
                          {SERVICE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      <div className={TILE_CLS}>
                        <label htmlFor="admin-ys-order-amount" className={TILE_LABEL_CLS}>מחיר כולל מע"מ</label>
                        <input id="admin-ys-order-amount" className="input-field text-sm" type="text" inputMode="numeric" autoComplete="off"
                          defaultValue={formatAmount(yearAdminForm.order_amount_gefen)}
                          onBlur={e => {
                            const v = parseAmount(e.target.value);
                            e.target.value = formatAmount(v);
                            setYearAdminForm(p => ({ ...p, order_amount_gefen: v }));
                          }} />
                      </div>

                      <div className={TILE_CLS}>
                        <span className={TILE_LABEL_CLS}>אמצעי הזמנה</span>
                        <MultiSelectChips compact options={FUNDING_METHOD_OPTIONS}
                          selected={yearAdminForm.order_method || []}
                          onChange={v => setYearAdminForm(p => ({ ...p, order_method: v.length ? v : [] }))} />
                      </div>

                      <div className={`${TILE_CLS} col-span-2`}>
                        <span className={`${TILE_LABEL_CLS} inline-flex items-center gap-1.5`}>
                          גישה
                          <span title="בחר למי תהיה גישה לצפות בנתוני בית הספר. 'כולם' מאפשר לכל היועצים במערכת לראות את בית הספר."
                            className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-xs flex items-center justify-center flex-shrink-0 cursor-help"
                            aria-label="מידע על הגדרת גישה">?</span>
                        </span>
                        <AccessSelector
                          restrictTo={schoolForm.restrict_access_to}
                          users={users}
                          loadingUsers={loadingUsers}
                          onChange={val => { setAccessLinkedToAdvisors(false); setSchoolForm(p => ({ ...p, restrict_access_to: val })); }}
                          onSelectAdvisors={() => setAccessLinkedToAdvisors(true)}
                          schoolAdvisors={draftLinkedAdvisorIds.map(id => users.find(u => u.id === id)).filter(Boolean)}
                        />
                      </div>
                    </div>

                    {/* יועצים מלווים — per-service-type advisor editor (גפן/שוטף/מחוז) */}
                    <div className="mt-6 pt-6 border-t border-slate-200/60">
                      <div className={SECTION_HEADER_CLS}>
                        {sectionTitle(UsersRound, "יועצים מלווים", "bg-violet-50 text-violet-600")}
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        {SERVICE_TYPE_TABS.map(({ key, label }) => {
                          const isRequired = activeServiceTypes(yearAdminForm.service_type).includes(key);
                          const invalid = triedSave && isRequired && draftTypedAdvisorIds[key].length === 0;
                          return (
                            <div key={key} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-3">
                              <p className="text-sm font-semibold text-slate-700 text-center mb-3">
                                {label}{isRequired && <span className="text-red-500"> *</span>}
                              </p>
                              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 10, alignItems: "start" }}>
                                <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">יועץ מלווה:</span>
                                <div className="py-0.5">
                                  <AdvisorSearch compact schoolId={editingSchool ? editingSchool.id : "new"}
                                    selectedIds={draftTypedAdvisorIds[key]} users={users} loadingUsers={loadingUsers}
                                    onChange={ids => setDraftTypedAdvisorIds(p => ({ ...p, [key]: ids }))}
                                    onRetry={loadUsers} invalid={invalid} />
                                  {invalid && (
                                    <span className="text-xs text-red-500 mt-1 block" role="alert">יש לבחור לפחות יועץ אחד</span>
                                  )}
                                </div>

                                <label htmlFor={`admin-ys-alloc-${key}`} className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">הקצאת פגישות:</label>
                                <div className="py-0.5">
                                  <input id={`admin-ys-alloc-${key}`} type="number" min="0" className="input-field text-sm"
                                    value={yearAdminForm[`meeting_allocation_${key}`] ?? ""}
                                    onChange={e => {
                                      const v = e.target.value === "" ? null : Number(e.target.value);
                                      setYearAdminForm(p => ({ ...p, [`meeting_allocation_${key}`]: v }));
                                    }} />
                                </div>

                                <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]">זמן לפגישה:</span>
                                <div className="py-0.5">
                                  <HourMinuteInput idPrefix={`admin-ys-duration-${key}`} label={`זמן לפגישה [${label}]`}
                                    minutes={yearAdminForm[`meeting_duration_${key}`] ?? null}
                                    onChange={v => setYearAdminForm(p => ({ ...p, [`meeting_duration_${key}`]: v }))} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3 mt-5">
                    <button onClick={saveSchool} disabled={savingSchool} className={`${editingSchool ? "btn-green-light" : "btn-blue"} text-sm px-5 py-2`}>
                      {savingSchool ? "שומר..." : editingSchool ? "שמור שינויים" : "שמור"}
                    </button>
                    <button onClick={() => { setShowSchoolForm(false); setDraftTypedAdvisorIds(originalTypedAdvisorIds); }} className="btn-ghost text-sm px-5 py-2">ביטול</button>
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
                                            options={ADMIN_ADVISOR_FILTER_COLS.has(key) ? adminAdvisorFilterOptions(key) : undefined}
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
                                  if (key === "district") return <td key={key} className={tdClass}>{school.district || "—"}</td>;
                                  if (key === "finance_software") return <td key={key} className={tdClass}>{FINANCE_SOFTWARE_OPTIONS.find(o => o.value === school.finance_software)?.label || school.finance_software || "—"}</td>;
                                  if (key === "stage") return <td key={key} className={tdClass}>{ADMIN_SCHOOL_STAGE_LABEL[school.stage] || school.stage || "—"}</td>;
                                  if (key === "meetings_completed") return <td key={key} className={tdClass}>{school.meetings_stats ? String(school.meetings_stats.completed) : "—"}</td>;
                                  if (key === "meetings_hours") return <td key={key} className={tdClass}>{school.meetings_stats ? formatAdminMeetingHours(school.meetings_stats.total_minutes) : "—"}</td>;
                                  if (MEETING_TYPE_BREAKDOWN_COL_META[key]) {
                                    const bc = MEETING_TYPE_BREAKDOWN_COL_META[key];
                                    const bucket = school.meetings_stats?.by_type?.[bc.breakdownType];
                                    return <td key={key} className={tdClass}>{
                                      !bucket ? "—"
                                        : bc.breakdownMetric === "completed" ? String(bucket.completed ?? 0)
                                        : formatAdminMeetingHours(bucket.total_minutes ?? 0)
                                    }</td>;
                                  }
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
                                        aria-label='מחיר כולל מע"מ'
                                        className={`${ADMIN_FIELD_CLS} w-24`}
                                      />
                                    </td>
                                  );
                                  if ([
                                    "requested_price", "hours_ordered", "rate", "payment_received", "payment_requests_sent", "receipts_sent",
                                    "meeting_allocation_gefen", "meeting_allocation_current", "meeting_allocation_district",
                                  ].includes(key)) return (
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
                                  if (key === "meeting_duration_gefen" || key === "meeting_duration_current" || key === "meeting_duration_district") return (
                                    <td key={key} className={tdClass}>
                                      <HourMinuteInput idPrefix={`${key}-${rowKey}`} label={ADMIN_DATA_COLUMNS.find(c => c.key === key)?.label}
                                        minutes={yad[key] ?? null}
                                        onChange={v => saveYearAdminField(school.id, key, v)} />
                                    </td>
                                  );
                                  if (key === "advisor_gefen" || key === "advisor_current" || key === "advisor_district") {
                                    const list = school[key === "advisor_gefen" ? "advisors_gefen" : key === "advisor_current" ? "advisors_current" : "advisors_district"] || [];
                                    return (
                                      <td key={key} className={tdClass}>
                                        {list.length === 0 ? "—" : (
                                          <div className="flex flex-wrap gap-1">
                                            {list.map(a => (
                                              <span key={a.id} className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                                {a.full_name || a.email}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                    );
                                  }
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
                                  if (key === "closure_parents_status" || key === "closure_authority_status") {
                                    const val = yad[key];
                                    const colorCls = val === true ? "text-green-600" : val === false ? "text-red-600" : "text-slate-400";
                                    return (
                                      <td key={key} className={tdClass}>
                                        <label htmlFor={`${key}-${rowKey}`} className="sr-only">{ADMIN_DATA_COLUMNS.find(c => c.key === key)?.label}</label>
                                        <select id={`${key}-${rowKey}`} className={`${ADMIN_FIELD_CLS} w-24 font-semibold ${colorCls}`}
                                          value={val === true ? "yes" : val === false ? "no" : ""}
                                          onChange={e => saveYearAdminField(school.id, key, e.target.value === "yes" ? true : e.target.value === "no" ? false : null)}>
                                          <option value="">—</option>
                                          <option value="yes">סגור</option>
                                          <option value="no">לא סגור</option>
                                        </select>
                                      </td>
                                    );
                                  }
                                  if (key === "closure_parents_notes" || key === "closure_authority_notes") {
                                    const notesKey = `${school.id}:${key}`;
                                    const isEditing = editingAdminNotesKey === notesKey;
                                    const text = yad[key] || "";
                                    return (
                                      <td key={key} className={tdClass}>
                                        {isEditing ? (
                                          <label>
                                            <span className="sr-only">{ADMIN_DATA_COLUMNS.find(c => c.key === key)?.label}</span>
                                            <textarea
                                              autoFocus
                                              rows={2}
                                              className={`${ADMIN_FIELD_CLS} w-48 resize-y`}
                                              defaultValue={text}
                                              onBlur={e => {
                                                const v = e.target.value.trim() || null;
                                                setEditingAdminNotesKey(null);
                                                if (v !== (text || null)) saveYearAdminField(school.id, key, v);
                                              }}
                                            />
                                          </label>
                                        ) : (
                                          <button type="button" onClick={() => setEditingAdminNotesKey(notesKey)}
                                            className="text-right text-slate-600 hover:text-blue-600 truncate max-w-[160px] block">
                                            {text ? (text.length > 30 ? `${text.slice(0, 30)}…` : text) : "—"}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  }
                                  if (key === "quarterly_notes_1" || key === "quarterly_notes_2" || key === "quarterly_notes_3" || key === "quarterly_notes_4") {
                                    const q = key.slice(-1);
                                    const summary = quarterlyNotesSummary[school.id]?.[q] || { count: 0, latest_segment: null };
                                    const notesKey = `${school.id}:${key}`;
                                    const isEditing = editingAdminNotesKey === notesKey;

                                    if (summary.count >= 2) {
                                      return (
                                        <td key={key} className={tdClass}>
                                          <button type="button"
                                            onClick={() => setShowSchoolNotesModalFor({ schoolId: school.id, quarter: Number(q) })}
                                            className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none" aria-label="פתח הערות">
                                            📝
                                          </button>
                                        </td>
                                      );
                                    }

                                    const text = summary.latest_segment?.content || "";
                                    return (
                                      <td key={key} className={tdClass}>
                                        {isEditing ? (
                                          <label>
                                            <span className="sr-only">{ADMIN_DATA_COLUMNS.find(c => c.key === key)?.label}</span>
                                            <textarea
                                              autoFocus
                                              rows={2}
                                              className={`${ADMIN_FIELD_CLS} w-48 resize-y`}
                                              defaultValue={text}
                                              onBlur={e => {
                                                const v = e.target.value.trim();
                                                setEditingAdminNotesKey(null);
                                                if (v === text) return;
                                                if (summary.count === 1) {
                                                  if (v) saveQuarterlyNoteEdit(school.id, summary.latest_segment.id, q, v);
                                                } else if (v) {
                                                  createQuarterlyNote(school.id, q, v);
                                                }
                                              }}
                                            />
                                          </label>
                                        ) : (
                                          <button type="button" onClick={() => setEditingAdminNotesKey(notesKey)}
                                            className="text-right text-slate-600 hover:text-blue-600 truncate max-w-[160px] block">
                                            {text ? (text.length > 30 ? `${text.slice(0, 30)}…` : text) : "—"}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  }
                                  if (key === "control_letter_received_date" || key === "control_letter_target_date") {
                                    const iso = controlLetterFieldValue(school, key === "control_letter_target_date" ? "target_date" : "received_date");
                                    return <td key={key} className={tdClass}>{iso ? formatDDMMYY(iso) : "—"}</td>;
                                  }
                                  if (key === "control_letter_days_to_answer") {
                                    const v = controlLetterFieldValue(school, "days_to_answer");
                                    return <td key={key} className={tdClass}>{v ?? "—"}</td>;
                                  }
                                  if (key === "control_letter_status") {
                                    const v = controlLetterFieldValue(school, "status");
                                    const s = CONTROL_LETTER_STATUS_MAP[v || ""] || CONTROL_LETTER_STATUS_MAP[""];
                                    return (
                                      <td key={key} className={tdClass}>
                                        {v ? (
                                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
                                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} aria-hidden="true" />
                                            {s.label}
                                          </span>
                                        ) : "—"}
                                      </td>
                                    );
                                  }
                                  if (key === "control_letter_notes") {
                                    const text = controlLetterFieldValue(school, "notes") || "";
                                    return (
                                      <td key={key} className={tdClass}>
                                        <span title={text} className="truncate max-w-[160px] block">
                                          {text ? (text.length > 30 ? `${text.slice(0, 30)}…` : text) : "—"}
                                        </span>
                                      </td>
                                    );
                                  }
                                  if (key === "control_letter_original_file" || key === "control_letter_response_file") {
                                    const kind = key === "control_letter_original_file" ? "original" : "response";
                                    const fileName = controlLetterFieldValue(school, `${kind}_letter_file_name`);
                                    const primary = pickPrimaryControlLetter(school.control_letters);
                                    return (
                                      <td key={key} className={tdClass}>
                                        {fileName && primary ? (
                                          <button
                                            type="button"
                                            onClick={() => downloadControlLetterFile(school.id, primary.division_type, kind, fileName)}
                                            className="text-xs text-blue-600 hover:underline truncate max-w-[100px]"
                                          >
                                            {fileName}
                                          </button>
                                        ) : "—"}
                                      </td>
                                    );
                                  }
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

                                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-3">
                                      {SERVICE_TYPE_TABS.map(({ key, label }) => (
                                        <div key={key}>
                                          <p className="text-xs text-slate-800 mb-2 font-medium">יועץ מלווה [{label}]</p>
                                          <AdvisorSearch
                                            schoolId={school.id}
                                            selectedIds={(typedSchoolAdvisors[school.id]?.[key] || []).map(a => a.id)}
                                            users={users}
                                            loadingUsers={loadingUsers}
                                            onChange={newIds => handleExpandedTypedAdvisorChange(school.id, key, newIds)}
                                            onRetry={loadUsers}
                                          />
                                        </div>
                                      ))}
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
                <div className="flex justify-end mb-4">
                  <button onClick={() => setShowAddUserModal(true)} className="btn-blue text-sm px-4 py-2">
                    הוסף משתמש
                  </button>
                </div>
              )}

              {showAddUserModal && (myRole === "owner" || canInviteUsers) && (
                <AddUserModal
                  inviteForm={inviteForm}
                  setInviteForm={setInviteForm}
                  myRole={myRole}
                  inviteUser={inviteUser}
                  inviting={inviting}
                  inviteMsg={inviteMsg}
                  WORK_PHONE_REGEX={WORK_PHONE_REGEX}
                  userImportRef={userImportRef}
                  handleUserImport={handleUserImport}
                  importingUsers={importingUsers}
                  userImportProgressMsg={userImportProgressMsg}
                  userImportResult={userImportResult}
                  onClose={() => setShowAddUserModal(false)}
                />
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
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">תפקיד</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">שם</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">אימייל</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">טלפון עבודה</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">תחומי ידע</th>
                      <th scope="col" className="px-5 py-3 text-center text-slate-500 font-medium whitespace-nowrap">הרשאות בהתאמה אישית</th>
                      {voicenterEnabled && (
                        <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">שיוך VOICENTER</th>
                      )}
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium whitespace-nowrap">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByRole(users).map(u => (
                      <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 whitespace-nowrap">
                          <RoleSelect
                            value={u.role}
                            onChange={v => requestRoleChange(u, v)}
                            disabled={canChangeRole !== true || (myRole === "manager" && u.role === "owner") || (myRole === "manager" && u.id === myUserId)}
                            ariaLabel={`תפקיד ${u.full_name || u.email}`}
                            title={
                              myRole === "manager" && u.id === myUserId ? "מנהל לא יכול לשנות את תפקיד עצמו" :
                              canChangeRole !== true ? "אין הרשאה לשנות תפקידים" :
                              myRole === "manager" && u.role === "owner" ? "מנהל לא יכול לשנות תפקיד של בעלים" :
                              undefined
                            }
                            options={[
                              { value: "advisor", label: "יועץ" },
                              { value: "manager", label: "מנהל" },
                              ...((myRole === "owner" || u.role === "owner") ? [{ value: "owner", label: "בעלים" }] : []),
                            ]}
                          />
                        </td>
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
                        <td className="px-5 py-3 whitespace-nowrap" dir="ltr">
                          {phoneEditingIds.has(u.id) ? (
                            <>
                              <label htmlFor={`phone-${u.id}`} className="sr-only">טלפון עבודה {u.full_name || u.email}</label>
                              <input id={`phone-${u.id}`} autoFocus type="tel" inputMode="numeric" dir="ltr"
                                className={`input-field text-sm w-32 ${phoneErrors[u.id] ? "border-red-400" : ""}`}
                                value={phoneDrafts[u.id] !== undefined ? phoneDrafts[u.id] : (u.work_phone || "")}
                                maxLength={10}
                                onChange={e => setPhoneDrafts(p => ({ ...p, [u.id]: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                                onBlur={() => saveUserPhone(u)}
                                onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") cancelEditPhone(u); }}
                              />
                              {phoneErrors[u.id] && (
                                <p role="alert" className="text-xs text-red-500 mt-1 whitespace-normal">{phoneErrors[u.id]}</p>
                              )}
                            </>
                          ) : u.work_phone ? (
                            <button type="button" onClick={() => startEditPhone(u)}
                              className="text-slate-900 bg-transparent border-0 p-0 m-0 cursor-pointer hover:text-blue-600">
                              {formatWorkPhone(u.work_phone)}
                            </button>
                          ) : (
                            <div className="flex justify-center">
                              <button
                                type="button"
                                onClick={() => startEditPhone(u)}
                                aria-label={`הוסף טלפון עבודה: ${u.full_name || u.email}`}
                                className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                              >
                                <span aria-hidden="true" className="text-base leading-none">+</span>
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <MultiSelectChips compact options={DOMAIN_OPTIONS}
                            className={(u.control_domains || []).length === 0 ? "flex justify-center" : ""}
                            selected={u.control_domains || []}
                            onChange={v => saveUserDomains(u, v)}
                            placeholder="בחר תחומים"
                            emptyIcon />
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <div className="flex items-center justify-center">
                            {u.role !== "owner" && (
                              <button onClick={() => openOverridePanel(u)}
                                aria-label={`הרשאות אישיות: ${u.full_name || u.email}`}
                                className="relative w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                                <span aria-hidden="true" className="text-base leading-none">+</span>
                                {overrideCounts[u.id] > 0 && (
                                  <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-blue-500 text-white rounded-full leading-none">
                                    {overrideCounts[u.id]}
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        {voicenterEnabled && (
                          <td className="px-5 py-3">
                            <MultiSelectChips compact
                              options={voicenterKnownReps.map(r => ({ value: r.representative_code, label: r.representative_name || r.representative_code }))}
                              className={voicenterMappings.filter(m => m.advisor_id === u.id).length === 0 ? "flex justify-center" : ""}
                              selected={voicenterMappings.filter(m => m.advisor_id === u.id).map(m => m.representative_code)}
                              onChange={codes => saveUserVoicenterMapping(u, codes)}
                              placeholder="בחר שם ב-VOICENTER"
                              emptyIcon />
                          </td>
                        )}
                        <td className={`px-5 py-3 whitespace-nowrap relative ${(myRole === "owner" || canDeleteUsers) ? "pl-9" : ""}`}>
                          <span className="text-slate-600">
                            {u.status === "pending" ? "ממתין לאישור" : "פעיל"}
                          </span>
                          {(myRole === "owner" || canDeleteUsers) && (
                            <div className="absolute left-2 top-1/2 -translate-y-1/2">
                              <UserActionsMenu
                                open={openActionsMenu === u.id}
                                onToggle={() => setOpenActionsMenu(openActionsMenu === u.id ? null : u.id)}
                                onClose={() => setOpenActionsMenu(null)}
                                ariaLabel={`פעולות נוספות: ${u.full_name || u.email}`}
                                showResend={u.status === "pending"}
                                resending={resendingUserId === u.id}
                                resendResult={resendMsg?.id === u.id ? (resendMsg.ok ? "ok" : "error") : null}
                                onResend={() => resendInvite(u)}
                                onDelete={() => { setOpenActionsMenu(null); handleDeleteButtonClick(u); }}
                              />
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

          {/* Tasks Tab */}
          {activeTab === "tasks" && (
            <AdminTasksTab />
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
              myRole={myRole}
              canEditAutomations={myRole === "owner" || (myRole === "manager" && permDefaults?.can_edit_meeting_automations?.manager === true)}
            />
          )}

          {/* Attendance Tab */}
          {activeTab === "attendance" && showAttendanceTab && (
            <AdminAttendanceTab users={users} loadingUsers={loadingUsers} loadUsers={loadUsers} />
          )}

          {/* Calls Tab */}
          {activeTab === "calls" && showCallsTab && (
            <AdminCallsTab users={users} />
          )}

          {/* Performance Tab */}
          {activeTab === "performance" && showPerformanceTab && (
            <AdminPerformanceTab users={users} loadingUsers={loadingUsers} loadUsers={loadUsers} />
          )}

          {/* Collection Tab */}
          {activeTab === "collection" && showCollectionTab && (
            <AdminCollectionTab />
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
      {importPlan && (
        <SchoolImportProblemsModal
          rows={importPlan.rows}
          users={users}
          requiredTypesFor={(svc, status) => (status === "active" ? activeServiceTypes(svc) : [])}
          onCommit={commitSchoolImport}
          onClose={() => setImportPlan(null)}
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
      {showSchoolNotesModalFor && (
        <SchoolNotesModal
          schoolId={showSchoolNotesModalFor.schoolId}
          currentUser={{ id: myUserId, role: myRole, full_name: myFullName }}
          focusQuarter={showSchoolNotesModalFor.quarter}
          onClose={() => setShowSchoolNotesModalFor(null)}
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

