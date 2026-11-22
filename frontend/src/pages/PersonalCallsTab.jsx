import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { CallsTable, DEFAULT_CALLS_SORT, sortCalls } from "../components/calls/CallsTable";
import { exportCallsToExcel } from "../components/calls/callsExport";

const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";

// Local date (not toISOString, which is UTC — after midnight in Israel it still says yesterday).
function localDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Computed on each use, so a tab left open past midnight still defaults to the real today.
const defaultRange = () => ({ from: localDateDaysAgo(7), to: localDateDaysAgo(0) });

// "2026-11-22" → "22.11.26"
function shortDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(-2)}`;
}

export default function PersonalCallsTab() {
  const [calls, setCalls] = useState([]);
  const [callsEnabled, setCallsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(() => defaultRange().from);
  const [dateTo, setDateTo] = useState(() => defaultRange().to);
  const [direction, setDirection] = useState("");
  // Held here (not inside CallsTable) so the Excel export keeps the table's row order.
  const [sort, setSort] = useState(DEFAULT_CALLS_SORT);
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
    loadCalls();
  }

  // Passes the range explicitly — the old setTimeout(loadCalls) read the pre-reset dates from
  // its closure, so the inputs showed the default week while the table kept the old range.
  function clearFilters() {
    const range = defaultRange();
    setDateFrom(range.from);
    setDateTo(range.to);
    setDirection("");
    loadCalls(range);
  }

  const displayedCalls = direction ? calls.filter(c => c.direction === direction) : calls;
  const canExport = !loading && !error && callsEnabled && displayedCalls.length > 0 && !!loadedRange;

  function exportToExcel() {
    exportCallsToExcel(sortCalls(displayedCalls, sort), {
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
            <input id="personal-calls-filter-date-from" type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="personal-calls-filter-date-to" className="block text-xs font-medium text-slate-500 mb-1">עד תאריך</label>
            <input id="personal-calls-filter-date-to" type="date" value={dateTo}
              onChange={e => setDateTo(e.target.value)} className={INPUT_CLS} />
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
        <CallsTable calls={displayedCalls} hideAdvisorColumn canManage={false} sort={sort} onSortChange={setSort} />
      )}
    </div>
  );
}
