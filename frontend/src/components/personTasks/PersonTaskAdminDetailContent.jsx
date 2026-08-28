import { Fragment, useEffect, useState } from "react";
import axios from "axios";
import { metricDescription, STAGE_LABELS } from "./PersonTaskDetailContent";
import ColumnFilterButton from "../tasks/ColumnFilterButton";
import PersonTaskTableToolbar from "./PersonTaskTableToolbar";
import { makeSchoolColumns, distinctFor, applyPersonTaskFilters, EMPTY_SUB_FILTER } from "./personTaskSchoolFilter";

// Read-only mirror of PersonTaskDetailContent's own number/file value display — the task
// creator (who drills in here, not into the per-assignee detail view) must be able to see WHAT
// was actually submitted (a number, or an uploaded file) once a target is complete, not just
// that it's done. Never editable from here — only the assignee's own view can change it.
function MetricValueDisplay({ taskId, target, metric }) {
  if (metric.kind === "number") {
    return <span className="text-slate-600">{target.metric_value?.value ?? "—"}</span>;
  }
  if (metric.kind === "file") {
    const filename = target.metric_value?.filename;
    if (!filename) return <span className="text-slate-400">—</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="max-w-[8rem] truncate" title={filename}>{filename}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              const res = await axios.get(`/person-tasks/${taskId}/targets/${target.id}/file`, { responseType: "blob" });
              const url = URL.createObjectURL(res.data);
              const a = document.createElement("a");
              a.href = url;
              a.download = filename;
              a.click();
              URL.revokeObjectURL(url);
            } catch {
              /* non-fatal */
            }
          }}
          className="px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          הורדה
        </button>
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}

function SchoolCellValue({ col, t, taskId, metric, taskName }) {
  if (col.key === "status") {
    return t.completed
      ? <span className="text-emerald-600 font-bold" aria-label="הושלם">✓</span>
      : <span className="text-red-500 font-bold" aria-label="לא הושלם">✕</span>;
  }
  if (col.key === "metric") {
    return <MetricValueDisplay taskId={taskId} target={t} metric={metric} />;
  }
  if (col.key === "school_name") return t.school_name || taskName || "—";
  return col.getValue(t) || "—";
}

// Admin-only ("ניהול -> משימות -> אנשי הארגון") variant of the expanded-task detail — grouped by
// ASSIGNEE instead of by target, so a manager can see each person's actual throughput on this
// task (X/Y completed) at a glance, then drill into which specific schools are still open for
// them. A shared target row (co-assigned advisors on the same school+division) counts toward
// BOTH assignees' totals — that's the whole point of the shared-completion design, so grouping
// by assignee naturally surfaces it without any extra bookkeeping.
export default function PersonTaskAdminDetailContent({ taskId, onTaskChange }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedAssignee, setExpandedAssignee] = useState(null);
  const [fieldMeta, setFieldMeta] = useState(null);
  // Shared free-text / advanced / column-filter / sort state for the drill-in schools table —
  // reset whenever a different assignee is opened (only one is open at a time).
  const [subFilter, setSubFilter] = useState(EMPTY_SUB_FILTER);

  useEffect(() => {
    setLoading(true);
    axios.get(`/person-tasks/${taskId}`)
      .then(r => { setTask(r.data); onTaskChange?.(r.data); })
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  useEffect(() => {
    axios.get("/tasks/field-options").then(r => setFieldMeta({
      fieldOptions: r.data?.fields || [], goalOptions: r.data?.goal_options || [],
      divisionOptions: r.data?.division_options || [], controlLetterFields: r.data?.control_letter_fields || [],
    })).catch(() => {});
  }, []);

  function openAssignee(id) {
    setExpandedAssignee(prev => (prev === id ? null : id));
    setSubFilter(EMPTY_SUB_FILTER);
  }

  if (loading) {
    return (
      <div role="status" aria-label="טוען משימה" className="flex items-center justify-center py-10">
        <div aria-hidden="true" className="spinner w-7 h-7" />
      </div>
    );
  }
  if (!task) {
    return <div className="text-sm text-red-600 py-10 text-center">שגיאה בטעינת המשימה</div>;
  }

  const metric = task.success_metric || {};
  const targets = task.targets || [];

  const byAssignee = new Map(); // assignee_id -> {name, targets: [...]}
  for (const t of targets) {
    for (const aid of t.assignee_ids || []) {
      if (!byAssignee.has(aid)) {
        const name = (t.assignee_names || [])[(t.assignee_ids || []).indexOf(aid)] || aid;
        byAssignee.set(aid, { id: aid, name, targets: [] });
      }
      byAssignee.get(aid).targets.push(t);
    }
  }
  const assignees = [...byAssignee.values()]
    .map(a => ({ ...a, completed: a.targets.filter(t => t.completed).length, total: a.targets.length }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  const hasMetricCol = metric.kind === "number" || metric.kind === "file";
  const cols = makeSchoolColumns({ hasMetricCol });
  const pct = Math.max(0, Math.min(100, task.cached_progress_pct ?? 0));
  const barColor = pct <= 50 ? "bg-red-500" : pct < 100 ? "bg-orange-500" : "bg-green-500";
  const actionsDone = task.cached_completed ?? targets.filter(t => t.completed).length;
  const actionsTotal = task.cached_total_targets ?? targets.length;

  function setColFilter(key, v) {
    setSubFilter(s => {
      const cf = { ...s.columnFilters };
      if (v == null) delete cf[key]; else cf[key] = v;
      return { ...s, columnFilters: cf };
    });
  }
  function setColSort(key, dir) {
    setSubFilter(s => ({ ...s, sortSpec: dir ? { key, dir } : null }));
  }

  return (
    <div>
      {/* Task-details + progress card */}
      <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-4 mb-4 flex items-center justify-between gap-4">
        <div className="space-y-2">
          {task.description && (
            <div>
              <div className="text-xs text-slate-500">הסבר משימה</div>
              <div className="text-sm font-medium text-slate-800">{task.description}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-slate-500">מדד הצלחה</div>
            <div className="text-sm font-medium text-slate-800">{metricDescription(metric, fieldMeta)}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="w-44 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <div className="text-xs font-bold text-slate-700 whitespace-nowrap">
            {pct}% · {actionsDone}/{actionsTotal} פעולות
          </div>
        </div>
      </div>

      {/* Column headers — same grid template as every assignee card below (name column = right
          quarter, status column starts on the right-quarter line). */}
      <div className="grid grid-cols-[1fr_3fr] items-center gap-2 px-3 pb-2 border border-transparent text-[11px] font-bold text-slate-500">
        <span className="pr-[22px]">אחראי לביצוע</span>
        <span>סטטוס ביצוע</span>
      </div>

      {/* Assignee accordion — each row is its own compact card */}
      {assignees.length === 0 ? (
        <div className="text-center text-slate-400 text-xs py-6">אין יעדים למשימה זו</div>
      ) : assignees.map(a => {
        const isOpen = expandedAssignee === a.id;
        const rows = isOpen ? applyPersonTaskFilters(a.targets, subFilter, cols) : [];
        return (
          <Fragment key={a.id}>
            <div
              onClick={() => openAssignee(a.id)}
              aria-expanded={isOpen}
              className={`border rounded-xl p-3 mb-2 grid grid-cols-[1fr_3fr] items-center gap-2 cursor-pointer transition-colors ${
                isOpen ? "bg-blue-50/70 border-blue-200" : "bg-white border-slate-200 hover:bg-slate-50/80"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
                <span className="font-semibold text-slate-900 text-sm truncate">{a.name}</span>
              </div>
              <span className="inline-flex items-center justify-self-start rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums bg-slate-100 text-slate-600">
                {a.completed}/{a.total}
              </span>
            </div>

            {isOpen && (
              <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-3 mr-4 my-2">
                <PersonTaskTableToolbar
                  freeText={subFilter.freeText}
                  setFreeText={v => setSubFilter(s => ({ ...s, freeText: v }))}
                  advanced={subFilter.advanced}
                  setAdvanced={v => setSubFilter(s => ({ ...s, advanced: v }))}
                  fieldOptions={fieldMeta?.fieldOptions || []}
                />
                {/* inline-block + max-w-full — the bordered white box shrinks to exactly the
                table's width (the grey panel shows to its left), and only scrolls if a school
                name is genuinely wider than the panel. */}
                <div className="inline-block align-top max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  {/* width:1px + nowrap cells = the table collapses to exactly its content width. */}
                  <table className="text-sm" style={{ width: "1px" }}>
                    <thead>
                      <tr className="bg-white text-slate-700 font-bold text-xs border-b border-slate-200 divide-x divide-slate-200/60">
                        {cols.map(col => (
                          <th
                            key={col.key}
                            scope="col"
                            className={`${col.key === "status" || col.key === "metric" ? "text-center" : "text-right"} py-2 px-3 whitespace-nowrap`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              <ColumnFilterButton
                                col={col}
                                filter={subFilter.columnFilters[col.key]}
                                onFilterChange={v => setColFilter(col.key, v)}
                                sortDir={subFilter.sortSpec?.key === col.key ? subFilter.sortSpec.dir : null}
                                onSort={dir => setColSort(col.key, dir)}
                                distinctOptions={col.kind === "enum" ? distinctFor(a.targets, col) : undefined}
                              />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr><td colSpan={cols.length} className="py-4 px-3 text-center text-xs text-slate-400">אין בתי ספר תואמים</td></tr>
                      ) : rows.map(t => (
                        <tr key={t.id} className="border-b border-slate-200/60 text-slate-900 last:border-b-0 divide-x divide-slate-200/60">
                          {cols.map(col => (
                            <td
                              key={col.key}
                              className={`${col.key === "status" || col.key === "metric" ? "text-center" : "text-right"} py-2 px-3 text-sm ${col.key === "stage_label" ? "text-slate-600" : ""} whitespace-nowrap`}
                            >
                              <SchoolCellValue col={col} t={t} taskId={taskId} metric={metric} taskName={task.name} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
