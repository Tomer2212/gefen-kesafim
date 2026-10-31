import { useEffect, useState } from "react";
import axios from "axios";
import { CallsTable } from "../components/calls/CallsTable";

const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";

function pad(n) { return String(n).padStart(2, "0"); }
function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function startOfWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return toISODate(d);
}

const TODAY = toISODate(new Date());

export default function AdminCallsTab({ users }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Day / week view (same pattern as ביצועים) instead of a free date range — every extra day
  // is another org-wide pull from the provider, so the backend caps a request at one week.
  // Unlike ביצועים, the week here is Sunday–Saturday so no call is ever hidden from the table.
  const [viewMode, setViewMode] = useState("day"); // "day" | "week"
  const [anchorDate, setAnchorDate] = useState(TODAY);
  const [advisorId, setAdvisorId] = useState("");
  const [direction, setDirection] = useState("");
  const [reload, setReload] = useState(0);

  const advisors = (users || []).filter(u => u.role === "advisor" || u.role === "manager" || u.role === "owner");

  const rangeStart = viewMode === "day" ? anchorDate : startOfWeek(anchorDate);
  const rangeEnd = viewMode === "day" ? anchorDate : addDays(rangeStart, 6);

  useEffect(() => {
    if (!anchorDate) return;
    let cancelled = false;
    async function loadCalls() {
      setLoading(true);
      setError("");
      try {
        const params = {
          date_from: `${rangeStart}T00:00:00`,
          date_to: `${rangeEnd}T23:59:59`,
        };
        if (advisorId) params.advisor_id = advisorId;
        const res = await axios.get("/calls/calls", { params });
        if (!cancelled) setCalls(res.data?.calls || []);
      } catch (e) {
        if (cancelled) return;
        setError(e.response?.data?.detail || "שגיאה בשליפת השיחות — נסה לרענן");
        setCalls([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadCalls();
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd, advisorId, reload]);

  function goPrev() { setAnchorDate(d => addDays(d, viewMode === "day" ? -1 : -7)); }
  function goNext() { setAnchorDate(d => addDays(d, viewMode === "day" ? 1 : 7)); }
  function goToday() { setAnchorDate(TODAY); }

  function clearFilters() {
    setViewMode("day");
    setAnchorDate(TODAY);
    setAdvisorId("");
    setDirection("");
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
            <label htmlFor="calls-filter-view" className="block text-xs font-medium text-slate-500 mb-1">תצוגה</label>
            <select id="calls-filter-view" value={viewMode} onChange={e => setViewMode(e.target.value)} className={INPUT_CLS}>
              <option value="day">יום</option>
              <option value="week">שבוע</option>
            </select>
          </div>
          <div>
            <label htmlFor="calls-filter-date" className="block text-xs font-medium text-slate-500 mb-1">תאריך</label>
            <input id="calls-filter-date" type="date" value={anchorDate}
              onChange={e => setAnchorDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <div className="flex items-center gap-1 self-end">
            <button type="button" onClick={goPrev} aria-label="הקודם" className="btn-ghost text-sm px-3 py-1.5 rounded-lg">▶</button>
            <button type="button" onClick={goToday} className="btn-ghost text-sm px-3 py-1.5 rounded-lg">היום</button>
            <button type="button" onClick={goNext} aria-label="הבא" className="btn-ghost text-sm px-3 py-1.5 rounded-lg">◀</button>
          </div>
          <div>
            <label htmlFor="calls-filter-advisor" className="block text-xs font-medium text-slate-500 mb-1">יועץ</label>
            <select id="calls-filter-advisor" value={advisorId} onChange={e => setAdvisorId(e.target.value)} className={INPUT_CLS}>
              <option value="">הכל</option>
              {advisors.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="calls-filter-direction" className="block text-xs font-medium text-slate-500 mb-1">כיוון</label>
            <select id="calls-filter-direction" value={direction} onChange={e => setDirection(e.target.value)} className={INPUT_CLS}>
              <option value="">הכל</option>
              <option value="incoming">נכנסת</option>
              <option value="outgoing">יוצאת</option>
              <option value="internal">פנימית</option>
            </select>
          </div>
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
          <button onClick={() => setReload(n => n + 1)} className="btn-blue text-sm px-4 py-2">רענן</button>
        </div>
      ) : displayedCalls.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-3xl mb-3">📞</p>
          <p className="font-semibold text-slate-700 mb-1">אין שיחות להצגה</p>
          <p className="text-slate-400 text-sm mb-4">נסה לבחור יום או שבוע אחר, או לשנות את הסינון</p>
        </div>
      ) : (
        <CallsTable calls={displayedCalls} />
      )}
    </div>
  );
}
