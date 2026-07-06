import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { AdvisorCell } from "./AdvisorCell";
import { DatePickerPopover } from "./DatePickerPopover";
import { MeetingTypeSelect } from "./MeetingTypeSelect";
import { NoParticipantsModal } from "./NoParticipantsModal";
import { ParticipantsSelector } from "./ParticipantsSelector";
import { TimeInput } from "./TimeInput";
import { MEETING_STATUS_OPTIONS, STATUS_MAP, formatMeetingDate } from "./constants";

const TODAY = new Date().toISOString().slice(0, 10);

function isMeetingEligibleForStatusReminder(meeting) {
  if (meeting.status !== "scheduled") return false;
  if (!meeting.meeting_date || meeting.meeting_date > TODAY) return false;
  if (!meeting.end_time) return false;
  const endTime = new Date(`${meeting.meeting_date}T${meeting.end_time}:00`);
  return endTime <= new Date();
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
  const rowRef = useRef(null);
  const actionsMenuRef = useRef(null);
  // Track what was last sent so blur doesn't double-save after an immediate save
  const lastSentRef = useRef(null);

  useEffect(() => { setDraft({ ...meeting }); lastSentRef.current = null; }, [meeting.id]);

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
    lastSentRef.current = JSON.stringify(draftToSave);
    onSave(draftToSave);
  }

  function handleRowBlur(e) {
    if (rowRef.current?.contains(e.relatedTarget)) return;
    if (showDate || showStatus) return;
    const curr = JSON.stringify(draft);
    const baseline = lastSentRef.current ?? JSON.stringify(meeting);
    if (baseline !== curr) saveDraft(draft);
  }

  const status = STATUS_MAP[draft.status] || STATUS_MAP.other;

  return (
    <>
      {showNoParticipantsModal && <NoParticipantsModal onClose={() => setShowNoParticipantsModal(false)} />}
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
              className="text-sm text-right w-full hover:text-blue-600 transition-colors cursor-pointer font-medium text-slate-700 whitespace-nowrap">
              {draft.meeting_date ? formatMeetingDate(draft.meeting_date) : <span className="text-slate-300 font-normal">—</span>}
            </button>
            {showDate && <DatePickerPopover value={draft.meeting_date}
              onChange={v => { const nd = { ...draft, meeting_date: v }; setDraft(nd); setShowDate(false); saveDraft(nd); }}
              onClose={() => setShowDate(false)} />}
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
        <td className="py-2.5 pr-2 pl-3">
          <TimeInput id={`start-${meeting.id}`} value={draft.start_time || ""} onChange={v => set("start_time", v)} ariaLabel="שעת התחלה" />
        </td>
        {/* שעת סיום */}
        <td className="py-2.5 px-1">
          <TimeInput id={`end-${meeting.id}`} value={draft.end_time || ""} onChange={v => set("end_time", v)} ariaLabel="שעת סיום" />
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
              const nd = { ...draft, participants: v, ...(reminderOff ? { reminder_enabled: false } : {}) };
              setDraft(nd);
              saveDraft(nd);
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
