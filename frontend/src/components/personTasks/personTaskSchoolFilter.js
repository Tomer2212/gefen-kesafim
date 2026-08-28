import { matchesColumnFilter } from "../tasks/taskColumns";
import { STAGE_LABELS } from "./PersonTaskDetailContent";

// Shared filter/sort/search plumbing for the per-assignee (or personal) schools table inside an
// expanded person-task. Kept out of the components so the ניהול→יועצים view and the אזור-אישי
// view apply exactly the same rules.

// The 7 fields the compact "סינון מתקדם" popover offers. `fieldOptionKey` is the matching
// `field` in GET /tasks/field-options — when that entry has `options`, the value picker is a
// <select> and matching is equality; otherwise it's a free-text "contains".
export const SCHOOL_FILTER_FIELDS = [
  { key: "city", label: "עיר", fieldOptionKey: "city", get: t => t.city },
  { key: "symbol", label: "סמל מוסד", fieldOptionKey: "symbol", get: t => t.symbol },
  { key: "authority", label: "בעלות", fieldOptionKey: "authority", get: t => t.authority },
  { key: "district", label: "מחוז", fieldOptionKey: "district", get: t => t.district },
  { key: "stage", label: "שלב לימוד", fieldOptionKey: "stage", get: t => t.target_division_type },
  { key: "client_status", label: "סטטוס לקוח", fieldOptionKey: "client_status", get: t => t.client_status },
  { key: "service_type", label: "סוג שירות", fieldOptionKey: "service_type", get: t => t.service_type },
];

// Column definitions consumed by ColumnFilterButton + matchesColumnFilter. `hasMetricCol` adds
// the numeric "מדד הצלחה" column (only for number/file metrics — same gate the tables use).
export function makeSchoolColumns({ hasMetricCol }) {
  const cols = [
    { key: "school_name", label: "בית ספר", kind: "text", getValue: t => t.school_name || "" },
    { key: "city", label: "עיר", kind: "enum", getValue: t => t.city || "" },
    { key: "symbol", label: "סמל מוסד", kind: "text", getValue: t => t.symbol || "" },
    { key: "authority", label: "בעלות", kind: "enum", getValue: t => t.authority || "" },
    { key: "stage_label", label: "שלב לימוד", kind: "enum", getValue: t => STAGE_LABELS[t.target_division_type] || "" },
    { key: "status", label: "סטטוס", kind: "enum", getValue: t => (t.completed ? "הושלם" : "לא הושלם") },
  ];
  if (hasMetricCol) {
    cols.push({ key: "metric", label: "מדד הצלחה", kind: "number", getValue: t => t.metric_value?.value ?? "" });
  }
  return cols;
}

// Distinct non-empty values of an enum column, shaped for ColumnFilterButton's `distinctOptions`.
export function distinctFor(targets, col) {
  const seen = [];
  const set = new Set();
  for (const t of targets) {
    const v = col.getValue(t);
    if (v === "" || v === null || v === undefined || set.has(v)) continue;
    set.add(v);
    seen.push(v);
  }
  seen.sort((a, b) => String(a).localeCompare(String(b), "he"));
  return seen.map(v => ({ value: v, label: String(v) }));
}

const FREE_TEXT_KEYS = ["school_name", "city", "authority", "symbol"];

// One pipeline: free-text search -> compact advanced filter -> per-column funnel filters -> sort.
export function applyPersonTaskFilters(targets, { freeText, advanced, columnFilters, sortSpec }, columns) {
  let rows = targets;

  const q = (freeText || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(t => FREE_TEXT_KEYS.some(k => String(t[k] || "").toLowerCase().includes(q)));
  }

  if (advanced?.fieldKey && advanced.value) {
    const def = SCHOOL_FILTER_FIELDS.find(f => f.key === advanced.fieldKey);
    if (def) {
      const target = String(advanced.value);
      rows = rows.filter(t => {
        const actual = String(def.get(t) ?? "");
        return advanced.isText
          ? actual.toLowerCase().includes(target.toLowerCase())
          : actual === target;
      });
    }
  }

  if (columnFilters) {
    for (const col of columns) {
      const f = columnFilters[col.key];
      if (f) rows = rows.filter(t => matchesColumnFilter(t, col, f));
    }
  }

  if (sortSpec?.key) {
    const col = columns.find(c => c.key === sortSpec.key);
    if (col) {
      rows = [...rows].sort((a, b) => {
        const av = col.getValue(a);
        const bv = col.getValue(b);
        let cmp;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av ?? "").localeCompare(String(bv ?? ""), "he");
        return sortSpec.dir === "desc" ? -cmp : cmp;
      });
    }
  }

  return rows;
}

export const EMPTY_SUB_FILTER = { freeText: "", advanced: null, columnFilters: {}, sortSpec: null };
