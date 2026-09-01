import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { fetchRangeBusyByDate } from "../components/meetings/dayScheduleUtils";
import { computeEndTimeIso } from "../components/calls/CallRow";
import { PerformanceDayCard } from "../components/performance/PerformanceDayCard";

const INPUT_CLS = "text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white";
const WEEKDAY_LABELS = ["יום א׳", "יום ב׳", "יום ג׳", "יום ד׳", "יום ה׳", "יום ו׳", "שבת"];

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
function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${WEEKDAY_LABELS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
function timeFromIso(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dateKeyFromIso(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return toISODate(d);
}

const TODAY = toISODate(new Date());

// Single-select searchable advisor picker. Replaces a plain <select> so the user can type
// free text and have every keystroke filter the list. Reports the chosen id via onChange;
// all downstream data-loading logic keys off that id exactly as before.
function AdvisorCombobox({ id, advisors, value, onChange, disabled, loadingUsers }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selected = advisors.find(u => u.id === value) || null;
  const selectedLabel = selected ? (selected.full_name || selected.email) : "";
  const filtered = advisors.filter(u =>
    !query.trim() || (u.full_name || u.email || "").toLowerCase().includes(query.trim().toLowerCase())
  );

  function pick(u) {
    onChange(u.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => {
        if (!containerRef.current?.contains(e.relatedTarget)) { setOpen(false); setQuery(""); }
      }}
    >
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        className={INPUT_CLS + " w-44"}
        placeholder={loadingUsers ? "טוען..." : "בחר יועץ"}
        value={open ? query : selectedLabel}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onClick={() => { setOpen(true); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "Escape") { setOpen(false); setQuery(""); e.currentTarget.blur(); }
          else if (e.key === "Enter" && open && filtered.length > 0) { e.preventDefault(); pick(filtered[0]); }
        }}
      />
      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 right-0 left-0 mt-1 max-h-60 overflow-y-auto border border-slate-200 rounded-lg bg-white shadow-xl py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">לא נמצאו יועצים</li>
          ) : filtered.map(u => (
            <li key={u.id} role="option" aria-selected={u.id === value}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(u); }}
                className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${u.id === value ? "text-blue-600 font-medium" : "text-slate-700"}`}
              >
                {u.full_name || u.email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminPerformanceTab({ users, loadingUsers, loadUsers }) {
  const advisors = (users || []).filter(u => u.role === "advisor" || u.role === "manager" || u.role === "owner");

  const [advisorId, setAdvisorId] = useState("");
  const [viewMode, setViewMode] = useState("week"); // "day" | "week"
  const [anchorDate, setAnchorDate] = useState(TODAY);
  const [loading, setLoading] = useState(false);
  const [plannedByDate, setPlannedByDate] = useState({});
  const [plannedFailed, setPlannedFailed] = useState(false);
  const [actualByDate, setActualByDate] = useState({});
  const [callsError, setCallsError] = useState("");
  const [offlineError, setOfflineError] = useState("");

  // Users are only ever fetched centrally in AdminPage when the "משתמשים"/"חיובים" tabs are
  // visited — landing on "ביצועים" directly (without visiting one of those first) would
  // otherwise leave the advisor dropdown permanently empty. Same self-load guard AdminMeetingsTab uses.
  useEffect(() => {
    if (!users || users.length === 0) loadUsers?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!advisorId && advisors.length > 0) setAdvisorId(advisors[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisors.length]);

  // Week view shows Sunday–Friday only (6 days) — Saturday is never a work day here, no need
  // to render an always-empty column for it.
  const datesInRange = viewMode === "day"
    ? [anchorDate]
    : Array.from({ length: 6 }, (_, i) => addDays(startOfWeek(anchorDate), i));

  useEffect(() => {
    if (!advisorId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setCallsError("");
      setOfflineError("");
      const rangeStart = datesInRange[0];
      const rangeEnd = datesInRange[datesInRange.length - 1];
      const rangeEndExclusive = addDays(rangeEnd, 1);

      // Each data source is fetched (and can fail) independently — a hiccup in one (e.g. the
      // offline-work endpoint) must never blank out the other two, and the specific failure
      // needs to stay visible instead of being swallowed by one shared try/catch.
      const plannedPromise = fetchRangeBusyByDate(advisorId, rangeStart, rangeEndExclusive);
      const callsPromise = axios.get("/voicenter/calls", {
        params: { date_from: `${rangeStart}T00:00:00`, date_to: `${rangeEnd}T23:59:59`, advisor_id: advisorId },
      }).catch(e => { setCallsError(e.response?.data?.detail || "שגיאה בטעינת שיחות"); return null; });
      const offlinePromise = axios.get("/performance/offline-work", {
        params: { advisor_id: advisorId, date_from: rangeStart, date_to: rangeEnd },
      }).catch(e => { setOfflineError(e.response?.data?.detail || "שגיאה בטעינת עבודה עצמאית"); return null; });

      const [plannedRes, callsRes, offlineRes] = await Promise.all([plannedPromise, callsPromise, offlinePromise]);
      if (cancelled) return;

      if (plannedRes === null) {
        setPlannedFailed(true);
        setPlannedByDate({});
      } else {
        setPlannedFailed(false);
        setPlannedByDate(plannedRes);
      }

      const byDate = {};
      for (const call of (callsRes?.data?.calls || [])) {
        const dateKey = dateKeyFromIso(call.start_time);
        const startHM = timeFromIso(call.start_time);
        const endHM = timeFromIso(computeEndTimeIso(call.start_time, call.duration_seconds));
        if (!dateKey || !startHM || !endHM) continue;
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push({
          id: `call-${call.call_id}`,
          startHM, endHM, kind: "call",
          subject: call.contact_name || call.school_name || "שיחה",
        });
      }
      for (const entry of (offlineRes?.data?.entries || [])) {
        const dateKey = entry.entry_date;
        if (!dateKey || !entry.start_time || !entry.end_time) continue;
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push({
          id: `offline-${entry.entry_id}`,
          startHM: entry.start_time, endHM: entry.end_time, kind: "offline",
          subject: entry.notes || `עבודה עצמאית - ${entry.school_name || ""}`,
        });
      }
      setActualByDate(byDate);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advisorId, viewMode, anchorDate]);

  function goPrev() { setAnchorDate(addDays(anchorDate, viewMode === "day" ? -1 : -7)); }
  function goNext() { setAnchorDate(addDays(anchorDate, viewMode === "day" ? 1 : 7)); }
  function goToday() { setAnchorDate(TODAY); }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900">ביצועים</h1>
      </div>

      <div className="glass-card rounded-xl p-4 mb-4 relative z-40" dir="rtl">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="perf-filter-advisor" className="block text-xs font-medium text-slate-500 mb-1">יועץ</label>
            <AdvisorCombobox
              id="perf-filter-advisor"
              advisors={advisors}
              value={advisorId}
              onChange={setAdvisorId}
              disabled={loadingUsers}
              loadingUsers={loadingUsers}
            />
          </div>
          <div>
            <label htmlFor="perf-filter-view" className="block text-xs font-medium text-slate-500 mb-1">תצוגה</label>
            <select id="perf-filter-view" value={viewMode} onChange={e => setViewMode(e.target.value)} className={INPUT_CLS}>
              <option value="day">יום</option>
              <option value="week">שבוע</option>
            </select>
          </div>
          <div>
            <label htmlFor="perf-filter-date" className="block text-xs font-medium text-slate-500 mb-1">תאריך</label>
            <input id="perf-filter-date" type="date" value={anchorDate}
              onChange={e => setAnchorDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <div className="flex items-center gap-1 self-end">
            <button type="button" onClick={goPrev} aria-label="הקודם" className="btn-ghost text-sm px-3 py-1.5 rounded-lg">▶</button>
            <button type="button" onClick={goToday} className="btn-ghost text-sm px-3 py-1.5 rounded-lg">היום</button>
            <button type="button" onClick={goNext} aria-label="הבא" className="btn-ghost text-sm px-3 py-1.5 rounded-lg">◀</button>
          </div>
          <div className="flex items-center gap-4 self-end mr-auto text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-amber-100 border border-amber-300" /> מתוכנן (Outlook)</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-green-100 border border-green-300" /> שיחה</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-purple-100 border border-purple-300" /> עבודה עצמאית</span>
          </div>
        </div>
      </div>

      {!advisorId ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <p className="text-slate-400 text-sm">{loadingUsers ? "טוען יועצים..." : "בחר יועץ כדי לצפות בביצועים שלו"}</p>
        </div>
      ) : (
        <>
          {plannedFailed && (
            <div role="alert" className="glass-card rounded-xl p-3 mb-3 text-sm text-amber-700 border border-amber-200">
              לא ניתן היה לבדוק את יומן ה-Outlook של היועץ כרגע — עמודת "מתוכנן" עשויה להיות חסרה.
            </div>
          )}
          {callsError && (
            <div role="alert" className="glass-card rounded-xl p-3 mb-3 text-sm text-red-600 border border-red-200">{callsError}</div>
          )}
          {offlineError && (
            <div role="alert" className="glass-card rounded-xl p-3 mb-3 text-sm text-red-600 border border-red-200">{offlineError}</div>
          )}
          {loading ? (
            <div className="glass-card rounded-2xl p-10 flex justify-center">
              <div role="status" aria-label="טוען נתוני ביצועים"><div aria-hidden="true" className="spinner w-8 h-8" /></div>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {datesInRange.map(dateStr => (
                <PerformanceDayCard
                  key={dateStr}
                  dayLabel={formatDayLabel(dateStr)}
                  plannedItems={plannedByDate[dateStr] || []}
                  actualItems={actualByDate[dateStr] || []}
                  plannedFailed={plannedFailed}
                  width={viewMode === "week" ? 300 : 520}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
