import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { MultiSelectChips } from "../MultiSelectChips";
import { DOMAIN_OPTIONS } from "../../constants/domains";
import { SchoolPickerModal } from "./SchoolPickerCell";
import AdvisorFinderSettingsModal from "./AdvisorFinderSettingsModal";

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

export function AdvisorFinderModal({ onClose, schools, users, onBook }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [domains, setDomains] = useState([]);
  const [duration, setDuration] = useState(60);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [pendingSlot, setPendingSlot] = useState(null); // { advisorId, date, startTime, endTime }
  const [booking, setBooking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const allDates = results ? [...new Set(results.flatMap(a => a.days.map(d => d.date)))].sort() : [];

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
    setError("");
    setSearching(true);
    setResults(null);
    try {
      const res = await axios.post("/schools/advisor-finder/search", {
        control_domains: domains,
        duration_minutes: duration,
        date_from: dateFrom,
        date_to: dateTo,
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
        <div className="flex items-center justify-between">
          <h2 id="advisor-finder-title" className="font-bold text-slate-900 text-lg">איתור יועץ</h2>
          <button type="button" onClick={() => setSettingsOpen(true)}
            className="btn-ghost flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl font-medium">
            <span aria-hidden="true">⚙</span> החרג יועצים
          </button>
        </div>

        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500">תחומי ידע</span>
            <MultiSelectChips options={DOMAIN_OPTIONS} selected={domains} onChange={setDomains} placeholder="בחר תחומי ידע" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="af-duration" className="text-xs font-semibold text-slate-500">משך זמן נחוץ</label>
            <select id="af-duration" value={duration} onChange={e => setDuration(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white">
              {DURATION_OPTIONS.map(m => <option key={m} value={m}>{formatDuration(m)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500">טווח תאריכים</span>
            <div className="flex items-center gap-2">
              <label htmlFor="af-from" className="sr-only">מתאריך</label>
              <input id="af-from" type="text" inputMode="numeric" placeholder="מתאריך DD/MM/YY" maxLength={8}
                value={fromText} onChange={e => setFromText(maskDateInput(e.target.value))}
                className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white" />
              <label htmlFor="af-to" className="sr-only">עד תאריך</label>
              <input id="af-to" type="text" inputMode="numeric" placeholder="עד תאריך DD/MM/YY" maxLength={8}
                value={toText} onChange={e => setToText(maskDateInput(e.target.value))}
                className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white" />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={handleSearch} disabled={searching}
            className="btn-blue text-sm px-5 py-2 disabled:opacity-50">
            {searching ? "מאתר..." : "איתור"}
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
                      <th key={d} scope="col" className="text-right py-2 px-3 font-semibold text-slate-600">{formatDateHe(d)}</th>
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

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">סגירה</button>
        </div>
      </div>

      {pendingSlot && (
        <SchoolPickerModal schools={schools} onConfirm={handleConfirmSchool} onCancel={() => setPendingSlot(null)} />
      )}

      {settingsOpen && (
        <AdvisorFinderSettingsModal users={users} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
