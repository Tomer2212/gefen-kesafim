import { useState } from "react";
import { CallRow, computeEndTimeIso } from "./CallRow";

function SortableHeader({ field, sortField, sortDir, onSort, children }) {
  const icon = sortField !== field
    ? <span className="text-slate-300 ml-0.5">⇅</span>
    : sortDir === "asc"
      ? <span className="text-blue-500 ml-0.5">↑</span>
      : <span className="text-blue-500 ml-0.5">↓</span>;
  return (
    <button type="button" onClick={() => onSort(field)}
      className="flex items-center gap-0.5 text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors cursor-pointer">
      {children}{icon}
    </button>
  );
}

// Groups calls by (advisor, day), and — walking the list in the order it's actually
// displayed on screen — inserts a "gap" marker between two consecutive calls that
// belong to the same advisor and the same day, sized by how long the gap between them
// was. Only meaningful when the list is sorted chronologically (desc by start_time,
// the default) — a gap between two calls that aren't actually adjacent in time would
// be misleading, so this reads directly off screen order rather than re-deriving it.
function buildRowsWithGaps(sortedCalls, showGapRows) {
  if (!showGapRows) return sortedCalls.map(c => ({ type: "call", call: c }));
  const rows = [];
  for (let i = 0; i < sortedCalls.length; i++) {
    const curr = sortedCalls[i];
    rows.push({ type: "call", call: curr });
    const next = sortedCalls[i + 1];
    if (!next) continue;
    const sameAdvisor = curr.advisor_id && curr.advisor_id === next.advisor_id;
    const sameDay = (curr.start_time || "").slice(0, 10) === (next.start_time || "").slice(0, 10);
    if (!sameAdvisor || !sameDay) continue;
    const nextEndIso = computeEndTimeIso(next.start_time, next.duration_seconds);
    const gapMs = new Date(curr.start_time) - new Date(nextEndIso);
    if (gapMs > 0) {
      rows.push({ type: "gap", gapSeconds: gapMs / 1000, key: `gap-${curr.call_id}-${next.call_id}` });
    }
  }
  return rows;
}

function gapHeightPx(gapSeconds) {
  const minutes = gapSeconds / 60;
  const MIN_PX = 3, MAX_PX = 28;
  const clamped = Math.min(Math.max(minutes, 1), 8 * 60);
  const t = Math.log(clamped) / Math.log(8 * 60);
  return Math.round(MIN_PX + t * (MAX_PX - MIN_PX));
}

export function CallsTable({ calls, showGapRows, hideSchoolColumn, canManage = true, schoolId }) {
  const [sortField, setSortField] = useState("start_time");
  const [sortDir, setSortDir] = useState("desc");
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const visibleCalls = calls.filter(c => !removedIds.has(c.call_id));
  const numColumns = 14 - (hideSchoolColumn ? 1 : 0);

  function handleSort(field) {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortField(null); setSortDir("asc"); }
  }

  const sortedCalls = [...visibleCalls].sort((a, b) => {
    if (!sortField) return 0;
    let va, vb;
    if (sortField === "start_time") { va = a.start_time || ""; vb = b.start_time || ""; }
    else if (sortField === "duration_seconds") { va = a.duration_seconds || 0; vb = b.duration_seconds || 0; }
    else if (sortField === "direction") { va = a.direction || ""; vb = b.direction || ""; }
    else if (sortField === "status") { va = a.status || ""; vb = b.status || ""; }
    const cmp = typeof va === "number" ? va - vb : va.localeCompare(vb, "he");
    return sortDir === "asc" ? cmp : -cmp;
  });

  const rows = buildRowsWithGaps(sortedCalls, showGapRows);

  return (
    <div className="glass-card rounded-2xl border border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 320px)" }}>
      <div className="flex-1 overflow-x-auto rounded-t-2xl">
        <table className="w-full text-right border-collapse" style={{ minWidth: "1200px" }}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">תאריך</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">
                <SortableHeader field="start_time" sortField={sortField} sortDir={sortDir} onSort={handleSort}>שעת התחלה</SortableHeader>
              </th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">שעת סיום</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">
                <SortableHeader field="duration_seconds" sortField={sortField} sortDir={sortDir} onSort={handleSort}>משך שיחה</SortableHeader>
              </th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">יועץ</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                <SortableHeader field="direction" sortField={sortField} sortDir={sortDir} onSort={handleSort}>סוג שיחה</SortableHeader>
              </th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">מספר צד שני</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">שם צד שני</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">תפקיד</th>
              {!hideSchoolColumn && (
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">שם מוסד</th>
              )}
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">
                <SortableHeader field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort}>סטטוס</SortableHeader>
              </th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">סיכום AI</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">תמלול</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap"><span className="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => row.type === "gap" ? (
              <tr key={row.key} aria-hidden="true">
                <td colSpan={numColumns} className="p-0">
                  <div style={{ height: `${gapHeightPx(row.gapSeconds)}px`, background: "#16a34a", opacity: 0.5 }} />
                </td>
              </tr>
            ) : (
              <CallRow key={row.call.call_id} call={row.call} hideSchoolColumn={hideSchoolColumn} canManage={canManage} schoolId={schoolId}
                onDelete={id => setRemovedIds(prev => new Set(prev).add(id))} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 flex items-center gap-6 flex-shrink-0 rounded-b-2xl" dir="rtl">
        <span className="text-sm text-slate-500">
          סה"כ שיחות: <strong className="text-slate-800 font-semibold">{visibleCalls.length}</strong>
        </span>
      </div>
    </div>
  );
}
