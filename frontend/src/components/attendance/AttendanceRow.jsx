import { useEffect, useRef, useState } from "react";
import { TimeInput, normalizeTimeValue } from "../meetings/TimeInput";
import { DAY_TYPES, computeWorkMinutes, formatMinutes } from "./attendanceConstants";

// בשישי/שבת שאין בהם רשומה — "סוג" ריק כברירת מחדל (עד שהמשתמש בוחר משהו).
function draftFromEntry(entry, isWeekend) {
  return {
    day_type: entry?.day_type || (isWeekend ? "" : "work_home"),
    start_time: entry?.start_time || "",
    end_time: entry?.end_time || "",
    notes: entry?.notes || "",
  };
}

function isEmptyDraft(d) {
  return (
    (d.day_type || "work_home") === "work_home" &&
    !d.start_time &&
    !d.end_time &&
    !(d.notes && d.notes.trim())
  );
}

// כל התאים חולקים גריד אחיד: קווי הפרדה אפורים, רקע לבן (בסופ"ש אדום עדין מאוד).
const CELL = "border-b border-l border-slate-200 px-2 py-1.5";

// שורת יום בודד בטבלת שעון הנוכחות. שמירה אוטומטית: "סוג" נשמר מיד; שעות נשמרות ב-blur מהשורה.
export default function AttendanceRow({
  day,
  entry,
  readOnly,
  onSaveDay,
  onDeleteDay,
  onOpenNotes,
  onOpenFiles,
}) {
  const weekend = day.isWeekend;
  const rowRef = useRef(null);
  const [draft, setDraft] = useState(() => draftFromEntry(entry, weekend));
  const lastSavedRef = useRef(JSON.stringify(draftFromEntry(entry, weekend)));

  useEffect(() => {
    const next = draftFromEntry(entry, weekend);
    setDraft(next);
    lastSavedRef.current = JSON.stringify(next);
  }, [entry?.id, entry?.updated_at, weekend]);

  const files = entry?.files || [];
  const workMinutes = computeWorkMinutes(draft.start_time, draft.end_time);

  async function commit(nd) {
    const normalized = {
      ...nd,
      start_time: normalizeTimeValue(nd.start_time) || "",
      end_time: normalizeTimeValue(nd.end_time) || "",
    };
    const curr = JSON.stringify(normalized);
    if (curr === lastSavedRef.current) return;
    lastSavedRef.current = curr;
    setDraft(normalized);
    if (isEmptyDraft(normalized) && entry?.id && files.length === 0) {
      await onDeleteDay(day.date);
      return;
    }
    await onSaveDay(day.date, {
      day_type: normalized.day_type,
      start_time: normalized.start_time || null,
      end_time: normalized.end_time || null,
      notes: normalized.notes || null,
    });
  }

  function handleRowBlur(e) {
    if (rowRef.current?.contains(e.relatedTarget)) return;
    commit(draft);
  }

  function setField(field, val) {
    setDraft((p) => ({ ...p, [field]: val }));
  }

  return (
    <tr
      ref={rowRef}
      onBlur={handleRowBlur}
      className={weekend ? "bg-red-50/70" : "bg-white"}
    >
      <td className={`${CELL} px-3 text-sm text-slate-700 whitespace-nowrap`}>
        <span className="tabular-nums font-medium">{day.date.slice(8)}/{day.date.slice(5, 7)}</span>
        <span className={`mr-2 ${weekend ? "text-red-400 font-medium" : "text-slate-400"}`}>
          {day.weekday}
        </span>
      </td>

      <td className={CELL}>
        <label className="sr-only" htmlFor={`att-type-${day.date}`}>סוג יום {day.date}</label>
        <select
          id={`att-type-${day.date}`}
          value={draft.day_type}
          disabled={readOnly}
          onChange={(e) => {
            const nd = { ...draft, day_type: e.target.value };
            setDraft(nd);
            commit(nd);
          }}
          className="appearance-none text-sm bg-transparent border border-transparent rounded px-1.5 py-1 pe-1.5 outline-none cursor-pointer transition-colors hover:border-slate-300 hover:bg-white focus:border-blue-300 focus:bg-white focus:ring-1 focus:ring-blue-200 disabled:cursor-default disabled:text-slate-500"
        >
          {!draft.day_type && <option value=""></option>}
          {DAY_TYPES.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </td>

      <td className={`${CELL} text-center`}>
        {readOnly ? (
          <span className="text-sm text-slate-700" dir="ltr">{draft.start_time || "—"}</span>
        ) : (
          <div className="mx-auto w-[4.75rem] rounded px-1.5 py-0.5 transition-colors [&_input]:text-center border border-transparent focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200 focus-within:bg-white">
            <TimeInput
              id={`att-start-${day.date}`}
              value={draft.start_time}
              onChange={(v) => setField("start_time", v)}
              ariaLabel={`שעת התחלה ${day.date}`}
            />
          </div>
        )}
      </td>

      <td className={`${CELL} text-center`}>
        {readOnly ? (
          <span className="text-sm text-slate-700" dir="ltr">{draft.end_time || "—"}</span>
        ) : (
          <div className="mx-auto w-[4.75rem] rounded px-1.5 py-0.5 transition-colors [&_input]:text-center border border-transparent focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200 focus-within:bg-white">
            <TimeInput
              id={`att-end-${day.date}`}
              value={draft.end_time}
              onChange={(v) => setField("end_time", v)}
              ariaLabel={`שעת סיום ${day.date}`}
            />
          </div>
        )}
      </td>

      <td className={`${CELL} text-center`}>
        <span
          className={`text-sm font-semibold tabular-nums ${
            workMinutes != null ? "text-slate-800" : "text-slate-400"
          }`}
          dir="ltr"
        >
          {workMinutes != null ? formatMinutes(workMinutes) : "—"}
        </span>
      </td>

      <td className={`${CELL} text-center`}>
        <button
          type="button"
          onClick={() => onOpenFiles(day, entry)}
          aria-label={`קבצים ליום ${day.date}${files.length ? ` (${files.length})` : ""}`}
          className="text-slate-400 hover:text-blue-600 transition-colors text-sm leading-none"
        >
          {files.length ? `📎 ${files.length}` : <span className="text-lg font-light">+</span>}
        </button>
      </td>

      <td className={`${CELL} text-center`}>
        <button
          type="button"
          onClick={() => onOpenNotes(day, entry)}
          aria-label={`הערות ליום ${day.date}`}
          className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none"
        >
          {draft.notes && draft.notes.trim() ? "📝" : <span className="text-lg font-light">+</span>}
        </button>
      </td>
    </tr>
  );
}
