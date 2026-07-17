import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { AdvisorCell } from "./AdvisorCell";
import { DatePickerPopover } from "./DatePickerPopover";
import { DayScheduleBlocks } from "./DayScheduleBlocks";
import { MeetingTypeSelect } from "./MeetingTypeSelect";
import { NoParticipantsModal } from "./NoParticipantsModal";
import { ParticipantsSelector } from "./ParticipantsSelector";
import { TimeInput, normalizeTimeValue } from "./TimeInput";
import { MEETING_STATUS_OPTIONS, STATUS_MAP, formatMeetingDate } from "./constants";
import { computeFreeWindows, computeSegments, fetchDayBusy, findNextEvent, toMinutes } from "./dayScheduleUtils";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const TODAY = new Date().toISOString().slice(0, 10);

// Does [startHM, endHM) overlap any of the advisor's existing Outlook busy ranges?
// A conflict only counts if the draft time genuinely lands *inside* a busy range —
// merely touching its boundary (e.g. starting exactly when another meeting ends) is fine.
// Returns which boundary caused it (so only the relevant field gets highlighted), plus
// the first conflicting range itself (for the confirmation-dialog message).
function computeTimeConflict(startHM, endHM, busyRanges) {
  const s = toMinutes(startHM), e = toMinutes(endHM);
  if (s === null || e === null || s >= e || !busyRanges?.length) {
    return { startConflict: false, endConflict: false, conflictingRange: null };
  }
  let startConflict = false, endConflict = false, conflictingRange = null;
  for (const b of busyRanges) {
    const bs = toMinutes(b.startHM), be = toMinutes(b.endHM);
    if (bs === null || be === null) continue;
    if (!(s < be && bs < e)) continue; // no overlap at all
    let thisStart = false, thisEnd = false;
    if (s >= bs && s < be) thisStart = true;
    if (e > bs && e <= be) thisEnd = true;
    if (!thisStart && !thisEnd) { thisStart = true; thisEnd = true; } // draft fully engulfs this busy range
    startConflict = startConflict || thisStart;
    endConflict = endConflict || thisEnd;
    if (!conflictingRange) conflictingRange = b;
  }
  return { startConflict, endConflict, conflictingRange };
}

function ConflictModal({ advisorName, existingEvent, newEvent, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="conflict-modal-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl">
        <h2 id="conflict-modal-title" className="text-lg font-bold text-red-700 mb-3">⚠ התנגשות מופעים בלוז!</h2>
        <p className="text-sm text-slate-700 mb-4">שים לב: {advisorName} כבר עסוק בזמן שנבחר.</p>
        <div className="text-sm text-slate-800 flex flex-col gap-2 mb-5">
          <div><span className="font-semibold">המופע שקיים:</span> <span dir="ltr">{existingEvent.startHM}–{existingEvent.endHM}</span> - {existingEvent.subject || "(ללא כותרת)"}</div>
          <div><span className="font-semibold">המופע החדש שהזנת:</span> <span dir="ltr">{newEvent.startHM}–{newEvent.endHM}</span> - {newEvent.subject}</div>
        </div>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm transition-colors">סגור</button>
      </div>
    </div>
  );
}

// Asks which participant to use as "who to call" in the Outlook event subject, when
// there are multiple participants and none of them is the principal (so it's ambiguous).
function ChooseContactModal({ options, onChoose, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="contact-modal-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl">
        <h2 id="contact-modal-title" className="text-base font-bold text-slate-900 mb-1">למי מהמשתתפים צריך להתקשר?</h2>
        <p className="text-sm text-slate-500 mb-4">השם והטלפון שייבחרו יופיעו בכותרת הפגישה ביומן ה-Outlook.</p>
        <div className="flex flex-col gap-2">
          {options.map(p => (
            <button key={p.key} type="button" onClick={() => onChoose(p.key)}
              className="w-full text-right px-3 py-2 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-sm text-slate-700">
              {p.name} <span className="text-slate-400 text-xs">({p.label})</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Small fixed-position schedule tooltip shared by the date cell and the time-input hovers.
function ScheduleTooltip({ children }) {
  return (
    <div role="tooltip"
      className="absolute z-40 bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-[11px]"
      style={{ top: "calc(100% + 4px)", right: 0, width: 260 }}>
      {children}
    </div>
  );
}

function isMeetingEligibleForStatusReminder(meeting) {
  if (meeting.status !== "scheduled") return false;
  if (!meeting.meeting_date || meeting.meeting_date > TODAY) return false;
  if (!meeting.end_time) return false;
  const endTime = new Date(`${meeting.meeting_date}T${meeting.end_time}:00`);
  return endTime <= new Date();
}

function CalendarSyncBadge({ calendarSync }) {
  const entries = calendarSync ? Object.values(calendarSync) : [];
  if (entries.length === 0) return null;
  const hasError = entries.some(e => e.status === "error");
  const allSynced = entries.every(e => e.status === "synced");
  if (hasError) {
    return (
      <span
        title="סנכרון ליומן Outlook נכשל עבור אחד או יותר מהיועצים"
        className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full border bg-red-50 border-red-300 text-red-700 mr-1">
        ⚠ יומן
      </span>
    );
  }
  if (allSynced) {
    return (
      <span
        title="הפגישה סונכרנה ליומן ה-Outlook של היועצים"
        className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full border bg-blue-50 border-blue-300 text-blue-700 mr-1">
        📅 יומן ✓
      </span>
    );
  }
  return null;
}

export function MeetingRow({
  meeting, onSave, onRequestDelete, onOpenNotes, usersWithAccess, usersWithoutAccess,
  contacts, onRequestAccess, onReminderOn,
  showSchoolColumn, schoolLabel, onOpenSchoolPicker,
  selectable, selected, onToggleSelect, onSendStatusReminder, hideAdvisorColumn,
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({ ...meeting });
  const [showDate, setShowDate] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showReminderTip, setShowReminderTip] = useState(false);
  const [reminderStatus, setReminderStatus] = useState(null);
  const [showNoParticipantsModal, setShowNoParticipantsModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [advisorBusy, setAdvisorBusy] = useState([]);
  const [conflictModal, setConflictModal] = useState(null);
  const [contactPickerOptions, setContactPickerOptions] = useState(null);
  const [dateHovered, setDateHovered] = useState(false);
  const [startHovered, setStartHovered] = useState(false);
  const [endHovered, setEndHovered] = useState(false);
  const rowRef = useRef(null);
  const actionsMenuRef = useRef(null);
  // Track what was last sent so blur doesn't double-save after an immediate save
  const lastSentRef = useRef(null);

  useEffect(() => { setDraft({ ...meeting }); lastSentRef.current = null; }, [meeting.id]);

  // Fetch the advisor's Outlook busy ranges for this specific meeting date — used both
  // to warn/block saving on a real overlap, and to power the schedule hover tooltips.
  const advisorIdForBusyCheck = draft.advisor_ids?.[0];
  useEffect(() => {
    if (!advisorIdForBusyCheck || !draft.meeting_date) { setAdvisorBusy([]); return; }
    let cancelled = false;
    const ownEventId = meeting.calendar_sync?.[advisorIdForBusyCheck]?.external_event_id;
    fetchDayBusy(advisorIdForBusyCheck, draft.meeting_date, ownEventId).then(ranges => {
      if (!cancelled) setAdvisorBusy(ranges);
    });
    return () => { cancelled = true; };
  }, [advisorIdForBusyCheck, draft.meeting_date, meeting.calendar_sync]);

  // Two sources for the red-border warning: the backend persists whether the *saved*
  // time genuinely conflicts (in calendar_sync.conflict) — available instantly on load,
  // no waiting on a live fetch. Once the draft is edited away from the saved values, the
  // live check (against advisorBusy) takes over for real-time feedback while typing.
  const draftMatchesSaved = draft.start_time === meeting.start_time && draft.end_time === meeting.end_time && draft.meeting_date === meeting.meeting_date;
  const persistedConflict = draftMatchesSaved && !!advisorIdForBusyCheck && !!meeting.calendar_sync?.[advisorIdForBusyCheck]?.conflict;
  const liveConflict = computeTimeConflict(draft.start_time, draft.end_time, advisorBusy);
  const startConflict = liveConflict.startConflict || persistedConflict;
  const endConflict = liveConflict.endConflict || persistedConflict;
  const advisorName = draft.advisor_profiles?.[0]?.full_name || "היועץ";

  // The real Outlook subject depends on school/city/contact-phone data this component
  // doesn't otherwise have — ask the backend so the conflict dialog shows the exact
  // text that would actually be sent, not a guess.
  async function resolveMeetingSubject(draftToSave) {
    try {
      const res = await axios.post(`/schools/${draftToSave.school_id}/meeting-subject-preview`, {
        participants: draftToSave.participants || [],
        primary_contact_key: draftToSave.primary_contact_key || null,
      });
      return res.data?.subject || "פגישת ליווי כלכלי";
    } catch {
      return "פגישת ליווי כלכלי";
    }
  }

  useEffect(() => {
    if (!meeting.reminder_enabled) { setReminderStatus(null); return; }
    let cancelled = false;
    axios.get(`/schools/meetings/${meeting.id}/reminder-status`)
      .then(res => { if (!cancelled) setReminderStatus(res.data?.reminders || []); })
      .catch(() => { if (!cancelled) setReminderStatus(null); });
    return () => { cancelled = true; };
  }, [meeting.id, meeting.reminder_enabled]);

  useEffect(() => {
    function h(e) { if (!actionsMenuRef.current?.contains(e.target)) setShowActionsMenu(false); }
    if (showActionsMenu) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showActionsMenu]);

  function set(field, val) {
    setDraft(p => ({ ...p, [field]: val }));
  }

  async function saveDraft(draftToSave) {
    const advisorId = draftToSave.advisor_ids?.[0];
    // Re-fetch fresh busy ranges right before checking — the reactive `advisorBusy`
    // state is populated asynchronously and can lag behind rapid edits (e.g. setting
    // date → start → end back-to-back), which would otherwise show a stale (non-red)
    // warning state for a moment. A live check right before saving avoids that.
    let liveBusy = advisorBusy;
    if (advisorId && draftToSave.meeting_date && draftToSave.start_time && draftToSave.end_time) {
      const ownEventId = meeting.calendar_sync?.[advisorId]?.external_event_id;
      liveBusy = await fetchDayBusy(advisorId, draftToSave.meeting_date, ownEventId);
      setAdvisorBusy(liveBusy);
    }
    const conflict = computeTimeConflict(draftToSave.start_time, draftToSave.end_time, liveBusy);
    if (conflict.startConflict || conflict.endConflict) {
      // Warn, but still let the save go through — the advisor may genuinely need two
      // overlapping commitments (e.g. a "day off" alongside a meeting); we just make
      // sure the double-booking is visible and impossible to save by accident.
      const subject = await resolveMeetingSubject(draftToSave);
      setConflictModal({
        advisorName,
        existingEvent: conflict.conflictingRange,
        newEvent: { startHM: draftToSave.start_time, endHM: draftToSave.end_time, subject },
      });
    }
    lastSentRef.current = JSON.stringify(draftToSave);
    onSave(draftToSave);
  }

  function handleRowBlur(e) {
    if (rowRef.current?.contains(e.relatedTarget)) return;
    if (showDate || showStatus) return;
    // Re-normalize start/end time here (not just in TimeInput's own onBlur) — this blur
    // event bubbles up from the time input in the same tick, before React re-renders with
    // the input's own normalized value, so `draft` here can still hold the raw unpadded
    // digits (e.g. "12" instead of "12:00") without this.
    const normalized = {
      ...draft,
      start_time: normalizeTimeValue(draft.start_time),
      end_time: normalizeTimeValue(draft.end_time),
    };
    const curr = JSON.stringify(normalized);
    const baseline = lastSentRef.current ?? JSON.stringify(meeting);
    if (baseline !== curr) {
      setDraft(normalized);
      saveDraft(normalized);
    }
  }

  const status = STATUS_MAP[draft.status] || STATUS_MAP.other;

  return (
    <>
      {showNoParticipantsModal && <NoParticipantsModal onClose={() => setShowNoParticipantsModal(false)} />}
      {conflictModal && (
        <ConflictModal
          advisorName={conflictModal.advisorName}
          existingEvent={conflictModal.existingEvent}
          newEvent={conflictModal.newEvent}
          onClose={() => setConflictModal(null)}
        />
      )}
      {contactPickerOptions && (
        <ChooseContactModal
          options={contactPickerOptions}
          onChoose={key => {
            const nd = { ...draft, primary_contact_key: key };
            setDraft(nd);
            setContactPickerOptions(null);
            saveDraft(nd);
          }}
          onClose={() => { setContactPickerOptions(null); saveDraft(draft); }}
        />
      )}
      <tr ref={rowRef} onBlur={handleRowBlur}
        className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors group">
        {selectable && (
          <td className="py-2.5 px-2 text-center">
            <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect?.(meeting.id)}
              aria-label="בחר פגישה" className="w-3.5 h-3.5 rounded accent-blue-600" />
          </td>
        )}
        {/* תאריך */}
        <td className="py-2.5 px-2">
          <div className="relative">
            <button type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowDate(o => !o)}
              onMouseEnter={() => setDateHovered(true)}
              onMouseLeave={() => setDateHovered(false)}
              className="text-sm text-right w-full hover:text-blue-600 transition-colors cursor-pointer font-medium text-slate-700 whitespace-nowrap">
              {draft.meeting_date ? formatMeetingDate(draft.meeting_date) : <span className="text-slate-300 font-normal">—</span>}
            </button>
            {showDate && <DatePickerPopover value={draft.meeting_date}
              advisorId={draft.advisor_ids?.[0]}
              onChange={v => { const nd = { ...draft, meeting_date: v }; setDraft(nd); setShowDate(false); saveDraft(nd); }}
              onClose={() => setShowDate(false)} />}
            {!showDate && dateHovered && advisorIdForBusyCheck && draft.meeting_date && (
              <ScheduleTooltip>
                <DayScheduleBlocks segments={computeSegments(advisorBusy)} />
              </ScheduleTooltip>
            )}
          </div>
        </td>
        {/* סטטוס */}
        <td className="py-2.5 px-2">
          <div className="relative">
            <button type="button" onClick={() => setShowStatus(o => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full cursor-pointer hover:opacity-80 whitespace-nowrap transition-opacity"
              style={{ background: status.bg, color: status.color }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: status.dot }} aria-hidden="true" />
              {status.label}
            </button>
            {showStatus && (
              <div className="absolute z-30 mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[110px]" role="listbox">
                {MEETING_STATUS_OPTIONS.map(o => {
                  const s = STATUS_MAP[o.value];
                  return (
                    <button key={o.value} type="button" role="option"
                      onMouseDown={e => { e.preventDefault(); const nd = { ...draft, status: o.value }; setDraft(nd); setShowStatus(false); saveDraft(nd); }}
                      className="w-full text-right px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} aria-hidden="true" />
                      <span style={{ color: s.color }} className="font-medium">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </td>
        {/* שם מוסד (admin tab only) */}
        {showSchoolColumn && (
          <td className="py-2.5 px-2">
            {meeting.school_id ? (
              <button type="button"
                onClick={() => navigate(`/school/${meeting.school_id}`)}
                className="w-full text-right text-sm px-1.5 py-0.5 rounded hover:bg-blue-50 hover:text-blue-700 transition-all cursor-pointer text-slate-700 whitespace-nowrap">
                {schoolLabel || <span className="text-slate-400 text-lg font-light leading-none">+</span>}
              </button>
            ) : (
              <button type="button"
                onMouseDown={e => { e.preventDefault(); onOpenSchoolPicker?.(meeting.id); }}
                className="w-full text-right text-sm px-1.5 py-0.5 rounded hover:ring-1 hover:ring-slate-300 transition-all cursor-pointer text-slate-400">
                <span className="text-lg font-light leading-none">+</span>
              </button>
            )}
          </td>
        )}
        {/* שעת התחלה */}
        <td className="py-2.5 pr-2 pl-3 relative"
          onMouseEnter={() => setStartHovered(true)} onMouseLeave={() => setStartHovered(false)}>
          <TimeInput id={`start-${meeting.id}`} value={draft.start_time || ""}
            onChange={v => set("start_time", v)}
            ariaLabel="שעת התחלה" hasError={startConflict}
            errorMessage="היועץ כבר תפוס בזמן הזה ביומן ה-Outlook" />
          {startHovered && advisorIdForBusyCheck && draft.meeting_date && (
            <ScheduleTooltip>
              <span className="text-black block mb-1">היועץ פנוי ב:</span>
              {computeFreeWindows(advisorBusy).length === 0 ? (
                <span className="text-slate-400">אין נתוני זמינות</span>
              ) : (
                <div className="flex flex-col gap-1">
                  {computeFreeWindows(advisorBusy).map((w, i) => (
                    <span key={i} dir="ltr" className="text-black font-medium">{w.startHM}–{w.endHM}</span>
                  ))}
                </div>
              )}
            </ScheduleTooltip>
          )}
        </td>
        {/* שעת סיום */}
        <td className="py-2.5 px-1 relative"
          onMouseEnter={() => setEndHovered(true)} onMouseLeave={() => setEndHovered(false)}>
          <TimeInput id={`end-${meeting.id}`} value={draft.end_time || ""}
            onChange={v => set("end_time", v)}
            ariaLabel="שעת סיום" hasError={endConflict}
            errorMessage="היועץ כבר תפוס בזמן הזה ביומן ה-Outlook" />
          {endHovered && advisorIdForBusyCheck && draft.meeting_date && draft.start_time && (() => {
            const next = findNextEvent(draft.start_time, advisorBusy);
            return (
              <ScheduleTooltip>
                {next ? (
                  <span className="text-black">
                    פנוי עד <span dir="ltr" className="font-medium">{next.startHM}</span>.
                    {" "}לאחר מכן <span dir="ltr" className="font-medium">{next.startHM}–{next.endHM}</span> - {next.subject || "(ללא כותרת)"}
                  </span>
                ) : (
                  <span className="text-black">פנוי עד סוף היום — אין פגישות נוספות</span>
                )}
              </ScheduleTooltip>
            );
          })()}
        </td>
        {/* יועץ מבצע */}
        {!hideAdvisorColumn && (
          <td className="py-2.5 px-2">
            <AdvisorCell
              value={draft.advisor_profiles || []}
              usersWithAccess={usersWithAccess}
              usersWithoutAccess={usersWithoutAccess}
              onChange={profiles => { const nd = { ...draft, advisor_ids: profiles.map(x => x.id), advisor_profiles: profiles }; setDraft(nd); saveDraft(nd); }}
              onRequestAccess={onRequestAccess}
            />
          </td>
        )}
        {/* משתתפים */}
        <td className="py-2.5 px-2">
          <ParticipantsSelector contacts={contacts} selected={draft.participants || []}
            onChange={v => {
              const reminderOff = v.length === 0 && draft.reminder_enabled;
              // Who to call for the Outlook event subject: the principal always wins if
              // present; a single participant is unambiguous; otherwise ask the user.
              const hasPrincipal = v.some(p => p.key === "principal");
              const primaryContactKey = hasPrincipal ? "principal" : v.length === 1 ? v[0].key : null;
              const nd = { ...draft, participants: v, primary_contact_key: primaryContactKey, ...(reminderOff ? { reminder_enabled: false } : {}) };
              setDraft(nd);
              if (v.length > 1 && !hasPrincipal) {
                setContactPickerOptions(v); // defer save until the user picks who to call
              } else {
                saveDraft(nd);
              }
            }} />
        </td>
        {/* סוג */}
        <td className="py-2.5 px-2">
          <MeetingTypeSelect value={draft.meeting_type || ""} onChange={v => { const nd = { ...draft, meeting_type: v }; setDraft(nd); saveDraft(nd); }} />
        </td>
        {/* הערות */}
        <td className="py-2.5 px-2 text-center">
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onOpenNotes(meeting.id, draft.notes || "", val => { const nd = { ...draft, notes: val }; setDraft(nd); saveDraft(nd); }); }}
            className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none" aria-label="פתח הערות">
            {draft.notes ? "📝" : <span className="text-slate-400 text-lg font-light">+</span>}
          </button>
        </td>
        {/* תזכורת */}
        <td className="py-2.5 px-2 text-center">
          <div className="relative inline-block">
            <button type="button" onClick={() => {
              const newVal = !draft.reminder_enabled;
              if (newVal && (!draft.participants || draft.participants.length === 0)) {
                setShowNoParticipantsModal(true);
                return;
              }
              set("reminder_enabled", newVal);
              if (newVal) onReminderOn?.();
            }}
              onMouseEnter={() => setShowReminderTip(true)}
              onMouseLeave={() => setShowReminderTip(false)}
              aria-label="תזכורת למשתתפים" aria-pressed={draft.reminder_enabled}
              className={`text-xs font-semibold px-2 py-0.5 rounded-full border transition-colors ${draft.reminder_enabled ? "bg-green-100 border-green-400 text-green-700" : "bg-slate-100 border-slate-300 text-slate-400"}`}>
              {draft.reminder_enabled ? "ON" : "OFF"}
            </button>
            {showReminderTip && !draft.reminder_enabled && (
              <div role="tooltip"
                className="absolute z-40 text-sm text-slate-800 leading-relaxed p-3 rounded-lg shadow-md pointer-events-none"
                style={{ background: "#FEF08A", border: "1px solid #EAB308", top: "calc(100% + 4px)", left: 0, width: 265, whiteSpace: "normal" }}>
                בהפעלת הכפתור תישלח למשתתפים תזכורת יום לפני קיום הפגישה.
              </div>
            )}
            {draft.reminder_enabled && reminderStatus && reminderStatus.length > 0 && (
              <div className="relative inline-block mr-1" onMouseEnter={() => setShowReminderTip("sent")} onMouseLeave={() => setShowReminderTip(false)}>
                <span
                  className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${
                    reminderStatus.every(r => r.status === "sent")
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "bg-amber-50 border-amber-300 text-amber-700"
                  }`}>
                  נשלח ל-{reminderStatus.filter(r => r.status === "sent").length}/{reminderStatus.length}
                </span>
                {showReminderTip === "sent" && (
                  <div role="tooltip"
                    className="absolute z-40 text-xs text-slate-800 leading-relaxed p-2 rounded-lg shadow-md pointer-events-none text-right"
                    style={{ background: "white", border: "1px solid #cbd5e1", top: "calc(100% + 4px)", left: 0, width: 200, whiteSpace: "normal" }}>
                    {reminderStatus.map((r, i) => (
                      <div key={i} className={r.status === "sent" ? "text-blue-700" : "text-red-600"}>
                        {r.recipient_name || r.recipient_email}: {r.status === "sent" ? "נשלח" : "נכשל"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <CalendarSyncBadge calendarSync={meeting.calendar_sync} />
          </div>
        </td>
        {/* Actions */}
        {(onRequestDelete || onSendStatusReminder) && (
          <td className="py-2.5 px-2 text-center">
            <div className="relative inline-block" ref={actionsMenuRef}>
              <button type="button" onClick={() => setShowActionsMenu(o => !o)} aria-label="פעולות"
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition-all flex items-center justify-center w-6 h-6 rounded hover:bg-slate-100">
                <svg width="14" height="14" viewBox="0 0 16 4" fill="currentColor" aria-hidden="true">
                  <circle cx="2" cy="2" r="1.5"/>
                  <circle cx="8" cy="2" r="1.5"/>
                  <circle cx="14" cy="2" r="1.5"/>
                </svg>
              </button>
              {showActionsMenu && (
                <div className="absolute left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30 min-w-[200px]">
                  {onSendStatusReminder && isMeetingEligibleForStatusReminder(meeting) && (
                    <button type="button"
                      onMouseDown={e => { e.preventDefault(); onSendStatusReminder(meeting); setShowActionsMenu(false); }}
                      className="w-full text-right px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 transition-colors whitespace-nowrap">
                      שלח תזכורת לעדכון סטטוס
                    </button>
                  )}
                  {onRequestDelete && (
                    <button type="button"
                      onMouseDown={e => { e.preventDefault(); onRequestDelete(meeting.id); setShowActionsMenu(false); }}
                      className="w-full text-right px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors whitespace-nowrap">
                      מחק
                    </button>
                  )}
                </div>
              )}
            </div>
          </td>
        )}
      </tr>
    </>
  );
}
