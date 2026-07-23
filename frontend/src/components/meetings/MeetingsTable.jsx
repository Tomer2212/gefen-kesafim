import { useEffect, useState } from "react";
import { DeleteMeetingModal } from "./DeleteMeetingModal";
import { MeetingRow } from "./MeetingRow";
import { STATUS_SORT_ORDER } from "./constants";

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
  meetings, usersWithAccess, usersWithoutAccess, contacts, contactsFor, onSave, onDelete, onOpenNotes,
  onRequestAccess, canDeleteMeetings,
  showSchoolColumn, schoolLabelFor, onOpenSchoolPicker,
  selectable, selectedIds, onToggleSelect, onToggleSelectAll,
  onSendStatusReminder, hideAdvisorColumn,
  showCalendarColumn, onOpenSummary,
}) {
  const [sortField, setSortField] = useState(null); // null | "date" | "status" | "advisor" | "type"
  const [sortDir, setSortDir]   = useState("asc");
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [reminderToast, setReminderToast] = useState(false);

  function handleSort(field) {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortField(null); setSortDir("asc"); }
  }

  function getSortIcon(field) {
    if (sortField !== field) return <span className="text-slate-300 ml-0.5">⇅</span>;
    return sortDir === "asc"
      ? <span className="text-blue-500 ml-0.5">↑</span>
      : <span className="text-blue-500 ml-0.5">↓</span>;
  }

  const sortedMeetings = [...meetings].sort((a, b) => {
    if (!sortField) return 0;
    let va, vb;
    if (sortField === "date") {
      va = a.meeting_date || ""; vb = b.meeting_date || "";
    } else if (sortField === "status") {
      va = STATUS_SORT_ORDER[a.status] ?? 3;
      vb = STATUS_SORT_ORDER[b.status] ?? 3;
    } else if (sortField === "advisor") {
      const ap = a.advisor_profiles?.[0]; const bp = b.advisor_profiles?.[0];
      va = (ap?.full_name || ap?.email || "ת"); vb = (bp?.full_name || bp?.email || "ת");
    } else if (sortField === "type") {
      va = a.meeting_type || ""; vb = b.meeting_type || "";
    }
    const cmp = typeof va === "number" ? va - vb : va.localeCompare(vb, "he");
    return sortDir === "asc" ? cmp : -cmp;
  });

  const completedMeetings = meetings.filter(m => m.status === "completed");
  const totalMinutes = completedMeetings.reduce((sum, m) => {
    if (!m.start_time || !m.end_time) return sum;
    const [sh, sm] = m.start_time.split(":").map(Number);
    const [eh, em] = m.end_time.split(":").map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return sum + (diff > 0 ? diff : 0);
  }, 0);
  const totalHoursText = totalMinutes === 0
    ? "—"
    : (() => {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        if (h === 0) return `${m} דק'`;
        if (m === 0) return `${h} שעות`;
        return `${h}:${String(m).padStart(2, "0")} שעות`;
      })();

  function SortableHeader({ field, children }) {
    return (
      <button type="button" onClick={() => handleSort(field)}
        className="flex items-center gap-0.5 text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors cursor-pointer">
        {children}{getSortIcon(field)}
      </button>
    );
  }

  const allSelected = selectable && sortedMeetings.length > 0 && sortedMeetings.every(m => selectedIds?.[m.id]);

  return (
    <>
      {reminderToast && <ReminderToast onClose={() => setReminderToast(false)} />}
      {pendingDeleteId && (
        <DeleteMeetingModal
          onConfirm={() => { onDelete(pendingDeleteId); setPendingDeleteId(null); }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      <div className="glass-card rounded-2xl border border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 240px)" }}>
        <div className="flex-1 overflow-x-auto rounded-t-2xl">
          <table className="w-full text-right border-collapse" style={{ minWidth: "1200px" }}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {selectable && (
                  <th scope="col" className="py-3 px-2 text-center">
                    <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll}
                      aria-label="בחר הכל" className="w-3.5 h-3.5 rounded accent-blue-600" />
                  </th>
                )}
                <th scope="col" className="py-3 px-2 pr-3 text-xs font-semibold text-slate-500">
                  <SortableHeader field="date">תאריך</SortableHeader>
                </th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <SortableHeader field="status">סטטוס</SortableHeader>
                </th>
                {showSchoolColumn && (
                  <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">שם מוסד</th>
                )}
                <th scope="col" className="py-3 pr-2 pl-3 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "100px" }}>התחלה</th>
                <th scope="col" className="py-3 px-1 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "52px" }}>סיום</th>
                {!hideAdvisorColumn && (
                  <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                    <SortableHeader field="advisor">יועץ מבצע</SortableHeader>
                  </th>
                )}
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">משתתפים</th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <SortableHeader field="type">מיקום</SortableHeader>
                </th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">הערות</th>
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">
                  <ReminderHeaderTooltip />
                </th>
                {showCalendarColumn && (
                  <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap" style={{ width: "95px" }}>יומן</th>
                )}
                <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">סיכום פגישה</th>
                {canDeleteMeetings && <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500"></th>}
              </tr>
            </thead>
            <tbody>
              {sortedMeetings.map(m => (
                <MeetingRow key={m.id} meeting={m} onSave={onSave}
                  onRequestDelete={canDeleteMeetings ? setPendingDeleteId : null}
                  onOpenNotes={onOpenNotes}
                  usersWithAccess={usersWithAccess} usersWithoutAccess={usersWithoutAccess}
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
                />
              ))}
            </tbody>
          </table>
        </div>
        {/* Summary footer */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 flex items-center gap-6 flex-shrink-0 rounded-b-2xl" dir="rtl">
          <span className="text-sm text-slate-500">
            סה"כ פגישות שבוצעו: <strong className="text-slate-800 font-semibold">{completedMeetings.length}</strong>
          </span>
          <span className="text-sm text-slate-500">
            סה"כ שעות שבוצעו: <strong className="text-slate-800 font-semibold">{totalHoursText}</strong>
          </span>
        </div>
      </div>
    </>
  );
}
