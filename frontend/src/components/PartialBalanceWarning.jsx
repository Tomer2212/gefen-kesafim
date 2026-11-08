import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// "טרם דווח" must equal "סכום חייב בדיווח" − "סכום שדווח". When it doesn't, the
// amount is shown in orange with a warning icon explaining the gap.
const TOLERANCE = 10;

// overview: the budget's overview from the check result. Its balance_warning
// (set by the server's integrity checks) tells a calculation fault from files
// downloaded at different times; checks from before that field have no key at all.
export function partialBalance({ sumChayav, sumDivuach, missing, overview }) {
  if (sumChayav == null || sumDivuach == null || missing == null) return null;
  if (overview?.doch_analyzed === false) return null;
  const x = Math.round(Number(sumChayav));
  const y = Math.round(Number(sumDivuach));
  const w = Math.round(Number(missing));
  if ([x, y, w].some(Number.isNaN)) return null;
  const z = x - y;
  const n = z - w;
  if (Math.abs(n) <= TOLERANCE) return null;
  const hasField = !!overview && Object.prototype.hasOwnProperty.call(overview, "balance_warning");
  const bw = overview?.balance_warning || {};
  const kind = !hasField ? "legacy"
    : (bw.double_credit || bw.unmatched || bw.misattributed) ? "internal"
    : n > 0 ? "plan_behind" : "doch_behind";
  return { x, y, z, w, n, kind };
}

const fmt = (v) => `${Math.round(v).toLocaleString("he-IL")} ₪`;

function closingText({ n, kind }) {
  const gap = fmt(Math.abs(n));
  switch (kind) {
    case "plan_behind":
      return `אם שייכתם לאחרונה אסמכתאות בסך כולל של ${gap}, כנראה שהכול תקין וקובץ התכנון שהורד טרם התעדכן. כדאי גם לוודא שהועלה קובץ התכנון העדכני ביותר ולא עותק ישן שהורד בעבר. בכל מקרה אחר, מומלץ לבדוק מאין נובע ההפרש.`;
    case "doch_behind":
      return `ייתכן שהועלה קובץ דיווח ביצוע ישן יותר מקובץ התכנון, או שבוטל לאחרונה שיוך של אסמכתאות בסך ${gap}. בכל מקרה אחר, מומלץ לבדוק מאין נובע ההפרש.`;
    case "internal":
      return "נמצאה אי-התאמה בחישוב המערכת. מומלץ לפנות לתמיכה.";
    default:
      return "הבדיקה בוצעה לפני שהמערכת החלה לאתר אי-התאמות כאלה. מומלץ להריץ בדיקה חדשה.";
  }
}

function WarningTriangle({ size = 14 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5 15 14H1L8 1.5Z" fill="#f97316" />
      <path d="M8 6v3.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="white" />
    </svg>
  );
}

// Icon button + explanation popover. Opens on hover, focus or tap (a click never
// closes it, since hover already opened it); closes on leave, Escape, scroll or a
// click elsewhere. Rendered in a portal so table scroll containers don't clip it.
export function BalanceWarningIcon({ balance }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const hideRef = useRef(null);
  const tipId = useId();

  useEffect(() => () => clearTimeout(hideRef.current), []);
  useEffect(() => {
    if (!open) return;
    // Capture phase: Escape closes only the popover, not a dialog it sits in.
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (e.target.closest?.(`[data-balance-tip="${tipId}"]`)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, tipId]);

  function show() {
    clearTimeout(hideRef.current);
    const r = btnRef.current?.getBoundingClientRect();
    // Opens upward when there is too little room below the icon.
    if (r) setPos({ top: r.top, bottom: r.bottom, left: r.left + r.width / 2, above: window.innerHeight - r.bottom < 280 });
    setOpen(true);
  }
  function scheduleHide() {
    clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setOpen(false), 300);
  }

  if (!balance) return null;
  const width = Math.min(340, window.innerWidth - 16);
  const left = pos ? Math.min(Math.max(8, pos.left - width / 2), window.innerWidth - width - 8) : 0;
  const vertical = pos?.above ? { bottom: window.innerHeight - pos.top + 6 } : { top: (pos?.bottom ?? 0) + 6 };

  return (
    <>
      <button type="button" ref={btnRef}
        aria-label="פירוט אי-התאמה בסכום שטרם דווח"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show} onMouseLeave={scheduleHide}
        onFocus={show} onBlur={scheduleHide}
        onClick={(e) => { e.stopPropagation(); show(); }}
        className="inline-flex items-center align-middle rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        <WarningTriangle />
      </button>
      {open && pos && createPortal(
        <div id={tipId} role="tooltip" dir="rtl" data-balance-tip={tipId}
          onMouseEnter={() => clearTimeout(hideRef.current)} onMouseLeave={scheduleHide}
          className="fixed z-[1000] rounded-lg shadow-lg border border-orange-200 bg-orange-50 text-slate-700 text-xs text-right"
          style={{ ...vertical, left, width, padding: "10px 12px", lineHeight: 1.6, fontWeight: 400 }}>
          <div className="text-orange-700 mb-1" style={{ fontWeight: 700 }}>הסכום שטרם דווח אינו מתאזן</div>
          <div>"טרם דווח" אמור להיות שווה ל"סכום חייב בדיווח" בניכוי "סכום שדווח", אך זה לא מתקיים כאן:</div>
          <ul className="my-1.5 tabular-nums" style={{ listStyle: "none", padding: 0 }}>
            <li>סכום חייב בדיווח: {fmt(balance.x)}</li>
            <li>סכום שדווח (לפי קובץ התכנון): {fmt(balance.y)}</li>
            <li>לכן "טרם דווח" אמור להיות: {fmt(balance.z)}</li>
            <li>לפי קובץ דיווח הביצוע, "טרם דווח" הוא: {fmt(balance.w)}</li>
            <li style={{ fontWeight: 700 }}>הפרש: {fmt(Math.abs(balance.n))}</li>
          </ul>
          <div>{closingText(balance)}</div>
        </div>,
        document.body,
      )}
    </>
  );
}

// An amount ("טרם דווח") in orange followed by the warning icon, or the plain amount.
export function PartialAmount({ text, balance }) {
  if (!balance) return text;
  return (
    <span className="inline-flex items-center gap-1" style={{ color: "#ea580c", fontWeight: 700 }}>
      {text}
      <BalanceWarningIcon balance={balance} />
    </span>
  );
}
