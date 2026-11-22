import * as XLSX from "xlsx";
import {
  STATUS_LABELS, DEFAULT_STATUS, formatDate, formatTime, formatDuration, formatPhone,
  counterpartLabels, computeEndTimeIso, callSchoolCards,
} from "./CallRow";

const DIRECTION_LABELS = { outgoing: "יוצאת", incoming: "נכנסת" };
const PENDING_LABEL = "ממתין לשיוך";

function advisorLabel(call) {
  return call.advisor_profile?.full_name || call.advisor_profile?.email || call.org_phone_label || call.representative_name || "—";
}

// Same as the table's "שם מוסד" cell: matched + manually linked cards, else the pending label.
function schoolCell(call) {
  const cards = callSchoolCards(call);
  if (cards.length) return cards.map(c => c.name).join(", ");
  return call.pending_school_resolution ? PENDING_LABEL : call.school_name || "—";
}

// Exports calls to xlsx with the same values (and column order) CallsTable shows.
// Rows are written in the given order — pass them sorted like the table (`sortCalls`).
export function exportCallsToExcel(calls, { fileName, sheetName = "שיחות", includeAdvisor = false, includeSchool = true }) {
  const columns = [
    { header: "תאריך", wch: 10, value: c => formatDate(c.start_time) },
    { header: "שעת התחלה", wch: 10, value: c => formatTime(c.start_time) },
    { header: "שעת סיום", wch: 10, value: c => formatTime(computeEndTimeIso(c.start_time, c.duration_seconds)) },
    { header: "סוג שיחה", wch: 10, value: c => DIRECTION_LABELS[c.direction] || "פנימית" },
    { header: "סטטוס", wch: 10, value: c => (STATUS_LABELS[c.status] || DEFAULT_STATUS).label },
    { header: "משך שיחה", wch: 10, value: c => formatDuration(c.duration_seconds) },
    ...(includeAdvisor ? [{ header: "יועץ", wch: 20, value: advisorLabel }] : []),
    { header: "מספר צד שני", wch: 14, value: c => formatPhone(c.counterpart_phone) },
    { header: "שם צד שני", wch: 20, value: c => counterpartLabels(c, c.counterpart_phone).name || "—" },
    { header: "תפקיד", wch: 16, value: c => (c.pending_school_resolution ? PENDING_LABEL : counterpartLabels(c, c.counterpart_phone).role || "—") },
    ...(includeSchool ? [{ header: "שם מוסד", wch: 28, value: schoolCell }] : []),
    { header: "סיכום AI", wch: 80, value: c => c.ai_summary || "" },
  ];

  const totalSeconds = calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
  const totalHours = Math.floor(totalSeconds / 3600);
  const totalMinutes = Math.floor((totalSeconds % 3600) / 60);

  const wsData = [
    columns.map(col => col.header),
    ...calls.map(c => columns.map(col => col.value(c))),
    [],
    ['סה"כ שיחות', calls.length],
    ["משך שיחות כולל", `${totalHours} שעות ו-${totalMinutes} דקות`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = columns.map(col => ({ wch: col.wch }));
  ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}
