import { useEffect, useState } from "react";
import axios from "axios";
import { CallsTable } from "../components/calls/CallsTable";

const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_DATE_FROM = isoDateDaysAgo(7);

export default function PersonalCallsTab() {
  const [calls, setCalls] = useState([]);
  const [callsEnabled, setCallsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState(TODAY);
  const [direction, setDirection] = useState("");

  async function loadCalls() {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/calls/my-calls", {
        params: { date_from: `${dateFrom}T00:00:00`, date_to: `${dateTo}T23:59:59` },
      });
      setCalls(res.data?.calls || []);
      setCallsEnabled(res.data?.calls_enabled !== false);
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(detail || "שגיאה בשליפת שיחות — נסה לרענן");
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters() {
    loadCalls();
  }

  function clearFilters() {
    setDateFrom(DEFAULT_DATE_FROM);
    setDateTo(TODAY);
    setDirection("");
    setTimeout(loadCalls, 0);
  }

  const displayedCalls = direction ? calls.filter(c => c.direction === direction) : calls;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900">שיחות</h1>
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
          <button onClick={loadCalls} className="btn-blue text-sm px-4 py-2">רענן</button>
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
        <CallsTable calls={displayedCalls} hideAdvisorColumn canManage={false} />
      )}
    </div>
  );
}
