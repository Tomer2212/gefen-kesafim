import { useState } from "react";
import axios from "axios";
import TaskRowMenu from "./TaskRowMenu";
import TaskRowExpandedDetail from "./TaskRowExpandedDetail";
import { formatDateDMY } from "./taskShared";
import { CHANNEL_SHORT_LABELS } from "./taskColumns";

function formatDateTimeDMY(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `⁦${formatDateDMY(iso.slice(0, 10))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}⁩`;
}

// Renders one generic (non-special-cased) column's <td> — status/name have their own dedicated
// JSX below (status badge, rename UI, pin/warning icons), every other column just needs its
// raw value formatted per column "kind"/key.
function GenericCell({ col, task }) {
  if (col.key === "scheduled_for") {
    return <td className="px-3 py-2 text-slate-700 whitespace-nowrap text-xs">{task.scheduled_for ? <bdi>{formatDateTimeDMY(task.scheduled_for)}</bdi> : "—"}</td>;
  }
  if (col.key === "created_at") {
    return <td className="px-3 py-2 text-slate-700 whitespace-nowrap text-xs"><bdi>{formatDateDMY((task.created_at || "").slice(0, 10))}</bdi></td>;
  }
  if (col.key === "channel") {
    return <td className="px-3 py-2 text-slate-700 whitespace-nowrap text-xs">{CHANNEL_SHORT_LABELS[task.message_config?.channel] || "—"}</td>;
  }
  if (col.key === "cached_progress_pct") {
    return <td className="px-3 py-2 text-center text-slate-700 text-xs font-semibold">{task.cached_progress_pct ?? 0}%</td>;
  }
  const raw = col.getValue(task);
  const display = col.kind === "enum" && col.options ? (col.options.find(o => o.value === raw)?.label ?? raw ?? "—") : (raw === "" || raw === null || raw === undefined ? "—" : raw);
  const align = col.kind === "number" ? "text-center" : "";
  return <td className={`px-3 py-2 text-slate-700 whitespace-nowrap text-xs ${align}`}>{display}</td>;
}

// One row of the redesigned Tasks table. Clicking the row (outside the 3-dot menu / rename
// input) toggles inline expansion via TaskRowExpandedDetail, matching TaskMeetingResolutionModal
// .jsx's existing expand/collapse card pattern, just hosted inside a real <table> row.
export default function TaskRow({ task, visibleColumns, expanded, onToggleExpand, onChanged, onTaskRefreshed, onRequestDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name || "");
  const [saving, setSaving] = useState(false);

  const hasProblems = !!task.has_meeting_send_problems;
  const statusLabel = task.status === "scheduled" ? "מתוזמנת" : task.status === "archived" ? "הושלמה" : "פעילה";
  const statusClass = task.status === "scheduled"
    ? "text-blue-700 bg-blue-50"
    : task.status === "archived"
      ? "text-emerald-700 bg-emerald-50"
      : "text-orange-700 bg-orange-50";
  const colSpan = visibleColumns.length + 2; // expand-toggle + visible columns + 3-dot menu

  async function saveRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === task.name) { setRenaming(false); setNameDraft(task.name || ""); return; }
    setSaving(true);
    try {
      await axios.patch(`/tasks/${task.id}`, { name: trimmed });
      onChanged();
    } finally {
      setSaving(false);
      setRenaming(false);
    }
  }

  async function togglePin() {
    if (task.pinned_at) await axios.delete(`/tasks/${task.id}/pin`);
    else await axios.post(`/tasks/${task.id}/pin`);
    onChanged();
  }

  return (
    <>
      <tr
        onClick={() => onToggleExpand(task.id)}
        aria-expanded={expanded}
        className={`border-b border-slate-100 cursor-pointer transition-colors ${hasProblems ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-slate-50"}`}
      >
        <td className="px-2 py-2 text-center text-slate-400" aria-hidden="true">{expanded ? "▼" : "◀"}</td>
        {visibleColumns.map(col => {
          if (col.key === "status") {
            return (
              <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${statusClass}`}>
                  {statusLabel}
                </span>
              </td>
            );
          }
          if (col.key === "name") {
            return (
              <td key={col.key} className="px-3 py-2 text-slate-800 font-medium min-w-[10rem]" onClick={e => renaming && e.stopPropagation()}>
                {renaming ? (
                  <div className="flex items-center gap-1">
                    <label className="sr-only" htmlFor={`task-rename-${task.id}`}>שם משימה</label>
                    <input
                      id={`task-rename-${task.id}`}
                      autoFocus
                      value={nameDraft}
                      onChange={e => setNameDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") { setRenaming(false); setNameDraft(task.name || ""); } }}
                      className="text-sm border border-blue-300 rounded-lg px-2 py-1 flex-1"
                    />
                    <button type="button" onClick={saveRename} disabled={saving} className="text-emerald-600 hover:text-emerald-700 text-xs font-bold px-1">✓</button>
                    <button type="button" onClick={() => { setRenaming(false); setNameDraft(task.name || ""); }} className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1">✕</button>
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5">
                    {task.pinned_at && <span aria-label="נעוצה" title="נעוצה" className="text-blue-500">📌</span>}
                    {hasProblems && <span aria-label="קיימות בעיות שמונעות שליחה" title="קיימות בעיות שמונעות שליחה" className="text-red-500">⚠</span>}
                    {task.name}
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
            onRename={() => setRenaming(true)}
            onTogglePin={togglePin}
            onDelete={() => onRequestDelete(task.id)}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50/40">
          <td colSpan={colSpan} className="px-3 py-3">
            <TaskRowExpandedDetail taskId={task.id} onTaskChange={onTaskRefreshed} />
          </td>
        </tr>
      )}
    </>
  );
}
