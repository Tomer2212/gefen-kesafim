import { useCallback, useState } from "react";
import { CallRow } from "./CallRow";
import { useRowVirtualizer } from "../../hooks/useRowVirtualizer";
import { VirtualRows } from "../common/VirtualRows";

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

export function CallsTable({ calls, hideSchoolColumn, hideAdvisorColumn, canManage = true, schoolId }) {
  const [sortField, setSortField] = useState("start_time");
  const [sortDir, setSortDir] = useState("desc");
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const visibleCalls = calls.filter(c => !removedIds.has(c.call_id));
  const numColumns = 14 - (hideSchoolColumn ? 1 : 0) - (hideAdvisorColumn ? 1 : 0);

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

  const rows = sortedCalls.map(c => ({ type: "call", call: c }));

  const handleRowDelete = useCallback(id => setRemovedIds(prev => new Set(prev).add(id)), []);

  const { scrollRef, virtualizer, items, padTop, padBottom } = useRowVirtualizer(rows, {
    estimateSize: 44,
    getItemKey: r => r.call.call_id,
  });

  return (
    <div className="glass-card rounded-2xl border border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 320px)" }}>
      <div ref={scrollRef} className="flex-1 overflow-auto rounded-t-2xl" style={{ maxHeight: "calc(100vh - 320px)" }}>
        <table className="w-full text-right border-collapse" style={{ minWidth: "1200px" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(248,250,252,0.97)", backdropFilter: "blur(8px)" }}>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">תאריך</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">
                <SortableHeader field="start_time" sortField={sortField} sortDir={sortDir} onSort={handleSort}>שעת התחלה</SortableHeader>
              </th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">שעת סיום</th>
              <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">
                <SortableHeader field="duration_seconds" sortField={sortField} sortDir={sortDir} onSort={handleSort}>משך שיחה</SortableHeader>
              </th>
              {!hideAdvisorColumn && (
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">יועץ</th>
              )}
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
          <VirtualRows
            items={items}
            padTop={padTop}
            padBottom={padBottom}
            colSpan={numColumns}
            measureElement={virtualizer.measureElement}
            rows={rows}
            rowKey={r => r.call.call_id}
          >
            {row => (
              <CallRow call={row.call} hideSchoolColumn={hideSchoolColumn} hideAdvisorColumn={hideAdvisorColumn}
                canManage={canManage} schoolId={schoolId} onDelete={handleRowDelete} />
            )}
          </VirtualRows>
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
