import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { formatDateDMY } from "./tasks/taskShared";
import { matchesColumnFilter } from "./tasks/taskColumns";
import ColumnFilterButton from "./tasks/ColumnFilterButton";
import ColumnPickerButton, { loadColVisible } from "./tasks/ColumnPickerButton";
import { URGENCY_LABELS, daysToDeadline, ALL_PERSON_TASK_COLUMNS } from "./personTasks/personTaskColumns";
import PersonTaskRowExpandedDetail from "./personTasks/PersonTaskRowExpandedDetail";

const COL_STORAGE_KEY = "school_tasks_col_visible";

const URGENCY_CLASS = {
  1: "text-slate-500 bg-slate-100",
  2: "text-blue-700 bg-blue-50",
  3: "text-orange-700 bg-orange-50",
  4: "text-red-700 bg-red-50",
};
const STATUS_LABELS = { active: "פעילה", archived: "הושלמה", scheduled: "מתוזמנת" };
const STATUS_CLASS = {
  active: "text-orange-700 bg-orange-50",
  archived: "text-emerald-700 bg-emerald-50",
  scheduled: "text-blue-700 bg-blue-50",
};
// Same tier order (and same fallback for anything else, e.g. "scheduled") as
// PersonTasksTable.jsx's own defaultCompare — deliberately mirrored so "default sort = פעילה,
// הושלמה, מתוזמנת" behaves identically to אזור אישי/ניהול, not a re-invented rule.
const TIER_ORDER = { active: 0, archived: 1 };
function defaultCompare(a, b) {
  const tierDiff = (TIER_ORDER[a.status] ?? 2) - (TIER_ORDER[b.status] ?? 2);
  if (tierDiff !== 0) return tierDiff;
  const pctDiff = (a.cached_progress_pct ?? 0) - (b.cached_progress_pct ?? 0);
  if (pctDiff !== 0) return pctDiff;
  return (b.created_at || "").localeCompare(a.created_at || "");
}

function GenericCell({ col, task }) {
  if (col.key === "status") {
    return (
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_CLASS[task.status] || STATUS_CLASS.active}`}>
          {STATUS_LABELS[task.status] || STATUS_LABELS.active}
        </span>
      </td>
    );
  }
  if (col.key === "created_at") {
    return <td className="px-3 py-2 text-slate-700 whitespace-nowrap text-xs"><bdi>{formatDateDMY((task.created_at || "").slice(0, 10))}</bdi></td>;
  }
  if (col.key === "due_date") {
    const overdue = task.due_date && task.status !== "archived" && task.due_date < new Date().toISOString().slice(0, 10);
    return <td className={`px-3 py-2 whitespace-nowrap text-xs ${overdue ? "text-red-600 font-semibold" : "text-slate-700"}`}>{task.due_date ? <bdi>{formatDateDMY(task.due_date)}</bdi> : "—"}</td>;
  }
  if (col.key === "days_to_deadline") {
    const days = daysToDeadline(task);
    const overdue = days !== null && days < 0 && task.status !== "archived";
    return (
      <td className={`px-3 py-2 text-center whitespace-nowrap text-xs ${overdue ? "text-red-600 font-semibold" : "text-slate-700"}`}>
        {days === null ? "—" : days}
      </td>
    );
  }
  if (col.key === "urgency") {
    return (
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex text-xs font-medium rounded-full px-2 py-0.5 ${URGENCY_CLASS[task.urgency] || URGENCY_CLASS[1]}`}>
          {URGENCY_LABELS[task.urgency] || URGENCY_LABELS[1]}
        </span>
      </td>
    );
  }
  if (col.key === "cached_progress_pct") {
    return <td className="px-3 py-2 text-center text-slate-700 text-xs font-semibold">{task.cached_progress_pct ?? 0}%</td>;
  }
  if (col.key === "cached_completed") {
    return <td className="px-3 py-2 text-center text-slate-700 text-xs">{task.cached_completed ?? 0}/{task.cached_total_targets ?? 0}</td>;
  }
  if (col.key === "assignment_mode") {
    // "אחראי לביצוע" — school-specific (a multi-school task can resolve to a different advisor
    // per school), so this shows t.responsible_names as-is rather than reusing
    // personTaskColumns.responsibleSummary (which describes the task's org-wide routing rule,
    // not who's actually responsible for THIS school).
    return <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">{(task.responsible_names || []).join(" / ") || "—"}</td>;
  }
  const raw = col.getValue(task);
  const display = col.kind === "enum" && col.options ? (col.options.find(o => o.value === raw)?.label ?? raw ?? "—") : (raw === "" || raw === null || raw === undefined ? "—" : raw);
  const align = col.kind === "number" ? "text-center" : "";
  return <td className={`px-3 py-2 text-slate-700 whitespace-nowrap text-xs ${align}`}>{display}</td>;
}

// כרטיס בית ספר -> טאב "משימות" — משימות אנשי-ארגון שנוצרו לפי בתי-ספר ומכוונות לבית הספר הזה
// (GET /person-tasks/for-school/{id}). Reuses the exact same column catalog/filter/sort/picker
// machinery as אזור אישי / ניהול's own person-tasks table (ALL_PERSON_TASK_COLUMNS,
// ColumnFilterButton, ColumnPickerButton, the same default status-tier sort) — but keeps its own
// simple row rendering (no rename/pin/edit/delete menu) since this tab is view-only, same as
// before this round.
//
// "סטטוס"/"פעולות שהושלמו"/"אחוז התקדמות" are overwritten to be SCHOOL-scoped right after
// fetch — same "overwrite the org-wide cached_* columns with a scoped figure" principle
// list_my_person_tasks already uses for personal-scoping, just computed client-side here since
// the endpoint already returns `school_targets` (one entry per division-split target for THIS
// school only — a six-year school has 2).
export default function SchoolTasksTab({ schoolId }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [colVisible, setColVisible] = useState(() => loadColVisible(ALL_PERSON_TASK_COLUMNS, COL_STORAGE_KEY));
  const [columnFilters, setColumnFilters] = useState({});
  const [sortSpec, setSortSpec] = useState(null);

  function loadTasks({ silent = false } = {}) {
    if (!silent) setLoading(true);
    axios.get(`/person-tasks/for-school/${schoolId}`)
      .then(r => {
        const rows = (Array.isArray(r.data) ? r.data : []).map(t => {
          const schoolTargets = t.school_targets || [];
          const total = schoolTargets.length;
          const completed = schoolTargets.filter(x => x.completed).length;
          return {
            ...t,
            cached_total_targets: total,
            cached_completed: completed,
            cached_progress_pct: total ? Math.round((completed / total) * 10000) / 100 : 0,
            // A scheduled task (not yet routed to any school) never actually reaches this
            // endpoint in the first place (target_school_ids is still null at that point) — kept
            // here defensively rather than assumed away, so the tier sort/badge still degrade
            // gracefully if that ever changes.
            status: t.status === "scheduled" ? "scheduled" : (total > 0 && completed === total ? "archived" : "active"),
          };
        });
        setTasks(rows);
      })
      .catch(() => { if (!silent) setTasks([]); })
      .finally(() => { if (!silent) setLoading(false); });
  }

  useEffect(() => { loadTasks(); }, [schoolId]);

  const visibleColumns = ALL_PERSON_TASK_COLUMNS.filter(c => colVisible[c.key]);

  const distinctByColumn = useMemo(() => {
    const map = {};
    for (const col of ALL_PERSON_TASK_COLUMNS) {
      if (!col.dynamicOptions) continue;
      const seen = new Map();
      for (const t of tasks) {
        const v = col.getValue(t);
        if (v && !seen.has(v)) seen.set(v, v);
      }
      map[col.key] = [...seen.values()].sort((a, b) => a.localeCompare(b, "he")).map(v => ({ value: v, label: v }));
    }
    return map;
  }, [tasks]);

  const filtered = useMemo(() => tasks.filter(t =>
    ALL_PERSON_TASK_COLUMNS.every(col => matchesColumnFilter(t, col, columnFilters[col.key])),
  ), [tasks, columnFilters]);

  // Sorted purely from already-fetched data, never from raw backend row order — a task row that
  // visibly "jumped" to a different position after being opened was actually the backend's
  // unordered query returning rows in a shifted position once that task's own cache columns got
  // updated (list_person_tasks_for_school has no ORDER BY). Deriving the display order
  // deterministically here instead makes it immune to that regardless.
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (!sortSpec) return defaultCompare(a, b);
    const col = ALL_PERSON_TASK_COLUMNS.find(c => c.key === sortSpec.key);
    const av = col.getValue(a), bv = col.getValue(b);
    let cmp;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = (av ?? "").toString().localeCompare((bv ?? "").toString(), "he");
    return sortSpec.dir === "asc" ? cmp : -cmp;
  }), [filtered, sortSpec]);

  function setColumnFilter(key, value) {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value === null) delete next[key]; else next[key] = value;
      return next;
    });
  }
  function setColumnSort(key, dir) {
    setSortSpec(dir ? { key, dir } : null);
  }

  if (loading) {
    return <div role="status" aria-label="טוען משימות" className="text-sm text-slate-400">טוען...</div>;
  }
  if (tasks.length === 0) {
    return <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl p-8 text-center">אין משימות הקשורות לבית ספר זה</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <ColumnPickerButton colVisible={colVisible} setColVisible={setColVisible} size="md" columns={ALL_PERSON_TASK_COLUMNS} storageKey={COL_STORAGE_KEY} />
      </div>
      <div className="glass-card rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th scope="col" className="px-2 py-2" aria-hidden="true" />
              {visibleColumns.map(col => (
                <th key={col.key} scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span>{col.label}</span>
                    <ColumnFilterButton
                      col={col}
                      filter={columnFilters[col.key]}
                      onFilterChange={v => setColumnFilter(col.key, v)}
                      sortDir={sortSpec?.key === col.key ? sortSpec.dir : null}
                      onSort={dir => setColumnSort(col.key, dir)}
                      distinctOptions={distinctByColumn[col.key]}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="text-sm text-slate-400 p-8 text-center">
                  אין משימות תואמות לסינון הנוכחי
                </td>
              </tr>
            ) : sorted.map(t => (
              <Fragment key={t.id}>
                <tr
                  onClick={() => setExpandedId(prev => (prev === t.id ? null : t.id))}
                  className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-2 py-2 text-center text-slate-400" aria-hidden="true">{expandedId === t.id ? "▼" : "◀"}</td>
                  {visibleColumns.map(col => <GenericCell key={col.key} col={col} task={t} />)}
                </tr>
                {expandedId === t.id && (
                  <tr className="border-b border-slate-100 bg-slate-50/40">
                    <td colSpan={visibleColumns.length + 1} className="px-3 py-3">
                      <PersonTaskRowExpandedDetail taskId={t.id} onTaskChange={() => loadTasks({ silent: true })} scopeSchoolId={schoolId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
