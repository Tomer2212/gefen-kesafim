import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";
import FileUpload from "../components/FileUpload";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useGefenOrganizedResults } from "../context/GefenOrganizedResultsContext";

const COLLECTION_COLUMNS = [
  { key: "gefen_organized",          label: "גפן מסודר" },
  { key: "gefen_hours_reported",     label: "שעות גפן מדווחות" },
  { key: "order_amount_gefen",       label: 'מחיר כולל מע"מ' },
  { key: "amount_paid",              label: "סכום ששולם" },
  { key: "remaining_to_pay",         label: "נותר לתשלום" },
  { key: "payment_method",           label: "דרך תשלום" },
  { key: "invoice_transaction_status", label: "חשבונית עסקה" },
  { key: "invoice_number",           label: "מס' חשבונית עסקה" },
  { key: "deposit_date",             label: "תאריך הפקדה" },
];

const CLIENT_STATUS_OPTIONS = [
  { value: "active",      label: "פעיל" },
  { value: "inactive",    label: "לא פעיל" },
  { value: "in_progress", label: "בתהליך" },
  { value: "former",      label: "לקוח עבר" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "arrived_source",   label: "הגיע מקור" },
  { value: "photo",            label: "צילום" },
  { value: "bank_transfer",    label: "העברה בנקאית" },
  { value: "bounced_check",    label: "שיק חזר" },
  { value: "bounced_check_leumi", label: "שיק חזר-לאומי" },
];

const INVOICE_TRANSACTION_STATUS_OPTIONS = [
  { value: "invoice_sent",      label: "נשלחה חשבונית" },
  { value: "no_payment_needed", label: "אין צורך בתשלום" },
  { value: "dani_private",      label: "פרטי דני" },
  { value: "dani_in_progress",  label: "בטיפול דני" },
  { value: "split_invoice",     label: "חשבונית עסקה מפוצלת" },
];

const ADMIN_FIELD_CLS = "text-sm text-slate-700 border rounded-md px-2 py-0.5 bg-transparent border-slate-300 focus:outline-none focus:ring-1 focus:border-blue-400 focus:ring-blue-100";

// Thousands-separated (no decimal) display for amount fields — "" for empty.
function formatAmount(v) {
  return v === null || v === undefined || v === "" ? "" : Math.round(Number(v)).toLocaleString("he-IL");
}

function parseAmount(raw) {
  const stripped = String(raw).replace(/,/g, "").trim();
  return stripped === "" ? null : Number(stripped);
}

// Column-filter/sort type per column — only columns backed by real data get a sort/filter
// icon (mirrors AdminPage's getAdminColumnFilterType: no entry here means no icon rendered).
const COLLECTION_FILTER_TYPES = {
  gefen_organized: "select",
  order_amount_gefen: "number",
  amount_paid: "number",
  remaining_to_pay: "number",
  payment_method: "select",
  invoice_transaction_status: "select",
  invoice_number: "text",
  deposit_date: "date",
};

const GEFEN_ORGANIZED_STATUS_OPTIONS = [
  { value: "matched",      label: "התאמה מלאה" },
  { value: "mismatch",     label: "אין התאמה" },
  { value: "not_checked",  label: "טרם נבדק" },
  { value: "not_relevant", label: "לא רלוונטי" },
];

const COLLECTION_SELECT_FILTER_OPTIONS = {
  gefen_organized: GEFEN_ORGANIZED_STATUS_OPTIONS,
  payment_method: PAYMENT_METHOD_OPTIONS,
  invoice_transaction_status: INVOICE_TRANSACTION_STATUS_OPTIONS,
};

const NUMBER_FILTER_OPS = [
  { value: "eq",  label: "שווה ל" },
  { value: "ne",  label: "שונה מ" },
  { value: "gt",  label: "גדול מ" },
  { value: "gte", label: "גדול או שווה ל" },
  { value: "lt",  label: "קטן מ" },
  { value: "lte", label: "קטן או שווה ל" },
];

const GEFEN_ORGANIZED_SORT_RANK = { mismatch: 0, matched: 1, not_checked: 2, not_relevant: 3 };

// Returns a sortable value per column — numbers/labels for display columns, and for the
// multi-value columns (invoice_number/deposit_date) a single representative value (earliest
// deposit date / smallest invoice number) since a school can have several of each.
function getCollectionSortValue(yad, key) {
  switch (key) {
    case "gefen_organized":
      return GEFEN_ORGANIZED_SORT_RANK[getGefenOrganizedStatus(yad)];
    case "order_amount_gefen":
      return yad.order_amount_gefen ?? null;
    case "amount_paid":
      return yad.amount_paid ?? null;
    case "remaining_to_pay":
      return yad.order_amount_gefen == null ? null : (yad.order_amount_gefen ?? 0) - (yad.amount_paid ?? 0);
    case "payment_method":
      return PAYMENT_METHOD_OPTIONS.find(o => o.value === yad.payment_method)?.label || "";
    case "invoice_transaction_status":
      return INVOICE_TRANSACTION_STATUS_OPTIONS.find(o => o.value === yad.invoice_transaction_status)?.label || "";
    case "invoice_number": {
      const nums = (yad.invoice_numbers || []).map(Number).filter(n => !Number.isNaN(n));
      return nums.length ? Math.min(...nums) : null;
    }
    case "deposit_date": {
      const dates = yad.deposit_dates || [];
      return dates.length ? dates.reduce((min, d) => (d < min ? d : min)) : null;
    }
    default:
      return null;
  }
}

function getCollectionRawFilterValue(yad, key) {
  if (key === "gefen_organized") return getGefenOrganizedStatus(yad);
  if (key === "payment_method") return yad.payment_method || null;
  if (key === "invoice_transaction_status") return yad.invoice_transaction_status || null;
  return null;
}

function passesCollectionColumnFilters(yad, filters) {
  for (const [key, spec] of Object.entries(filters)) {
    if (!spec) continue;
    const type = COLLECTION_FILTER_TYPES[key];
    if (type === "text") {
      const needle = (spec.value || "").trim();
      if (!needle) continue;
      const values = yad.invoice_numbers || [];
      const matches = spec.op === "equals" ? values.includes(needle) : values.some(v => v.includes(needle));
      if (!matches) return false;
    } else if (type === "number") {
      if (spec.value === "" || spec.value === null || spec.value === undefined) continue;
      const cellValue = Number(getCollectionSortValue(yad, key));
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
      if (!spec.values.includes(getCollectionRawFilterValue(yad, key))) return false;
    } else if (type === "date") {
      if (!spec.from && !spec.to) continue;
      const dates = yad.deposit_dates || [];
      const matchesAny = dates.some(d => (!spec.from || d >= spec.from) && (!spec.to || d <= spec.to));
      if (!matchesAny) return false;
    }
  }
  return true;
}

function isCollectionFilterActive(spec) {
  if (!spec) return false;
  return !!(spec.value || (spec.values && spec.values.length > 0) || spec.from || spec.to);
}

function CollectionColumnFilterPopover({ colKey, colLabel, filterType, spec, options, onChange, onClear, onClose }) {
  if (filterType === "text") {
    const value = spec?.value || "";
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={`collection-filter-${colKey}`} className="text-xs text-slate-500">סינון: {colLabel}</label>
        <input
          id={`collection-filter-${colKey}`}
          type="text"
          autoComplete="off"
          className="input-field text-sm"
          placeholder="לדוגמה: 12345"
          value={value}
          onChange={e => onChange({ op: "contains", value: e.target.value })}
        />
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
        <label htmlFor={`collection-filter-op-${colKey}`} className="text-xs text-slate-500">סינון: {colLabel}</label>
        <select
          id={`collection-filter-op-${colKey}`}
          className="input-field text-sm"
          value={op}
          onChange={e => onChange({ op: e.target.value, value })}
        >
          {NUMBER_FILTER_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label htmlFor={`collection-filter-val-${colKey}`} className="sr-only">ערך</label>
        <input
          id={`collection-filter-val-${colKey}`}
          type="number"
          className="input-field text-sm"
          value={value}
          onChange={e => onChange({ op, value: e.target.value })}
        />
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => { onClear(); onClose(); }} className="text-xs text-slate-400 hover:text-slate-600">נקה</button>
          <button type="button" onClick={onClose} className="btn-blue text-xs px-3 py-1">סגור</button>
        </div>
      </div>
    );
  }
  if (filterType === "select") {
    const values = spec?.values || [];
    function toggleValue(v) {
      const next = values.includes(v) ? values.filter(x => x !== v) : [...values, v];
      onChange({ op: "in", values: next });
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">סינון: {colLabel}</p>
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {(options || []).map(o => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-blue-600"
                checked={values.includes(o.value)}
                onChange={() => toggleValue(o.value)}
              />
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
  if (filterType === "date") {
    const from = spec?.from || "";
    const to = spec?.to || "";
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-500">סינון: {colLabel}</p>
        <label htmlFor={`collection-filter-from-${colKey}`} className="text-xs text-slate-500">מתאריך</label>
        <input
          id={`collection-filter-from-${colKey}`}
          type="date"
          className="input-field text-sm"
          value={from}
          onChange={e => onChange({ from: e.target.value, to })}
        />
        <label htmlFor={`collection-filter-to-${colKey}`} className="text-xs text-slate-500">עד תאריך</label>
        <input
          id={`collection-filter-to-${colKey}`}
          type="date"
          className="input-field text-sm"
          value={to}
          onChange={e => onChange({ from, to: e.target.value })}
        />
        <div className="flex justify-between gap-2">
          <button type="button" onClick={() => { onClear(); onClose(); }} className="text-xs text-slate-400 hover:text-slate-600">נקה</button>
          <button type="button" onClick={onClose} className="btn-blue text-xs px-3 py-1">סגור</button>
        </div>
      </div>
    );
  }
  return null;
}

const FILTER_POPOVER_WIDTH = 224; // w-56

// Rendered via a portal into <body> with `position: fixed`, positioned from the anchor
// button's bounding rect — a plain `position: absolute` popover gets clipped by the table's
// scroll container (`overflow-auto`) and can render behind the sticky header/frozen column.
// For anchors near the left edge of the viewport (the leftmost columns), the popover opens
// to the button's right instead of hanging left off-screen.
function CollectionFilterButton({ col, filterType, isFiltered, isOpen, onToggle, onClose, spec, options, onChange, onClear }) {
  const anchorRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) { setPos(null); return; }
    const rect = anchorRef.current.getBoundingClientRect();
    let left = rect.right - FILTER_POPOVER_WIDTH;
    if (left < 8) left = rect.left;
    left = Math.min(Math.max(left, 8), window.innerWidth - FILTER_POPOVER_WIDTH - 8);
    setPos({ top: rect.bottom + 4, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e) {
      if (anchorRef.current?.contains(e.target)) return;
      if (e.target.closest?.("[data-collection-filter-popover]")) return;
      onClose();
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = () => onClose();
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [isOpen, onClose]);

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={onToggle}
        className={`p-0.5 rounded hover:bg-slate-200 ${isFiltered ? "text-blue-600" : "text-slate-400"}`}
        aria-label={`סינון לפי ${col.label}`}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
        </svg>
      </button>
      {isOpen && pos && createPortal(
        <div
          data-collection-filter-popover
          className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-lg p-3 w-56 font-normal normal-case"
          style={{ top: pos.top, left: pos.left }}
          dir="rtl"
        >
          <CollectionColumnFilterPopover
            colKey={col.key}
            colLabel={col.label}
            filterType={filterType}
            spec={spec}
            options={options}
            onChange={onChange}
            onClear={onClear}
            onClose={onClose}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

function isGefenOrganizedRelevant(yad) {
  return yad.client_status === "active" && (yad.order_method || []).includes("private");
}

// "not_relevant" | "not_checked" | "matched" | "mismatch"
function getGefenOrganizedStatus(yad) {
  if (!isGefenOrganizedRelevant(yad)) return "not_relevant";
  if (yad.gefen_organized_matched === null || yad.gefen_organized_matched === undefined) return "not_checked";
  return yad.gefen_organized_matched ? "matched" : "mismatch";
}

function GefenOrganizedCell({ yad }) {
  const status = getGefenOrganizedStatus(yad);
  if (status === "not_relevant") return <span className="text-slate-400 text-xs">לא רלוונטי</span>;
  if (status === "not_checked") return <span className="text-slate-400 text-xs">טרם נבדק</span>;
  if (status === "matched") {
    return (
      <span className="text-green-600 font-bold text-sm select-none" title="התאמה מלאה" aria-label="התאמה מלאה">
        ✓
      </span>
    );
  }
  return (
    <span className="text-red-500 font-bold text-sm select-none" title="אין התאמה" aria-label="אין התאמה">
      ✕
    </span>
  );
}

function InvoiceNumbersCell({ savedValues, onSave }) {
  const [values, setValues] = useState(savedValues);

  function addField() {
    setValues(prev => [...prev, ""]);
  }

  function removeField(i) {
    const next = values.filter((_, idx) => idx !== i);
    setValues(next);
    onSave(next.filter(v => v !== ""));
  }

  function changeField(i, raw) {
    const digitsOnly = raw.replace(/\D/g, "");
    setValues(prev => prev.map((v, idx) => (idx === i ? digitsOnly : v)));
  }

  function blurField() {
    onSave(values.filter(v => v !== ""));
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={v}
            onChange={e => changeField(i, e.target.value)}
            onBlur={blurField}
            aria-label="מס' חשבונית עסקה"
            className={`${ADMIN_FIELD_CLS} w-24`}
          />
          <button
            type="button"
            onClick={() => removeField(i)}
            aria-label="הסר מספר חשבונית עסקה"
            className="text-slate-300 hover:text-red-500 transition-colors text-xs leading-none"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addField}
        aria-label="הוסף מספר חשבונית עסקה"
        className="w-6 h-6 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 text-sm font-bold hover:bg-blue-100 transition-colors flex-shrink-0"
      >
        +
      </button>
    </div>
  );
}

function formatDDMMYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

// A 2-digit year typed into the native date picker's year segment (e.g. "89") lands as
// "0089", zero-padded rather than century-assumed. Deposit dates are never actually from
// year 1-99, so any committed year under 100 unambiguously means a short year was typed —
// reinterpret it as 20YY. A full 4-digit year (e.g. "2025") is left untouched.
function normalizeYear(iso) {
  if (!iso) return iso;
  const [y, m, d] = iso.split("-");
  const yearNum = parseInt(y, 10);
  return yearNum < 100 ? `${2000 + yearNum}-${m}-${d}` : iso;
}

function DepositDatesCell({ savedValues, onSave }) {
  const [values, setValues] = useState(savedValues);
  const [editingIndex, setEditingIndex] = useState(null);

  function addField() {
    const newIndex = values.length;
    setValues(prev => [...prev, ""]);
    setEditingIndex(newIndex);
  }

  function removeField(i) {
    const next = values.filter((_, idx) => idx !== i);
    setValues(next);
    setEditingIndex(null);
    onSave(next.filter(v => v !== ""));
  }

  // Only updates the in-progress value — must NOT commit/exit edit mode here.
  // Native date inputs fire onChange on every keystroke (e.g. typing "2" then "5" into
  // the year segment fires onChange after the "2" with a zero-padded year like "0002"),
  // so committing on every change would lock in that intermediate value before the user
  // finishes typing. Committing happens only on blur, once the user is done.
  function changeField(i, raw) {
    setValues(prev => prev.map((v, idx) => (idx === i ? raw : v)));
  }

  function blurField(i) {
    setEditingIndex(null);
    if (values[i] === "") {
      setValues(prev => prev.filter((_, idx) => idx !== i));
      return;
    }
    const normalized = values.map((v, idx) => (idx === i ? normalizeYear(v) : v));
    setValues(normalized);
    onSave(normalized.filter(v => v !== ""));
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          {editingIndex === i ? (
            <input
              type="date"
              autoFocus
              value={v}
              onChange={e => changeField(i, e.target.value)}
              onBlur={() => blurField(i)}
              aria-label="תאריך הפקדה"
              className={`${ADMIN_FIELD_CLS} w-32`}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingIndex(i)}
              className="text-sm text-slate-700 hover:text-blue-600 underline decoration-dotted underline-offset-2"
            >
              {formatDDMMYY(v)}
            </button>
          )}
          <button
            type="button"
            onClick={() => removeField(i)}
            aria-label="הסר תאריך הפקדה"
            className="text-slate-300 hover:text-red-500 transition-colors text-xs leading-none"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addField}
        aria-label="הוסף תאריך הפקדה"
        className="w-6 h-6 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 text-sm font-bold hover:bg-blue-100 transition-colors flex-shrink-0"
      >
        +
      </button>
    </div>
  );
}

function ColumnPickerButton({ colVisible, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn-ghost text-xs px-3 py-1.5"
        aria-haspopup="true"
        aria-expanded={open}
      >
        עמודות לתצוגה
      </button>
      {open && (
        <div
          className="absolute z-30 top-full mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-2 w-64 max-h-96 overflow-y-auto"
          dir="rtl"
        >
          <div className="px-3 py-1">
            {COLLECTION_COLUMNS.map(col => (
              <label key={col.key} className="flex items-center gap-2 py-1 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!colVisible[col.key]}
                  onChange={() => onToggle(col.key)}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ALL_STATUS_OPTION = { value: "__all__", label: "כולם" };

function ClientStatusFilter({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) setDraft(selected);
  }, [selected, open]);

  function openDropdown() { setDraft(selected); setOpen(true); }
  function confirm() { onChange(draft); setOpen(false); }
  function clear() { setDraft([]); }

  function toggleItem(opt) {
    setDraft(prev =>
      prev.some(s => s.value === opt.value)
        ? prev.filter(s => s.value !== opt.value)
        : [...prev, opt]
    );
  }

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="input-field text-sm text-right"
        style={{ minWidth: 160 }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected.length > 0 ? (
          <span className="text-slate-700">סטטוס לקוח: {selected.length} נבחרו</span>
        ) : (
          <span className="text-slate-300 select-none">סטטוס לקוח: הכל</span>
        )}
      </button>
      {open && (
        <div
          className="absolute z-40 right-0 top-full mt-1 border border-slate-200 rounded-xl bg-white shadow-xl"
          style={{ minWidth: 180 }}
          dir="rtl"
        >
          <div className="overflow-y-auto" style={{ maxHeight: 180 }} role="listbox" aria-multiselectable="true">
            {[ALL_STATUS_OPTION, ...CLIENT_STATUS_OPTIONS].map(opt => (
              <label key={opt.value} className="flex items-center gap-2.5 px-4 py-2 hover:bg-blue-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={opt.value === "__all__" ? draft.length === 0 : draft.some(s => s.value === opt.value)}
                  onChange={() => (opt.value === "__all__" ? setDraft([]) : toggleItem(opt))}
                  className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                />
                <span className="text-sm text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
          <div className="p-2 border-t border-slate-100 flex items-center gap-2">
            <button type="button" onClick={confirm} className="btn-blue text-xs px-4 py-1.5 rounded-lg">
              אישור
            </button>
            <button type="button" onClick={clear} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">
              נקה סינון
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildMismatchDisplayRows(mismatchedSchools, yearAdminData) {
  return mismatchedSchools.map(s => {
    const yad = yearAdminData[s.id] || {};
    const orderAmount = yad.order_amount_gefen ?? 0;
    const checkedAmount = yad.gefen_organized_checked_amount ?? 0;
    return {
      "שם מוסד": s.name,
      "סמל מוסד": s.symbol,
      "בעלות": s.authority,
      'מחיר כולל מע"מ': orderAmount,
      "גובה הזמנה בפועל": checkedAmount,
      "פער": checkedAmount - orderAmount,
    };
  });
}

function buildMismatchExportRows(mismatchedSchools, yearAdminData) {
  return mismatchedSchools.map(s => {
    const yad = yearAdminData[s.id] || {};
    return {
      name: s.name,
      authority: s.authority,
      symbol: s.symbol,
      order_amount: yad.order_amount_gefen ?? 0,
      checked_amount: yad.gefen_organized_checked_amount ?? 0,
    };
  });
}

function GefenOrganizedUploadModal({ academicYear, onClose, onUploaded }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      const res = await axios.post("/schools/collection/gefen-organized-check", formData, {
        params: { academic_year: academicYear },
      });
      onUploaded(res.data || {});
    } catch (e) {
      setError(e.response?.data?.detail || "שגיאה בעיבוד הקובץ — נסה שוב");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gefen-organized-modal-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"
      >
        <h2 id="gefen-organized-modal-title" className="text-lg font-bold text-slate-900 mb-1">
          בדיקה חדשה
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          העלה קובץ גפן ספקים לבדיקת "גפן מסודר"
        </p>

        <FileUpload files={files} onChange={setFiles} />

        {error && (
          <p role="alert" className="text-sm text-red-500 mt-3">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2" disabled={uploading}>
            ביטול
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={files.length === 0 || uploading}
            className="btn-blue text-sm px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {uploading ? "בודק..." : "בדוק"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCollectionTab() {
  const [schools, setSchools] = useState([]);
  const [yearAdminData, setYearAdminData] = useState({});
  const [loading, setLoading] = useState(true);
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);
  const [colVisible, setColVisible] = useState(() =>
    Object.fromEntries(COLLECTION_COLUMNS.map(c => [c.key, true]))
  );
  const [statusFilter, setStatusFilter] = useState([
    { value: "active", label: "פעיל" },
  ]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [sortMismatchFirst, setSortMismatchFirst] = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterKey, setOpenFilterKey] = useState(null);
  const { openResults } = useGefenOrganizedResults();

  function toggleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [schoolsRes, yearDataRes] = await Promise.all([
          axios.get("/schools/"),
          axios.get("/schools/year-admin-data", { params: { academic_year: academicYear } }),
        ]);
        if (cancelled) return;
        setSchools(Array.isArray(schoolsRes.data) ? schoolsRes.data : []);
        setYearAdminData(yearDataRes.data || {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [academicYear]);

  function toggleCol(key) {
    setColVisible(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function saveYearAdminField(schoolId, field, value) {
    setYearAdminData(prev => ({
      ...prev,
      [schoolId]: { ...(prev[schoolId] || {}), school_id: schoolId, [field]: value },
    }));
    try {
      const res = await axios.put(`/schools/${schoolId}/year-admin-data`, { [field]: value }, { params: { academic_year: academicYear } });
      // Merge (not replace) — a full replace would clobber any other field that was
      // optimistically saved on this same row by a concurrent, still-in-flight PUT.
      setYearAdminData(prev => ({
        ...prev,
        [schoolId]: { ...(prev[schoolId] || {}), ...res.data, [field]: res.data?.[field] ?? value },
      }));
    } catch {
      const res = await axios.get("/schools/year-admin-data", { params: { academic_year: academicYear } });
      setYearAdminData(res.data || {});
    }
  }

  function handleUploaded(resultMap) {
    const mergedYearAdminData = { ...yearAdminData, ...resultMap };
    setYearAdminData(mergedYearAdminData);
    setShowUploadModal(false);
    setSortMismatchFirst(true);

    const mismatched = schools.filter(s => getGefenOrganizedStatus(mergedYearAdminData[s.id] || {}) === "mismatch");
    const checkedAt = Object.values(resultMap).reduce((latest, yad) => {
      if (!yad.gefen_organized_checked_at) return latest;
      return !latest || yad.gefen_organized_checked_at > latest ? yad.gefen_organized_checked_at : latest;
    }, null);
    openResults({
      displayRows: buildMismatchDisplayRows(mismatched, mergedYearAdminData),
      exportRows: buildMismatchExportRows(mismatched, mergedYearAdminData),
      checkedAt,
      academicYear,
    });
  }

  const visibleColumns = COLLECTION_COLUMNS.filter(c => colVisible[c.key]);

  let filteredSchools = statusFilter.length === 0
    ? schools
    : schools.filter(s => {
        const status = yearAdminData[s.id]?.client_status;
        return statusFilter.some(f => f.value === status);
      });

  if (Object.keys(columnFilters).length > 0) {
    filteredSchools = filteredSchools.filter(s => passesCollectionColumnFilters(yearAdminData[s.id] || {}, columnFilters));
  }

  if (sortKey) {
    filteredSchools = [...filteredSchools].sort((a, b) => {
      const va = getCollectionSortValue(yearAdminData[a.id] || {}, sortKey);
      const vb = getCollectionSortValue(yearAdminData[b.id] || {}, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "he");
      return sortDir === "asc" ? cmp : -cmp;
    });
  } else if (sortMismatchFirst) {
    filteredSchools = [...filteredSchools].sort((a, b) => {
      const ra = GEFEN_ORGANIZED_SORT_RANK[getGefenOrganizedStatus(yearAdminData[a.id] || {})];
      const rb = GEFEN_ORGANIZED_SORT_RANK[getGefenOrganizedStatus(yearAdminData[b.id] || {})];
      return ra - rb;
    });
  }

  const hasResults = Object.values(yearAdminData).some(yad => yad.gefen_organized_checked_at);

  function showLastResults() {
    const mismatched = schools.filter(s => getGefenOrganizedStatus(yearAdminData[s.id] || {}) === "mismatch");
    const checkedAt = Object.values(yearAdminData).reduce((latest, yad) => {
      if (!yad.gefen_organized_checked_at) return latest;
      return !latest || yad.gefen_organized_checked_at > latest ? yad.gefen_organized_checked_at : latest;
    }, null);
    openResults({
      displayRows: buildMismatchDisplayRows(mismatched, yearAdminData),
      exportRows: buildMismatchExportRows(mismatched, yearAdminData),
      checkedAt,
      academicYear,
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <ClientStatusFilter selected={statusFilter} onChange={setStatusFilter} />
          <ColumnPickerButton colVisible={colVisible} onToggle={toggleCol} />
          <button type="button" onClick={() => setShowUploadModal(true)} className="btn-ghost text-xs px-3 py-1.5">
            בדיקה חדשה
          </button>
          <button
            type="button"
            onClick={showLastResults}
            disabled={!hasResults}
            className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-40"
          >
            הצג בדיקה אחרונה
          </button>
        </div>
        <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
      </div>

      <div className="glass-card rounded-2xl overflow-hidden relative mb-3 flex flex-col" style={{ minHeight: "calc(100vh - 260px)" }}>
        {loading ? (
          <div role="status" aria-label="טוען נתוני גבייה" className="flex justify-center py-10">
            <div aria-hidden="true" className="spinner w-8 h-8" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto dash-scroll-x">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr
                  className="border-b border-slate-200"
                  style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" }}
                >
                  <th
                    scope="col"
                    className="text-right px-5 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap"
                    style={{ position: "sticky", right: 0, zIndex: 11, background: "rgba(241,245,249,0.97)", minWidth: "14rem" }}
                  >
                    שם מוסד
                  </th>
                  {visibleColumns.map((col, i) => {
                    const isLast = i === visibleColumns.length - 1;
                    const filterType = COLLECTION_FILTER_TYPES[col.key];
                    const isSorted = sortKey === col.key;
                    const isFiltered = isCollectionFilterActive(columnFilters[col.key]);
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className={`text-right px-4 py-3 font-semibold select-none text-slate-900 whitespace-nowrap ${isLast ? "" : "border-l border-slate-200"}`}
                      >
                        <div className="flex items-center gap-1">
                          {filterType ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(col.key)}
                              className={`flex items-center gap-1 hover:text-blue-600 ${isSorted ? "text-blue-600" : ""}`}
                            >
                              <span className="whitespace-nowrap">{col.label}</span>
                              {isSorted && (
                                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  {sortDir === "asc" ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
                                </svg>
                              )}
                            </button>
                          ) : (
                            <span className="whitespace-nowrap">{col.label}</span>
                          )}
                          {filterType && (
                            <CollectionFilterButton
                              col={col}
                              filterType={filterType}
                              isFiltered={isFiltered}
                              isOpen={openFilterKey === col.key}
                              onToggle={() => setOpenFilterKey(o => (o === col.key ? null : col.key))}
                              onClose={() => setOpenFilterKey(null)}
                              spec={columnFilters[col.key]}
                              options={COLLECTION_SELECT_FILTER_OPTIONS[col.key]}
                              onChange={spec => setColumnFilters(prev => ({ ...prev, [col.key]: spec }))}
                              onClear={() => setColumnFilters(prev => { const next = { ...prev }; delete next[col.key]; return next; })}
                            />
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredSchools.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} className="p-8 text-center text-slate-500">
                      לא נמצאו בתי ספר
                    </td>
                  </tr>
                )}
                {filteredSchools.map(school => {
                  const yad = yearAdminData[school.id] || {};
                  return (
                    <tr key={school.id} className="group border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td
                        className="px-5 py-3 border-l border-slate-100 bg-white group-hover:bg-slate-50 whitespace-nowrap"
                        style={{ position: "sticky", right: 0, zIndex: 5, minWidth: "14rem" }}
                      >
                        <span className="font-semibold text-slate-900">{school.name}</span>
                      </td>
                      {visibleColumns.map((col, i) => {
                        const isLast = i === visibleColumns.length - 1;
                        const tdClass = `px-4 py-2 text-slate-600 ${isLast ? "" : "border-l border-slate-100"}`;
                        if (col.key === "gefen_organized") {
                          return (
                            <td key={col.key} className={tdClass}>
                              <GefenOrganizedCell yad={yad} />
                            </td>
                          );
                        }
                        if (col.key === "order_amount_gefen") {
                          return (
                            <td key={col.key} className={tdClass}>
                              {formatAmount(yad.order_amount_gefen) || "—"}
                            </td>
                          );
                        }
                        if (col.key === "amount_paid") {
                          return (
                            <td key={col.key} className={tdClass}>
                              <label htmlFor={`amount-paid-${school.id}`} className="sr-only">סכום ששולם</label>
                              <input
                                id={`amount-paid-${school.id}`}
                                key={`${school.id}-${academicYear}`}
                                type="text"
                                inputMode="numeric"
                                defaultValue={formatAmount(yad.amount_paid)}
                                onBlur={e => {
                                  const v = parseAmount(e.target.value);
                                  e.target.value = formatAmount(v);
                                  if (v !== (yad.amount_paid ?? null)) saveYearAdminField(school.id, "amount_paid", v);
                                }}
                                className={`${ADMIN_FIELD_CLS} w-24`}
                              />
                            </td>
                          );
                        }
                        if (col.key === "remaining_to_pay") {
                          const remaining = yad.order_amount_gefen == null ? null : (yad.order_amount_gefen ?? 0) - (yad.amount_paid ?? 0);
                          return (
                            <td key={col.key} className={tdClass}>
                              {remaining === null ? "—" : formatAmount(remaining)}
                            </td>
                          );
                        }
                        if (col.key === "payment_method") {
                          return (
                            <td key={col.key} className={tdClass}>
                              <label htmlFor={`payment-method-${school.id}`} className="sr-only">דרך תשלום</label>
                              <select
                                id={`payment-method-${school.id}`}
                                className={`${ADMIN_FIELD_CLS} w-32`}
                                value={yad.payment_method || ""}
                                onChange={e => saveYearAdminField(school.id, "payment_method", e.target.value || null)}
                              >
                                <option value="">בחר</option>
                                {PAYMENT_METHOD_OPTIONS.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          );
                        }
                        if (col.key === "invoice_number") {
                          return (
                            <td key={col.key} className={tdClass}>
                              <InvoiceNumbersCell
                                key={`${school.id}-${academicYear}`}
                                savedValues={yad.invoice_numbers || []}
                                onSave={values => saveYearAdminField(school.id, "invoice_numbers", values.length ? values : null)}
                              />
                            </td>
                          );
                        }
                        if (col.key === "deposit_date") {
                          return (
                            <td key={col.key} className={tdClass}>
                              <DepositDatesCell
                                key={`${school.id}-${academicYear}`}
                                savedValues={yad.deposit_dates || []}
                                onSave={values => saveYearAdminField(school.id, "deposit_dates", values.length ? values : null)}
                              />
                            </td>
                          );
                        }
                        if (col.key === "invoice_transaction_status") {
                          return (
                            <td key={col.key} className={tdClass}>
                              <label htmlFor={`invoice-status-${school.id}`} className="sr-only">חשבונית עסקה</label>
                              <select
                                id={`invoice-status-${school.id}`}
                                className={`${ADMIN_FIELD_CLS} w-36`}
                                value={yad.invoice_transaction_status || ""}
                                onChange={e => saveYearAdminField(school.id, "invoice_transaction_status", e.target.value || null)}
                              >
                                <option value="">בחר</option>
                                {INVOICE_TRANSACTION_STATUS_OPTIONS.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          );
                        }
                        return (
                          <td key={col.key} className={tdClass}>
                            —
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showUploadModal && (
        <GefenOrganizedUploadModal
          academicYear={academicYear}
          onClose={() => setShowUploadModal(false)}
          onUploaded={handleUploaded}
        />
      )}

    </div>
  );
}
