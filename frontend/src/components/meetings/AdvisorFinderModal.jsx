import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { MultiSelectChips } from "../MultiSelectChips";
import { DOMAIN_OPTIONS, DOMAIN_LEVEL_OPTIONS } from "../../constants/domains";
import { SchoolPickerModal } from "./SchoolPickerCell";
import AdvisorFinderSettingsModal from "./AdvisorFinderSettingsModal";
import { DatePickerPopover } from "./DatePickerPopover";

const DURATION_OPTIONS = Array.from({ length: (180 - 15) / 15 + 1 }, (_, i) => 15 + i * 15);

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  const hourWord = hours === 1 ? "שעה" : hours === 2 ? "שעתיים" : `${hours} שעות`;
  if (rem === 0) return hourWord;
  const remWord = rem === 15 ? "ורבע" : rem === 30 ? "וחצי" : "ושלושת רבעי";
  return `${hourWord} ${remWord}`;
}

// Displayed/typed as DD/MM/YY — same convention as DirectCoordinationModal.
function maskDateInput(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 6);
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

function formatDateHe(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// ISO ("YYYY-MM-DD", as returned by DatePickerPopover) -> the DD/MM/YY text these inputs use.
function isoToDDMMYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

// Displayed/typed as HH:MM, free text (no picker) — used for the optional hour-range filter.
function maskTimeInput(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return digits;
}

// Fills in whatever the user didn't bother typing: "15" -> "15:00", "5" -> "05:00",
// "9:3" -> "09:03" — so a bare hour is understood as that hour on the dot.
function normalizeTimeText(text) {
  if (!text) return "";
  if (/^\d{1,2}$/.test(text)) return `${text.padStart(2, "0")}:00`;
  const m = /^(\d{1,2}):(\d{0,2})$/.exec(text);
  if (m) return `${m[1].padStart(2, "0")}:${(m[2] || "0").padStart(2, "0")}`;
  return text;
}

function parseTimeHHMM(text) {
  const normalized = normalizeTimeText(text);
  const m = /^(\d{2}):(\d{2})$/.exec(normalized);
  if (!m) return null;
  const hour = parseInt(m[1], 10), minute = parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return null;
  return normalized;
}

function todayDDMMYY() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

export function AdvisorFinderModal({ onClose, schools, users, onBook }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [domains, setDomains] = useState([]);
  const [domainLevels, setDomainLevels] = useState({});
  const [duration, setDuration] = useState(60);
  const [fromText, setFromText] = useState(todayDDMMYY);
  const [toText, setToText] = useState(todayDDMMYY);
  const [timeFromText, setTimeFromText] = useState("");
  const [timeToText, setTimeToText] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [pendingSlot, setPendingSlot] = useState(null); // { advisorId, date, startTime, endTime }
  const [booking, setBooking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [exclusionCount, setExclusionCount] = useState(0);
  const fromAnchorRef = useRef(null);
  const toAnchorRef = useRef(null);

  const allDates = results ? [...new Set(results.flatMap(a => a.days.map(d => d.date)))].sort() : [];

  function handleDomainsChange(newDomains) {
    setDomains(newDomains);
    setDomainLevels(prev => {
      const next = {};
      for (const d of newDomains) next[d] = prev[d] || "beginner";
      return next;
    });
  }

  function refreshExclusionCount() {
    axios.get("/schools/advisor-finder/settings")
      .then(res => {
        const ids = res.data?.advisor_finder_excluded_ids || [];
        const roles = res.data?.advisor_finder_excluded_roles || [];
        setExclusionCount(ids.length + roles.length);
      })
      .catch(() => {});
  }

  useEffect(() => { refreshExclusionCount(); }, []);

  async function handleSearch() {
    const dateFrom = parseDateDDMMYY(fromText);
    const dateTo = parseDateDDMMYY(toText);
    if (domains.length === 0 || !dateFrom || !dateTo) {
      setError("יש למלא את כל השדות: תחומי ידע, משך זמן וטווח תאריכים תקין (DD/MM/YY)");
      return;
    }
    if (dateTo < dateFrom) {
      setError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה");
      return;
    }
    const timeFrom = timeFromText ? parseTimeHHMM(timeFromText) : null;
    const timeTo = timeToText ? parseTimeHHMM(timeToText) : null;
    if ((timeFromText && !timeFrom) || (timeToText && !timeTo)) {
      setError("טווח שעות לא תקין (HH:MM)");
      return;
    }
    if (timeFrom && timeTo && timeTo <= timeFrom) {
      setError("שעת הסיום בטווח השעות חייבת להיות אחרי שעת ההתחלה");
      return;
    }
    setError("");
    setSearching(true);
    setResults(null);
    try {
      const res = await axios.post("/schools/advisor-finder/search", {
        control_domains: domains,
        control_domain_levels: domainLevels,
        duration_minutes: duration,
        date_from: dateFrom,
        date_to: dateTo,
        ...(timeFrom && { time_from: timeFrom }),
        ...(timeTo && { time_to: timeTo }),
      });
      setResults(res.data?.advisors || []);
    } catch {
      setError("איתור היועצים נכשל, נסה שוב");
    } finally {
      setSearching(false);
    }
  }

  async function handleConfirmSchool(school) {
    if (!pendingSlot || booking) return;
    setBooking(true);
    try {
      await onBook(pendingSlot.advisorId, pendingSlot.date, pendingSlot.startTime, pendingSlot.endTime, school, pendingSlot.advisorFullName);
      onClose();
    } finally {
      setBooking(false);
      setPendingSlot(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget && !pendingSlot) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="advisor-finder-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col gap-4">
        <h2 id="advisor-finder-title" className="font-bold text-slate-900 text-lg">איתור יועץ</h2>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex flex-wrap items-start justify-center gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500">תחומי ידע</span>
            <MultiSelectChips options={DOMAIN_OPTIONS} selected={domains} onChange={handleDomainsChange} placeholder="בחר תחומי ידע"
              className="w-40"
              boxClassName="w-40 text-sm border border-slate-200 rounded-lg pl-6 pr-2.5 py-1.5 outline-none focus:border-blue-400 bg-white flex flex-wrap items-center gap-1.5 cursor-pointer"
              showChevron checkIcon
              levels levelOptions={DOMAIN_LEVEL_OPTIONS}
              levelValues={domainLevels}
              onLevelChange={(d, lvl) => setDomainLevels(prev => {
                const next = { ...prev };
                if (lvl) next[d] = lvl;
                else delete next[d];
                return next;
              })} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="af-duration" className="text-xs font-semibold text-slate-500">משך זמן נחוץ</label>
            <select id="af-duration" value={duration} onChange={e => setDuration(Number(e.target.value))}
              className="w-40 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white">
              {DURATION_OPTIONS.map(m => <option key={m} value={m}>{formatDuration(m)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 text-center">טווח תאריכים</span>
            <div className="flex items-center gap-1.5">
              <label htmlFor="af-from" className="sr-only">מתאריך</label>
              <div ref={fromAnchorRef} className="relative w-28">
                <input id="af-from" type="text" inputMode="numeric" placeholder="DD/MM/YY" maxLength={8}
                  value={fromText} onChange={e => setFromText(maskDateInput(e.target.value))}
                  className="w-28 text-sm border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 outline-none focus:border-blue-400 bg-white" />
                <button type="button" onClick={() => setShowFromPicker(o => !o)} aria-label="פתח יומן לבחירת תאריך התחלה"
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600">
                  <span aria-hidden="true">📅</span>
                </button>
                {showFromPicker && (
                  <DatePickerPopover value={parseDateDDMMYY(fromText)}
                    anchorRef={fromAnchorRef}
                    onChange={v => setFromText(isoToDDMMYY(v))}
                    onClose={() => setShowFromPicker(false)} />
                )}
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">עד</span>
              <label htmlFor="af-to" className="sr-only">עד תאריך</label>
              <div ref={toAnchorRef} className="relative w-28">
                <input id="af-to" type="text" inputMode="numeric" placeholder="DD/MM/YY" maxLength={8}
                  value={toText} onChange={e => setToText(maskDateInput(e.target.value))}
                  className="w-28 text-sm border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 outline-none focus:border-blue-400 bg-white" />
                <button type="button" onClick={() => setShowToPicker(o => !o)} aria-label="פתח יומן לבחירת תאריך סיום"
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600">
                  <span aria-hidden="true">📅</span>
                </button>
                {showToPicker && (
                  <DatePickerPopover value={parseDateDDMMYY(toText)}
                    anchorRef={toAnchorRef}
                    onChange={v => setToText(isoToDDMMYY(v))}
                    onClose={() => setShowToPicker(false)} />
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 text-center">טווח שעות</span>
            <div className="flex items-center gap-1.5">
              <label htmlFor="af-time-from" className="sr-only">משעה</label>
              <input id="af-time-from" type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
                value={timeFromText} onChange={e => setTimeFromText(maskTimeInput(e.target.value))}
                onBlur={() => setTimeFromText(t => (parseTimeHHMM(t) || t))}
                className="w-20 text-sm text-center border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 bg-white" />
              <span className="text-xs text-slate-500 whitespace-nowrap">עד</span>
              <label htmlFor="af-time-to" className="sr-only">עד שעה</label>
              <input id="af-time-to" type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
                value={timeToText} onChange={e => setTimeToText(maskTimeInput(e.target.value))}
                onBlur={() => setTimeToText(t => (parseTimeHHMM(t) || t))}
                className="w-20 text-sm text-center border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 bg-white" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={handleSearch} disabled={searching}
            className="btn-blue text-sm px-5 py-2 disabled:opacity-50">
            {searching ? "מאתר..." : "איתור"}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">סגירה</button>
          <button type="button" onClick={() => setSettingsOpen(true)}
            className="btn-ghost flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl font-medium">
            <span aria-hidden="true">⚙</span> החרג יועצים
            {exclusionCount > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 text-xs font-bold rounded-full bg-blue-50 text-blue-700 leading-none">
                {exclusionCount}
              </span>
            )}
          </button>
        </div>

        {searching && (
          <div role="status" aria-label="מאתר יועצים" className="flex justify-center py-6">
            <div aria-hidden="true" className="spinner w-6 h-6" />
          </div>
        )}

        {results !== null && !searching && (
          results.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">לא נמצאו יועצים זמינים בטווח שהוגדר</p>
          ) : (
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-slate-600">יועץ</th>
                    {allDates.map(d => (
                      <th key={d} scope="col" className="text-center py-2 px-3 font-semibold text-slate-600">{formatDateHe(d)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(a => (
                    <tr key={a.advisor_id} className="border-b border-slate-300 align-top">
                      <td className="py-2 px-3 font-medium text-slate-800 whitespace-nowrap">{a.full_name}</td>
                      {allDates.map(d => {
                        const day = a.days.find(x => x.date === d);
                        return (
                          <td key={d} className="py-2 px-3">
                            {day && (
                              <div className="flex flex-col gap-1">
                                {day.slots.map(s => (
                                  <button key={s.start_time} type="button"
                                    onClick={() => setPendingSlot({ advisorId: a.advisor_id, advisorFullName: a.full_name, date: d, startTime: s.start_time, endTime: s.end_time })}
                                    className="text-xs font-medium px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap">
                                    {s.start_time}-{s.end_time}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {pendingSlot && (
        <SchoolPickerModal schools={schools} onConfirm={handleConfirmSchool} onCancel={() => setPendingSlot(null)} />
      )}

      {settingsOpen && (
        <AdvisorFinderSettingsModal users={users} onClose={() => { setSettingsOpen(false); refreshExclusionCount(); }} />
      )}
    </div>
  );
}
