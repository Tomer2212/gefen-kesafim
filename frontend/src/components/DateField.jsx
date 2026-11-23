import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HEBREW_MONTHS } from "./meetings/constants";

// Drop-in replacement for a native <input type="date">. Chrome's own picker can't be styled
// (it navigates months with up/down arrows); this one matches DatePickerPopover.jsx: the month
// in the middle, → on the right = previous month, ← on the left = next month.
// Value in and out is plain ISO ("YYYY-MM-DD" or ""), exactly like the native input, so callers
// only change `onChange={e => x(e.target.value)}` to `onChange={x}`.
//
// The text box takes DD/MM/YYYY (slashes added automatically). A typed date is emitted only once
// it is complete, real and inside min/max; leaving the field with anything else restores the
// last value. Clearing the text emits "".
//
// The popover is portaled into <body> with `position: fixed` (like DatePickerPopover): inside
// the field it would sit in the filter card's stacking context (.glass-card's backdrop-filter)
// and be painted under the next card. Several fields live in dropdown menus that close on a
// document mousedown outside themselves, so the popover swallows its own mousedown natively
// (stopPropagation — every such handler in the app listens in the bubble phase) and the menu
// never sees it. The same preventDefault keeps focus in the text box.

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const POPOVER_WIDTH = 264;
const POPOVER_HEIGHT_ESTIMATE = 330;

function pad(n) { return String(n).padStart(2, "0"); }
function toIso(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function todayIso() { const t = new Date(); return toIso(t.getFullYear(), t.getMonth(), t.getDate()); }

function isoToText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function maskText(raw) {
  let digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length >= 2) digits = pad(clamp(parseInt(digits.slice(0, 2), 10), 1, 31)) + digits.slice(2);
  if (digits.length >= 4) digits = digits.slice(0, 2) + pad(clamp(parseInt(digits.slice(2, 4), 10), 1, 12)) + digits.slice(4);
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

function textToIso(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text || "");
  if (!m) return null;
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (year < 1000 || month < 1 || month > 12) return null;
  if (day < 1 || day > new Date(year, month, 0).getDate()) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function inRange(iso, min, max) {
  return (!min || iso >= min) && (!max || iso <= max);
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toIso(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function CalendarPopover({ value, min, max, cursor, setCursor, onSelect, onClear, anchorRef, popRef }) {
  const base = cursor || value || todayIso();
  const [viewYear, setViewYear] = useState(() => Number(base.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(base.slice(5, 7)) - 1);
  const [mode, setMode] = useState("days"); // days | months | years
  const [pos, setPos] = useState(null);
  const today = todayIso();

  useEffect(() => {
    const el = popRef.current;
    if (!el) return;
    function swallow(e) { e.preventDefault(); e.stopPropagation(); }
    el.addEventListener("mousedown", swallow);
    return () => el.removeEventListener("mousedown", swallow);
  }, [popRef]);

  // Keyboard moves the cursor across months — keep the visible month following it.
  useEffect(() => {
    if (!cursor) return;
    setViewYear(Number(cursor.slice(0, 4)));
    setViewMonth(Number(cursor.slice(5, 7)) - 1);
  }, [cursor]);

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      let right = window.innerWidth - rect.right;
      if (right + POPOVER_WIDTH > window.innerWidth - 8) right = Math.max(8, window.innerWidth - POPOVER_WIDTH - 8);
      const below = rect.bottom + 4 + POPOVER_HEIGHT_ESTIMATE <= window.innerHeight || rect.top < POPOVER_HEIGHT_ESTIMATE;
      setPos(below
        ? { top: rect.bottom + 4, right }
        : { bottom: window.innerHeight - rect.top + 4, right });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [anchorRef]);

  function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const yearBlockStart = viewYear - (viewYear % 12);

  const navBtn = "w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 text-sm font-bold";
  const prevLabel = mode === "days" ? "החודש הקודם" : mode === "months" ? "השנה הקודמת" : "השנים הקודמות";
  const nextLabel = mode === "days" ? "החודש הבא" : mode === "months" ? "השנה הבאה" : "השנים הבאות";
  function goPrev() { if (mode === "days") shiftMonth(-1); else setViewYear(y => y - (mode === "months" ? 1 : 12)); }
  function goNext() { if (mode === "days") shiftMonth(1); else setViewYear(y => y + (mode === "months" ? 1 : 12)); }

  const style = pos
    ? { ...pos, width: POPOVER_WIDTH }
    : { visibility: "hidden", top: 0, right: 0, width: POPOVER_WIDTH };

  return createPortal(
    <div ref={popRef} role="dialog" aria-label="בחירת תאריך" dir="rtl" style={style}
      className="fixed z-[10000] bg-white border border-slate-200 rounded-2xl shadow-xl p-3 text-slate-700">
      <div className="flex items-center justify-between mb-2 gap-1">
        <button type="button" onClick={goPrev} aria-label={prevLabel} className={navBtn}>→</button>
        {mode === "days" && (
          <button type="button" onClick={() => setMode("months")} aria-label="בחירת חודש ושנה"
            className="text-sm font-semibold px-2 py-1 rounded-lg hover:bg-slate-100">
            {HEBREW_MONTHS[viewMonth]} {viewYear}
          </button>
        )}
        {mode === "months" && (
          <button type="button" onClick={() => setMode("years")} aria-label="בחירת שנה"
            className="text-sm font-semibold px-2 py-1 rounded-lg hover:bg-slate-100">{viewYear}</button>
        )}
        {mode === "years" && (
          <span className="text-sm font-semibold px-2 py-1">{yearBlockStart}–{yearBlockStart + 11}</span>
        )}
        <button type="button" onClick={goNext} aria-label={nextLabel} className={navBtn}>←</button>
      </div>

      {mode === "days" && (
        <>
          <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 mb-1" aria-hidden="true">
            {WEEKDAYS.map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (!day) return <span key={`b${i}`} />;
              const iso = toIso(viewYear, viewMonth, day);
              const disabled = !inRange(iso, min, max);
              const isSelected = iso === value;
              const isToday = iso === today;
              const isCursor = iso === cursor;
              return (
                <button key={iso} type="button" disabled={disabled}
                  aria-label={`${day} ${HEBREW_MONTHS[viewMonth]} ${viewYear}`} aria-pressed={isSelected}
                  onClick={() => onSelect(iso)} onMouseEnter={() => setCursor(iso)}
                  className={`w-8 h-8 mx-auto rounded-lg text-xs font-medium transition-colors
                    ${disabled ? "text-slate-300 cursor-not-allowed"
                      : isSelected ? "bg-blue-600 text-white"
                      : isToday ? "bg-blue-50 text-blue-700 font-bold"
                      : "hover:bg-slate-100"}
                    ${isCursor && !isSelected && !disabled ? "ring-1 ring-blue-300" : ""}`}>
                  {day}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
            <button type="button" disabled={!inRange(today, min, max)} onClick={() => onSelect(today)}
              className="text-xs font-medium text-blue-600 hover:underline disabled:text-slate-300 disabled:no-underline">היום</button>
            <button type="button" onClick={onClear}
              className="text-xs font-medium text-slate-500 hover:underline">ניקוי</button>
          </div>
        </>
      )}

      {mode === "months" && (
        <div className="grid grid-cols-3 gap-1">
          {HEBREW_MONTHS.map((name, i) => (
            <button key={name} type="button" onClick={() => { setViewMonth(i); setMode("days"); }}
              className={`py-2 rounded-lg text-xs font-medium ${i === viewMonth ? "bg-blue-600 text-white" : "hover:bg-slate-100"}`}>
              {name}
            </button>
          ))}
        </div>
      )}

      {mode === "years" && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => yearBlockStart + i).map(y => (
            <button key={y} type="button" onClick={() => { setViewYear(y); setMode("months"); }}
              className={`py-2 rounded-lg text-xs font-medium ${y === viewYear ? "bg-blue-600 text-white" : "hover:bg-slate-100"}`}>
              {y}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

export default function DateField({
  id, value, onChange, onBlur, onKeyDown, min, max, disabled, autoFocus, invalid,
  className = "input-field", wrapperClassName, "aria-label": ariaLabel, title,
}) {
  const [text, setText] = useState(() => isoToText(value));
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [badText, setBadText] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const popRef = useRef(null);

  // External value change (filter reset, row reload) → show it, unless the box already shows it.
  useEffect(() => {
    if (textToIso(text) === (value || null) || (!value && text === "")) return;
    setText(isoToText(value));
    setBadText(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (!wrapRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function emit(iso) {
    setText(isoToText(iso));
    setBadText(false);
    if (iso !== (value || "")) onChange(iso);
  }

  function openPicker() {
    if (disabled) return;
    setCursor(value || (inRange(todayIso(), min, max) ? todayIso() : (min || max || todayIso())));
    setOpen(true);
  }

  function handleText(raw) {
    const masked = maskText(raw);
    setText(masked);
    if (masked === "") { setBadText(false); if (value) onChange(""); return; }
    const iso = textToIso(masked);
    if (iso && inRange(iso, min, max)) {
      setBadText(false);
      setCursor(iso);
      if (iso !== value) onChange(iso);
    } else {
      setBadText(masked.replace(/\D/g, "").length === 8);
    }
  }

  function handleKeyDown(e) {
    if (open) {
      const step = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 }[e.key]; // RTL: left = later
      if (step && cursor) { e.preventDefault(); setCursor(addDaysIso(cursor, step)); return; }
      if (e.key === "Enter" && cursor) {
        e.preventDefault();
        if (inRange(cursor, min, max)) { emit(cursor); setOpen(false); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    } else if (e.key === "ArrowDown" && e.altKey) {
      e.preventDefault(); openPicker(); return;
    }
    onKeyDown?.(e);
  }

  // Fires the caller's onBlur only when focus leaves the whole field (text box + 📅 + popover).
  function handleBlur(e) {
    if (wrapRef.current?.contains(e.relatedTarget) || popRef.current?.contains(e.relatedTarget)) return;
    setOpen(false);
    // Anything not matching the value (half-typed, out of range) goes back to it — also when the
    // value is empty, so a half-typed "23/1" never stays on screen over an empty filter.
    if (text !== isoToText(value)) {
      setText(isoToText(value));
      setBadText(false);
    }
    onBlur?.(e);
  }

  const fullWidth = /(^|\s)w-full(\s|$)/.test(className);
  const wrapCls = wrapperClassName || (fullWidth ? "relative block w-full" : "relative inline-block");
  const showInvalid = invalid || badText;

  return (
    <div ref={wrapRef} className={wrapCls} onBlur={handleBlur}>
      <input
        ref={inputRef}
        id={id} type="text" inputMode="numeric" dir="ltr" placeholder="DD/MM/YYYY" maxLength={10} size={11}
        autoComplete="off" autoFocus={autoFocus} disabled={disabled} title={title}
        aria-label={ariaLabel} aria-invalid={showInvalid || undefined} aria-haspopup="dialog" aria-expanded={open}
        value={text}
        onChange={e => handleText(e.target.value)}
        onClick={() => { if (!open) openPicker(); }}
        onKeyDown={handleKeyDown}
        className={className}
        style={{ paddingLeft: 30, textAlign: "right", ...(showInvalid ? { borderColor: "#f87171" } : null) }}
      />
      <button type="button" tabIndex={-1} disabled={disabled}
        onMouseDown={e => e.preventDefault()}
        onClick={() => { if (open) setOpen(false); else { openPicker(); inputRef.current?.focus(); } }}
        aria-label="פתח לוח שנה לבחירת תאריך"
        className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 disabled:opacity-50">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
      {open && (
        <CalendarPopover
          value={value || ""} min={min} max={max} cursor={cursor} setCursor={setCursor} anchorRef={wrapRef} popRef={popRef}
          onSelect={iso => { emit(iso); setOpen(false); }}
          onClear={() => { emit(""); setOpen(false); }}
        />
      )}
    </div>
  );
}
