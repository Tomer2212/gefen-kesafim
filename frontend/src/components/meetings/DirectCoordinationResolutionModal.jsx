import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { buildSchoolContacts, resolveMeetingCoordinator } from "./schoolContacts";

const COORDINATOR_ROLE_FIELDS = {
  principal: { name: "principal_name", phone: "principal_phone", email: "principal_email" },
  principal_chativa: { name: "principal_chativa_name", phone: "principal_chativa_phone", email: "principal_chativa_email" },
  secretary: { name: "secretary_name", phone: "secretary_phone", email: "secretary_email" },
  finance_contact: { name: "finance_contact_name", phone: "finance_contact_phone", email: "finance_contact_email" },
};

// buildSchoolContacts uses "finance" as its participant key, while the meeting_coordinator
// ref convention (mirrored from schools_router.py) uses "finance_contact" — deliberately
// separate key spaces, see schoolContacts.js.
const PARTICIPANT_KEY_FIELDS = {
  principal: COORDINATOR_ROLE_FIELDS.principal,
  principal_chativa: COORDINATOR_ROLE_FIELDS.principal_chativa,
  secretary: COORDINATOR_ROLE_FIELDS.secretary,
  finance: COORDINATOR_ROLE_FIELDS.finance_contact,
};

function coordinatorRoleOptions(school) {
  const options = [{ value: "principal", label: "מנהל/ת" }];
  if (school.stage === "sheshshnati" && school.principal_same_person !== true) {
    options.push({ value: "principal_chativa", label: 'מנהל/ת חט"ב' });
  }
  options.push({ value: "secretary", label: "מנהלנ/ית" });
  options.push({ value: "finance_contact", label: "אחראי/ת כספים" });
  return options;
}

export function DirectCoordinationResolutionModal({ school, participantRoleKeysNeeded, onSchoolUpdate, onProceed, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [savingKey, setSavingKey] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [coordDraft, setCoordDraft] = useState(null);
  const [participantDrafts, setParticipantDrafts] = useState({});

  const roleOptions = coordinatorRoleOptions(school);
  const coordinator = resolveMeetingCoordinator(school);
  const coordinatorOk = !!(coordinator && coordinator.email);

  const contacts = buildSchoolContacts(school);
  const contactsByKey = Object.fromEntries(contacts.map(c => [c.key, c]));
  const badParticipantKeys = participantRoleKeysNeeded.filter(k => !contactsByKey[k]?.email);
  const allResolved = coordinatorOk && badParticipantKeys.length === 0;

  function coordinatorDraftValue() {
    if (coordDraft) return coordDraft;
    const named = contacts.find(c => ["principal", "principal_chativa", "secretary", "finance"].includes(c.key) && c.name);
    const mapKey = k => (k === "finance" ? "finance_contact" : k);
    const preferredRole = school.meeting_coordinator || (named ? mapKey(named.key) : "principal");
    const fields = COORDINATOR_ROLE_FIELDS[preferredRole] || COORDINATOR_ROLE_FIELDS.principal;
    return {
      role: COORDINATOR_ROLE_FIELDS[preferredRole] ? preferredRole : "principal",
      name: school[fields.name] || "",
      phone: school[fields.phone] || "",
      email: school[fields.email] || "",
    };
  }
  function updateCoordDraft(patch) {
    setCoordDraft({ ...coordinatorDraftValue(), ...patch });
  }
  function selectCoordRole(role) {
    const fields = COORDINATOR_ROLE_FIELDS[role];
    setCoordDraft({ role, name: school[fields.name] || "", phone: school[fields.phone] || "", email: school[fields.email] || "" });
  }
  async function saveCoordinator() {
    const draft = coordinatorDraftValue();
    if (!draft.name?.trim() || !draft.email?.trim()) return;
    const fields = COORDINATOR_ROLE_FIELDS[draft.role];
    setSavingKey("coordinator");
    setSaveError(null);
    try {
      const patch = {
        name: school.name,
        [fields.name]: draft.name.trim(),
        [fields.phone]: draft.phone?.trim() || null,
        [fields.email]: draft.email.trim(),
        meeting_coordinator: draft.role,
      };
      await axios.put(`/schools/${school.id}`, patch);
      onSchoolUpdate(patch);
      setCoordDraft(null);
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

        {!coordinatorOk && (() => {
          cardCounter += 1;
          const n = cardCounter;
          const draft = coordinatorDraftValue();
          const saving = savingKey === "coordinator";
          return (
            <div className="bg-white rounded-lg border border-amber-200 p-3 space-y-2">
              <p className="text-xs text-slate-700"><b>בעיה {n}:</b> לא הוגדר/ה אחראי/ת תיאום פגישות עם כתובת מייל תקינה — יש להגדיר כעת:</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select value={draft.role} onChange={e => selectCoordRole(e.target.value)}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                  {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input placeholder="שם" value={draft.name} onChange={e => updateCoordDraft({ name: e.target.value })}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-28" />
                <input placeholder="טלפון" value={draft.phone} onChange={e => updateCoordDraft({ phone: e.target.value })}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-24" />
                <input placeholder="מייל" value={draft.email} onChange={e => updateCoordDraft({ email: e.target.value })}
                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-36" />
                <button type="button" onClick={saveCoordinator} disabled={saving || !draft.name?.trim() || !draft.email?.trim()}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
              </div>
            </div>
          );
        })()}
        {coordinatorOk && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
            <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
            <span className="text-xs text-emerald-800">אחראי/ת תיאום פגישות: {coordinator.name} — הוגדר/ה</span>
          </div>
        )}

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
