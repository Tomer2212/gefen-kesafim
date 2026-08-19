import { Fragment, useEffect, useState } from "react";
import axios from "axios";
import { metricDescription, STAGE_LABELS } from "./PersonTaskDetailContent";

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

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 bg-slate-50 rounded-xl p-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm text-slate-700">
          {task.description && (
            <>
              <span className="text-slate-500">הסבר משימה</span>
              <span>{task.description}</span>
            </>
          )}
          <span className="text-slate-500">מדד הצלחה</span>
          <span>{metricDescription(metric, fieldMeta)}</span>
        </div>
        <span className="font-semibold text-blue-700 text-xs whitespace-nowrap">{task.cached_progress_pct ?? 0}% התקדמות</span>
      </div>

      <div className="overflow-x-auto border border-slate-100 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">אחראי ביצוע</th>
              <th scope="col" className="text-center px-3 py-2 font-semibold text-slate-600">סטטוס ביצוע</th>
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {assignees.length === 0 ? (
              <tr><td colSpan={3} className="text-center text-slate-400 text-xs py-6">אין יעדים למשימה זו</td></tr>
            ) : assignees.map(a => {
              const done = a.total > 0 && a.completed === a.total;
              const isOpen = expandedAssignee === a.id;
              return (
                <Fragment key={a.id}>
                  <tr
                    onClick={() => setExpandedAssignee(isOpen ? null : a.id)}
                    className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${done ? "bg-emerald-50/70" : ""}`}
                    aria-expanded={isOpen}
                  >
                    <td className="px-3 py-2 text-slate-800">{a.name}</td>
                    <td className="px-3 py-2 text-center font-semibold text-slate-700">{a.completed}/{a.total}</td>
                    <td className="px-3 py-2 text-center text-slate-400" aria-hidden="true">{isOpen ? "▼" : "◀"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-slate-50 bg-slate-50/40">
                      <td colSpan={3} className="px-3 py-2">
                        {/* Not w-full on purpose — an unbounded "בית ספר" column stretches to
                        fill the whole row, pushing "סטטוס" all the way to the far (left) edge.
                        A fixed-width school column keeps the table compact so "סטטוס" sits
                        right after it, near the seam between the right quarter and the
                        center of the screen instead. */}
                        <table className="text-xs">
                          <thead>
                            <tr>
                              <th scope="col" className="text-right px-2 py-1 font-semibold text-slate-500 w-96">בית ספר</th>
                              <th scope="col" className="text-right px-2 py-1 font-semibold text-slate-500 w-24 whitespace-nowrap">שלב לימוד</th>
                              <th scope="col" className="text-center px-2 py-1 font-semibold text-slate-500 w-20">סטטוס</th>
                              {(metric.kind === "number" || metric.kind === "file") && (
                                <th scope="col" className="text-center px-2 py-1 font-semibold text-slate-500">מדד הצלחה</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {a.targets.map(t => (
                              <tr key={t.id} className="border-t border-slate-100">
                                <td className="px-2 py-1.5 text-slate-700 w-96">
                                  {t.school_name ? [t.school_name, t.symbol, t.authority].filter(Boolean).join(" - ") : task.name}
                                </td>
                                <td className="px-2 py-1.5 text-slate-600 w-24 whitespace-nowrap">{STAGE_LABELS[t.target_division_type] || "—"}</td>
                                <td className="px-2 py-1.5 text-center w-20">
                                  {t.completed
                                    ? <span className="text-emerald-600 font-bold" aria-label="הושלם">✓</span>
                                    : <span className="text-red-500 font-bold" aria-label="לא הושלם">✕</span>}
                                </td>
                                {(metric.kind === "number" || metric.kind === "file") && (
                                  <td className="px-2 py-1.5 text-center">
                                    <MetricValueDisplay taskId={taskId} target={t} metric={metric} />
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
