import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { MEETING_SERVICE_TYPE_LABELS } from "./taskShared";
import { DURATION_OPTIONS, formatDuration } from "./ConditionGroupsEditor";

// Fallback labels only — round 8: the backend sends a per-school school.participants.role_labels
// map (aware of stage/principal_same_person, e.g. "מנהל/ת חט\"ע" vs "מנהל/ת חט\"ב"), which is
// preferred wherever available so this file doesn't need to duplicate that logic.
const PARTICIPANT_ROLE_LABELS = { principal: "מנהל/ת", principal_chativa: 'מנהל/ת חט"ב', secretary: "מנהלנ/ית", finance_contact: "אחראי/ת כספים" };
const PARTICIPANT_ROLE_FIELDS = {
  principal: { name: "principal_name", phone: "principal_phone", email: "principal_email" },
  principal_chativa: { name: "principal_chativa_name", phone: "principal_chativa_phone", email: "principal_chativa_email" },
  secretary: { name: "secretary_name", phone: "secretary_phone", email: "secretary_email" },
  finance_contact: { name: "finance_contact_name", phone: "finance_contact_phone", email: "finance_contact_email" },
};
const COORDINATOR_ROLE_OPTIONS = [
  { value: "principal", label: "מנהל/ת" },
  { value: "secretary", label: "מנהלנ/ית" },
  { value: "finance_contact", label: "אחראי/ת כספים" },
];

// Round 6 — replaces both round 5's split TaskMeetingResolutionModal (advisor/participant-name
// only) AND TaskContactResolutionModal for meeting-scheduling tasks specifically (general/
// non-meeting tasks still use TaskContactResolutionModal on its own, unchanged). Grouped by
// school (not by problem type) per the product owner's explicit spec: one expandable row per
// school with a red-X/green-check status chip, and up to N numbered problem cards inside —
// participants, coordinator, then one card per meeting-type with a missing default (advisor
// and/or duration). Deliberately BLOCKING (unlike every other resolution modal in this app,
// which lets you "continue and skip the rest") — the "צור משימה" button stays disabled until
// every school's problems are resolved-or-removed, per explicit user confirmation that this is
// an intentional deviation from the established non-blocking pattern.
//
// Cards/rows never disappear once resolved (per explicit feedback) — they stay visible with a
// green "טופל" state instead, so the manager can see everything that was fixed. Resolving the
// same underlying contact from two different problems (e.g. the principal is both a meeting
// participant AND the coordinator) auto-resolves the other one too — see the cross-resolution
// notes in handleSaveParticipant/handleSaveCoordinator.
export default function TaskMeetingResolutionModal({
  criteria, manualSchoolIds, meetingRequirements, channel, academicYear, orgUsers, onProceed, onClose,
}) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState(null); // {schools, total_schools, ok_schools}
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [removedSchoolIds, setRemovedSchoolIds] = useState(new Set());
  // Uniform resolved-problem tracker across all 4 sub-kinds: `coordinator:{id}`,
  // `participant:{id}:{role}`, `advisor:{id}:{type}`, `duration:{id}:{type}` — a leaf counts as
  // resolved regardless of whether it got there via a real save or a task-only override.
  const [resolvedKeys, setResolvedKeys] = useState(new Set());
  const [meetingOverrides, setMeetingOverrides] = useState({}); // {school_id: {type: {advisor_ids, duration_minutes}}}
  const [drafts, setDrafts] = useState({}); // composite key -> draft value(s), kept after saving so the green summary can show what was entered
  const [savingKey, setSavingKey] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const needsPhone = channel === "whatsapp_twilio";
  function roleLabel(school, role) {
    return school.participants?.role_labels?.[role] || PARTICIPANT_ROLE_LABELS[role] || role;
  }
  // A contact only really satisfies the channel's requirement once it has a name AND the
  // field that channel needs — matches the check endpoint's own criterion. Just typing a name
  // isn't enough, otherwise we'd mark something "done" that the actual send would still fail on.
  function isDraftComplete(draft) {
    return !!draft.name?.trim() && !!(needsPhone ? draft.phone?.trim() : draft.email?.trim());
  }

  function runCheck() {
    setChecking(true);
    axios.post("/tasks/meetings/check", {
      criteria, manual_school_ids: manualSchoolIds, meeting_requirements: meetingRequirements,
      channel, academic_year: academicYear,
    })
      .then(r => setResult(r.data))
      .catch(() => setResult(null))
      .finally(() => setChecking(false));
  }

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved = key => resolvedKeys.has(key);
  const markResolved = key => setResolvedKeys(prev => new Set(prev).add(key));

  // Full, stable list of this school's problem leaves (never filtered by resolved state, so
  // cards/rows don't disappear as they get fixed) — used both for rendering and for counting
  // what's still outstanding.
  function schoolLeaves(school) {
    const leaves = [];
    if (school.participants) {
      for (const role of school.participants.roles) leaves.push(`participant:${school.school_id}:${role}`);
    }
    if (school.coordinator) leaves.push(`coordinator:${school.school_id}`);
    for (const md of school.meeting_defaults || []) {
      if (md.missing_advisor) leaves.push(`advisor:${school.school_id}:${md.meeting_service_type}`);
      if (md.missing_duration) leaves.push(`duration:${school.school_id}:${md.meeting_service_type}`);
    }
    return leaves;
  }
  function schoolUnresolvedCount(school) {
    return schoolLeaves(school).filter(k => !resolved(k)).length;
  }

  const schools = result?.schools || [];
  const activeSchools = schools.filter(s => !removedSchoolIds.has(s.school_id));
  const remainingSchools = activeSchools.filter(s => schoolUnresolvedCount(s) > 0);
  const allClear = !checking && result && remainingSchools.length === 0;

  function toggleExpanded(schoolId) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(schoolId) ? next.delete(schoolId) : next.add(schoolId);
      return next;
    });
  }
  function toggleRemoved(schoolId) {
    setRemovedSchoolIds(prev => {
      const next = new Set(prev);
      next.has(schoolId) ? next.delete(schoolId) : next.add(schoolId);
      return next;
    });
  }

  // --- Participants card ---
  function participantDraft(school, role) {
    const key = `${school.school_id}:${role}`;
    if (drafts[key]) return drafts[key];
    const existing = school.participants?.contacts?.[role] || {};
    return { name: existing.name || "", phone: existing.phone || "", email: existing.email || "" };
  }
  function updateParticipantDraft(school, role, patch) {
    const key = `${school.school_id}:${role}`;
    setDrafts(prev => ({ ...prev, [key]: { ...participantDraft(school, role), ...patch } }));
  }
  async function handleSaveParticipant(school, role) {
    const draft = participantDraft(school, role);
    if (!isDraftComplete(draft)) return;
    const fields = PARTICIPANT_ROLE_FIELDS[role];
    const key = `participant:${school.school_id}:${role}`;
    setSavingKey(key);
    setSaveError(null);
    try {
      await axios.put(`/schools/${school.school_id}`, {
        name: school.school_name,
        [fields.name]: draft.name.trim(),
        [fields.phone]: draft.phone?.trim() || null,
        [fields.email]: draft.email?.trim() || null,
      });
      markResolved(key);
      // Cross-resolve: a name + the channel field for this role also satisfies the
      // coordinator cascade directly (it tries principal/secretary/finance_contact regardless
      // of the meeting_coordinator pointer) — don't make the manager re-enter the same info.
      if (school.coordinator) markResolved(`coordinator:${school.school_id}`);
    } catch {
      setSaveError(`שמירת איש הקשר עבור ${school.school_name} נכשלה — נסה שוב.`);
    } finally {
      setSavingKey(null);
    }
  }

  // --- Coordinator card ---
  function coordinatorDraft(school) {
    const key = `coord:${school.school_id}`;
    if (drafts[key]) return drafts[key];
    const contacts = school.coordinator?.contacts || [];
    const withName = contacts.find(c => c.name);
    const preferred = withName?.role || school.coordinator?.meeting_coordinator || COORDINATOR_ROLE_OPTIONS[0].value;
    const existing = contacts.find(c => c.role === preferred);
    return { role: preferred, name: existing?.name || "", phone: existing?.phone || "", email: existing?.email || "" };
  }
  function updateCoordinatorDraft(school, patch) {
    const key = `coord:${school.school_id}`;
    setDrafts(prev => ({ ...prev, [key]: { ...coordinatorDraft(school), ...patch } }));
  }
  function selectCoordinatorRole(school, role) {
    const contacts = school.coordinator?.contacts || [];
    const existing = contacts.find(c => c.role === role);
    const key = `coord:${school.school_id}`;
    setDrafts(prev => ({ ...prev, [key]: { role, name: existing?.name || "", phone: existing?.phone || "", email: existing?.email || "" } }));
  }
  async function handleSaveCoordinator(school) {
    const draft = coordinatorDraft(school);
    if (!isDraftComplete(draft)) return;
    const key = `coordinator:${school.school_id}`;
    setSavingKey(key);
    setSaveError(null);
    try {
      await axios.put(`/schools/${school.school_id}`, {
        name: school.school_name,
        [`${draft.role}_name`]: draft.name.trim(),
        [`${draft.role}_phone`]: draft.phone?.trim() || null,
        [`${draft.role}_email`]: draft.email?.trim() || null,
        meeting_coordinator: draft.role,
      });
      markResolved(key);
      // Cross-resolve the other direction: if this same role was also flagged as a missing
      // meeting participant, this save already fixed it too.
      if (school.participants?.roles?.includes(draft.role)) {
        markResolved(`participant:${school.school_id}:${draft.role}`);
      }
    } catch {
      setSaveError(`שמירת אחראי/ת תיאום הפגישות עבור ${school.school_name} נכשלה — נסה שוב.`);
    } finally {
      setSavingKey(null);
    }
  }

  // --- Meeting-defaults card (advisor / duration, each with "save to card" or "override here only") ---
  function draftValue(key, fallback) { return drafts[key] ?? fallback; }
  function setDraftValue(key, value) { setDrafts(prev => ({ ...prev, [key]: value })); }

  async function handleSaveAdvisorToCard(school, type) {
    const key = `advisor:${school.school_id}:${type}`;
    const advisorId = draftValue(key, "");
    if (!advisorId) return;
    setSavingKey(key);
    setSaveError(null);
    try {
      await axios.post(`/schools/${school.school_id}/advisors/${type}`, { advisor_id: advisorId });
      markResolved(key);
    } catch {
      setSaveError(`שמירת היועץ עבור ${school.school_name} נכשלה — נסה שוב.`);
    } finally {
      setSavingKey(null);
    }
  }
  function handleOverrideAdvisor(school, type) {
    const key = `advisor:${school.school_id}:${type}`;
    const advisorId = draftValue(key, "");
    if (!advisorId) return;
    setMeetingOverrides(prev => ({
      ...prev,
      [school.school_id]: { ...prev[school.school_id], [type]: { ...prev[school.school_id]?.[type], advisor_ids: [advisorId] } },
    }));
    markResolved(key);
  }
  async function handleSaveDurationToCard(school, type) {
    const key = `duration:${school.school_id}:${type}`;
    const minutes = draftValue(key, "");
    if (!minutes) return;
    setSavingKey(key);
    setSaveError(null);
    try {
      await axios.put(`/schools/${school.school_id}/year-admin-data`, { [`meeting_duration_${type}`]: Number(minutes) }, { params: { academic_year: academicYear } });
      markResolved(key);
    } catch {
      setSaveError(`שמירת משך הפגישה עבור ${school.school_name} נכשלה — נסה שוב.`);
    } finally {
      setSavingKey(null);
    }
  }
  function handleOverrideDuration(school, type) {
    const key = `duration:${school.school_id}:${type}`;
    const minutes = draftValue(key, "");
    if (!minutes) return;
    setMeetingOverrides(prev => ({
      ...prev,
      [school.school_id]: { ...prev[school.school_id], [type]: { ...prev[school.school_id]?.[type], duration_minutes: Number(minutes) } },
    }));
    markResolved(key);
  }

  async function handleExport() {
    const rows = [];
    for (const school of remainingSchools) {
      if (school.participants) {
        for (const role of school.participants.roles) {
          if (!resolved(`participant:${school.school_id}:${role}`)) {
            rows.push({ school_id: school.school_id, school_name: school.school_name, symbol: school.symbol, authority: school.authority, kind: "participant", detail: role });
          }
        }
      }
      if (school.coordinator && !resolved(`coordinator:${school.school_id}`)) {
        rows.push({ school_id: school.school_id, school_name: school.school_name, symbol: school.symbol, authority: school.authority, kind: "coordinator" });
      }
      for (const md of school.meeting_defaults || []) {
        if (md.missing_advisor && !resolved(`advisor:${school.school_id}:${md.meeting_service_type}`)) {
          rows.push({ school_id: school.school_id, school_name: school.school_name, symbol: school.symbol, authority: school.authority, kind: "advisor", detail: md.meeting_service_type });
        }
        if (md.missing_duration && !resolved(`duration:${school.school_id}:${md.meeting_service_type}`)) {
          rows.push({ school_id: school.school_id, school_name: school.school_name, symbol: school.symbol, authority: school.authority, kind: "duration", detail: md.meeting_service_type });
        }
      }
    }
    const res = await axios.post("/tasks/meetings/export-missing", { rows }, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = "בתי_ספר_עם_בעיות_תיאום_פגישה.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-resolution-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="meeting-resolution-title" className="font-bold text-slate-800">חסרות הגדרות להשלמת המשימה</h2>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2 text-sm">
          {checking ? (
            <p role="status" className="text-slate-500">בודק...</p>
          ) : !result ? (
            <p role="alert" className="text-red-600">הבדיקה נכשלה — נסה שוב.</p>
          ) : schools.length === 0 ? (
            <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">כל בתי הספר מוכנים ליצירת המשימה ✓</p>
          ) : (
            <>
              <p className="text-slate-600 mb-2">
                {allClear ? (
                  <span className="text-emerald-700">כל הבעיות טופלו או הוסרו — ניתן להמשיך ✓</span>
                ) : (
                  <>לבתי הספר הבאים חסרות הגדרות להשלמת המשימה: <b className="text-slate-800">{remainingSchools.length}</b> נותרו לטיפול.</>
                )}
              </p>

              {schools.map(school => {
                const isRemoved = removedSchoolIds.has(school.school_id);
                const unresolvedCount = schoolUnresolvedCount(school);
                const isClear = isRemoved || unresolvedCount === 0;
                const isExpanded = expandedIds.has(school.school_id);
                let cardCounter = 0;
                return (
                  <div key={school.school_id} className={`border rounded-xl ${isRemoved ? "border-slate-100 bg-slate-50 opacity-60" : isClear ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(school.school_id)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-right"
                      aria-expanded={isExpanded}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <span aria-hidden="true" className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${isClear ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                          {isClear ? "✓" : "✕"}
                        </span>
                        <b className="text-slate-800">{school.school_name}</b>
                        {school.symbol && <bdi className="text-slate-400 text-xs">({school.symbol})</bdi>}
                        {school.authority && <span className="text-slate-400 text-xs">· {school.authority}</span>}
                        {!isClear && !isRemoved && <span className="text-xs text-amber-700">— {unresolvedCount} בעיות</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          role="button" tabIndex={0}
                          onClick={e => { e.stopPropagation(); toggleRemoved(school.school_id); }}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); toggleRemoved(school.school_id); } }}
                          className="text-xs text-slate-400 hover:text-red-600 whitespace-nowrap"
                        >
                          {isRemoved ? "בטל הסרה" : "הסר מהמשימה"}
                        </span>
                      </span>
                    </button>

                    {isExpanded && !isRemoved && (
                      <div className="px-3 pb-3 space-y-2.5">
                        {school.participants && (() => {
                          cardCounter += 1;
                          const n = cardCounter;
                          return (
                            <div className="bg-white rounded-lg border border-amber-100 p-3 space-y-2">
                              <p className="text-xs text-slate-700">
                                <b>בעיה {n}:</b> חסרים פרטי קשר של אנשי קשר שזומנו לפגישה ({school.participants.roles.map(r => roleLabel(school, r)).join(", ")}) — יש למלא שם ו{needsPhone ? "טלפון" : "מייל"} (חובה) לכל אחד:
                              </p>
                              {school.participants.roles.map(role => {
                                const draft = participantDraft(school, role);
                                const key = `participant:${school.school_id}:${role}`;
                                const saving = savingKey === key;
                                const done = resolved(key);
                                if (done) {
                                  return (
                                    <div key={role} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                                      <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                                      <span className="text-xs text-emerald-800">{roleLabel(school, role)}: {draft.name} — טופל</span>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={role} className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-medium text-slate-600 w-20">{roleLabel(school, role)}</span>
                                    <label className="sr-only" htmlFor={`${key}-name`}>שם</label>
                                    <input id={`${key}-name`} placeholder="שם" value={draft.name} onChange={e => updateParticipantDraft(school, role, { name: e.target.value })}
                                      className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-28" />
                                    <label className="sr-only" htmlFor={`${key}-phone`}>טלפון</label>
                                    <input id={`${key}-phone`} placeholder="טלפון" value={draft.phone} onChange={e => updateParticipantDraft(school, role, { phone: e.target.value })}
                                      className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-24" />
                                    <label className="sr-only" htmlFor={`${key}-email`}>מייל</label>
                                    <input id={`${key}-email`} placeholder="מייל" value={draft.email} onChange={e => updateParticipantDraft(school, role, { email: e.target.value })}
                                      className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-36" />
                                    <button type="button" onClick={() => handleSaveParticipant(school, role)} disabled={saving || !isDraftComplete(draft)}
                                      className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                                      {saving ? "שומר..." : "שמור"}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {school.coordinator && (() => {
                          cardCounter += 1;
                          const n = cardCounter;
                          const draft = coordinatorDraft(school);
                          const key = `coordinator:${school.school_id}`;
                          const saving = savingKey === key;
                          const done = resolved(key);
                          if (done) {
                            return (
                              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                                <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                                <span className="text-xs text-emerald-800"><b>בעיה {n}:</b> {COORDINATOR_ROLE_OPTIONS.find(r => r.value === draft.role)?.label} ({draft.name}) — הוגדר/ה כאחראי/ת תיאום פגישות</span>
                              </div>
                            );
                          }
                          return (
                            <div className="bg-white rounded-lg border border-amber-100 p-3 space-y-2">
                              <p className="text-xs text-slate-700">
                                <b>בעיה {n}:</b> נבחרה התקשרות ב{needsPhone ? "וואטסאפ" : "מייל"} אך לבית הספר אין אחראי/ת תיאום פגישות עם {needsPhone ? "טלפון" : "מייל"} תקין — הגדר/י כעת:
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <label className="sr-only" htmlFor={`${key}-role`}>תפקיד</label>
                                <select id={`${key}-role`} value={draft.role} onChange={e => selectCoordinatorRole(school, e.target.value)}
                                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                                  {COORDINATOR_ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                                <label className="sr-only" htmlFor={`${key}-name`}>שם</label>
                                <input id={`${key}-name`} placeholder="שם" value={draft.name} onChange={e => updateCoordinatorDraft(school, { name: e.target.value })}
                                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-28" />
                                <label className="sr-only" htmlFor={`${key}-phone`}>טלפון</label>
                                <input id={`${key}-phone`} placeholder="טלפון" value={draft.phone} onChange={e => updateCoordinatorDraft(school, { phone: e.target.value })}
                                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-24" />
                                <label className="sr-only" htmlFor={`${key}-email`}>מייל</label>
                                <input id={`${key}-email`} placeholder="מייל" value={draft.email} onChange={e => updateCoordinatorDraft(school, { email: e.target.value })}
                                  className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-36" />
                                <button type="button" onClick={() => handleSaveCoordinator(school)} disabled={saving || !isDraftComplete(draft)}
                                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                                  {saving ? "שומר..." : "שמור"}
                                </button>
                              </div>
                            </div>
                          );
                        })()}

                        {(school.meeting_defaults || []).map(md => {
                          cardCounter += 1;
                          const n = cardCounter;
                          const typeLabel = MEETING_SERVICE_TYPE_LABELS[md.meeting_service_type] || md.meeting_service_type;
                          const missingParts = [md.missing_advisor && "יועץ מלווה", md.missing_duration && "זמן פגישה"].filter(Boolean).join(" ו");
                          const advisorKey = `advisor:${school.school_id}:${md.meeting_service_type}`;
                          const durationKey = `duration:${school.school_id}:${md.meeting_service_type}`;
                          const advisorDone = md.missing_advisor && resolved(advisorKey);
                          const durationDone = md.missing_duration && resolved(durationKey);
                          return (
                            <div key={md.meeting_service_type} className="bg-white rounded-lg border border-amber-100 p-3 space-y-2">
                              <p className="text-xs text-slate-700">
                                <b>בעיה {n}:</b> ביקשת לזמן פגישת {typeLabel} המבוססת על {missingParts} — שדות ריקים בכרטיס בית הספר. לכל שדה חסר: השלמה קבועה בכרטיס, או קביעה נקודתית למשימה זו בלבד:
                              </p>
                              {md.missing_advisor && (advisorDone ? (
                                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                                  <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                                  <span className="text-xs text-emerald-800">יועץ מלווה [{typeLabel}] — טופל</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-medium text-slate-600 w-24">יועץ מלווה [{typeLabel}]</span>
                                  <select
                                    value={draftValue(advisorKey, "")}
                                    onChange={e => setDraftValue(advisorKey, e.target.value)}
                                    className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white min-w-[9rem]"
                                  >
                                    <option value="" disabled>בחר יועץ...</option>
                                    {orgUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                                  </select>
                                  <button type="button" onClick={() => handleSaveAdvisorToCard(school, md.meeting_service_type)} disabled={savingKey === advisorKey || !draftValue(advisorKey, "")}
                                    className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                                    {savingKey === advisorKey ? "שומר..." : "שמור בכרטיס בית הספר"}
                                  </button>
                                  <button type="button" onClick={() => handleOverrideAdvisor(school, md.meeting_service_type)} disabled={!draftValue(advisorKey, "")}
                                    className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                                    קבע יועץ לפגישה זו בלבד
                                  </button>
                                </div>
                              ))}
                              {md.missing_duration && (durationDone ? (
                                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                                  <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                                  <span className="text-xs text-emerald-800">זמן פגישה [{typeLabel}] — טופל</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-medium text-slate-600 w-24">זמן פגישה [{typeLabel}]</span>
                                  <select
                                    value={draftValue(durationKey, "")}
                                    onChange={e => setDraftValue(durationKey, e.target.value)}
                                    className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white"
                                  >
                                    <option value="" disabled>בחר משך...</option>
                                    {DURATION_OPTIONS.map(m => <option key={m} value={m}>{formatDuration(m)}</option>)}
                                  </select>
                                  <button type="button" onClick={() => handleSaveDurationToCard(school, md.meeting_service_type)} disabled={savingKey === durationKey || !draftValue(durationKey, "")}
                                    className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                                    {savingKey === durationKey ? "שומר..." : "שמור בכרטיס בית הספר"}
                                  </button>
                                  <button type="button" onClick={() => handleOverrideDuration(school, md.meeting_service_type)} disabled={!draftValue(durationKey, "")}
                                    className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                                    קבע משך לפגישה זו בלבד
                                  </button>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {saveError && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 flex-wrap">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">
            ביטול
          </button>
          <div className="flex items-center gap-2">
            {remainingSchools.length > 0 && (
              <button type="button" onClick={handleExport} className="text-sm px-4 py-2 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">
                ייצוא לאקסל
              </button>
            )}
            <div className="flex flex-col items-end gap-1">
              {!checking && result && remainingSchools.length > 0 && (
                <span className="text-xs text-slate-500">יש להשלים את כל הבעיות או להסיר את בתי הספר הבעייתיים כדי להמשיך</span>
              )}
              <button
                type="button"
                onClick={() => onProceed(Array.from(removedSchoolIds), meetingOverrides)}
                disabled={checking || remainingSchools.length > 0}
                className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                צור משימה
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
