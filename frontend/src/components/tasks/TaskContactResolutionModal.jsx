import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { RECIPIENT_ROLE_OPTIONS } from "./taskShared";

const ROLE_OPTIONS = [
  { value: "principal", label: "מנהל/ת" },
  { value: "secretary", label: "מנהלנ/ית" },
  { value: "finance_contact", label: "אחראי/ת כספים" },
];

// Round-2 redesign, simplified after the manager found it too text-heavy and generic — shown
// before task creation when POST /tasks/contacts/check finds schools with no resolvable
// contact for the chosen channel/recipient_role. Distinct from the lighter-weight
// TaskMissingContactModal.jsx (which stays as the post-creation, single-school inline fix-it
// tool). Per-school editor (mirrors TaskMeetingResolutionModal.jsx's row pattern): shows that
// school's *existing* contacts (principal/secretary/finance_contact — often a name is already
// on file, just missing the email/phone the chosen channel needs) so the manager can complete
// one instead of guessing, or add a brand-new one if the school truly has none. When the task's
// recipient is "אחראי/ת לתיאום פגישות" (an indirection, not a fixed field), saving also sets
// that school's meeting_coordinator to the picked role — the "who to notify" reference lives in
// "פרטי בית הספר", so fixing it here keeps it fixed for next time too, not just this task.
export default function TaskContactResolutionModal({
  criteria, manualSchoolIds, recipientRole, onChangeRecipientRole, channel, isMeetingTask,
  academicYear, onProceed, onClose,
}) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState(null); // {schools, missing_count}
  const [resolvedIds, setResolvedIds] = useState(new Set());
  const [removedIds, setRemovedIds] = useState(new Set());
  const [drafts, setDrafts] = useState({}); // school_id -> {role, name, phone, email}
  const [savingId, setSavingId] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [showRoleSwitch, setShowRoleSwitch] = useState(false);
  const [uploading, setUploading] = useState(false);

  const needsPhone = channel === "whatsapp_twilio";
  // A contact only really resolves the channel's requirement once it has a name AND the field
  // that channel needs — matches /tasks/contacts/check's own criterion (_channel_missing_contact).
  function isDraftComplete(draft) {
    return !!draft.name?.trim() && !!(needsPhone ? draft.phone?.trim() : draft.email?.trim());
  }

  function runCheck() {
    setChecking(true);
    axios.post("/tasks/contacts/check", {
      criteria, manual_school_ids: manualSchoolIds, recipient_role: recipientRole,
      channel, is_meeting_task: isMeetingTask, academic_year: academicYear,
    })
      .then(r => setResult(r.data))
      .catch(() => setResult(null))
      .finally(() => setChecking(false));
  }

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientRole]);

  const missing = (result?.schools || []).filter(s => !s.has_contact && !resolvedIds.has(s.school_id) && !removedIds.has(s.school_id));

  function draftFor(school) {
    if (drafts[school.school_id]) return drafts[school.school_id];
    // Default to a role that already has a name on file (most common case — just missing the
    // channel-specific field), otherwise the school's own meeting_coordinator pointer, otherwise
    // the first role in the list.
    const withName = (school.contacts || []).find(c => c.name);
    const preferred = withName?.role || school.meeting_coordinator || ROLE_OPTIONS[0].value;
    const existing = (school.contacts || []).find(c => c.role === preferred);
    return { role: preferred, name: existing?.name || "", phone: existing?.phone || "", email: existing?.email || "" };
  }
  function updateDraft(school, patch) {
    setDrafts(prev => ({ ...prev, [school.school_id]: { ...draftFor(school), ...patch } }));
  }
  function selectRole(school, role) {
    const existing = (school.contacts || []).find(c => c.role === role);
    setDrafts(prev => ({ ...prev, [school.school_id]: { role, name: existing?.name || "", phone: existing?.phone || "", email: existing?.email || "" } }));
  }

  async function handleSave(school) {
    const draft = draftFor(school);
    if (!isDraftComplete(draft)) return;
    const fields = { name: `${draft.role}_name`, phone: `${draft.role}_phone`, email: `${draft.role}_email` };
    setSavingId(school.school_id);
    setSaveError(null);
    try {
      const body = {
        name: school.school_name,
        [fields.name]: draft.name.trim(),
        [fields.phone]: draft.phone?.trim() || null,
        [fields.email]: draft.email?.trim() || null,
      };
      if (recipientRole === "meeting_coordinator") body.meeting_coordinator = draft.role;
      await axios.put(`/schools/${school.school_id}`, body);
      setResolvedIds(prev => new Set(prev).add(school.school_id));
    } catch {
      setSaveError(`שמירת איש הקשר עבור ${school.school_name} נכשלה — נסה שוב.`);
    } finally {
      setSavingId(null);
    }
  }

  function toggleRemoved(schoolId) {
    setRemovedIds(prev => {
      const next = new Set(prev);
      next.has(schoolId) ? next.delete(schoolId) : next.add(schoolId);
      return next;
    });
  }

  async function handleExport() {
    const res = await axios.post("/tasks/contacts/export-missing", { school_ids: missing.map(s => s.school_id) }, { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = "בתי_ספר_חסרי_פרטי_קשר.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setSaveError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await axios.post("/tasks/contacts/import", form);
      runCheck();
    } catch {
      setSaveError("העלאת הקובץ נכשלה — נסה שוב.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const roleLabel = RECIPIENT_ROLE_OPTIONS.find(r => r.value === recipientRole)?.label || recipientRole;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-resolution-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="contact-resolution-title" className="font-bold text-slate-800">חסרים פרטי קשר לחלק מבתי הספר</h2>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3 text-sm">
          {checking ? (
            <p role="status" className="text-slate-500">בודק פרטי קשר...</p>
          ) : !result ? (
            <p role="alert" className="text-red-600">הבדיקה נכשלה — נסה שוב.</p>
          ) : missing.length === 0 ? (
            <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">כל בתי הספר כוללים כעת פרטי קשר תקינים ✓</p>
          ) : (
            <>
              <p className="text-slate-600">
                <b className="text-slate-800">{missing.length}</b> בתי ספר חסרים איש קשר בתפקיד "{roleLabel}". אפשר לעבור עליהם בנחת — כל שורה נפתרת בנפרד.
              </p>

              <button type="button" onClick={() => setShowRoleSwitch(v => !v)} className="text-xs text-blue-600 hover:underline">
                {showRoleSwitch ? "סגור" : "נסה תפקיד ברירת מחדל אחר לכל המשימה"}
              </button>
              {showRoleSwitch && (
                <select
                  value={recipientRole}
                  onChange={e => onChangeRecipientRole(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
                >
                  {RECIPIENT_ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              )}

              <div className="space-y-2">
                {missing.map(school => {
                  const draft = draftFor(school);
                  const saving = savingId === school.school_id;
                  return (
                    <div key={school.school_id} className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm">
                          <b className="text-slate-800">{school.school_name}</b>{" "}
                          {school.symbol && <bdi className="text-slate-400 text-xs">({school.symbol})</bdi>}
                          {school.authority && <span className="text-slate-400 text-xs"> · {school.authority}</span>}
                        </span>
                        <button type="button" onClick={() => toggleRemoved(school.school_id)} className="text-xs text-slate-400 hover:text-red-600 whitespace-nowrap">
                          הסר מהמשימה
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <label className="sr-only" htmlFor={`${school.school_id}-role`}>תפקיד</label>
                        <select
                          id={`${school.school_id}-role`}
                          value={draft.role}
                          onChange={e => selectRole(school, e.target.value)}
                          className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white"
                        >
                          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <label className="sr-only" htmlFor={`${school.school_id}-name`}>שם</label>
                        <input id={`${school.school_id}-name`} placeholder="שם" value={draft.name} onChange={e => updateDraft(school, { name: e.target.value })}
                          className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-28" />
                        <label className="sr-only" htmlFor={`${school.school_id}-phone`}>טלפון</label>
                        <input id={`${school.school_id}-phone`} placeholder="טלפון" value={draft.phone} onChange={e => updateDraft(school, { phone: e.target.value })}
                          className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-24" />
                        <label className="sr-only" htmlFor={`${school.school_id}-email`}>מייל</label>
                        <input id={`${school.school_id}-email`} placeholder="מייל" value={draft.email} onChange={e => updateDraft(school, { email: e.target.value })}
                          className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 w-36" />
                        <button type="button" onClick={() => handleSave(school)} disabled={saving || !isDraftComplete(draft)}
                          className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                          {saving ? "שומר..." : "שמור"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {saveError && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 flex-wrap">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">
            ביטול
          </button>
          <div className="flex items-center gap-2">
            {missing.length > 0 && (
              <>
                <button type="button" onClick={handleExport} className="text-sm px-4 py-2 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">
                  ייצוא לאקסל
                </button>
                <label htmlFor="contact-import-input" className="text-sm px-4 py-2 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer">
                  {uploading ? "מעלה..." : "העלה קובץ מעודכן"}
                </label>
                <input id="contact-import-input" type="file" accept=".xlsx,.xls" onChange={handleImport} disabled={uploading} className="sr-only" />
              </>
            )}
            <button
              type="button"
              onClick={onProceed}
              disabled={checking}
              className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {missing.length > 0 ? "צור משימה רק לבתי הספר שיש להם פרטי קשר" : "צור משימה"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
