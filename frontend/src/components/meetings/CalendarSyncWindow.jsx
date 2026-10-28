import { useCalendarSync } from "../../context/CalendarSyncContext";

const WIDTH = 380;
const PILL_WIDTH = 260;
const PILL_GAP = 10;
const CASCADE_STEP = 28;
const CASCADE_CYCLE = 6; // wrap the offset so windows don't drift off-screen — same as CompareResultsWindow

// Renders every open calendar-sync progress window independently — closing or minimizing one
// never affects the others. Minimized windows stack left-to-right as small pills anchored to
// the bottom-left corner — same `left: 16 + order * (PILL_WIDTH + PILL_GAP)` convention every
// sibling floating window (CompareResultsWindow, MeetingNotesWindow, TaskPanel, CallNoteWindow,
// GuideWindow) uses, so simultaneously-minimized pills from different features line up in one
// row instead of overlapping. Polling runs inside CalendarSyncContext itself (not this
// component), so it keeps running while minimized and across route navigation — the window
// here is a pure view of that context state.
export default function CalendarSyncWindow() {
  const { syncWindows } = useCalendarSync();
  const minimizedIds = syncWindows.filter(w => w.minimized).map(w => w.id);
  const expandedIds = syncWindows.filter(w => !w.minimized).map(w => w.id);

  return (
    <>
      {syncWindows.map(w => (
        <SyncWindowItem
          key={w.id}
          id={w.id}
          batchId={w.batchId}
          minimized={w.minimized}
          data={w.data}
          error={w.error}
          minimizedOrder={minimizedIds.indexOf(w.id)}
          expandedOrder={expandedIds.indexOf(w.id)}
        />
      ))}
    </>
  );
}

function SyncWindowItem({ id, minimized, data, error, minimizedOrder, expandedOrder }) {
  const { closeCalendarSync, setMinimized } = useCalendarSync();

  const notFound = Boolean(data?.not_found);
  const unavailable = Boolean(data?.unavailable);
  const total = data?.total ?? 0;
  const done = data?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = Boolean(data?.is_complete);
  const failedCount = data?.counts?.failed ?? 0;

  if (minimized) {
    const left = 16 + Math.max(0, minimizedOrder) * (PILL_WIDTH + PILL_GAP);
    return (
      <button
        type="button"
        onClick={() => setMinimized(id, false)}
        dir="rtl"
        aria-label={`שחזור חלון סנכרון יומן Outlook${total ? ` — ${done} מתוך ${total} הושלמו` : ""}`}
        style={{ position: "fixed", left, bottom: 16, zIndex: 60, width: PILL_WIDTH, flexShrink: 0 }}
        className="glass-card rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 text-sm font-semibold text-slate-700 hover:shadow-xl transition-shadow"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="truncate">
          {notFound ? "אין פגישות לסנכרון" : isComplete ? "סנכרון יומן הושלם" : "מסנכרן ליומן Outlook..."}
          {total > 0 && <span className="font-normal text-slate-500"> — {done}/{total}</span>}
        </span>
        {!isComplete && <span aria-hidden="true" className="spinner w-3.5 h-3.5 flex-shrink-0" />}
      </button>
    );
  }

  const cascade = (Math.max(0, expandedOrder) % CASCADE_CYCLE) * CASCADE_STEP;

  return (
    <div
      role="region"
      aria-label="חלון סנכרון יומן Outlook"
      dir="rtl"
      style={{ position: "fixed", left: 16 + cascade, bottom: 16 + cascade, width: WIDTH, zIndex: 60 }}
      className="glass-card rounded-2xl shadow-2xl flex flex-col overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0"
        style={{ background: "rgba(241,245,249,0.97)" }}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => closeCalendarSync(id)}
            aria-label="סגור חלון סנכרון יומן"
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMinimized(id, true)}
            aria-label="מזער חלון סנכרון יומן"
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="19" x2="19" y2="19" />
            </svg>
          </button>
        </div>
        <div className="text-sm font-bold text-slate-800">סנכרון יומן Outlook</div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {notFound && (
          <p role="status" className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2 text-center">
            לא נדרש סנכרון יומן עבור ייבוא זה — ייתכן שלאף אחת מהפגישות שיובאו לא שויך יועץ מחובר ליומן Outlook.
          </p>
        )}
        {unavailable && (
          <p role="alert" className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 text-center">
            שגיאה זמנית בבדיקת הסטטוס — מנסה שוב ברקע. הסנכרון עצמו ממשיך לרוץ בשרת ללא תלות בחלון זה.
          </p>
        )}
        {error === "poll_failed" && (
          <p role="alert" className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 text-center">
            שגיאה זמנית בבדיקת הסטטוס — מנסה שוב ברקע. הסנכרון עצמו ממשיך לרוץ בשרת ללא תלות בחלון זה.
          </p>
        )}
        {!data && !error && (
          <div role="status" aria-label="טוען סטטוס סנכרון" className="flex items-center justify-center gap-2 py-4 text-sm text-slate-400">
            <div aria-hidden="true" className="spinner w-4 h-4" />
            טוען...
          </div>
        )}
        {data && !notFound && !unavailable && (
          <>
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span>{isComplete ? "הושלם" : "מתבצע בהדרגה — כל כמה דקות עוד פגישות מתווספות ליומן"}</span>
                <span className="font-semibold text-slate-700">{done}/{total}</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="התקדמות סנכרון יומן"
                className="h-2 rounded-full bg-slate-200 overflow-hidden"
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: failedCount > 0 ? "#f59e0b" : "#0070F3" }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{data.counts.sent} סונכרנו</span>
              {data.counts.pending + data.counts.processing > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold">{data.counts.pending + data.counts.processing} ממתינות</span>
              )}
              {failedCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-semibold">{failedCount} נכשלו</span>
              )}
              {data.counts.skipped > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold">{data.counts.skipped} דולגו</span>
              )}
            </div>

            {failedCount > 0 && (
              <div className="flex flex-col gap-1.5 max-h-48 overflow-auto">
                <h4 className="text-xs font-bold text-red-700">פגישות שלא הסתנכרנו:</h4>
                <ul className="flex flex-col gap-1.5">
                  {data.failed_rows.map(r => (
                    <li key={r.meeting_id} className="text-xs text-slate-700 bg-red-50 rounded-lg px-3 py-2">
                      <div className="font-semibold">{r.school_name || "בית ספר"} {r.advisor_name && `— ${r.advisor_name}`}</div>
                      <div className="text-slate-500 mt-0.5">{r.error_message || "שגיאה לא ידועה"}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
