import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DeleteMeetingModal } from "./DeleteMeetingModal";
import { MeetingRow } from "./MeetingRow";
import { MEETING_SERVICE_TYPE_BREAKDOWN, formatMeetingMinutes } from "./constants";
import {
  MeetingColumnMenu,
  computeMeetingFilterValues,
  passesMeetingColumnFilters,
  buildMeetingRowComparator,
} from "./meetingColumnMenu";

function meetingDurationMinutes(m) {
  if (!m.start_time || !m.end_time) return 0;
  const [sh, sm] = m.start_time.split(":").map(Number);
  const [eh, em] = m.end_time.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff : 0;
}

function ReminderHeaderTooltip() {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative inline-flex">
      <span className="cursor-help"
        onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
        תזכורת
      </span>
      {visible && (
        <div role="tooltip"
          className="absolute z-40 text-sm text-slate-800 leading-relaxed p-3 rounded-lg shadow-md pointer-events-none"
          style={{ background: "#FEF08A", border: "1px solid #EAB308", top: "calc(100% + 6px)", left: 0, width: 265, whiteSpace: "normal" }}>
          בהפעלת הכפתור תישלח למשתתפים תזכורת יום לפני קיום הפגישה.
        </div>
      )}
    </div>
  );
}

function ReminderToast({ onClose }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 2500);
    const t2 = setTimeout(() => onClose(), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onClose]);
  return (
    <div className="fixed bottom-6 left-6 z-50" dir="rtl"
      style={{ opacity: fading ? 0 : 1, transition: "opacity 0.5s ease" }}>
      <div className="bg-green-50 border border-green-400 rounded-xl shadow-xl p-4 flex items-start gap-3 max-w-xs">
        <div className="flex-1">
          <p className="text-sm text-green-800 font-semibold mb-0.5">תזכורת הופעלה ✓</p>
          <p className="text-xs text-green-700 leading-snug">תישלח למשתתפים תזכורת יום לפני קיום הפגישה.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="סגור התראה"
          className="text-green-500 hover:text-green-800 text-lg leading-none mt-0.5 transition-colors">×</button>
      </div>
    </div>
  );
}

export function MeetingsTable({
  meetings, usersWithAccess, usersWithoutAccess, usersWithAccessFor, usersWithoutAccessFor,
  contacts, contactsFor, onSave, onDelete, onOpenNotes, onMeetingPatched,
  onRequestAccess, canDeleteMeetings,
  showSchoolColumn, schoolLabelFor, onOpenSchoolPicker,
  selectable, selectedIds, onToggleSelect, onToggleSelectAll,
  onSendStatusReminder, hideAdvisorColumn,
  showCalendarColumn, onOpenSummary, typedAdvisorsFor,
  schoolStage, schoolStageFor,
}) {
  // Excel-style per-column filter + stacked multi-column sort (see meetingColumnMenu.jsx).
  // Local state only — intentionally not persisted, resets on remount / tab change.
  const [columnFilters, setColumnFilters] = useState({}); // { [colKey]: FilterSpec }
  const [sortSpecs, setSortSpecs] = useState([]);          // [{ key, dir }], index 0 = primary
  const [openMenuKey, setOpenMenuKey] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [reminderToast, setReminderToast] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  function toggleExpand(meetingId) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(meetingId)) next.delete(meetingId); else next.add(meetingId);
      return next;
    });
  }

  const colSpanTotal =
    (selectable ? 1 : 0) +
    1 /* כפתור הרחבה */ +
    1 /* תאריך */ +
    1 /* סטטוס */ +
    (showSchoolColumn ? 1 : 0) +
    1 /* התחלה */ +
    1 /* סיום */ +
    (!hideAdvisorColumn ? 1 : 0) +
    1 /* משתתפים */ +
    1 /* מיקום */ +
    1 /* סוג */ +
    1 /* הערות */ +
    1 /* תזכורת */ +
    (showCalendarColumn ? 1 : 0) +
    4 /* בפועל */ +
    1 /* סיכום פגישה */ +
    (canDeleteMeetings ? 1 : 0);

  // One { m, filterValues } per meeting — filterValues feeds both the header menus'
  // value lists and the filter/sort helpers. School label is resolved here so the
  // "שם מוסד" column can be filtered/sorted where it's shown. Memoized so a large meetings
  // list (thousands of rows for a wide filter) isn't fully re-decorated/re-sorted on every
  // unrelated render (e.g. typing into an unrelated row's notes field).
  const rows = useMemo(() => meetings.map(m => ({
    m,
    filterValues: computeMeetingFilterValues(m, {
      schoolLabel: schoolLabelFor ? schoolLabelFor(m) : null,
    }),
  })), [meetings, schoolLabelFor]);

  const sortedMeetings = useMemo(() => rows
    .filter(r => passesMeetingColumnFilters(r.filterValues, columnFilters))
    .sort(buildMeetingRowComparator(sortSpecs))
    .map(r => r.m), [rows, columnFilters, sortSpecs]);

  // Shared props for every header menu. Spread (not an inline wrapper component) so
  // MeetingColumnMenu keeps a stable identity across re-renders and its open/draft state
  // survives parent updates (e.g. typing in the value-search box).
  const colMenuProps = {
    columnFilters, setColumnFilters,
    sortSpecs, setSortSpecs,
    openKey: openMenuKey, setOpenKey: setOpenMenuKey,
    rows,
  };

  const completedMeetings = useMemo(() => meetings.filter(m => m.status === "completed"), [meetings]);
  const totalMinutes = useMemo(
    () => completedMeetings.reduce((sum, m) => sum + meetingDurationMinutes(m), 0),
    [completedMeetings],
  );
  const totalHoursText = formatMeetingMinutes(totalMinutes);

  // Per-service-type breakdown of completed meetings — derived from the live `meetings` prop
  // on every render, so editing a row's "סוג" recomputes these rows immediately (no extra
  // state to go stale). Only buckets with at least one completed meeting are shown.
  const breakdownRows = useMemo(() => {
    const breakdownByType = completedMeetings.reduce((acc, m) => {
      const key = m.meeting_service_type || "none";
      const b = acc[key] || (acc[key] = { count: 0, minutes: 0 });
      b.count += 1;
      b.minutes += meetingDurationMinutes(m);
      return acc;
    }, {});
    return MEETING_SERVICE_TYPE_BREAKDOWN
      .filter(t => breakdownByType[t.key]?.count > 0)
      .map(t => ({ ...t, ...breakdownByType[t.key] }));
  }, [completedMeetings]);

  const allSelected = selectable && sortedMeetings.length > 0 && sortedMeetings.every(m => selectedIds?.[m.id]);

  // Row virtualization — only the rows actually visible in the scroll viewport (~20-30
  // regardless of how many thousands match the filter) are mounted as real <MeetingRow>
  // subtrees at any moment. This is what keeps a wide filter (e.g. a full academic year with
  // no status filter, thousands of results) from freezing the browser, since each row also
  // carries its own live effects (Outlook busy-range checks, reminder-status polling, etc.).
  const tableScrollRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedMeetings.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 45,
    overscan: 12,
    getItemKey: i => sortedMeetings[i]?.id ?? i,
  });

  return (
    <>
      {reminderToast && <ReminderToast onClose={() => setReminderToast(false)} />}
      {pendingDeleteId && (
        <DeleteMeetingModal
          onConfirm={() => { onDelete(pendingDeleteId); setPendingDeleteId(null); }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      {meetings.length > 0 && (
        <p className="text-sm text-slate-500 mb-2">
          {sortedMeetings.length === meetings.length
            ? `סה"כ ${meetings.length} פגישות`
            : `סה"כ ${sortedMeetings.length} פגישות מתוך ${meetings.length}`}
        </p>
      )}
      <div className="glass-card rounded-2xl border border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 240px)" }}>
        <div ref={tableScrollRef} className="flex-1 overflow-auto rounded-t-2xl" style={{ maxHeight: "calc(100vh - 240px)" }}>
          <table className="w-full text-right border-collapse" style={{ minWidth: "1200px" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(241,245,249,0.97)", backdropFilter: "blur(8px)" }}>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {selectable && (
                  <th scope="col" rowSpan={2} className="py-3 px-2 text-center">
                    <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll}
                      aria-label="בחר הכל" className="w-3.5 h-3.5 rounded accent-blue-600" />
                  </th>
                )}
                <th scope="col" rowSpan={2} className="py-3 px-1"><span className="sr-only">הרחבת שורה</span></th>
                <th scope="col" rowSpan={2} className="py-3 px-2 pr-3 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1">תאריך<MeetingColumnMenu {...colMenuProps} colKey="date" label="תאריך" type="date" /></span>
                </th>
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1">סטטוס<MeetingColumnMenu {...colMenuProps} colKey="status" label="סטטוס" type="ordinal" /></span>
                </th>
                {showSchoolColumn && (
                  <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">שם מוסד<MeetingColumnMenu {...colMenuProps} colKey="school" label="שם מוסד" type="text" /></span>
                  </th>
                )}
                <th scope="col" rowSpan={2} className="py-3 pr-2 pl-3 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "100px" }}>
                  <span className="inline-flex items-center gap-1">התחלה<MeetingColumnMenu {...colMenuProps} colKey="start" label="התחלה" type="time" /></span>
                </th>
                <th scope="col" rowSpan={2} className="py-3 px-1 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "52px" }}>
                  <span className="inline-flex items-center gap-1">סיום<MeetingColumnMenu {...colMenuProps} colKey="end" label="סיום" type="time" /></span>
                </th>
                {!hideAdvisorColumn && (
                  <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500">
                    <span className="inline-flex items-center gap-1">יועץ מבצע<MeetingColumnMenu {...colMenuProps} colKey="advisor" label="יועץ מבצע" type="text" /></span>
                  </th>
                )}
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500">משתתפים</th>
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1">מיקום<MeetingColumnMenu {...colMenuProps} colKey="type" label="מיקום" type="text" /></span>
                </th>
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1">סוג<MeetingColumnMenu {...colMenuProps} colKey="service_type" label="סוג" type="text" /></span>
                </th>
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">הערות</th>
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1"><ReminderHeaderTooltip /><MeetingColumnMenu {...colMenuProps} colKey="reminder" label="תזכורת" type="ordinal" /></span>
                </th>
                {showCalendarColumn && (
                  <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "95px" }}>יומן</th>
                )}
                <th scope="col" colSpan={4} className="py-2 px-2 text-xs font-semibold text-slate-500 text-center border-b border-slate-200">בפועל</th>
                <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">סיכום פגישה</th>
                {canDeleteMeetings && <th scope="col" rowSpan={2} className="py-3 px-2 text-xs font-semibold text-slate-500"></th>}
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th scope="col" className="py-1.5 px-2 text-[11px] font-semibold text-slate-500 whitespace-nowrap text-center">תחילת שיחה</th>
                <th scope="col" className="py-1.5 px-2 text-[11px] font-semibold text-slate-500 whitespace-nowrap text-center">משך שיחות</th>
                <th scope="col" className="py-1.5 px-2 text-[11px] font-semibold text-slate-500 whitespace-nowrap text-center">משך אופליין</th>
                <th scope="col" className="py-1.5 px-2 text-[11px] font-semibold text-slate-500 whitespace-nowrap text-center">סה"כ שהושקע</th>
              </tr>
            </thead>
            {(() => {
              const virtualItems = rowVirtualizer.getVirtualItems();
              const totalSize = rowVirtualizer.getTotalSize();
              const padTop = virtualItems.length ? virtualItems[0].start : 0;
              const padBottom = virtualItems.length ? totalSize - virtualItems[virtualItems.length - 1].end : 0;
              return (
                <>
                  {padTop > 0 && (
                    <tbody aria-hidden="true"><tr style={{ height: `${padTop}px` }}><td colSpan={colSpanTotal} style={{ padding: 0, border: 0 }} /></tr></tbody>
                  )}
                  {virtualItems.map(vi => {
                    const m = sortedMeetings[vi.index];
                    if (!m) return null;
                    return (
                      <tbody key={m.id} data-index={vi.index} ref={rowVirtualizer.measureElement}>
                        <MeetingRow meeting={m} onSave={onSave} onMeetingPatched={onMeetingPatched}
                          onRequestDelete={canDeleteMeetings ? setPendingDeleteId : null}
                          onOpenNotes={onOpenNotes}
                          usersWithAccess={usersWithAccessFor ? usersWithAccessFor(m) : usersWithAccess}
                          usersWithoutAccess={usersWithoutAccessFor ? usersWithoutAccessFor(m) : usersWithoutAccess}
                          contacts={contactsFor ? contactsFor(m) : contacts} onRequestAccess={onRequestAccess}
                          onReminderOn={() => setReminderToast(true)}
                          showSchoolColumn={showSchoolColumn}
                          schoolLabel={schoolLabelFor ? schoolLabelFor(m) : null}
                          onOpenSchoolPicker={onOpenSchoolPicker}
                          selectable={selectable}
                          selected={!!selectedIds?.[m.id]}
                          onToggleSelect={onToggleSelect}
                          onSendStatusReminder={onSendStatusReminder}
                          hideAdvisorColumn={hideAdvisorColumn}
                          showCalendarColumn={showCalendarColumn}
                          onOpenSummary={onOpenSummary}
                          typedAdvisors={typedAdvisorsFor ? typedAdvisorsFor(m) : null}
                          schoolStage={schoolStageFor ? schoolStageFor(m) : schoolStage}
                          expanded={expandedIds.has(m.id)}
                          onToggleExpand={toggleExpand}
                          colSpanTotal={colSpanTotal}
                        />
                      </tbody>
                    );
                  })}
                  {padBottom > 0 && (
                    <tbody aria-hidden="true"><tr style={{ height: `${padBottom}px` }}><td colSpan={colSpanTotal} style={{ padding: 0, border: 0 }} /></tr></tbody>
                  )}
                </>
              );
            })()}
          </table>
        </div>
        {/* Summary footer — a 4-column grid (label / value / label / value) so both the
            "סה\"כ שעות ... שבוצעו" labels AND their numeric values each start on their own
            shared vertical line. Every column is max-content, sized to the widest cell across
            all rows, so alignment stays correct dynamically as the breakdown rows change. */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 flex-shrink-0 rounded-b-2xl" dir="rtl">
          <div className="grid gap-y-1.5 items-baseline" style={{ gridTemplateColumns: "max-content max-content max-content max-content" }}>
            {breakdownRows.map(row => (
              <Fragment key={row.key}>
                <span className="text-sm text-slate-500 pe-1">סה"כ פגישות {row.label} שבוצעו:</span>
                <strong className="text-sm text-slate-800 font-semibold pe-6">{row.count}</strong>
                <span className="text-sm text-slate-500 pe-1">סה"כ שעות {row.label} שבוצעו:</span>
                <strong className="text-sm text-slate-800 font-semibold">{formatMeetingMinutes(row.minutes)}</strong>
              </Fragment>
            ))}
            {breakdownRows.length > 0 && (
              <div className="col-span-4 border-t border-slate-200/70 my-0.5" />
            )}
            <span className="text-sm text-slate-500 pe-1">סה"כ פגישות שבוצעו:</span>
            <strong className="text-sm text-slate-800 font-semibold pe-6">{completedMeetings.length}</strong>
            <span className="text-sm text-slate-500 pe-1">סה"כ שעות שבוצעו:</span>
            <strong className="text-sm text-slate-800 font-semibold">{totalHoursText}</strong>
          </div>
        </div>
      </div>
    </>
  );
}
