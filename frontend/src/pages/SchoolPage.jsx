import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation, useBlocker } from "react-router-dom";
import axios from "axios";
import { supabase } from "../lib/supabase";
import Sidebar from "../components/Sidebar";
import FileUpload from "../components/FileUpload";
import LoadingScreen from "../components/LoadingScreen";
import ResultsView from "../components/ResultsView";
import ClassifyModal from "../components/ClassifyModal";
import { useFocusTrap } from "../hooks/useFocusTrap";

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
        className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-5"
      >
        <div>
          <h2 id="unsaved-modal-title" className="font-bold text-slate-900 text-lg">נא לשים לב!</h2>
          <p className="text-sm text-slate-500 mt-1">השינויים שביצעת טרם נשמרו, מה ברצונך לעשות?</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 text-sm px-4 py-2 rounded-xl font-semibold text-white disabled:opacity-60 transition-colors"
            style={{ background: "#16a34a" }}
          >
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
          <button onClick={onCancel} disabled={saving} className="btn-ghost flex-1 text-sm px-4 py-2">ביטול</button>
          <button onClick={onDiscard} disabled={saving} className="btn-ghost flex-1 text-sm px-4 py-2">אל תשמור</button>
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
function ChecksTab({ accounts, schoolId, schoolName, schoolStage, logs, logsError, onReloadLogs, activeSubTab, setActiveSubTab }) {
  const isSheshsSnati = schoolStage === "sheshshnati";
  const [view, setView] = useState("table");
  const [activeResult, setActiveResult] = useState(null);

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

  useEffect(() => {
    axios.get("/schools/users/me").then(r => setMeUser(r.data)).catch(() => {});
  }, []);

  // When "היועצים המלווים שנבחרו" mode is active, keep restrict_access_to in sync
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    const ids = schoolAdvisors.map(a => a.id).filter(Boolean);
    setEditForm(p => ({ ...p, restrict_access_to: ids.length > 0 ? ids : null }));
  }, [schoolAdvisors, accessLinkedToAdvisors]);

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

  const canDelete = meUser && (meUser.role === "owner" || meUser.managers_can_delete);

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

          <button
            type="button"
            onClick={() => setShowNewCheckModal(true)}
            className="btn-blue text-sm px-4 py-2 flex items-center gap-1.5"
          >
            <span aria-hidden="true">+</span> בדיקה חדשה
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-2xl overflow-hidden flex-1 min-h-0">
        <div className="overflow-auto h-full">
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
                  <th scope="col" rowSpan={2} className={thBase}>תאריך</th>
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
                    <td className="px-3 py-3" style={{ borderLeft: "1px solid black" }}>
                      {pendingRun.status === "loading" && (
                        <div className="flex items-center gap-2">
                          <div role="status" aria-label="בבדיקה">
                            <div aria-hidden="true" className="spinner w-4 h-4" />
                          </div>
                          <span className="text-slate-400 text-xs">{formatDate(pendingRun.date)}</span>
                        </div>
                      )}
                      {pendingRun.status === "done" && (
                        <button type="button"
                          onClick={() => { setActiveResult({ result: pendingRun.result, runId: pendingRun.runId }); setView("result"); }}
                          className="text-blue-600 hover:text-blue-800 font-medium underline text-sm transition-colors">
                          {formatDate(pendingRun.date)}
                        </button>
                      )}
                      {pendingRun.status === "error" && (
                        <div>
                          <span className="text-xs text-slate-500">{formatDate(pendingRun.date)}</span>
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
                      <td className="px-3 py-3 font-medium whitespace-nowrap" style={{ borderLeft: "1px solid black" }}>
                        {isLoadingThis ? (
                          <div className="flex items-center gap-1.5">
                            <div aria-hidden="true" className="spinner w-3 h-3" />
                            <span className="text-slate-400 text-sm">{formatDate(log.run_at)}</span>
                          </div>
                        ) : (
                          <button type="button"
                            onClick={() => handleLogClick(log)}
                            className="text-blue-600 hover:text-blue-800 font-medium underline text-sm transition-colors">
                            {formatDate(log.run_at)}
                          </button>
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
                              className="absolute bottom-0 left-full ml-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[100px]">
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
                      אין בדיקות קודמות
                    </td>
                  </tr>
                )}

                {/* Filler row: extends vertical column borders to the bottom of the container */}
                {(filteredLogs.length > 0 || !!pendingRun) && (
                  <tr style={{ height: "100%" }}>
                    <td style={{ borderLeft: "1px solid black" }} />
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
      </div>

      {showNewCheckModal && (
        <NewCheckModal
          accounts={getModalAccounts()}
          defaultAccountId={getModalAccounts().length === 1 ? getModalAccounts()[0].id : ""}
          onClose={() => setShowNewCheckModal(false)}
          onConfirm={startCheck}
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

// ─── Meetings: Status helpers ────────────────────────────────────────────────
const MEETING_STATUS_OPTIONS = [
  { value: "scheduled",  label: "נקבעה",   color: "#c2410c", bg: "#fff7ed", dot: "#f97316" },
  { value: "completed",  label: "בוצעה",   color: "#15803d", bg: "#f0fdf4", dot: "#22c55e" },
  { value: "cancelled",  label: "בוטלה",   color: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" },
  { value: "postponed",  label: "נדחתה",   color: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" },
  { value: "other",      label: "אחר",     color: "#475569", bg: "#f8fafc", dot: "#94a3b8" },
];
const STATUS_MAP = Object.fromEntries(MEETING_STATUS_OPTIONS.map(s => [s.value, s]));

const MEETING_TYPE_OPTIONS = [
  { value: "physical", label: "פיזי" },
  { value: "remote",   label: "מרחוק" },
];

function formatMeetingDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ─── Meetings: AdvisorCell (multi-select, checkboxes) ────────────────────────
function AdvisorCell({ value, usersWithAccess, usersWithoutAccess, onChange, onRequestAccess }) {
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) { setOpen(false); setShowOthers(false); } }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // value = array of profile objects [{id, full_name, email}]
  const selected = value || [];

  function toggle(user, hasAccess) {
    const exists = selected.some(s => s.id === user.id);
    const newSelected = exists
      ? selected.filter(s => s.id !== user.id)
      : [...selected, { id: user.id, full_name: user.full_name, email: user.email }];
    if (!exists && !hasAccess) onRequestAccess(user.id, user.full_name || user.email);
    onChange(newSelected);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="w-full text-right text-sm px-1.5 py-0.5 rounded hover:ring-1 hover:ring-slate-300 transition-all cursor-pointer min-h-[24px]"
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0
          ? <span className="text-slate-400 text-lg font-light leading-none">+</span>
          : <span className="text-slate-700">{selected.map(s => s.full_name || s.email).join(", ")}</span>}
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[210px] max-h-60 overflow-y-auto">
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onChange([]); }}
            className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">
            בחר
          </button>
          {(usersWithAccess || []).map(u => (
            <button key={u.id} type="button"
              onMouseDown={e => { e.preventDefault(); toggle(u, true); }}
              className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2">
              <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => s.id === u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
              <span className="text-slate-700">{u.full_name || u.email}</span>
            </button>
          ))}
          {(usersWithoutAccess || []).length > 0 && !showOthers && (
            <button type="button"
              onMouseDown={e => { e.preventDefault(); setShowOthers(true); }}
              className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50 flex items-center justify-between border-t border-slate-100 mt-0.5 pt-2">
              <span aria-hidden="true" className="text-xs opacity-60">›</span>
              <span>אחר</span>
            </button>
          )}
          {showOthers && (usersWithoutAccess || []).length > 0 && (
            <>
              <div className="border-t border-slate-100 mt-0.5 pt-1">
                <p className="px-3 py-0.5 text-[11px] text-slate-400">ללא גישה לבית הספר:</p>
              </div>
              {(usersWithoutAccess || []).map(u => (
                <div key={u.id} className="relative group/noAccess">
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); toggle(u, false); }}
                    className="w-full text-right px-3 py-2 text-sm text-slate-400 hover:bg-orange-50 flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => s.id === u.id) ? "bg-orange-400 border-orange-400" : "border-slate-300"}`} aria-hidden="true" />
                    {u.full_name || u.email}
                  </button>
                  <div className="hidden group-hover/noAccess:block absolute right-full top-0 mr-2 bg-slate-800 text-white text-xs rounded-lg p-2 w-52 z-50 leading-snug pointer-events-none" dir="rtl">
                    ליועץ זה אין גישה לבית הספר. במידה ותבחרו בו, תישלח בקשה לגורם המאשר.
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Meetings: DeleteMeetingModal ─────────────────────────────────────────────
function DeleteMeetingModal({ onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="del-meeting-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[340px] flex flex-col gap-4">
        <h2 id="del-meeting-title" className="text-base font-bold text-slate-800 text-center">מחיקת פגישה</h2>
        <p className="text-sm text-slate-600 text-center">האם למחוק את הפגישה לצמיתות? לא ניתן לשחזר פעולה זו.</p>
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={onConfirm}
            className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
            מחק
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

// ─── Meetings: MeetingTypeSelect ───────────────────────────────────────────────
function MeetingTypeSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selected = MEETING_TYPE_OPTIONS.find(o => o.value === value);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="w-full text-right text-sm px-0 py-0.5 rounded hover:ring-1 hover:ring-slate-300 transition-all cursor-pointer min-h-[24px]"
        onClick={() => setOpen(o => !o)}>
        {selected
          ? <span className="text-slate-700">{selected.label}</span>
          : <span className="text-slate-400 text-lg font-light leading-none">+</span>}
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[100px]">
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onChange(""); setOpen(false); }}
            className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">
            בחר
          </button>
          {MEETING_TYPE_OPTIONS.map(o => (
            <button key={o.value} type="button"
              onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
              className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${value === o.value ? "text-blue-600 font-semibold" : "text-slate-700"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Meetings: NoParticipantsModal ───────────────────────────────────────────
function NoParticipantsModal({ onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="no-part-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[360px] flex flex-col gap-4">
        <h2 id="no-part-title" className="text-base font-bold text-slate-800 text-center">לא נבחרו משתתפים</h2>
        <p className="text-sm text-slate-600 text-center leading-relaxed">
          טרם נבחרו משתתפים בפגישה. יש לבחור משתתפים ולנסות מחדש.
        </p>
        <div className="flex justify-center mt-1">
          <button type="button" onClick={onClose}
            className="px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Meetings: MeetingRow (always inline-editable) ───────────────────────────
function MeetingRow({ meeting, onSave, onRequestDelete, onOpenNotes, usersWithAccess, usersWithoutAccess, contacts, onRequestAccess, onReminderOn }) {
  const [draft, setDraft] = useState({ ...meeting });
  const [showDate, setShowDate] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showReminderTip, setShowReminderTip] = useState(false);
  const [showNoParticipantsModal, setShowNoParticipantsModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const rowRef = useRef(null);
  const actionsMenuRef = useRef(null);
  // Track what was last sent so blur doesn't double-save after an immediate save
  const lastSentRef = useRef(null);

  useEffect(() => { setDraft({ ...meeting }); lastSentRef.current = null; }, [meeting.id]);

  useEffect(() => {
    function h(e) { if (!actionsMenuRef.current?.contains(e.target)) setShowActionsMenu(false); }
    if (showActionsMenu) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showActionsMenu]);

  function set(field, val) {
    setDraft(p => ({ ...p, [field]: val }));
  }

  function saveDraft(draftToSave) {
    lastSentRef.current = JSON.stringify(draftToSave);
    onSave(draftToSave);
  }

  function handleRowBlur(e) {
    if (rowRef.current?.contains(e.relatedTarget)) return;
    if (showDate || showStatus) return;
    const curr = JSON.stringify(draft);
    const baseline = lastSentRef.current ?? JSON.stringify(meeting);
    if (baseline !== curr) saveDraft(draft);
  }

  const status = STATUS_MAP[draft.status] || STATUS_MAP.other;
  const cellInput = "w-full bg-transparent border-0 outline-none text-sm text-right text-slate-700 cursor-pointer rounded focus:bg-white focus:ring-1 focus:ring-blue-300 px-0 py-0 focus:px-1.5 focus:py-0.5 transition-all";

  return (
    <>
      {showNoParticipantsModal && <NoParticipantsModal onClose={() => setShowNoParticipantsModal(false)} />}
      <tr ref={rowRef} onBlur={handleRowBlur}
        className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group">
        {/* תאריך */}
        <td className="py-2.5 px-2">
          <div className="relative">
            <button type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowDate(o => !o)}
              className="text-sm text-right w-full hover:text-blue-600 transition-colors cursor-pointer font-medium text-slate-700 whitespace-nowrap">
              {draft.meeting_date ? formatMeetingDate(draft.meeting_date) : <span className="text-slate-300 font-normal">—</span>}
            </button>
            {showDate && <DatePickerPopover value={draft.meeting_date}
              onChange={v => { const nd = { ...draft, meeting_date: v }; setDraft(nd); setShowDate(false); saveDraft(nd); }}
              onClose={() => setShowDate(false)} />}
          </div>
        </td>
        {/* סטטוס */}
        <td className="py-2.5 px-2">
          <div className="relative">
            <button type="button" onClick={() => setShowStatus(o => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer hover:opacity-80 whitespace-nowrap transition-opacity"
              style={{ background: status.bg, color: status.color }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: status.dot }} aria-hidden="true" />
              {status.label}
            </button>
            {showStatus && (
              <div className="absolute z-30 mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[110px]" role="listbox">
                {MEETING_STATUS_OPTIONS.map(o => {
                  const s = STATUS_MAP[o.value];
                  return (
                    <button key={o.value} type="button" role="option"
                      onMouseDown={e => { e.preventDefault(); const nd = { ...draft, status: o.value }; setDraft(nd); setShowStatus(false); saveDraft(nd); }}
                      className="w-full text-right px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} aria-hidden="true" />
                      <span style={{ color: s.color }} className="font-medium">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </td>
        {/* שעת התחלה */}
        <td className="py-2.5 pr-2 pl-3">
          <TimeInput id={`start-${meeting.id}`} value={draft.start_time || ""} onChange={v => set("start_time", v)} ariaLabel="שעת התחלה" />
        </td>
        {/* שעת סיום */}
        <td className="py-2.5 px-1">
          <TimeInput id={`end-${meeting.id}`} value={draft.end_time || ""} onChange={v => set("end_time", v)} ariaLabel="שעת סיום" />
        </td>
        {/* יועץ מבצע */}
        <td className="py-2.5 px-2">
          <AdvisorCell
            value={draft.advisor_profiles || []}
            usersWithAccess={usersWithAccess}
            usersWithoutAccess={usersWithoutAccess}
            onChange={profiles => { const nd = { ...draft, advisor_ids: profiles.map(x => x.id), advisor_profiles: profiles }; setDraft(nd); saveDraft(nd); }}
            onRequestAccess={onRequestAccess}
          />
        </td>
        {/* משתתפים */}
        <td className="py-2.5 px-2">
          <ParticipantsSelector contacts={contacts} selected={draft.participants || []}
            onChange={v => {
              const reminderOff = v.length === 0 && draft.reminder_enabled;
              const nd = { ...draft, participants: v, ...(reminderOff ? { reminder_enabled: false } : {}) };
              setDraft(nd);
              saveDraft(nd);
            }} />
        </td>
        {/* סוג */}
        <td className="py-2.5 px-2">
          <MeetingTypeSelect value={draft.meeting_type || ""} onChange={v => { const nd = { ...draft, meeting_type: v }; setDraft(nd); saveDraft(nd); }} />
        </td>
        {/* הערות */}
        <td className="py-2.5 px-2 text-center">
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onOpenNotes(meeting.id, draft.notes || "", val => { const nd = { ...draft, notes: val }; setDraft(nd); saveDraft(nd); }); }}
            className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none" aria-label="פתח הערות">
            {draft.notes ? "📝" : <span className="text-slate-400 text-lg font-light">+</span>}
          </button>
        </td>
        {/* תזכורת */}
        <td className="py-2.5 px-2 text-center">
          <div className="relative inline-block">
            <button type="button" onClick={() => {
              const newVal = !draft.reminder_enabled;
              if (newVal && (!draft.participants || draft.participants.length === 0)) {
                setShowNoParticipantsModal(true);
                return;
              }
              set("reminder_enabled", newVal);
              if (newVal) onReminderOn?.();
            }}
              onMouseEnter={() => setShowReminderTip(true)}
              onMouseLeave={() => setShowReminderTip(false)}
              aria-label="תזכורת למשתתפים" aria-pressed={draft.reminder_enabled}
              className={`text-xs font-semibold px-2 py-0.5 rounded-full border transition-colors ${draft.reminder_enabled ? "bg-green-100 border-green-400 text-green-700" : "bg-slate-100 border-slate-300 text-slate-400"}`}>
              {draft.reminder_enabled ? "ON" : "OFF"}
            </button>
            {showReminderTip && !draft.reminder_enabled && (
              <div role="tooltip"
                className="absolute z-40 text-sm text-slate-800 leading-relaxed p-3 rounded-lg shadow-md pointer-events-none"
                style={{ background: "#FEF08A", border: "1px solid #EAB308", top: "calc(100% + 4px)", left: 0, width: 265, whiteSpace: "normal" }}>
                בהפעלת הכפתור תישלח למשתתפים תזכורת יום לפני קיום הפגישה.
              </div>
            )}
          </div>
        </td>
        {/* Actions */}
        <td className="py-2.5 px-2 text-center">
          <div className="relative inline-block" ref={actionsMenuRef}>
            <button type="button" onClick={() => setShowActionsMenu(o => !o)} aria-label="פעולות"
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition-all flex items-center justify-center w-6 h-6 rounded hover:bg-slate-100">
              <svg width="14" height="14" viewBox="0 0 16 4" fill="currentColor" aria-hidden="true">
                <circle cx="2" cy="2" r="1.5"/>
                <circle cx="8" cy="2" r="1.5"/>
                <circle cx="14" cy="2" r="1.5"/>
              </svg>
            </button>
            {showActionsMenu && (
              <div className="absolute left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30 min-w-[90px]">
                <button type="button"
                  onMouseDown={e => { e.preventDefault(); onRequestDelete(meeting.id); setShowActionsMenu(false); }}
                  className="w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap">
                  מחק
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

const STATUS_SORT_ORDER = { completed: 0, scheduled: 1, postponed: 2, other: 3 };

// ─── Meetings: ReminderHeaderTooltip ─────────────────────────────────────────
function ReminderHeaderTooltip() {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative inline-flex">
      <span className="cursor-help"
        onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
        תזכורת
      </span>
      {visible && (
        <div role="tooltip"
          className="absolute z-40 text-sm text-slate-800 leading-relaxed p-3 rounded-lg shadow-md pointer-events-none"
          style={{ background: "#FEF08A", border: "1px solid #EAB308", top: "calc(100% + 6px)", left: 0, width: 265, whiteSpace: "normal" }}>
          בהפעלת הכפתור תישלח למשתתפים תזכורת יום לפני קיום הפגישה.
        </div>
      )}
    </div>
  );
}

// ─── Meetings: ReminderToast ──────────────────────────────────────────────────
function ReminderToast({ onClose }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 2500);
    const t2 = setTimeout(() => onClose(), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onClose]);
  return (
    <div className="fixed bottom-6 left-6 z-50" dir="rtl"
      style={{ opacity: fading ? 0 : 1, transition: "opacity 0.5s ease" }}>
      <div className="bg-green-50 border border-green-400 rounded-xl shadow-xl p-4 flex items-start gap-3 max-w-xs">
        <div className="flex-1">
          <p className="text-sm text-green-800 font-semibold mb-0.5">תזכורת הופעלה ✓</p>
          <p className="text-xs text-green-700 leading-snug">תישלח למשתתפים תזכורת יום לפני קיום הפגישה.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="סגור התראה"
          className="text-green-500 hover:text-green-800 text-lg leading-none mt-0.5 transition-colors">×</button>
      </div>
    </div>
  );
}

// ─── Meetings: MeetingsTable ─────────────────────────────────────────────────
function MeetingsTable({ meetings, usersWithAccess, usersWithoutAccess, contacts, onSave, onDelete, onOpenNotes, onRequestAccess }) {
  const [sortField, setSortField] = useState(null); // null | "date" | "status" | "advisor" | "type"
  const [sortDir, setSortDir]   = useState("asc");
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [reminderToast, setReminderToast] = useState(false);

  function handleSort(field) {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortField(null); setSortDir("asc"); }
  }

  function getSortIcon(field) {
    if (sortField !== field) return <span className="text-slate-300 ml-0.5">⇅</span>;
    return sortDir === "asc"
      ? <span className="text-blue-500 ml-0.5">↑</span>
      : <span className="text-blue-500 ml-0.5">↓</span>;
  }

  const sortedMeetings = [...meetings].sort((a, b) => {
    if (!sortField) return 0;
    let va, vb;
    if (sortField === "date") {
      va = a.meeting_date || ""; vb = b.meeting_date || "";
    } else if (sortField === "status") {
      va = STATUS_SORT_ORDER[a.status] ?? 3;
      vb = STATUS_SORT_ORDER[b.status] ?? 3;
    } else if (sortField === "advisor") {
      const ap = a.advisor_profiles?.[0]; const bp = b.advisor_profiles?.[0];
      va = (ap?.full_name || ap?.email || "ת"); vb = (bp?.full_name || bp?.email || "ת");
    } else if (sortField === "type") {
      va = a.meeting_type || ""; vb = b.meeting_type || "";
    }
    const cmp = typeof va === "number" ? va - vb : va.localeCompare(vb, "he");
    return sortDir === "asc" ? cmp : -cmp;
  });

  const completedMeetings = meetings.filter(m => m.status === "completed");
  const totalMinutes = completedMeetings.reduce((sum, m) => {
    if (!m.start_time || !m.end_time) return sum;
    const [sh, sm] = m.start_time.split(":").map(Number);
    const [eh, em] = m.end_time.split(":").map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return sum + (diff > 0 ? diff : 0);
  }, 0);
  const totalHoursText = totalMinutes === 0
    ? "—"
    : (() => {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        if (h === 0) return `${m} דק'`;
        if (m === 0) return `${h} שעות`;
        return `${h}:${String(m).padStart(2, "0")} שעות`;
      })();

  function SortableHeader({ field, children }) {
    return (
      <button type="button" onClick={() => handleSort(field)}
        className="flex items-center gap-0.5 text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors cursor-pointer">
        {children}{getSortIcon(field)}
      </button>
    );
  }

  return (
    <>
      {reminderToast && <ReminderToast onClose={() => setReminderToast(false)} />}
      {pendingDeleteId && (
        <DeleteMeetingModal
          onConfirm={() => { onDelete(pendingDeleteId); setPendingDeleteId(null); }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      <div className="glass-card rounded-2xl overflow-hidden border border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 240px)" }}>
        <div className="flex-1">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th scope="col" className="py-3 px-2 pr-3 text-xs font-semibold text-slate-500">
                  <SortableHeader field="date">תאריך</SortableHeader>
                </th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <SortableHeader field="status">סטטוס</SortableHeader>
                </th>
                <th scope="col" className="py-3 pr-2 pl-3 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "100px" }}>התחלה</th>
                <th scope="col" className="py-3 px-1 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "52px" }}>סיום</th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <SortableHeader field="advisor">יועץ מבצע</SortableHeader>
                </th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">משתתפים</th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <SortableHeader field="type">סוג</SortableHeader>
                </th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">הערות</th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <ReminderHeaderTooltip />
                </th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {sortedMeetings.map(m => (
                <MeetingRow key={m.id} meeting={m} onSave={onSave} onRequestDelete={setPendingDeleteId}
                  onOpenNotes={onOpenNotes}
                  usersWithAccess={usersWithAccess} usersWithoutAccess={usersWithoutAccess}
                  contacts={contacts} onRequestAccess={onRequestAccess}
                  onReminderOn={() => setReminderToast(true)} />
              ))}
            </tbody>
          </table>
        </div>
        {/* Summary footer */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 flex items-center gap-6 flex-shrink-0" dir="rtl">
          <span className="text-sm text-slate-500">
            סה"כ פגישות שבוצעו: <strong className="text-slate-800 font-semibold">{completedMeetings.length}</strong>
          </span>
          <span className="text-sm text-slate-500">
            סה"כ שעות שבוצעו: <strong className="text-slate-800 font-semibold">{totalHoursText}</strong>
          </span>
        </div>
      </div>
    </>
  );
}

// ─── Meetings: DatePicker ────────────────────────────────────────────────────
const HEBREW_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function DatePickerPopover({ value, onChange, onClose }) {
  const today = new Date();
  const initDate = value ? new Date(value) : today;
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const blanks = (firstDay === 0 ? 6 : firstDay - 1);
  const cells = [...Array(blanks).fill(null), ...Array(daysInMonth).fill(0).map((_, i) => i + 1)];

  function select(day) {
    const d = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(d);
    onClose();
  }

  const selected = value ? new Date(value) : null;

  return (
    <div ref={ref} className="absolute z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3" style={{ top: "calc(100% + 4px)", right: 0, minWidth: 260 }} dir="rtl">
      <div className="flex items-center justify-between mb-2 gap-1">
        <button type="button" onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 text-xs font-bold">→</button>
        <span className="text-sm font-semibold text-slate-700">{HEBREW_MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }}
          className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 text-xs font-bold">←</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-slate-400 mb-1">
        {["ב","ג","ד","ה","ו","ש","א"].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <span key={`b${i}`} />;
          const isSelected = selected && selected.getDate() === day && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
          const isToday = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
          return (
            <button key={day} type="button" onClick={() => select(day)}
              className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors mx-auto
                ${isSelected ? "bg-blue-600 text-white" : isToday ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100 text-slate-700"}`}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Meetings: NotesModal ────────────────────────────────────────────────────
function NotesModal({ notes, onSave, onClose, users }) {
  const [val, setVal] = useState(notes || "");
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionStart, setMentionStart] = useState(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);
  const overlayRef = useRef(null);
  const mentionListRef = useRef(null);
  const { ref, handleKeyDown } = useFocusTrap(onClose);

  // Shared typography — must be identical between overlay div and textarea
  const editorStyle = {
    fontFamily: "inherit",
    fontSize: "0.875rem",
    lineHeight: "1.5",
    padding: "0.75rem 1rem",
    textAlign: "right",
    direction: "rtl",
    boxSizing: "border-box",
  };

  function handleChange(e) {
    const newVal = e.target.value;
    setVal(newVal);
    const cursor = e.target.selectionStart;
    const textBefore = newVal.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx !== -1) {
      const afterAt = textBefore.slice(atIdx + 1);
      const query = afterAt.toLowerCase();
      // Allow multi-word names: trigger if query is a prefix of any user name
      const hasMatch = query === "" || (users || []).some(u =>
        (u.full_name || u.email || "").toLowerCase().startsWith(query)
      );
      if (hasMatch) {
        setMentionQuery(query);
        setMentionStart(atIdx);
        return;
      }
    }
    setMentionQuery(null);
    setMentionStart(null);
  }

  function selectMention(user) {
    const cursor = textareaRef.current?.selectionStart ?? val.length;
    const mention = `@${user.full_name || user.email}`;
    const newVal = val.slice(0, mentionStart) + mention + " " + val.slice(cursor);
    setVal(newVal);
    setMentionQuery(null);
    setMentionStart(null);
    setTimeout(() => {
      const pos = mentionStart + mention.length + 1;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  }

  function extractMentionedIds(text) {
    const ids = [];
    for (const u of (users || [])) {
      const name = u.full_name || u.email || "";
      if (name && text.includes(`@${name}`)) ids.push(u.id);
    }
    return [...new Set(ids)];
  }

  function renderHighlightedText(text) {
    const allNames = (users || [])
      .map(u => u.full_name || u.email || "")
      .filter(Boolean)
      .sort((a, b) => b.length - a.length); // longest first → greedy match
    if (!allNames.length) return <span>{text}</span>;
    const escaped = allNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`@(${escaped.join("|")})`, "g");
    const parts = [];
    let lastIdx = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx, match.index)}</span>);
      parts.push(<span key={`m-${match.index}`} style={{ color: "#2563eb", fontWeight: 600 }}>{match[0]}</span>);
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx)}</span>);
    return parts;
  }

  const filteredMentions = mentionQuery !== null
    ? (users || []).filter(u => (u.full_name || u.email || "").toLowerCase().startsWith(mentionQuery)).slice(0, 8)
    : [];

  // Reset highlighted index when dropdown list changes
  useEffect(() => { setMentionIdx(0); }, [filteredMentions.length, mentionQuery]);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = mentionListRef.current?.children[mentionIdx];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [mentionIdx]);

  function handleTextareaKeyDown(e) {
    if (filteredMentions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIdx(i => (i + 1) % filteredMentions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectMention(filteredMentions[mentionIdx]);
    } else if (e.key === "Escape") {
      e.stopPropagation(); // don't let this close the modal too
      setMentionQuery(null);
      setMentionStart(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="notes-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-lg flex flex-col gap-4">
        <h2 id="notes-modal-title" className="font-bold text-slate-900">הערות לפגישה</h2>
        <div className="relative">
          <label htmlFor="notes-textarea" className="sr-only">הערות</label>
          {/* Wrapper provides the visual border + focus ring */}
          <div style={{
            position: "relative",
            border: `1.5px solid ${focused ? "#0070F3" : "#e2e8f0"}`,
            borderRadius: "0.75rem",
            background: focused ? "white" : "rgba(255,255,255,0.8)",
            boxShadow: focused ? "0 0 0 3px rgba(0,112,243,0.12)" : "none",
            transition: "all 0.18s ease",
          }}>
            {/* Highlight overlay: renders @mentions in blue, sits behind the textarea */}
            <div ref={overlayRef} aria-hidden="true" style={{
              ...editorStyle,
              position: "absolute",
              inset: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-words",
              color: "#1e293b",
              overflow: "hidden",
              pointerEvents: "none",
              borderRadius: "0.75rem",
            }}>
              {val
                ? renderHighlightedText(val)
                : <span style={{ color: "#94a3b8" }}>הכנס הערות כאן... השתמש ב-@ לתיוג משתמש</span>}
            </div>
            {/* Textarea: transparent text so overlay shows through; caret stays visible */}
            <textarea
              ref={textareaRef}
              id="notes-textarea"
              rows={6}
              style={{
                ...editorStyle,
                display: "block",
                width: "100%",
                border: 0,
                outline: "none",
                resize: "none",
                background: "transparent",
                color: "transparent",
                caretColor: "#1e293b",
                borderRadius: "0.75rem",
              }}
              value={val}
              onChange={handleChange}
              onKeyDown={handleTextareaKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onScroll={e => { if (overlayRef.current) overlayRef.current.scrollTop = e.target.scrollTop; }}
              placeholder=""
            />
          </div>
          {filteredMentions.length > 0 && (
            <div ref={mentionListRef}
              className="absolute bottom-full mb-1 right-0 left-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50 max-h-44 overflow-y-auto" role="listbox">
              {filteredMentions.map((u, i) => (
                <button key={u.id} type="button" role="option"
                  aria-selected={i === mentionIdx}
                  onMouseDown={e => { e.preventDefault(); selectMention(u); }}
                  onMouseEnter={() => setMentionIdx(i)}
                  className={`w-full text-right px-3 py-2 text-sm text-slate-700 flex items-center gap-2 ${i === mentionIdx ? "bg-blue-50" : "hover:bg-blue-50"}`}>
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center flex-shrink-0" aria-hidden="true">
                    {(u.full_name || u.email || "?")[0].toUpperCase()}
                  </span>
                  {u.full_name || u.email}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">ביטול</button>
          <button type="button" onClick={() => { onSave(val, extractMentionedIds(val)); }}
            className="btn-blue text-sm px-4 py-2">שמור הערות</button>
        </div>
      </div>
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

// ─── Meetings: TimeInput ─────────────────────────────────────────────────────
function TimeInput({ id, value, onChange, ariaLabel }) {
  function handleChange(e) {
    const filtered = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);
    onChange(filtered);
  }
  function handleBlur() {
    if (!value) return;
    const digits = value.replace(/\D/g, "");
    if (!digits) { onChange(""); return; }
    let hh, mm;
    if (digits.length <= 2) { hh = digits.padStart(2, "0"); mm = "00"; }
    else if (digits.length === 3) { hh = "0" + digits[0]; mm = digits.slice(1); }
    else { hh = digits.slice(0, 2); mm = digits.slice(2, 4); }
    if (parseInt(hh) > 23) hh = "23";
    if (parseInt(mm) > 59) mm = "59";
    onChange(`${hh}:${mm}`);
  }
  return (
    <input id={id} type="text" inputMode="numeric" maxLength={5}
      className="w-full bg-transparent border-0 outline-none text-sm text-right text-slate-700 hover:bg-slate-100 hover:rounded focus:bg-white focus:ring-1 focus:ring-blue-300 focus:rounded py-0.5 px-0 focus:px-1 transition-all"
      placeholder=""
      value={value} onChange={handleChange} onBlur={handleBlur}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      aria-label={ariaLabel} autoComplete="off" dir="ltr" />
  );
}

// ─── Meetings: ParticipantsSelector ─────────────────────────────────────────
function ParticipantsSelector({ contacts, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function toggle(c) {
    const exists = selected.some(s => s.key === c.key);
    onChange(exists ? selected.filter(s => s.key !== c.key) : [...selected, c]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="w-full text-sm cursor-pointer px-1.5 py-0.5 rounded hover:ring-1 hover:ring-slate-300 min-h-[24px] transition-all"
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0
          ? <span className="text-slate-400 text-lg font-light leading-none">+</span>
          : <span className="text-slate-700">{selected.map(s => s.name).join(", ")}</span>
        }
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[210px] max-h-60 overflow-y-auto">
          {/* "בחר" header — clears all selection */}
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onChange([]); }}
            className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">
            בחר
          </button>
          {contacts.length === 0
            ? <div className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100">אין אנשי קשר מוגדרים</div>
            : contacts.map(c => (
              <button key={c.key} type="button"
                className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); toggle(c); }}>
                <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => s.key === c.key) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                <span className="text-slate-700">{c.name}</span>
                <span className="text-slate-400 text-xs mr-auto">{c.label}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}

function AdvisorSearch({ schoolId, assigned, users, loadingUsers, onAdd, onRemove, onRetry }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const filtered = sortByRole(users).filter(u =>
    !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <label htmlFor={`advisor-search-${schoolId}`} className="sr-only">חיפוש יועץ</label>
      <div
        className="input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-text"
        onClick={() => document.getElementById(`advisor-search-${schoolId}`)?.focus()}
      >
        {assigned.map(adv => (
          <span key={adv.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
            {adv.full_name || adv.email}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onRemove(adv.id); }}
              className="hover:text-red-500 transition-colors leading-none text-base"
              aria-label={`הסר ${adv.full_name || adv.email}`}
            >×</button>
          </span>
        ))}
        <input
          id={`advisor-search-${schoolId}`}
          type="text"
          className="flex-1 min-w-[100px] text-sm outline-none bg-transparent border-none p-0"
          placeholder={loadingUsers ? "טוען..." : assigned.length === 0 ? "לחץ לפתיחת רשימה, או הקלד שם לסינון..." : "הוסף יועץ..."}
          disabled={loadingUsers}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="absolute z-20 right-0 left-0 mt-1 border border-slate-200 rounded-xl overflow-hidden bg-white max-h-52 overflow-y-auto shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">
              {query.trim() ? "לא נמצאו יועצים" : users.length === 0 ? (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); if (onRetry) onRetry(); }}
                  className="text-blue-500 hover:text-blue-700 underline"
                >טעינה נכשלה — לחץ לניסיון חוזר</button>
              ) : "לא נמצאו יועצים"}
            </div>
          ) : filtered.map(u => (
            <button
              key={u.id}
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                onAdd(u.id);
                setQuery("");
              }}
              className="w-full text-right px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 transition-colors flex items-center justify-between"
            >
              <span>{u.full_name || u.email}</span>
              <span className="text-xs text-slate-400">{ROLE_LABELS[u.role]}</span>
            </button>
          ))}
        </div>
      )}
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

  const [school, setSchool] = useState(location.state?.school || null);
  const [accounts, setAccounts] = useState(location.state?.school?.gefen_accounts || []);
  const [logs, setLogs] = useState([]);
  const [logsError, setLogsError] = useState("");
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
      const { data: { session } } = await supabase.auth.getSession();
      const userRole = session?.user.user_metadata?.role || "advisor";
      if (session) setRole(userRole);

      try {
        const meRes = await axios.get("/schools/users/me");
        if (meRes.data?.org?.subscription_status) {
          setSubscriptionStatus(meRes.data.org.subscription_status);
        }
        if (meRes.data?.role) setRole(meRes.data.role);
      } catch {
        // non-fatal
      }

      const [accountsResult, logsResult] = await Promise.allSettled([
        axios.get(`/schools/${schoolId}/accounts`),
        axios.get(`/schools/${schoolId}/logs`),
      ]);

      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value.data || []);

      if (logsResult.status === "fulfilled") {
        setLogs(logsResult.value.data || []);
      } else {
        try {
          await new Promise(r => setTimeout(r, 400));
          const res = await axios.get(`/schools/${schoolId}/logs`);
          setLogs(res.data || []);
        } catch {
          setLogsError("שגיאה בטעינת ההיסטוריה");
        }
      }
      setLoading(false);

      // Defer user list after critical data renders — avoids competing with accounts/logs on mount
      if (userRole === "owner" || userRole === "manager") {
        loadUsers();
      }
    }
    load();
  }, [schoolId]);

  async function loadMeetings() {
    setMeetingsLoading(true);
    setMeetingsError("");
    try {
      const res = await axios.get(`/schools/${schoolId}/meetings`);
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
  }, [activeTab, schoolId, role]);

  async function startNewMeeting() {
    const defaultAdvisor = schoolAdvisors[0] || null;
    const payload = {
      status: "scheduled",
      meeting_type: "remote",
      advisor_ids: defaultAdvisor ? [defaultAdvisor.id] : [],
      participants: [],
      reminder_enabled: false,
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

  async function updateMeeting(draft) {
    if (!draft?.id) return;
    // Optimistic update: reflect changes immediately so summary row recalculates
    setMeetings(prev => prev.map(m => m.id === draft.id ? { ...m, ...draft } : m));
    const payload = {
      meeting_date: draft.meeting_date || null,
      status: draft.status || "scheduled",
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
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

  function startEdit() {
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
    axios.get(`/schools/${schoolId}/advisors`).then(res => setSchoolAdvisors(res.data || [])).catch(() => {});
    loadUsers();
    setIsEditing(true);
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
    try {
      const res = await axios.get(`/schools/${schoolId}/logs`);
      setLogs(res.data || []);
      setLogsError("");
    } catch {
      setLogsError("שגיאה בטעינת ההיסטוריה");
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

      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className={`mx-auto px-6 py-10 ${activeTab === "checks" ? "max-w-6xl" : "max-w-4xl"}`}>

          {/* Page header */}
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-slate-900">{school?.name || "בית ספר"}</h1>
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
            {/* Division tabs — shown on far left when checks tab is active for שש-שנתי schools */}
            {activeTab === "checks" && school?.stage === "sheshshnati" && (
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
                      <div className="flex items-center gap-2">
                        <button onClick={saveEdit} disabled={saving} className="btn-blue text-sm px-5 py-2">
                          {saving ? "שומר..." : "שמור שינויים"}
                        </button>
                        <button onClick={() => { setIsEditing(false); setOriginalForm(null); setSaveError(""); setAccessLinkedToAdvisors(false); }} className="btn-ghost text-sm px-5 py-2">ביטול</button>
                      </div>
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

                  {/* ליווי */}
                  <div className="mt-6 pt-5 border-t border-slate-100">
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
                  </div>
                </div>

                ) : (
                /* ─── DISPLAY MODE ─── */
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-slate-700">פרטי מוסד</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(role === "owner" || role === "manager") && (
                        <button onClick={startEdit} className="btn-ghost text-sm px-4 py-2">✏️ ערוך פרטים</button>
                      )}
                      {role === "advisor" && (
                        <button onClick={startRequest} className="btn-ghost text-sm px-4 py-2">📝 בקש עדכון פרטים</button>
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
                          ) : (school?.restrict_access_to || []).filter(id => {
                            const u = users.find(u => u.id === id);
                            return !u || u.role !== "owner";
                          }).map(id => {
                            const u = users.find(u => u.id === id);
                            return (
                              <span key={id} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
                                {u ? (u.full_name || u.email) : id.slice(0, 8) + "..."}
                              </span>
                            );
                          })}
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

              {/* Advisor update request form */}
              {isRequesting && (
                <div className="glass-card rounded-2xl p-6 mb-6">
                  <h2 className="font-bold text-slate-800 mb-4">בקשת עדכון פרטי בית הספר</h2>
                  <p className="text-xs text-slate-400 mb-4">מלא רק את השדות שברצונך לעדכן. הבקשה תועבר לאישור הבעלים/מנהל.</p>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { id: "req-name", field: "name", label: "שם בית ספר" },
                      { id: "req-city", field: "city", label: "עיר" },
                      { id: "req-authority", field: "authority", label: "בעלות" },
                      { id: "req-principal-name", field: "principal_name", label: "שם מנהל/ת" },
                      { id: "req-principal-phone", field: "principal_phone", label: "טלפון מנהל/ת", dir: "ltr" },
                      { id: "req-school-phone", field: "school_phone", label: "טלפון בית הספר", dir: "ltr" },
                    ].map(({ id, field, label, dir }) => (
                      <div key={field} className="flex flex-col gap-1.5">
                        <label htmlFor={id} className="text-xs text-slate-800">{label}</label>
                        <input id={id} className="input-field" value={requestForm[field] || ""}
                          onChange={e => setRequestForm(p => ({ ...p, [field]: e.target.value }))}
                          dir={dir} />
                      </div>
                    ))}
                    <div className="flex flex-col gap-1.5 col-span-2">
                      <label htmlFor="req-notes" className="text-xs text-slate-800">הערות</label>
                      <input id="req-notes" className="input-field" value={requestForm.notes || ""}
                        onChange={e => setRequestForm(p => ({ ...p, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-5">
                    <button onClick={submitRequest} disabled={requestSubmitting} className="btn-blue text-sm px-5 py-2">
                      {requestSubmitting ? "שולח..." : "שלח לאישור"}
                    </button>
                    <button onClick={() => setIsRequesting(false)} className="btn-ghost text-sm px-5 py-2">ביטול</button>
                  </div>
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
                <MeetingsTable
                  meetings={meetings}
                  usersWithAccess={users.filter(u => u.role !== "owner" && advisorHasAccess(u.id))}
                  usersWithoutAccess={users.filter(u => u.role !== "owner" && !advisorHasAccess(u.id))}
                  contacts={getSchoolContacts()}
                  onSave={updateMeeting}
                  onDelete={deleteMeeting}
                  onOpenNotes={(meetingId, notes, onSave) => setNotesModal({ meetingId, notes, onSave })}
                  onRequestAccess={requestAdvisorAccess}
                />
              )}
            </div>
          )}

          {/* ─── TAB: יעדים ─── */}
          {activeTab === "goals" && (
            <div className="glass-card rounded-2xl p-12 text-center">
              <p className="text-4xl mb-3">🎯</p>
              <p className="font-semibold text-slate-700 mb-1">יעדים</p>
              <p className="text-slate-400 text-sm">תכונה זו תהיה זמינה בקרוב</p>
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
              onReloadLogs={reloadLogs}
              activeSubTab={activeSubTab}
              setActiveSubTab={setActiveSubTab}
            />
          )}
        </div>
      </div>
    </div>
  );
}
