import { useCallback, useMemo, useState } from "react";
import { CallRow, DEFAULT_STATUS, STATUS_LABELS, callAdvisorLabel, callSchoolCards, computeEndTimeIso, counterpartLabels, formatPhone, linkAnswersPending } from "./CallRow";
import { useRowVirtualizer } from "../../hooks/useRowVirtualizer";
import { VirtualRows } from "../common/VirtualRows";
import { ColumnHeaderFilter, buildRowComparator, dateToNum, describeColumnFilter, passesAllColumnFilters } from "../table/columnFilters";

// Excel-style header filter/sort on every data column (the home screen's shared columnFilters
// module). Each column's filter value is the text the row shows, so what the user searches for
// is what they see. `advisorOnly` / `schoolOnly` columns follow hideAdvisorColumn / hideSchoolColumn.
const CALL_COLUMNS = [
  { key: "date", label: "תאריך", fmt: "date" },
  { key: "start", label: "שעת התחלה", fmt: "time" },
  { key: "end", label: "שעת סיום", fmt: "time" },
  { key: "direction", label: "סוג שיחה", fmt: "text" },
  { key: "status", label: "סטטוס", fmt: "text" },
  { key: "duration", label: "משך שיחה", fmt: "duration" },
  { key: "advisor", label: "יועץ", fmt: "text", advisorOnly: true },
  { key: "phone", label: "מספר צד שני", fmt: "text" },
  { key: "name", label: "שם צד שני", fmt: "text" },
  { key: "role", label: "תפקיד", fmt: "text" },
  { key: "school", label: "שם מוסד", fmt: "textMulti", schoolOnly: true },
];

const PENDING_LABEL = "ממתין לשיוך";
const DIRECTION_LABELS = { outgoing: "יוצאת", incoming: "נכנסת" };

function pad(n) { return String(n).padStart(2, "0"); }

function clockMinutes(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.getHours() * 60 + d.getMinutes() : null;
}

function callFilterValues(call) {
  const start = call.start_time ? new Date(call.start_time) : null;
  const validStart = start && !isNaN(start);
  const counterpart = counterpartLabels(call, call.counterpart_phone);
  const pending = !!call.pending_school_resolution;
  const cards = callSchoolCards(call).map(c => c.name);
  const advisor = callAdvisorLabel(call);
  return {
    date: validStart ? dateToNum(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`) : null,
    start: clockMinutes(call.start_time),
    end: clockMinutes(computeEndTimeIso(call.start_time, call.duration_seconds)),
    direction: DIRECTION_LABELS[call.direction] || "פנימית",
    status: (STATUS_LABELS[call.status] || DEFAULT_STATUS).label,
    duration: call.duration_seconds || 0,
    advisor: advisor === "—" ? null : advisor,
    phone: call.counterpart_phone ? formatPhone(call.counterpart_phone) : null,
    name: counterpart.name || null,
    role: pending ? PENDING_LABEL : (counterpart.role || null),
    school: cards.length ? cards : pending ? [PENDING_LABEL] : call.school_name ? [call.school_name] : [],
  };
}

// No sort chosen = newest call first; a chosen sort falls back to that order on ties.
function compareNewestFirst(a, b) {
  return (b.call.start_time || "").localeCompare(a.call.start_time || "");
}

function applyView(rows, { columnFilters, sortSpecs }) {
  const filtered = rows.filter(r => passesAllColumnFilters(r, columnFilters, CALL_COLUMNS));
  const byColumns = buildRowComparator(sortSpecs, CALL_COLUMNS);
  return filtered.sort((a, b) => byColumns(a, b) || compareNewestFirst(a, b));
}

// Filters + sort of a calls table. Hold it in the page (and pass it as `view`) when the page
// needs it too — the Excel export, a "נקה סינון" that also clears the columns, or keeping the
// filters while the page reloads its calls.
export function useCallsTableView() {
  const [columnFilters, setColumnFilters] = useState({});
  const [sortSpecs, setSortSpecs] = useState([]);
  const clear = useCallback(() => { setColumnFilters({}); setSortSpecs([]); }, []);
  return { columnFilters, setColumnFilters, sortSpecs, setSortSpecs, clear };
}

// The calls in the table's order after its column filters — used by the Excel export so the
// file is exactly what's on screen.
export function callsInView(calls, view) {
  return applyView(calls.map(c => ({ call: c, filterValues: callFilterValues(c) })), view).map(r => r.call);
}

const TH_CLS = "py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap";

// cardNoun: what the card is called in row texts ("בית הספר" / "המחוז" / "הבעלות").
// canLink: offer "שייך שיחה" in the row menu (defaults to canManage — see CallRow).
// onLinked(callId, card): optional — lets the parent keep its own list in step after a link.
// view: optional useCallsTableView() result held by the parent; otherwise the table keeps its own.
export function CallsTable({ calls, hideSchoolColumn, hideAdvisorColumn, canManage = true, canLink = canManage, schoolId, cardNoun = "בית הספר", onLinked, view }) {
  const ownView = useCallsTableView();
  const { columnFilters, setColumnFilters, sortSpecs, setSortSpecs } = view || ownView;
  const [openFilterKey, setOpenFilterKey] = useState(null);
  const [removedIds, setRemovedIds] = useState(() => new Set());
  // Cards linked from a row ("שייך שיחה") since the list was loaded: merged into the call here,
  // so the filters see them at once and a row scrolled out (unmounted) still shows them.
  const [linkedById, setLinkedById] = useState({});
  const numColumns = 14 - (hideSchoolColumn ? 1 : 0) - (hideAdvisorColumn ? 1 : 0);

  const columns = CALL_COLUMNS.filter(c => !(c.advisorOnly && hideAdvisorColumn) && !(c.schoolOnly && hideSchoolColumn));

  const baseRows = useMemo(
    () => calls.filter(c => !removedIds.has(c.call_id)).map(c => {
      const added = (linkedById[c.call_id] || []).filter(card => !(c.linked_schools || []).some(x => x.id === card.id));
      const call = added.length ? {
        ...c,
        linked_schools: [...(c.linked_schools || []), ...added],
        pending_school_resolution: c.pending_school_resolution && !added.some(card => linkAnswersPending(c, card.id)),
      } : c;
      return { call, filterValues: callFilterValues(call) };
    }),
    [calls, removedIds, linkedById],
  );
  const rows = useMemo(() => applyView([...baseRows], { columnFilters, sortSpecs }), [baseRows, columnFilters, sortSpecs]);

  // Each filtered column's distinct values — lets the active-filters bar say "הכל חוץ מ: X".
  const valueFilterOptions = useMemo(() => {
    const out = {};
    for (const key of Object.keys(columnFilters)) {
      const vals = new Set();
      for (const r of baseRows) {
        const v = r.filterValues[key];
        const items = Array.isArray(v) ? v : [v];
        if (items.length === 0) vals.add("__BLANK__");
        for (const x of items) vals.add(x === null || x === undefined || x === "" ? "__BLANK__" : String(x));
      }
      out[key] = [...vals];
    }
    return out;
  }, [columnFilters, baseRows]);

  const hasColumnFilter = Object.keys(columnFilters).length > 0;
  const totalDurationSeconds = rows.reduce((sum, r) => sum + (r.call.duration_seconds || 0), 0);
  const totalHours = Math.floor(totalDurationSeconds / 3600);
  const totalMinutes = Math.floor((totalDurationSeconds % 3600) / 60);

  const handleRowDelete = useCallback(id => setRemovedIds(prev => new Set(prev).add(id)), []);
  const handleLinked = useCallback((callId, card) => {
    setLinkedById(prev => ({ ...prev, [callId]: [...(prev[callId] || []), card] }));
    onLinked?.(callId, card);
  }, [onLinked]);

  const { scrollRef, virtualizer, items, padTop, padBottom } = useRowVirtualizer(rows, {
    estimateSize: 44,
    getItemKey: r => r.call.call_id,
  });

  function removeFilter(key) {
    setColumnFilters(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  function header(col) {
    return (
      <th key={col.key} scope="col" className={TH_CLS}>
        {/* Icon right next to its label — the columns have no borders, so an icon pushed to the
            cell's far edge would read as belonging to the next column. */}
        <div className="inline-flex items-center gap-1">
          <span>{col.label}</span>
          <ColumnHeaderFilter colDef={col} columnFilters={columnFilters} setColumnFilters={setColumnFilters}
            sortSpecs={sortSpecs} setSortSpecs={setSortSpecs} openKey={openFilterKey} setOpenKey={setOpenFilterKey}
            baseDisplayRows={baseRows} allFilterMeta={CALL_COLUMNS} />
        </div>
      </th>
    );
  }

  return (
    <>
      {hasColumnFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100 text-sm" dir="rtl" role="group" aria-label="סינונים פעילים בטבלה">
          <span className="font-medium text-blue-800">סינונים פעילים:</span>
          {Object.entries(columnFilters).map(([key, spec]) => {
            const meta = CALL_COLUMNS.find(c => c.key === key);
            const summary = describeColumnFilter(spec, meta?.fmt, valueFilterOptions[key]);
            return (
              <span key={key} className="inline-flex items-center gap-1 pl-1 pr-2.5 py-0.5 rounded-full bg-white border border-blue-200 text-blue-800">
                <span><span className="font-medium">{meta?.label || key}</span>{summary && `: ${summary}`}</span>
                <button type="button" onClick={() => removeFilter(key)}
                  className="w-5 h-5 rounded-full hover:bg-blue-100 leading-none" aria-label={`הסר סינון: ${meta?.label || key}`}>✕</button>
              </span>
            );
          })}
          <button type="button" onClick={() => setColumnFilters({})} className="mr-auto text-blue-700 underline hover:text-blue-900">נקה סינון</button>
        </div>
      )}
      <div className="glass-card rounded-2xl border border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 320px)" }}>
        <div ref={scrollRef} className="flex-1 overflow-auto rounded-t-2xl" style={{ maxHeight: "calc(100vh - 320px)" }}>
          <table className="w-full text-right border-collapse" style={{ minWidth: "1200px" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(248,250,252,0.97)", backdropFilter: "blur(8px)" }}>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {columns.map(header)}
                <th scope="col" className={TH_CLS}>סיכום AI</th>
                <th scope="col" className={TH_CLS}>תמלול</th>
                <th scope="col" className={TH_CLS}><span className="sr-only">פעולות</span></th>
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
                  canManage={canManage} canLink={canLink} onLinked={handleLinked} schoolId={schoolId} cardNoun={cardNoun} onDelete={handleRowDelete} />
              )}
            </VirtualRows>
          </table>
          {rows.length === 0 && baseRows.length > 0 && (
            <div className="p-8 text-center" dir="rtl">
              <p className="text-slate-500 mb-3">לא נמצאו שיחות התואמות לסינון</p>
              <button type="button" onClick={() => setColumnFilters({})} className="btn-ghost text-sm px-4 py-2">נקה סינון</button>
            </div>
          )}
        </div>
        <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 flex items-center gap-12 flex-shrink-0 rounded-b-2xl" dir="rtl">
          <span className="text-sm text-slate-500">
            <strong className="text-slate-800 font-semibold">סה"כ שיחות:</strong>{" "}
            <span className="text-black">{rows.length}</span>
            {hasColumnFilter && <span className="text-slate-400"> (מתוך {baseRows.length})</span>}
          </span>
          <span className="text-sm text-slate-500">
            <strong className="text-slate-800 font-semibold">משך שיחות כולל:</strong> <span className="text-black">{totalHours} שעות ו-{totalMinutes} דקות</span>
          </span>
        </div>
      </div>
    </>
  );
}
