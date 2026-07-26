import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  RECIPIENT_ROLE_OPTIONS, CHANNEL_OPTIONS, describeCondition,
} from "./taskShared";

const EMPTY_MEETING_CONDITION = { type: "meeting", meeting_service_type: "", date_from: "", date_to: "", negate: false };
const MEETING_SERVICE_TYPE_LABELS = { gefen: "גפן", current: "שוטף", gefen_current: "גפן+שוטף" };
const EMPTY_FIELD_CONDITION = { type: "field", field: "", op: "eq", value: "" };

function newGroup() {
  return { conditions: [{ ...EMPTY_MEETING_CONDITION }] };
}

// Built-in starting point for the common "missing meeting" task pattern — auto-suggested
// (never forced) when step 3 opens with an empty subject/body and the criteria look like a
// "אין פגישה" scenario. {booking_link} is filled server-side per school at send time (see
// tasks_router._build_booking_link), reusing the same unique-scheduling-link machinery the
// existing "סוכן ניהול" AI agent already sends.
const BUILT_IN_TEMPLATE = {
  id: "__builtin_booking",
  name: "ברירת מחדל — קביעת פגישות",
  subject: "קביעת פגישה - {school_name}",
  body_template: "שלום,\n\nלבית הספר {school_name} טרם נקבעה פגישה. נשמח שתקבעו מועד בקישור הבא:\n{booking_link}\n\nתודה!",
};

// 4-step modal: name -> AND/OR criteria builder -> message config -> review+create.
// useFocusTrap + role="dialog" per CLAUDE.md accessibility checklist.
export default function TaskCreateWizard({ onClose, onCreated }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [scheduledFor, setScheduledFor] = useState(""); // datetime-local string, empty = evaluate now
  const [groups, setGroups] = useState([newGroup()]);
  const [fieldOptions, setFieldOptions] = useState([]);
  const [meetingTypes, setMeetingTypes] = useState([]);
  const [channelAvailability, setChannelAvailability] = useState({ email_outlook: false, whatsapp_twilio: false });
  const [recipientRole, setRecipientRole] = useState("meeting_coordinator");
  const [channel, setChannel] = useState("email_resend");
  const [subject, setSubject] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [attachments, setAttachments] = useState([]); // [{storage_key, filename}]
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null); // {count, schools}
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    axios.get("/tasks/field-options").then(r => {
      setFieldOptions(r.data?.fields || []);
      setMeetingTypes(r.data?.meeting_types || []);
    }).catch(() => {});
    axios.get("/tasks/channel-availability").then(r => {
      setChannelAvailability({
        email_outlook: !!r.data?.email_outlook,
        whatsapp_twilio: !!r.data?.whatsapp_twilio,
      });
    }).catch(() => {});
    axios.get("/tasks/templates").then(r => setTemplates(r.data || [])).catch(() => {});
  }, []);

  const looksLikeMissingMeetingTask = groups.some(g =>
    g.conditions.some(c => c.type === "meeting" && c.negate)
  );

  // Auto-suggest (never overwrite) the built-in template the first time step 3 is reached
  // with an empty subject/body, when the criteria match the common "missing meeting" shape.
  useEffect(() => {
    if (step === 3 && looksLikeMissingMeetingTask && !subject && !bodyTemplate) {
      setSubject(BUILT_IN_TEMPLATE.subject);
      setBodyTemplate(BUILT_IN_TEMPLATE.body_template);
      setSelectedTemplateId(BUILT_IN_TEMPLATE.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function applyTemplate(templateId) {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tpl = templateId === BUILT_IN_TEMPLATE.id
      ? BUILT_IN_TEMPLATE
      : templates.find(t => t.id === templateId);
    if (tpl) {
      setSubject(tpl.subject || "");
      setBodyTemplate(tpl.body_template || "");
    }
  }

  async function handleSaveTemplate() {
    if (!newTemplateName.trim()) return;
    setSavingTemplate(true);
    try {
      const res = await axios.post("/tasks/templates", {
        name: newTemplateName.trim(), subject, body_template: bodyTemplate,
      });
      setTemplates(prev => [res.data, ...prev]);
      setSelectedTemplateId(res.data.id);
      setShowSaveTemplate(false);
      setNewTemplateName("");
    } catch {
      setError("שמירת התבנית נכשלה — נסה שוב.");
    } finally {
      setSavingTemplate(false);
    }
  }

  const criteria = { groups };

  useEffect(() => {
    if (step !== 2) return;
    const hasAnyCondition = groups.some(g => g.conditions.length > 0);
    if (!hasAnyCondition) { setPreview(null); return; }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      axios.post("/tasks/preview", { criteria })
        .then(r => setPreview(r.data))
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(groups), step]);

  function updateCondition(gi, ci, patch) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : {
      ...g, conditions: g.conditions.map((c, j) => j !== ci ? c : { ...c, ...patch }),
    }));
  }
  function setConditionType(gi, ci, type) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : {
      ...g, conditions: g.conditions.map((c, j) => j !== ci ? c : (type === "meeting" ? { ...EMPTY_MEETING_CONDITION } : { ...EMPTY_FIELD_CONDITION })),
    }));
  }
  function addCondition(gi) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : { ...g, conditions: [...g.conditions, { ...EMPTY_MEETING_CONDITION }] }));
  }
  function removeCondition(gi, ci) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : { ...g, conditions: g.conditions.filter((_, j) => j !== ci) }));
  }
  function addGroup() {
    setGroups(prev => [...prev, newGroup()]);
  }
  function removeGroup(gi) {
    setGroups(prev => prev.filter((_, i) => i !== gi));
  }

  async function handleAttachmentUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // Attachments are uploaded per-task server-side; since the task doesn't exist yet at
      // step 3, we defer the actual upload call to right after creation (see handleSubmit).
      setAttachments(prev => [...prev, { pendingFile: file, filename: file.name }]);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await axios.post("/tasks/", {
        name,
        criteria,
        message_config: {
          recipient_role: recipientRole,
          channel,
          subject,
          body_template: bodyTemplate,
          attachment_keys: [],
        },
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      });
      const task = res.data;

      if (attachments.length) {
        const keys = [];
        for (const a of attachments) {
          const form = new FormData();
          form.append("file", a.pendingFile);
          const up = await axios.post(`/tasks/${task.id}/attachments`, form);
          keys.push(up.data.storage_key);
        }
        await axios.patch(`/tasks/${task.id}`, {
          message_config: { recipient_role: recipientRole, channel, subject, body_template: bodyTemplate, attachment_keys: keys },
        });
      }

      onCreated(task.id);
    } catch {
      setError("יצירת המשימה נכשלה — נסה שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  const canNextFrom1 = name.trim().length > 0;
  const canNextFrom2 = groups.some(g => g.conditions.length > 0);
  const canNextFrom3 = recipientRole && channel && bodyTemplate.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-wizard-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="task-wizard-title" className="font-bold text-black">יצירת משימה — שלב {step} מתוך 4</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="task-name" className="block text-sm font-medium text-slate-700 mb-1.5">שם המשימה</label>
                <input
                  id="task-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder='למשל: "קביעת פגישות גפן — רבעון 1"'
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label htmlFor="task-scheduled-for" className="block text-sm font-medium text-slate-700 mb-1.5">
                  תזמון בדיקת הקריטריונים (אופציונלי)
                </label>
                <input
                  id="task-scheduled-for"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={e => setScheduledFor(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
                />
                <p className="text-xs text-slate-400 mt-1">
                  אם לא נבחר תאריך — רשימת בתי הספר תיקבע מיד עם יצירת המשימה, לפי המצב הנוכחי. אם נבחר תאריך עתידי — המשימה תיווצר במצב "מתוזמן" ורשימת בתי הספר תיקבע אוטומטית רק בתאריך שנבחר, לפי מי שיעמוד בקריטריונים אז (לדוגמה: להגדיר כבר עכשיו משימה לרבעון הבא).
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {groups.map((group, gi) => (
                <div key={gi}>
                  {gi > 0 && (
                    <div className="text-center text-xs font-bold text-blue-600 my-2">— או —</div>
                  )}
                  <div className="border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">קבוצת תנאים (וגם ביניהם)</span>
                      {groups.length > 1 && (
                        <button onClick={() => removeGroup(gi)} className="text-xs text-red-600 hover:bg-red-50 rounded px-2 py-0.5">
                          הסר קבוצה
                        </button>
                      )}
                    </div>
                    {group.conditions.map((cond, ci) => (
                      <div key={ci} className="border border-slate-100 rounded-lg p-2.5 bg-slate-50 space-y-2">
                        <div className="flex items-center gap-2">
                          <select
                            aria-label="סוג תנאי"
                            value={cond.type}
                            onChange={e => setConditionType(gi, ci, e.target.value)}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
                          >
                            <option value="meeting">פגישה</option>
                            <option value="field">שדה בית ספר</option>
                          </select>
                          {group.conditions.length > 1 && (
                            <button onClick={() => removeCondition(gi, ci)} aria-label="הסר תנאי" className="text-slate-400 hover:text-red-600 mr-auto">
                              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {cond.type === "meeting" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-slate-500">
                              קיימת/אין
                              <select value={cond.negate ? "no" : "yes"} onChange={e => updateCondition(gi, ci, { negate: e.target.value === "no" })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                <option value="yes">יש פגישה</option>
                                <option value="no">אין פגישה</option>
                              </select>
                            </label>
                            <label className="text-xs text-slate-500">
                              סוג פגישה
                              <select value={cond.meeting_service_type} onChange={e => updateCondition(gi, ci, { meeting_service_type: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                <option value="">כל סוג</option>
                                {(meetingTypes || []).map(mt => <option key={mt} value={mt}>{MEETING_SERVICE_TYPE_LABELS[mt] || mt}</option>)}
                              </select>
                            </label>
                            <label className="text-xs text-slate-500">
                              מתאריך
                              <input type="date" value={cond.date_from} onChange={e => updateCondition(gi, ci, { date_from: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                            </label>
                            <label className="text-xs text-slate-500">
                              עד תאריך
                              <input type="date" value={cond.date_to} onChange={e => updateCondition(gi, ci, { date_to: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                            </label>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            <label className="text-xs text-slate-500 col-span-1">
                              שדה
                              <select value={cond.field} onChange={e => updateCondition(gi, ci, { field: e.target.value, value: "" })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                <option value="">בחר שדה</option>
                                {(fieldOptions || []).map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                              </select>
                            </label>
                            <label className="text-xs text-slate-500 col-span-1">
                              יחס
                              <select value={cond.op} onChange={e => updateCondition(gi, ci, { op: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                <option value="eq">=</option>
                                <option value="ne">≠</option>
                                <option value="gt">&gt;</option>
                                <option value="gte">≥</option>
                                <option value="lt">&lt;</option>
                                <option value="lte">≤</option>
                                <option value="contains">מכיל</option>
                              </select>
                            </label>
                            <label className="text-xs text-slate-500 col-span-1">
                              ערך
                              {(() => {
                                const opt = (fieldOptions || []).find(f => f.field === cond.field);
                                if (opt?.options) {
                                  return (
                                    <select value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                      className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                      <option value="">בחר</option>
                                      {opt.options.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  );
                                }
                                return (
                                  <input value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                    className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                                );
                              })()}
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                    <button onClick={() => addCondition(gi)} className="text-xs text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1">
                      + הוסף תנאי (וגם)
                    </button>
                  </div>
                </div>
              ))}
              <button onClick={addGroup} className="text-xs text-blue-700 hover:bg-blue-50 rounded-lg px-3 py-1.5 border border-blue-200">
                + הוסף קבוצת "או"
              </button>

              <div role="status" className="text-sm bg-slate-50 rounded-lg px-3 py-2 mt-2">
                {previewLoading ? "בודק כמות בתי ספר תואמים..." : preview ? (
                  <span>נמצאו <b>{preview.count}</b> בתי ספר תואמים לקריטריון.</span>
                ) : "הגדר תנאי לפחות אחד כדי לראות תצוגה מקדימה."}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700 mb-1.5 block">נמען</span>
                <select value={recipientRole} onChange={e => setRecipientRole(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  {RECIPIENT_ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 mb-1.5 block">ערוץ שליחה</span>
                <select value={channel} onChange={e => setChannel(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  {CHANNEL_OPTIONS.map(c => {
                    const disabled = (c.value === "email_outlook" && !channelAvailability.email_outlook)
                      || (c.value === "whatsapp_twilio" && !channelAvailability.whatsapp_twilio);
                    return <option key={c.value} value={c.value} disabled={disabled}>{c.label}{disabled ? " (לא מחובר)" : ""}</option>;
                  })}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 mb-1.5 block">תבנית הודעה</span>
                <select value={selectedTemplateId} onChange={e => applyTemplate(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
                  <option value="">בחר תבנית (אופציונלי)...</option>
                  <option value={BUILT_IN_TEMPLATE.id}>{BUILT_IN_TEMPLATE.name}</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 mb-1.5 block">נושא (למייל)</span>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700 mb-1.5 block">
                  תוכן ההודעה — ניתן להשתמש ב-{"{school_name}"}{groups.some(g => g.conditions.some(c => c.type === "meeting")) ? ` וב-{"{booking_link}"}` : ""}
                </span>
                <textarea value={bodyTemplate} onChange={e => setBodyTemplate(e.target.value)} rows={5}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
              </label>

              {showSaveTemplate ? (
                <div className="flex items-center gap-2">
                  <label htmlFor="new-template-name" className="sr-only">שם התבנית</label>
                  <input
                    id="new-template-name"
                    value={newTemplateName}
                    onChange={e => setNewTemplateName(e.target.value)}
                    placeholder="שם התבנית לשמירה"
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5"
                  />
                  <button onClick={handleSaveTemplate} disabled={savingTemplate || !newTemplateName.trim()}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap">
                    {savingTemplate ? "שומר..." : "שמור"}
                  </button>
                  <button onClick={() => setShowSaveTemplate(false)} className="text-xs text-slate-500 hover:underline whitespace-nowrap">
                    ביטול
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveTemplate(true)}
                  disabled={!bodyTemplate.trim()}
                  className="text-xs text-blue-700 hover:bg-blue-50 rounded-lg px-2 py-1 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  + שמור כתבנית חדשה לשימוש עתידי
                </button>
              )}

              <div>
                <span className="text-sm font-medium text-slate-700 mb-1.5 block">קבצים מצורפים</span>
                <label
                  htmlFor="task-attachment-input"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer w-fit"
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  {uploading ? "מעלה..." : "צירוף קובץ"}
                </label>
                <input id="task-attachment-input" type="file" onChange={handleAttachmentUpload} disabled={uploading}
                  aria-label="הוספת קובץ מצורף" className="sr-only" />
                <ul className="mt-1.5 space-y-1">
                  {attachments.map((a, i) => (
                    <li key={i} className="text-xs text-slate-500 flex items-center gap-2">
                      {a.filename}
                      <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-red-500 hover:underline">הסר</button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-sm">
              <div><span className="font-semibold text-slate-700">שם המשימה: </span>{name}</div>
              <div>
                <span className="font-semibold text-slate-700">תזמון: </span>
                {scheduledFor
                  ? `רשימת בתי הספר תיקבע אוטומטית ב-${new Date(scheduledFor).toLocaleString("he-IL")}`
                  : "רשימת בתי הספר נקבעת מיד עם היצירה"}
              </div>
              <div>
                <span className="font-semibold text-slate-700 block mb-1">תנאים:</span>
                <ul className="list-disc pr-5 space-y-0.5 text-slate-600">
                  {groups.map((g, gi) => (
                    <li key={gi}>
                      {gi > 0 && <span className="font-bold text-blue-600">או: </span>}
                      {g.conditions.map(describeCondition).join(" וגם ")}
                    </li>
                  ))}
                </ul>
              </div>
              <div>נמען: {RECIPIENT_ROLE_OPTIONS.find(r => r.value === recipientRole)?.label}</div>
              <div>ערוץ: {CHANNEL_OPTIONS.find(c => c.value === channel)?.label}</div>
              <div>
                בתי ספר התואמים {scheduledFor ? "את המצב הנוכחי (להערכה בלבד — ייבדק מחדש במועד התזמון)" : "כרגע"}: <b>{preview?.count ?? "—"}</b>
              </div>
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            הקודם
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={(step === 1 && !canNextFrom1) || (step === 2 && !canNextFrom2) || (step === 3 && !canNextFrom3)}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              הבא
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "יוצר משימה..." : "יצירת המשימה"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
