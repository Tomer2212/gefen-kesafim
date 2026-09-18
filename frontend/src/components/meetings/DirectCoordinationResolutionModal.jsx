import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { buildSchoolContacts } from "./schoolContacts";
import { COORDINATOR_ROLE_FIELDS, SLOT_LABELS, resolveMeetingCoordinatorForSlot } from "./meetingCoordinatorSlots";

// buildSchoolContacts uses "finance" as its participant key, while the meeting-coordinator
// ref convention (mirrored from schools_router.py) uses "finance_contact" — deliberately
// separate key spaces, see schoolContacts.js.
const PARTICIPANT_KEY_FIELDS = {
  principal: COORDINATOR_ROLE_FIELDS.principal,
  principal_chativa: COORDINATOR_ROLE_FIELDS.principal_chativa,
  secretary: COORDINATOR_ROLE_FIELDS.secretary,
  finance: COORDINATOR_ROLE_FIELDS.finance_contact,
};

function coordinatorRoleOptionsForSlot(school) {
  const options = [{ value: "principal", label: "מנהל/ת" }];
  if (school.stage === "sheshshnati") options.push({ value: "principal_chativa", label: 'מנהל/ת חט"ב' });
  options.push({ value: "secretary", label: "מנהלנ/ית" });
  if (school.stage === "sheshshnati") options.push({ value: "secretary_chativa", label: 'מנהלנ/ית חט"ב' });
  options.push({ value: "finance_contact", label: "אחראי/ת כספים" });
  if (school.stage === "sheshshnati") options.push({ value: "finance_contact_chativa", label: 'אחראי/ת כספים חט"ב' });
  return options;
}

export function DirectCoordinationResolutionModal({ school, neededSlots, participantRoleKeysNeeded, onSchoolUpdate, onProceed, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [savingKey, setSavingKey] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [slotDrafts, setSlotDrafts] = useState({});
  const [participantDrafts, setParticipantDrafts] = useState({});

  const roleOptions = coordinatorRoleOptionsForSlot(school);
  const badSlots = neededSlots.filter(slot => {
    const c = resolveMeetingCoordinatorForSlot(school, slot);
    return !c || !c.email;
  });

  const contacts = buildSchoolContacts(school);
  const contactsByKey = Object.fromEntries(contacts.map(c => [c.key, c]));
  const badParticipantKeys = participantRoleKeysNeeded.filter(k => !contactsByKey[k]?.email);
  const allResolved = badSlots.length === 0 && badParticipantKeys.length === 0;

  function slotDraftValue(slot) {
    if (slotDrafts[slot]) return slotDrafts[slot];
    const existingRef = school.meeting_coordinators?.[slot];
    const role = COORDINATOR_ROLE_FIELDS[existingRef] ? existingRef : "principal";
    const fields = COORDINATOR_ROLE_FIELDS[role];
    return { role, name: school[fields.name] || "", phone: school[fields.phone] || "", email: school[fields.email] || "" };
  }
  function updateSlotDraft(slot, patch) {
    setSlotDrafts(prev => ({ ...prev, [slot]: { ...slotDraftValue(slot), ...patch } }));
  }
  function selectSlotRole(slot, role) {
    const fields = COORDINATOR_ROLE_FIELDS[role];
    setSlotDrafts(prev => ({ ...prev, [slot]: { role, name: school[fields.name] || "", phone: school[fields.phone] || "", email: school[fields.email] || "" } }));
  }
  async function saveSlot(slot) {
    const draft = slotDraftValue(slot);
    if (!draft.name?.trim() || !draft.email?.trim()) return;
    const fields = COORDINATOR_ROLE_FIELDS[draft.role];
    setSavingKey(`slot:${slot}`);
    setSaveError(null);
    try {
      const patch = {
        name: school.name,
        [fields.name]: draft.name.trim(),
        [fields.phone]: draft.phone?.trim() || null,
        [fields.email]: draft.email.trim(),
        meeting_coordinators: { ...(school.meeting_coordinators || {}), [slot]: draft.role },
      };
      await axios.put(`/schools/${school.id}`, patch);
      onSchoolUpdate(patch);
      setSlotDrafts(prev => { const next = { ...prev }; delete next[slot]; return next; });
    } catch {
      setSaveError("שמירת אחראי/ת תיאום הפגישות נכשלה — נסה שוב.");
    } finally {
      setSavingKey(null);
    }
  }

  function participantDraftValue(key) {
    if (participantDrafts[key]) return participantDrafts[key];
    const c = contactsByKey[key];
    return { name: c?.name || "", phone: c?.phone || "", email: c?.email || "" };
  }
  function updateParticipantDraft(key, patch) {
    setParticipantDrafts(prev => ({ ...prev, [key]: { ...participantDraftValue(key), ...patch } }));
  }
  async function saveParticipant(key) {
    const draft = participantDraftValue(key);
    if (!draft.name?.trim() || !draft.email?.trim()) return;
    const fields = PARTICIPANT_KEY_FIELDS[key];
    if (!fields) return;
    setSavingKey(`participant:${key}`);
    setSaveError(null);
    try {
      const patch = {
        name: school.name,
        [fields.name]: draft.name.trim(),
        [fields.phone]: draft.phone?.trim() || null,
        [fields.email]: draft.email.trim(),
      };
      await axios.put(`/schools/${school.id}`, patch);
      onSchoolUpdate(patch);
      setParticipantDrafts(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      setSaveError("שמירת איש הקשר נכשלה — נסה שוב.");
    } finally {
      setSavingKey(null);
    }
  }

  let cardCounter = 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="dc-resolution-title" onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-xl max-h-[85vh] overflow-y-auto flex flex-col gap-4">
        <h2 id="dc-resolution-title" className="font-bold text-slate-900 text-lg">חסרות הגדרות להשלמת השליחה</h2>
        <p className="text-sm text-slate-600">לבית הספר חסרים כמה פרטים לפני שאפשר לשלוח את הבקשה — ניתן להשלים אותם כאן ישירות.</p>

        {neededSlots.map(slot => {
          const c = resolveMeetingCoordinatorForSlot(school, slot);
          const ok = !!(c && c.email);
          if (ok) {
            return (
              <div key={slot} className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                <span className="text-xs text-emerald-800">אחראי/ת תיאום פגישות ({SLOT_LABELS[slot] || slot}): {c.name} — הוגדר/ה</span>
              </div>
            );
          }
          cardCounter += 1;
          const n = cardCounter;
          const draft = slotDraftValue(slot);
          const saving = savingKey === `slot:${slot}`;
          return (
            <div key={slot} className="bg-white rounded-lg border border-amber-200 p-3 space-y-2">
              <p className="text-xs text-slate-700"><b>בעיה {n}:</b> לא הוגדר/ה אחראי/ת תיאום פגישות עם כתובת מייל תקינה עבור <b>{SLOT_LABELS[slot] || slot}</b> — יש להגדיר כעת:</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select value={draft.role} onChange={e => selectSlotRole(slot, e.target.value)}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                  {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input placeholder="שם" value={draft.name} onChange={e => updateSlotDraft(slot, { name: e.target.value })}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-28" />
                <input placeholder="טלפון" value={draft.phone} onChange={e => updateSlotDraft(slot, { phone: e.target.value })}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-24" />
                <input placeholder="מייל" value={draft.email} onChange={e => updateSlotDraft(slot, { email: e.target.value })}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-36" />
                <button type="button" onClick={() => saveSlot(slot)} disabled={saving || !draft.name?.trim() || !draft.email?.trim()}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          );
        })}

        {participantRoleKeysNeeded.length > 0 && (() => {
          cardCounter += 1;
          const n = cardCounter;
          return (
            <div className="bg-white rounded-lg border border-amber-100 p-3 space-y-2">
              <p className="text-xs text-slate-700"><b>בעיה {n}:</b> חסרה כתובת מייל לאנשי קשר שנבחרו כמשתתפים — יש למלא לכל אחד:</p>
              {participantRoleKeysNeeded.map(key => {
                const c = contactsByKey[key];
                const ok = !!c?.email;
                const draft = participantDraftValue(key);
                const saving = savingKey === `participant:${key}`;
                if (ok) {
                  return (
                    <div key={key} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                      <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                      <span className="text-xs text-emerald-800">{c.label}: {c.name} — טופל</span>
                    </div>
                  );
                }
                return (
                  <div key={key} className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-slate-600 w-20 shrink-0">{c?.label || key}</span>
                    <input placeholder="שם" value={draft.name} onChange={e => updateParticipantDraft(key, { name: e.target.value })}
                      className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-28" />
                    <input placeholder="טלפון" value={draft.phone} onChange={e => updateParticipantDraft(key, { phone: e.target.value })}
                      className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-24" />
                    <input placeholder="מייל" value={draft.email} onChange={e => updateParticipantDraft(key, { email: e.target.value })}
                      className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-36" />
                    <button type="button" onClick={() => saveParticipant(key)} disabled={saving || !draft.name?.trim() || !draft.email?.trim()}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {saveError && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}

        <div className="flex items-center justify-between gap-2 mt-1">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-1.5">ביטול</button>
          <button type="button" onClick={onProceed} disabled={!allResolved}
            className="btn-blue text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            שליחת בקשה
          </button>
        </div>
      </div>
    </div>
  );
}
