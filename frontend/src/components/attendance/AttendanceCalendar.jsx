import { useLayoutEffect, useMemo, useRef, useState } from "react";
import AttendanceTable from "./AttendanceTable";
import AttendanceSummary from "./AttendanceSummary";
import AttendanceNotesModal from "./AttendanceNotesModal";
import AttendanceFilesModal from "./AttendanceFilesModal";
import {
  DAY_TYPES,
  HEBREW_MONTHS,
  buildMonthDays,
  monthKeyLabel,
  shiftMonthKey,
} from "./attendanceConstants";

// גוף שעון הנוכחות המשותף: בורר חודש + סינון סוג + באנר נעילה + טבלה + סיכום + מודאלים.
// מקבל את כל פעולות ה-mutation מההורה (אזור אישי / ניהול), שמחזיק את ה-state ומדבר עם ה-API.
// הרכיב מודד את המרחק מראש העמוד ונועל את גובהו לגובה שנותר במסך — כך שרק אזור השורות
// באמצע נגלל, הכותרות למעלה והסיכום למטה קבועים, ואין אזור לבן מיותר לגלול אליו מתחת.
export default function AttendanceCalendar({
  monthKey,
  onMonthChange,
  entries = [],
  lock = { locked: false },
  loading = false,
  error = "",
  readOnly = false,
  bottomGap = 16,
  onSaveDay,
  onDeleteDay,
  onUploadFile,
  onDeleteFile,
  onDownloadFile,
  headerExtra = null,
}) {
  const [typeFilter, setTypeFilter] = useState("");
  const [notesModal, setNotesModal] = useState(null); // { date }
  const [filesModal, setFilesModal] = useState(null); // { date }
  const rootRef = useRef(null);
  const [maxH, setMaxH] = useState(null);

  useLayoutEffect(() => {
    // כל עוד הטאב פתוח — נועלים את גלילת העמוד. אין אזור לבן מתחת שאפשר לגלול אליו;
    // רק אזור השורות הפנימי נגלל. קודם מגלגלים לראש כדי שהמדידה תהיה נכונה.
    window.scrollTo(0, 0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let raf = 0;
    function measure() {
      if (!rootRef.current) return;
      const top = rootRef.current.getBoundingClientRect().top;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      setMaxH(Math.max(360, Math.round(vh - top - bottomGap)));
    }
    measure();
    raf = requestAnimationFrame(measure); // מדידה חוזרת אחרי שהפריסה התייצבה
    window.addEventListener("resize", measure);
    return () => {
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [bottomGap]);

  const days = useMemo(() => buildMonthDays(monthKey), [monthKey]);
  const entriesByDate = useMemo(() => {
    const m = {};
    for (const e of entries) m[e.entry_date] = e;
    return m;
  }, [entries]);

  const effectiveReadOnly = readOnly || lock.locked;

  function dateLabel(dateStr) {
    if (!dateStr) return "";
    const [y, mo, d] = dateStr.split("-");
    return `${Number(d)} ${HEBREW_MONTHS[Number(mo) - 1]} ${y}`;
  }

  function saveNotes(dateStr, text) {
    const e = entriesByDate[dateStr] || {};
    onSaveDay(dateStr, {
      day_type: e.day_type || "work_home",
      start_time: e.start_time || null,
      end_time: e.end_time || null,
      notes: text || null,
    });
    setNotesModal(null);
  }

  const filesForModal = filesModal ? entriesByDate[filesModal.date]?.files || [] : [];

  return (
    <div ref={rootRef} dir="rtl" className="flex flex-col overflow-hidden" style={{ height: maxH ? `${maxH}px` : undefined }}>
      {/* סרגל קבוע: בורר חודש + סינון + תוספות של ההורה */}
      <div className="shrink-0 glass-card rounded-xl p-3 mb-2 flex flex-wrap items-end gap-4">
        <div>
          <span className="block text-xs font-medium text-slate-500 mb-1">חודש</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMonthChange(shiftMonthKey(monthKey, -1))}
              aria-label="חודש קודם"
              className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-slate-700 min-w-[7rem] text-center">
              {monthKeyLabel(monthKey, HEBREW_MONTHS)}
            </span>
            <button
              type="button"
              onClick={() => onMonthChange(shiftMonthKey(monthKey, 1))}
              aria-label="חודש הבא"
              className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              ›
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="att-type-filter" className="block text-xs font-medium text-slate-500 mb-1">
            סוג
          </label>
          <select
            id="att-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white"
          >
            <option value="">הכל</option>
            {DAY_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        {headerExtra}
      </div>

      {lock.locked && (
        <div
          role="status"
          className="shrink-0 text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2 mb-2"
        >
          החודש נעול לעריכה
          {lock.locked_by_name ? ` על־ידי ${lock.locked_by_name}` : ""}. ניתן לצפייה בלבד.
        </div>
      )}

      {error && (
        <div role="alert" className="shrink-0 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" aria-label="טוען נתוני נוכחות" className="flex-1 flex items-center justify-center text-sm text-slate-400">
          טוען…
        </div>
      ) : (
        <>
          {/* אזור גלילה: רק הוא נע. הכותרות בתוכו דביקות (sticky) והסיכום למטה קבוע. */}
          <div className="flex-1 min-h-0">
            <AttendanceTable
              days={days}
              entriesByDate={entriesByDate}
              typeFilter={typeFilter}
              readOnly={effectiveReadOnly}
              onSaveDay={onSaveDay}
              onDeleteDay={onDeleteDay}
              onOpenNotes={(day) => setNotesModal({ date: day.date })}
              onOpenFiles={(day) => setFilesModal({ date: day.date })}
            />
          </div>
          <div className="shrink-0">
            <AttendanceSummary entries={entries} />
          </div>
        </>
      )}

      {notesModal && (
        <AttendanceNotesModal
          dateLabel={dateLabel(notesModal.date)}
          value={entriesByDate[notesModal.date]?.notes || ""}
          readOnly={effectiveReadOnly}
          onSave={(text) => saveNotes(notesModal.date, text)}
          onClose={() => setNotesModal(null)}
        />
      )}

      {filesModal && (
        <AttendanceFilesModal
          dateLabel={dateLabel(filesModal.date)}
          files={filesForModal}
          readOnly={effectiveReadOnly}
          onUpload={(file) => onUploadFile(filesModal.date, file)}
          onDelete={(fileId) => onDeleteFile(filesModal.date, fileId)}
          onDownload={(fileRec) => onDownloadFile(filesModal.date, fileRec)}
          onClose={() => setFilesModal(null)}
        />
      )}
    </div>
  );
}
