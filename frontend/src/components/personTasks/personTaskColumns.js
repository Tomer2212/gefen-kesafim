// Column catalog for the person-tasks table (ניהול -> משימות -> אנשי הארגון, and the same table
// reused for אזור אישי / SchoolTasksTab) — mirrors frontend/src/components/tasks/taskColumns.js's
// shape exactly (key/label/kind/getValue/[options|dynamicOptions]/defaultVisible) so the shared
// ColumnFilterButton.jsx/ColumnPickerButton.jsx work unchanged for this table too.
export const URGENCY_LABELS = { 1: "נמוכה", 2: "בינונית", 3: "גבוהה", 4: "דחופה" };

const SERVICE_TYPE_LABELS = { gefen: "גפן", current: "שוטף", district: "מחוז", gefen_current: "גפן+שוטף" };

// "אחראי ביצוע" column value for schools-mode tasks — the routing division isn't a fixed
// property of the task anymore (target_division was replaced by target_criteria in the
// "יועץ מלווה" redesign), so it's read live from whatever service_type condition(s) the audience
// filter actually contains. A task can (rarely) have more than one distinct value across its
// OR-groups — all distinct values found are shown, joined.
export function advisorDivisionLabel(task) {
  const values = new Set();
  for (const group of task.target_criteria?.groups || []) {
    for (const cond of group.conditions || []) {
      if (cond.type === "field" && cond.field === "service_type" && cond.value) values.add(cond.value);
    }
  }
  if (!values.size) return null;
  return [...values].map(v => SERVICE_TYPE_LABELS[v] || v).join(" / ");
}

export function responsibleSummary(task) {
  if (task.assignment_mode === "users") return "משתמשים ספציפיים";
  const label = advisorDivisionLabel(task);
  return label ? `יועץ מלווה [${label}]` : "יועץ מלווה";
}

// Days remaining until due_date (positive), 0 for today, negative when overdue — plain
// day-granularity diff, recomputed on every render (so it's always current as of page load,
// "once a day" in practice since nobody keeps this table open for days without a refresh).
export function daysToDeadline(task) {
  if (!task.due_date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${task.due_date}T00:00:00`);
  return Math.round((due - today) / 86400000);
}

export const ALL_PERSON_TASK_COLUMNS = [
  {
    key: "name", label: "שם משימה", kind: "text", defaultVisible: true,
    getValue: t => t.name || "",
  },
  {
    key: "status", label: "סטטוס", kind: "enum", defaultVisible: true,
    getValue: t => t.status,
    options: [
      { value: "active", label: "פעילה" },
      { value: "archived", label: "הושלמה" },
    ],
  },
  {
    key: "urgency", label: "דחיפות", kind: "enum", defaultVisible: true,
    getValue: t => String(t.urgency ?? 1),
    options: Object.entries(URGENCY_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    key: "created_at", label: "תאריך יצירה", kind: "date", defaultVisible: true,
    getValue: t => (t.created_at || "").slice(0, 10),
  },
  {
    key: "due_date", label: "תאריך יעד", kind: "date", defaultVisible: true,
    getValue: t => t.due_date || "",
  },
  {
    key: "days_to_deadline", label: "מס' ימים לדדליין", kind: "number", defaultVisible: true,
    getValue: t => daysToDeadline(t) ?? "",
  },
  {
    key: "created_by_name", label: "יוצר המשימה", kind: "enum", defaultVisible: true, dynamicOptions: true,
    getValue: t => t.created_by_name || "—",
  },
  {
    key: "assignment_mode", label: "אחראי ביצוע", kind: "enum", defaultVisible: true,
    getValue: t => t.assignment_mode,
    options: [
      { value: "users", label: "משתמשים ספציפיים" },
      { value: "schools", label: "יועץ מלווה" },
    ],
  },
  {
    key: "cached_total_targets", label: "כמות יעדים", kind: "number", defaultVisible: false,
    getValue: t => t.cached_total_targets ?? 0,
  },
  {
    // Displayed as "X/Y" (completed/total) — see GenericCell's cached_completed special-case in
    // PersonTaskRow.jsx. getValue stays the plain completed-count for sorting/filtering.
    key: "cached_completed", label: "פעולות שהושלמו", kind: "number", defaultVisible: true,
    getValue: t => t.cached_completed ?? 0,
  },
  {
    key: "cached_progress_pct", label: "אחוז התקדמות", kind: "number", defaultVisible: true,
    getValue: t => t.cached_progress_pct ?? 0,
  },
];

export const DEFAULT_PERSON_COL_VISIBLE = Object.fromEntries(ALL_PERSON_TASK_COLUMNS.map(c => [c.key, c.defaultVisible]));
