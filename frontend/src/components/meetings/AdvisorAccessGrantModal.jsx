import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatDateDMY } from "../tasks/taskShared";

const DURATION_OPTIONS = [
  { value: "day", label: "יום אחד", days: 1 },
  { value: "week", label: "שבוע", days: 7 },
  { value: "month", label: "חודש", days: 30 },
];

function toIsoStart(dateStr) {
  // dateStr is "YYYY-MM-DD" — access starts at the beginning of that day (UTC-anchored, same
  // as every other date-only field in this app).
  return `${dateStr}T00:00:00.000Z`;
}
function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// mode: {type:"single_date", meetingDate} — school card / admin-meetings / personal-meetings,
//   where a single confirmed meeting date exists at save time; offers day/week/month pills.
// mode: {type:"range", startDate, endDate} — direct coordination / task-driven meetings, where
//   only a scheduling *window* is known (the recipient picks the actual date later via a
//   booking link) — temporary access simply spans that whole window automatically, no picker.
export default function AdvisorAccessGrantModal({ schoolId, advisorId, advisorName, mode, onGranted, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState("day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function grantTemp(startsAtIso, expiresAtIso, source) {
    setBusy(true);
    setError("");
    try {
      await axios.post(`/schools/${schoolId}/advisors/${advisorId}/grant-temp-access`, {
        starts_at: startsAtIso, expires_at: expiresAtIso, source,
      });
      onGranted?.("temporary");
    } catch (err) {
      setError(err?.response?.data?.detail || "הענקת הגישה נכשלה, נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  async function grantPermanent() {
    setBusy(true);
    setError("");
    try {
      await axios.post(`/schools/${schoolId}/advisors`, { advisor_id: advisorId });
      onGranted?.("permanent");
    } catch (err) {
      setError(err?.response?.data?.detail || "הענקת הגישה נכשלה, נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  function confirmSingleDate() {
    const opt = DURATION_OPTIONS.find(o => o.value === selectedDuration);
    grantTemp(toIsoStart(mode.meetingDate), addDaysIso(mode.meetingDate, opt.days), "meeting_date");
  }
  function confirmRange() {
    grantTemp(toIsoStart(mode.startDate), addDaysIso(mode.endDate, 1), "scheduling_window");
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="advisor-access-modal-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
        <div>
          <h2 id="advisor-access-modal-title" className="font-bold text-slate-900">אין גישה לבית הספר</h2>
          <p className="text-sm text-slate-500 mt-1">
            ל{advisorName} אין גישה לבית הספר. כיצד תרצה לפעול?
          </p>
        </div>

        {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {!showDurationPicker ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-600">הענק גישה:</span>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => setShowDurationPicker(true)}
                className="flex-1 btn-blue text-sm px-4 py-2">זמנית</button>
              <button type="button" disabled={busy} onClick={grantPermanent}
                className="flex-1 btn-blue text-sm px-4 py-2">לצמיתות</button>
            </div>
            <button type="button" onClick={onCancel} className="btn-ghost text-sm px-4 py-2 self-start">ביטול</button>
          </div>
        ) : mode.type === "single_date" ? (
          <div className="flex flex-col gap-2">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs font-medium text-slate-600">משך הגישה הזמנית (החל מתאריך הפגישה, {formatDateDMY(mode.meetingDate)})</legend>
              {DURATION_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="temp-access-duration" value={opt.value}
                    checked={selectedDuration === opt.value}
                    onChange={() => setSelectedDuration(opt.value)}
                    className="accent-blue-600" />
                  {opt.label}
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={confirmSingleDate} className="flex-1 btn-blue text-sm px-4 py-2">
                {busy ? "מעניק..." : "אישור"}
              </button>
              <button type="button" onClick={() => setShowDurationPicker(false)} className="btn-ghost text-sm px-4 py-2">חזרה</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-600">
              תוענק גישה זמנית לטווח שנבחר: {formatDateDMY(mode.startDate)}–{formatDateDMY(mode.endDate)} (הטווח שבו נבחר לתאם/לשלוח את הפגישה)
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={confirmRange} className="flex-1 btn-blue text-sm px-4 py-2">
                {busy ? "מעניק..." : "אישור"}
              </button>
              <button type="button" onClick={() => setShowDurationPicker(false)} className="btn-ghost text-sm px-4 py-2">חזרה</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
