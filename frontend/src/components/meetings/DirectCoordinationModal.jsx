import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { buildSchoolContacts, resolveMeetingCoordinator } from "./schoolContacts";
import { DirectCoordinationResolutionModal } from "./DirectCoordinationResolutionModal";
import AdvisorAccessGrantModal from "./AdvisorAccessGrantModal";

const SERVICE_TYPE_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "current", label: "שוטף" },
  { value: "district", label: "מחוז" },
];

const DURATION_OPTIONS = Array.from({ length: (180 - 30) / 15 + 1 }, (_, i) => 30 + i * 15);

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} דק'`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} שעות` : `${Math.floor(hours)}:${String(minutes % 60).padStart(2, "0")} שעות`;
}

// Displayed/typed as DD/MM/YY (2-digit year, e.g. "26" -> 2026) — auto-inserts the slashes as
// the user types digits, so there's no native <input type="date"> locale-dependent format.
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

let rangeIdCounter = 0;
function newRange() {
  rangeIdCounter += 1;
  return {
    localId: rangeIdCounter,
    serviceType: "",
    startDateText: "",
    endDateText: "",
    duration: 60,
    participantKeys: [],
  };
}

export function DirectCoordinationModal({ school: initialSchool, advisors, onClose, onSent }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [school, setSchool] = useState(initialSchool);
  const [advisorIds, setAdvisorIds] = useState([]);
  const [ranges, setRanges] = useState([newRange()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sentInfo, setSentInfo] = useState(null); // { bookingUrl }
  const [showResolution, setShowResolution] = useState(false);
  const [advisorAccessModal, setAdvisorAccessModal] = useState(null); // {advisorId, advisorName, startDate, endDate}

  const contacts = buildSchoolContacts(school);

  useEffect(() => {
    let cancelled = false;
    axios.get(`/schools/${school.id}/advisors`)
      .then(res => {
        if (cancelled) return;
        const first = (res.data || [])[0];
        if (first) setAdvisorIds([first.id]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [school.id]);

  function toggleAdvisor(id) {
    setAdvisorIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function updateRange(localId, patch) {
    setRanges(prev => prev.map(r => r.localId === localId ? { ...r, ...patch } : r));
  }

  function toggleParticipant(localId, key) {
    setRanges(prev => prev.map(r => {
      if (r.localId !== localId) return r;
      const has = r.participantKeys.includes(key);
      return { ...r, participantKeys: has ? r.participantKeys.filter(k => k !== key) : [...r.participantKeys, key] };
    }));
  }

  function removeRange(localId) {
    setRanges(prev => prev.length > 1 ? prev.filter(r => r.localId !== localId) : prev);
  }

  function validate() {
    if (advisorIds.length === 0) return "יש לבחור לפחות יועץ אחד";
    for (const r of ranges) {
      if (!r.serviceType) return "יש לבחור סוג פגישה (גפן/שוטף/מחוז) לכל טווח";
      const startISO = parseDateDDMMYY(r.startDateText);
      const endISO = parseDateDDMMYY(r.endDateText);
      if (!startISO || !endISO) return "יש למלא תאריך תקין בפורמט DD/MM/YY לכל פגישה";
      if (startISO > endISO) return "תאריך ההתחלה מאוחר מתאריך הסיום באחד הטווחים";
      if (r.participantKeys.length === 0) return "יש לבחור לפחות משתתף אחד לכל פגישה";
    }
    return "";
  }

  function participantRoleKeysNeeded() {
    const keys = new Set();
    for (const r of ranges) for (const k of r.participantKeys) keys.add(k);
    return [...keys];
  }

  function hasProblems() {
    const coordinator = resolveMeetingCoordinator(school);
    if (!coordinator || !coordinator.email) return true;
    const contactsByKey = Object.fromEntries(contacts.map(c => [c.key, c]));
    return participantRoleKeysNeeded().some(k => !contactsByKey[k]?.email);
  }

  function schedulingWindow() {
    const starts = ranges.map(r => parseDateDDMMYY(r.startDateText)).filter(Boolean);
    const ends = ranges.map(r => parseDateDDMMYY(r.endDateText)).filter(Boolean);
    return { startDate: starts.sort()[0], endDate: ends.sort().slice(-1)[0] };
  }

  async function checkAdvisorAccess() {
    if (advisorIds.length === 0) return true;
    try {
      const res = await axios.get(`/schools/${school.id}/advisor-access`, { params: { advisor_ids: advisorIds.join(",") } });
      const missingId = advisorIds.find(id => res.data?.[id] === false);
      if (missingId) {
        const advisor = advisors.find(a => a.id === missingId);
        const { startDate, endDate } = schedulingWindow();
        setAdvisorAccessModal({ advisorId: missingId, advisorName: advisor?.full_name || advisor?.email || "", startDate, endDate });
        return false;
      }
      return true;
    } catch {
      return true; // non-fatal — the check itself failing shouldn't block sending
    }
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError("");
    if (!(await checkAdvisorAccess())) return;
    if (hasProblems()) { setShowResolution(true); return; }
    await doSend();
  }

  async function doSend() {
    setSubmitting(true);
    try {
      const body = {
        advisor_ids: advisorIds,
        ranges: ranges.map(r => ({
          start_date: parseDateDDMMYY(r.startDateText),
          end_date: parseDateDDMMYY(r.endDateText),
          meeting_service_type: r.serviceType,
          duration_minutes: r.duration,
          participants: r.participantKeys.map(key => {
            const c = contacts.find(c => c.key === key);
            return { key: c.key, name: c.name, email: c.email || null };
          }),
        })),
      };
      const res = await axios.post(`/schools/${school.id}/meetings/direct-coordination`, body);
      setSentInfo({ bookingUrl: res.data.booking_url });
      onSent?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "שליחת הבקשה נכשלה, נסה שוב");
    } finally {
      setSubmitting(false);
    }
  }

  if (advisorAccessModal) {
    return (
      <AdvisorAccessGrantModal
        schoolId={school.id}
        advisorId={advisorAccessModal.advisorId}
        advisorName={advisorAccessModal.advisorName}
        mode={{ type: "range", startDate: advisorAccessModal.startDate, endDate: advisorAccessModal.endDate }}
        onGranted={async () => { setAdvisorAccessModal(null); if (await checkAdvisorAccess()) { if (hasProblems()) setShowResolution(true); else await doSend(); } }}
        onCancel={() => setAdvisorAccessModal(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="direct-coord-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col gap-4">

        <h2 id="direct-coord-title" className="font-bold text-slate-900 text-lg">
          תיאום ישיר — {school.name}
        </h2>

        {sentInfo ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              הבקשה נשלחה למתאם/ת הפגישות בהצלחה.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor="direct-coord-link" className="text-xs font-medium text-slate-500">קישור לגיבוי (למקרה שהמייל לא הגיע)</label>
              <input id="direct-coord-link" type="text" readOnly value={sentInfo.bookingUrl}
                onFocus={e => e.target.select()}
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-600" />
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="btn-blue text-sm px-4 py-1.5">סגירה</button>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold text-slate-700 mb-1">יועצים מבצעים</legend>
              <div className="flex flex-wrap gap-2">
                {advisors.map(a => (
                  <label key={a.id} className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={advisorIds.includes(a.id)} onChange={() => toggleAdvisor(a.id)}
                      className="w-3.5 h-3.5 rounded accent-blue-600" />
                    <span>{a.full_name || a.email}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                אם נבחרו כמה יועצים, יוצגו למתאם/ת רק זמנים שבהם כולם פנויים.
              </p>
            </fieldset>

            <div className="flex flex-col gap-4">
              {ranges.map((r, idx) => (
                <div key={r.localId} className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3 bg-white/60">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">פגישה {idx + 1}</span>
                    {ranges.length > 1 && (
                      <button type="button" onClick={() => removeRange(r.localId)} aria-label={`הסרת פגישה ${idx + 1}`}
                        className="text-slate-400 hover:text-red-500 text-sm">✕</button>
                    )}
                  </div>

                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="text-xs font-medium text-slate-500">סוג פגישה</legend>
                    <div className="flex gap-2">
                      {SERVICE_TYPE_OPTIONS.map(opt => (
                        <button key={opt.value} type="button"
                          aria-pressed={r.serviceType === opt.value}
                          onClick={() => updateRange(r.localId, { serviceType: opt.value })}
                          className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                            r.serviceType === opt.value
                              ? "bg-blue-600 border-blue-600 text-white font-semibold"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`dc-start-${r.localId}`} className="text-xs font-medium text-slate-500">מתאריך</label>
                      <input id={`dc-start-${r.localId}`} type="text" inputMode="numeric" placeholder="DD/MM/YY" maxLength={8}
                        value={r.startDateText}
                        onChange={e => updateRange(r.localId, { startDateText: maskDateInput(e.target.value) })}
                        className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`dc-end-${r.localId}`} className="text-xs font-medium text-slate-500">עד תאריך</label>
                      <input id={`dc-end-${r.localId}`} type="text" inputMode="numeric" placeholder="DD/MM/YY" maxLength={8}
                        value={r.endDateText}
                        onChange={e => updateRange(r.localId, { endDateText: maskDateInput(e.target.value) })}
                        className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor={`dc-duration-${r.localId}`} className="text-xs font-medium text-slate-500">משך הפגישה</label>
                    <select id={`dc-duration-${r.localId}`} value={r.duration}
                      onChange={e => updateRange(r.localId, { duration: Number(e.target.value) })}
                      className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 w-40">
                      {DURATION_OPTIONS.map(d => <option key={d} value={d}>{formatDuration(d)}</option>)}
                    </select>
                  </div>

                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="text-xs font-medium text-slate-500">משתתפים מצד בית הספר</legend>
                    {contacts.length === 0 ? (
                      <p className="text-xs text-slate-400">לא הוגדרו אנשי קשר לבית הספר</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {contacts.map(c => (
                          <label key={c.key} className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-slate-50">
                            <input type="checkbox" checked={r.participantKeys.includes(c.key)}
                              onChange={() => toggleParticipant(r.localId, c.key)}
                              className="w-3.5 h-3.5 rounded accent-blue-600" />
                            <span>{c.name} ({c.label})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setRanges(prev => [...prev, newRange()])}
              className="text-sm text-blue-600 hover:underline self-start">
              + הוספת פגישה נוספת (טווח תאריכים נוסף)
            </button>

            {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

            <div className="flex items-center gap-2 justify-end mt-1">
              <button type="button" onClick={onClose} disabled={submitting} className="btn-ghost text-sm px-4 py-1.5 disabled:opacity-40">ביטול</button>
              <button type="button" onClick={handleSubmit} disabled={submitting}
                className="btn-blue text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                {submitting ? "שולח..." : "שליחת בקשה"}
              </button>
            </div>
          </>
        )}
      </div>

      {showResolution && (
        <DirectCoordinationResolutionModal
          school={school}
          participantRoleKeysNeeded={participantRoleKeysNeeded()}
          onSchoolUpdate={patch => setSchool(prev => ({ ...prev, ...patch }))}
          onClose={() => setShowResolution(false)}
          onProceed={async () => { setShowResolution(false); await doSend(); }}
        />
      )}
    </div>
  );
}
