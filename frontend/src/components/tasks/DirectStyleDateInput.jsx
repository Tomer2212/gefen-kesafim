import { useEffect, useState } from "react";

// Extracted from ConditionGroupsEditor.jsx so it can be reused outside the condition-tree UI
// (e.g. PersonTaskCreateWizard.jsx's own "תאריך יעד" field) — same DD/MM/YY masked-text field
// as DirectCoordinationModal.jsx's "תיאום ישיר". Stores/emits plain ISO ("YYYY-MM-DD").
// Clamps each 2-digit segment to a plausible range (day 01-31, month 01-12) the moment it's
// fully typed, so e.g. typing "88" for month can never sit in the field as-is (it clamps to
// 12) — day-vs-month validity (e.g. 31/02) still can't be checked until all 6 digits exist,
// that's parseDateDDMMYY's job, surfaced live below. The 2-digit year segment is always read as
// 20XX (see parseDateDDMMYY) — typing "26" completes the year to 2026 automatically.
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function maskDateInput(raw) {
  let digits = raw.replace(/\D/g, "").slice(0, 6);
  if (digits.length >= 2) {
    const day = clamp(parseInt(digits.slice(0, 2), 10), 1, 31);
    digits = String(day).padStart(2, "0") + digits.slice(2);
  }
  if (digits.length >= 4) {
    const month = clamp(parseInt(digits.slice(2, 4), 10), 1, 12);
    digits = digits.slice(0, 2) + String(month).padStart(2, "0") + digits.slice(4);
  }
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

function parseDateDDMMYY(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text || "");
  if (!m) return null;
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = 2000 + parseInt(m[3], 10);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoToDDMMYY(iso) {
  if (!iso) return "";
  const [y, m, d] = (iso || "").split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y.slice(2)}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// A "due"/"from"/"to" date in the past never makes sense for these use cases (meeting
// requirements, task due dates) — compared as plain ISO strings (sorts lexicographically).
function isPastDate(iso) { return iso < todayIso(); }

export default function DirectStyleDateInput({ id, value, onChange, invalid }) {
  const [text, setText] = useState(() => isoToDDMMYY(value));
  const [lastEmitted, setLastEmitted] = useState(value);
  // True only once all 6 digits are typed but they don't form a real calendar date (e.g.
  // 31/02/26) — day/month range is already clamped per-segment by maskDateInput, so this is
  // just the day-vs-days-in-month case parseDateDDMMYY catches.
  const [localInvalid, setLocalInvalid] = useState(false);
  const [pastInvalid, setPastInvalid] = useState(false);
  useEffect(() => {
    if (value === lastEmitted) return; // externally-triggered change only (e.g. "נקה בחירה")
    setText(isoToDDMMYY(value));
    setLastEmitted(value);
    setLocalInvalid(false);
    setPastInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const showInvalid = invalid || localInvalid || pastInvalid;
  return (
    <div>
      <input
        id={id} type="text" inputMode="numeric" placeholder="DD/MM/YY" maxLength={8}
        aria-invalid={showInvalid || undefined}
        value={text}
        onChange={e => {
          const masked = maskDateInput(e.target.value);
          setText(masked);
          const digitCount = masked.replace(/\D/g, "").length;
          if (masked === "") {
            setLastEmitted("");
            setLocalInvalid(false);
            setPastInvalid(false);
            onChange("");
            return;
          }
          const iso = parseDateDDMMYY(masked);
          if (iso) {
            setLocalInvalid(false);
            if (isPastDate(iso)) {
              // Keep the typed text visible (don't silently revert) but withhold onChange —
              // a past date must never reach the caller.
              setPastInvalid(true);
              return;
            }
            setPastInvalid(false);
            setLastEmitted(iso);
            onChange(iso);
          } else {
            setPastInvalid(false);
            setLocalInvalid(digitCount === 6);
          }
        }}
        className={`text-sm border rounded-lg px-2.5 py-1.5 w-full ${showInvalid ? "border-red-400 focus:border-red-500" : "border-slate-200"}`}
      />
      {localInvalid && <p className="text-[11px] text-red-600 mt-0.5">תאריך לא קיים בלוח השנה</p>}
      {pastInvalid && <p className="text-[11px] text-red-600 mt-0.5">לא ניתן לבחור תאריך שחלף — יש לבחור מהיום והלאה</p>}
    </div>
  );
}
