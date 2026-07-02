import { Fragment, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import Sidebar from "../components/Sidebar";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { supabase } from "../lib/supabase";

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
  { label: "מנהל/ת",        nameField: "principal_name",       phoneField: "principal_phone",       emailField: "principal_email" },
  { label: "מנהלנ/ית",      nameField: "secretary_name",       phoneField: "secretary_phone",       emailField: "secretary_email" },
  { label: "אחראי/ת כספים", nameField: "finance_contact_name", phoneField: "finance_contact_phone", emailField: "finance_contact_email" },
];
const ROLE_LABELS = { owner: "בעלים", manager: "מנהל", advisor: "יועץ" };
const ROLE_SORT_ORDER = { owner: 0, manager: 1, advisor: 2 };
function sortByRole(arr) { return [...arr].sort((a, b) => (ROLE_SORT_ORDER[a.role] ?? 3) - (ROLE_SORT_ORDER[b.role] ?? 3)); }

const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];

const HEBREW_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function AdvisorSearch({ schoolId, assigned, users, loadingUsers, onAdd, onRemove, onRetry }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

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
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {(assigned || []).map(adv => (
          <span key={adv.id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
            {adv.full_name || adv.email}
            {onRemove && (
              <button
                type="button"
                onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onRemove(schoolId, adv.id); }}
                className="hover:text-red-500 leading-none text-base"
                aria-label={`הסר ${adv.full_name || adv.email}`}
              >×</button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={`advisor-search-${schoolId}`}
          type="text"
          className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
          placeholder={loadingUsers ? "טוען..." : (assigned || []).length === 0 ? "לחץ לפתיחת רשימה, או הקלד שם לסינון..." : ""}
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
                  onMouseDown={e => { e.preventDefault(); if (onRetry) onRetry(); }}
                  className="text-blue-500 hover:text-blue-700 underline"
                >טעינה נכשלה — לחץ לניסיון חוזר</button>
              ) : "לא נמצאו יועצים"}
            </div>
          ) : filtered.map(u => (
            <button
              key={u.id}
              onMouseDown={e => {
                e.preventDefault();
                onAdd(schoolId, u.id);
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

  const isAll = restrictTo === null || restrictTo === undefined;
  const selected = restrictTo || [];

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      {/* Display chip area */}
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
          const u = users.find(u => u.id === id);
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
        {selected.length > 0 && (
          <button
            type="button"
            onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange(null); }}
            className="text-xs text-slate-400 hover:text-slate-600 mr-auto px-1"
            aria-label="אפס לכולם"
          >↺ כולם</button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-30 right-0 left-0 mt-1 border border-slate-200 rounded-xl bg-white shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <label htmlFor="access-selector-search" className="sr-only">חיפוש</label>
            <input
              id="access-selector-search"
              type="search"
              className="input-field text-sm"
              placeholder="חפש יועץ..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-slate-50" role="listbox">
            {/* כולם option */}
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
            {/* היועצים המלווים שנבחרו option */}
            {schoolAdvisors && schoolAdvisors.length > 0 && (
              <button
                type="button"
                role="option"
                onMouseDown={e => {
                  e.preventDefault();
                  if (onSelectAdvisors) {
                    onSelectAdvisors();
                  } else {
                    const ids = schoolAdvisors.map(a => a.id).filter(Boolean);
                    onChange(ids.length > 0 ? ids : null);
                  }
                  setOpen(false);
                }}
                className="w-full text-right px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-2"
              >
                <span className="w-4 h-4 rounded border border-slate-300 flex-shrink-0" aria-hidden="true" />
                <span className="font-medium">היועצים המלווים שנבחרו</span>
                <span className="text-xs text-slate-400 mr-auto">{schoolAdvisors.length} יועצים</span>
              </button>
            )}
            {sortByRole(loadingUsers ? [] : users)
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

const EMPTY_FORM = { name: "", symbol: "", city: "", authority: "", stage: "", finance_software: "", principal_name: "", principal_phone: "", principal_email: "", secretary_name: "", secretary_phone: "", secretary_email: "", finance_contact_name: "", finance_contact_phone: "", finance_contact_email: "", school_phone: "", address: "", district: "", restrict_access_to: [], extra_contacts: [] };

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="uperm-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 id="uperm-title" className="font-bold text-slate-800">הרשאות אישיות</h2>
            <p className="text-xs text-slate-400 mt-0.5">{user.full_name || user.email} · {roleLabel}</p>
          </div>
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
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                כאן ניתן להחריג משתמש זה מברירות המחדל של תפקידו.
                "ברירת מחדל" משמעותה שהמשתמש ירש את ההרשאה מהגדרות תפקיד {roleLabel}.
              </p>
              <div className="divide-y divide-slate-100">
                {Object.entries(permDefaults).map(([perm, data]) => {
                  const currentOverride = overrides[perm];   // true | false | undefined
                  const isSaving = saving[perm];
                  const roleDefault = data[user.role];
                  const effectiveLabel = currentOverride !== undefined
                    ? OVERRIDE_STATE_LABEL[String(currentOverride)]
                    : `ברירת מחדל (${roleDefault ? "מורשה" : "חסום"})`;

                  return (
                    <div key={perm} className="py-4">
                      <p className="text-sm font-medium text-slate-700 mb-2">{data.label}</p>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { value: null,  label: `ברירת מחדל (${roleDefault ? "מורשה" : "חסום"})` },
                          { value: true,  label: "מורשה תמיד" },
                          { value: false, label: "חסום תמיד" },
                        ].map(opt => {
                          const isActive = opt.value === null
                            ? currentOverride === undefined
                            : currentOverride === opt.value;
                          return (
                            <button
                              key={String(opt.value)}
                              onClick={() => !isActive && onSave(perm, opt.value)}
                              disabled={isSaving}
                              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                                isSaving ? "opacity-50 cursor-wait" : ""
                              } ${isActive
                                ? opt.value === true  ? "bg-blue-600 text-white border-blue-600"
                                : opt.value === false ? "bg-red-500 text-white border-red-500"
                                :                       "bg-slate-700 text-white border-slate-700"
                                : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="btn-ghost px-5 py-2 text-sm">סגור</button>
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

export default function AdminPage() {
  const location = useLocation();
  const navigate  = useNavigate();
  const [activeTab, setActiveTab] = useState("schools");
  const importRef = useRef(null);
  const userImportRef = useRef(null);
  const [myRole, setMyRole] = useState("");
  const [myUserId, setMyUserId] = useState(null);
  const [canDeleteSchool, setCanDeleteSchool] = useState(false);
  const [canInviteUsers, setCanInviteUsers] = useState(false);
  const [canDeleteUsers, setCanDeleteUsers] = useState(false);
  const [canManagePermissions, setCanManagePermissions] = useState(false);

  // Schools state
  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [schoolForm, setSchoolForm] = useState(EMPTY_FORM);
  const [schoolStage, setSchoolStage] = useState("");
  const [advisorListOpen, setAdvisorListOpen] = useState(false);
  const advisorContainerRef = useRef(null);
  const advisorInputRef = useRef(null);
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

  // Delete confirmation modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingSchool, setDeletingSchool] = useState(false);
  const [showSchoolFormDots, setShowSchoolFormDots] = useState(false);
  const [recycleInfoSchoolName, setRecycleInfoSchoolName] = useState(null);
  const [restoreSuccessSchoolName, setRestoreSuccessSchoolName] = useState(null);
  const schoolFormDotsRef = useRef(null);

  // Search filter for new-school advisor checkbox list
  const [advisorSearchQuery, setAdvisorSearchQuery] = useState("");

  // Users state
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [roleError, setRoleError] = useState("");
  const [roleChangeConfirm, setRoleChangeConfirm] = useState(null); // { userId, userName, oldRole, newRole }
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", role: "advisor" });
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
  const [confirmingUserDelete, setConfirmingUserDelete] = useState(false);
  const [userDeleteError, setUserDeleteError] = useState("");

  const schoolFormDirty = showSchoolForm && (
    editingSchool !== null ||
    !!(schoolForm.name || schoolForm.symbol || schoolStage || selectedAdvisors.length > 0)
  );
  const isDirty = schoolFormDirty || editingUser !== null || !!(inviteForm.email || inviteForm.full_name);
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
    setInviteForm({ email: "", full_name: "", role: "advisor" });
    blocker.proceed?.();
  }

  function handleDiscardAndProceed() {
    setShowSchoolForm(false);
    setEditingSchool(null);
    setSchoolForm(EMPTY_FORM);
    setSelectedAdvisors([]);
    setSchoolStage("");
    setCustomDivisions(DEFAULT_CUSTOM_DIVISIONS);
    setTriedSave(false);
    setAccessLinkedToAdvisors(false);
    setEditingUser(null);
    setEditingUserName("");
    setInviteForm({ email: "", full_name: "", role: "advisor" });
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
      setOverrides(o => {
        const n = { ...o };
        if (allowed === null) delete n[permission];
        else n[permission] = allowed;
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
        setCanDeleteSchool(!!res.data?.can_delete_schools);
        setCanInviteUsers(!!res.data?.can_invite_users);
        setCanDeleteUsers(!!res.data?.can_delete_users);
        setCanManagePermissions(!!res.data?.can_manage_user_permissions);
      }).catch(() => {});
    });
  }, []);
  useEffect(() => { if ((activeTab === "users" || activeTab === "billing") && users.length === 0) loadUsers(); }, [activeTab]);
  useEffect(() => { if (activeTab === "permissions" && !permDefaults && !permLoading) loadPermDefaults(); }, [activeTab]);
  // Advisors must not access the admin area — redirect immediately once role is confirmed
  useEffect(() => { if (myRole === "advisor") navigate("/", { replace: true }); }, [myRole]);

  useEffect(() => {
    function handler(e) { if (schoolFormDotsRef.current && !schoolFormDotsRef.current.contains(e.target)) setShowSchoolFormDots(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // When "היועצים המלווים שנבחרו" mode is active, keep restrict_access_to in sync with selected advisors
  useEffect(() => {
    if (!accessLinkedToAdvisors) return;
    const ids = editingSchool
      ? (schoolAdvisors[editingSchool.id] || []).map(a => a.id).filter(Boolean)
      : selectedAdvisors;
    setSchoolForm(p => ({ ...p, restrict_access_to: ids.length > 0 ? ids : null }));
  }, [selectedAdvisors, schoolAdvisors, editingSchool, accessLinkedToAdvisors]);

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
      const res = await axios.get("/schools/users/all");
      setUsers(Array.isArray(res.data) ? res.data : []);
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
    if (!editingSchool && (schoolStage === "sheshshnati" || schoolStage === "other") && customDivisions.length === 0) return;
    if (schoolForm.principal_phone && validateSecretaryPhone(schoolForm.principal_phone)) return;
    if (schoolForm.secretary_phone && validateSecretaryPhone(schoolForm.secretary_phone)) return;
    if (schoolForm.finance_contact_phone && validateSecretaryPhone(schoolForm.finance_contact_phone)) return;
    if (schoolForm.school_phone && validateSchoolPhone(schoolForm.school_phone)) return;
    setSavingSchool(true);
    try {
      if (editingSchool) {
        await axios.put(`/schools/${editingSchool.id}`, schoolForm);
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
    });
    setTriedSave(false);
    setAdvisorSearchQuery("");
    setShowSchoolForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    axios.get(`/schools/${school.id}/advisors`).then(res => {
      setSchoolAdvisors(prev => ({ ...prev, [school.id]: res.data }));
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
    setAdvisorSearchQuery("");
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
    await axios.delete(`/schools/${schoolId}/advisors/${advisorId}`);
    const res = await axios.get(`/schools/${schoolId}/advisors`);
    setSchoolAdvisors(prev => ({ ...prev, [schoolId]: res.data }));
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
      setInviteForm({ email: "", full_name: "", role: "advisor" });
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

  const tabs = [
    { id: "schools", label: "בתי ספר" },
    { id: "users", label: "משתמשים" },
    { id: "permissions", label: "הרשאות" },
    ...(showBillingTab ? [{ id: "billing", label: "חיובים" }] : []),
  ];

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />

      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
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
                                  onClick={() => setSchoolForm(p => ({ ...p, extra_contacts: (p.extra_contacts || []).filter((_, j) => j !== i) }))}
                                  className="text-slate-400 hover:text-red-500 flex-shrink-0 mr-1 text-base leading-none"
                                  aria-label="הסר שורת איש קשר">✕</button>
                              </div>
                            </td>
                          </tr>
                        ))}

                        {/* Add contact button */}
                        {(schoolForm.extra_contacts || []).length < 3 && (
                          <tr>
                            <td colSpan={4} className="pt-3 pb-1">
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
                          <AdvisorSearch
                            schoolId={editingSchool.id}
                            assigned={schoolAdvisors[editingSchool.id] || []}
                            users={users}
                            loadingUsers={loadingUsers}
                            onAdd={addAdvisorToSchool}
                            onRemove={removeAdvisorFromSchool}
                            onRetry={loadUsers}
                          />
                        ) : (
                          <>
                            {loadingUsers ? (
                              <p className="text-sm text-slate-400 py-1">טוען...</p>
                            ) : (
                              <div
                                ref={advisorContainerRef}
                                onBlur={e => {
                                  if (!advisorContainerRef.current?.contains(e.relatedTarget)) setAdvisorListOpen(false);
                                }}
                                className="relative"
                              >
                                <label htmlFor="new-school-advisor-search" className="sr-only">חיפוש יועץ</label>
                                {/* Chip + input container */}
                                <div
                                  className={`input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-text ${triedSave && selectedAdvisors.length === 0 ? "border-red-400" : ""}`}
                                  onClick={() => { setAdvisorListOpen(true); advisorInputRef.current?.focus(); }}
                                >
                                  {selectedAdvisors.map(id => {
                                    const u = users.find(u => u.id === id);
                                    return u ? (
                                      <span key={id} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
                                        {u.full_name || u.email}
                                        <button
                                          type="button"
                                          onMouseDown={e => {
                                            e.stopPropagation(); e.preventDefault();
                                            const newList = selectedAdvisors.filter(i => i !== id);
                                            setSelectedAdvisors(newList);
                                            if (newList.length === 0) {
                                              setAccessLinkedToAdvisors(false);
                                              setSchoolForm(p => ({ ...p, restrict_access_to: [] }));
                                            }
                                          }}
                                          className="hover:text-red-500 leading-none text-base"
                                          aria-label={`הסר ${u.full_name || u.email}`}
                                        >×</button>
                                      </span>
                                    ) : null;
                                  })}
                                  <input
                                    ref={advisorInputRef}
                                    id="new-school-advisor-search"
                                    type="search"
                                    className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
                                    placeholder={selectedAdvisors.length === 0 ? "לחץ לבחירת יועץ..." : ""}
                                    value={advisorSearchQuery}
                                    onFocus={() => setAdvisorListOpen(true)}
                                    onChange={e => setAdvisorSearchQuery(e.target.value)}
                                  />
                                </div>
                                {advisorListOpen && (
                                  <div className="absolute z-20 right-0 left-0 border border-slate-200 rounded-xl overflow-y-auto max-h-44 bg-white divide-y divide-slate-50 mt-1 shadow-lg">
                                    {users.length === 0 && <p className="text-sm text-slate-400 px-3 py-2">אין משתמשים</p>}
                                    {sortByRole(users).filter(u => !advisorSearchQuery.trim() || (u.full_name || u.email || "").toLowerCase().includes(advisorSearchQuery.toLowerCase())).map(u => (
                                      <button
                                        key={u.id}
                                        type="button"
                                        onMouseDown={e => {
                                          e.preventDefault();
                                          if (selectedAdvisors.includes(u.id)) {
                                            const newList = selectedAdvisors.filter(id => id !== u.id);
                                            setSelectedAdvisors(newList);
                                            if (newList.length === 0) {
                                              setAccessLinkedToAdvisors(false);
                                              setSchoolForm(p => ({ ...p, restrict_access_to: [] }));
                                            }
                                          } else {
                                            setSelectedAdvisors(prev => [...prev, u.id]);
                                            if (selectedAdvisors.length === 0) setAccessLinkedToAdvisors(true);
                                          }
                                        }}
                                        className="w-full text-right flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50 cursor-pointer"
                                      >
                                        <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selectedAdvisors.includes(u.id) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                                        <span className="text-xs text-slate-700 flex-1">{u.full_name || u.email}</span>
                                        <span className="text-xs text-slate-400">{ROLE_LABELS[u.role]}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
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
                            editingSchool
                              ? (schoolAdvisors[editingSchool.id] || [])
                              : selectedAdvisors.map(id => users.find(u => u.id === id)).filter(Boolean)
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3 mt-5">
                    <button onClick={saveSchool} disabled={savingSchool} className={`${editingSchool ? "btn-green-light" : "btn-blue"} text-sm px-5 py-2`}>
                      {savingSchool ? "שומר..." : editingSchool ? "שמור שינויים" : "שמור"}
                    </button>
                    <button onClick={() => setShowSchoolForm(false)} className="btn-ghost text-sm px-5 py-2">ביטול</button>
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
              {schools.some(s => s.status === "pending_deletion") && (
                <h3 className="text-sm font-semibold text-slate-500 mb-3 flex items-center gap-2">
                  🏫 בתי ספר פעילים ({schools.filter(s => s.status === "active" || !s.status).length})
                </h3>
              )}
              <div className="flex flex-col gap-3">
                {schools.filter(s => s.status === "active" || !s.status).map(school => (
                  <div key={school.id} className="glass-card rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-slate-900">{school.name}</span>
                          {school.symbol && <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">סמל {school.symbol}</span>}
                          {school.city && <span className="text-xs text-slate-800">{school.city}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => toggleExpand(school)} className="btn-ghost text-xs px-3 py-1.5">
                          {expandedSchool === school.id ? "סגור" : "חטיבות"}
                        </button>
                        <button onClick={() => startEdit(school)} className="btn-ghost text-xs px-3 py-1.5">✏️ ערוך</button>
                      </div>
                    </div>

                    {expandedSchool === school.id && (
                      <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/70">
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
                          <div className="flex flex-wrap gap-2 mb-3 min-h-[28px]">
                            {(schoolAdvisors[school.id] || []).length === 0 && (
                              <p className="text-sm text-slate-400">אין יועצים מוקצים</p>
                            )}
                            {(schoolAdvisors[school.id] || []).map(adv => (
                              <span key={adv.id} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: "rgba(0,112,243,0.08)", color: "#1d4ed8" }}>
                                {adv.full_name || adv.email}
                                <button onClick={() => removeAdvisorFromSchool(school.id, adv.id)}
                                  className="hover:text-red-500 transition-colors leading-none text-base"
                                  aria-label={`הסר ${adv.full_name || adv.email}`}>×</button>
                              </span>
                            ))}
                          </div>
                          <AdvisorSearch
                            schoolId={school.id}
                            assigned={schoolAdvisors[school.id] || []}
                            users={users}
                            loadingUsers={loadingUsers}
                            onAdd={addAdvisorToSchool}
                            onRetry={loadUsers}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
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
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="invite-email" className="text-xs text-slate-800">אימייל *</label>
                        <input id="invite-email" className="input-field" type="email" dir="ltr" value={inviteForm.email}
                          onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="invite-name" className="text-xs text-slate-800">שם מלא *</label>
                        <input id="invite-name" className="input-field" value={inviteForm.full_name}
                          onChange={e => setInviteForm(p => ({ ...p, full_name: e.target.value }))} placeholder="שם מלא" />
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
                    </div>
                    <div className="flex items-center gap-3 mt-4">
                      <button onClick={inviteUser} disabled={!inviteForm.email || !inviteForm.full_name || inviting} className="btn-blue text-sm px-5 py-2">
                        {inviting ? "שולח..." : "שלח הזמנה"}
                      </button>
                      {inviteMsg && <span className={`text-sm ${inviteMsg.includes("שגיאה") ? "text-red-500" : "text-green-600"}`}>{inviteMsg}</span>}
                    </div>
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
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">שם</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">אימייל</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">תפקיד</th>
                      <th scope="col" className="text-right px-5 py-3 text-slate-500 font-medium">סטטוס</th>
                      <th scope="col" className="px-5 py-3 text-right text-slate-500 font-medium">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortByRole(users).map(u => (
                      <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3">
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
                        <td className="px-5 py-3 text-slate-600" dir="ltr">{u.email}</td>
                        <td className="px-5 py-3">
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
                        <td className="px-5 py-3">
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
                          <div className="flex gap-1 items-center justify-end">
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
                            <button onClick={() => startEditUser(u)} disabled={editingUser?.id === u.id}
                              className="text-xs px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-30">ערוך</button>
                            {u.role !== "owner" && (
                              <button onClick={() => openOverridePanel(u)}
                                aria-label={`הרשאות אישיות: ${u.full_name || u.email}`}
                                className="text-xs px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">הרשאות</button>
                            )}
                            {(myRole === "owner" || canDeleteUsers) && (
                              <button onClick={() => setUserToDelete(u)}
                                className="text-xs px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors">מחק</button>
                            )}
                          </div>
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
      {blocker.state === "blocked" && (
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
    </div>
  );
}
