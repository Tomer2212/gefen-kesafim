import { useEffect, useState } from "react";
import axios from "axios";
import { supabase } from "../../lib/supabase";
import { describeCondition } from "../tasks/taskShared";
import ColumnFilterButton from "../tasks/ColumnFilterButton";
import PersonTaskTableToolbar from "./PersonTaskTableToolbar";
import { makeSchoolColumns, distinctFor, applyPersonTaskFilters, EMPTY_SUB_FILTER } from "./personTaskSchoolFilter";
import FieldMetricEditor, { getSingleCondition } from "./FieldMetricEditor";

export const METRIC_KIND_LABELS = {
  field: "עדכון שדה קיים במערכת",
  checkbox: "סימון ביצוע",
  number: "ערך מספרי",
  file: "העלאת קובץ",
};

// Same STAGE_LABELS mapping task_logic.py already uses for school-tasks' own six-year-split
// display — target_division_type reuses the identical division_type values (tikkon/beinayim/
// yesodi/other), just never "sheshshnati" itself (that's the SCHOOL's stage; a six-year school
// splits INTO tikkon+beinayim rows, it never appears as a target's own division).
export const STAGE_LABELS = { yesodi: "יסודי", beinayim: "חטיבת ביניים", tikkon: "תיכון", other: "אחר" };

// "עדכון שדה קיים במערכת - <שדה + ערך>" for field-kind metrics — describeCondition already
// knows how to render every condition type (field/goal/control_letter) into Hebrew text, given
// the field-options catalog as `meta`. Groups are OR'd (" / "), conditions within a group are
// AND'd (" וגם ").
export function metricDescription(metric, meta) {
  const base = METRIC_KIND_LABELS[metric.kind] || metric.kind;
  if (metric.kind === "field") {
    const groups = metric.criteria?.groups || [];
    const text = groups.map(g => (g.conditions || []).map(c => describeCondition(c, meta)).join(" וגם ")).join(" / ");
    return text ? `${base} - ${text}` : base;
  }
  return metric.label ? `${base} — ${metric.label}` : base;
}

// Shared expanded-detail content for a person-task — hosted by PersonTaskRowExpandedDetail.jsx
// (school-card tab, and directly by אזור אישי). Shows the task's description/metric explanation
// plus a per-target table with a completion action for whichever targets the CURRENT user is an
// assignee on (checkbox/number/file per success_metric.kind — field-based metrics are never
// manually completed, only auto-detected by the recompute-all cron).
//
// `onlyCurrentUser` (אזור אישי): a task can span MANY schools/users beyond the one viewing their
// own personal area — without this filter, expanding the row leaked every other assignee's
// schools to whoever opened it, a real privacy bug (a school-only-relevant-to a co-worker isn't
// this viewer's business). Filters `targets` down to rows the current user is actually part of.
// A shared target (co-assigned advisors on one school+division) still shows BOTH names in
// "אחראי/ים" for that row — that's the intended shared-completion visibility, not a leak.
//
// `scopeSchoolId` (כרטיס בית ספר): same principle, the other direction — a task can target many
// schools, but the school card only has business showing the row for ITS OWN school.
export default function PersonTaskDetailContent({ taskId, onTaskChange, onlyCurrentUser = false, scopeSchoolId = null }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [savingTargetId, setSavingTargetId] = useState(null);
  const [numberDrafts, setNumberDrafts] = useState({});
  const [fieldMeta, setFieldMeta] = useState(null);
  const [uploadingTargetId, setUploadingTargetId] = useState(null);
  const [openNoteIds, setOpenNoteIds] = useState(() => new Set());
  // Free-text / advanced / column-filter / sort state for the schools table (schools-mode,
  // multi-school views only — see showSchoolFilters below).
  const [subFilter, setSubFilter] = useState(EMPTY_SUB_FILTER);

  function loadTask() {
    setLoading(true);
    axios.get(`/person-tasks/${taskId}`, { params: onlyCurrentUser ? { mine_only: true } : undefined })
      .then(r => { setTask(r.data); onTaskChange?.(r.data); })
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTask(); }, [taskId]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data?.session?.user?.id || null);
      setCurrentUserRole(data?.session?.user?.user_metadata?.role || null);
    });
    axios.get("/tasks/field-options").then(r => setFieldMeta({
      fieldOptions: r.data?.fields || [], goalOptions: r.data?.goal_options || [],
      divisionOptions: r.data?.division_options || [], controlLetterFields: r.data?.control_letter_fields || [],
    })).catch(() => {});
  }, []);

  async function completeTarget(targetId, metricValue) {
    setSavingTargetId(targetId);
    try {
      await axios.post(`/person-tasks/${taskId}/targets/${targetId}/complete`, { metric_value: metricValue });
      loadTask();
    } finally {
      setSavingTargetId(null);
    }
  }

  async function uncompleteTarget(targetId) {
    setSavingTargetId(targetId);
    try {
      await axios.post(`/person-tasks/${taskId}/targets/${targetId}/uncomplete`);
      loadTask();
    } finally {
      setSavingTargetId(null);
    }
  }

  async function saveNote(targetId, note) {
    await axios.put(`/person-tasks/${taskId}/targets/${targetId}/note`, { note });
    loadTask();
  }

  // Number-kind "שמירה זמנית" — saves the entered value on the target WITHOUT completing it, so
  // a user can save partial work and come back later; only "שליחה" (completeTarget) marks the
  // target done.
  async function saveDraft(targetId, numericValue) {
    setSavingTargetId(targetId);
    try {
      await axios.patch(`/person-tasks/${taskId}/targets/${targetId}/draft`, { metric_value: { value: Number(numericValue) } });
      loadTask();
    } finally {
      setSavingTargetId(null);
    }
  }

  async function uploadTargetFile(targetId, file) {
    setUploadingTargetId(targetId);
    try {
      const form = new FormData();
      form.append("file", file);
      await axios.post(`/person-tasks/${taskId}/targets/${targetId}/upload`, form);
      loadTask();
    } finally {
      setUploadingTargetId(null);
    }
  }

  async function deleteTargetFile(targetId) {
    setUploadingTargetId(targetId);
    try {
      await axios.delete(`/person-tasks/${taskId}/targets/${targetId}/upload`);
      loadTask();
    } finally {
      setUploadingTargetId(null);
    }
  }

  // Same axios-blob-download pattern used everywhere else in the app a file lives behind an
  // authenticated proxy endpoint (e.g. AdminPage.jsx's downloadControlLetterFile) — a plain
  // <a href> can't carry the axios interceptor's auth header.
  async function downloadTargetFile(targetId, filename) {
    try {
      const res = await axios.get(`/person-tasks/${taskId}/targets/${targetId}/file`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "file";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal */
    }
  }

  // When filtering to the current user's own targets, never render before currentUserId itself
  // has loaded — otherwise there'd be a brief flash of every OTHER assignee's schools too,
  // exactly the leak this filter exists to prevent.
  if (loading || (onlyCurrentUser && !currentUserId)) {
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
  let targets = task.targets || [];
  if (onlyCurrentUser && currentUserId) targets = targets.filter(t => (t.assignee_ids || []).includes(currentUserId));
  if (scopeSchoolId) targets = targets.filter(t => t.school_id === scopeSchoolId);

  // Both אזור אישי and כרטיס בית ספר want the same compact, centered layout — the school-card
  // host additionally drops the "בית ספר" column entirely (every row here is already scoped to
  // ITS OWN school, so repeating the name adds nothing, unlike אזור אישי where a task can still
  // span many schools).
  const compact = onlyCurrentUser || !!scopeSchoolId;
  const hideSchoolColumn = !!scopeSchoolId;

  // task.cached_progress_pct is ORG-WIDE (or, when onlyCurrentUser, already overwritten
  // server-side to the personal figure — see get_person_task's mine_only branch). Neither of
  // those is right for כרטיס בית ספר: the summary badge here must match SchoolTasksTab.jsx's own
  // outer-row percentage exactly (computed only from THIS school's targets — see its
  // docstring), or the two numbers visibly disagree the instant a row is expanded.
  const displayPct = scopeSchoolId
    ? (targets.length ? Math.round((targets.filter(t => t.completed).length / targets.length) * 10000) / 100 : 0)
    : (task.cached_progress_pct ?? 0);

  // Identity-column search/filter/sort — only where there are actually many schools to sift
  // through: schools-mode, and not the single-school card (hideSchoolColumn).
  const showSchoolFilters = task.assignment_mode === "schools" && !hideSchoolColumn;
  const filterCols = makeSchoolColumns({ hasMetricCol: false });
  const colBy = Object.fromEntries(filterCols.map(c => [c.key, c]));
  const displayTargets = showSchoolFilters ? applyPersonTaskFilters(targets, subFilter, filterCols) : targets;

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
  // Plain helper (NOT a nested component) — returning a stable element tree keeps
  // ColumnFilterButton mounted across re-renders so its open popover doesn't collapse mid-click.
  function headerFilter(colKey) {
    const col = colBy[colKey];
    if (!showSchoolFilters || !col) return null;
    return (
      <ColumnFilterButton
        col={col}
        filter={subFilter.columnFilters[col.key]}
        onFilterChange={v => setColFilter(col.key, v)}
        sortDir={subFilter.sortSpec?.key === col.key ? subFilter.sortSpec.dir : null}
        onSort={dir => setColSort(col.key, dir)}
        distinctOptions={col.kind === "enum" ? distinctFor(targets, col) : undefined}
      />
    );
  }

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
        <span className="font-semibold text-blue-700 text-xs whitespace-nowrap">{displayPct}% התקדמות</span>
      </div>

      {/* onlyCurrentUser (אזור אישי): not w-full on purpose — an unbounded table stretches
      across the whole row; a fixed-width school column keeps it hugging the right side of the
      screen instead (same principle as PersonTaskAdminDetailContent.jsx's own table). The
      "אחראי/ים" column is also dropped there — in a personal view it's always the current user,
      showing it adds nothing. */}
      {showSchoolFilters && (
        <PersonTaskTableToolbar
          freeText={subFilter.freeText}
          setFreeText={v => setSubFilter(s => ({ ...s, freeText: v }))}
          advanced={subFilter.advanced}
          setAdvanced={v => setSubFilter(s => ({ ...s, advanced: v }))}
          fieldOptions={fieldMeta?.fieldOptions || []}
        />
      )}

      <div className="overflow-x-auto border border-slate-100 rounded-xl">
        <table className={compact ? "text-sm" : "w-full text-sm"}>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {!hideSchoolColumn && (
                <th scope="col" className={`text-right px-3 py-2 font-semibold text-slate-600 ${onlyCurrentUser ? "w-96" : ""}`}>
                  <span className="inline-flex items-center gap-1">
                    {task.assignment_mode === "schools" ? "בית ספר" : "משתמש"}
                    {headerFilter("school_name")}
                  </span>
                </th>
              )}
              {showSchoolFilters && (
                <>
                  <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">עיר {headerFilter("city")}</span>
                  </th>
                  <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">סמל מוסד {headerFilter("symbol")}</span>
                  </th>
                  <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">בעלות {headerFilter("authority")}</span>
                  </th>
                </>
              )}
              {task.assignment_mode === "schools" && !compact && (
                <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">אחראי/ים</th>
              )}
              {task.assignment_mode === "schools" && (
                <>
                  <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">שלב לימוד {headerFilter("stage_label")}</span>
                  </th>
                  <th scope="col" className="text-right px-3 py-2 font-semibold text-slate-600">הערות</th>
                </>
              )}
              <th scope="col" className={`text-center px-3 py-2 font-semibold text-slate-600 ${compact ? "w-32" : ""}`}>
                <span className="inline-flex items-center gap-1">סטטוס {headerFilter("status")}</span>
              </th>
              <th scope="col" className={`text-center px-3 py-2 font-semibold text-slate-600 ${compact ? "w-56" : ""}`}>מדד הצלחה</th>
            </tr>
          </thead>
          <tbody>
            {displayTargets.length === 0 && showSchoolFilters && (
              <tr><td colSpan={12} className="py-4 px-3 text-center text-xs text-slate-400">אין בתי ספר תואמים</td></tr>
            )}
            {displayTargets.map(t => {
              const isAssignee = currentUserId && (t.assignee_ids || []).includes(currentUserId);
              const canUndo = t.completed && isAssignee && (metric.kind === "checkbox" || metric.kind === "number");
              // Field-kind edits (goal/control_letter/year-admin-data) are written through to
              // endpoints gated on SCHOOL access (owner/manager always; advisor only if they
              // have access to this specific school) — NOT on being this person-task's literal
              // assignee, unlike checkbox/number/file completion which really is assignee-only
              // server-side. Restricting the editor to isAssignee alone hid it from an
              // owner/manager who can legitimately write the same field directly from the
              // school's own יעדים/מכתב בקרה tab, just because they personally weren't the one
              // assigned to this task.
              const canEditField = isAssignee || currentUserRole === "owner" || currentUserRole === "manager";
              return (
                <tr key={t.id} className={`border-b border-slate-50 ${t.completed ? "bg-emerald-50/50" : ""}`}>
                  {!hideSchoolColumn && (
                    <td className={`px-3 py-2 text-slate-800 ${onlyCurrentUser ? "w-96" : ""}`}>
                      {task.assignment_mode === "schools"
                        ? (showSchoolFilters
                            ? t.school_name
                            : (onlyCurrentUser
                                ? [t.school_name, t.symbol, t.authority].filter(Boolean).join(" - ")
                                : <>{t.school_name}{t.symbol && <bdi className="text-slate-400 text-xs"> ({t.symbol})</bdi>}</>))
                        : (t.assignee_names || []).join(", ")}
                    </td>
                  )}
                  {showSchoolFilters && (
                    <>
                      <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">{t.city || "—"}</td>
                      <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap"><bdi>{t.symbol || "—"}</bdi></td>
                      <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">{t.authority || "—"}</td>
                    </>
                  )}
                  {task.assignment_mode === "schools" && !compact && (
                    <td className="px-3 py-2 text-slate-600 text-xs">{(t.assignee_names || []).join(" / ")}</td>
                  )}
                  {task.assignment_mode === "schools" && (
                    <>
                      <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">{STAGE_LABELS[t.target_division_type] || "—"}</td>
                      <td className="px-2 py-1.5">
                        {(t.notes || openNoteIds.has(t.id)) ? (
                          <>
                            <label htmlFor={`ptask-note-${t.id}`} className="sr-only">הערה עבור {t.school_name}</label>
                            <textarea
                              id={`ptask-note-${t.id}`}
                              key={`${t.id}-${t.notes || ""}`}
                              rows={2}
                              defaultValue={t.notes || ""}
                              onBlur={e => { if (e.target.value !== (t.notes || "")) saveNote(t.id, e.target.value); }}
                              placeholder="הערה..."
                              className="w-48 text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-lg px-2 py-1 outline-none bg-transparent focus:bg-white resize-y align-top"
                            />
                          </>
                        ) : (
                          <button
                            type="button"
                            aria-label={`הוספת הערה עבור ${t.school_name}`}
                            onClick={() => setOpenNoteIds(prev => new Set(prev).add(t.id))}
                            className="text-sm w-6 h-6 flex items-center justify-center rounded-lg font-bold bg-slate-100 text-slate-500 hover:bg-slate-200"
                          >
                            +
                          </button>
                        )}
                      </td>
                    </>
                  )}
                  <td className={`px-3 py-2 text-center ${compact ? "w-32" : ""}`}>
                    {compact ? (
                      t.completed
                        ? <span className="text-emerald-600 font-bold" aria-label="הושלם">✓</span>
                        : <span className="text-red-500 font-bold" aria-label="לא הושלם">✕</span>
                    ) : t.completed ? (
                      <span className="text-emerald-600 font-bold text-xs">
                        ✓ הושלם{t.completed_by_name ? ` ע"י ${t.completed_by_name}` : ""}
                      </span>
                    ) : (
                      <span className="text-amber-600 font-bold text-xs">טרם הושלם</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-center ${compact ? "w-56" : ""}`}>
                    <div className="flex flex-col items-center gap-1.5">
                      {!t.completed && isAssignee && metric.kind === "checkbox" && (
                        <button
                          type="button"
                          onClick={() => completeTarget(t.id, { checked: true })}
                          disabled={savingTargetId === t.id}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                        >
                          {savingTargetId === t.id ? "שומר..." : "סמן כבוצע"}
                        </button>
                      )}
                      {isAssignee && metric.kind === "number" && (() => {
                        if (t.completed) {
                          // Once submitted the value must stay visible — both to whoever entered
                          // it and (see PersonTaskAdminDetailContent.jsx) to the task creator —
                          // rather than silently vanishing the moment the row shows ✓.
                          return <span className="text-xs text-slate-600">ערך שנשלח: {t.metric_value?.value ?? "—"}</span>;
                        }
                        const draftValue = numberDrafts[t.id] ?? (t.metric_value?.value ?? "");
                        const hasValue = draftValue !== undefined && draftValue !== "";
                        return (
                          <div className="flex flex-col items-center gap-1.5">
                            {metric.label && <span className="text-xs text-slate-500 text-center">{metric.label}</span>}
                            <label className="sr-only" htmlFor={`ptask-num-${t.id}`}>ערך</label>
                            <input
                              id={`ptask-num-${t.id}`}
                              type="number"
                              value={draftValue}
                              onChange={e => setNumberDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                              className="w-24 text-xs border border-slate-200 rounded-lg px-2 py-1 text-center"
                            />
                            <div className="flex items-center gap-1.5 justify-center">
                              <button
                                type="button"
                                onClick={() => saveDraft(t.id, draftValue)}
                                disabled={savingTargetId === t.id || !hasValue}
                                className="text-xs px-2 py-1 rounded-lg font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                              >
                                שמירה זמנית
                              </button>
                              <button
                                type="button"
                                onClick={() => completeTarget(t.id, { value: Number(draftValue) })}
                                disabled={savingTargetId === t.id || !hasValue}
                                className="text-xs px-2.5 py-1 rounded-lg font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                              >
                                שליחה
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                      {canEditField && metric.kind === "field" && (() => {
                        // Deliberately shown even when t.completed — there's no separate manual
                        // "complete" click for field-kind metrics (completion is auto-detected
                        // from the live field value), so this editor IS the only way to correct
                        // a mistake (e.g. the wrong school's goal toggled by accident): toggling
                        // the value back here is what un-completes the row, via the next
                        // recompute pass.
                        const cond = getSingleCondition(metric);
                        if (!cond) return <span className="text-xs text-slate-400">לא ניתן לעריכה כאן — מדד הצלחה מורכב</span>;
                        return (
                          <FieldMetricEditor
                            cond={cond}
                            targetDivisionType={t.target_division_type}
                            schoolId={t.school_id}
                            academicYear={task.academic_year}
                            fieldMeta={fieldMeta}
                            onSaved={loadTask}
                          />
                        );
                      })()}
                      {isAssignee && metric.kind === "file" && (() => {
                        const fileKey = t.metric_value?.file_key;
                        const filename = t.metric_value?.filename;
                        const busy = uploadingTargetId === t.id;
                        if (t.completed) {
                          return (
                            <div className="flex items-center gap-1.5 justify-center flex-wrap">
                              <span className="text-xs text-slate-600 max-w-[8rem] truncate" title={filename}>{filename || "—"}</span>
                              {fileKey && (
                                <button
                                  type="button"
                                  onClick={() => downloadTargetFile(t.id, filename)}
                                  className="text-xs px-2 py-1 rounded-lg font-medium bg-slate-100 text-slate-600 hover:bg-slate-200"
                                >
                                  הורדה
                                </button>
                              )}
                            </div>
                          );
                        }
                        if (!fileKey) {
                          return (
                            <div className="flex items-center gap-1.5 justify-center">
                              {metric.label && <span className="text-xs text-slate-500">{metric.label}</span>}
                              <label
                                htmlFor={`ptask-file-${t.id}`}
                                aria-label="העלאת קובץ"
                                className="cursor-pointer text-sm w-6 h-6 flex items-center justify-center rounded-lg font-bold bg-blue-50 text-blue-700 hover:bg-blue-100"
                              >
                                {busy ? "…" : "+"}
                              </label>
                              <input
                                id={`ptask-file-${t.id}`}
                                type="file"
                                className="sr-only"
                                disabled={busy}
                                onChange={e => { const f = e.target.files?.[0]; if (f) uploadTargetFile(t.id, f); e.target.value = ""; }}
                              />
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center gap-1.5 justify-center flex-wrap">
                            <span className="text-xs text-slate-600 max-w-[8rem] truncate" title={filename}>{filename}</span>
                            <button
                              type="button"
                              onClick={() => deleteTargetFile(t.id)}
                              disabled={busy}
                              className="text-xs px-2 py-1 rounded-lg font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                            >
                              מחיקה
                            </button>
                            <button
                              type="button"
                              onClick={() => completeTarget(t.id, undefined)}
                              disabled={busy || savingTargetId === t.id}
                              className="text-xs px-2.5 py-1 rounded-lg font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                            >
                              שליחה
                            </button>
                          </div>
                        );
                      })()}
                      {canUndo && (
                        <button
                          type="button"
                          onClick={() => uncompleteTarget(t.id)}
                          disabled={savingTargetId === t.id}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                        >
                          {savingTargetId === t.id ? "מבטל..." : "בטל סימון"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
