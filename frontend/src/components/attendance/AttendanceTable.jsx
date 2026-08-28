import AttendanceRow from "./AttendanceRow";

// טבלת שעון נוכחות משותפת לאזור האישי ולניהול. שורה לכל יום קלנדרי בחודש.
// גריד אחיד לכל העמודות (קווי הפרדה + רקע תכלת); הכותרות דביקות (sticky) בזמן גלילה.
export default function AttendanceTable({
  days,
  entriesByDate,
  typeFilter = "",
  readOnly = false,
  onSaveDay,
  onDeleteDay,
  onOpenNotes,
  onOpenFiles,
}) {
  const rows = typeFilter
    ? days.filter((d) => entriesByDate[d.date]?.day_type === typeFilter)
    : days;

  const th = "sticky top-0 z-20 bg-white border-b-2 border-l border-slate-200 px-2 py-2.5 text-slate-500";

  return (
    // dir="ltr" מזיז את פס הגלילה האנכי לצד ימין של הטבלה (ב-RTL הוא יושב משמאל);
    // הטבלה עצמה חוזרת ל-rtl. פס הגלילה עבה פי ~1.5 (24px) עם ידית מעוגלת.
    <div
      dir="ltr"
      style={{ scrollbarColor: "#cbd5e1 #f1f5f9", scrollbarWidth: "auto" }}
      className="h-full overflow-auto border border-slate-200 rounded-xl
        [&::-webkit-scrollbar]:w-[22px] [&::-webkit-scrollbar]:h-[22px]
        [&::-webkit-scrollbar-track]:bg-slate-100
        [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full
        [&::-webkit-scrollbar-thumb]:border-4 [&::-webkit-scrollbar-thumb]:border-solid
        [&::-webkit-scrollbar-thumb]:border-slate-100 [&::-webkit-scrollbar-thumb]:bg-clip-content
        hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
    >
      <table dir="rtl" className="w-full min-w-[680px] border-separate border-spacing-0">
        <thead>
          <tr className="text-xs font-semibold">
            <th scope="col" className={`${th} px-3 text-right`}>תאריך</th>
            <th scope="col" className={`${th} text-right`}>סוג</th>
            <th scope="col" className={`${th} text-center`}>שעת התחלה</th>
            <th scope="col" className={`${th} text-center`}>שעת סיום</th>
            <th scope="col" className={`${th} text-center`}>שעות עבודה</th>
            <th scope="col" className={`${th} text-center`}>קבצים</th>
            <th scope="col" className={`${th} text-center`}>הערות</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2 py-6 text-center text-sm text-slate-400 border-b border-slate-200">
                אין ימים להצגה
              </td>
            </tr>
          ) : (
            rows.map((day) => (
              <AttendanceRow
                key={day.date}
                day={day}
                entry={entriesByDate[day.date] || null}
                readOnly={readOnly}
                onSaveDay={onSaveDay}
                onDeleteDay={onDeleteDay}
                onOpenNotes={onOpenNotes}
                onOpenFiles={onOpenFiles}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
