import { useEffect, useRef, useState } from "react";

// Fixes bug #1: native <input type="date"/"datetime-local"> left-pads a partially-typed
// year with zeros (typing "26" becomes "0026", not "2026") with no JS hook to intercept it
// mid-edit. This component uses separate day/month/year(/hour/minute) fields instead, so a
// 2-digit year can be normalized explicitly on blur.
// Deliberately does NOT reuse DatePickerPopover.jsx — that component is coupled to advisor
// free/busy checking, which is irrelevant for task scheduling/criteria dates.
//
// `dateOnly`: renders just day/month/year and emits "YYYY-MM-DD" (for condition date_from/
// date_to). Otherwise also renders hour/minute and emits "YYYY-MM-DDTHH:MM".

function parseValue(value, dateOnly) {
  if (!value) return { year: "", month: "", day: "", hour: "", minute: "" };
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = (datePart || "").split("-");
  const [h, mi] = dateOnly ? [] : (timePart || "").split(":");
  return { year: y || "", month: m || "", day: d || "", hour: h || "", minute: mi || "" };
}

function buildValue({ year, month, day, hour, minute }, dateOnly) {
  if (!year || !month || !day) return "";
  const y = year.padStart(4, "0");
  const m = month.padStart(2, "0");
  const d = day.padStart(2, "0");
  if (dateOnly) return `${y}-${m}-${d}`;
  const h = (hour || "00").padStart(2, "0");
  const mi = (minute || "00").padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${mi}`;
}

function normalizeYear(raw) {
  return raw && raw.length <= 2 ? String(2000 + parseInt(raw, 10)) : raw;
}

const FIELD_CLS = "text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 text-center";

export default function TaskDateTimeInput({ id, value, onChange, className = "", dateOnly = false }) {
  const [f, setF] = useState(() => parseValue(value, dateOnly));
  // Tracks the last value *we* emitted via onChange, so the sync effect below can tell the
  // difference between "the parent echoed back our own edit" (skip — local state is already
  // correct and up to date) and "the value changed for an external reason, e.g. a form reset
  // or loading a saved audience" (do resync). Without this, every keystroke on an
  // incomplete date round-trips through the parent and immediately wipes itself out, because
  // buildValue() returns "" until day+month+year are all filled in.
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    setF(parseValue(value, dateOnly));
    lastEmitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next) {
    setF(next);
    const built = buildValue(next, dateOnly);
    lastEmitted.current = built;
    onChange(built);
  }

  function updateField(key, raw, maxLen = 2) {
    const digits = raw.replace(/\D/g, "").slice(0, maxLen);
    commit({ ...f, [key]: digits });
  }

  function handleYearBlur() {
    const normalized = normalizeYear(f.year);
    if (normalized !== f.year) commit({ ...f, year: normalized });
  }

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`} dir="ltr">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        aria-label="יום"
        placeholder="יום"
        value={f.day}
        maxLength={2}
        onChange={e => updateField("day", e.target.value)}
        className={`${FIELD_CLS} w-12`}
      />
      <span aria-hidden="true" className="text-slate-400">/</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label="חודש"
        placeholder="חודש"
        value={f.month}
        maxLength={2}
        onChange={e => updateField("month", e.target.value)}
        className={`${FIELD_CLS} w-12`}
      />
      <span aria-hidden="true" className="text-slate-400">/</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label="שנה (אפשר להקליד 26 עבור 2026)"
        placeholder="שנה"
        value={f.year}
        maxLength={4}
        onChange={e => updateField("year", e.target.value, 4)}
        onBlur={handleYearBlur}
        className={`${FIELD_CLS} w-16`}
      />
      {!dateOnly && (
        <>
          <span aria-hidden="true" className="w-2" />
          <input
            type="text"
            inputMode="numeric"
            aria-label="שעה"
            placeholder="שעה"
            value={f.hour}
            maxLength={2}
            onChange={e => updateField("hour", e.target.value)}
            className={`${FIELD_CLS} w-12`}
          />
          <span aria-hidden="true" className="text-slate-400">:</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="דקה"
            placeholder="דקה"
            value={f.minute}
            maxLength={2}
            onChange={e => updateField("minute", e.target.value)}
            className={`${FIELD_CLS} w-12`}
          />
        </>
      )}
    </div>
  );
}
