import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useLocation, useBlocker, useSearchParams } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";
import FileUpload from "../components/FileUpload";
import LoadingScreen from "../components/LoadingScreen";
import ResultsView from "../components/ResultsView";
import ClassifyModal from "../components/ClassifyModal";
import { NotesThread } from "../components/SchoolNotesModal";
import { FilesThread } from "../components/SchoolFilesSection";
import { GoalsTab } from "../components/GoalsTab";
import { SchoolYearClosureTab } from "../components/SchoolYearClosureTab";
import { ControlLetterTab } from "../components/ControlLetterTab";
import SchoolTasksTab from "../components/SchoolTasksTab";
import { CallsTable } from "../components/calls/CallsTable";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMeetingsPolling } from "../hooks/useMeetingsPolling";
import { mergeMeetingsSilently } from "../components/meetings/mergeMeetings";
import { useCompareChecks } from "../context/CompareChecksContext";
import { AdvisorSearch } from "../components/AdvisorSearch";
import { AccessSelector } from "../components/AccessSelector";
import HourMinuteInput from "../components/HourMinuteInput";
import { MultiSelectChips } from "../components/MultiSelectChips";
import { Building2, Phone, Handshake, UsersRound, MessageSquareText, Folder, CalendarDays, Pencil } from "lucide-react";
import { defaultMeetingServiceType, resolveDefaultAdvisorIds } from "../components/meetings/constants";
import { AdvisorCell } from "../components/meetings/AdvisorCell";
import AdvisorAccessGrantModal from "../components/meetings/AdvisorAccessGrantModal";
import { DatePickerPopover } from "../components/meetings/DatePickerPopover";
import { DeleteMeetingModal } from "../components/meetings/DeleteMeetingModal";
import { MeetingRow } from "../components/meetings/MeetingRow";
import { MeetingsTable } from "../components/meetings/MeetingsTable";
import { MeetingSummaryModal } from "../components/meetings/MeetingSummaryModal";
import { MeetingTypeSelect } from "../components/meetings/MeetingTypeSelect";
import MeetingNavigationGuardModal from "../components/meetings/MeetingNavigationGuardModal";
import { getMissingCriticalFields, isMeetingIncomplete } from "../components/meetings/meetingCompleteness";
import { NoParticipantsModal } from "../components/meetings/NoParticipantsModal";
import MeetingUploadComparisonModal from "../components/meetings/MeetingUploadComparisonModal";
import { NotesModal } from "../components/meetings/NotesModal";
import { ParticipantsSelector } from "../components/meetings/ParticipantsSelector";
import { StageScopeModal } from "../components/meetings/StageScopeModal";
import { TimeInput } from "../components/meetings/TimeInput";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { ACADEMIC_YEARS, DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";

const DIVISION_LABEL = {
  tikkon: "חטיבה עליונה",
  beinayim: "חטיבת ביניים",
  yesodi: "יסודי",
  other: "אחר",
};

const FINANCE_SOFTWARE_LABEL = {
  kesafim2000: "כספים 2000",
  payscool: "פייסקול",
  schoolcash: "סקולקאש",
};

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

// Collapse an unordered selection into a compact string, following the option order:
// a run of 3+ consecutive picks becomes "first-last"; runs of 1-2 and gaps are listed
// individually, joined by ", ". e.g. [א,ב,ג,ד,ו] → "א-ד, ו" ; [א..ו] → "א-ו".
function formatOrderedSelection(values, orderedOptions) {
  const order = orderedOptions.map(o => o.value);
  const labelOf = v => orderedOptions.find(o => o.value === v)?.label ?? v;
  const idxs = (values || [])
    .map(v => order.indexOf(v))
    .filter(i => i >= 0)
    .sort((a, b) => a - b);
  if (idxs.length === 0) return "";
  const parts = [];
  const flush = (start, end) => {
    if (end - start >= 2) parts.push(`${labelOf(order[start])}-${labelOf(order[end])}`);
    else for (let k = start; k <= end; k++) parts.push(labelOf(order[k]));
  };
  let runStart = idxs[0];
  let prev = idxs[0];
  for (let k = 1; k < idxs.length; k++) {
    if (idxs[k] === prev + 1) { prev = idxs[k]; continue; }
    flush(runStart, prev);
    runStart = idxs[k];
    prev = idxs[k];
  }
  flush(runStart, prev);
  return parts.join(", ");
}

const FINANCE_SOFTWARE_OPTIONS = [
  { value: "", label: "בחר" },
  { value: "kesafim2000", label: "כספים 2000" },
  { value: "payscool", label: "פייסקול" },
  { value: "schoolcash", label: "סקולקאש" },
];

const SCHOOL_STAGE_OPTIONS = [
  { value: "",            label: "בחר שלב מוסד" },
  { value: "yesodi",      label: "יסודי" },
  { value: "beinayim",    label: "חטיבת ביניים" },
  { value: "tikkon",      label: "תיכון" },
  { value: "sheshshnati", label: "שש שנתי" },
  { value: "other",       label: "אחר" },
];

const SCHOOL_STAGE_LABEL = Object.fromEntries(
  SCHOOL_STAGE_OPTIONS.filter(o => o.value).map(o => [o.value, o.label])
);

const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

// "ליווי" section fields backed by school_year_admin_data — same field shown/edited on
// AdminPage's ניהול → בתי ספר table (service_type, order_method). Options duplicated locally
// per the existing project convention (no shared constants source for these label maps).
const SERVICE_TYPE_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "current", label: "שוטף" },
  { value: "gefen_current", label: "גפן+שוטף" },
  { value: "district", label: "מחוז" },
];

const FUNDING_METHOD_OPTIONS = [
  { value: "private", label: "פרטי" },
  { value: "authority", label: "רשות" },
  { value: "district", label: "מחוז" },
];

// The per-service-type "יועץ מלווה" sub-sections (גפן/שוטף/מחוז) below the ליווי grid.
const TYPED_SERVICE_TYPES = [
  { key: "gefen", label: "גפן" },
  { key: "current", label: "שוטף" },
  { key: "district", label: "מחוז" },
];

// Which of the 3 typed advisor lists are mandatory, given the school's own "סוג שירות" value —
// gefen_current requires both גפן and שוטף advisors to be set.
function activeServiceTypes(serviceType) {
  if (serviceType === "gefen") return ["gefen"];
  if (serviceType === "current") return ["current"];
  if (serviceType === "district") return ["district"];
  if (serviceType === "gefen_current") return ["gefen", "current"];
  return [];
}

// "סטטוס לקוח" — only shown here, not part of the ניהול → בתי ספר table.
const CLIENT_STATUS_OPTIONS = [
  { value: "active", label: "פעיל" },
  { value: "inactive", label: "לא פעיל" },
  { value: "in_progress", label: "בתהליך" },
  { value: "former", label: "לקוח עבר" },
];

const FIELD_LABELS = {
  name: "שם מוסד",
  symbol: "סמל מוסד",
  city: "עיר",
  authority: "בעלות",
  stage: "שלב מוסד",
  finance_software: "תוכנת כספים",
  school_phone: "טלפון בית הספר",
  address: "כתובת",
  district: "מחוז",
  notes: "הערות",
  principal_name: "שם מנהל/ת",
  principal_phone: "טלפון מנהל/ת",
  principal_email: "מייל מנהל/ת",
  secretary_name: "שם מנהלנ/ית",
  secretary_phone: "טלפון מנהלנ/ית",
  secretary_email: "מייל מנהלנ/ית",
  finance_contact_name: "שם אחראי/ת כספים",
  finance_contact_phone: "טלפון אחראי/ת כספים",
  finance_contact_email: "מייל אחראי/ת כספים",
};

function formatFieldValue(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "stage") return SCHOOL_STAGE_LABEL[value] || value;
  if (field === "finance_software") return FINANCE_SOFTWARE_LABEL[value] || value;
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  return String(value);
}

function UpdateRequestSuccessModal({ changes, originalValues, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const rows = Object.entries(changes).filter(([f]) => f !== "_action" && FIELD_LABELS[f]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="req-success-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="bg-white rounded-2xl p-6 w-full max-w-lg flex flex-col gap-4 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden="true">✅</span>
          <div>
            <h2 id="req-success-title" className="font-bold text-slate-900 text-lg">הבקשה נשלחה בהצלחה</h2>
            <p className="text-sm text-slate-500 mt-0.5">הבקשה תועבר לאישור הבעלים/מנהל</p>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th scope="col" className="text-right px-4 py-2 text-xs font-semibold text-slate-500">שדה</th>
                  <th scope="col" className="text-right px-4 py-2 text-xs font-semibold text-slate-500">לפני</th>
                  <th scope="col" className="text-right px-4 py-2 text-xs font-semibold text-slate-500">אחרי</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(([field, newVal]) => (
                  <tr key={field}>
                    <td className="px-4 py-2.5 text-slate-600 font-medium whitespace-nowrap">{FIELD_LABELS[field]}</td>
                    <td className="px-4 py-2.5 text-slate-400">{formatFieldValue(field, originalValues?.[field])}</td>
                    <td className="px-4 py-2.5 text-slate-800 font-semibold">{formatFieldValue(field, newVal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end">
          <button onClick={onClose} className="btn-ghost text-sm px-5 py-2">סגור</button>
        </div>
      </div>
    </div>
  );
}

// No info to show → rendered in plain slate-400 text (via valCls/contactValStyle's className),
// no box/border. Kept as a style object (now empty) so existing valStyle()/contactValStyle()
// call sites don't need to change.
const EMPTY_BORDER_STYLE = {};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const timePart = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${datePart} - ${timePart}`;
}

function fmtILS(v) {
  try { return Math.round(Number(v)).toLocaleString("he-IL"); } catch { return String(v); }
}

// Displays a 10-digit Israeli mobile number ("05XXXXXXXX") as "05X-XXXXXXX" — used only for
// read-only display of contact phone numbers; other phone numbers are shown as-is.
function formatContactPhone(phone) {
  return /^05\d{8}$/.test(phone || "") ? `${phone.slice(0, 3)}-${phone.slice(3)}` : phone;
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

// "זמן לפגישה [סוג]" read-only display — total minutes as "H:MM שעות" / "M דק'".
function formatDurationHM(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} דק'`;
  if (m === 0) return `${h} שעות`;
  return `${h}:${String(m).padStart(2, "0")} שעות`;
}

// "תקציב" row — shown only when the budget amount changed between the two checks
function budgetChangeLine(newerVal, olderVal) {
  if (newerVal == null || olderVal == null || newerVal === olderVal) return null;
  const diff = Math.abs(newerVal - olderVal);
  return newerVal > olderVal
    ? `תקציב - התקציב גדל מ-${fmtILS(olderVal)} ל-${fmtILS(newerVal)}, סה"כ עלייה של ${fmtILS(diff)} ש"ח.`
    : `תקציב - התקציב קטן מ-${fmtILS(olderVal)} ל-${fmtILS(newerVal)}, סה"כ ירידה של ${fmtILS(diff)} ש"ח.`;
}

// "גובה התכנון" row — always shown
function plannedChangeLine(newerVal, olderVal) {
  if (newerVal == null || olderVal == null) {
    return "לא ניתן לחשב את השינוי בתקציב שתוכנן — נתונים חסרים באחת הבדיקות.";
  }
  if (newerVal === olderVal) return "אין שינוי בגובה התקציב שתוכנן בין הבדיקות.";
  const diff = Math.abs(newerVal - olderVal);
  return newerVal > olderVal
    ? `תקציב שתוכנן - הוספה של ${fmtILS(diff)} ש"ח לתקציב שתוכנן בבדיקה החדשה לעומת הבדיקה הישנה.`
    : `תקציב שתוכנן - ירידה של ${fmtILS(diff)} ש"ח בתקציב שתוכנן בבדיקה החדשה לעומת הבדיקה הישנה.`;
}

// "אחוז דיווח כולל" / "אחוז דיווח למודל תמרוץ" rows — always shown, same idea as plannedChangeLine
function pctChangeLine(label, newerFrac, olderFrac, decimals) {
  if (newerFrac == null || olderFrac == null) {
    return `לא ניתן לחשב את השינוי ב${label} — נתונים חסרים באחת הבדיקות.`;
  }
  const newerPct = Number((Number(newerFrac) * 100).toFixed(decimals));
  const olderPct = Number((Number(olderFrac) * 100).toFixed(decimals));
  if (newerPct === olderPct) return `אין שינוי ב${label} בין הבדיקות.`;
  const diff = Math.abs(newerPct - olderPct);
  return newerPct > olderPct
    ? `${label} - עלייה של ${diff.toFixed(decimals)}% ב${label} בבדיקה החדשה לעומת הבדיקה הישנה.`
    : `${label} - ירידה של ${diff.toFixed(decimals)}% ב${label} בבדיקה החדשה לעומת הבדיקה הישנה.`;
}

function isOlderThan24Months(iso) {
  if (!iso) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  return new Date(iso) < cutoff;
}

function buildCompareData(newerLog, olderLog, schoolName) {
  const newerBudgets = newerLog.summary?.tikhnun_result?.budgets || [];
  const olderBudgets = olderLog.summary?.tikhnun_result?.budgets || [];
  const names = [];
  for (const b of [...newerBudgets, ...olderBudgets]) {
    if (b.name && !names.includes(b.name)) names.push(b.name);
  }

  const budgets = names.map(name => {
    const nb = newerBudgets.find(b => b.name === name);
    const ob = olderBudgets.find(b => b.name === name);
    if (!nb || !ob) {
      return { name, missingSide: !nb ? "newer" : "older", general: [], mengonim: { status: "loading" } };
    }
    const nOv = nb.overview || {};
    const oOv = ob.overview || {};
    return {
      name,
      general: [
        budgetChangeLine(nOv.budget, oOv.budget),
        plannedChangeLine(nOv.planned, oOv.planned),
        pctChangeLine("אחוז דיווח כולל", nOv.pct_divuach, oOv.pct_divuach, 0),
        pctChangeLine("אחוז דיווח למודל תמרוץ", nOv.pct_tanuz, oOv.pct_tanuz, 2),
      ],
      mengonim: { status: "loading" },
    };
  });

  return {
    schoolName,
    newerLabel: formatDateTime(newerLog.run_at),
    olderLabel: formatDateTime(olderLog.run_at),
    budgets,
  };
}

// Merges the /analyze/compare-plans response into the existing budgets[] array
// (matched by budget name), adding any budget the מענים endpoint found that
// buildCompareData's summary-based budgets list didn't already have.
function mergeMengonimIntoBudgets(budgets, mengonimResult) {
  const missing = mengonimResult.missing || {};
  const byName = new Map(budgets.map(b => [b.name, b]));
  for (const mb of mengonimResult.budgets || []) {
    const existing = byName.get(mb.name);
    const mengonim = { status: "loaded", missing, added: mb.added, removed: mb.removed, updated: mb.updated };
    if (existing) {
      existing.mengonim = mengonim;
    } else {
      byName.set(mb.name, { name: mb.name, general: [], mengonim });
    }
  }
  // Any budget that only ever existed in buildCompareData (not returned by
  // compare-plans at all) still needs its loading state resolved.
  for (const b of byName.values()) {
    if (b.mengonim?.status === "loading") {
      b.mengonim = { status: "loaded", missing, added: [], removed: [], updated: [] };
    }
  }
  return Array.from(byName.values());
}

function validateSymbol(val) {
  if (!val) return "סמל מוסד הוא שדה חובה";
  if (val.length < 5 || val.length > 6) return "נדרש 5 או 6 ספרות";
  return "";
}

function validateContactPhone(phone) {
  if (!phone) return "";
  if (phone.length !== 10 || !phone.startsWith("05")) return "10 ספרות, חייב להתחיל ב-05";
  return "";
}

function validateSchoolPhone(phone) {
  if (!phone) return "";
  if (!/^\d{9,10}$/.test(phone)) return "9 או 10 ספרות בלבד";
  return "";
}

function validateEmail(email) {
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "כתובת מייל לא תקינה";
  return "";
}

// `isEmpty` is accepted for call-site compatibility but no longer reddens the border —
// only a genuine validation error (hasErr, e.g. after a failed save attempt) does that.
// An empty-but-not-yet-required field should look neutral, not alarming.
function editFieldCls(hasErr, isEmpty = false) {
  const base = "w-full text-sm font-semibold text-slate-800 border rounded-md px-2 py-0.5 bg-transparent focus:outline-none focus:ring-1";
  if (hasErr) return `${base} border-red-400 focus:border-red-400 focus:ring-red-100`;
  return `${base} border-slate-300 focus:border-blue-400 focus:ring-blue-100`;
}

function QuestionTooltip({ text }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-xs flex items-center justify-center cursor-help"
        aria-label="מידע על הגדרת גישה"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >?</button>
      {visible && (
        <div
          role="tooltip"
          className="absolute z-40 text-sm text-slate-800 leading-relaxed p-3 rounded-lg shadow-md"
          style={{
            background: "#FEF08A",
            border: "1px solid #EAB308",
            bottom: "calc(100% + 6px)",
            right: 0,
            width: 230,
            whiteSpace: "normal",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function UnsavedChangesModal({ onSave, onDiscard, onCancel, saving }) {
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
        aria-labelledby="unsaved-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-5"
      >
        <div>
          <h2 id="unsaved-modal-title" className="font-bold text-slate-900 text-lg">נא לשים לב!</h2>
          <p className="text-sm text-slate-500 mt-1">השינויים שביצעת טרם נשמרו, מה ברצונך לעשות?</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="btn-green-light flex-1 whitespace-nowrap text-sm px-4 py-2"
          >
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn-ghost flex-1 whitespace-nowrap text-sm px-4 py-2">ביטול</button>
          <button onClick={onDiscard} disabled={saving} className="btn-ghost flex-1 whitespace-nowrap text-sm px-4 py-2">אל תשמור</button>
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

function SchoolDeleteConfirmModal({ schoolName, confirming, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-del-title"
        onKeyDown={handleKeyDown} dir="rtl" className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl">
        <div>
          <h2 id="school-del-title" className="font-bold text-slate-900 text-lg">מחיקת בית ספר</h2>
          {schoolName && <p className="text-sm text-slate-500 mt-0.5">{schoolName}</p>}
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">מחיקת בית הספר תגרום למחיקת כלל הנתונים עליו לצמיתות.</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={confirming}
            className="text-sm px-5 py-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#dc2626" }}>
            {confirming ? "מוחק..." : "מחק בכל זאת"}
          </button>
          <button onClick={onCancel} disabled={confirming} className="btn-ghost text-sm px-5 py-2">ביטול</button>
        </div>
      </div>
    </div>
  );
}

function SchoolDeleteRequestConfirmModal({ schoolName, confirming, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="del-req-title"
        onKeyDown={handleKeyDown} dir="rtl" className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl">
        <div>
          <h2 id="del-req-title" className="font-bold text-slate-900 text-lg">הגשת בקשת מחיקה</h2>
          {schoolName && <p className="text-sm text-slate-500 mt-0.5">{schoolName}</p>}
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">האם אתה בטוח שאתה רוצה להגיש בקשה למחיקת בית הספר? הבקשה תועבר לאישור הבעלים/מנהל.</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} disabled={confirming}
            className="text-sm px-5 py-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: "#dc2626" }}>
            {confirming ? "שולח..." : "הגש בקשה"}
          </button>
          <button onClick={onCancel} disabled={confirming} className="btn-ghost text-sm px-5 py-2">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ─── Checks: constants & helpers ─────────────────────────────────────────────
const CHECK_MOVABLE_COLS = [
  { key: "budget",             label: "תקציב" },
  { key: "planned",            label: "סכום שתוכנן" },
  { key: "pct_tikhnun",        label: "אחוז תכנון" },
  { key: "fixed_gap",          label: "קבוע" },
  { key: "flexible_remaining", label: "גמיש" },
  { key: "sum_chayav",         label: "סכום חייב בדיווח" },
  { key: "sum_divuach",        label: "סכום שדווח" },
  { key: "pct_divuach",        label: "כללי" },
  { key: "pct_tanuz",          label: "למודל תמרוץ" },
  { key: "rejected",           label: "כמות" },
  { key: "rejected_sum",       label: "סכום" },
  { key: "no_pdf",             label: "כמות" },
  { key: "no_pdf_sum",         label: "סכום" },
  { key: "partial_count",      label: "כמות תוכניות" },
  { key: "missing_report",     label: "סכום" },
  { key: "fn_count",           label: "כמות" },
  { key: "fn_sum",             label: "סכום" },
  { key: "gn_count",           label: "כמות" },
  { key: "gn_sum",             label: "סכום" },
];
const DEFAULT_CHECK_COL_ORDER = CHECK_MOVABLE_COLS.map(c => c.key);

// Column groups: define which keys fall under a shared parent header
const COL_GROUPS = [
  { header: "נותר לתכנון",    keys: ["fixed_gap", "flexible_remaining"] },
  { header: "אחוז דיווח",     keys: ["pct_divuach", "pct_tanuz"] },
  { header: "אסמכתאות שנדחו", keys: ["rejected", "rejected_sum"] },
  { header: "ללא PDF",         keys: ["no_pdf", "no_pdf_sum"] },
  { header: "דיווח חסר",       keys: ["partial_count", "missing_report"] },
  { header: "קיים בכספים, לא בגפן",   keys: ["fn_count", "fn_sum"] },
  { header: "בגפן, לא בכספים",        keys: ["gn_count", "gn_sum"] },
];
const COL_GROUP_MAP = Object.fromEntries(
  COL_GROUPS.flatMap(g => g.keys.map(k => [k, g]))
);

const DIV_LABEL = { tikkon: "תיכון", beinayim: "חטיבת ביניים" };

function formatNum(val) {
  if (val == null || val === "") return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  return n.toLocaleString("he-IL", { maximumFractionDigits: 0 });
}

function formatPct(val, decimals = 1) {
  if (val == null || val === "") return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

function sumRowAmounts(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.reduce((s, r) => s + (parseFloat((r["סכום"] || "0").replace(/,/g, "")) || 0), 0);
}

function renderCheckLogCell(log, key) {
  const summary = log.summary || {};
  const t = summary.tikhnun_overview || {};
  switch (key) {
    case "budget":             return t.budget != null ? formatNum(t.budget) : "—";
    case "planned":            return t.planned != null ? formatNum(t.planned) : "—";
    case "pct_tikhnun":        return (t.budget > 0 && t.planned != null) ? formatPct(t.planned / t.budget) : "—";
    case "fixed_gap":          return t.fixed_gap_abs != null ? formatNum(t.fixed_gap_abs) : "—";
    case "flexible_remaining": return t.flexible_remaining != null ? formatNum(t.flexible_remaining) : "—";
    case "sum_chayav":         return t.sum_chayav != null ? formatNum(t.sum_chayav) : "—";
    case "sum_divuach":        return t.sum_divuach != null ? formatNum(t.sum_divuach) : "—";
    case "pct_divuach":        return t.pct_divuach != null ? formatPct(t.pct_divuach, 0) : "—";
    case "pct_tanuz":          return t.pct_tanuz != null ? formatPct(t.pct_tanuz, 2) : "—";
    case "rejected": {
      const v = summary.in_gefen_rejected;
      return v != null ? v : "—";
    }
    case "rejected_sum": {
      const total = sumRowAmounts(summary.rows_gefen_rejected);
      return total != null ? formatNum(total) : "—";
    }
    case "no_pdf": {
      const v = summary.in_gefen_no_pdf;
      return v != null ? v : "—";
    }
    case "no_pdf_sum": {
      const total = sumRowAmounts(summary.rows_gefen_no_pdf);
      return total != null ? formatNum(total) : "—";
    }
    case "partial_count": {
      const tikhnun     = summary.tikhnun_result;
      const tikhnunTk   = summary.tikhnun_tikkon_result;
      const tikhnunBein = summary.tikhnun_beinayim_result;
      if (tikhnunTk || tikhnunBein) {
        const c1 = Array.isArray(tikhnunTk?.partial_rows)   ? tikhnunTk.partial_rows.length   : 0;
        const c2 = Array.isArray(tikhnunBein?.partial_rows) ? tikhnunBein.partial_rows.length : 0;
        return c1 + c2;
      }
      if (tikhnun && !tikhnun.error) return Array.isArray(tikhnun.partial_rows) ? tikhnun.partial_rows.length : 0;
      return "—";
    }
    case "missing_report": {
      const tikhnun     = summary.tikhnun_result;
      const tikhnunTk   = summary.tikhnun_tikkon_result;
      const tikhnunBein = summary.tikhnun_beinayim_result;
      if (tikhnunTk || tikhnunBein) {
        const s1 = tikhnunTk?.sum_hefresh_partial   ?? 0;
        const s2 = tikhnunBein?.sum_hefresh_partial ?? 0;
        return formatNum(s1 + s2);
      }
      if (tikhnun && !tikhnun.error) return formatNum(tikhnun.sum_hefresh_partial ?? 0);
      return "—";
    }
    case "fn_count": {
      const v = log.in_finance_not_gefen_count;
      return v != null ? v : "—";
    }
    case "fn_sum": {
      const stored = log.in_finance_not_gefen_sum;
      if (stored != null) return formatNum(stored);
      const total = sumRowAmounts(log.rows_finance_not_gefen);
      return total != null ? formatNum(total) : "—";
    }
    case "gn_count": {
      const v = log.in_gefen_not_finance_count;
      return v != null ? v : "—";
    }
    case "gn_sum": {
      const stored = log.in_gefen_not_finance_sum;
      if (stored != null) return formatNum(stored);
      const total = sumRowAmounts(log.rows_gefen_not_finance);
      return total != null ? formatNum(total) : "—";
    }
    default: return "—";
  }
}

function NotCheckedBadge({ reason, onAddFile, anchorRight = true }) {
  const [hovered, setHovered] = useState(false);
  const hideTimeoutRef = useRef(null);

  useEffect(() => () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }, []);

  function showTooltip() {
    if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null; }
    setHovered(true);
  }
  function scheduleHideTooltip() {
    hideTimeoutRef.current = setTimeout(() => setHovered(false), 500);
  }

  const iconEl = onAddFile ? (
    <button type="button" onClick={onAddFile}
      aria-label="הוסף קובץ"
      className="text-red-500 font-bold text-sm hover:text-red-700 transition-colors">
      ✕
    </button>
  ) : (
    <span className="text-red-500 font-bold text-sm select-none">✕</span>
  );
  return (
    <span className="relative inline-flex"
          onMouseEnter={showTooltip} onMouseLeave={scheduleHideTooltip}>
      {iconEl}
      {hovered && (
        <div className={`absolute z-50 bottom-full mb-1 rounded shadow
                        bg-yellow-100 border border-yellow-300 text-yellow-800 min-w-max
                        ${anchorRight ? "right-0" : "left-0"}`}>
          <div className="px-2 py-1 text-xs whitespace-nowrap">{reason}</div>
          {onAddFile && (
            <div className="px-2 py-1 text-xs border-t border-yellow-300 text-yellow-700 whitespace-nowrap">
              לחץ על ה✕ להוספת קובץ
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function renderCheckLogCellForBudget(log, key, budgetName, onAddFile) {
  // Per-combo reconciliation cases — evaluated the same way whether or not a
  // budget is selected, so a missing finance file always renders as ✕, never "0".
  if (["fn_count", "fn_sum", "gn_count", "gn_sum"].includes(key)) {
    const perCombo = log.summary?.per_combo_results;
    if (perCombo != null) {
      const entries = budgetName
        ? Object.values(perCombo).filter(c => c.budget === budgetName)
        : Object.values(perCombo);
      const noDataForBudget = entries.length === 0 || entries.every(c => c.not_checked);
      if (noDataForBudget) {
        const reason = entries[0]?.not_checked_text
          || (budgetName
              ? `לא בוצעה בדיקה עבור תקציב ${budgetName} — לא נמצאו שורות דיווח תואמות`
              : "לא בוצעה השוואת גפן-כספים — לא הועלה קובץ כספים");
        return <NotCheckedBadge reason={reason} onAddFile={onAddFile} anchorRight={false} />;
      }
      const checked = entries.filter(c => !c.not_checked);
      if (key === "fn_count") return checked.reduce((s, c) => s + (c.in_finance_not_gefen?.length ?? 0), 0);
      if (key === "gn_count") return checked.reduce((s, c) => s + (c.in_gefen_not_finance?.length ?? 0), 0);
      if (key === "fn_sum") {
        const rows = checked.flatMap(c => c.in_finance_not_gefen ?? []);
        if (rows.length === 0) return "—";
        const total = sumRowAmounts(rows);
        return total != null ? formatNum(total) : "—";
      }
      if (key === "gn_sum") {
        const rows = checked.flatMap(c => c.in_gefen_not_finance ?? []);
        if (rows.length === 0) return "—";
        const total = sumRowAmounts(rows);
        return total != null ? formatNum(total) : "—";
      }
    }
    // No per_combo_results saved for this check (e.g. legacy log, or no finance
    // file was ever uploaded — including gefen_only runs, which is exactly the
    // "no finance file" case) — never show a misleading "0", flag as not checked.
    if (!log.finance_file_name) {
      return <NotCheckedBadge
        reason="לא בוצעה השוואת גפן-כספים — לא הועלה קובץ כספים"
        onAddFile={onAddFile} anchorRight={false} />;
    }
    if (!budgetName) return renderCheckLogCell(log, key);
    return "—";
  }

  if (!budgetName) return renderCheckLogCell(log, key);

  const budgets = log.summary?.tikhnun_result?.budgets;
  // No tikhnun/budgets for this check — cannot filter by budget, don't show misleading global totals
  if (!Array.isArray(budgets)) return "—";
  const bud = budgets.find(b => b.name === budgetName);
  const ov = bud?.overview;
  if (!ov) return "—";
  switch (key) {
    case "budget":        return ov.budget != null ? formatNum(ov.budget) : "—";
    case "planned":       return ov.planned != null ? formatNum(ov.planned) : "—";
    case "pct_tikhnun":   return (ov.budget > 0 && ov.planned != null) ? formatPct(ov.planned / ov.budget) : "—";
    case "sum_chayav":    return ov.sum_chayav != null ? formatNum(ov.sum_chayav) : "—";
    case "sum_divuach":   return ov.sum_divuach != null ? formatNum(ov.sum_divuach) : "—";
    case "pct_divuach":   return ov.pct_divuach != null ? formatPct(ov.pct_divuach, 0) : "—";
    case "pct_tanuz":     return ov.pct_tanuz != null ? formatPct(ov.pct_tanuz, 2) : "—";
    case "partial_count": {
      const tikhnun = log.summary?.tikhnun_result;
      if (!tikhnun || !Array.isArray(tikhnun.partial_rows)) return "—";
      return tikhnun.partial_rows.filter(r => r.budget === budgetName).length;
    }
    case "missing_report": {
      const tikhnun = log.summary?.tikhnun_result;
      if (!tikhnun || !Array.isArray(tikhnun.partial_rows)) return "—";
      const total = tikhnun.partial_rows
        .filter(r => r.budget === budgetName)
        .reduce((s, r) => s + (r.hefresh ?? 0), 0);
      return formatNum(total);
    }
    case "rejected": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_rejected;
      if (perBudget != null) return (perBudget[budgetName] ?? []).length;
      return <NotCheckedBadge reason="לא ניתן היה לחשב אסמכתאות שנדחו עבור בדיקה זו" anchorRight={false} />;
    }
    case "rejected_sum": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_rejected;
      if (perBudget != null) {
        const rows = perBudget[budgetName] ?? [];
        if (rows.length === 0) return "—";
        const total = sumRowAmounts(rows);
        return total != null ? formatNum(total) : "—";
      }
      return <NotCheckedBadge reason="לא ניתן היה לחשב אסמכתאות שנדחו עבור בדיקה זו" anchorRight={false} />;
    }
    case "no_pdf": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_no_pdf;
      if (perBudget != null) return (perBudget[budgetName] ?? []).length;
      return <NotCheckedBadge reason="לא ניתן היה לחשב אסמכתאות ללא PDF עבור בדיקה זו" anchorRight={false} />;
    }
    case "no_pdf_sum": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_no_pdf;
      if (perBudget != null) {
        const rows = perBudget[budgetName] ?? [];
        if (rows.length === 0) return "—";
        const total = sumRowAmounts(rows);
        return total != null ? formatNum(total) : "—";
      }
      return <NotCheckedBadge reason="לא ניתן היה לחשב אסמכתאות ללא PDF עבור בדיקה זו" anchorRight={false} />;
    }
    case "fixed_gap":
      return ov.fixed_gap_abs != null ? formatNum(ov.fixed_gap_abs) : "—";
    case "flexible_remaining":
      return ov.flexible_remaining != null ? formatNum(ov.flexible_remaining) : "—";
    default: return renderCheckLogCell(log, key);
  }
}

async function downloadLogSourceFile(logId, filename) {
  try {
    const res = await axios.get(`/analyze/logs/${logId}/source-file`, {
      params: { name: filename },
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("downloadLogSourceFile failed:", err);
  }
}

function FileCheckCell({ log, colKey, state, notCheckedReason, title, onAddFile }) {
  const [hovered, setHovered] = useState(false);
  const hideTimeoutRef = useRef(null);

  useEffect(() => () => { if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current); }, []);

  function showTooltip() {
    if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null; }
    setHovered(true);
  }
  // Delayed close — the tooltip is positioned above the trigger button with a
  // gap, so an instant close on mouseleave removes it before the cursor can
  // travel there (both hiding it prematurely and killing in-flight clicks on
  // the download links inside it).
  function scheduleHideTooltip() {
    hideTimeoutRef.current = setTimeout(() => setHovered(false), 500);
  }

  let filenames = [];
  if (colKey === "doch")    filenames = log.gefen_file_names || [];
  if (colKey === "kasafim") filenames = log.finance_file_name ? [log.finance_file_name] : [];
  if (colKey === "tikhnun") filenames = log.summary?.tikhnun_filenames || [];

  if (state === "absent") {
    return (
      <button type="button" title={`הוסף ${title}`} onClick={onAddFile}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-50
                   text-blue-500 text-sm font-bold hover:bg-blue-100 transition-colors">
        +
      </button>
    );
  }
  if (state === "not_checked") {
    return <NotCheckedBadge reason={notCheckedReason || "לא בוצעה בדיקה"} onAddFile={onAddFile} />;
  }
  return (
    <span className="relative inline-flex" dir="rtl"
          onMouseEnter={showTooltip} onMouseLeave={scheduleHideTooltip}>
      <button type="button" onClick={onAddFile} aria-label="הוסף קובץ"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full
                   bg-green-50 text-green-600 text-xs font-bold hover:bg-green-100 transition-colors">
        ✓
      </button>
      {hovered && (
        <div className="absolute z-50 bottom-full right-0 mb-2 p-2.5 bg-white border
                        border-slate-200 rounded-xl shadow-lg text-right min-w-max">
          {filenames.map((f, i) => (
            log.id ? (
              <button key={i} type="button" onClick={() => downloadLogSourceFile(log.id, f)}
                title={`הורד את ${f}`}
                className="block w-full text-right text-xs text-blue-600 hover:text-blue-800
                           hover:underline whitespace-nowrap py-0.5">
                {f}
              </button>
            ) : (
              <div key={i} className="text-xs text-slate-600 whitespace-nowrap py-0.5">{f}</div>
            )
          ))}
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-xs text-slate-400 whitespace-nowrap text-center">
            לחץ על ה✓ להוספת קובץ
          </div>
        </div>
      )}
    </span>
  );
}

function getLogFileCols(log) {
  const s = log.summary || {};
  return {
    tikhnun: !!(s.has_tikhnun || (s.tikhnun_filenames && s.tikhnun_filenames.length > 0) || s.tikhnun_overview),
    doch: (log.gefen_file_names || []).length > 0,
    kasafim: !!log.finance_file_name,
  };
}

// Shared by both persisted log rows and the just-finished "pending" row so the
// two never drift apart — "present" (✓) / "absent" (+) / "not_checked" (✕).
//
// "tikhnun" (planning file) is genuinely optional — a check can run gefen-vs-
// finance without it, so a missing planning file is a neutral "+" (add if you
// want). "kasafim" (finance file) is not: without it the entire gefen-finance
// comparison never ran, so it must always flag as "not_checked" (✕), never the
// neutral "+" — otherwise a missing finance file looks like an optional extra
// instead of an incomplete check.
function getFileState(fc, budgetEntries, colKey) {
  if (colKey === "tikhnun") return fc.tikhnun ? "present" : "absent";
  if (colKey === "kasafim" && !fc.kasafim) return "not_checked";
  if (!budgetEntries) return fc[colKey] ? "present" : "absent";
  if (colKey === "doch") {
    if (budgetEntries.length > 0) return "present";
    return fc.doch ? "not_checked" : "absent";
  }
  if (colKey === "kasafim") {
    return budgetEntries.some(c => !c.not_checked) ? "present" : "not_checked";
  }
  return fc[colKey] ? "present" : "absent";
}

function getFileNotCheckedReason(colKey, budgetEntries, budgetName) {
  if (colKey === "kasafim" && !budgetEntries) return "לא בוצעה השוואת גפן-כספים — לא הועלה קובץ כספים";
  if (colKey === "doch") return `לא זוהו שורות דיווח עבור תקציב ${budgetName}`;
  const ncEntry = budgetEntries?.find(c => c.not_checked);
  return ncEntry?.not_checked_text || `לא נמצאו נתוני כספים עבור תקציב ${budgetName}`;
}

function logToResult(log) {
  const s = log.summary || {};
  return {
    status: "done",
    gefen_only: s.gefen_only ?? false,
    finance_type: s.finance_type ?? null,
    tikhnun: s.tikhnun_result ?? null,
    tikhnun_tikkon: s.tikhnun_tikkon_result ?? null,
    tikhnun_beinayim: s.tikhnun_beinayim_result ?? null,
    per_combo_results: s.per_combo_results ?? null,
    summary: s,
    rows_finance_not_gefen: log.rows_finance_not_gefen ?? [],
    rows_gefen_not_finance: log.rows_gefen_not_finance ?? [],
    rows_gefen_rejected: s.rows_gefen_rejected ?? [],
    rows_gefen_no_pdf: s.rows_gefen_no_pdf ?? [],
    file_path: null,
  };
}

// ─── NewCheckModal ────────────────────────────────────────────────────────────
function NewCheckModal({ accounts, defaultAccountId, onClose, onConfirm, title, infoText }) {
  const [files, setFiles] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(
    defaultAccountId || (accounts.length === 1 ? accounts[0].id : "")
  );
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-check-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-3xl p-7 w-full max-w-lg flex flex-col gap-5"
      >
        <h2 id="new-check-modal-title" className="text-base font-bold text-slate-900">{title || "בדיקה חדשה"}</h2>

        {infoText && (
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{infoText}</p>
        )}

        {accounts.length > 1 && (
          <div>
            <label htmlFor="new-check-account" className="block text-sm font-semibold text-slate-700 mb-2">
              בחר חטיבה לבדיקה
            </label>
            <select
              id="new-check-account"
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white"
            >
              <option value="">— בחר חטיבה —</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.custom_label || DIVISION_LABEL[acc.division_type] || acc.division_type}
                </option>
              ))}
            </select>
          </div>
        )}

        <FileUpload files={files} onChange={setFiles} />

        <div className="flex gap-3">
          <button
            onClick={() => { if (files.length > 0) onConfirm(files, selectedAccountId); }}
            disabled={files.length === 0}
            className="btn-blue flex-1 py-2.5 text-sm"
          >
            אישור
          </button>
          <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ─── CompareChecksModal ───────────────────────────────────────────────────────
function CompareChecksModal({ logs, onClose, onCompare }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [newerId, setNewerId] = useState(logs[0]?.id ?? null);
  const [olderId, setOlderId] = useState(null);
  const [openSide, setOpenSide] = useState(null); // "newer" | "older" | null
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!openSide) return;
    function h(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setOpenSide(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [openSide]);

  const canCompare = !!newerId && !!olderId && newerId !== olderId;

  function Picker({ side, selectedId, onSelect, label }) {
    const selectedLog = logs.find(l => l.id === selectedId);
    const otherId = side === "newer" ? olderId : newerId;
    const isOpen = openSide === side;
    return (
      <div className="flex-1 flex flex-col gap-2">
        <span className="text-sm font-semibold text-slate-700 text-center">{label}</span>
        <div className="relative" ref={isOpen ? pickerRef : null}>
          <button
            type="button"
            onClick={() => setOpenSide(o => (o === side ? null : side))}
            aria-expanded={isOpen}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white flex items-center justify-between gap-2 hover:border-blue-300 transition-colors"
          >
            <span className={selectedLog ? "text-slate-800 font-medium" : "text-slate-400"}>
              {selectedLog ? formatDateTime(selectedLog.run_at) : "בחר בדיקה..."}
            </span>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {isOpen && (
            <div className="absolute z-20 top-full mt-1.5 w-full glass-card rounded-xl py-1.5 shadow-lg max-h-64 overflow-auto" dir="rtl">
              {logs.length === 0 && (
                <p className="text-xs text-slate-400 px-4 py-2">אין בדיקות</p>
              )}
              {logs.map(log => {
                const disabled = log.id === otherId;
                const isOld = isOlderThan24Months(log.run_at);
                return (
                  <button
                    key={log.id}
                    type="button"
                    disabled={disabled}
                    title={isOld ? "בדיקה זו ישנה מ-24 חודשים — קובץ התכנון המקורי כבר אינו זמין, ולכן מקטע \"מענים\" לא יוצג עבורה (מקטע \"כללי\" עדיין יעבוד כרגיל)" : undefined}
                    onClick={() => { onSelect(log.id); setOpenSide(null); }}
                    className={`w-full text-right px-4 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                      disabled
                        ? "text-slate-300 cursor-not-allowed"
                        : log.id === selectedId
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : isOld
                            ? "text-slate-400 hover:bg-slate-50"
                            : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span>{formatDateTime(log.run_at)}</span>
                    {isOld && <span aria-hidden="true" className="text-amber-500 text-xs">⚠</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-checks-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-3xl p-7 w-full max-w-lg flex flex-col gap-6"
      >
        <h2 id="compare-checks-title" className="text-base font-bold text-slate-900 text-center">השוואה בין בדיקות</h2>

        <div className="flex items-start gap-4">
          <Picker side="newer" selectedId={newerId} onSelect={setNewerId} label="בדיקה חדשה" />
          <Picker side="older" selectedId={olderId} onSelect={setOlderId} label="בדיקה ישנה" />
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={!canCompare}
            onClick={() => canCompare && onCompare(newerId, olderId)}
            className="btn-blue px-6 py-2.5 text-sm"
          >
            בצע השוואה
          </button>
          <button type="button" onClick={onClose} className="btn-ghost px-6 py-2 text-sm">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── LegacyAddFileModal ───────────────────────────────────────────────────────
function LegacyAddFileModal({ log, onClose, onNewCheck }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const s = log.summary || {};
  const origFiles = [
    ...(log.gefen_file_names || []),
    ...(log.finance_file_name ? [log.finance_file_name] : []),
    ...(s.tikhnun_filenames || []),
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="legacy-add-file-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[420px] flex flex-col gap-4">
        <h2 id="legacy-add-file-title" className="text-base font-bold text-slate-800">הוספת קובץ לבדיקה</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          <p className="font-semibold mb-1">הקבצים המקוריים לא נשמרו בענן</p>
          <p className="text-xs leading-relaxed">
            בדיקה זו בוצעה לפני שמירת קבצים אוטומטית בענן, ולכן לא ניתן להוסיף קובץ אחד בלבד.
          </p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900">
          <p className="font-semibold mb-1">מה לעשות?</p>
          <p className="text-xs leading-relaxed">
            לחץ על <strong>"בדיקה חדשה"</strong> והעלה את כל הקבצים יחד:
          </p>
          {origFiles.length > 0 && (
            <ul className="mt-2 text-xs list-disc list-inside space-y-0.5 text-blue-800">
              {origFiles.map((f, i) => <li key={i} className="font-mono">{f}</li>)}
              <li className="text-blue-600 font-semibold">+ הקובץ החדש שברצונך להוסיף</li>
            </ul>
          )}
          <p className="mt-2 text-xs text-blue-700">
            המערכת תשמור את כל הקבצים בענן, ובעתיד ניתן יהיה להוסיף קבצים בקליק אחד.
          </p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onNewCheck}
            className="flex-1 px-4 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
            + בדיקה חדשה
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DeleteCheckModal ─────────────────────────────────────────────────────────
function DeleteCheckModal({ onConfirm, onCancel, deleting }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="del-check-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] flex flex-col gap-4">
        <h2 id="del-check-title" className="text-base font-bold text-slate-800 text-center">מחיקת בדיקה</h2>
        <p className="text-sm text-slate-600 text-center">האם למחוק את הבדיקה לצמיתות? לא ניתן לשחזר פעולה זו.</p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onConfirm} disabled={deleting}
            className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
            {deleting ? "מוחק..." : "מחק"}
          </button>
          <button type="button" onClick={onCancel} disabled={deleting}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RenameCheckModal ─────────────────────────────────────────────────────────
function RenameCheckModal({ value, onChange, onSave, onCancel, saving, error }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="rename-check-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] flex flex-col gap-4">
        <h2 id="rename-check-title" className="text-base font-bold text-slate-800 text-center">עריכת שם בדיקה</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rename-check-input" className="text-sm text-slate-600">שם הבדיקה</label>
          <input
            id="rename-check-input"
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onSave(); } }}
            placeholder="לדוגמה: בדיקת רבעון 2"
            autoFocus
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          />
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onSave} disabled={saving}
            className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
            {saving ? "שומר..." : "שמור"}
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CheckLinkTooltip ─────────────────────────────────────────────────────────
function CheckLinkTooltip({ children }) {
  const [pos, setPos] = useState(null); // { top, right } in viewport coords, or null when hidden
  const anchorRef = useRef(null);

  function show() {
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }
  function hide() {
    setPos(null);
  }

  // Dismiss on any scroll (window or the table's own scroll container) so a
  // stale tooltip never lingers detached from its anchor.
  useEffect(() => {
    if (!pos) return;
    function onScroll() { hide(); }
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [pos]);

  return (
    <span
      ref={anchorRef}
      className="inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {pos && createPortal(
        <span
          role="tooltip"
          className="fixed text-xs text-slate-800 whitespace-nowrap px-3 py-1.5 rounded-lg shadow-md"
          style={{
            background: "#FEF08A",
            border: "1px solid #EAB308",
            top: pos.top,
            right: pos.right,
            zIndex: 200,
          }}
        >
          לחץ להצגת מפורטת של תוצאות הבדיקה.
        </span>,
        document.body
      )}
    </span>
  );
}

// ─── DivisionMismatchModal ────────────────────────────────────────────────────
function DivisionMismatchModal({ detectedDivision, activeSubTab, onSaveForOther, onDismiss }) {
  const { ref, handleKeyDown } = useFocusTrap(onDismiss);
  const detected = DIV_LABEL[detectedDivision] || detectedDivision;
  const active = DIV_LABEL[activeSubTab] || activeSubTab;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="div-mismatch-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[380px] flex flex-col gap-4">
        <h2 id="div-mismatch-title" className="text-base font-bold text-slate-800">זוהתה חטיבה שונה</h2>
        <p className="text-sm text-slate-600">
          הקבצים שהועלו מזוהים כ<strong>{detected}</strong>,
          אך הבדיקה בוצעה תחת לשונית <strong>{active}</strong>.
          הנתונים נשמרו תחת {active}. האם לשמור גם תחת {detected}?
        </p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onSaveForOther}
            className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
            כן, שמור גם
          </button>
          <button type="button" onClick={onDismiss}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            לא, תודה
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── StageMismatchModal ───────────────────────────────────────────────────────
const STAGE_DIV_MAP = { tikkon: "tikkon", beinayim: "beinayim", yesodi: "yesodi" };
const DIV_HEB  = { tikkon: "תיכון", beinayim: "חטיבת ביניים", yesodi: "יסודי" };
const STAGE_HEB = { tikkon: "תיכון", beinayim: "חטיבת ביניים", yesodi: "יסודי", sheshshnati: "שש שנתי" };

function StageMismatchModal({ detectedDivision, schoolStage, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="stage-mismatch-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[420px] flex flex-col gap-4">
        <h2 id="stage-mismatch-title" className="text-base font-bold text-slate-800">שים לב!</h2>
        <p className="text-sm text-slate-600">
          הקבצים שהעלית שייכים לבית ספר{" "}
          <strong>{DIV_HEB[detectedDivision] || detectedDivision}</strong>{" "}
          בזמן ששלב מוסד זה הינו{" "}
          <strong>{STAGE_HEB[schoolStage] || schoolStage}</strong>.{" "}
          האם לבצע את הבדיקה בכל זאת?
        </p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onConfirm}
            className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
            כן, בצע בדיקה
          </button>
          <button type="button" onClick={onCancel}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ChecksTab ────────────────────────────────────────────────────────────────
function ChecksTab({ accounts, schoolId, schoolName, schoolStage, logs, logsError, logsLoading, onReloadLogs, activeSubTab, setActiveSubTab, academicYear }) {
  const isSheshsSnati = schoolStage === "sheshshnati";
  const [view, setView] = useState("table");
  const [activeResult, setActiveResult] = useState(null);
  const { openCompare, patchCompare } = useCompareChecks();

  const [colOrder, setColOrder] = useState(DEFAULT_CHECK_COL_ORDER);
  const [colVisible, setColVisible] = useState(
    Object.fromEntries(DEFAULT_CHECK_COL_ORDER.map(k => [k, true]))
  );
  const [showColPicker, setShowColPicker] = useState(false);
  const [colPickerQuery, setColPickerQuery] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const colPickerRef = useRef(null);

  const [showNewCheckModal, setShowNewCheckModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [addFileModal, setAddFileModal] = useState(null); // { log }
  const [pendingRun, setPendingRun] = useState(null);
  const [classifyQueue, setClassifyQueue] = useState([]);
  const pollRef = useRef(null);

  const [meUser, setMeUser] = useState(null);
  const [openMenuLogId, setOpenMenuLogId] = useState(null);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [loadingLogId, setLoadingLogId] = useState(null);
  const [divisionMismatch, setDivisionMismatch] = useState(null); // { runId, result, detectedDivision }
  const [stageMismatch, setStageMismatch]       = useState(null); // { runId, result, detectedDivision, savedLogId }
  const [selectedHistBudget, setSelectedHistBudget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null); // { log }
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState("");
  const historyScrollRef = useRef(null);

  // Left/right arrow keys scroll the history table horizontally whenever the
  // checks tab's table view is showing — no need to first click/focus the
  // scroll container itself. Skipped while typing in a text field (e.g. the
  // rename modal or the column-picker search box) so cursor movement there
  // isn't hijacked.
  useEffect(() => {
    if (view !== "table") return;
    function handleKeyDown(e) {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key === "ArrowRight") { e.preventDefault(); historyScrollRef.current?.scrollBy({ left: 60 }); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); historyScrollRef.current?.scrollBy({ left: -60 }); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [view]);

  useEffect(() => {
    axios.get("/schools/users/me").then(r => setMeUser(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showColPicker) return;
    function h(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setShowColPicker(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showColPicker]);

  useEffect(() => {
    function h(e) {
      if (!e.target.closest("[data-log-menu]")) setOpenMenuLogId(null);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const canDelete = meUser && !!meUser.can_delete_own_meetings;

  useEffect(() => { setSelectedHistBudget(null); }, [activeSubTab]);

  const filteredLogs = isSheshsSnati
    ? logs.filter(log => {
        if (!log.gefen_account_id) {
          // Use detected division from doch summary to route to the correct sub-tab
          const div = log.summary?.division;
          if (div === "tikkon") return activeSubTab === "tikkon";
          if (div === "beinayim") return activeSubTab === "beinayim";
          return activeSubTab === "tikkon"; // default: tikkon
        }
        const acc = accounts.find(a => a.id === log.gefen_account_id);
        return activeSubTab === "tikkon"
          ? acc?.division_type === "tikkon"
          : acc?.division_type === "beinayim";
      })
    : logs;

  const allHistBudgets = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const log of filteredLogs) {
      const budgets = log.summary?.tikhnun_result?.budgets;
      if (Array.isArray(budgets)) {
        for (const b of budgets) {
          if (b.name && !seen.has(b.name)) {
            seen.add(b.name);
            result.push(b.name);
          }
        }
      }
    }
    return result;
  }, [filteredLogs]);

  // No "כולם" (all) pill anymore — once multiple budgets are detected, always
  // land on a real budget name instead of the ambiguous null/"all" state.
  useEffect(() => {
    if (allHistBudgets.length > 1 && !allHistBudgets.includes(selectedHistBudget)) {
      setSelectedHistBudget(allHistBudgets[0]);
    }
  }, [allHistBudgets, selectedHistBudget]);

  // Auto-clear pendingRun once the real log row appears in the VISIBLE (filtered) list
  useEffect(() => {
    if (!pendingRun?.runId || pendingRun.status !== "done") return;
    const found = filteredLogs.some(l => l.summary?.run_id === pendingRun.runId);
    if (found) setPendingRun(null);
  }, [filteredLogs, pendingRun?.runId, pendingRun?.status]);

  function getModalAccounts() {
    if (!isSheshsSnati) {
      // Non-sheshshnati schools never need division selection — return exactly one account
      const matching = accounts.filter(a => a.division_type === schoolStage);
      if (matching.length > 0) return [matching[0]];
      return accounts.length > 0 ? [accounts[0]] : [];
    }
    const dt = activeSubTab === "tikkon" ? "tikkon" : "beinayim";
    const matching = accounts.filter(a => a.division_type === dt);
    return matching.length > 0 ? matching : accounts;
  }

  function handleColDrop(toIdx) {
    if (dragIndex === null || dragIndex === toIdx) return;
    const next = [...colOrder];
    [next[dragIndex], next[toIdx]] = [next[toIdx], next[dragIndex]];
    setColOrder(next);
  }

  async function startCheck(files, selectedAccountId) {
    const now = new Date().toISOString();
    setPendingRun({ date: now, status: "loading", runId: null, result: null, error: "" });
    setShowNewCheckModal(false);
    try {
      const form = new FormData();
      files.forEach(f => form.append("files", f));
      form.append("school_id", schoolId);
      if (selectedAccountId) form.append("gefen_account_id", selectedAccountId);
      form.append("academic_year", academicYear);
      const { data } = await axios.post("/analyze/upload", form);
      const runId = data.run_id;
      setPendingRun(prev => ({ ...prev, runId }));
      pollRef.current = setInterval(async () => {
        try {
          const { data: r } = await axios.get(`/analyze/result/${runId}`);
          if (r.status === "done") {
            clearInterval(pollRef.current);
            // Stage mismatch only relevant for tikkon/beinayim — yesodi codes overlap with beinayim range
            if (!isSheshsSnati && (schoolStage === "tikkon" || schoolStage === "beinayim")) {
              const detected = r.summary?.division;
              const expected = STAGE_DIV_MAP[schoolStage];
              if (detected && detected !== "both" && expected && detected !== expected) {
                setPendingRun(prev => ({ ...prev, status: "done", result: r }));
                setStageMismatch({ runId, result: r, detectedDivision: detected, savedLogId: r.saved_log_id });
                return;
              }
            }
            setPendingRun(prev => ({ ...prev, status: "done", result: r }));
            onReloadLogs();
            if (isSheshsSnati) {
              const detected = r.summary?.division;
              const expected = activeSubTab;
              if (detected && detected !== "both" && detected !== expected) {
                setDivisionMismatch({ runId, result: r, detectedDivision: detected });
              }
            }
            // Pending identification — show classify modal
            const queue = [];
            if (r.tikhnun?.pending_identification) queue.push({ tikhnun: r.tikhnun, division: "main", runId });
            if (r.tikhnun_tikkon?.pending_identification) queue.push({ tikhnun: r.tikhnun_tikkon, division: "tikkon", runId });
            if (r.tikhnun_beinayim?.pending_identification) queue.push({ tikhnun: r.tikhnun_beinayim, division: "beinayim", runId });
            if (queue.length > 0) setClassifyQueue(queue);
          } else if (r.status === "error") {
            clearInterval(pollRef.current);
            setPendingRun(prev => ({ ...prev, status: "error", error: r.user_message || r.error || "הבדיקה נכשלה" }));
          }
        } catch {
          clearInterval(pollRef.current);
          setPendingRun(prev => ({ ...prev, status: "error", error: "שגיאה בקבלת התוצאות" }));
        }
      }, 3000);
    } catch (err) {
      setPendingRun(prev => ({ ...prev, status: "error", error: err.response?.data?.detail || "שגיאה בהעלאת הקבצים" }));
    }
  }

  async function startUpdateCheck(files) {
    if (!addFileModal) return;
    const targetLog = addFileModal.log;
    const hasStoredFiles = !!(targetLog.summary?.stored_file_paths?.length);
    const now = new Date().toISOString();
    setPendingRun({ date: now, status: "loading", runId: null, result: null, error: "", updateLogId: targetLog.id });
    setAddFileModal(null);
    try {
      const form = new FormData();
      files.forEach(f => form.append("files", f));
      let apiUrl;
      if (hasStoredFiles) {
        // New: only upload the missing file — originals are fetched from Storage
        apiUrl = `/analyze/add-file/${targetLog.id}`;
      } else {
        // Legacy: re-upload all files
        form.append("school_id", schoolId);
        if (targetLog.gefen_account_id) form.append("gefen_account_id", targetLog.gefen_account_id);
        form.append("update_log_id", targetLog.id);
        apiUrl = "/analyze/upload";
      }
      const { data } = await axios.post(apiUrl, form);
      const runId = data.run_id;
      setPendingRun(prev => ({ ...prev, runId }));
      pollRef.current = setInterval(async () => {
        try {
          const { data: r } = await axios.get(`/analyze/result/${runId}`);
          if (r.status === "done") {
            clearInterval(pollRef.current);
            // For update runs: clear immediately so the existing (updated) row takes over
            setPendingRun(prev => prev?.updateLogId ? null : { ...prev, status: "done", result: r });
            onReloadLogs();
            const queue = [];
            if (r.tikhnun?.pending_identification) queue.push({ tikhnun: r.tikhnun, division: "main", runId });
            if (r.tikhnun_tikkon?.pending_identification) queue.push({ tikhnun: r.tikhnun_tikkon, division: "tikkon", runId });
            if (r.tikhnun_beinayim?.pending_identification) queue.push({ tikhnun: r.tikhnun_beinayim, division: "beinayim", runId });
            if (queue.length > 0) setClassifyQueue(queue);
          } else if (r.status === "error") {
            clearInterval(pollRef.current);
            setPendingRun(prev => ({ ...prev, status: "error", error: r.user_message || r.error || "הבדיקה נכשלה" }));
          }
        } catch {
          clearInterval(pollRef.current);
          setPendingRun(prev => ({ ...prev, status: "error", error: "שגיאה בקבלת התוצאות" }));
        }
      }, 3000);
    } catch (err) {
      setPendingRun(prev => ({ ...prev, status: "error", error: err.response?.data?.detail || "שגיאה בהעלאת הקבצים" }));
    }
  }

  async function handleDelete() {
    if (!deleteTargetId) return;
    setDeletingId(deleteTargetId);
    try {
      await axios.delete(`/schools/${schoolId}/logs/${deleteTargetId}`);
      setDeleteTargetId(null);
      onReloadLogs();
    } catch {
      // error silently — user can retry
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRenameSave() {
    if (!renameTarget) return;
    setSavingRename(true);
    setRenameError("");
    try {
      await axios.patch(`/schools/${schoolId}/logs/${renameTarget.log.id}/name`, { custom_name: renameValue });
      setRenameTarget(null);
      onReloadLogs();
    } catch (err) {
      setRenameError(err.response?.data?.detail || "שגיאה בשמירת שם הבדיקה");
    } finally {
      setSavingRename(false);
    }
  }

  async function handlePinToggle(log) {
    setOpenMenuLogId(null);
    try {
      await axios.patch(`/schools/${schoolId}/logs/${log.id}/pin`, { pinned: !log.pinned_at });
      onReloadLogs();
    } catch {
      // error silently — user can retry
    }
  }

  async function handleLogClick(log) {
    setLoadingLogId(log.id);
    try {
      const { data } = await axios.get(`/schools/${schoolId}/logs/${log.id}`);
      setActiveResult({ result: logToResult(data), runId: data.summary?.run_id || log.id });
      setView("result");
    } catch {
      // fallback: use data we already have
      setActiveResult({ result: logToResult(log), runId: log.summary?.run_id || log.id });
      setView("result");
    } finally {
      setLoadingLogId(null);
    }
  }

  async function handleStageMismatchConfirm() {
    if (!stageMismatch) return;
    const { result, runId } = stageMismatch;
    setStageMismatch(null);
    onReloadLogs();
    const queue = [];
    if (result?.tikhnun?.pending_identification) queue.push({ tikhnun: result.tikhnun, division: "main", runId });
    if (result?.tikhnun_tikkon?.pending_identification) queue.push({ tikhnun: result.tikhnun_tikkon, division: "tikkon", runId });
    if (result?.tikhnun_beinayim?.pending_identification) queue.push({ tikhnun: result.tikhnun_beinayim, division: "beinayim", runId });
    if (queue.length > 0) setClassifyQueue(queue);
  }

  async function handleStageMismatchCancel() {
    if (!stageMismatch) return;
    const { savedLogId } = stageMismatch;
    setStageMismatch(null);
    setPendingRun(null);
    if (savedLogId) {
      try { await axios.delete(`/schools/${schoolId}/logs/${savedLogId}`); } catch { /* silent */ }
    }
  }

  async function handleSaveForOtherDivision() {
    if (!divisionMismatch) return;
    const { runId, detectedDivision } = divisionMismatch;
    const targetAcc = accounts.find(a => a.division_type === detectedDivision);
    setDivisionMismatch(null);
    if (!targetAcc) return;
    try {
      const form = new FormData();
      form.append("run_id", runId);
      form.append("school_id", schoolId);
      form.append("gefen_account_id", targetAcc.id);
      form.append("academic_year", academicYear);
      await axios.post("/analyze/save-for-account", form);
      onReloadLogs();
    } catch {
      // silent — non-critical
    }
  }

  const visibleColOrder = colOrder.filter(k => colVisible[k]);

  // For each visible key: determine if it's a group start, a group continuation, or ungrouped
  const groupStartInfo = (() => {
    const info = {};
    const seenGroups = new Set();
    for (let i = 0; i < visibleColOrder.length; i++) {
      const key = visibleColOrder[i];
      const group = COL_GROUP_MAP[key];
      if (!group) { info[key] = { grouped: false }; continue; }
      if (seenGroups.has(group.header)) { info[key] = { grouped: true, start: false }; continue; }
      // Check if all visible group keys appear consecutively from position i
      const groupVisibleKeys = group.keys.filter(k => visibleColOrder.includes(k));
      const consecutive = groupVisibleKeys.length >= 2 &&
        groupVisibleKeys.every((gk, j) => visibleColOrder[i + j] === gk);
      if (consecutive) {
        seenGroups.add(group.header);
        info[key] = { grouped: true, start: true, colSpan: groupVisibleKeys.length, header: group.header };
      } else {
        info[key] = { grouped: false };
      }
    }
    return info;
  })();

  // border-l on DOM[i] = border between DOM[i] and DOM[i+1] (to its left in RTL).
  // Put border-l on the LAST member of each unit. Also always border on the very last
  // column so the outer-left edge of the movable section matches the header grid.
  const unitBorderKeys = new Set(
    visibleColOrder.filter((key, i) => {
      if (i === visibleColOrder.length - 1) return true; // outer-left edge always
      const nextKey = visibleColOrder[i + 1];
      const g  = COL_GROUP_MAP[key];
      const gn = COL_GROUP_MAP[nextKey];
      return !(g && gn && g.header === gn.header);
    })
  );
  const colBorder = key => unitBorderKeys.has(key) ? " border-l border-black" : "";
  // Inline style version — used on body <td> cells to bypass Tailwind v4 CSS-variable cascade
  const colBorderStyle = key => unitBorderKeys.has(key) ? { borderLeft: "1px solid black" } : {};
  // For colSpan group-header cells: border-l covers the LEFT edge of the whole span.
  // Use the last visible member's unitBorderKeys membership to decide.
  const groupHeaderBorder = (startKey) => {
    const group = COL_GROUP_MAP[startKey];
    if (!group) return "";
    const lastKey = group.keys.filter(k => visibleColOrder.includes(k)).at(-1);
    return lastKey && unitBorderKeys.has(lastKey) ? " border-l border-black" : "";
  };

  // Full label shown in column picker (includes group name for grouped columns)
  const pickerLabel = col => {
    const g = COL_GROUP_MAP[col.key];
    return g ? `${g.header} — ${col.label}` : col.label;
  };

  const thBase = "text-right px-3 py-2.5 text-slate-700 font-semibold whitespace-nowrap border border-black";
  const stickyHdr = { position: "sticky", background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" };

  if (view === "result" && activeResult) {
    return (
      <div dir="rtl">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => { setView("table"); setActiveResult(null); }}
            className="btn-ghost text-sm px-4 py-2 flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            חזרה להיסטוריה
          </button>
        </div>
        <ResultsView
          result={activeResult.result}
          runId={activeResult.runId}
          onNewRun={() => { setView("table"); setActiveResult(null); setShowNewCheckModal(true); }}
          schoolId={schoolId}
          currentUser={meUser}
        />
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-col" style={{ height: "calc(100vh - 260px)" }}>
      {/* Toolbar: budget type tabs (right) + action buttons (left) */}
      <div className="flex items-end border-b border-slate-200 mb-4 gap-1 flex-shrink-0">
        {/* Budget type tabs — styled like main page tabs */}
        {allHistBudgets.length > 1 && allHistBudgets.map(bname => (
          <button
            key={bname}
            type="button"
            onClick={() => setSelectedHistBudget(bname)}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
              selectedHistBudget === bname
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
          >
            {bname}
          </button>
        ))}

        {/* Spacer pushes action buttons to the far left in RTL */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-2 pb-2">
          <button
            type="button"
            onClick={() => setShowNewCheckModal(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium btn-ghost"
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            בדיקה חדשה
          </button>

          <button
            type="button"
            onClick={() => setShowCompareModal(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium btn-ghost"
          >
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <polyline points="7 23 3 19 7 15"/>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            השוואה בין בדיקות
          </button>

          <div className="relative" ref={colPickerRef}>
            <button
              type="button"
              onClick={() => { setShowColPicker(o => !o); setColPickerQuery(""); }}
              aria-expanded={showColPicker}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium btn-ghost"
            >
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
              עמודות להצגה
            </button>
            {showColPicker && (
              <div className="absolute left-0 top-full mt-1.5 z-20 glass-card rounded-xl py-2 shadow-lg" style={{ minWidth: 230 }} dir="rtl">
                <div className="px-3 pb-2">
                  <input
                    type="search"
                    autoFocus
                    value={colPickerQuery}
                    onChange={e => setColPickerQuery(e.target.value)}
                    placeholder="חיפוש עמודה..."
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
                    aria-label="חיפוש עמודה"
                  />
                </div>
                {CHECK_MOVABLE_COLS.filter(col =>
                  !colPickerQuery.trim() || pickerLabel(col).includes(colPickerQuery.trim())
                ).map(col => (
                  <label key={col.key} className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colVisible[col.key]}
                      onChange={() => setColVisible(prev => ({ ...prev, [col.key]: !prev[col.key] }))}
                      className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                    />
                    <span className="text-sm text-slate-700">{pickerLabel(col)}</span>
                  </label>
                ))}
                {CHECK_MOVABLE_COLS.filter(col =>
                  !colPickerQuery.trim() || pickerLabel(col).includes(colPickerQuery.trim())
                ).length === 0 && (
                  <p className="text-xs text-slate-400 px-4 py-2">לא נמצאו עמודות</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-2xl overflow-hidden flex-1 min-h-0 relative">
        <div
          ref={historyScrollRef}
          className="overflow-auto h-full hist-scroll-x"
        >
          {logsError ? (
            <div role="alert" className="p-8 text-center">
              <p className="text-red-500 mb-3">{logsError}</p>
              <button onClick={onReloadLogs} className="btn-ghost text-sm px-4 py-2">נסה שוב</button>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse h-full">
              <thead style={{ position: "sticky", top: 0, zIndex: 10, backdropFilter: "blur(8px)" }}>
                {/* Row 1: date (rowSpan 2), files-parent (colSpan 3), movable cols, actions (rowSpan 2) */}
                <tr style={{ background: "rgba(241,245,249,0.97)" }}>
                  <th scope="col" rowSpan={2} className={thBase}
                    style={{ position: "sticky", right: 0, zIndex: 20, background: "rgba(241,245,249,0.97)" }}>
                    מועד הבדיקה
                  </th>
                  <th scope="col" colSpan={3} className={`${thBase} text-center`}>קבצים שהועלו</th>
                  {visibleColOrder.map((key, i) => {
                    const col = CHECK_MOVABLE_COLS.find(c => c.key === key);
                    const gi = groupStartInfo[key];
                    if (gi.grouped && !gi.start) return null;
                    if (gi.grouped && gi.start) {
                      return (
                        <th key={key} scope="col" colSpan={gi.colSpan} rowSpan={1}
                          className="px-3 py-2.5 font-semibold whitespace-nowrap text-center text-slate-700 border border-black">
                          {gi.header}
                        </th>
                      );
                    }
                    const origIdx = colOrder.indexOf(key);
                    const isDragging = dragIndex === origIdx;
                    const isOver = dragOverIndex === origIdx && dragIndex !== origIdx;
                    return (
                      <th
                        key={key}
                        scope="col"
                        rowSpan={2}
                        draggable
                        title="גרור לשינוי סדר"
                        onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragIndex(origIdx); }}
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIndex(origIdx); }}
                        onDrop={e => { e.preventDefault(); handleColDrop(origIdx); setDragIndex(null); setDragOverIndex(null); }}
                        onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                        className={[
                          "px-4 py-2.5 font-semibold select-none transition-all cursor-grab active:cursor-grabbing whitespace-nowrap text-right border border-black",
                          isDragging ? "opacity-30 bg-slate-100" : "",
                          isOver ? "bg-blue-50 text-blue-600 border-b-2 border-blue-400" : "text-slate-700",
                        ].filter(Boolean).join(" ")}
                      >
                        {col?.label}
                      </th>
                    );
                  })}
                  {canDelete && <th scope="col" rowSpan={2} className={thBase} />}
                </tr>
                {/* Row 2: file sub-headers + group sub-labels */}
                <tr className="border-b border-slate-200" style={{ background: "rgba(241,245,249,0.97)" }}>
                  {[["tikhnun-hdr", "תכנון"], ["doch-hdr", "דיווח"], ["kasafim-hdr", "כספים"]].map(([id, label]) => (
                    <th key={id} scope="col"
                      className="px-3 py-1.5 text-xs font-semibold text-slate-500 text-center border border-black">
                      {label}
                    </th>
                  ))}
                  {visibleColOrder.map(key => {
                    const col = CHECK_MOVABLE_COLS.find(c => c.key === key);
                    const gi = groupStartInfo[key];
                    if (!gi.grouped) return null;
                    return (
                      <th key={key} scope="col"
                        className="px-3 py-1.5 text-xs font-semibold text-slate-500 text-center border border-black">
                        {col?.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pendingRun && (!pendingRun.updateLogId || pendingRun.status === "error") && (
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-3" style={{ borderLeft: "1px solid black", position: "sticky", right: 0, zIndex: 5, background: "white", boxShadow: "-6px 0 6px -6px rgba(0,0,0,0.15)" }}>
                      {pendingRun.status === "loading" && (
                        <div className="flex items-center gap-2">
                          <div role="status" aria-label="בבדיקה">
                            <div aria-hidden="true" className="spinner w-4 h-4" />
                          </div>
                          <span className="text-slate-400 text-xs">{formatDateTime(pendingRun.date)}</span>
                        </div>
                      )}
                      {pendingRun.status === "done" && (
                        <CheckLinkTooltip>
                          <button type="button"
                            onClick={() => { setActiveResult({ result: pendingRun.result, runId: pendingRun.runId }); setView("result"); }}
                            className="text-blue-600 hover:text-blue-800 font-medium underline text-sm transition-colors">
                            {formatDateTime(pendingRun.date)}
                          </button>
                        </CheckLinkTooltip>
                      )}
                      {pendingRun.status === "error" && (
                        <div>
                          <span className="text-xs text-slate-500">{formatDateTime(pendingRun.date)}</span>
                          <span role="alert" className="block text-xs text-red-500 mt-0.5">{pendingRun.error}</span>
                        </div>
                      )}
                    </td>
                    {(() => {
                      const r = pendingRun.status === "done" ? pendingRun.result : null;
                      const pLog = r ? {
                        summary: {
                          ...r.summary,
                          tikhnun_overview: r.tikhnun?.overview || {},
                          tikhnun_result: r.tikhnun || null,
                          gefen_only: r.gefen_only ?? false,
                          per_combo_results: r.per_combo_results ?? null,
                        },
                        gefen_file_names: (r.summary?.gefen_files || []).map(f => f.filename).filter(Boolean),
                        finance_file_name: r.summary?.finance_file?.filename || null,
                        in_gefen_not_finance_count: r.summary?.in_gefen_not_finance ?? 0,
                        in_finance_not_gefen_count: r.summary?.in_finance_not_gefen ?? 0,
                        rows_finance_not_gefen: r.rows_finance_not_gefen,
                        rows_gefen_not_finance: r.rows_gefen_not_finance,
                        in_finance_not_gefen_sum: null,
                        in_gefen_not_finance_sum: null,
                      } : null;
                      const pFc = pLog ? getLogFileCols(pLog) : null;
                      const pPerCombo = pLog?.summary?.per_combo_results;
                      const pBudgetEntries = (pPerCombo && selectedHistBudget)
                        ? Object.values(pPerCombo).filter(c => c.budget === selectedHistBudget)
                        : null;
                      return (
                        <>
                          {["tikhnun", "doch", "kasafim"].map(k => (
                            <td key={k} className="px-3 py-3 text-center" style={k === "kasafim" ? { borderLeft: "1px solid black" } : {}}>
                              {pFc == null ? <span className="text-slate-400">—</span>
                                : <FileCheckCell
                                    log={pLog} colKey={k}
                                    state={getFileState(pFc, pBudgetEntries, k)}
                                    notCheckedReason={getFileNotCheckedReason(k, pBudgetEntries, selectedHistBudget)}
                                    title={k === "tikhnun" ? "קובץ תכנון" : k === "doch" ? "קובץ דיווח גפן" : "קובץ כספים"}
                                  />}
                            </td>
                          ))}
                          {visibleColOrder.map(key => (
                            <td key={key} className="px-4 py-3 text-slate-600 whitespace-nowrap" style={colBorderStyle(key)}>
                              {pLog ? renderCheckLogCellForBudget(pLog, key, selectedHistBudget) : <span className="text-slate-400">—</span>}
                            </td>
                          ))}
                        </>
                      );
                    })()}
                    {canDelete && <td className="border-r border-slate-100" />}
                  </tr>
                )}

                {filteredLogs.map(log => {
                  const fc = getLogFileCols(log);
                  const isLoadingThis = loadingLogId === log.id ||
                    (pendingRun?.updateLogId === log.id && pendingRun?.status === "loading");
                  const perCombo = log.summary?.per_combo_results;
                  const budgetEntries = (perCombo && selectedHistBudget)
                    ? Object.values(perCombo).filter(c => c.budget === selectedHistBudget)
                    : null;
                  const fileState = (colKey) => getFileState(fc, budgetEntries, colKey);
                  const fileNotCheckedReason = (colKey) => getFileNotCheckedReason(colKey, budgetEntries, selectedHistBudget);
                  return (
                    <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 font-medium whitespace-nowrap" style={{ borderLeft: "1px solid black", position: "sticky", right: 0, zIndex: 5, background: "white", boxShadow: "-6px 0 6px -6px rgba(0,0,0,0.15)" }}>
                        {isLoadingThis ? (
                          <div className="flex items-center gap-1.5">
                            <div aria-hidden="true" className="spinner w-3 h-3" />
                            <span className="text-slate-400 text-sm">{formatDateTime(log.run_at)}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <CheckLinkTooltip>
                              <button type="button"
                                onClick={() => handleLogClick(log)}
                                className="text-blue-600 hover:text-blue-800 font-medium underline text-sm transition-colors flex flex-col items-start">
                                {log.custom_name && <span>{log.custom_name}</span>}
                                <span className={log.custom_name ? "text-xs font-normal text-slate-400 no-underline" : ""}>
                                  {formatDateTime(log.run_at)}
                                </span>
                              </button>
                            </CheckLinkTooltip>
                            {log.pinned_at && (
                              <svg role="img" aria-label="בדיקה נעוצה" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-slate-800">
                                <line x1="12" y1="17" x2="12" y2="22" />
                                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                              </svg>
                            )}
                          </div>
                        )}
                      </td>

                      {/* File sub-cells */}
                      {[
                        { key: "tikhnun", title: "קובץ תכנון" },
                        { key: "doch",    title: "קובץ דיווח גפן" },
                        { key: "kasafim", title: "קובץ כספים" },
                      ].map(({ key, title }) => (
                        <td key={key} className="px-3 py-3 text-center" style={key === "kasafim" ? { borderLeft: "1px solid black" } : {}}>
                          <FileCheckCell
                            log={log} colKey={key}
                            state={fileState(key)}
                            notCheckedReason={fileNotCheckedReason(key)}
                            title={title}
                            onAddFile={() => setAddFileModal({ log })}
                          />
                        </td>
                      ))}

                      {visibleColOrder.map(key => (
                        <td key={key}
                          className="px-4 py-3 text-slate-600 whitespace-nowrap"
                          style={colBorderStyle(key)}>
                          {renderCheckLogCellForBudget(log, key, selectedHistBudget, () => setAddFileModal({ log }))}
                        </td>
                      ))}

                      {canDelete && (
                        <td className="px-2 py-3 border-r border-slate-100 relative" data-log-menu>
                          <button type="button"
                            data-log-menu
                            aria-label="אפשרויות"
                            onClick={() => setOpenMenuLogId(id => id === log.id ? null : log.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                            </svg>
                          </button>
                          {openMenuLogId === log.id && (
                            <div data-log-menu
                              className="absolute bottom-0 left-full ml-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[140px]">
                              <button type="button"
                                data-log-menu
                                onClick={() => handlePinToggle(log)}
                                className="w-full flex items-center gap-2 text-right px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap">
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill={log.pinned_at ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                                  <line x1="12" y1="17" x2="12" y2="22" />
                                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                                </svg>
                                {log.pinned_at ? "בטל נעיצה" : "נעץ"}
                              </button>
                              <button type="button"
                                data-log-menu
                                onClick={() => {
                                  setRenameTarget({ log });
                                  setRenameValue(log.custom_name || "");
                                  setRenameError("");
                                  setOpenMenuLogId(null);
                                }}
                                className="w-full text-right px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap">
                                ערוך שם בדיקה
                              </button>
                              <button type="button"
                                data-log-menu
                                onClick={() => { setDeleteTargetId(log.id); setOpenMenuLogId(null); }}
                                className="w-full text-right px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                                מחק
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}

                {filteredLogs.length === 0 && !pendingRun && (
                  <tr>
                    <td colSpan={4 + visibleColOrder.length + (canDelete ? 1 : 0)} className="px-5 py-10 text-center text-slate-400">
                      {logsLoading ? (
                        <div role="status" aria-label="טוען בדיקות קודמות" className="flex items-center justify-center gap-2">
                          <div aria-hidden="true" className="spinner w-4 h-4" />
                          <span>טוען בדיקות קודמות...</span>
                        </div>
                      ) : (
                        "אין בדיקות קודמות"
                      )}
                    </td>
                  </tr>
                )}

                {/* Filler row: extends vertical column borders to the bottom of the container */}
                {(filteredLogs.length > 0 || !!pendingRun) && (
                  <tr style={{ height: "100%" }}>
                    <td style={{ borderLeft: "1px solid black", position: "sticky", right: 0, zIndex: 5, background: "white" }} />
                    <td /><td />
                    <td style={{ borderLeft: "1px solid black" }} />
                    {visibleColOrder.map(key => (
                      <td key={key} style={colBorderStyle(key)} />
                    ))}
                    {canDelete && <td />}
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!logsError && (
          <>
            <button type="button"
              aria-label="גלול ימינה"
              onClick={() => historyScrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
              style={{ position: "absolute", bottom: 2, right: 2, height: 14, width: 18, zIndex: 25 }}
              className="flex items-center justify-center rounded bg-white/80 text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shadow-sm">
              <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button type="button"
              aria-label="גלול שמאלה"
              onClick={() => historyScrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
              style={{ position: "absolute", bottom: 2, left: 2, height: 14, width: 18, zIndex: 25 }}
              className="flex items-center justify-center rounded bg-white/80 text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shadow-sm">
              <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {showNewCheckModal && (
        <NewCheckModal
          accounts={getModalAccounts()}
          defaultAccountId={getModalAccounts().length === 1 ? getModalAccounts()[0].id : ""}
          onClose={() => setShowNewCheckModal(false)}
          onConfirm={startCheck}
        />
      )}

      {showCompareModal && (
        <CompareChecksModal
          logs={filteredLogs}
          onClose={() => setShowCompareModal(false)}
          onCompare={(newerId, olderId) => {
            const newerLog = filteredLogs.find(l => l.id === newerId);
            const olderLog = filteredLogs.find(l => l.id === olderId);
            if (newerLog && olderLog) {
              const token = openCompare(buildCompareData(newerLog, olderLog, schoolName));
              axios.post("/analyze/compare-plans", { newer_log_id: newerId, older_log_id: olderId })
                .then(({ data }) => {
                  patchCompare(token, prev => ({ budgets: mergeMengonimIntoBudgets(prev.budgets, data) }));
                })
                .catch(() => {
                  patchCompare(token, prev => ({
                    budgets: prev.budgets.map(b => ({ ...b, mengonim: { status: "error" } })),
                  }));
                });
            }
            setShowCompareModal(false);
          }}
        />
      )}

      {addFileModal && (() => {
        const s = addFileModal.log.summary || {};
        const hasStoredFiles = !!(s.stored_file_paths?.length);
        if (!hasStoredFiles) {
          return <LegacyAddFileModal log={addFileModal.log} onClose={() => setAddFileModal(null)} onNewCheck={() => { setAddFileModal(null); setShowNewCheckModal(true); }} />;
        }
        const origFiles = [
          ...(addFileModal.log.gefen_file_names || []),
          ...(addFileModal.log.finance_file_name ? [addFileModal.log.finance_file_name] : []),
          ...(s.tikhnun_filenames || []),
        ];
        return (
          <NewCheckModal
            accounts={[]}
            defaultAccountId=""
            title="הוספת קובץ לבדיקה"
            infoText={origFiles.length
              ? `קבצים מקוריים: ${origFiles.join(", ")}. העלה את הקובץ החסר בלבד — שאר הקבצים יורדו אוטומטית.`
              : "העלה את הקובץ החסר בלבד — שאר הקבצים יורדו אוטומטית."}
            onClose={() => setAddFileModal(null)}
            onConfirm={startUpdateCheck}
          />
        );
      })()}

      {deleteTargetId && (
        <DeleteCheckModal
          deleting={!!deletingId}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTargetId(null)}
        />
      )}

      {renameTarget && (
        <RenameCheckModal
          value={renameValue}
          onChange={setRenameValue}
          onSave={handleRenameSave}
          onCancel={() => setRenameTarget(null)}
          saving={savingRename}
          error={renameError}
        />
      )}

      {divisionMismatch && (
        <DivisionMismatchModal
          detectedDivision={divisionMismatch.detectedDivision}
          activeSubTab={activeSubTab}
          onSaveForOther={handleSaveForOtherDivision}
          onDismiss={() => setDivisionMismatch(null)}
        />
      )}

      {stageMismatch && (
        <StageMismatchModal
          detectedDivision={stageMismatch.detectedDivision}
          schoolStage={schoolStage}
          onConfirm={handleStageMismatchConfirm}
          onCancel={handleStageMismatchCancel}
        />
      )}

      {classifyQueue.length > 0 && (
        <ClassifyModal
          item={classifyQueue[0]}
          runId={classifyQueue[0]?.runId}
          onComplete={(division, tikhnun, perComboResults) => {
            setClassifyQueue(prev => prev.slice(1));
            if (perComboResults != null) {
              setPendingRun(prev => prev ? { ...prev, result: { ...(prev.result || {}), per_combo_results: perComboResults } } : prev);
            }
            onReloadLogs();
          }}
          onCancel={() => {
            setClassifyQueue([]);
            setPendingRun(null);
          }}
        />
      )}
    </div>
  );
}

export default function SchoolPage() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const yearParam = searchParams.get("year");
  const academicYear = ACADEMIC_YEARS.includes(yearParam) ? yearParam : DEFAULT_ACADEMIC_YEAR;
  function setAcademicYear(year) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("year", year);
      return p;
    });
  }

  const [school, setSchool] = useState(location.state?.school || null);
  const [accounts, setAccounts] = useState(location.state?.school?.gefen_accounts || []);
  const [logs, setLogs] = useState([]);
  const [logsError, setLogsError] = useState("");
  const [logsLoading, setLogsLoading] = useState(true);
  const [meetingsError, setMeetingsError] = useState("");
  const [calls, setCalls] = useState([]);
  const [callsError, setCallsError] = useState("");
  const [callsLoading, setCallsLoading] = useState(true);
  const [voicenterEnabled, setVoicenterEnabled] = useState(true);
  const [loading, setLoading] = useState(!location.state?.school);
  const [activeTab, setActiveTab] = useState("info");
  const [activeSubTab, setActiveSubTab] = useState("tikkon");
  const [uploadComparisonMeetingId, setUploadComparisonMeetingId] = useState(null);

  // "מחיר כולל מע"מ" — synced with the same admin-table field on AdminPage's schools table
  // (both read/write the school_year_admin_data row for this school_id+academic_year).
  const [yearAdminData, setYearAdminData] = useState({});

  useEffect(() => {
    const meetingParam = searchParams.get("meeting");
    const tabParam = searchParams.get("tab");
    if (meetingParam) {
      setActiveTab("meetings");
      setUploadComparisonMeetingId(meetingParam);
    } else if (["info", "meetings", "goals", "checks", "tasks", "calls", "closure", "control_letter"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, []);
  const [role, setRole] = useState("advisor");
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  // "צפייה בכרטיס בית ספר" permission. null = not resolved yet (show spinner, never the
  // card — prevents a flash of stale content); false = blocked → no-access screen;
  // true = allowed. Resolved from /users/me and, authoritatively, from GET /schools/{id}.
  const [canViewSchoolCard, setCanViewSchoolCard] = useState(null);
  const [notesData, setNotesData] = useState(null); // { general: [...], quarterly: {1:[...],2:[...],3:[...],4:[...]} }
  const [filesData, setFilesData] = useState(null); // flat array of school_files rows

  useEffect(() => {
    if (!schoolId) return;
    axios.get(`/schools/${schoolId}/year-admin-data`, { params: { academic_year: academicYear } })
      .then(res => setYearAdminData(res.data && typeof res.data === "object" ? res.data : {}))
      .catch(() => setYearAdminData({}));
  }, [schoolId, academicYear]);

  async function saveYearAdminField(field, value) {
    setYearAdminData(prev => ({ ...prev, [field]: value }));
    try {
      const res = await axios.put(`/schools/${schoolId}/year-admin-data`, { [field]: value }, { params: { academic_year: academicYear } });
      setYearAdminData(res.data && typeof res.data === "object" ? res.data : {});
    } catch {
      // revert on failure
      axios.get(`/schools/${schoolId}/year-admin-data`, { params: { academic_year: academicYear } })
        .then(res => setYearAdminData(res.data && typeof res.data === "object" ? res.data : {}))
        .catch(() => {});
    }
  }

  // "מחיר כולל מע"מ" — editable input (edit mode) rendered in orderAmountEditField below;
  // display mode shows the same value read-only (see the ליווי display grid).
  function saveOrderAmountGefen(v) {
    if (v !== (yearAdminData.order_amount_gefen ?? null)) saveYearAdminField("order_amount_gefen", v);
  }

  // Meetings state
  const [meetings, setMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [notesModal, setNotesModal] = useState(null);
  const [summaryModalFor, setSummaryModalFor] = useState(null);
  const [showCalendarColumn, setShowCalendarColumn] = useState(false);
  const [advisorAccessModal, setAdvisorAccessModal] = useState(null); // {advisorId, advisorName, meetingDate}
  const sessionCreatedMeetingIdsRef = useRef(new Set());
  const [pendingTabSwitch, setPendingTabSwitch] = useState(null);
  const [meetingGuardBusy, setMeetingGuardBusy] = useState(false);

  const [schoolAdvisors, setSchoolAdvisors] = useState(
    (location.state?.school?.advisor_schools || []).map(as => as.profiles).filter(Boolean)
  );
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Per-service-type "יועץ מלווה [גפן/שוטף/מחוז]" draft selection while editing — kept purely
  // local until saveEdit() diffs each list against originalTypedAdvisorIds and only sends the
  // net add/remove calls (and notifications), same pattern the old single general list used.
  const emptyTypedAdvisorIds = { gefen: [], current: [], district: [] };
  const [typedAdvisors, setTypedAdvisors] = useState({
    gefen: location.state?.school?.advisors_gefen || [],
    current: location.state?.school?.advisors_current || [],
    district: location.state?.school?.advisors_district || [],
  });
  const [draftTypedAdvisorIds, setDraftTypedAdvisorIds] = useState(emptyTypedAdvisorIds);
  const [originalTypedAdvisorIds, setOriginalTypedAdvisorIds] = useState(emptyTypedAdvisorIds);

  const [isEditing, setIsEditing] = useState(false);
  const [originalForm, setOriginalForm] = useState(null);
  const [accessLinkedToAdvisors, setAccessLinkedToAdvisors] = useState(false);
  const [canDeleteSchool, setCanDeleteSchool] = useState(false);
  const [canDeleteMeetings, setCanDeleteMeetings] = useState(false);
  const [canRemoveCallFromSchool, setCanRemoveCallFromSchool] = useState(false);
  const [meetingReminderToasts, setMeetingReminderToasts] = useState([]);
  const [meetingAlreadySentModal, setMeetingAlreadySentModal] = useState(null);
  function addMeetingReminderToast(msg) {
    const id = Date.now();
    setMeetingReminderToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setMeetingReminderToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }
  const [canEditDirectly, setCanEditDirectly] = useState(false);
  const [canRequestUpdate, setCanRequestUpdate] = useState(false);
  const [requestSuccessData, setRequestSuccessData] = useState(null);
  const [isRequestMode, setIsRequestMode] = useState(false);
  const [showDeleteRequestConfirm, setShowDeleteRequestConfirm] = useState(false);
  const [submittingDeleteRequest, setSubmittingDeleteRequest] = useState(false);
  const [showEditDots, setShowEditDots] = useState(false);
  const editDotsRef = useRef(null);
  const [showSchoolDeleteConfirm, setShowSchoolDeleteConfirm] = useState(false);
  const [deletingSchool, setDeletingSchool] = useState(false);
  const [recycleInfoSchoolName, setRecycleInfoSchoolName] = useState(null);
  const [pendingStageScopeChoice, setPendingStageScopeChoice] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", symbol: "", city: "", authority: "",
    stage: "",
    finance_software: "",
    principal_name: "", principal_phone: "", principal_email: "",
    secretary_name: "", secretary_phone: "", secretary_email: "",
    finance_contact_name: "", finance_contact_phone: "", finance_contact_email: "",
    school_phone: "", address: "", district: "",
    restrict_access_to: null,
    extra_contacts: [],
    principal_day_off: [], secretary_day_off: [], finance_contact_day_off: [],
    meeting_coordinator: null,
    principal_chativa_name: "", principal_chativa_phone: "", principal_chativa_email: "",
    principal_chativa_day_off: [], principal_same_person: true,
    education_authority: "", sector: "", supervision: "",
    grade_levels: [], study_days: [], student_count: "",
  });
  const [saving, setSaving] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestForm, setRequestForm] = useState({});
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestMsg, setRequestMsg] = useState("");

  const isDirty = isEditing && originalForm !== null &&
    JSON.stringify(editForm) !== JSON.stringify(originalForm);

  const incompleteSessionMeetings = meetings.filter(m =>
    sessionCreatedMeetingIdsRef.current.has(m.id) && isMeetingIncomplete(m, { requireAdvisor: true })
  );
  const hasIncompleteMeetings = incompleteSessionMeetings.length > 0;

  const blocker = useBlocker(isDirty || hasIncompleteMeetings);

  function updateActiveTab(id) {
    setActiveTab(id);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("tab", id);
      return p;
    });
  }

  function handleTabClick(id) {
    if (activeTab === "meetings" && id !== "meetings" && hasIncompleteMeetings) {
      setPendingTabSwitch(id);
      return;
    }
    updateActiveTab(id);
  }

  async function discardIncompleteMeetings(ids) {
    for (const id of ids) {
      try {
        await axios.delete(`/schools/${schoolId}/meetings/${id}`);
      } catch { /* best-effort */ }
    }
    setMeetings(prev => prev.filter(m => !ids.includes(m.id)));
    ids.forEach(id => sessionCreatedMeetingIdsRef.current.delete(id));
  }

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await axios.get("/schools/users/all");
      setUsers(Array.isArray(res.data) ? res.data : []);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLogsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const userRole = session?.user.user_metadata?.role || "advisor";
      if (session) setRole(userRole);

      let meFetchOk = false;
      try {
        const meRes = await axios.get("/schools/users/me");
        meFetchOk = true;
        setCurrentUser(meRes.data || null);
        setCanViewSchoolCard(meRes.data?.can_view_school_card !== false);
        if (meRes.data?.org?.subscription_status) {
          setSubscriptionStatus(meRes.data.org.subscription_status);
        }
        if (meRes.data?.role) setRole(meRes.data.role);
        if (meRes.data?.can_delete_schools) setCanDeleteSchool(true);
        setCanDeleteMeetings(!!meRes.data?.can_delete_own_meetings);
        setCanRemoveCallFromSchool(!!meRes.data?.can_remove_call_from_school);
        setCanEditDirectly(!!meRes.data?.can_edit_school_directly);
        setCanRequestUpdate(meRes.data?.can_request_school_update !== false);
      } catch {
        // non-fatal
      }

      // Always re-fetch fresh — location.state.school (passed from DashboardPage's row click)
      // is a snapshot that can be stale (DashboardPage only re-fetches on its own mount/
      // academic-year change, not on every visit), which previously caused already-removed
      // typed advisors (e.g. a district advisor unassigned in a prior visit) to intermittently
      // reappear here. The location.state.school value is still used as the initial useState
      // seed above (instant paint, no blank flash) — this fetch just corrects it moments later.
      try {
        const schoolRes = await axios.get(`/schools/${schoolId}`);
        setSchool(schoolRes.data);
        setAccounts(schoolRes.data?.gefen_accounts || []);
        setSchoolAdvisors(
          (schoolRes.data?.advisor_schools || []).map(as => as.profiles).filter(Boolean)
        );
        setTypedAdvisors({
          gefen: schoolRes.data?.advisors_gefen || [],
          current: schoolRes.data?.advisors_current || [],
          district: schoolRes.data?.advisors_district || [],
        });
        setCanViewSchoolCard(true); // authoritative: the card endpoint let us through
      } catch (err) {
        if (err?.response?.status === 403) {
          // "צפייה בכרטיס בית ספר" permission is off for this account type — hard block,
          // regardless of any advisor assignment / access grant.
          setCanViewSchoolCard(false);
        } else if (!meFetchOk) {
          // Transient failure and /users/me also failed — don't lock out a legitimate
          // user over a blip; fall back to allowing the (possibly stale) snapshot.
          setCanViewSchoolCard(prev => (prev === null ? true : prev));
        }
        // else: non-fatal — page still usable with the initial snapshot
      }

      const [accountsResult, logsResult] = await Promise.allSettled([
        axios.get(`/schools/${schoolId}/accounts`),
        axios.get(`/schools/${schoolId}/logs`, { params: { academic_year: academicYear } }),
      ]);

      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value.data || []);

      if (logsResult.status === "fulfilled") {
        setLogs(logsResult.value.data || []);
      } else {
        try {
          await new Promise(r => setTimeout(r, 400));
          const res = await axios.get(`/schools/${schoolId}/logs`, { params: { academic_year: academicYear } });
          setLogs(res.data || []);
        } catch {
          setLogsError("שגיאה בטעינת ההיסטוריה");
        }
      }
      setLogsLoading(false);
      setLoading(false);

      // Defer user list after critical data renders — avoids competing with accounts/logs on mount
      if (userRole === "owner" || userRole === "manager") {
        loadUsers();
      }
    }
    load();
  }, [schoolId, academicYear]);

  useEffect(() => {
    let cancelled = false;
    axios.get(`/schools/${schoolId}/notes`).then(({ data }) => {
      if (!cancelled) setNotesData(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [schoolId]);

  async function createSchoolNote(noteType, quarter, content) {
    const { data: created } = await axios.post(`/schools/${schoolId}/notes`, { note_type: noteType, quarter, content });
    const segment = {
      id: created.id, author_id: created.author_id, author_name: currentUser?.full_name, author_role: currentUser?.role,
      content: created.content, created_at: created.created_at, updated_at: created.updated_at,
    };
    const newGroup = { group_id: created.group_id, segments: [segment] };
    setNotesData(d => noteType === "general"
      ? { ...d, general: [newGroup, ...(d?.general || [])] }
      : { ...d, quarterly: { ...d?.quarterly, [quarter]: [newGroup, ...(d?.quarterly?.[quarter] || [])] } });
  }

  async function editSchoolNote(noteType, quarter, segmentId, groupId, content) {
    await axios.patch(`/schools/${schoolId}/notes/segments/${segmentId}`, { content });
    const apply = groups => groups.map(g => g.group_id !== groupId ? g : { ...g, segments: g.segments.map(s => s.id === segmentId ? { ...s, content } : s) });
    setNotesData(d => noteType === "general"
      ? { ...d, general: apply(d?.general || []) }
      : { ...d, quarterly: { ...d?.quarterly, [quarter]: apply(d?.quarterly?.[quarter] || []) } });
  }

  async function deleteSchoolNote(noteType, quarter, groupId, segmentId) {
    await axios.delete(`/schools/${schoolId}/notes/segments/${segmentId}`);
    const apply = groups => groups.map(g => g.group_id !== groupId ? g : { ...g, segments: g.segments.filter(s => s.id !== segmentId) }).filter(g => g.segments.length > 0);
    setNotesData(d => noteType === "general"
      ? { ...d, general: apply(d?.general || []) }
      : { ...d, quarterly: { ...d?.quarterly, [quarter]: apply(d?.quarterly?.[quarter] || []) } });
  }

  useEffect(() => {
    let cancelled = false;
    axios.get(`/schools/${schoolId}/files`).then(({ data }) => {
      if (!cancelled) setFilesData(Array.isArray(data) ? data : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [schoolId]);

  async function uploadSchoolFile(file, description) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("description", description || "");
    const { data: created } = await axios.post(`/schools/${schoolId}/files`, formData);
    setFilesData(prev => [created, ...(prev || [])]);
  }

  async function editSchoolFileDescription(fileId, description) {
    await axios.patch(`/schools/${schoolId}/files/${fileId}`, { description });
    setFilesData(prev => (prev || []).map(f => f.id === fileId ? { ...f, description } : f));
  }

  async function deleteSchoolFile(fileId) {
    await axios.delete(`/schools/${schoolId}/files/${fileId}`);
    setFilesData(prev => (prev || []).filter(f => f.id !== fileId));
  }

  async function downloadSchoolFile(fileId, fileName) {
    const res = await axios.get(`/schools/${schoolId}/files/${fileId}/download`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadMeetings({ silent } = {}) {
    if (!silent) setMeetingsLoading(true);
    setMeetingsError("");
    try {
      const res = await axios.get(`/schools/${schoolId}/meetings`, { params: { academic_year: academicYear } });
      if (silent) {
        setMeetings(prev => mergeMeetingsSilently(prev, res.data || []));
      } else {
        setMeetings(res.data || []);
      }
    } catch {
      if (!silent) setMeetingsError("שגיאה בטעינת הפגישות — נסה לרענן");
    } finally {
      if (!silent) setMeetingsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "meetings") {
      loadMeetings();
      if (users.length === 0 && (role === "owner" || role === "manager")) loadUsers();
    }
  }, [activeTab, schoolId, role, academicYear]);

  async function loadCalls() {
    setCallsLoading(true);
    setCallsError("");
    try {
      const res = await axios.get(`/schools/${schoolId}/calls`, { params: { academic_year: academicYear } });
      setCalls(res.data?.calls || []);
      setVoicenterEnabled(res.data?.voicenter_enabled !== false);
    } catch {
      setCallsError("שגיאה בטעינת השיחות — נסה לרענן");
      setCalls([]);
    } finally {
      setCallsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "calls") loadCalls();
  }, [activeTab, schoolId, academicYear]);

  useEffect(() => {
    axios.get("/calendar/connection")
      .then(r => setShowCalendarColumn(r.data?.org?.status === "connected"))
      .catch(() => {});
  }, []);

  useMeetingsPolling(() => loadMeetings({ silent: true }), activeTab === "meetings", [schoolId, academicYear]);

  // Union of the 3 per-service-type advisor drafts — replaces the old single general
  // "יועץ מלווה" list for the "גישה" convenience selector and its "linked to advisors" mode.
  const draftLinkedAdvisorIds = [...new Set([
    ...draftTypedAdvisorIds.gefen, ...draftTypedAdvisorIds.current, ...draftTypedAdvisorIds.district,
  ])];

  // When "היועצים המלווים שנבחרו" mode is active, keep restrict_access_to in sync
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    setEditForm(p => ({ ...p, restrict_access_to: draftLinkedAdvisorIds.length > 0 ? draftLinkedAdvisorIds : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTypedAdvisorIds, accessLinkedToAdvisors]);

  async function createMeetingRow(stageScope) {
    const meetingServiceType = defaultMeetingServiceType(yearAdminData.service_type);
    const defaultAdvisorIds = resolveDefaultAdvisorIds(meetingServiceType, {
      gefenAdvisors: typedAdvisors.gefen, currentAdvisors: typedAdvisors.current, districtAdvisors: typedAdvisors.district,
    });
    const defaultAdvisorProfiles = [typedAdvisors.gefen, typedAdvisors.current, typedAdvisors.district]
      .flat().filter(p => defaultAdvisorIds.includes(p.id))
      .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);
    // For a six-year school, "תיכון בלבד"/"חט"ב בלבד" pre-fill the relevant principal as
    // the default participant; "שניהם יחד" leaves participants empty for manual selection.
    const contacts = getSchoolContacts();
    let participants = [];
    if (stageScope === "tichon") {
      const c = contacts.find(x => x.key === "principal");
      if (c) participants = [c];
    } else if (stageScope === "chativa") {
      const c = contacts.find(x => x.key === "principal_chativa") || contacts.find(x => x.key === "principal");
      if (c) participants = [c];
    }
    const payload = {
      status: "scheduled",
      meeting_type: "remote",
      meeting_service_type: meetingServiceType,
      advisor_ids: defaultAdvisorIds,
      participants,
      primary_contact_key: participants.length === 1 ? participants[0].key : null,
      academic_year: academicYear,
      ...(stageScope === "tichon" || stageScope === "chativa" || stageScope === "both" ? { stage_scope: stageScope } : {}),
    };
    try {
      const res = await axios.post(`/schools/${schoolId}/meetings`, payload);
      const newMeeting = { ...res.data, advisor_profiles: defaultAdvisorProfiles };
      setMeetings(prev => [newMeeting, ...prev]);
      sessionCreatedMeetingIdsRef.current.add(newMeeting.id);
    } catch (err) {
      console.error("Failed to create meeting:", err);
    }
  }

  async function startNewMeeting() {
    if (school?.stage === "sheshshnati") {
      setPendingStageScopeChoice(true);
      return;
    }
    await createMeetingRow(null);
  }

  async function handleStageScopeChoice(scope) {
    setPendingStageScopeChoice(false);
    if (scope === "separate") {
      await createMeetingRow("tichon");
      await createMeetingRow("chativa");
    } else {
      await createMeetingRow(scope);
    }
  }

  // Only managers/owners can actually act on the grant modal's buttons (backend enforces
  // this too) — advisors picking a no-access colleague just see the pick go through silently,
  // same as before this feature existed, rather than a modal whose buttons would 403.
  function handleRequestAdvisorAccess(advisorId, advisorName, meetingDate) {
    if (!(role === "owner" || role === "manager")) return;
    setAdvisorAccessModal({ advisorId, advisorName, meetingDate });
  }

  async function refreshSchoolAdvisors() {
    try {
      const res = await axios.get(`/schools/${schoolId}/advisors`);
      setSchoolAdvisors(res.data || []);
    } catch {}
  }

  function normalizeTime(t) {
    if (!t) return null;
    const digits = t.replace(/\D/g, "");
    if (!digits) return null;
    let hh, mm;
    if (digits.length <= 2) { hh = digits.padStart(2, "0"); mm = "00"; }
    else if (digits.length === 3) { hh = "0" + digits[0]; mm = digits.slice(1); }
    else { hh = digits.slice(0, 2); mm = digits.slice(2, 4); }
    if (parseInt(hh) > 23) hh = "23";
    if (parseInt(mm) > 59) mm = "59";
    return `${hh}:${mm}`;
  }

  async function updateMeeting(draft) {
    if (!draft?.id) return;
    // Optimistic update: reflect changes immediately so summary row recalculates
    setMeetings(prev => prev.map(m => m.id === draft.id ? { ...m, ...draft } : m));
    const payload = {
      meeting_date: draft.meeting_date || null,
      status: draft.status || "scheduled",
      start_time: normalizeTime(draft.start_time),
      end_time: normalizeTime(draft.end_time),
      advisor_ids: draft.advisor_ids || [],
      participants: draft.participants || [],
      meeting_type: draft.meeting_type || null,
      meeting_service_type: draft.meeting_service_type || null,
      actual_duration: draft.actual_duration || null,
      notes: draft.notes || null,
      // reminder_enabled is intentionally NOT sent here — the toggle writes via its own
      // PATCH so a racing field autosave can't flip it back. See MeetingRow.patchReminder.
      primary_contact_key: draft.primary_contact_key || null,
      stage_scope: draft.stage_scope || null,
    };
    try {
      const res = await axios.put(`/schools/${schoolId}/meetings/${draft.id}`, payload);
      const saved = { ...res.data, advisor_profiles: draft.advisor_profiles || [] };
      setMeetings(prev => prev.map(m => m.id === draft.id ? saved : m));
    } catch (err) {
      console.error("Update meeting failed:", err);
      loadMeetings(); // revert on error
    }
  }


  async function deleteMeeting(meetingId) {
    await axios.delete(`/schools/${schoolId}/meetings/${meetingId}`);
    setMeetings(prev => prev.filter(m => m.id !== meetingId));
  }

  async function sendStatusReminderFromSchool(meeting, force = false) {
    try {
      const res = await axios.post(`/schools/meetings/${meeting.id}/send-status-reminder?force=${force}`);
      if (res.data.already_sent && !force) {
        setMeetingAlreadySentModal({ meeting, lastSentAt: res.data.last_sent_at, recipients: res.data.recipients });
        return;
      }
      const names = (res.data.recipients || []).map(r => r.full_name || r.email || "").filter(Boolean).join(", ");
      const d = meeting.meeting_date ? formatDate(meeting.meeting_date) : "";
      addMeetingReminderToast(`נשלחה תזכורת ל-${names} עבור עדכון סטטוס פגישה (${d})`);
    } catch (e) {
      addMeetingReminderToast(e.response?.data?.detail || "שגיאה בשליחת התזכורת");
    }
  }

  function getSchoolContacts() {
    const contacts = [];
    const isSheshsSnatiSchool = school?.stage === "sheshshnati";
    if (school?.principal_name) {
      contacts.push({ key: "principal", label: isSheshsSnatiSchool ? "מנהל/ת חט\"ע" : "מנהל/ת", name: school.principal_name, email: school.principal_email || "" });
    }
    if (isSheshsSnatiSchool && school?.principal_same_person === false && school?.principal_chativa_name) {
      contacts.push({ key: "principal_chativa", label: "מנהל/ת חט\"ב", name: school.principal_chativa_name, email: school.principal_chativa_email || "" });
    }
    if (school?.secretary_name) contacts.push({ key: "secretary", label: "מנהלנ/ית", name: school.secretary_name, email: school.secretary_email || "" });
    if (school?.finance_contact_name) contacts.push({ key: "finance", label: "אחראי/ת כספים", name: school.finance_contact_name, email: school.finance_contact_email || "" });
    (school?.extra_contacts || []).forEach((ec, i) => {
      if (ec.name) contacts.push({ key: `extra_${i}`, label: ec.role || "איש קשר נוסף", name: ec.name, email: ec.email || "" });
    });
    return contacts;
  }

  function advisorHasAccess(advisorId) {
    if (!advisorId) return true;
    const rat = school?.restrict_access_to;
    if (rat === null || rat === undefined) return true;
    if ((rat || []).includes(advisorId)) return true;
    if (schoolAdvisors.some(a => a.id === advisorId)) return true;
    return false;
  }

  useEffect(() => {
    function handler(e) { if (editDotsRef.current && !editDotsRef.current.contains(e.target)) setShowEditDots(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleSchoolDelete() {
    setDeletingSchool(true);
    try {
      await axios.delete(`/schools/${schoolId}`);
      setShowSchoolDeleteConfirm(false);
      setRecycleInfoSchoolName(school?.name || "");
    } catch {
      setDeletingSchool(false);
    }
  }

  function startEdit(requestMode = false) {
    const formData = {
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
      restrict_access_to: school.restrict_access_to ?? null,
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
    };
    setEditForm(formData);
    setOriginalForm(formData);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    if (role === "owner" || role === "manager") {
      axios.get(`/schools/${schoolId}/advisors`).then(res => {
        setSchoolAdvisors(res.data || []);
      }).catch(() => {});
      Promise.allSettled([
        axios.get(`/schools/${schoolId}/advisors/gefen`),
        axios.get(`/schools/${schoolId}/advisors/current`),
        axios.get(`/schools/${schoolId}/advisors/district`),
      ]).then(([g, c, d]) => {
        const next = {
          gefen: g.status === "fulfilled" ? (g.value.data || []) : [],
          current: c.status === "fulfilled" ? (c.value.data || []) : [],
          district: d.status === "fulfilled" ? (d.value.data || []) : [],
        };
        setTypedAdvisors(next);
        const ids = {
          gefen: next.gefen.map(a => a.id),
          current: next.current.map(a => a.id),
          district: next.district.map(a => a.id),
        };
        setDraftTypedAdvisorIds(ids);
        setOriginalTypedAdvisorIds(ids);
      });
      loadUsers();
    }
    setIsEditing(true);
    setIsRequestMode(requestMode);
  }

  async function submitFullRequest() {
    const changes = {};
    Object.keys(editForm).forEach(f => {
      if (JSON.stringify(editForm[f]) !== JSON.stringify(originalForm?.[f])) {
        changes[f] = editForm[f];
      }
    });
    if (Object.keys(changes).length === 0) {
      setSaveError("לא בוצע שינוי כלשהו");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`/schools/${schoolId}/update-requests`, { proposed_changes: changes });
      const snapshot = { changes, original: { ...originalForm } };
      setIsEditing(false);
      setIsRequestMode(false);
      setOriginalForm(null);
      setSaveError("");
      setAccessLinkedToAdvisors(false);
      setRequestSuccessData(snapshot);
    } catch {
      setSaveError("שגיאה בשליחת הבקשה — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  async function submitDeleteRequest() {
    setSubmittingDeleteRequest(true);
    try {
      await axios.post(`/schools/${schoolId}/update-requests`, { proposed_changes: { _action: "delete_school" } });
      setShowDeleteRequestConfirm(false);
      setIsEditing(false);
      setIsRequestMode(false);
      setOriginalForm(null);
    } catch {
      // non-fatal — modal stays open
    } finally {
      setSubmittingDeleteRequest(false);
    }
  }

  async function saveEdit() {
    setSaveError("");
    setTriedSave(true);
    const schoolPhoneErr = validateSchoolPhone(editForm.school_phone);
    const principalPhoneErr = validateContactPhone(editForm.principal_phone);
    const secretaryPhoneErr = validateContactPhone(editForm.secretary_phone);
    const financePhoneErr = validateContactPhone(editForm.finance_contact_phone);
    const principalChativaPhoneErr = (editForm.stage === "sheshshnati" && !editForm.principal_same_person)
      ? validateContactPhone(editForm.principal_chativa_phone) : "";
    if (!editForm.name || validateSymbol(editForm.symbol) || schoolPhoneErr || principalPhoneErr || secretaryPhoneErr || financePhoneErr || principalChativaPhoneErr) {
      setSaveError("יש שגיאות בטופס — אנא בדוק את השדות המסומנים.");
      return false;
    }
    if (!editForm.meeting_coordinator) {
      setSaveError("יש לבחור אחראי/ת לתיאום פגישות.");
      return false;
    }
    const managingAdvisors = role === "owner" || role === "manager";
    const requiredServiceTypes = activeServiceTypes(yearAdminData.service_type);
    if (managingAdvisors && yearAdminData.client_status === "active" && requiredServiceTypes.some(t => draftTypedAdvisorIds[t].length === 0)) {
      setSaveError("יש לבחור לפחות יועץ מלווה אחד עבור כל סוג שירות פעיל (גפן/שוטף/מחוז).");
      return false;
    }
    setSaving(true);
    try {
      // Apply only the net advisor changes per type (adds before removes, so the backend's
      // "last advisor" guard never sees a false zero-advisor state) — this is what keeps
      // notifications limited to real, saved changes instead of every click. Each typed
      // assign/unassign call also keeps the general advisor_schools access table in sync
      // server-side, so there's no separate general diff to send from here anymore.
      if (managingAdvisors) {
        for (const t of ["gefen", "current", "district"]) {
          const addedT = draftTypedAdvisorIds[t].filter(id => !originalTypedAdvisorIds[t].includes(id));
          const removedT = originalTypedAdvisorIds[t].filter(id => !draftTypedAdvisorIds[t].includes(id));
          for (const id of addedT) {
            await axios.post(`/schools/${schoolId}/advisors/${t}`, { advisor_id: id });
          }
          for (const id of removedT) {
            await axios.delete(`/schools/${schoolId}/advisors/${t}/${id}`);
          }
        }
      }
      // "אותו מנהל/ת לשתי החטיבות" — the חט"ב fields are hidden in the UI, so keep them
      // in sync with the חט"ע ones rather than sending stale/blank data.
      const chativaSync = (editForm.stage === "sheshshnati" && editForm.principal_same_person)
        ? {
            principal_chativa_name: editForm.principal_name,
            principal_chativa_phone: editForm.principal_phone,
            principal_chativa_email: editForm.principal_email,
            principal_chativa_day_off: editForm.principal_day_off,
          }
        : {};
      const studentCountValue = editForm.student_count === "" || editForm.student_count == null
        ? null
        : parseInt(editForm.student_count, 10);
      await axios.put(`/schools/${schoolId}`, { ...editForm, ...chativaSync, student_count: studentCountValue });
      let updatedAdvisors = schoolAdvisors;
      if (managingAdvisors) {
        const updatedTyped = {
          gefen: draftTypedAdvisorIds.gefen.map(id => users.find(u => u.id === id)).filter(Boolean),
          current: draftTypedAdvisorIds.current.map(id => users.find(u => u.id === id)).filter(Boolean),
          district: draftTypedAdvisorIds.district.map(id => users.find(u => u.id === id)).filter(Boolean),
        };
        setTypedAdvisors(updatedTyped);
        setOriginalTypedAdvisorIds(draftTypedAdvisorIds);
        // Refresh the general advisor list from the server — it was just auto-synced by the
        // typed assign/unassign calls above (upsert on assign, cascade-delete on unassign).
        try {
          const res = await axios.get(`/schools/${schoolId}/advisors`);
          updatedAdvisors = res.data || [];
          setSchoolAdvisors(updatedAdvisors);
        } catch {
          // non-fatal — schoolAdvisors just stays at its previous value until next reload
        }
      }
      setSchool(prev => ({
        ...prev,
        ...editForm,
        ...chativaSync,
        student_count: studentCountValue,
        advisor_schools: updatedAdvisors.map(adv => ({ advisor_id: adv.id, profiles: adv })),
        // Keep the display-mode "גישה" row in sync — otherwise it keeps showing the
        // pre-save snapshot from the initial GET instead of the just-saved selection.
        restrict_access_profiles: (editForm.restrict_access_to || []).map(id => users.find(u => u.id === id)).filter(Boolean),
      }));
      setIsEditing(false);
      setOriginalForm(null);
      setSaveError("");
      return true;
    } catch (err) {
      const msg = err?.response?.data?.detail || "שגיאה בשמירת הנתונים. אנא נסה שוב.";
      setSaveError(msg);
      console.error("saveEdit error:", err?.response?.status, err?.response?.data);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function addExtra() {
    if ((editForm.extra_contacts || []).length >= 3) return;
    setEditForm(p => ({ ...p, extra_contacts: [...(p.extra_contacts || []), { role: "", name: "", phone: "", email: "" }] }));
  }

  function removeExtra(i) {
    setEditForm(p => {
      let coord = p.meeting_coordinator;
      if (coord === `extra:${i}`) coord = null;
      else if (coord?.startsWith("extra:")) {
        const j = Number(coord.split(":")[1]);
        if (j > i) coord = `extra:${j - 1}`;
      }
      return { ...p, extra_contacts: (p.extra_contacts || []).filter((_, idx) => idx !== i), meeting_coordinator: coord };
    });
  }

  function updateExtra(i, field, val) {
    setEditForm(p => ({
      ...p,
      extra_contacts: (p.extra_contacts || []).map((ec, idx) => idx === i ? { ...ec, [field]: val } : ec),
    }));
  }

  function startRequest() {
    setRequestForm({
      name: school?.name || "",
      city: school?.city || "",
      authority: school?.authority || "",
      principal_name: school?.principal_name || "",
      principal_phone: school?.principal_phone || "",
      school_phone: school?.school_phone || "",
      notes: school?.notes || "",
    });
    setRequestMsg("");
    setIsRequesting(true);
  }

  async function submitRequest() {
    const changes = {};
    const fields = ["name","city","authority","principal_name","principal_phone","school_phone","notes"];
    fields.forEach(f => {
      if ((requestForm[f] || "") !== (school?.[f] || "")) changes[f] = requestForm[f];
    });
    if (Object.keys(changes).length === 0) {
      setRequestMsg("לא בוצע שינוי כלשהו.");
      return;
    }
    setRequestSubmitting(true);
    try {
      await axios.post(`/schools/${schoolId}/update-requests`, { proposed_changes: changes });
      setRequestMsg("הבקשה נשלחה בהצלחה לאישור.");
      setIsRequesting(false);
    } catch {
      setRequestMsg("שגיאה בשליחת הבקשה. אנא נסה שוב.");
    } finally {
      setRequestSubmitting(false);
    }
  }

  async function reloadLogs() {
    setLogsLoading(true);
    try {
      const res = await axios.get(`/schools/${schoolId}/logs`, { params: { academic_year: academicYear } });
      setLogs(res.data || []);
      setLogsError("");
    } catch {
      setLogsError("שגיאה בטעינת ההיסטוריה");
    } finally {
      setLogsLoading(false);
    }
  }

  const symbolError = validateSymbol(editForm.symbol);
  const schoolPhoneError = validateSchoolPhone(editForm.school_phone);

  const accessIsAll = school?.restrict_access_to === null || school?.restrict_access_to === undefined;

  const colGridStyle = {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: 10,
    alignItems: "center",
  };

  const labelCls = "text-sm font-medium text-slate-500 py-1.5 whitespace-nowrap flex-shrink-0";
  // Stacked (label above control) variant — used where the column is too narrow for a
  // side-by-side label+control grid (e.g. the 3-up "יועצים מלווים" editor).
  const stackedLabelCls = "text-sm font-medium text-slate-500 block mb-1";

  // ── Section card styling (visual grouping for פרטי בית הספר tab) ──
  // Each logical section (פרטי מוסד / אנשי קשר / ליווי / ...) renders as its own
  // white card: a distinct header bar (tinted background + bottom border) and a
  // padded body below it — the shadcn Card/CardHeader/CardContent split. Purely
  // presentational — no change to which fields exist or how they behave.
  const sectionCardCls = "bg-white rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition-shadow overflow-hidden";
  const sectionHeaderCls = "bg-white border-b border-slate-200/60 px-4 py-3 flex items-center justify-between gap-2";
  const sectionTitleCls = "text-[23px] font-bold text-black flex items-center gap-2";
  const sectionBodyCls = "px-6 py-5";
  // Per-section accent color for the header icon box — gives each area its own identity
  // at a glance (Stripe/Linear-style colored icon chips), matching the section's role.
  const ACCENT_BLUE = "bg-blue-50 text-blue-600";
  const ACCENT_INDIGO = "bg-indigo-50 text-indigo-600";
  const ACCENT_EMERALD = "bg-emerald-50 text-emerald-600";
  const ACCENT_VIOLET = "bg-violet-50 text-violet-600";
  const ACCENT_AMBER = "bg-amber-50 text-amber-600";
  function iconBadge(Icon, accentCls = ACCENT_BLUE) {
    return (
      <span aria-hidden="true" className={`inline-flex items-center justify-center p-2 rounded-xl flex-shrink-0 ${accentCls}`}>
        <Icon className="w-4 h-4" strokeWidth={2} />
      </span>
    );
  }
  // Title text comes before the icon in DOM order so that, under dir="rtl", the
  // icon renders to the LEFT of the text (RTL inline flow starts at the right).
  function sectionTitle(Icon, text, accentCls = ACCENT_BLUE) {
    return <p className={sectionTitleCls}>{text}{iconBadge(Icon, accentCls)}</p>;
  }
  const colDividerCls = "border-slate-200/80";
  // Elegant outline button (Stripe/Linear-style) for secondary "+ add" actions.
  const outlineBtnCls = "border border-slate-300 hover:border-slate-400 text-slate-700 bg-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-all";
  // "Live" data tiles inside פרטי מוסד / ליווי — stacked label-over-value stat tiles.
  // min-h keeps every tile the same height (whether it holds plain text or wrapping chips) so
  // the first row of tiles in "פרטי מוסד" and "פרטי ליווי" line up on the same horizontal line
  // when the two cards sit side by side.
  const tileCls = "bg-slate-100/70 hover:bg-slate-200/60 transition-colors border border-slate-200/90 rounded-xl py-3.5 px-3 min-h-[76px]";
  const tileLabelCls = "text-[13px] font-medium text-gray-500 mb-1";
  const tileValueCls = "text-base font-normal text-gray-900";
  const CLIENT_STATUS_BADGE_CLS = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    inactive: "bg-slate-100 text-slate-500 border-slate-200",
    in_progress: "bg-amber-50 text-amber-700 border-amber-200",
    former: "bg-rose-50 text-rose-600 border-rose-200",
  };
  // Zebra striping + hover for every table row in this tab.
  const rowStripeCls = "even:bg-slate-100/80 hover:bg-blue-50/60 transition-colors";

  function valCls(val) {
    return `text-base py-1.5 ${val ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`;
  }

  function valStyle(val) {
    return val ? {} : EMPTY_BORDER_STYLE;
  }

  function contactValStyle(val) {
    return val ? {} : { ...EMPTY_BORDER_STYLE };
  }

  // Spinner while loading OR while the view permission is still unresolved — the card
  // must never render before we know the user is allowed to see it (no flash).
  if (loading || canViewSchoolCard === null) {
    return (
      <div dir="rtl" className="bg-scene min-h-screen">
        <Sidebar dark />
        <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }} className="flex items-center justify-center min-h-screen">
          <div role="status" aria-label="טוען">
            <div aria-hidden="true" className="spinner w-10 h-10" />
          </div>
        </div>
      </div>
    );
  }

  if (canViewSchoolCard === false) {
    return (
      <div dir="rtl" className="bg-scene min-h-screen">
        <Sidebar dark />
        <div style={{ marginRight: "var(--sidebar-w, 240px)" }} className="flex items-center justify-center min-h-screen p-6">
          <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center border border-slate-100">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, #64748b 0%, #475569 100%)" }}>
              <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">אין הרשאות לצפייה בכרטיס בית הספר</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              זו אינה תקלה — ההרשאה "צפייה בכרטיס בית ספר" כבויה עבור סוג המשתמש שלך.<br />
              אם הגעת לכאן בטעות וצריך גישה, יש לפנות למנהל או לבעלים של הארגון
              כדי שיפעילו עבורך את ההרשאה (ניהול → הרשאות → "צפייה בכרטיס בית ספר").
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate("/")}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: "#0070F3" }}
              >
                חזרה לרשימת בתי הספר
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (subscriptionStatus === "expired") {
    return (
      <div dir="rtl" className="bg-scene min-h-screen">
        <Sidebar dark />
        <div style={{ marginRight: "var(--sidebar-w, 240px)" }} className="flex items-center justify-center min-h-screen p-6">
          <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center border border-slate-100">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" }}>
              <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">תמו ימי הניסיון</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-6">
              כדי לצפות בפרטי בית הספר ולהמשיך לעבוד יש להסדיר את המנוי.<br />
              הנתונים שלכם יישמרו ל-30 הימים הקרובים ולאחר מכן יימחקו.
            </p>
            <div className="flex gap-3 justify-center">
              <a
                href="/contact"
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: "#0070F3" }}
              >
                צור קשר לשדרוג
              </a>
              <button
                onClick={() => navigate(-1)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                חזרה
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />

      {(pendingTabSwitch || (blocker.state === "blocked" && hasIncompleteMeetings)) && (
        <MeetingNavigationGuardModal
          missingFields={[...new Set(incompleteSessionMeetings.flatMap(m => getMissingCriticalFields(m, { requireAdvisor: true })))]}
          busy={meetingGuardBusy}
          onStay={() => {
            if (pendingTabSwitch) setPendingTabSwitch(null);
            else blocker.reset();
          }}
          onSaveAndLeave={() => {
            if (pendingTabSwitch) { updateActiveTab(pendingTabSwitch); setPendingTabSwitch(null); }
            else blocker.proceed();
          }}
          onDiscardAndLeave={async () => {
            setMeetingGuardBusy(true);
            await discardIncompleteMeetings(incompleteSessionMeetings.map(m => m.id));
            setMeetingGuardBusy(false);
            if (pendingTabSwitch) { updateActiveTab(pendingTabSwitch); setPendingTabSwitch(null); }
            else blocker.proceed();
          }}
        />
      )}

      {blocker.state === "blocked" && !hasIncompleteMeetings && (
        <UnsavedChangesModal
          saving={saving}
          onSave={async () => {
            const ok = await saveEdit();
            if (ok) blocker.proceed();
          }}
          onDiscard={() => {
            setIsEditing(false);
            setOriginalForm(null);
            setDraftTypedAdvisorIds(originalTypedAdvisorIds);
            blocker.proceed();
          }}
          onCancel={() => blocker.reset()}
        />
      )}

      {showSchoolDeleteConfirm && (
        <SchoolDeleteConfirmModal
          schoolName={school?.name}
          confirming={deletingSchool}
          onConfirm={handleSchoolDelete}
          onCancel={() => setShowSchoolDeleteConfirm(false)}
        />
      )}

      {recycleInfoSchoolName && (
        <RecycleBinInfoModal
          schoolName={recycleInfoSchoolName}
          onClose={() => navigate("/", { replace: true })}
        />
      )}

      {uploadComparisonMeetingId && (
        <MeetingUploadComparisonModal
          meetingId={uploadComparisonMeetingId}
          onClose={() => {
            setUploadComparisonMeetingId(null);
            setSearchParams(prev => {
              const p = new URLSearchParams(prev);
              p.delete("meeting");
              return p;
            });
          }}
        />
      )}

      {showDeleteRequestConfirm && (
        <SchoolDeleteRequestConfirmModal
          schoolName={school?.name}
          confirming={submittingDeleteRequest}
          onConfirm={submitDeleteRequest}
          onCancel={() => setShowDeleteRequestConfirm(false)}
        />
      )}

      {requestSuccessData && (
        <UpdateRequestSuccessModal
          changes={requestSuccessData.changes}
          originalValues={requestSuccessData.original}
          onClose={() => setRequestSuccessData(null)}
        />
      )}

      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className={`mx-auto px-6 py-10 ${["checks", "meetings", "info", "closure", "control_letter", "tasks", "calls", "goals"].includes(activeTab) ? "max-w-[100rem]" : "max-w-4xl"}`}>

          {/* Page header */}
          <div className="mb-5 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">{school?.name || "בית ספר"}</h1>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 bg-white/70 hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" transform="rotate(180 12 12)" />
              </svg>
              חזרה
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-end border-b border-slate-200 mb-6 gap-1" dir="rtl">
            {[
              { id: "info",     label: "פרטי בית הספר" },
              { id: "meetings", label: "פגישות" },
              { id: "checks",   label: "בדיקות" },
              { id: "tasks",    label: "משימות" },
              { id: "goals",    label: "יעדים" },
              { id: "calls",    label: "שיחות" },
              { id: "closure",  label: "סגירת שנה" },
              { id: "control_letter", label: "מכתב בקרה" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => handleTabClick(t.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === t.id
                    ? "border-blue-600 text-blue-600 font-semibold"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                }`}
              >
                {t.label}
              </button>
            ))}
            {/* Division tabs — shown when checks/goals tab is active for שש-שנתי schools */}
            {(activeTab === "checks" || activeTab === "goals") && school?.stage === "sheshshnati" && (
              <>
                <div className="flex-1" />
                {[{ id: "tikkon", label: "תיכון" }, { id: "beinayim", label: "חטיבת ביניים" }].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveSubTab(t.id)}
                    className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
                      activeSubTab === t.id
                        ? "border-blue-600 text-blue-600 font-semibold"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </>
            )}
            {/* Academic year selector — far left; scopes פגישות/יעדים/בדיקות */}
            {!((activeTab === "checks" || activeTab === "goals") && school?.stage === "sheshshnati") && <div className="flex-1" />}
            {activeTab === "info" && !isEditing && (
              <div className="pb-1.5 flex items-center gap-2">
                {(role === "owner" || role === "manager" || (role === "advisor" && canEditDirectly)) && (
                  <button onClick={() => startEdit(false)}
                    className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 font-medium text-sm rounded-xl px-3.5 py-2 hover:bg-slate-50 transition-colors">
                    <Pencil className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                    ערוך פרטים
                  </button>
                )}
                {role === "advisor" && !canEditDirectly && canRequestUpdate && (
                  <button onClick={() => startEdit(true)}
                    className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 font-medium text-sm rounded-xl px-3.5 py-2 hover:bg-slate-50 transition-colors">
                    <Pencil className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                    בקש עדכון פרטים
                  </button>
                )}
              </div>
            )}
            <div className="pb-1.5">
              <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
            </div>
          </div>

          {/* ─── TAB: פרטי בית הספר ─── */}
          {activeTab === "info" && (
            <div>
              <div className="rounded-xl mb-6 p-5 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">

                {/* ─── EDIT MODE ─── */}
                {isEditing ? (
                <div className="space-y-10">
                  {/* פרטי מוסד + ליווי side by side at the top of the page */}
                  <div className="grid grid-cols-2 gap-4">
                  {/* פרטי מוסד card */}
                  <div className={sectionCardCls}>
                  <div className={sectionHeaderCls}>
                    {sectionTitle(Building2, "פרטי מוסד")}
                    {(isRequestMode || canDeleteSchool) && (
                      <div className="relative" ref={editDotsRef}>
                        <button
                          type="button"
                          onClick={() => setShowEditDots(o => !o)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400"
                          aria-label="אפשרויות נוספות"
                          aria-expanded={showEditDots}
                        >
                          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                          </svg>
                        </button>
                        {showEditDots && (
                          <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-xl py-1 shadow-lg border border-slate-100" style={{ minWidth: 150 }} dir="rtl">
                            <button
                              type="button"
                              onClick={() => {
                                setShowEditDots(false);
                                if (isRequestMode) setShowDeleteRequestConfirm(true);
                                else setShowSchoolDeleteConfirm(true);
                              }}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 text-right transition-colors"
                            >
                              מחק בית ספר
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={sectionBodyCls}>
                  {saveError && (
                    <p role="alert" className="text-sm text-red-600 mb-3 text-right">{saveError}</p>
                  )}

                  {/* Live data tiles — 3×3 grid, one editable stat-tile per field (scrolls to reveal 2 extra rows) */}
                  <div className="max-h-[252px] overflow-y-auto pr-1">
                  <div className="grid grid-cols-3 gap-3">
                    <div className={`${tileCls} min-w-0`}>
                      <label htmlFor="edit-name" className={`${tileLabelCls} block`}>שם מוסד</label>
                      <input id="edit-name" className={`${editFieldCls(triedSave && !editForm.name, !editForm.name)} truncate`} value={editForm.name}
                        onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} autoComplete="off" />
                      {triedSave && !editForm.name && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                    </div>

                    <div className={`${tileCls} min-w-0`}>
                      <label htmlFor="edit-city" className={`${tileLabelCls} block`}>עיר</label>
                      <input id="edit-city" className={`${editFieldCls(false, !editForm.city)} truncate`} value={editForm.city}
                        onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))} autoComplete="off" />
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-finance-software" className={`${tileLabelCls} block`}>תוכנת כספים</label>
                      <select id="edit-finance-software" className={editFieldCls(false, !editForm.finance_software)} value={editForm.finance_software}
                        onChange={e => setEditForm(p => ({ ...p, finance_software: e.target.value }))}>
                        {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-symbol" className={`${tileLabelCls} block`}>סמל מוסד</label>
                      <input id="edit-symbol"
                        className={editFieldCls((triedSave && !editForm.symbol) || (editForm.symbol.length > 0 && !!symbolError), !editForm.symbol)}
                        value={editForm.symbol}
                        onChange={e => setEditForm(p => ({ ...p, symbol: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                        inputMode="numeric" maxLength={6} autoComplete="off" />
                      {(triedSave && !editForm.symbol)
                        ? <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>
                        : (editForm.symbol.length > 0 && symbolError)
                          ? <span className="text-xs text-red-500 block mt-0.5" role="alert">{symbolError}</span>
                          : null}
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-authority" className={`${tileLabelCls} block`}>בעלות</label>
                      <input id="edit-authority" className={editFieldCls(false, !editForm.authority)} value={editForm.authority}
                        onChange={e => setEditForm(p => ({ ...p, authority: e.target.value }))} autoComplete="off" />
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-school-phone" className={`${tileLabelCls} block`}>טלפון בית הספר</label>
                      <input id="edit-school-phone"
                        className={editFieldCls(!!(editForm.school_phone && schoolPhoneError), !editForm.school_phone)}
                        value={editForm.school_phone} dir="ltr"
                        onChange={e => setEditForm(p => ({ ...p, school_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                        inputMode="numeric" autoComplete="off" />
                      {editForm.school_phone && schoolPhoneError && <span className="text-xs text-red-500 block mt-0.5" role="alert">{schoolPhoneError}</span>}
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-stage" className={`${tileLabelCls} block`}>שלב מוסד</label>
                      <select id="edit-stage" className={editFieldCls(false, !editForm.stage)} value={editForm.stage}
                        onChange={e => setEditForm(p => ({ ...p, stage: e.target.value }))}>
                        {SCHOOL_STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-district" className={`${tileLabelCls} block`}>מחוז</label>
                      <select id="edit-district" className={editFieldCls(false, !editForm.district)} value={editForm.district}
                        onChange={e => setEditForm(p => ({ ...p, district: e.target.value }))}>
                        <option value="">בחר</option>
                        {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-address" className={`${tileLabelCls} block`}>כתובת</label>
                      <input id="edit-address" className={editFieldCls(false, !editForm.address)} value={editForm.address}
                        onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))} autoComplete="off" />
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-education-authority" className={`${tileLabelCls} block`}>רשות חינוך</label>
                      <input id="edit-education-authority" className={editFieldCls(false, !editForm.education_authority)} value={editForm.education_authority}
                        onChange={e => setEditForm(p => ({ ...p, education_authority: e.target.value }))} autoComplete="off" />
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-sector" className={`${tileLabelCls} block`}>מגזר</label>
                      <select id="edit-sector" className={editFieldCls(false, !editForm.sector)} value={editForm.sector}
                        onChange={e => setEditForm(p => ({ ...p, sector: e.target.value }))}>
                        {SECTOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-supervision" className={`${tileLabelCls} block`}>פיקוח</label>
                      <select id="edit-supervision" className={editFieldCls(false, !editForm.supervision)} value={editForm.supervision}
                        onChange={e => setEditForm(p => ({ ...p, supervision: e.target.value }))}>
                        {SUPERVISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    <div className={tileCls}>
                      <span className={`${tileLabelCls} block`}>שכבות לימוד</span>
                      <MultiSelectChips compact options={GRADE_LEVEL_OPTIONS}
                        selected={editForm.grade_levels || []}
                        onChange={v => setEditForm(p => ({ ...p, grade_levels: v }))} />
                    </div>

                    <div className={tileCls}>
                      <span className={`${tileLabelCls} block`}>ימי לימוד</span>
                      <MultiSelectChips compact options={STUDY_DAY_OPTIONS}
                        selected={editForm.study_days || []}
                        onChange={v => setEditForm(p => ({ ...p, study_days: v }))} />
                    </div>

                    <div className={tileCls}>
                      <label htmlFor="edit-student-count" className={`${tileLabelCls} block`}>מס' תלמידים</label>
                      <input id="edit-student-count" className={editFieldCls(false, !editForm.student_count)} value={editForm.student_count}
                        onChange={e => setEditForm(p => ({ ...p, student_count: e.target.value.replace(/\D/g, "") }))}
                        inputMode="numeric" autoComplete="off" />
                    </div>
                  </div>
                  </div>
                  </div>
                  </div>

                  {/* ליווי — top 3-column grid only; the per-service-type advisor editor
                      below it moved into its own separate "יועצים מלווים" card. */}
                  {(role === "owner" || role === "manager" || role === "advisor") && <div className={sectionCardCls}>
                    <div className={sectionHeaderCls}>{sectionTitle(Handshake, "פרטי ליווי", ACCENT_EMERALD)}</div>
                    <div className={sectionBodyCls}>
                    <div className="grid grid-cols-3 gap-3">
                      {(role === "owner" || role === "manager") && (
                        <div className={tileCls}>
                          <label htmlFor="client-status-select" className={`${tileLabelCls} block`}>סטטוס לקוח</label>
                          <select id="client-status-select" className={editFieldCls(false, !yearAdminData.client_status)}
                            value={yearAdminData.client_status || ""}
                            onChange={e => saveYearAdminField("client_status", e.target.value || null)}>
                            <option value="">בחר</option>
                            {CLIENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      )}

                      {(role === "owner" || role === "manager") && (
                        <div className={tileCls}>
                          <label htmlFor="service-type-select" className={`${tileLabelCls} block`}>סוג שירות</label>
                          <select id="service-type-select" className={editFieldCls(false, !yearAdminData.service_type)}
                            value={yearAdminData.service_type || ""}
                            onChange={e => saveYearAdminField("service_type", e.target.value || null)}>
                            <option value="">בחר</option>
                            {SERVICE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      )}

                      <div className={tileCls}>
                        <label htmlFor="order-amount-gefen" className={`${tileLabelCls} block`}>מחיר כולל מע"מ</label>
                        <input
                          id="order-amount-gefen"
                          key={`${schoolId}-${academicYear}`}
                          type="text"
                          inputMode="numeric"
                          defaultValue={formatAmount(yearAdminData.order_amount_gefen)}
                          onBlur={e => {
                            const v = parseAmount(e.target.value);
                            e.target.value = formatAmount(v);
                            saveOrderAmountGefen(v);
                          }}
                          title={yearAdminData.order_amount_gefen_updated_by_name
                            ? `${yearAdminData.order_amount_gefen_updated_by_name} - ${formatDate(yearAdminData.order_amount_gefen_updated_at)}`
                            : ""}
                          className={editFieldCls(false, !yearAdminData.order_amount_gefen)}
                        />
                        {yearAdminData.order_amount_gefen_updated_by_name && (
                          <p className="text-xs text-slate-400 mt-1">
                            עודכן לאחרונה על ידי {yearAdminData.order_amount_gefen_updated_by_name} · {formatDate(yearAdminData.order_amount_gefen_updated_at)}
                          </p>
                        )}
                      </div>

                      {(role === "owner" || role === "manager") && (
                        <div className={tileCls}>
                          <span className={`${tileLabelCls} block`}>אמצעי הזמנה</span>
                          <MultiSelectChips compact options={FUNDING_METHOD_OPTIONS}
                            selected={yearAdminData.order_method || []}
                            onChange={v => saveYearAdminField("order_method", v.length ? v : null)} />
                        </div>
                      )}

                      {(role === "owner" || role === "manager") && (
                        <div className={`${tileCls} col-span-2`}>
                          <span className={`${tileLabelCls} inline-flex items-center gap-1`}>
                            <QuestionTooltip text="בחר למי תהיה גישה לנתוני בית הספר." />
                            גישה
                          </span>
                          <AccessSelector compact restrictTo={editForm.restrict_access_to} users={users}
                            loadingUsers={loadingUsers}
                            onChange={val => { setAccessLinkedToAdvisors(false); setEditForm(p => ({ ...p, restrict_access_to: val })); }}
                            onSelectAdvisors={() => setAccessLinkedToAdvisors(true)}
                            schoolAdvisors={draftLinkedAdvisorIds.map(id => users.find(u => u.id === id)).filter(Boolean)} />
                        </div>
                      )}
                    </div>
                    </div>
                  </div>}
                  </div>

                  {/* אנשי קשר + יועצים מלווים side by side; אנשי קשר מימין, יועצים מלווים משמאלו */}
                  <div className="grid grid-cols-2 gap-4">
                  {/* אנשי קשר card */}
                  <div className={sectionCardCls}>
                  <div className={sectionHeaderCls}>
                    {sectionTitle(Phone, "אנשי קשר", ACCENT_INDIGO)}
                  </div>
                  <div className={sectionBodyCls}>
                    <table className="w-full text-sm border border-slate-200 border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-100 divide-x divide-slate-200">
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 whitespace-nowrap">תפקיד</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">שם</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">טלפון</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">מייל</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">יום חופשי</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700">מתאם פגישות</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {[
                          editForm.stage === "sheshshnati" ? PRINCIPAL_TICHON_ROW : PRINCIPAL_SINGLE_ROW,
                          ...(editForm.stage === "sheshshnati" && !editForm.principal_same_person ? [PRINCIPAL_CHATIVA_ROW] : []),
                          ...CONTACT_ROWS,
                        ].map(row => {
                          const phoneErr = validateContactPhone(editForm[row.phoneField]);
                          const emailErr = validateEmail(editForm[row.emailField]);
                          return (
                            <tr key={row.nameField} className={`divide-x divide-slate-200 ${rowStripeCls}`}>
                              <td className="py-3 pr-1 align-top"><span className="text-sm font-normal text-gray-900">{row.label}</span></td>
                              <td className="py-3 px-2">
                                <label htmlFor={`edit-cn-${row.nameField}`} className="sr-only">{row.label} שם</label>
                                <input id={`edit-cn-${row.nameField}`} className={editFieldCls(false, !editForm[row.nameField])}
                                  value={editForm[row.nameField]}
                                  onChange={e => setEditForm(p => ({ ...p, [row.nameField]: e.target.value }))}
                                  autoComplete="off" />
                              </td>
                              <td className="py-3 px-2">
                                <label htmlFor={`edit-cp-${row.phoneField}`} className="sr-only">{row.label} טלפון</label>
                                <input id={`edit-cp-${row.phoneField}`} className={editFieldCls(!!(editForm[row.phoneField] && phoneErr), !editForm[row.phoneField])}
                                  value={editForm[row.phoneField]}
                                  onChange={e => setEditForm(p => ({ ...p, [row.phoneField]: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                                  dir="ltr" inputMode="numeric" autoComplete="off" />
                                {editForm[row.phoneField] && phoneErr && <span className="text-xs text-red-500 block mt-0.5" role="alert">{phoneErr}</span>}
                              </td>
                              <td className="py-3 px-2">
                                <label htmlFor={`edit-ce-${row.emailField}`} className="sr-only">{row.label} מייל</label>
                                <input id={`edit-ce-${row.emailField}`} className={`${editFieldCls(!!(editForm[row.emailField] && emailErr), !editForm[row.emailField])} text-center`}
                                  value={editForm[row.emailField]}
                                  onChange={e => setEditForm(p => ({ ...p, [row.emailField]: e.target.value }))}
                                  dir="ltr" type="email" autoComplete="off" />
                                {editForm[row.emailField] && emailErr && <span className="text-xs text-red-500 block mt-0.5" role="alert">{emailErr}</span>}
                              </td>
                              <td className="py-3 px-2">
                                <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                                  selected={editForm[row.dayOffField] || []}
                                  onChange={v => setEditForm(p => ({ ...p, [row.dayOffField]: v }))} />
                              </td>
                              <td className="py-3 px-2 text-center">
                                <label htmlFor={`coord-${row.coordValue}`} className="sr-only">{row.label} אחראי/ת לתיאום פגישות</label>
                                <input id={`coord-${row.coordValue}`} type="radio" name="meeting-coordinator"
                                  className="w-4 h-4 accent-blue-600"
                                  checked={editForm.meeting_coordinator === row.coordValue}
                                  disabled={!editForm[row.nameField]}
                                  onChange={() => setEditForm(p => ({ ...p, meeting_coordinator: row.coordValue }))} />
                              </td>
                            </tr>
                          );
                        })}

                        {editForm.stage === "sheshshnati" && (
                          <tr className={`divide-x divide-slate-200 ${rowStripeCls}`}>
                            <td></td>
                            <td colSpan={5} className="py-2 px-2">
                              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                                <input type="checkbox" className="w-3.5 h-3.5 rounded accent-blue-600"
                                  checked={!!editForm.principal_same_person}
                                  onChange={e => setEditForm(p => ({ ...p, principal_same_person: e.target.checked }))} />
                                אותו מנהל/ת לשתי החטיבות
                              </label>
                            </td>
                          </tr>
                        )}

                        {/* Extra contact rows */}
                        {(editForm.extra_contacts || []).map((ec, i) => (
                          <tr key={`extra-${i}`} className={`divide-x divide-slate-200 ${rowStripeCls}`}>
                            <td className="py-3 pr-1">
                              <label htmlFor={`edit-extra-role-${i}`} className="sr-only">תפקיד</label>
                              <input id={`edit-extra-role-${i}`} className={editFieldCls(false)} value={ec.role}
                                onChange={e => updateExtra(i, "role", e.target.value)} autoComplete="off" />
                            </td>
                            <td className="py-3 px-2">
                              <label htmlFor={`edit-extra-name-${i}`} className="sr-only">שם</label>
                              <input id={`edit-extra-name-${i}`} className={editFieldCls(false)} value={ec.name}
                                onChange={e => updateExtra(i, "name", e.target.value)} autoComplete="off" />
                            </td>
                            <td className="py-3 px-2">
                              <label htmlFor={`edit-extra-phone-${i}`} className="sr-only">טלפון</label>
                              <input id={`edit-extra-phone-${i}`} className={editFieldCls(false)} value={ec.phone}
                                onChange={e => updateExtra(i, "phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                                dir="ltr" inputMode="numeric" autoComplete="off" />
                            </td>
                            <td className="py-3 px-2">
                              <div className="flex items-center gap-1">
                                <label htmlFor={`edit-extra-email-${i}`} className="sr-only">מייל</label>
                                <input id={`edit-extra-email-${i}`} className={`${editFieldCls(false)} text-center`} value={ec.email}
                                  onChange={e => updateExtra(i, "email", e.target.value)}
                                  dir="ltr" type="email" autoComplete="off" />
                                <button type="button" onClick={() => removeExtra(i)}
                                  className="text-slate-400 hover:text-red-500 flex-shrink-0 mr-1 text-base leading-none"
                                  aria-label="הסר שורת איש קשר">✕</button>
                              </div>
                            </td>
                            <td className="py-3 px-2">
                              <MultiSelectChips compact options={WEEKDAY_OPTIONS}
                                selected={ec.day_off || []}
                                onChange={v => updateExtra(i, "day_off", v)} />
                            </td>
                            <td className="py-3 px-2 text-center">
                              <label htmlFor={`coord-extra-${i}`} className="sr-only">איש קשר נוסף {i + 1} אחראי/ת לתיאום פגישות</label>
                              <input id={`coord-extra-${i}`} type="radio" name="meeting-coordinator"
                                className="w-4 h-4 accent-blue-600"
                                checked={editForm.meeting_coordinator === `extra:${i}`}
                                disabled={!ec.name}
                                onChange={() => setEditForm(p => ({ ...p, meeting_coordinator: `extra:${i}` }))} />
                            </td>
                          </tr>
                        ))}

                        {/* Add contact button */}
                        {(editForm.extra_contacts || []).length < 3 && (
                          <tr>
                            <td colSpan={6} className="pt-3 pb-1">
                              <button type="button" onClick={addExtra}
                                className={`${outlineBtnCls} inline-flex items-center gap-1`}>
                                <span aria-hidden="true">+</span> הוסף איש קשר
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {triedSave && !editForm.meeting_coordinator && (
                      <p className="text-xs text-red-500 mt-1.5" role="alert">יש לבחור אחראי/ת לתיאום פגישות</p>
                    )}
                  </div>
                  </div>

                  {/* יועצים מלווים — per-service-type advisor editor (גפן/שוטף/מחוז), split
                      out into its own card, mirroring display mode's separate card. */}
                  {(role === "owner" || role === "manager") && (
                  <div className={sectionCardCls}>
                    <div className={sectionHeaderCls}>{sectionTitle(UsersRound, "יועצים מלווים", ACCENT_VIOLET)}</div>
                    <div className={sectionBodyCls}>
                      <div className="grid grid-cols-3 gap-4">
                        {TYPED_SERVICE_TYPES.map(({ key, label }, idx) => {
                          const isRequired = activeServiceTypes(yearAdminData.service_type).includes(key);
                          const invalid = triedSave && isRequired && draftTypedAdvisorIds[key].length === 0;
                          return (
                            <div key={key} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-3 min-w-0">
                              <p className="text-sm font-semibold text-slate-700 text-center mb-3 pb-2 border-b border-black/20">{label}{isRequired && <span className="text-red-500"> *</span>}</p>
                              <div className="space-y-3 min-w-0">
                                <div className="min-w-0">
                                  <span className={stackedLabelCls}>יועץ מלווה:</span>
                                  <AdvisorSearch compact schoolId={schoolId} selectedIds={draftTypedAdvisorIds[key]} users={users}
                                    loadingUsers={loadingUsers}
                                    onChange={ids => setDraftTypedAdvisorIds(p => ({ ...p, [key]: ids }))}
                                    onRetry={loadUsers} invalid={invalid} />
                                  {invalid && (
                                    <span className="text-xs text-red-500 mt-1 block" role="alert">יש לבחור לפחות יועץ אחד</span>
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <label htmlFor={`meeting-allocation-${key}`} className={stackedLabelCls}>הקצאת פגישות:</label>
                                  <input id={`meeting-allocation-${key}`} type="number" min="0"
                                    className={editFieldCls(false, false)}
                                    defaultValue={yearAdminData[`meeting_allocation_${key}`] ?? ""}
                                    onBlur={e => {
                                      const v = e.target.value === "" ? null : Number(e.target.value);
                                      if (v !== (yearAdminData[`meeting_allocation_${key}`] ?? null)) saveYearAdminField(`meeting_allocation_${key}`, v);
                                    }} />
                                </div>

                                <div className="min-w-0">
                                  <span className={stackedLabelCls}>זמן לפגישה:</span>
                                  <HourMinuteInput idPrefix={`meeting-duration-${key}`} label={`זמן לפגישה [${label}]`}
                                    minutes={yearAdminData[`meeting_duration_${key}`] ?? null}
                                    onChange={v => saveYearAdminField(`meeting_duration_${key}`, v)}
                                    inputClassName="w-11 text-sm text-center border rounded-md px-0.5 py-0.5 bg-transparent border-slate-300 focus:outline-none focus:ring-1 focus:border-blue-400 focus:ring-blue-100" />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  )}
                  </div>

                  {/* Bottom actions */}
                  <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t border-slate-100">
                    <button onClick={isRequestMode ? submitFullRequest : saveEdit} disabled={saving} className="btn-green-light text-sm px-5 py-2">
                      {saving ? (isRequestMode ? "שולח..." : "שומר...") : (isRequestMode ? "הגש בקשה" : "שמור שינויים")}
                    </button>
                    <button onClick={() => { setIsEditing(false); setIsRequestMode(false); setOriginalForm(null); setSaveError(""); setAccessLinkedToAdvisors(false); setDraftTypedAdvisorIds(originalTypedAdvisorIds); }} disabled={saving} className="btn-ghost text-sm px-5 py-2">ביטול</button>
                  </div>
                </div>

                ) : (
                /* ─── DISPLAY MODE ─── */
                <div className="space-y-10">
                  {/* פרטי מוסד + ליווי side by side at the top of the page */}
                  <div className="grid grid-cols-2 gap-4">
                  {/* פרטי מוסד card */}
                  <div className={sectionCardCls}>
                  {/* Header */}
                  <div className={sectionHeaderCls}>
                    {sectionTitle(Building2, "פרטי מוסד")}
                  </div>
                  <div className={sectionBodyCls}>

                  {/* Live data tiles — 3×3 grid, one stat-tile per field (scrolls to reveal 2 extra rows) */}
                  <div className="max-h-[252px] overflow-y-auto pr-1">
                  <div className="grid grid-cols-3 gap-3">
                    <div className={`${tileCls} min-w-0`}>
                      <p className={tileLabelCls}>שם מוסד</p>
                      <p className={`${tileValueCls} truncate`} title={school?.name || undefined}>{school?.name || "—"}</p>
                    </div>
                    <div className={`${tileCls} min-w-0`}>
                      <p className={tileLabelCls}>עיר</p>
                      <p className={`${tileValueCls} truncate`} title={school?.city || undefined}>{school?.city || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>תוכנת כספים</p>
                      <p className={tileValueCls}>{FINANCE_SOFTWARE_LABEL[school?.finance_software] || school?.finance_software || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>סמל מוסד</p>
                      <p className={tileValueCls}>{school?.symbol || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>בעלות</p>
                      <p className={tileValueCls}>{school?.authority || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>טלפון בית הספר</p>
                      <p className={tileValueCls} dir={school?.school_phone ? "ltr" : undefined}>{school?.school_phone || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>שלב מוסד</p>
                      <p className={tileValueCls}>{SCHOOL_STAGE_LABEL[school?.stage] || school?.stage || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>מחוז</p>
                      <p className={tileValueCls}>{school?.district || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>כתובת</p>
                      <p className={tileValueCls}>{school?.address || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>רשות חינוך</p>
                      <p className={tileValueCls}>{school?.education_authority || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>מגזר</p>
                      <p className={tileValueCls}>{school?.sector || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>פיקוח</p>
                      <p className={tileValueCls}>{school?.supervision || "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>שכבות לימוד</p>
                      <p className={tileValueCls}>{school?.grade_levels?.length ? formatOrderedSelection(school.grade_levels, GRADE_LEVEL_OPTIONS) : "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>ימי לימוד</p>
                      <p className={tileValueCls}>{school?.study_days?.length ? formatOrderedSelection(school.study_days, STUDY_DAY_OPTIONS) : "—"}</p>
                    </div>
                    <div className={tileCls}>
                      <p className={tileLabelCls}>מס' תלמידים</p>
                      <p className={tileValueCls}>{school?.student_count ?? "—"}</p>
                    </div>
                  </div>
                  </div>
                  </div>
                  </div>

                  {/* ליווי section — same 3-column label/value grid format as פרטי מוסד */}
                  <div className={sectionCardCls}>
                    <div className={sectionHeaderCls}>{sectionTitle(Handshake, "פרטי ליווי", ACCENT_EMERALD)}</div>
                    <div className={sectionBodyCls}>
                    <div className="grid grid-cols-3 gap-3">
                      <div className={tileCls}>
                        <p className={tileLabelCls}>סטטוס לקוח</p>
                        {yearAdminData.client_status ? (
                          <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${CLIENT_STATUS_BADGE_CLS[yearAdminData.client_status] || "bg-slate-100 text-slate-500 border-slate-200"}`}>
                            {CLIENT_STATUS_OPTIONS.find(o => o.value === yearAdminData.client_status)?.label}
                          </span>
                        ) : (
                          <p className={tileValueCls}>—</p>
                        )}
                      </div>

                      <div className={tileCls}>
                        <p className={tileLabelCls}>סוג שירות</p>
                        <p className={tileValueCls}>
                          {SERVICE_TYPE_OPTIONS.find(o => o.value === yearAdminData.service_type)?.label || "—"}
                        </p>
                      </div>

                      <div className={tileCls}>
                        <p className={tileLabelCls}>מחיר כולל מע"מ</p>
                        <p className={tileValueCls}
                          title={yearAdminData.order_amount_gefen_updated_by_name
                            ? `${yearAdminData.order_amount_gefen_updated_by_name} - ${formatDate(yearAdminData.order_amount_gefen_updated_at)}`
                            : ""}>
                          {formatAmount(yearAdminData.order_amount_gefen) || "—"}
                        </p>
                      </div>

                      <div className={tileCls}>
                        <p className={tileLabelCls}>אמצעי הזמנה</p>
                        <div className="flex flex-wrap gap-1">
                          {(yearAdminData.order_method || []).length === 0 ? (
                            <p className={tileValueCls}>—</p>
                          ) : yearAdminData.order_method.map(v => (
                            <span key={v} className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                              {FUNDING_METHOD_OPTIONS.find(o => o.value === v)?.label || v}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className={`${tileCls} col-span-2`}>
                        <p className={`${tileLabelCls} inline-flex items-center gap-1`}>
                          <QuestionTooltip text="בחר למי תהיה גישה לנתוני בית הספר." />
                          גישה
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {accessIsAll ? (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.12)", color: "#15803d" }}>כולם</span>
                          ) : (() => {
                            const profiles = school?.restrict_access_profiles !== undefined
                              ? (school.restrict_access_profiles || [])
                              : (school?.restrict_access_to || []).map(id => users.find(u => u.id === id)).filter(Boolean);
                            if (profiles.length === 0 && loadingUsers) return <span className="text-xs text-slate-400">טוען...</span>;
                            if (profiles.length === 0) return <p className={tileValueCls}>—</p>;
                            return profiles.map(u => (
                              <span key={u.id} className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                {u.full_name || u.email}
                              </span>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                    </div>
                  </div>
                  </div>

                  {/* אנשי קשר + יועצים מלווים side by side; אנשי קשר מימין, יועצים מלווים משמאלו */}
                  <div className="grid grid-cols-2 gap-4">
                  {/* אנשי קשר card */}
                  <div className={sectionCardCls}>
                    <div className={sectionHeaderCls}>{sectionTitle(Phone, "אנשי קשר", ACCENT_INDIGO)}</div>
                    <div className={sectionBodyCls}>
                    <table className="w-full text-sm table-fixed border border-slate-200 border-collapse font-sans">
                      <thead>
                        <tr className="bg-slate-100 divide-x divide-slate-200">
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 whitespace-nowrap w-[13%]">תפקיד</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 w-[13%]">שם</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 w-[15%]">טלפון</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 w-[29%]">מייל</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 w-[15%]">יום חופשי</th>
                          <th scope="col" className="text-right py-3 px-3 text-xs font-semibold text-gray-700 w-[15%]">מתאם פגישות</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {[
                          school?.stage === "sheshshnati"
                            ? { ...PRINCIPAL_TICHON_ROW, label: school?.principal_same_person === false ? PRINCIPAL_TICHON_ROW.label : "מנהל/ת חט\"ע וחט\"ב" }
                            : PRINCIPAL_SINGLE_ROW,
                          ...(school?.stage === "sheshshnati" && school?.principal_same_person === false ? [PRINCIPAL_CHATIVA_ROW] : []),
                          ...CONTACT_ROWS,
                        ].map(row => (
                          <tr key={row.nameField} className={`divide-x divide-slate-200 ${rowStripeCls}`}>
                            <td className="py-3 pr-1 align-top"><span className="text-sm font-normal text-gray-900">{row.label}</span></td>
                            <td className="py-3 px-2">
                              <span className={`text-sm ${school?.[row.nameField] ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`}
                                style={contactValStyle(school?.[row.nameField])}>
                                {school?.[row.nameField] || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <span className={`text-sm whitespace-nowrap ${school?.[row.phoneField] ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`}
                                dir={school?.[row.phoneField] ? "ltr" : undefined} style={contactValStyle(school?.[row.phoneField])}>
                                {formatContactPhone(school?.[row.phoneField]) || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-2 overflow-hidden">
                              <span className={`text-sm text-center whitespace-nowrap overflow-hidden text-ellipsis block ${school?.[row.emailField] ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`}
                                dir={school?.[row.emailField] ? "ltr" : undefined} style={contactValStyle(school?.[row.emailField])}
                                title={school?.[row.emailField] || undefined}>
                                {school?.[row.emailField] || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-2 overflow-hidden">
                              <div className="flex flex-wrap gap-1 w-full">
                                {(school?.[row.dayOffField] || []).length === 0 ? (
                                  <span className="text-sm text-slate-400 font-normal">—</span>
                                ) : school[row.dayOffField].map(v => (
                                  <span key={v} className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                    {WEEKDAY_OPTIONS.find(o => o.value === v)?.label || v}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-2 text-center">
                              {school?.meeting_coordinator === row.coordValue && (
                                <span className="text-emerald-600 font-bold text-[21px] leading-none" title="אחראי/ת לתיאום פגישות" aria-label="אחראי/ת לתיאום פגישות">✓</span>
                              )}
                            </td>
                          </tr>
                        ))}

                        {/* Extra contacts (display) */}
                        {(school?.extra_contacts || []).map((ec, i) => (
                          <tr key={`extra-disp-${i}`} className={`divide-x divide-slate-200 ${rowStripeCls}`}>
                            <td className="py-3 pr-1 align-top">
                              {ec.role ? <span className="text-sm font-normal text-gray-900">{ec.role}</span> : <span className="text-xs text-slate-400">—</span>}
                            </td>
                            <td className="py-3 px-2">
                              <span className={`text-sm ${ec.name ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`}
                                style={contactValStyle(ec.name)}>
                                {ec.name || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <span className={`text-sm whitespace-nowrap ${ec.phone ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`}
                                dir={ec.phone ? "ltr" : undefined} style={contactValStyle(ec.phone)}>
                                {formatContactPhone(ec.phone) || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-2 overflow-hidden">
                              <span className={`text-sm text-center whitespace-nowrap overflow-hidden text-ellipsis block ${ec.email ? "font-normal text-gray-900" : "text-slate-400 font-normal"}`}
                                dir={ec.email ? "ltr" : undefined} style={contactValStyle(ec.email)}
                                title={ec.email || undefined}>
                                {ec.email || "—"}
                              </span>
                            </td>
                            <td className="py-3 px-2 overflow-hidden">
                              <div className="flex flex-wrap gap-1 w-full">
                                {(ec.day_off || []).length === 0 ? (
                                  <span className="text-sm text-slate-400 font-normal">—</span>
                                ) : ec.day_off.map(v => (
                                  <span key={v} className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                    {WEEKDAY_OPTIONS.find(o => o.value === v)?.label || v}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-2 text-center">
                              {school?.meeting_coordinator === `extra:${i}` && (
                                <span className="text-emerald-600 font-bold text-[21px] leading-none" title="אחראי/ת לתיאום פגישות" aria-label="אחראי/ת לתיאום פגישות">✓</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  {/* Per-service-type read-only columns: 3 columns side by side (גפן/שוטף/
                      מחוז), each with יועץ מלווה / הקצאת פגישות / זמן לפגישה stacked below. */}
                  <div className={sectionCardCls}>
                    <div className={sectionHeaderCls}>{sectionTitle(UsersRound, "יועצים מלווים", ACCENT_VIOLET)}</div>
                    <div className={sectionBodyCls}>
                    <div className="grid grid-cols-3 gap-4">
                      {TYPED_SERVICE_TYPES.map(({ key, label }) => (
                        <div key={key} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-3">
                          <p className="text-sm font-semibold text-slate-700 text-center mb-3 pb-2 border-b border-black/20">{label}</p>
                          <div style={colGridStyle}>
                            <span className={labelCls}>יועץ מלווה:</span>
                            <div className="py-1.5 flex flex-wrap gap-1">
                              {(typedAdvisors[key] || []).length === 0 ? (
                                <span className={valCls()} style={valStyle()}>—</span>
                              ) : typedAdvisors[key].map(p => (
                                <span key={p.id} className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                  {p.full_name || p.email}
                                </span>
                              ))}
                            </div>

                            <span className={labelCls}>הקצאת פגישות:</span>
                            <span className={valCls(yearAdminData[`meeting_allocation_${key}`])} style={valStyle(yearAdminData[`meeting_allocation_${key}`])}>
                              {yearAdminData[`meeting_allocation_${key}`] ?? "—"}
                            </span>

                            <span className={labelCls}>זמן לפגישה:</span>
                            <span className={valCls(formatDurationHM(yearAdminData[`meeting_duration_${key}`]))} style={valStyle(formatDurationHM(yearAdminData[`meeting_duration_${key}`]))}>
                              {formatDurationHM(yearAdminData[`meeting_duration_${key}`]) || "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    </div>
                  </div>
                  </div>

                  {/* הערות + קבצים — visible to everyone (including advisors); side by side
                      instead of stacked to take up less vertical space */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className={sectionCardCls}>
                        {notesData && (
                          <NotesThread
                            title={<>הערות{iconBadge(MessageSquareText, ACCENT_AMBER)}</>}
                            groups={notesData.general || []}
                            currentUser={currentUser}
                            onCreate={content => createSchoolNote("general", null, content)}
                            onEdit={(segmentId, groupId, content) => editSchoolNote("general", null, segmentId, groupId, content)}
                            onDelete={(groupId, segmentId) => deleteSchoolNote("general", null, groupId, segmentId)}
                          />
                        )}
                    </div>

                    <div className={sectionCardCls}>
                        {filesData && (
                          <FilesThread
                            title={<>קבצים{iconBadge(Folder, ACCENT_AMBER)}</>}
                            files={filesData}
                            currentUser={currentUser}
                            onUpload={uploadSchoolFile}
                            onEditDescription={editSchoolFileDescription}
                            onDelete={deleteSchoolFile}
                            onDownload={downloadSchoolFile}
                          />
                        )}
                      </div>
                  </div>

                  {/* הערות רבעוניות — manager/owner only */}
                  {(role === "owner" || role === "manager") && (
                    <div className={sectionCardCls}>
                      <div className={sectionHeaderCls}>{sectionTitle(CalendarDays, "הערות רבעוניות", ACCENT_AMBER)}</div>
                      <div className={sectionBodyCls}>
                      {notesData && (
                        <div className="overflow-x-auto">
                          <div className="grid grid-cols-4 gap-3" style={{ minWidth: "980px" }}>
                            {[1, 2, 3, 4].map(q => (
                              <div key={q} className="bg-slate-50/70 border border-slate-200/70 rounded-xl p-3">
                                <NotesThread
                                  compact
                                  title={`רבעון ${q}`}
                                  groups={notesData.quarterly?.[q] || []}
                                  currentUser={currentUser}
                                  onCreate={content => createSchoolNote("quarterly", q, content)}
                                  onEdit={(segmentId, groupId, content) => editSchoolNote("quarterly", q, segmentId, groupId, content)}
                                  onDelete={(groupId, segmentId) => deleteSchoolNote("quarterly", q, groupId, segmentId)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>

              {/* Update request message */}
              {requestMsg && (
                <div role="alert" className="glass-card rounded-2xl px-5 py-3 mb-4 text-sm"
                  style={{ background: requestMsg.includes("שגיאה") ? "rgba(239,68,68,0.07)" : "rgba(22,163,74,0.08)", color: requestMsg.includes("שגיאה") ? "#dc2626" : "#15803d" }}>
                  {requestMsg}
                </div>
              )}

            </div>
          )}

          {/* ─── TAB: פגישות ─── */}
          {activeTab === "meetings" && (
            <div>
              {/* Modals */}
              {notesModal && (
                <NotesModal
                  notes={notesModal.notes}
                  users={users}
                  onSave={(noteText, mentionedIds) => {
                    notesModal.onSave(noteText);
                    if (mentionedIds && mentionedIds.length > 0 && notesModal.meetingId) {
                      axios.post(`/schools/${schoolId}/meetings/${notesModal.meetingId}/mentions`, {
                        mentioned_user_ids: mentionedIds,
                        note_preview: noteText.slice(0, 100),
                      }).catch(console.error);
                    }
                    setNotesModal(null);
                  }}
                  onClose={() => setNotesModal(null)}
                />
              )}
              {summaryModalFor && (
                <MeetingSummaryModal
                  meeting={summaryModalFor}
                  onClose={() => setSummaryModalFor(null)}
                  onOpenNotes={(meetingId, notes, onSave) => setNotesModal({ meetingId, notes, onSave })}
                  onSave={updateMeeting}
                  onUploadStarted={meetingId => setMeetings(prev => prev.map(m => m.id === meetingId ? { ...m, summary_status: "processing" } : m))}
                />
              )}
              {advisorAccessModal && (
                <AdvisorAccessGrantModal
                  schoolId={schoolId}
                  advisorId={advisorAccessModal.advisorId}
                  advisorName={advisorAccessModal.advisorName}
                  mode={{ type: "single_date", meetingDate: advisorAccessModal.meetingDate || new Date().toISOString().slice(0, 10) }}
                  onGranted={() => { setAdvisorAccessModal(null); refreshSchoolAdvisors(); }}
                  onCancel={() => setAdvisorAccessModal(null)}
                />
              )}

              {pendingStageScopeChoice && (
                <StageScopeModal schoolName={school?.name}
                  onChoose={handleStageScopeChoice}
                  onCancel={() => setPendingStageScopeChoice(false)} />
              )}

              {/* Top toolbar */}
              <div className="flex items-center gap-3 mb-4">
                <button type="button" onClick={startNewMeeting}
                  className="btn-blue text-sm px-4 py-2 flex items-center gap-2">
                  <span aria-hidden="true">+</span> הוסף פגישה
                </button>
              </div>

              {/* Empty state */}
              {meetingsLoading ? (
                <div className="glass-card rounded-2xl p-10 flex justify-center">
                  <div role="status" aria-label="טוען פגישות"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
                </div>
              ) : meetingsError ? (
                <div role="alert" className="glass-card rounded-2xl p-6 text-center">
                  <p className="text-red-600 mb-3">{meetingsError}</p>
                  <button onClick={loadMeetings} className="btn-blue text-sm px-4 py-2">רענן</button>
                </div>
              ) : meetings.length === 0 ? (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <p className="text-3xl mb-3">📅</p>
                  <p className="font-semibold text-slate-700 mb-1">אין פגישות עדיין</p>
                  <p className="text-slate-400 text-sm mb-4">לחץ על "הוסף פגישה" כדי להוסיף את הראשונה</p>
                </div>
              ) : (
                <>
                {/* Status reminder toasts */}
                {meetingReminderToasts.length > 0 && (
                  <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 items-start" dir="rtl">
                    {meetingReminderToasts.map(t => (
                      <div key={t.id} role="alert"
                        className="flex items-start gap-3 bg-white border border-sky-200 rounded-xl shadow-lg px-4 py-3 w-80 max-w-[calc(100vw-2rem)]">
                        <span className="text-xl mt-0.5 flex-shrink-0" aria-hidden="true">🔔</span>
                        <p className="text-sm text-slate-800 leading-snug flex-1">{t.msg}</p>
                        <button aria-label="סגור" onClick={() => setMeetingReminderToasts(prev => prev.filter(x => x.id !== t.id))}
                          className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5 p-0.5 rounded">
                          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
                            <path d="M10.5 1.5L1.5 10.5M1.5 1.5L10.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {meetingAlreadySentModal && (() => {
                  const { meeting, lastSentAt, recipients } = meetingAlreadySentModal;
                  const d = new Date(lastSentAt);
                  const pad = n => String(n).padStart(2, "0");
                  const dStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(-2)}`;
                  const tStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                  const names = (recipients || []).map(r => r.full_name || r.email || "").filter(Boolean).join(", ");
                  return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
                      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[360px] flex flex-col gap-4">
                        <h2 className="text-base font-bold text-slate-800 text-center">תזכורת כבר נשלחה</h2>
                        <p className="text-sm text-slate-600 text-center leading-relaxed">
                          תזכורת כבר נשלחה ב-<strong>{dStr}</strong> בשעה <strong>{tStr}</strong>
                          {names ? <> ל-<strong>{names}</strong></> : ""}.
                          <br />האם לשלוח תזכורת חדשה בכל זאת?
                        </p>
                        <div className="flex gap-3 justify-center mt-1">
                          <button type="button"
                            onClick={() => { sendStatusReminderFromSchool(meeting, true); setMeetingAlreadySentModal(null); }}
                            className="px-5 py-2 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors">
                            שלח תזכורת חדשה
                          </button>
                          <button type="button" onClick={() => setMeetingAlreadySentModal(null)}
                            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
                            ביטול
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <MeetingsTable
                  meetings={meetings}
                  usersWithAccess={users.filter(u => u.role === "owner" || u.role === "manager" || advisorHasAccess(u.id))}
                  usersWithoutAccess={users.filter(u => u.role === "advisor" && !advisorHasAccess(u.id))}
                  contacts={getSchoolContacts()}
                  schoolStage={school?.stage}
                  onSave={updateMeeting}
                  onMeetingPatched={(id, patch) => setMeetings(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))}
                  onDelete={deleteMeeting}
                  onOpenNotes={(meetingId, notes, onSave) => setNotesModal({ meetingId, notes, onSave })}
                  onRequestAccess={handleRequestAdvisorAccess}
                  canDeleteMeetings={canDeleteMeetings}
                  onSendStatusReminder={sendStatusReminderFromSchool}
                  showCalendarColumn={showCalendarColumn}
                  onOpenSummary={setSummaryModalFor}
                  typedAdvisorsFor={() => typedAdvisors}
                />
                </>
              )}
            </div>
          )}

          {/* ─── TAB: יעדים ─── */}
          {activeTab === "goals" && (
            <GoalsTab
              accounts={accounts}
              schoolId={schoolId}
              schoolStage={school?.stage}
              activeSubTab={activeSubTab}
              academicYear={academicYear}
              logs={logs}
            />
          )}

          {/* ─── TAB: שיחות ─── */}
          {activeTab === "calls" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-bold text-slate-900">שיחות</h1>
              </div>
              {callsLoading ? (
                <div className="glass-card rounded-2xl p-10 flex justify-center">
                  <div role="status" aria-label="טוען שיחות"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
                </div>
              ) : callsError ? (
                <div role="alert" className="glass-card rounded-2xl p-6 text-center">
                  <p className="text-red-600 mb-3">{callsError}</p>
                  <button onClick={loadCalls} className="btn-blue text-sm px-4 py-2">רענן</button>
                </div>
              ) : !voicenterEnabled ? (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <p className="text-3xl mb-3">📞</p>
                  <p className="font-semibold text-slate-700 mb-1">אינטגרציית השיחות אינה מוגדרת</p>
                  <p className="text-slate-400 text-sm">ניתן להגדיר את האינטגרציה עם Voicenter באזור ניהול</p>
                </div>
              ) : calls.length === 0 ? (
                <div className="glass-card rounded-2xl p-12 text-center">
                  <p className="text-3xl mb-3">📞</p>
                  <p className="font-semibold text-slate-700 mb-1">אין שיחות להצגה</p>
                  <p className="text-slate-400 text-sm">בטווח שנת הלימודים הנבחרת לא נמצאו שיחות עם אנשי הקשר של בית הספר</p>
                </div>
              ) : (
                <CallsTable calls={calls} hideSchoolColumn canManage={canRemoveCallFromSchool} schoolId={schoolId} />
              )}
            </div>
          )}

          {activeTab === "checks" && (
            <ChecksTab
              accounts={accounts}
              schoolId={schoolId}
              schoolName={school?.name}
              schoolStage={school?.stage}
              logs={logs}
              logsError={logsError}
              logsLoading={logsLoading}
              onReloadLogs={reloadLogs}
              activeSubTab={activeSubTab}
              setActiveSubTab={setActiveSubTab}
              academicYear={academicYear}
            />
          )}

          {activeTab === "tasks" && (
            <SchoolTasksTab schoolId={schoolId} />
          )}

          {activeTab === "closure" && (
            <SchoolYearClosureTab
              yearAdminData={yearAdminData}
              saveYearAdminField={saveYearAdminField}
              academicYear={academicYear}
            />
          )}

          {activeTab === "control_letter" && (
            <ControlLetterTab schoolId={schoolId} schoolStage={school?.stage} />
          )}
        </div>
      </div>
    </div>
  );
}
