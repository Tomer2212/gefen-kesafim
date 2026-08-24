import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { AdvisorCell } from "./AdvisorCell";
import { DatePickerPopover } from "./DatePickerPopover";
import { DayScheduleBlocks } from "./DayScheduleBlocks";
import { MeetingTypeSelect } from "./MeetingTypeSelect";
import { MeetingServiceTypeSelect } from "./MeetingServiceTypeSelect";
import { NoParticipantsModal } from "./NoParticipantsModal";
import { ParticipantsSelector } from "./ParticipantsSelector";
import { TimeInput, normalizeTimeValue } from "./TimeInput";
import { AdvisorReassignModal } from "./AdvisorReassignModal";
import { MeetingActualDetail } from "./MeetingActualDetail";
import { MEETING_STATUS_OPTIONS, MEETING_SERVICE_TYPE_OPTIONS, STATUS_MAP, formatMeetingDate } from "./constants";

function formatActualDuration(seconds) {
  if (!seconds) return "0:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sumOfflineSeconds(entries) {
  let total = 0;
  for (const e of (entries || [])) {
    if (!e.start_time || !e.end_time) continue;
    const [sh, sm] = e.start_time.split(":").map(Number);
    const [eh, em] = e.end_time.split(":").map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff > 0) total += diff * 60;
  }
  return total;
}

// Resolves the deduplicated list of advisor profiles that "belong" to a given meeting service
// type, from the school's three per-service-type advisor lists (gefen_current = union of both).
function typedAdvisorsForServiceType(serviceType, typedAdvisors) {
  if (!typedAdvisors) return [];
  let list;
  if (serviceType === "gefen") list = typedAdvisors.gefen || [];
  else if (serviceType === "current") list = typedAdvisors.current || [];
  else if (serviceType === "district") list = typedAdvisors.district || [];
  else if (serviceType === "gefen_current") list = [...(typedAdvisors.gefen || []), ...(typedAdvisors.current || [])];
  else list = [];
  const seen = new Set();
  return list.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}
import { computeFreeWindows, computeSegments, fetchDayBusy, findNextEvent, invalidateFreebusyCache, toMinutes } from "./dayScheduleUtils";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const TODAY = new Date().toISOString().slice(0, 10);

// Contact keys that represent "the principal" for a school — a six-year school has two
// (חט"ע / חט"ב). Used to decide who automatically wins the Outlook subject-line contact.
const PRINCIPAL_KEYS = ["principal", "principal_chativa"];

const STAGE_SCOPE_PILLS = [
  { value: "tichon",  label: "תיכון" },
  { value: "chativa", label: "חט\"ב" },
  { value: "both",    label: "שניהם" },
];

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

// Small schedule tooltip shared by the date cell and the time-input hovers. Rendered
// via a portal straight into <body> with `position: fixed`, computed from the anchor
// element's own bounding rect — a plain `position: absolute` child used to get silently
// clipped by any ancestor with `overflow` set (e.g. the table's scroll container), which
// is exactly what made the taller post-resize tooltip look "swallowed" at the bottom.
function ScheduleTooltip({ children, anchorRef }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchorRef?.current) { setPos(null); return; }
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [anchorRef]);

  // A fixed-position tooltip doesn't move with its anchor — scrolling the page (or the
  // table's own scroll container) would otherwise leave it floating next to the wrong
  // row. Simplest correct fix: hide it on any scroll; it reappears on the next hover.
  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!pos]);

  if (!pos) return null;
  return createPortal(
    <div role="tooltip"
      className="fixed z-[9999] bg-white border border-slate-200 rounded-lg shadow-lg p-4 text-[18px]"
      style={{ top: pos.top, right: pos.right, width: "max-content", maxWidth: 640, minWidth: 320 }}>
      {children}
    </div>,
    document.body,
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
        className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full border bg-red-50 border-red-300 text-red-700 whitespace-nowrap inline-block">
        ⚠ יומן
      </span>
    );
  }
  if (allSynced) {
    return (
      <span
        title="הפגישה סונכרנה ליומן ה-Outlook של היועצים"
        className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full border bg-blue-50 border-blue-300 text-blue-700 whitespace-nowrap inline-block">
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
  showCalendarColumn, onOpenSummary, typedAdvisors, schoolStage,
  expanded, onToggleExpand, colSpanTotal,
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
  const [busyLoading, setBusyLoading] = useState(true);
  const [busyFailed, setBusyFailed] = useState(false);
  const [conflictModal, setConflictModal] = useState(null);
  const [advisorReassignPrompt, setAdvisorReassignPrompt] = useState(null);
  const [contactPickerOptions, setContactPickerOptions] = useState(null);
  const [dateHovered, setDateHovered] = useState(false);
  const [startHovered, setStartHovered] = useState(false);
  const [endHovered, setEndHovered] = useState(false);
  const dateCellRef = useRef(null);
  const startCellRef = useRef(null);
  const endCellRef = useRef(null);
  const rowRef = useRef(null);
  const actionsMenuRef = useRef(null);
  // Track what was last sent so blur doesn't double-save after an immediate save
  const lastSentRef = useRef(null);
  // Serializes saveDraft calls for this row so their PUT requests always reach the backend
  // in the order they were triggered. Without this, two saves fired close together (e.g. the
  // "סוג" change followed almost immediately by the advisor-reassign modal's choice) can
  // resolve out of order over the network — an earlier request completing *after* a later one
  // silently overwrites the newer, correct data with stale values.
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => { setDraft({ ...meeting }); lastSentRef.current = null; }, [meeting.id]);

  // Background polling (useMeetingsPolling) replaces `meeting` with a fresh object on
  // every tick, but `draft` above only re-syncs on an actual id change — otherwise an
  // in-progress edit would get clobbered mid-keystroke. That means an externally-driven
  // change (e.g. an advisor editing the time directly in Outlook, picked up by the
  // reverse-sync webhook) never reached the visible fields, since they render from
  // `draft`. Fix: when date/time change externally *and the row has no unsaved edit*
  // (draft still matches the previous meeting snapshot), pull the new values into
  // draft. `prevMeetingRef` — not `meeting` itself — is compared against, since by the
  // time this effect runs `meeting` already holds the new value.
  const prevMeetingRef = useRef(meeting);
  useEffect(() => {
    const prev = prevMeetingRef.current;
    const wasClean = draft.start_time === prev.start_time && draft.end_time === prev.end_time && draft.meeting_date === prev.meeting_date;
    if (wasClean) {
      setDraft(d => ({ ...d, start_time: meeting.start_time, end_time: meeting.end_time, meeting_date: meeting.meeting_date }));
    }
    prevMeetingRef.current = meeting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.start_time, meeting.end_time, meeting.meeting_date]);

  // Fetch the advisor's Outlook busy ranges for this specific meeting date — used both
  // to warn/block saving on a real overlap, and to power the schedule hover tooltips.
  // Fetches the FULL list, including this meeting's own synced event — the day-schedule
  // tooltips are meant to show the real picture of the day (this meeting genuinely
  // occupies that slot), not a version with a gap where it pretends to be free. Only the
  // conflict check below needs the own event excluded (see conflictCheckBusy).
  const advisorIdForBusyCheck = draft.advisor_ids?.[0];
  const ownEventId = meeting.calendar_sync?.[advisorIdForBusyCheck]?.external_event_id;
  useEffect(() => {
    if (!advisorIdForBusyCheck || !draft.meeting_date) { setAdvisorBusy([]); setBusyLoading(false); setBusyFailed(false); return; }
    let cancelled = false;
    setBusyLoading(true);
    fetchDayBusy(advisorIdForBusyCheck, draft.meeting_date).then(ranges => {
      if (cancelled) return;
      if (ranges === null) {
        // Couldn't check — keep whatever was last successfully shown rather than
        // wiping it to an empty (falsely "free"-looking) list.
        setBusyFailed(true);
      } else {
        setAdvisorBusy(ranges);
        setBusyFailed(false);
      }
      setBusyLoading(false);
    });
    return () => { cancelled = true; };
  }, [advisorIdForBusyCheck, draft.meeting_date, meeting.calendar_sync]);

  // Two sources for the red-border warning: the backend persists whether the *saved*
  // time genuinely conflicts (in calendar_sync.conflict) — available instantly on load,
  // no waiting on a live fetch. Once the draft is edited away from the saved values, the
  // live check (against advisorBusy) takes over for real-time feedback while typing.
  const draftMatchesSaved = draft.start_time === meeting.start_time && draft.end_time === meeting.end_time && draft.meeting_date === meeting.meeting_date;
  const persistedConflict = draftMatchesSaved && !!advisorIdForBusyCheck && !!meeting.calendar_sync?.[advisorIdForBusyCheck]?.conflict;
  // Excludes this meeting's own synced event — otherwise it would always "conflict" with itself.
  const conflictCheckBusy = advisorBusy.filter(b => b.id !== ownEventId);
  const liveConflict = computeTimeConflict(draft.start_time, draft.end_time, conflictCheckBusy);
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

  function saveDraft(draftToSave) {
    // Chain onto the queue so this save's PUT never races an earlier one still in flight —
    // see saveQueueRef above. `.catch(() => {})` on the queue itself (not on what we return)
    // keeps one failed save from permanently wedging the chain for subsequent saves.
    const run = () => performSave(draftToSave);
    const result = saveQueueRef.current.then(run, run);
    saveQueueRef.current = result.catch(() => {});
    return result;
  }

  async function performSave(draftToSave) {
    const advisorId = draftToSave.advisor_ids?.[0];
    // Only worth live-checking when this save is actually introducing a *new* time —
    // if start/end/date match what's already saved, no new slot is being claimed, so
    // there's nothing new to conflict with (the backend's persisted calendar_sync.conflict,
    // shown via persistedConflict above, already covers that case). This also sidesteps a
    // real bug: excluding "this meeting's own event" from the live-fetched busy list relies
    // on `meeting.calendar_sync[advisorId].external_event_id`, which can be stale relative
    // to the *current* save (e.g. a save firing right after this row's own event was just
    // created, before the fresh `meeting` prop with its real calendar_sync has propagated
    // back down) — a stale/undefined id fails to exclude the meeting's own real event from
    // its own live-fetched busy list, so it gets flagged as "conflicting with itself".
    const timeUnchanged = draftToSave.start_time === meeting.start_time
      && draftToSave.end_time === meeting.end_time
      && draftToSave.meeting_date === meeting.meeting_date;
    let conflict = { startConflict: false, endConflict: false, conflictingRange: null };
    if (!timeUnchanged && advisorId && draftToSave.meeting_date && draftToSave.start_time && draftToSave.end_time) {
      // Re-fetch fresh busy ranges right before checking — the reactive `advisorBusy`
      // state is populated asynchronously and can lag behind rapid edits (e.g. setting
      // date → start → end back-to-back), which would otherwise show a stale (non-red)
      // warning state for a moment. A live check right before saving avoids that.
      // Fetched locally for an accurate conflict check right at save time — deliberately
      // NOT written into the shared `advisorBusy` display state. That state already has its
      // own effect (with proper stale-response guarding via the `cancelled` flag) that
      // refetches once the save completes and syncs; if this snapshot — taken *before* the
      // save/sync even started — were also allowed to call setAdvisorBusy, whichever of the
      // two resolves last would win, and this earlier one sometimes did, intermittently
      // clobbering the correct post-sync picture with a stale pre-save one.
      // null means the live check failed — fall back to the last known-good state
      // rather than treating a failed check as "nothing booked".
      const liveBusy = await fetchDayBusy(advisorId, draftToSave.meeting_date) ?? advisorBusy;
      const ownEventIdForSave = meeting.calendar_sync?.[advisorId]?.external_event_id;
      conflict = computeTimeConflict(draftToSave.start_time, draftToSave.end_time, liveBusy.filter(b => b.id !== ownEventIdForSave));
    }
    if (conflict.startConflict || conflict.endConflict) {
      // Warn, but still let the save go through — the advisor may genuinely need two
      // overlapping commitments (e.g. a "day off" alongside a meeting); we just make
      // sure the double-booking is visible and impossible to save by accident.
      const subject = await resolveMeetingSubject(draftToSave);
      setConflictModal({
        // Read from draftToSave, not the outer `advisorName` — that's derived from
        // `draft` at the *previous* render and can still be one step behind here (e.g.
        // right after changing the advisor: setDraft(nd) + saveDraft(nd) both fire
        // synchronously, before React re-renders with the new `draft`), showing the
        // advisor being replaced instead of the one the conflict actually applies to.
        advisorName: draftToSave.advisor_profiles?.[0]?.full_name || "היועץ",
        existingEvent: conflict.conflictingRange,
        newEvent: { startHM: draftToSave.start_time, endHM: draftToSave.end_time, subject },
      });
    }
    lastSentRef.current = JSON.stringify(draftToSave);
    // Invalidate the freebusy cache only *after* onSave's PUT round-trip (and the
    // Outlook sync it triggers server-side) actually completes — not before. Clearing
    // it earlier leaves a window where a freebusy fetch can slip in before the backend
    // has actually written the change, cache the pre-save snapshot, and then sit there
    // looking authoritative for the full cache TTL even though it's now stale again.
    await onSave(draftToSave);
    (draftToSave.advisor_ids || []).forEach(invalidateFreebusyCache);
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
  const offlineSeconds = sumOfflineSeconds(meeting.offline_work_entries);
  const callsSeconds = meeting.calls_duration_seconds || 0;

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
      {advisorReassignPrompt && (
        <AdvisorReassignModal
          oldTypeLabel={MEETING_SERVICE_TYPE_OPTIONS.find(o => o.value === advisorReassignPrompt.oldType)?.label || "—"}
          newTypeLabel={MEETING_SERVICE_TYPE_OPTIONS.find(o => o.value === advisorReassignPrompt.newType)?.label || "—"}
          existingAdvisors={advisorReassignPrompt.existing}
          newAdvisors={advisorReassignPrompt.typed}
          onCancel={() => setAdvisorReassignPrompt(null)}
          onChoose={profiles => {
            const nd = { ...advisorReassignPrompt.base, advisor_ids: profiles.map(p => p.id), advisor_profiles: profiles };
            setDraft(nd);
            saveDraft(nd);
            setAdvisorReassignPrompt(null);
          }}
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
        className="border-b border-slate-300 hover:bg-slate-50/50 transition-colors group">
        {selectable && (
          <td className="py-2.5 px-2 text-center">
            <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect?.(meeting.id)}
              aria-label="בחר פגישה" className="w-3.5 h-3.5 rounded accent-blue-600" />
          </td>
        )}
        {/* כפתור הרחבת שורה */}
        <td className="py-2.5 px-1 text-center">
          <button type="button" onClick={() => onToggleExpand?.(meeting.id)} aria-expanded={!!expanded}
            aria-label={expanded ? "כווץ שורה" : "הרחב שורה — פירוט פעילות בפועל"}
            className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </td>
        {/* תאריך */}
        <td className="py-2.5 px-2">
          <div className="relative">
            <button type="button" ref={dateCellRef}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowDate(o => !o)}
              onMouseEnter={() => setDateHovered(true)}
              onMouseLeave={() => setDateHovered(false)}
              className="text-sm text-right w-full hover:text-blue-600 transition-colors cursor-pointer font-medium text-slate-700 whitespace-nowrap">
              {draft.meeting_date ? formatMeetingDate(draft.meeting_date) : <span className="text-slate-300 font-normal">—</span>}
            </button>
            {showDate && <DatePickerPopover value={draft.meeting_date}
              advisorId={draft.advisor_ids?.[0]}
              ownEventId={ownEventId}
              anchorRef={dateCellRef}
              onChange={v => { const nd = { ...draft, meeting_date: v }; setDraft(nd); setShowDate(false); saveDraft(nd); }}
              onClose={() => setShowDate(false)} />}
            {!showDate && dateHovered && advisorIdForBusyCheck && draft.meeting_date && (
              <ScheduleTooltip anchorRef={dateCellRef}>
                {busyLoading ? (
                  <span className="text-slate-400">טוען זמינות...</span>
                ) : (
                  <>
                    {busyFailed && (
                      <p className="text-amber-600 text-sm mb-2">⚠ לא ניתן היה לעדכן את הזמינות כרגע — הנתונים המוצגים עשויים להיות לא מעודכנים</p>
                    )}
                    <DayScheduleBlocks segments={computeSegments(advisorBusy)} ownEventId={ownEventId} />
                  </>
                )}
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
        <td className="py-2.5 pr-2 pl-3 relative" ref={startCellRef}
          onMouseEnter={() => setStartHovered(true)} onMouseLeave={() => setStartHovered(false)}>
          <TimeInput id={`start-${meeting.id}`} value={draft.start_time || ""}
            onChange={v => set("start_time", v)}
            ariaLabel="שעת התחלה" hasError={startConflict}
            errorMessage="היועץ כבר תפוס בזמן הזה ביומן ה-Outlook" />
          {startHovered && advisorIdForBusyCheck && draft.meeting_date && (
            <ScheduleTooltip anchorRef={startCellRef}>
              {busyLoading ? (
                <span className="text-slate-400">טוען זמינות...</span>
              ) : (
                <>
                  {busyFailed && (
                    <p className="text-amber-600 text-sm mb-2">⚠ לא ניתן היה לעדכן את הזמינות — הנתונים עשויים להיות לא מעודכנים</p>
                  )}
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
                </>
              )}
            </ScheduleTooltip>
          )}
        </td>
        {/* שעת סיום */}
        <td className="py-2.5 px-1 relative" ref={endCellRef}
          onMouseEnter={() => setEndHovered(true)} onMouseLeave={() => setEndHovered(false)}>
          <TimeInput id={`end-${meeting.id}`} value={draft.end_time || ""}
            onChange={v => set("end_time", v)}
            ariaLabel="שעת סיום" hasError={endConflict}
            errorMessage="היועץ כבר תפוס בזמן הזה ביומן ה-Outlook" />
          {endHovered && advisorIdForBusyCheck && draft.meeting_date && draft.start_time && (() => {
            if (busyLoading) {
              return <ScheduleTooltip anchorRef={endCellRef}><span className="text-slate-400">טוען זמינות...</span></ScheduleTooltip>;
            }
            const next = findNextEvent(draft.start_time, advisorBusy);
            return (
              <ScheduleTooltip anchorRef={endCellRef}>
                {busyFailed && (
                  <p className="text-amber-600 text-sm mb-2">⚠ לא ניתן היה לעדכן את הזמינות — הנתונים עשויים להיות לא מעודכנים</p>
                )}
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
              onRequestAccess={(advisorId, name) => onRequestAccess?.(advisorId, name, draft.meeting_date, meeting)}
            />
          </td>
        )}
        {/* משתתפים */}
        <td className="py-2.5 px-2">
          {schoolStage === "sheshshnati" && (
            <div className="flex items-center gap-1 mb-1.5" role="group" aria-label="היקף הפגישה (תיכון/חט&quot;ב)">
              {STAGE_SCOPE_PILLS.map(p => (
                <button key={p.value} type="button"
                  onClick={() => { const nd = { ...draft, stage_scope: draft.stage_scope === p.value ? null : p.value }; setDraft(nd); saveDraft(nd); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${draft.stage_scope === p.value
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-slate-200 text-slate-500 hover:border-blue-300"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <ParticipantsSelector contacts={contacts} selected={draft.participants || []}
            onChange={v => {
              const reminderOff = v.length === 0 && draft.reminder_enabled;
              // Who to call for the Outlook event subject: if exactly one principal-like
              // contact (principal / principal_chativa) is selected, it wins; a single
              // participant is unambiguous; otherwise ask the user.
              const principalMatches = v.filter(p => PRINCIPAL_KEYS.includes(p.key));
              const primaryContactKey = principalMatches.length === 1 ? principalMatches[0].key : v.length === 1 ? v[0].key : null;
              const nd = { ...draft, participants: v, primary_contact_key: primaryContactKey, ...(reminderOff ? { reminder_enabled: false } : {}) };
              setDraft(nd);
              if (v.length > 1 && !primaryContactKey) {
                setContactPickerOptions(v); // defer save until the user picks who to call
              } else {
                saveDraft(nd);
              }
            }} />
        </td>
        {/* מיקום */}
        <td className="py-2.5 px-2">
          <MeetingTypeSelect value={draft.meeting_type || ""} onChange={v => { const nd = { ...draft, meeting_type: v }; setDraft(nd); saveDraft(nd); }} />
        </td>
        {/* סוג */}
        <td className="py-2.5 px-2">
          <MeetingServiceTypeSelect
            value={draft.meeting_service_type || ""}
            hasError={!draft.meeting_service_type}
            onChange={v => {
              const oldType = draft.meeting_service_type;
              const nd = { ...draft, meeting_service_type: v };
              const existing = draft.advisor_profiles || [];
              const typed = typedAdvisorsForServiceType(v, typedAdvisors);
              if (existing.length === 0) {
                // Advisor field empty — fill it in automatically, no need to ask.
                nd.advisor_ids = typed.map(p => p.id);
                nd.advisor_profiles = typed;
                setDraft(nd);
                saveDraft(nd);
                return;
              }
              // Must be the *same set*, not just "typed contained in existing" — a shrinking
              // transition (e.g. גפן+שוטף → גפן) has typed ⊆ existing but existing also holds
              // an extra, no-longer-relevant advisor (the שוטף one), which a subset check alone
              // would miss and silently leave in place.
              const sameSet = existing.length === typed.length && typed.every(z => existing.some(w => w.id === z.id));
              setDraft(nd);
              saveDraft(nd);
              if (typed.length > 0 && !sameSet) {
                setAdvisorReassignPrompt({ oldType, newType: v, existing, typed, base: nd });
              }
            }} />
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
          </div>
        </td>
        {/* יומן */}
        {showCalendarColumn && (
          <td className="py-2.5 px-2 text-center whitespace-nowrap" style={{ width: "95px" }}>
            <CalendarSyncBadge calendarSync={meeting.calendar_sync} />
          </td>
        )}
        {/* בפועל: תחילת שיחה */}
        <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap text-center" dir="ltr">{meeting.calls_start_time || "—"}</td>
        {/* בפועל: משך שיחות */}
        <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap text-center" dir="ltr">{formatActualDuration(callsSeconds)}</td>
        {/* בפועל: משך אופליין */}
        <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap text-center" dir="ltr">{formatActualDuration(offlineSeconds)}</td>
        {/* בפועל: סה"כ שהושקע */}
        <td className="py-2.5 px-2 text-sm font-semibold text-slate-800 whitespace-nowrap text-center" dir="ltr">{formatActualDuration(callsSeconds + offlineSeconds)}</td>
        {/* סיכום פגישה */}
        <td className="py-2.5 px-2 text-center">
          {meeting.summary_status === "processing" ? (
            <span className="text-xs text-amber-600 font-medium whitespace-nowrap">מעבד...</span>
          ) : (
            <button type="button"
              onMouseDown={e => { e.preventDefault(); onOpenSummary?.(meeting); }}
              className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none"
              aria-label="סיכום פגישה">
              {meeting.summary_status === "error"
                ? <span title={meeting.summary_error || "אירעה שגיאה"} className="text-red-500">⚠</span>
                : <span className="text-slate-400 text-lg font-light">+</span>}
            </button>
          )}
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
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { onRequestDelete(meeting.id); setShowActionsMenu(false); }}
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
      {expanded && (
        <tr>
          <td colSpan={colSpanTotal} className="p-0 border-b border-slate-300 bg-slate-50/50">
            <MeetingActualDetail meeting={meeting} />
          </td>
        </tr>
      )}
    </>
  );
}
