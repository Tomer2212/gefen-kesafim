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
import { GoalsTab } from "../components/GoalsTab";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useCompareChecks } from "../context/CompareChecksContext";
import { AdvisorSearch } from "../components/AdvisorSearch";
import { AdvisorCell } from "../components/meetings/AdvisorCell";
import { DatePickerPopover } from "../components/meetings/DatePickerPopover";
import { DeleteMeetingModal } from "../components/meetings/DeleteMeetingModal";
import { MeetingRow } from "../components/meetings/MeetingRow";
import { MeetingsTable } from "../components/meetings/MeetingsTable";
import { MeetingTypeSelect } from "../components/meetings/MeetingTypeSelect";
import { NoParticipantsModal } from "../components/meetings/NoParticipantsModal";
import { NotesModal } from "../components/meetings/NotesModal";
import { ParticipantsSelector } from "../components/meetings/ParticipantsSelector";
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

const CONTACT_ROWS = [
  { label: "מנהל/ת",        nameField: "principal_name",       phoneField: "principal_phone",       emailField: "principal_email" },
  { label: "מנהלנ/ית",      nameField: "secretary_name",       phoneField: "secretary_phone",       emailField: "secretary_email" },
  { label: "אחראי/ת כספים", nameField: "finance_contact_name", phoneField: "finance_contact_phone", emailField: "finance_contact_email" },
];

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

const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

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

const EMPTY_BORDER_STYLE = {
  border: "1px solid #fca5a5",
  borderRadius: "4px",
  padding: "1px 5px",
  display: "inline-block",
};

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

function editFieldCls(hasErr, isEmpty = false) {
  const base = "w-full text-sm font-semibold text-slate-800 border rounded-md px-2 py-0.5 bg-transparent focus:outline-none focus:ring-1";
  if (hasErr) return `${base} border-red-400 focus:border-red-400 focus:ring-red-100`;
  if (isEmpty) return `${base} border-red-300 focus:border-blue-400 focus:ring-blue-100`;
  return `${base} border-slate-300 focus:border-blue-400 focus:ring-blue-100`;
}

function InfoRow({ label, value, dir, children, tooltip }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1">
        {tooltip && <QuestionTooltip text={tooltip} />}
        {label}:
      </span>
      {children ? (
        <div className="flex-1 flex flex-wrap gap-1">{children}</div>
      ) : (
        <span className={`text-sm font-semibold ${value ? "text-slate-800" : "text-slate-400 font-normal"}`} dir={dir}>
          {value || "—"}
        </span>
      )}
    </div>
  );
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
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
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
  if (!budgetName) return renderCheckLogCell(log, key);

  // Per-combo reconciliation cases — evaluated independently of tikhnun ov
  if (["fn_count", "fn_sum", "gn_count", "gn_sum"].includes(key)) {
    const perCombo = log.summary?.per_combo_results;
    if (perCombo != null) {
      const entries = Object.values(perCombo).filter(c => c.budget === budgetName);
      const noDataForBudget = entries.length === 0 || entries.every(c => c.not_checked);
      if (noDataForBudget) {
        const reason = entries[0]?.not_checked_text
          || `לא בוצעה בדיקה עבור תקציב ${budgetName} — לא נמצאו שורות דיווח תואמות`;
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
    // No per_combo for this check — cannot filter by budget, don't show misleading global totals
    return "—";
  }

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
      return "—";
    }
    case "rejected_sum": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_rejected;
      if (perBudget != null) {
        const rows = perBudget[budgetName] ?? [];
        if (rows.length === 0) return "—";
        const total = sumRowAmounts(rows);
        return total != null ? formatNum(total) : "—";
      }
      return "—";
    }
    case "no_pdf": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_no_pdf;
      if (perBudget != null) return (perBudget[budgetName] ?? []).length;
      return "—";
    }
    case "no_pdf_sum": {
      const perBudget = log.summary?.tikhnun_result?.per_budget_no_pdf;
      if (perBudget != null) {
        const rows = perBudget[budgetName] ?? [];
        if (rows.length === 0) return "—";
        const total = sumRowAmounts(rows);
        return total != null ? formatNum(total) : "—";
      }
      return "—";
    }
    case "fixed_gap":
      return ov.fixed_gap_abs != null ? formatNum(ov.fixed_gap_abs) : "—";
    case "flexible_remaining":
      return ov.flexible_remaining != null ? formatNum(ov.flexible_remaining) : "—";
    default: return renderCheckLogCell(log, key);
  }
}

function FileCheckCell({ log, colKey, state, notCheckedReason, title, onAddFile }) {
  const [hovered, setHovered] = useState(false);
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
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button type="button" onClick={onAddFile} aria-label="הוסף קובץ"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full
                   bg-green-50 text-green-600 text-xs font-bold hover:bg-green-100 transition-colors">
        ✓
      </button>
      {hovered && (
        <div className="absolute z-50 bottom-full right-0 mb-2 p-2.5 bg-white border
                        border-slate-200 rounded-xl shadow-lg text-right min-w-max">
          {filenames.map((f, i) => (
            <div key={i} className="text-xs text-slate-600 whitespace-nowrap py-0.5">{f}</div>
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
        />
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-col" style={{ height: "calc(100vh - 260px)" }}>
      {/* Toolbar: budget type tabs (right) + action buttons (left) */}
      <div className="flex items-end border-b border-slate-200 mb-4 gap-1 flex-shrink-0">
        {/* Budget type tabs — styled like main page tabs */}
        {allHistBudgets.length > 1 && [null, ...allHistBudgets].map(bname => (
          <button
            key={bname ?? "__all__"}
            type="button"
            onClick={() => setSelectedHistBudget(bname)}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
              selectedHistBudget === bname
                ? "border-blue-600 text-blue-600 font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
          >
            {bname ?? "כולם"}
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
                      const pfc = r ? {
                        tikhnun: !!(r.tikhnun && !r.tikhnun.error),
                        doch: (r.summary?.gefen_files || []).length > 0,
                        kasafim: !!(r.summary?.finance_file),
                      } : null;
                      const pProxy = r ? {
                        summary: { ...r.summary, tikhnun_overview: r.tikhnun?.overview || {} },
                        in_gefen_not_finance_count: r.summary?.in_gefen_not_finance ?? 0,
                        in_finance_not_gefen_count: r.summary?.in_finance_not_gefen ?? 0,
                        rows_finance_not_gefen: r.rows_finance_not_gefen,
                        rows_gefen_not_finance: r.rows_gefen_not_finance,
                        in_finance_not_gefen_sum: null,
                        in_gefen_not_finance_sum: null,
                      } : null;
                      return (
                        <>
                          {[["tikhnun", pfc?.tikhnun], ["doch", pfc?.doch], ["kasafim", pfc?.kasafim]].map(([k, present]) => (
                            <td key={k} className="px-3 py-3 text-center" style={k === "kasafim" ? { borderLeft: "1px solid black" } : {}}>
                              {pfc == null ? <span className="text-slate-400">—</span>
                                : present
                                  ? <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-50 text-green-600 text-xs font-bold">✓</span>
                                  : <span className="text-slate-300 text-xs">—</span>}
                            </td>
                          ))}
                          {visibleColOrder.map(key => (
                            <td key={key} className="px-4 py-3 text-slate-600 whitespace-nowrap" style={colBorderStyle(key)}>
                              {pProxy ? renderCheckLogCell(pProxy, key) : <span className="text-slate-400">—</span>}
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
                  function fileState(colKey) {
                    if (colKey === "tikhnun") return fc.tikhnun ? "present" : "absent";
                    if (!budgetEntries) return fc[colKey] ? "present" : "absent";
                    if (colKey === "doch") {
                      if (budgetEntries.length > 0) return "present";
                      return fc.doch ? "not_checked" : "absent";
                    }
                    if (colKey === "kasafim") {
                      if (budgetEntries.some(c => !c.not_checked)) return "present";
                      if (budgetEntries.length > 0) return "not_checked";
                      return fc.kasafim ? "present" : "absent";
                    }
                    return fc[colKey] ? "present" : "absent";
                  }
                  function fileNotCheckedReason(colKey) {
                    if (colKey === "doch") return `לא זוהו שורות דיווח עבור תקציב ${selectedHistBudget}`;
                    const ncEntry = budgetEntries?.find(c => c.not_checked);
                    return ncEntry?.not_checked_text || `לא נמצאו נתוני כספים עבור תקציב ${selectedHistBudget}`;
                  }
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

// ─── Meetings: AccessGrantModal ──────────────────────────────────────────────
function AccessGrantModal({ advisorName, canGrant, onGrant, onRequest, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="access-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
        <div>
          <h2 id="access-modal-title" className="font-bold text-slate-900">אין גישה לבית הספר</h2>
          <p className="text-sm text-slate-500 mt-1">
            ל{advisorName} אין גישה לנתוני בית הספר הזה. {canGrant ? "האם לפתוח עבורו/ה גישה?" : "ניתן לשלוח בקשת גישה לאחראי."}
          </p>
        </div>
        <div className="flex gap-2">
          {canGrant ? (
            <button type="button" onClick={onGrant} className="flex-1 btn-blue text-sm px-4 py-2">פתח גישה</button>
          ) : (
            <button type="button" onClick={onRequest} className="flex-1 btn-blue text-sm px-4 py-2">שלח בקשה</button>
          )}
          <button type="button" onClick={onCancel} className="btn-ghost text-sm px-4 py-2">ביטול</button>
        </div>
      </div>
    </div>
  );
}


function AccessSelector({ restrictTo, users, loadingUsers, onChange, schoolAdvisors, onSelectAdvisors }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Owners always have full access — exclude them from the selector
  const nonOwnerUsers = users.filter(u => u.role !== "owner");

  const isAll = restrictTo === null || restrictTo === undefined;
  // Also strip any owner IDs that may exist in stored data
  const selected = (restrictTo || []).filter(id => nonOwnerUsers.some(u => u.id === id));

  return (
    <div
      ref={containerRef}
      className="relative"
      onFocus={() => setOpen(true)}
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <div
        className="input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {isAll ? (
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.12)", color: "#15803d" }}>
            כולם
          </span>
        ) : selected.map(id => {
          const u = nonOwnerUsers.find(u => u.id === id);
          return u ? (
            <span key={id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
              {u.full_name || u.email}
              <button
                type="button"
                onMouseDown={e => { e.stopPropagation(); e.preventDefault(); const n = selected.filter(i => i !== id); onChange(n.length === 0 ? null : n); }}
                className="hover:text-red-500 leading-none"
                aria-label={`הסר ${u.full_name || u.email} מרשימת הגישה`}
              >×</button>
            </span>
          ) : null;
        })}
        {!isAll && (
          <button
            type="button"
            onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange(null); }}
            className="text-xs text-slate-400 hover:text-slate-600 mr-auto px-1"
            aria-label="אפס לכולם"
          >↺ כולם</button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 right-0 left-0 mt-1 border border-slate-200 rounded-xl bg-white shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <label htmlFor="access-selector-search-sp" className="sr-only">חיפוש</label>
            <input
              id="access-selector-search-sp"
              type="search"
              className="input-field text-sm"
              placeholder="חפש יועץ..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-50" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={isAll}
              onMouseDown={e => { e.preventDefault(); onChange(null); setOpen(false); }}
              className="w-full text-right px-4 py-2.5 text-sm hover:bg-green-50 flex items-center gap-2"
            >
              <span className={`w-4 h-4 rounded border flex-shrink-0 ${isAll ? "bg-green-500 border-green-500" : "border-slate-300"}`} aria-hidden="true" />
              <span className="font-medium">כולם</span>
              <span className="text-xs text-slate-400 mr-auto">ללא הגבלה</span>
            </button>
            {(schoolAdvisors || []).length > 0 && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={e => {
                  e.preventDefault();
                  if (onSelectAdvisors) {
                    onSelectAdvisors();
                  } else {
                    const ids = (schoolAdvisors || []).map(a => a.id).filter(Boolean);
                    onChange(ids.length > 0 ? ids : null);
                  }
                  setOpen(false);
                }}
                className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="w-4 h-4 rounded border flex-shrink-0 border-slate-300" aria-hidden="true" />
                <span className="font-medium">היועצים המלווים שנבחרו</span>
                <span className="text-xs text-slate-400 mr-auto">{(schoolAdvisors || []).length} יועצים</span>
              </button>
            )}
            {sortByRole(loadingUsers ? [] : nonOwnerUsers)
              .filter(u => !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase()))
              .map(u => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(u.id)}
                  onMouseDown={e => {
                    e.preventDefault();
                    const newSel = selected.includes(u.id) ? selected.filter(i => i !== u.id) : [...selected, u.id];
                    onChange(newSel.length === 0 ? null : newSel);
                  }}
                  className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2"
                >
                  <span className={`w-4 h-4 rounded border flex-shrink-0 ${selected.includes(u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                  {u.full_name || u.email}
                  <span className="text-xs text-slate-400 mr-auto">{ROLE_LABELS[u.role]}</span>
                </button>
              ))}
          </div>
        </div>
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
  const [loading, setLoading] = useState(!location.state?.school);
  const [activeTab, setActiveTab] = useState("info");
  const [activeSubTab, setActiveSubTab] = useState("tikkon");
  const [role, setRole] = useState("advisor");
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);

  // Meetings state
  const [meetings, setMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [notesModal, setNotesModal] = useState(null);
  const [accessGrantModal, setAccessGrantModal] = useState(null);

  const [schoolAdvisors, setSchoolAdvisors] = useState(
    (location.state?.school?.advisor_schools || []).map(as => as.profiles).filter(Boolean)
  );
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [originalForm, setOriginalForm] = useState(null);
  const [accessLinkedToAdvisors, setAccessLinkedToAdvisors] = useState(false);
  const [canDeleteSchool, setCanDeleteSchool] = useState(false);
  const [canDeleteMeetings, setCanDeleteMeetings] = useState(false);
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

  const blocker = useBlocker(isDirty);

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

      try {
        const meRes = await axios.get("/schools/users/me");
        if (meRes.data?.org?.subscription_status) {
          setSubscriptionStatus(meRes.data.org.subscription_status);
        }
        if (meRes.data?.role) setRole(meRes.data.role);
        if (meRes.data?.can_delete_schools) setCanDeleteSchool(true);
        setCanDeleteMeetings(!!meRes.data?.can_delete_own_meetings);
        setCanEditDirectly(!!meRes.data?.can_edit_school_directly);
        setCanRequestUpdate(meRes.data?.can_request_school_update !== false);
      } catch {
        // non-fatal
      }

      // When arriving via deeplink (e.g. from a notification) location.state.school is absent.
      // Fetch the school record directly so the info tab isn't blank.
      if (!location.state?.school) {
        try {
          const schoolRes = await axios.get(`/schools/${schoolId}`);
          setSchool(schoolRes.data);
          setAccounts(schoolRes.data?.gefen_accounts || []);
          setSchoolAdvisors(
            (schoolRes.data?.advisor_schools || []).map(as => as.profiles).filter(Boolean)
          );
        } catch {
          // non-fatal — page still usable without info tab data
        }
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

  async function loadMeetings() {
    setMeetingsLoading(true);
    setMeetingsError("");
    try {
      const res = await axios.get(`/schools/${schoolId}/meetings`, { params: { academic_year: academicYear } });
      setMeetings(res.data || []);
    } catch {
      setMeetingsError("שגיאה בטעינת הפגישות — נסה לרענן");
    } finally {
      setMeetingsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "meetings") {
      loadMeetings();
      if (users.length === 0 && (role === "owner" || role === "manager")) loadUsers();
    }
  }, [activeTab, schoolId, role, academicYear]);

  // When "היועצים המלווים שנבחרו" mode is active, keep restrict_access_to in sync
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    const ids = schoolAdvisors.map(a => a.id).filter(Boolean);
    setEditForm(p => ({ ...p, restrict_access_to: ids.length > 0 ? ids : null }));
  }, [schoolAdvisors, accessLinkedToAdvisors]);

  async function startNewMeeting() {
    const defaultAdvisor = schoolAdvisors[0] || null;
    const payload = {
      status: "scheduled",
      meeting_type: "remote",
      advisor_ids: defaultAdvisor ? [defaultAdvisor.id] : [],
      participants: [],
      reminder_enabled: false,
      academic_year: academicYear,
    };
    try {
      const res = await axios.post(`/schools/${schoolId}/meetings`, payload);
      const newMeeting = { ...res.data, advisor_profiles: defaultAdvisor ? [defaultAdvisor] : [] };
      setMeetings(prev => [newMeeting, ...prev]);
    } catch (err) {
      console.error("Failed to create meeting:", err);
    }
  }

  async function requestAdvisorAccess(advisorId) {
    try {
      await axios.post(`/schools/${schoolId}/update-requests`, {
        proposed_changes: { add_advisor_to_school: advisorId },
      });
    } catch (err) {
      console.error("Failed to request advisor access:", err);
    }
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
      actual_duration: draft.actual_duration || null,
      notes: draft.notes || null,
      reminder_enabled: draft.reminder_enabled || false,
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
    if (school?.principal_name) contacts.push({ key: "principal", label: "מנהל/ת", name: school.principal_name, email: school.principal_email || "" });
    if (school?.secretary_name) contacts.push({ key: "secretary", label: "מנהלנ/ית", name: school.secretary_name, email: school.secretary_email || "" });
    if (school?.finance_contact_name) contacts.push({ key: "finance", label: "אחראי/ת כספים", name: school.finance_contact_name, email: school.finance_contact_email || "" });
    (school?.extra_contacts || []).forEach((ec, i) => {
      if (ec.name) contacts.push({ key: `extra_${i}`, label: ec.role || "איש קשר נוסף", name: ec.name, email: ec.email || "" });
    });
    return contacts;
  }

  async function grantAccessToAdvisor(advisorId) {
    const current = school?.restrict_access_to;
    if (current === null || current === undefined) return; // already all access
    const updated = [...new Set([...(current || []), advisorId])];
    await axios.put(`/schools/${schoolId}`, { ...school, restrict_access_to: updated });
    setSchool(prev => ({ ...prev, restrict_access_to: updated }));
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
    };
    setEditForm(formData);
    setOriginalForm(formData);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    if (role === "owner" || role === "manager") {
      axios.get(`/schools/${schoolId}/advisors`).then(res => setSchoolAdvisors(res.data || [])).catch(() => {});
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

  async function addAdvisorToSchool(advisorId) {
    if (!advisorId) return;
    await axios.post(`/schools/${schoolId}/advisors`, { advisor_id: advisorId });
    const res = await axios.get(`/schools/${schoolId}/advisors`);
    setSchoolAdvisors(res.data || []);
  }

  async function removeAdvisorFromSchool(advisorId) {
    await axios.delete(`/schools/${schoolId}/advisors/${advisorId}`);
    const res = await axios.get(`/schools/${schoolId}/advisors`);
    setSchoolAdvisors(res.data || []);
  }

  async function saveEdit() {
    setSaveError("");
    setTriedSave(true);
    const schoolPhoneErr = validateSchoolPhone(editForm.school_phone);
    const principalPhoneErr = validateContactPhone(editForm.principal_phone);
    const secretaryPhoneErr = validateContactPhone(editForm.secretary_phone);
    const financePhoneErr = validateContactPhone(editForm.finance_contact_phone);
    if (!editForm.name || validateSymbol(editForm.symbol) || schoolPhoneErr || principalPhoneErr || secretaryPhoneErr || financePhoneErr) {
      setSaveError("יש שגיאות בטופס — אנא בדוק את השדות המסומנים.");
      return false;
    }
    setSaving(true);
    try {
      await axios.put(`/schools/${schoolId}`, editForm);
      setSchool(prev => ({
        ...prev,
        ...editForm,
        advisor_schools: schoolAdvisors.map(adv => ({ advisor_id: adv.id, profiles: adv })),
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
    setEditForm(p => ({ ...p, extra_contacts: (p.extra_contacts || []).filter((_, idx) => idx !== i) }));
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

  const displayAdvisors = (school?.advisor_schools || []).map(as => as.profiles).filter(Boolean);
  const accessIsAll = school?.restrict_access_to === null || school?.restrict_access_to === undefined;

  const colGridStyle = {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: 10,
    alignItems: "center",
  };

  const editColGridStyle = {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: 10,
    alignItems: "start",
  };

  const labelCls = "text-sm text-slate-500 py-1.5 whitespace-nowrap flex-shrink-0";
  const editLabelCls = "text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[7px]";

  function valCls(val) {
    return `text-sm py-1.5 ${val ? "font-semibold text-slate-800" : "text-slate-400 font-normal"}`;
  }

  function valStyle(val) {
    return val ? {} : EMPTY_BORDER_STYLE;
  }

  function contactValStyle(val) {
    return val ? {} : { ...EMPTY_BORDER_STYLE };
  }

  if (loading) {
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

      {blocker.state === "blocked" && (
        <UnsavedChangesModal
          saving={saving}
          onSave={async () => {
            const ok = await saveEdit();
            if (ok) blocker.proceed();
          }}
          onDiscard={() => {
            setIsEditing(false);
            setOriginalForm(null);
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
        <div className={`mx-auto px-6 py-10 ${activeTab === "checks" ? "max-w-6xl" : "max-w-4xl"}`}>

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
              { id: "goals",    label: "יעדים" },
              { id: "checks",   label: "בדיקות" },
            ].map(t => (
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
            <div className="pb-1.5">
              <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
            </div>
          </div>

          {/* ─── TAB: פרטי בית הספר ─── */}
          {activeTab === "info" && (
            <div>
              <div className="glass-card rounded-2xl px-6 py-5 mb-6">

                {/* ─── EDIT MODE ─── */}
                {isEditing ? (
                <div>
                  {/* Header */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">פרטי מוסד</p>
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
                    {saveError && (
                      <p role="alert" className="text-sm text-red-600 mt-2 text-right">{saveError}</p>
                    )}
                  </div>

                  {/* 3-column grid — each column is its own label/input grid */}
                  <div className="grid grid-cols-3 gap-x-8">
                    {/* Right column */}
                    <div style={editColGridStyle}>
                      <label htmlFor="edit-name" className={editLabelCls}>שם מוסד:</label>
                      <div className="py-0.5">
                        <input id="edit-name" className={editFieldCls(triedSave && !editForm.name, !editForm.name)} value={editForm.name}
                          onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} autoComplete="off" />
                        {triedSave && !editForm.name && <span className="text-xs text-red-500 block mt-0.5" role="alert">שדה חובה</span>}
                      </div>

                      <label htmlFor="edit-symbol" className={editLabelCls}>סמל מוסד:</label>
                      <div className="py-0.5">
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

                      <label htmlFor="edit-stage" className={editLabelCls}>שלב מוסד:</label>
                      <div className="py-0.5">
                        <select id="edit-stage" className={editFieldCls(false, !editForm.stage)} value={editForm.stage}
                          onChange={e => setEditForm(p => ({ ...p, stage: e.target.value }))}>
                          {SCHOOL_STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Middle column */}
                    <div style={editColGridStyle}>
                      <label htmlFor="edit-city" className={editLabelCls}>עיר:</label>
                      <div className="py-0.5">
                        <input id="edit-city" className={editFieldCls(false, !editForm.city)} value={editForm.city}
                          onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))} autoComplete="off" />
                      </div>

                      <label htmlFor="edit-authority" className={editLabelCls}>בעלות:</label>
                      <div className="py-0.5">
                        <input id="edit-authority" className={editFieldCls(false, !editForm.authority)} value={editForm.authority}
                          onChange={e => setEditForm(p => ({ ...p, authority: e.target.value }))} autoComplete="off" />
                      </div>

                      <label htmlFor="edit-district" className={editLabelCls}>מחוז:</label>
                      <div className="py-0.5">
                        <select id="edit-district" className={editFieldCls(false, !editForm.district)} value={editForm.district}
                          onChange={e => setEditForm(p => ({ ...p, district: e.target.value }))}>
                          <option value="">בחר</option>
                          {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Left column */}
                    <div style={editColGridStyle}>
                      <label htmlFor="edit-finance-software" className={editLabelCls}>תוכנת כספים:</label>
                      <div className="py-0.5">
                        <select id="edit-finance-software" className={editFieldCls(false, !editForm.finance_software)} value={editForm.finance_software}
                          onChange={e => setEditForm(p => ({ ...p, finance_software: e.target.value }))}>
                          {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>

                      <label htmlFor="edit-school-phone" className={editLabelCls}>טלפון בית הספר:</label>
                      <div className="py-0.5">
                        <input id="edit-school-phone"
                          className={editFieldCls(!!(editForm.school_phone && schoolPhoneError), !editForm.school_phone)}
                          value={editForm.school_phone} dir="ltr"
                          onChange={e => setEditForm(p => ({ ...p, school_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                          inputMode="numeric" autoComplete="off" />
                        {editForm.school_phone && schoolPhoneError && <span className="text-xs text-red-500 block mt-0.5" role="alert">{schoolPhoneError}</span>}
                      </div>

                      <label htmlFor="edit-address" className={editLabelCls}>כתובת:</label>
                      <div className="py-0.5">
                        <input id="edit-address" className={editFieldCls(false, !editForm.address)} value={editForm.address}
                          onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))} autoComplete="off" />
                      </div>
                    </div>
                  </div>

                  {/* Contact table */}
                  <div className="mt-8 mb-2">
                    <p className="text-sm font-semibold text-slate-700 text-right mb-4">אנשי קשר</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th scope="col" className="text-right pb-2 text-xs text-slate-400 font-semibold uppercase tracking-wide">תפקיד</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-400 font-semibold uppercase tracking-wide">שם</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-400 font-semibold uppercase tracking-wide">טלפון</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-400 font-semibold uppercase tracking-wide">מייל</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CONTACT_ROWS.map(row => {
                          const phoneErr = validateContactPhone(editForm[row.phoneField]);
                          const emailErr = validateEmail(editForm[row.emailField]);
                          return (
                            <tr key={row.nameField} className="border-t border-slate-100">
                              <td className="py-2.5 pr-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{row.label}</td>
                              <td className="py-1.5 px-2">
                                <label htmlFor={`edit-cn-${row.nameField}`} className="sr-only">{row.label} שם</label>
                                <input id={`edit-cn-${row.nameField}`} className={editFieldCls(false, !editForm[row.nameField])}
                                  value={editForm[row.nameField]}
                                  onChange={e => setEditForm(p => ({ ...p, [row.nameField]: e.target.value }))}
                                  autoComplete="off" />
                              </td>
                              <td className="py-1.5 px-2">
                                <label htmlFor={`edit-cp-${row.phoneField}`} className="sr-only">{row.label} טלפון</label>
                                <input id={`edit-cp-${row.phoneField}`} className={editFieldCls(!!(editForm[row.phoneField] && phoneErr), !editForm[row.phoneField])}
                                  value={editForm[row.phoneField]}
                                  onChange={e => setEditForm(p => ({ ...p, [row.phoneField]: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                                  dir="ltr" inputMode="numeric" autoComplete="off" />
                                {editForm[row.phoneField] && phoneErr && <span className="text-xs text-red-500 block mt-0.5" role="alert">{phoneErr}</span>}
                              </td>
                              <td className="py-1.5 px-2">
                                <label htmlFor={`edit-ce-${row.emailField}`} className="sr-only">{row.label} מייל</label>
                                <input id={`edit-ce-${row.emailField}`} className={editFieldCls(!!(editForm[row.emailField] && emailErr), !editForm[row.emailField])}
                                  value={editForm[row.emailField]}
                                  onChange={e => setEditForm(p => ({ ...p, [row.emailField]: e.target.value }))}
                                  dir="ltr" type="email" autoComplete="off" />
                                {editForm[row.emailField] && emailErr && <span className="text-xs text-red-500 block mt-0.5" role="alert">{emailErr}</span>}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Extra contact rows */}
                        {(editForm.extra_contacts || []).map((ec, i) => (
                          <tr key={`extra-${i}`} className="border-t border-slate-100">
                            <td className="py-1.5 pr-1">
                              <label htmlFor={`edit-extra-role-${i}`} className="sr-only">תפקיד</label>
                              <input id={`edit-extra-role-${i}`} className={editFieldCls(false)} value={ec.role}
                                onChange={e => updateExtra(i, "role", e.target.value)} autoComplete="off" />
                            </td>
                            <td className="py-1.5 px-2">
                              <label htmlFor={`edit-extra-name-${i}`} className="sr-only">שם</label>
                              <input id={`edit-extra-name-${i}`} className={editFieldCls(false)} value={ec.name}
                                onChange={e => updateExtra(i, "name", e.target.value)} autoComplete="off" />
                            </td>
                            <td className="py-1.5 px-2">
                              <label htmlFor={`edit-extra-phone-${i}`} className="sr-only">טלפון</label>
                              <input id={`edit-extra-phone-${i}`} className={editFieldCls(false)} value={ec.phone}
                                onChange={e => updateExtra(i, "phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                                dir="ltr" inputMode="numeric" autoComplete="off" />
                            </td>
                            <td className="py-1.5 px-2">
                              <div className="flex items-center gap-1">
                                <label htmlFor={`edit-extra-email-${i}`} className="sr-only">מייל</label>
                                <input id={`edit-extra-email-${i}`} className={editFieldCls(false)} value={ec.email}
                                  onChange={e => updateExtra(i, "email", e.target.value)}
                                  dir="ltr" type="email" autoComplete="off" />
                                <button type="button" onClick={() => removeExtra(i)}
                                  className="text-slate-400 hover:text-red-500 flex-shrink-0 mr-1 text-base leading-none"
                                  aria-label="הסר שורת איש קשר">✕</button>
                              </div>
                            </td>
                          </tr>
                        ))}

                        {/* Add contact button */}
                        {(editForm.extra_contacts || []).length < 3 && (
                          <tr>
                            <td colSpan={4} className="pt-3 pb-1">
                              <button type="button" onClick={addExtra}
                                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors">
                                <span aria-hidden="true">+</span> הוסף איש קשר
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* ליווי — visible only to owner/manager */}
                  {(role === "owner" || role === "manager") && <div className="mt-6 pt-5 border-t border-slate-100">
                    <p className="text-sm font-semibold text-slate-700 text-right mb-3">ליווי</p>
                    <div className="grid grid-cols-2 gap-x-8">
                      <div>
                        <div className="flex items-start gap-2 py-1.5">
                          <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 pt-[9px]">יועץ מלווה:</span>
                          <div className="flex-1 min-w-0">
                            <AdvisorSearch schoolId={schoolId} assigned={schoolAdvisors} users={users}
                              loadingUsers={loadingUsers} onAdd={addAdvisorToSchool} onRemove={removeAdvisorFromSchool} onRetry={loadUsers} />
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-start gap-2 py-1.5">
                          <span className="text-sm text-slate-500 whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1 pt-[9px]">
                            <QuestionTooltip text="בחר למי תהיה גישה לנתוני בית הספר." />
                            גישה:
                          </span>
                          <div className="flex-1 min-w-0">
                            <AccessSelector restrictTo={editForm.restrict_access_to} users={users}
                              loadingUsers={loadingUsers}
                              onChange={val => { setAccessLinkedToAdvisors(false); setEditForm(p => ({ ...p, restrict_access_to: val })); }}
                              onSelectAdvisors={() => setAccessLinkedToAdvisors(true)}
                              schoolAdvisors={schoolAdvisors} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>}

                  {/* Bottom actions */}
                  <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t border-slate-100">
                    <button onClick={isRequestMode ? submitFullRequest : saveEdit} disabled={saving} className="btn-green-light text-sm px-5 py-2">
                      {saving ? (isRequestMode ? "שולח..." : "שומר...") : (isRequestMode ? "הגש בקשה" : "שמור שינויים")}
                    </button>
                    <button onClick={() => { setIsEditing(false); setIsRequestMode(false); setOriginalForm(null); setSaveError(""); setAccessLinkedToAdvisors(false); }} disabled={saving} className="btn-ghost text-sm px-5 py-2">ביטול</button>
                  </div>
                </div>

                ) : (
                /* ─── DISPLAY MODE ─── */
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-slate-700">פרטי מוסד</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(role === "owner" || role === "manager" || (role === "advisor" && canEditDirectly)) && (
                        <button onClick={() => startEdit(false)} className="btn-ghost text-sm px-4 py-2">✏️ ערוך פרטים</button>
                      )}
                      {role === "advisor" && !canEditDirectly && canRequestUpdate && (
                        <button onClick={() => startEdit(true)} className="btn-ghost text-sm px-4 py-2">📝 בקש עדכון פרטים</button>
                      )}
                    </div>
                  </div>

                  {/* 3-column grid — each column is its own label/value grid */}
                  <div className="grid grid-cols-3 gap-x-8">
                    {/* Right column */}
                    <div style={colGridStyle}>
                      <span className={labelCls}>שם מוסד:</span>
                      <span className={valCls(school?.name)} style={valStyle(school?.name)}>{school?.name || "—"}</span>

                      <span className={labelCls}>סמל מוסד:</span>
                      <span className={valCls(school?.symbol)} style={valStyle(school?.symbol)}>{school?.symbol || "—"}</span>

                      <span className={labelCls}>שלב מוסד:</span>
                      <span className={valCls(SCHOOL_STAGE_LABEL[school?.stage] || school?.stage)} style={valStyle(SCHOOL_STAGE_LABEL[school?.stage] || school?.stage)}>
                        {SCHOOL_STAGE_LABEL[school?.stage] || school?.stage || "—"}
                      </span>
                    </div>

                    {/* Middle column */}
                    <div style={colGridStyle}>
                      <span className={labelCls}>עיר:</span>
                      <span className={valCls(school?.city)} style={valStyle(school?.city)}>{school?.city || "—"}</span>

                      <span className={labelCls}>בעלות:</span>
                      <span className={valCls(school?.authority)} style={valStyle(school?.authority)}>{school?.authority || "—"}</span>

                      <span className={labelCls}>מחוז:</span>
                      <span className={valCls(school?.district)} style={valStyle(school?.district)}>{school?.district || "—"}</span>
                    </div>

                    {/* Left column */}
                    <div style={colGridStyle}>
                      <span className={labelCls}>תוכנת כספים:</span>
                      <span className={valCls(FINANCE_SOFTWARE_LABEL[school?.finance_software] || school?.finance_software)}
                        style={valStyle(FINANCE_SOFTWARE_LABEL[school?.finance_software] || school?.finance_software)}>
                        {FINANCE_SOFTWARE_LABEL[school?.finance_software] || school?.finance_software || "—"}
                      </span>

                      <span className={labelCls}>טלפון בית הספר:</span>
                      <span className={valCls(school?.school_phone)} dir={school?.school_phone ? "ltr" : undefined} style={valStyle(school?.school_phone)}>
                        {school?.school_phone || "—"}
                      </span>

                      <span className={labelCls}>כתובת:</span>
                      <span className={valCls(school?.address)} style={valStyle(school?.address)}>{school?.address || "—"}</span>
                    </div>
                  </div>

                  {/* Contact table (read-only) */}
                  <div className="mt-8 mb-2">
                    <p className="text-sm font-semibold text-slate-700 text-right mb-4">אנשי קשר</p>
                    <table className="w-full text-sm table-fixed">
                      <thead>
                        <tr>
                          <th scope="col" className="text-right pb-2 text-xs text-slate-400 font-semibold uppercase tracking-wide w-1/4">תפקיד</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-400 font-semibold uppercase tracking-wide w-1/4">שם</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-400 font-semibold uppercase tracking-wide w-1/4">טלפון</th>
                          <th scope="col" className="text-right pb-2 px-2 text-xs text-slate-400 font-semibold uppercase tracking-wide w-1/4">מייל</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CONTACT_ROWS.map(row => (
                          <tr key={row.nameField} className="border-t border-slate-100">
                            <td className="py-2.5 pr-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">{row.label}</td>
                            <td className="py-2.5 px-2">
                              <span className={`text-sm ${school?.[row.nameField] ? "font-medium text-slate-800" : "text-slate-400 font-normal"}`}
                                style={contactValStyle(school?.[row.nameField])}>
                                {school?.[row.nameField] || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={`text-sm ${school?.[row.phoneField] ? "font-medium text-slate-800" : "text-slate-400 font-normal"}`}
                                dir={school?.[row.phoneField] ? "ltr" : undefined} style={contactValStyle(school?.[row.phoneField])}>
                                {school?.[row.phoneField] || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={`text-sm ${school?.[row.emailField] ? "font-medium text-slate-800" : "text-slate-400 font-normal"}`}
                                dir={school?.[row.emailField] ? "ltr" : undefined} style={contactValStyle(school?.[row.emailField])}>
                                {school?.[row.emailField] || "—"}
                              </span>
                            </td>
                          </tr>
                        ))}

                        {/* Extra contacts (display) */}
                        {(school?.extra_contacts || []).map((ec, i) => (
                          <tr key={`extra-disp-${i}`} className="border-t border-slate-100">
                            <td className="py-2.5 pr-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                              {ec.role || "—"}
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={`text-sm ${ec.name ? "font-medium text-slate-800" : "text-slate-400 font-normal"}`}
                                style={contactValStyle(ec.name)}>
                                {ec.name || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={`text-sm ${ec.phone ? "font-medium text-slate-800" : "text-slate-400 font-normal"}`}
                                dir={ec.phone ? "ltr" : undefined} style={contactValStyle(ec.phone)}>
                                {ec.phone || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={`text-sm ${ec.email ? "font-medium text-slate-800" : "text-slate-400 font-normal"}`}
                                dir={ec.email ? "ltr" : undefined} style={contactValStyle(ec.email)}>
                                {ec.email || "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* ליווי section */}
                  <div className="mt-6 pt-5 border-t border-slate-100">
                    <p className="text-sm font-semibold text-slate-700 text-right mb-3">ליווי</p>
                    <div className="grid grid-cols-2 gap-x-8">
                      <div>
                        <InfoRow label="יועץ מלווה">
                          {displayAdvisors.length === 0 ? null : displayAdvisors.map(p => (
                            <span key={p.id} className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
                              {p.full_name || p.email}
                            </span>
                          ))}
                        </InfoRow>
                      </div>
                      <div>
                        <InfoRow label="גישה" tooltip="בחר למי תהיה גישה לנתוני בית הספר.">
                          {accessIsAll ? (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.12)", color: "#15803d" }}>כולם</span>
                          ) : (() => {
                            const profiles = school?.restrict_access_profiles !== undefined
                              ? (school.restrict_access_profiles || [])
                              : (school?.restrict_access_to || []).map(id => users.find(u => u.id === id)).filter(Boolean);
                            const visible = profiles.filter(u => u.role !== "owner");
                            if (visible.length === 0 && loadingUsers) return <span className="text-xs text-slate-400">טוען...</span>;
                            return visible.map(u => (
                              <span key={u.id} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
                                {u.full_name || u.email}
                              </span>
                            ));
                          })()}
                        </InfoRow>
                      </div>
                    </div>
                  </div>
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
              {accessGrantModal && (
                <AccessGrantModal
                  advisorName={accessGrantModal.advisorName}
                  canGrant={role === "owner" || role === "manager"}
                  onGrant={async () => {
                    await grantAccessToAdvisor(accessGrantModal.advisorId);
                    setAccessGrantModal(null);
                  }}
                  onRequest={async () => {
                    try {
                      await axios.post(`/schools/${schoolId}/update-requests`, {
                        proposed_changes: { restrict_access_to: [...(school?.restrict_access_to || []), accessGrantModal.advisorId] },
                      });
                    } catch {}
                    setAccessGrantModal(null);
                  }}
                  onCancel={() => setAccessGrantModal(null)}
                />
              )}

              {/* Top toolbar */}
              <div className="flex items-center gap-3 mb-4">
                <button type="button" onClick={startNewMeeting}
                  className="btn-blue text-sm px-4 py-2 flex items-center gap-2">
                  <span aria-hidden="true">+</span> הוסף פגישה
                </button>
                <button type="button" className="btn-ghost text-sm px-4 py-2 flex items-center gap-2">
                  <span aria-hidden="true">⚙️</span> אוטומציות
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
                  onSave={updateMeeting}
                  onDelete={deleteMeeting}
                  onOpenNotes={(meetingId, notes, onSave) => setNotesModal({ meetingId, notes, onSave })}
                  onRequestAccess={requestAdvisorAccess}
                  canDeleteMeetings={canDeleteMeetings}
                  onSendStatusReminder={sendStatusReminderFromSchool}
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
        </div>
      </div>
    </div>
  );
}
