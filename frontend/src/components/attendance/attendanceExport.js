import * as XLSX from "xlsx";
import {
  DAY_TYPE_LABEL,
  WEEKDAY_HE,
  HEBREW_MONTHS,
  formatMinutes,
  monthKeyLabel,
  monthSummary,
} from "./attendanceConstants";

const HEADERS = ["עובד", "תאריך", "יום", "סוג", "שעת התחלה", "שעת סיום", "שעות עבודה", "הערות"];

// ייצוא גיליון RTL אחד: בלוק שורות לכל עובד + שורת סיכום. משמש גם בניהול (כל העובדים)
// וגם באזור האישי (עובד אחד). users = [{ name, entries }].
export function exportAttendanceXlsx({ month, users, filenamePrefix = "שעון_נוכחות" }) {
  const rows = [HEADERS];
  for (const u of users) {
    const name = u.name || "";
    const sorted = [...(u.entries || [])].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    for (const e of sorted) {
      const d = new Date(e.entry_date + "T00:00:00");
      rows.push([
        name,
        `${e.entry_date.slice(8)}/${e.entry_date.slice(5, 7)}/${e.entry_date.slice(0, 4)}`,
        WEEKDAY_HE[d.getDay()],
        DAY_TYPE_LABEL[e.day_type] || e.day_type || "",
        e.start_time || "",
        e.end_time || "",
        e.work_minutes != null ? formatMinutes(e.work_minutes) : "",
        e.notes || "",
      ]);
    }
    const s = monthSummary(u.entries || []);
    rows.push([
      `${name} — סיכום`,
      "",
      "",
      "",
      "",
      "סה״כ",
      formatMinutes(s.totalWorkMinutes),
      `ימי עבודה: ${s.workDays} | מחלה: ${s.sickDays} | מילואים: ${s.reserveDays} | חופש: ${s.vacationDays} | ממוצע/יום: ${formatMinutes(s.avgMinutesPerDay)}`,
    ]);
    rows.push(["", "", "", "", "", "", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 12 }, { wch: 8 }, { wch: 14 },
    { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 48 },
  ];
  ws["!views"] = [{ rightToLeft: true, workbookViewId: 0 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, monthKeyLabel(month, HEBREW_MONTHS));
  XLSX.writeFile(wb, `${filenamePrefix}_${month}.xlsx`);
}
