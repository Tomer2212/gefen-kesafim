import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { supabase } from "../../lib/supabase";
import TaskRowMenu from "../tasks/TaskRowMenu";
import { formatDateDMY } from "../tasks/taskShared";
import PersonTaskRowExpandedDetail from "./PersonTaskRowExpandedDetail";
import { URGENCY_LABELS, responsibleSummary, daysToDeadline } from "./personTaskColumns";

const URGENCY_CLASS = {
  1: "text-slate-500 bg-slate-100",
  2: "text-blue-700 bg-blue-50",
  3: "text-orange-700 bg-orange-50",
  4: "text-red-700 bg-red-50",
};

// Same "banana" yellow tooltip already established for SchoolPage.jsx's CheckLinkTooltip
// (#FEF08A / #EAB308) — shows who the task's assignees are on hover, without needing to expand
// the row.
function AssigneeTooltip({ names, children }) {
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);

  function show() {
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }
  function hide() { setPos(null); }

  useEffect(() => {
    if (!pos) return;
    function onScroll() { hide(); }
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [pos]);

  if (!names?.length) return children;
  return (
    <span ref={anchorRef} className="inline-block" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos && createPortal(
        <span
          role="tooltip"
          className="fixed text-xs text-slate-800 whitespace-pre-line px-3 py-1.5 rounded-lg shadow-md"
          style={{ background: "#FEF08A", border: "1px solid #EAB308", top: pos.top, right: pos.right, zIndex: 200 }}
        >
          {names.join("\n")}
        </span>,
        document.body,
      )}
    </span>
  );
}

function GenericCell({ col, task }) {
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
    return (
      <td className="px-3 py-2 text-slate-700 text-xs whitespace-nowrap">
        <AssigneeTooltip names={task.assignee_names}>
          <span className={task.assignee_names?.length ? "underline decoration-dotted decoration-slate-300 cursor-default" : ""}>
            {responsibleSummary(task)}
          </span>
        </AssigneeTooltip>
      </td>
    );
  }
  const raw = col.getValue(task);
  const display = col.kind === "enum" && col.options ? (col.options.find(o => o.value === raw)?.label ?? raw ?? "—") : (raw === "" || raw === null || raw === undefined ? "—" : raw);
  const align = col.kind === "number" ? "text-center" : "";
  return <td className={`px-3 py-2 text-slate-700 whitespace-nowrap text-xs ${align}`}>{display}</td>;
}

// Mirrors frontend/src/components/tasks/TaskRow.jsx exactly (same status badge/rename/pin/menu
// pattern, same single-open-accordion expand), swapped to /person-tasks/ endpoints and
// PersonTaskRowExpandedDetail for the expanded content.
export default function PersonTaskRow({ task, visibleColumns, expanded, onToggleExpand, onChanged, onTaskRefreshed, onRequestDelete, onRequestEdit, groupByAssignee = false, onlyCurrentUser = false }) {
  const [renaming, setRenaming] = useState(false);
  const displayName = onlyCurrentUser ? (task.display_name ?? task.name) : task.name;
  const [nameDraft, setNameDraft] = useState(displayName || "");
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserId(data?.session?.user?.id || null);
      setCurrentUserRole(data?.session?.user?.user_metadata?.role || null);
    });
  }, []);
  const isCreator = !!currentUserId && currentUserId === task.created_by;
  const canEdit = isCreator;
  // אזור אישי: renaming here only ever sets a personal nickname (no creator/owner requirement —
  // it never touches the real task, so anyone assigned can do it). Everywhere else, the quick
  // "ערוך שם משימה" hits the same creator-gated PATCH the full edit modal does, so it must be
  // gated the same way — otherwise a non-creator sees a rename box that just 403s on save.
  const canRename = onlyCurrentUser || canEdit;
  const canDelete = currentUserRole === "owner" || isCreator;

  const statusLabel = task.status === "archived" ? "הושלמה" : "פעילה";
  const statusClass = task.status === "archived" ? "text-emerald-700 bg-emerald-50" : "text-orange-700 bg-orange-50";
  const colSpan = visibleColumns.length + 2;

  async function saveRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === displayName) { setRenaming(false); setNameDraft(displayName || ""); return; }
    setSaving(true);
    try {
      if (onlyCurrentUser) await axios.put(`/person-tasks/${task.id}/my-name`, { name: trimmed });
      else await axios.patch(`/person-tasks/${task.id}`, { name: trimmed });
      onChanged();
    } finally {
      setSaving(false);
      setRenaming(false);
    }
  }

  async function restoreOriginalName() {
    await axios.delete(`/person-tasks/${task.id}/my-name`);
    onChanged();
  }

  async function togglePin() {
    if (task.pinned_at) await axios.delete(`/person-tasks/${task.id}/pin`);
    else await axios.post(`/person-tasks/${task.id}/pin`);
    onChanged();
  }

  return (
    <>
      <tr
        onClick={() => onToggleExpand(task.id)}
        aria-expanded={expanded}
        className="border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50"
      >
        <td className="px-2 py-2 text-center text-slate-400" aria-hidden="true">{expanded ? "▼" : "◀"}</td>
        {visibleColumns.map(col => {
          if (col.key === "status") {
            return (
              <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${statusClass}`}>{statusLabel}</span>
              </td>
            );
          }
          if (col.key === "name") {
            return (
              <td key={col.key} className="px-3 py-2 text-slate-800 font-medium min-w-[10rem]" onClick={e => renaming && e.stopPropagation()}>
                {renaming ? (
                  <div className="flex items-center gap-1">
                    <label className="sr-only" htmlFor={`ptask-rename-${task.id}`}>שם משימה</label>
                    <input
                      id={`ptask-rename-${task.id}`}
                      autoFocus
                      value={nameDraft}
                      onChange={e => setNameDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") { setRenaming(false); setNameDraft(displayName || ""); } }}
                      className="text-sm border border-blue-300 rounded-lg px-2 py-1 flex-1"
                    />
                    <button type="button" onClick={saveRename} disabled={saving} className="text-emerald-600 hover:text-emerald-700 text-xs font-bold px-1">✓</button>
                    <button type="button" onClick={() => { setRenaming(false); setNameDraft(displayName || ""); }} className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1">✕</button>
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5">
                    {task.pinned_at && <span aria-label="נעוצה" title="נעוצה" className="text-blue-500">📌</span>}
                    {displayName}
                  </span>
                )}
              </td>
            );
          }
          return <GenericCell key={col.key} col={col} task={task} />;
        })}
        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
          <TaskRowMenu
            pinned={!!task.pinned_at}
            onRename={canRename ? (() => setRenaming(true)) : undefined}
            onEdit={canEdit ? () => onRequestEdit(task) : undefined}
            onTogglePin={togglePin}
            onDelete={canDelete ? (() => onRequestDelete(task.id)) : undefined}
            onRestoreName={onlyCurrentUser && task.has_name_override ? restoreOriginalName : undefined}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50/40">
          <td colSpan={colSpan} className="px-3 py-3">
            <PersonTaskRowExpandedDetail taskId={task.id} onTaskChange={onTaskRefreshed} groupByAssignee={groupByAssignee} onlyCurrentUser={onlyCurrentUser} />
          </td>
        </tr>
      )}
    </>
  );
}
