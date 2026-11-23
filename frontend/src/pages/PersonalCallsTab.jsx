import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { CallsTable, callsInView, useCallsTableView } from "../components/calls/CallsTable";
import { exportCallsToExcel } from "../components/calls/callsExport";
import { linkAnswersPending } from "../components/calls/CallRow";
import { clearDailyRange, readDailyRange, saveDailyRange, todayRange, useResetRangeOnNewDay } from "../lib/dailyDateRange";
import DateField from "../components/DateField";

const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";

// The default range is today only; a searched range is kept until the next 07:00.
const RANGE_KEY = "personal_calls";

// "2026-11-22" → "22.11.26"
function shortDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(-2)}`;
}

export default function PersonalCallsTab({ userId }) {
  const [calls, setCalls] = useState([]);
  const [callsEnabled, setCallsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [initialRange] = useState(() => readDailyRange(RANGE_KEY, userId) || todayRange());
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const rangeSetAtRef = useRef(Date.now());
  const [direction, setDirection] = useState("");
  // The table's column filters + sort, held here so the Excel export matches the screen and
  // they survive a new search.
  const tableView = useCallsTableView();
  // The range the table actually shows — the date inputs may have been edited without "חפש".
  const [loadedRange, setLoadedRange] = useState(null);
  // Only the latest search may fill the table: an older, slower response must not overwrite it.
  const requestSeqRef = useRef(0);

  async function loadCalls(range = { from: dateFrom, to: dateTo }) {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/calls/my-calls", {
        params: { date_from: `${range.from}T00:00:00`, date_to: `${range.to}T23:59:59` },
      });
      if (seq !== requestSeqRef.current) return;
      setCalls(res.data?.calls || []);
      setLoadedRange(range);
      setCallsEnabled(res.data?.calls_enabled !== false);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      const detail = e.response?.data?.detail;
      setError(detail || "שגיאה בשליפת שיחות — נסה לרענן");
      setCalls([]);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters() {
    rangeSetAtRef.current = Date.now();
    saveDailyRange(RANGE_KEY, userId, { from: dateFrom, to: dateTo });
    loadCalls();
  }

  // Passes the range explicitly — the old setTimeout(loadCalls) read the pre-reset dates from
  // its closure, so the inputs showed the default week while the table kept the old range.
  function clearFilters() {
    const range = todayRange();
    rangeSetAtRef.current = Date.now();
    clearDailyRange(RANGE_KEY, userId);
    setDateFrom(range.from);
    setDateTo(range.to);
    setDirection("");
    tableView.clear();
    loadCalls(range);
  }

  // A page left open overnight shows the new day once it's back on screen after 07:00.
  useResetRangeOnNewDay(rangeSetAtRef, () => {
    const range = todayRange();
    rangeSetAtRef.current = Date.now();
    setDateFrom(range.from);
    setDateTo(range.to);
    loadCalls(range);
  });

  // A card linked from a row joins that call here too, so the Excel export includes it at once.
  const handleLinked = useCallback((callId, card) => {
    setCalls(prev => prev.map(c => (
      c.call_id === callId && !(c.linked_schools || []).some(x => x.id === card.id)
        ? {
            ...c,
            linked_schools: [...(c.linked_schools || []), card],
            pending_school_resolution: c.pending_school_resolution && !linkAnswersPending(c, card.id),
          }
        : c
    )));
  }, []);

  const displayedCalls = direction ? calls.filter(c => c.direction === direction) : calls;
  const exportedCalls = callsInView(displayedCalls, tableView);
  const canExport = !loading && !error && callsEnabled && exportedCalls.length > 0 && !!loadedRange;

  function exportToExcel() {
    exportCallsToExcel(exportedCalls, {
      fileName: `שיחות_${shortDate(loadedRange.from)}-${shortDate(loadedRange.to)}.xlsx`,
      sheetName: "השיחות שלי",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900">שיחות</h1>
        <button type="button" onClick={exportToExcel} disabled={!canExport}
          title={canExport ? "הורדת השיחות המוצגות לקובץ אקסל" : "אין שיחות להורדה"}
          className="btn-ghost text-sm px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
          <svg aria-hidden="true" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
          </svg>
          הורדה לאקסל
        </button>
      </div>

      <div className="glass-card rounded-xl p-4 mb-3" dir="rtl">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="personal-calls-filter-date-from" className="block text-xs font-medium text-slate-500 mb-1">מתאריך</label>
            <DateField id="personal-calls-filter-date-from" value={dateFrom}
              onChange={setDateFrom} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="personal-calls-filter-date-to" className="block text-xs font-medium text-slate-500 mb-1">עד תאריך</label>
            <DateField id="personal-calls-filter-date-to" value={dateTo}
              onChange={setDateTo} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="personal-calls-filter-direction" className="block text-xs font-medium text-slate-500 mb-1">כיוון</label>
            <select id="personal-calls-filter-direction" value={direction} onChange={e => setDirection(e.target.value)} className={INPUT_CLS}>
              <option value="">הכל</option>
              <option value="incoming">נכנסת</option>
              <option value="outgoing">יוצאת</option>
              <option value="internal">פנימית</option>
            </select>
          </div>
          <button type="button" onClick={applyFilters} className="btn-blue text-sm px-4 py-1.5 rounded-lg">
            חפש
          </button>
          <button type="button" onClick={clearFilters} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1 py-1.5 self-end">
            נקה סינון
          </button>
        </div>
      </div>

      {loading ? (
        <div className="glass-card rounded-2xl p-10 flex justify-center">
          <div role="status" aria-label="טוען שיחות"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
        </div>
      ) : error ? (
        <div role="alert" className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button onClick={() => loadCalls()} className="btn-blue text-sm px-4 py-2">רענן</button>
        </div>
      ) : !callsEnabled ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-3xl mb-3">📞</p>
          <p className="font-semibold text-slate-700 mb-1">אינטגרציית השיחות אינה מוגדרת</p>
          <p className="text-slate-400 text-sm">ניתן להגדיר אינטגרציית שיחות (VOICENTER / EXM) באזור ניהול</p>
        </div>
      ) : displayedCalls.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-3xl mb-3">📞</p>
          <p className="font-semibold text-slate-700 mb-1">אין שיחות להצגה</p>
          <p className="text-slate-400 text-sm mb-4">נסה לשנות את טווח התאריכים או הסינון</p>
        </div>
      ) : (
        <CallsTable calls={displayedCalls} hideAdvisorColumn canManage={false} canLink onLinked={handleLinked} view={tableView} />
      )}
    </div>
  );
}
