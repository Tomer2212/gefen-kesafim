import { useMemo, useState } from "react";
import axios from "axios";
import TaskRow from "./TaskRow";
import ColumnFilterButton from "./ColumnFilterButton";
import { ALL_TASK_COLUMNS, matchesColumnFilter } from "./taskColumns";
import { DeleteMeetingModal } from "../meetings/DeleteMeetingModal";

const TIER_ORDER = { active: 0, archived: 1, scheduled: 2 };

// Default sort (confirmed spec): pinned tasks always float to the very top (most-recently-
// pinned first), then open -> closed -> scheduled, and within each tier ascending progress %
// (neediest first), tie-broken by newest-created-first. Used whenever no column sort is active.
function defaultCompare(a, b) {
  const aPinned = !!a.pinned_at, bPinned = !!b.pinned_at;
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  if (aPinned && bPinned) return (b.pinned_at || "").localeCompare(a.pinned_at || "");
  const tierDiff = (TIER_ORDER[a.status] ?? 3) - (TIER_ORDER[b.status] ?? 3);
  if (tierDiff !== 0) return tierDiff;
  const pctDiff = (a.cached_progress_pct ?? 0) - (b.cached_progress_pct ?? 0);
  if (pctDiff !== 0) return pctDiff;
  return (b.created_at || "").localeCompare(a.created_at || "");
}

// Redesigned "משימות" table — mirrors DashboardPage.jsx's table conventions at a scope sized for
// 13 columns: a per-column funnel (sort + type-adapted filter, ColumnFilterButton.jsx) instead
// of a filter bar above the table, an "עמודות להצגה" visibility picker (ColumnPickerButton.jsx),
// a per-row expand toggle (TaskRow.jsx), and a shared delete-confirm modal.
export default function TasksTable({ tasks, onChanged, onTaskRefreshed, colVisible }) {
  const [expandedId, setExpandedId] = useState(null); // single-open accordion — matches the
  // "dive into one task at a time" intent from the product spec; toggling a second row closes
  // the first rather than stacking multiple heavy per-school tables on screen at once.
  const [columnFilters, setColumnFilters] = useState({}); // {[colKey]: FilterSpec}
  const [sortSpec, setSortSpec] = useState(null); // null = default tiered sort; else {key, dir}
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const visibleColumns = ALL_TASK_COLUMNS.filter(c => colVisible[c.key]);

  function toggleExpand(taskId) {
    setExpandedId(prev => (prev === taskId ? null : taskId));
  }

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

  const distinctByColumn = useMemo(() => {
    const map = {};
    for (const col of ALL_TASK_COLUMNS) {
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
    ALL_TASK_COLUMNS.every(col => matchesColumnFilter(t, col, columnFilters[col.key])),
  ), [tasks, columnFilters]);

  const sorted = useMemo(() => {
    const withPin = [...filtered].sort((a, b) => {
      const aPinned = !!a.pinned_at, bPinned = !!b.pinned_at;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      if (!sortSpec) return defaultCompare(a, b);
      const col = ALL_TASK_COLUMNS.find(c => c.key === sortSpec.key);
      const av = col.getValue(a), bv = col.getValue(b);
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = (av ?? "").toString().localeCompare((bv ?? "").toString(), "he");
      return sortSpec.dir === "asc" ? cmp : -cmp;
    });
    return withPin;
  }, [filtered, sortSpec]);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await axios.delete(`/tasks/${pendingDeleteId}`);
      setPendingDeleteId(null);
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="glass-card rounded-2xl border border-slate-200 flex flex-col">
      <div className="overflow-auto rounded-2xl max-h-[70vh]">
          <table className="w-full text-sm min-w-[1100px] border-collapse">
            <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(241,245,249,0.97)", backdropFilter: "blur(8px)" }}>
              <tr className="border-b border-slate-200">
                <th scope="col" className="px-2 py-3" aria-hidden="true" />
                {visibleColumns.map(col => (
                  <th key={col.key} scope="col" className="px-3 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">
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
                <th scope="col" className="px-2 py-3" aria-hidden="true" />
              </tr>
            </thead>
            <tbody className="bg-white">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + 2} className="text-sm text-slate-400 p-8 text-center">
                    אין משימות תואמות לסינון הנוכחי
                  </td>
                </tr>
              ) : sorted.map(t => (
                <TaskRow
                  key={t.id}
                  task={t}
                  visibleColumns={visibleColumns}
                  expanded={expandedId === t.id}
                  onToggleExpand={toggleExpand}
                  onChanged={onChanged}
                  onTaskRefreshed={onTaskRefreshed}
                  onRequestDelete={setPendingDeleteId}
                />
              ))}
            </tbody>
          </table>
        </div>

      {pendingDeleteId && (
        <DeleteMeetingModal
          titleText="מחיקת משימה"
          confirmText="האם למחוק את המשימה לצמיתות? לא ניתן לשחזר פעולה זו."
          onConfirm={confirmDelete}
          onCancel={() => !deleting && setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}
