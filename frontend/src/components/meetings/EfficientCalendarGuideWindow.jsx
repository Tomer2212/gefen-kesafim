import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The "?" explanation of "יומן יעיל" (backend/slot_policy.py), opened from EfficientCalendarFields.
// A floating, non-blocking window (the manager can keep it open beside the question): drag by the
// title bar, resize from any edge or corner, minimize to a tab, close. Portaled to <body> above
// every modal (z 10000 — the task wizard itself is z-[65]); React events still bubble to the
// modal it was opened from, so keyboard/mouse events stop at the window's root (Escape here must
// close only this window, not the wizard).
// Every example below was computed with slot_policy itself (working day 08:00–16:00) — keep
// them in sync with backend/tests/test_slot_policy.py if the rule ever changes.

const MIN_WIDTH = 380;
const MIN_HEIGHT = 300;
const EDGE = 6; // px — thickness of the invisible resize borders
const DAY_START = 8;
const DAY_END = 16;

function defaultRect() {
  const width = Math.min(780, window.innerWidth - 32);
  const height = Math.min(760, window.innerHeight - 32);
  return { x: Math.round((window.innerWidth - width) / 2), y: Math.max(16, Math.round((window.innerHeight - height) / 2)), width, height };
}

function toHours(t) {
  const [hh, mm] = t.split(":").map(Number);
  return hh + mm / 60;
}

// One working day, 08:00 on the right (RTL). busy = gray, offered = green, blocked = red dashed.
function DayTimeline({ busy = [], offered = [], blocked = [], caption }) {
  const span = DAY_END - DAY_START;
  const place = ([s, e]) => ({ right: `${((toHours(s) - DAY_START) / span) * 100}%`, width: `${((toHours(e) - toHours(s)) / span) * 100}%` });
  const hours = Array.from({ length: span + 1 }, (_, i) => DAY_START + i);
  return (
    <figure className="flex flex-col gap-1 my-1">
      {caption && <figcaption className="text-[11px] font-semibold text-slate-500">{caption}</figcaption>}
      <div className="relative h-9 rounded-lg bg-slate-50 border border-slate-200 overflow-hidden" role="img"
        aria-label={[
          busy.length ? `תפוס: ${busy.map(([s, e]) => `${s}–${e}`).join(", ")}` : "יום ריק",
          offered.length ? `יוצע: ${offered.map(([s, e]) => `${s}–${e}`).join(", ")}` : "",
          blocked.length ? `לא יוצע: ${blocked.map(([s, e]) => `${s}–${e}`).join(", ")}` : "",
        ].filter(Boolean).join(". ")}>
        {hours.slice(1, -1).map(hour => (
          <div key={hour} aria-hidden="true" className="absolute top-0 bottom-0 border-r border-dashed border-slate-200"
            style={{ right: `${((hour - DAY_START) / span) * 100}%` }} />
        ))}
        {busy.map(b => (
          <div key={`b${b}`} aria-hidden="true" style={place(b)}
            className="absolute top-1 bottom-1 rounded-md bg-slate-400 text-white text-[10px] font-semibold flex items-center justify-center">
            תפוס
          </div>
        ))}
        {blocked.map(b => (
          <div key={`x${b}`} aria-hidden="true" style={place(b)}
            className="absolute top-1 bottom-1 rounded-md border-2 border-dashed border-red-400 bg-red-50/70 text-red-600 text-[10px] font-bold flex items-center justify-center">
            ✗
          </div>
        ))}
        {offered.map(o => (
          <div key={`o${o}`} aria-hidden="true" style={place(o)}
            className="absolute top-1 bottom-1 rounded-md bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
            ✓
          </div>
        ))}
      </div>
      <div className="relative h-3.5" aria-hidden="true">
        {hours.map(hour => (
          <span key={hour} className="absolute text-[10px] text-slate-400 translate-x-1/2"
            style={{ right: `${((hour - DAY_START) / span) * 100}%` }}>
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-600" aria-hidden="true">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400" /> כבר תפוס ביומן</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" /> שעה שבית הספר יכול לקבל</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-dashed border-red-400 bg-red-50" /> שעה שלא תוצע</span>
    </div>
  );
}

function Example({ number, title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col gap-2">
      <h4 className="text-sm font-bold text-slate-800">דוגמה {number}: {title}</h4>
      {children}
    </section>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-bold text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

function GuideContent() {
  return (
    <div className="flex flex-col gap-6 text-sm text-slate-700 leading-relaxed">
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-3.5">
        <p className="font-bold text-blue-900 mb-1">בקצרה</p>
        <p>
          כשבית ספר קובע פגישה דרך הלינק, המערכת לא מציעה לו סתם "את השעה הפנויה הראשונה".
          היא בוחרת שעה שלא תשאיר ביומן של היועץ <b>חורים קטנים</b> שאף פגישה אחרת לא תוכל להיכנס אליהם —
          כדי שתמיד יישאר מקום גם לפגישות הארוכות.
        </p>
      </div>

      <Section title="למה צריך את זה?">
        <p>
          תחשבו על שורה של כיסאות בקולנוע. אם כל אחד יושב איפה שבא לו, בסוף נשארים כיסאות בודדים פזורים —
          ומשפחה של שלושה כבר לא מוצאת שלושה כיסאות ביחד, למרות שיש הרבה כיסאות פנויים.
        </p>
        <p>
          ביומן של יועץ זה בדיוק אותו דבר: אם בתי ספר שצריכים שעה אחת יקבעו ב-9:00, ב-11:00, ב-13:00 וב-15:00,
          יישארו ביום רק "חורים" של שעה — ובית ספר שצריך פגישה של שעתיים כבר לא ימצא מקום באותו יום.
        </p>
      </Section>

      <Section title="האפשרות המומלצת: אוטומטי">
        <p>
          ב"אוטומטי" לא צריך לנחש כלום. המערכת מסתכלת <b>מי עוד מחכה בתור</b> אצל כל יועץ —
          כל בית ספר שקיבל לינק (מכל המשימות הפעילות, וגם מתיאום עצמי) ועדיין לא קבע —
          ושומרת ביומן של היועץ מקום <b>לפגישה הארוכה ביותר שעוד מחכה להיקבע אצלו, בימים שבהם היא יכולה להיקבע</b>.
        </p>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-1">
          <p className="font-semibold text-slate-800">לדוגמה</p>
          <p>
            ליועצת דנה יש עשרות בתי ספר שצריכים פגישה של שעה או שעתיים, ושלושה בתי ספר שצריכים פגישת גפן+שוטף של 3 שעות בדצמבר.
            כל עוד שלושת אלה לא קבעו — היומן של דנה בדצמבר שומר חלונות של 3 שעות. ברגע שהם קבעו, המערכת "משחררת" ושומרת רק על חלונות של שעתיים.
            אצל יועץ אחר, שאין לו פגישות ארוכות שמחכות — נשמרים רק חלונות באורך הפגישות שלו.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          כשנקבעת פגישה בטלפון לבית ספר שעוד יש לו לינק פתוח, המערכת שואלת אם היא מחליפה את הלינק — כך היא יודעת שהוא כבר לא מחכה בתור.
          ואם פגישה שנקבעה בוטלה או נדחתה, בית הספר חוזר לתור ויכול לקבוע שוב דרך הלינק.
        </p>
      </Section>

      <Section title="מה בוחרים בשדה הזה?">
        <p>
          בוחרים <b>את אורך הפגישה הארוכה שחשוב לכם שתמיד יישאר לה מקום ביומן</b>. נקרא לזה "החלון החשוב".
        </p>
        <p>
          המערכת תשתדל שכל זמן פנוי שנשאר בין פגישות יהיה <b>או אפס</b> (פגישות צמודות זו לזו) <b>או לפחות באורך החלון החשוב</b> —
          ושיישארו באותו יום כמה שיותר חלונות כאלה.
        </p>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-col gap-1.5">
          <p className="font-semibold text-amber-900">איך לבחור?</p>
          <p><b>ברוב המקרים — בחרו "אוטומטי".</b> הערכים הקבועים מיועדים למי שרוצה לקבוע בעצמו גודל חלון אחד לכל המשימה:</p>
          <ul className="list-disc pr-5 flex flex-col gap-1">
            <li>רוב הפגישות שלכם של שעה, אבל יש גם הרבה פגישות של שעתיים (למשל שוטף) → בחרו <b>שעתיים</b>.</li>
            <li>יש לכם פגישות "גפן+שוטף" של 3 שעות שחייב להישאר להן מקום → בחרו <b>3 שעות</b>.</li>
            <li>כמעט כל הפגישות באותו אורך, למשל שעה → בחרו <b>שעה</b>.</li>
            <li><b>ללא הגבלה</b> → המערכת תציע פשוט את השעה הפנויה המוקדמת ביותר, כמו שהיה עד היום.</li>
          </ul>
          <p className="text-xs text-amber-800">טיפ: ככל שבוחרים חלון ארוך יותר, היומן "שומר" יותר מקום לפגישות ארוכות — אבל לבתי הספר יש קצת פחות שעות לבחור מהן.</p>
        </div>
      </Section>

      <Section title="איך המערכת בוחרת שעה? (4 כללים פשוטים)">
        <ol className="list-decimal pr-5 flex flex-col gap-1.5">
          <li><b>סופרים חלונות.</b> לכל שעה אפשרית, המערכת בודקת כמה "חלונות חשובים" יישארו פנויים באותו יום אם בית הספר יקבע בה. מוצעות רק השעות שמשאירות הכי הרבה.</li>
          <li><b>לא משאירים שעה "תקועה".</b> מבין השעות האלה, המערכת מעדיפה את אלה שלא משאירות קטע פנוי קצר מהחלון החשוב, שתקוע בין שתי פגישות.</li>
          <li><b>הכי מוקדם.</b> מבין כל השעות הטובות, בית הספר מקבל קודם את המוקדמת ביותר.</li>
          <li><b>תחילת היום וסוף היום נחשבים כמו פגישה.</b> כך גם 08:00 בבוקר לא נשאר "כיסא בודד".</li>
        </ol>
        <p className="text-xs text-slate-500">
          הבדיקה נעשית על היומן האמיתי של היועץ: Outlook (כולל אירועים פרטיים) + הפגישות במערכת. בפגישה עם כמה יועצים (למשל גפן+שוטף עם שני יועצים) — היומן של כל אחד נשמר בנפרד.
        </p>
      </Section>

      <Section title="דוגמאות מהחיים">
        <p className="text-xs text-slate-500">בכל הדוגמאות: יום עבודה 08:00–16:00, ונבחר חלון חשוב של <b>שעתיים</b> (אלא אם כתוב אחרת).</p>
        <Legend />

        <Example number={1} title="יום ריק, בית ספר צריך פגישה של שעה">
          <DayTimeline offered={[["08:00", "09:00"], ["10:00", "11:00"], ["11:00", "12:00"], ["12:00", "13:00"], ["13:00", "14:00"], ["15:00", "16:00"]]}
            blocked={[["09:00", "10:00"], ["14:00", "15:00"]]} />
          <p>
            כמעט כל שעה בסדר. רק <b>09:00</b> ו-<b>14:00</b> לא יוצעו: 09:00 הייתה משאירה את 08:00–09:00 כשעה בודדת תקועה
            (אפשר להכניס לשם רק פגישה של שעה), וכך גם 14:00 עם 15:00–16:00. בהצעה הרגילה בית הספר יקבל <b>08:00</b>.
          </p>
        </Example>

        <Example number={2} title="ליועץ יש פגישה ב-12:00–13:00, ובית ספר צריך שעה">
          <DayTimeline busy={[["12:00", "13:00"]]} offered={[["13:00", "14:00"], ["15:00", "16:00"]]} blocked={[["08:00", "09:00"]]} />
          <p>
            הבוקר (08:00–12:00) מכיל בדיוק שתי פגישות של שעתיים. אם בית הספר יקבע ב-08:00, נשאר מקום לפגישת שעתיים אחת בלבד.
            לכן המערכת תציע <b>13:00</b> — שם יש 3 שעות, ופגישה של שעה עדיין משאירה אחריה שעתיים שלמות.
          </p>
        </Example>

        <Example number={3} title="יש חור של שעה בין שתי פגישות">
          <DayTimeline busy={[["08:00", "10:00"], ["11:00", "16:00"]]} offered={[["10:00", "11:00"]]} />
          <p>בית ספר שצריך שעה יקבל בדיוק את <b>10:00–11:00</b> — הוא "סוגר" חור שאף פגישה ארוכה לא הייתה יכולה להשתמש בו.</p>
        </Example>

        <Example number={4} title="פגישה של שעתיים, וליועץ פגישות ב-10:00–11:00 וב-13:00–15:00">
          <DayTimeline busy={[["10:00", "11:00"], ["13:00", "15:00"]]} offered={[["08:00", "10:00"], ["11:00", "13:00"]]} />
          <p>
            יוצעו <b>08:00–10:00</b> ו-<b>11:00–13:00</b> — שתיהן צמודות לפגישות משני הצדדים.
            אם בית הספר יבקש ב"אפשרויות נוספות" את השעות 12:00–14:00, אין שם מקום פנוי של שעתיים,
            ולכן הוא יקבל את <b>11:00–13:00</b> עם הסימון <b>"הכי קרוב לבקשה שלכם"</b>.
          </p>
        </Example>

        <Example number={5} title="זמן פנוי של שעתיים וחצי, ופגישה של שעתיים">
          <DayTimeline busy={[["08:00", "10:00"], ["12:30", "16:00"]]} offered={[["10:00", "12:00"]]} />
          <p>
            מותר — אין דרך טובה יותר לנצל את הזמן הזה. יוצעו <b>10:00</b> (צמוד לפגישה שלפני) וגם <b>10:30</b> (צמוד לפגישה שאחרי),
            גם אם בחרתם "רק בשעה עגולה", כי פגישה צמודה למופע תמיד מותרת.
          </p>
        </Example>

        <Example number={6} title="היום מתמלא בפגישות של שעה">
          <DayTimeline busy={[["10:00", "12:00"]]} offered={[["12:00", "13:00"], ["15:00", "16:00"]]} blocked={[["08:00", "09:00"], ["09:00", "10:00"]]}
            caption="כבר נקבעו 10:00–11:00 ו-11:00–12:00. בית ספר שלישי צריך שעה:" />
          <p>
            08:00–10:00 הוא חלון של שעתיים בדיוק — פגישה של שעה שם הייתה משאירה שעה תקועה. לכן יוצעו <b>12:00</b> או <b>15:00</b>.
            ובית הספר הרביעי? הוא יכוון לשבת צמוד לשלישי — כך פגישות של שעה "מתחברות בזוגות" ולא מפרקות את היום.
          </p>
        </Example>

        <Example number={7} title="אותו מצב כמו דוגמה 2, אבל נבחר &quot;ללא הגבלה&quot;">
          <DayTimeline busy={[["12:00", "13:00"]]} offered={[["08:00", "09:00"]]} />
          <p>המערכת מציעה פשוט את השעה המוקדמת ביותר — <b>08:00</b> — בלי לחשוב על מה שנשאר. כך זה עבד עד היום.</p>
        </Example>
      </Section>

      <Section title="מה בית הספר רואה?">
        <ul className="list-disc pr-5 flex flex-col gap-1.5">
          <li><b>בכל יום פנוי</b> — את השעה המומלצת (הטובה והמוקדמת ביותר לפי הכללים).</li>
          <li><b>אם אפשרתם "אפשרויות נוספות"</b> — בית הספר יכול לכתוב טווח שעות שנוח לו. המועדים הרגילים נשארים על המסך, ומתחתם מופיעה שעה מתאימה בתוך הטווח שביקש.</li>
          <li>אם אין בטווח שלו שעה מתאימה — תוצע לו השעה המתאימה <b>הכי קרובה</b> (עד שעה לפני או אחרי), עם הסימון "הכי קרוב לבקשה שלכם".</li>
          <li>אם גם זה לא קיים — הוא יתבקש לנסות טווח שעות רחב יותר, לבחור מהמועדים המוצעים, או ליצור קשר. <b>המערכת אף פעם לא "מוותרת" על הכללים שקבעתם.</b></li>
        </ul>
      </Section>

      <Section title="שאלות נפוצות">
        <div className="flex flex-col gap-2.5">
          <div>
            <p className="font-semibold text-slate-800">האם יכול לקרות שבית ספר לא יקבל שום שעה?</p>
            <p>לא, אם ביום מסוים יש מספיק מקום לפגישה שלו — הוא תמיד יקבל שעה. הכללים רק בוחרים <i>איפה</i> ביום, לא <i>אם</i>.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">ומה אם שני בתי ספר לוחצים על אותה שעה בדיוק באותו רגע?</p>
            <p>רק אחד מהם יקבל אותה. השני יקבל מיד הודעה שהשעה נתפסה ויראה את השעה הפנויה הבאה. לעולם לא נקבעות שתי פגישות חופפות לאותו יועץ דרך הלינק.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">ומה עם אירועים פרטיים של היועץ ב-Outlook?</p>
            <p>הם נחשבים תפוסים בדיוק כמו פגישה, והמערכת מתכננת סביבם.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">מה זה "שעת התחלה: כל חצי שעה / רק בשעה עגולה"?</p>
            <p>
              "רק בשעה עגולה" — יוצעו שעות כמו 09:00 או 13:00 (ולא 09:30). בשני המצבים מותרת גם שעה שצמודה בדיוק לפגישה קיימת —
              למשל 10:30, מיד אחרי פגישה שמסתיימת ב-10:30 — כי צמידות היא בדיוק מה שמונע חורים.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">ותאריכים חסומים או ימים שכבר עברו?</p>
            <p>לא מוצעים לעולם. ביום הנוכחי מוצעות רק שעות שעוד לא עברו.</p>
          </div>
        </div>
      </Section>

      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
        <p className="font-bold text-emerald-900 mb-1">לסיכום, בשפה הכי פשוטה</p>
        <p>בוחרים כמה מקום חשוב לשמור ביומן. המערכת דואגת שהפגישות יישבו "צמודות" או ישאירו מספיק מקום — ובית הספר תמיד מקבל שעה טובה, הכי מוקדמת שאפשר.</p>
      </div>
    </div>
  );
}

const RESIZE_HANDLES = [
  { dir: "n", style: { top: 0, left: EDGE, right: EDGE, height: EDGE }, cursor: "ns-resize" },
  { dir: "s", style: { bottom: 0, left: EDGE, right: EDGE, height: EDGE }, cursor: "ns-resize" },
  { dir: "e", style: { right: 0, top: EDGE, bottom: EDGE, width: EDGE }, cursor: "ew-resize" },
  { dir: "w", style: { left: 0, top: EDGE, bottom: EDGE, width: EDGE }, cursor: "ew-resize" },
  { dir: "ne", style: { top: 0, right: 0, width: EDGE * 2, height: EDGE * 2 }, cursor: "nesw-resize" },
  { dir: "nw", style: { top: 0, left: 0, width: EDGE * 2, height: EDGE * 2 }, cursor: "nwse-resize" },
  { dir: "se", style: { bottom: 0, right: 0, width: EDGE * 2, height: EDGE * 2 }, cursor: "nwse-resize" },
  { dir: "sw", style: { bottom: 0, left: 0, width: EDGE * 2, height: EDGE * 2 }, cursor: "nesw-resize" },
];

export default function EfficientCalendarGuideWindow({ onClose }) {
  const [rect, setRect] = useState(defaultRect);
  const [minimized, setMinimized] = useState(false);
  const gestureRef = useRef(null);
  const windowRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    (minimized ? restoreRef.current : windowRef.current)?.focus();
  }, [minimized]);

  useEffect(() => {
    function onMove(e) {
      const g = gestureRef.current;
      if (!g) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const r = { ...g.rect };
      if (g.mode === "move") {
        r.x = Math.min(Math.max(-r.width + 120, r.x + dx), window.innerWidth - 120);
        r.y = Math.min(Math.max(0, r.y + dy), window.innerHeight - 48);
      } else {
        if (g.mode.includes("e")) r.width = Math.max(MIN_WIDTH, Math.min(g.rect.width + dx, window.innerWidth - g.rect.x));
        if (g.mode.includes("s")) r.height = Math.max(MIN_HEIGHT, Math.min(g.rect.height + dy, window.innerHeight - g.rect.y));
        if (g.mode.includes("w")) {
          const width = Math.max(MIN_WIDTH, Math.min(g.rect.width - dx, g.rect.x + g.rect.width));
          r.x = g.rect.x + g.rect.width - width;
          r.width = width;
        }
        if (g.mode.includes("n")) {
          const height = Math.max(MIN_HEIGHT, Math.min(g.rect.height - dy, g.rect.y + g.rect.height));
          r.y = g.rect.y + g.rect.height - height;
          r.height = height;
        }
      }
      setRect(r);
    }
    function onUp() {
      gestureRef.current = null;
      document.body.style.userSelect = "";
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
  }, []);

  function startGesture(e, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    gestureRef.current = { mode, startX: e.clientX, startY: e.clientY, rect };
    document.body.style.userSelect = "none";
  }

  // Events stop here so the modal underneath (React-tree parent of this portal) never sees them.
  const stop = e => e.stopPropagation();
  function onKeyDown(e) {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
  }

  if (minimized) {
    return createPortal(
      <button ref={restoreRef} type="button" dir="rtl" onClick={() => setMinimized(false)}
        onKeyDown={onKeyDown} onMouseDown={stop} onPointerDown={stop}
        aria-label='שחזור חלון ההסבר "יומן יעיל"'
        style={{ position: "fixed", left: 16, bottom: 16, zIndex: 10000 }}
        className="rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-xl flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-2xl transition-shadow">
        <span aria-hidden="true" className="w-5 h-5 rounded-full border border-slate-400 text-[11px] font-bold flex items-center justify-center">?</span>
        הסבר: יומן יעיל
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div ref={windowRef} tabIndex={-1} dir="rtl" role="dialog" aria-modal="false" aria-labelledby="efficient-calendar-guide-title"
      onKeyDown={onKeyDown} onMouseDown={stop} onPointerDown={stop} onClick={stop}
      style={{ position: "fixed", left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: 10000 }}
      className="bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden outline-none">
      <div onPointerDown={e => startGesture(e, "move")}
        className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50 cursor-move select-none flex-shrink-0">
        <h2 id="efficient-calendar-guide-title" className="text-sm font-bold text-slate-800 truncate">
          איך עובד "יומן יעיל"? — מדריך מלא
        </h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onPointerDown={stop} onClick={() => setMinimized(true)} aria-label="מזער את חלון ההסבר"
            className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800 flex items-center justify-center">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="5" y1="19" x2="19" y2="19" /></svg>
          </button>
          <button type="button" onPointerDown={stop} onClick={onClose} aria-label="סגור את חלון ההסבר"
            className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800 flex items-center justify-center">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>
      <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0">
        <GuideContent />
      </div>
      {RESIZE_HANDLES.map(h => (
        <div key={h.dir} aria-hidden="true" onPointerDown={e => startGesture(e, h.dir)}
          style={{ position: "absolute", ...h.style, cursor: h.cursor, touchAction: "none" }} />
      ))}
    </div>,
    document.body,
  );
}
