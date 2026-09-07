import { DOMAIN_OPTIONS } from "../../constants/domains";

// Column catalog for the "ניהול > משתמשים" table — drives the "עמודות להצגה" picker
// (ColumnPickerButton.jsx) and the per-header sort+filter funnel (ColumnFilterButton.jsx),
// mirroring the DashboardPage.jsx / TasksTable.jsx pattern. localStorage-only persistence.

export const USERS_COL_LS_KEY = "admin_users_col_visible";

// "שם" is always rendered (the only stable identifier) → not offered in the picker.
export const ALWAYS_VISIBLE_KEYS = new Set(["full_name"]);

const ROLE_OPTIONS = [
  { value: "advisor", label: "יועץ" },
  { value: "manager", label: "מנהל" },
  { value: "owner", label: "בעלים" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "פעיל" },
  { value: "pending", label: "ממתין לאישור" },
];
const HAS_OPTIONS = [
  { value: "yes", label: "יש" },
  { value: "no", label: "אין" },
];
const VOICENTER_OPTIONS = [
  { value: "yes", label: "משויך" },
  { value: "no", label: "לא משויך" },
];

// ctx: { overrideCounts, voicenterMappings }
export function buildUserColumns(ctx = {}) {
  const overrideCounts = ctx.overrideCounts || {};
  const voicenterMappings = ctx.voicenterMappings || [];

  return [
    { key: "role", label: "תפקיד", kind: "enum", defaultVisible: true,
      options: ROLE_OPTIONS, getValue: u => u.role || "" },
    { key: "full_name", label: "שם", kind: "text", defaultVisible: true,
      getValue: u => u.full_name || "" },
    { key: "email", label: "אימייל", kind: "text", defaultVisible: true,
      getValue: u => u.email || "" },
    { key: "work_phone", label: "טלפון עבודה", kind: "text", defaultVisible: true,
      getValue: u => u.work_phone || "" },
    { key: "control_domains", label: "תחומי ידע", kind: "enum", defaultVisible: true,
      options: DOMAIN_OPTIONS,
      getValue: u => u.control_domains || [],
      // "match if the user has at least one of the checked domains"
      match: (u, f) => !f?.values?.size || (u.control_domains || []).some(d => f.values.has(d)) },
    { key: "birth_date", label: "תאריך לידה", kind: "date", defaultVisible: true,
      getValue: u => u.birth_date || "" },
    { key: "overrides", label: "הרשאות בהתאמה אישית", kind: "enum", defaultVisible: true,
      options: HAS_OPTIONS,
      getValue: u => ((overrideCounts[u.id] || 0) > 0 ? "yes" : "no") },
    { key: "voicenter", label: "שיוך VOICENTER", kind: "enum", defaultVisible: true,
      options: VOICENTER_OPTIONS,
      getValue: u => (voicenterMappings.some(m => m.advisor_id === u.id) ? "yes" : "no") },
    { key: "status", label: "סטטוס", kind: "enum", defaultVisible: true,
      options: STATUS_OPTIONS,
      getValue: u => (u.status === "pending" ? "pending" : "active") },
  ];
}

// Generic type-aware matcher (copied from tasks/taskColumns.js — kept local to avoid a
// cross-domain import). `col.match` on a column def overrides this.
export function matchesUserColumnFilter(row, col, filter) {
  if (!filter) return true;
  if (col.match) return col.match(row, filter);
  const raw = col.getValue(row);
  if (col.kind === "enum") {
    return !filter.values || filter.values.size === 0 || filter.values.has(raw);
  }
  if (col.kind === "text") {
    if (!filter.value?.trim()) return true;
    return String(raw || "").toLowerCase().includes(filter.value.trim().toLowerCase());
  }
  if (col.kind === "date") {
    if (!filter.value) return true;
    if (!raw) return false;
    switch (filter.op) {
      case "before": return raw < filter.value;
      case "after": return raw > filter.value;
      default: return raw === filter.value;
    }
  }
  return true;
}
