// Column catalog for the redesigned Tasks table — drives TasksTable.jsx's header/filter/sort
// AND the "עמודות להצגה" visibility picker (ColumnPickerButton.jsx), mirroring the
// DashboardPage.jsx pattern (column def -> filter "kind" -> adapted control) at a scope sized
// for this table's 13 columns (no drag-reorder, no multi-column sort stacking, no Supabase-
// backed persistence — localStorage only, since Tasks has no per-user column-prefs column yet).
export const CHANNEL_SHORT_LABELS = { email_resend: "מייל (מערכת)", email_outlook: "מייל (Outlook)", whatsapp_twilio: "וואטסאפ" };

export const ALL_TASK_COLUMNS = [
  {
    key: "status", label: "סטטוס", kind: "enum", defaultVisible: true,
    getValue: t => t.status,
    options: [
      { value: "scheduled", label: "מתוזמנת" },
      { value: "active", label: "פעילה" },
      { value: "archived", label: "הושלמה" },
    ],
  },
  {
    key: "created_at", label: "תאריך יצירה", kind: "date", defaultVisible: true,
    getValue: t => (t.created_at || "").slice(0, 10),
  },
  {
    key: "name", label: "שם משימה", kind: "text", defaultVisible: true,
    getValue: t => t.name || "",
  },
  {
    key: "created_by_name", label: "יוצר", kind: "enum", defaultVisible: true, dynamicOptions: true,
    getValue: t => t.created_by_name || "—",
  },
  {
    key: "type", label: "סוג", kind: "enum", defaultVisible: true,
    getValue: t => (t.is_meeting_task ? "meeting" : "message"),
    options: [
      { value: "meeting", label: "קביעת פגישות" },
      { value: "message", label: "שליחת הודעה" },
    ],
  },
  {
    key: "cached_total_schools", label: "כמות בתי ספר", kind: "number", defaultVisible: true,
    getValue: t => t.cached_total_schools ?? 0,
  },
  {
    // Displayed as "X/Y" (completed/needed) — see GenericCell's cached_actions_completed
    // special-case in TaskRow.jsx. getValue stays the plain completed-count for sorting/filtering.
    key: "cached_actions_completed", label: "פעולות שהושלמו", kind: "number", defaultVisible: true,
    getValue: t => t.cached_actions_completed ?? 0,
  },
  {
    key: "cached_progress_pct", label: "התקדמות", kind: "number", defaultVisible: true,
    getValue: t => t.cached_progress_pct ?? 0,
  },
  {
    key: "track_success", label: "מדד הצלחה", kind: "enum", defaultVisible: false,
    getValue: t => (t.track_success === false ? "off" : "on"),
    options: [
      { value: "on", label: "מופעל" },
      { value: "off", label: "כבוי" },
    ],
  },
  {
    key: "scheduled_for", label: "תזמון", kind: "date", defaultVisible: false,
    getValue: t => (t.scheduled_for ? t.scheduled_for.slice(0, 10) : ""),
  },
  {
    key: "channel", label: "ערוץ", kind: "enum", defaultVisible: false,
    getValue: t => t.message_config?.channel || "",
    options: [
      { value: "email_resend", label: "מייל (מערכת)" },
      { value: "email_outlook", label: "מייל (Outlook)" },
      { value: "whatsapp_twilio", label: "וואטסאפ" },
    ],
  },
  {
    key: "has_meeting_send_problems", label: "⚠ בעיות", kind: "enum", defaultVisible: false,
    getValue: t => (t.has_meeting_send_problems ? "yes" : "no"),
    options: [
      { value: "yes", label: "יש בעיות" },
      { value: "no", label: "אין בעיות" },
    ],
  },
];

export const DEFAULT_COL_VISIBLE = Object.fromEntries(ALL_TASK_COLUMNS.map(c => [c.key, c.defaultVisible]));

export function matchesColumnFilter(task, col, filter) {
  if (!filter) return true;
  const raw = col.getValue(task);
  if (col.kind === "enum") {
    return !filter.values || filter.values.size === 0 || filter.values.has(raw);
  }
  if (col.kind === "text") {
    if (!filter.value?.trim()) return true;
    return String(raw || "").toLowerCase().includes(filter.value.trim().toLowerCase());
  }
  if (col.kind === "number") {
    if (filter.value === "" || filter.value === undefined || filter.value === null) return true;
    const n = Number(raw), v = Number(filter.value);
    if (Number.isNaN(n) || Number.isNaN(v)) return true;
    switch (filter.op) {
      case "ne": return n !== v;
      case "gt": return n > v;
      case "gte": return n >= v;
      case "lt": return n < v;
      case "lte": return n <= v;
      default: return n === v;
    }
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
