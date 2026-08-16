import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import TaskDateTimeInput from "./TaskDateTimeInput";
import ConditionGroupsEditor, { newConditionGroup, isMeetingRequirementComplete } from "./ConditionGroupsEditor";
import OutlookLimitModal from "./OutlookLimitModal";
import TaskContactResolutionModal from "./TaskContactResolutionModal";
import TaskMeetingResolutionModal from "./TaskMeetingResolutionModal";
import SavedAudiencesModal from "./SavedAudiencesModal";
import { SchoolMultiPickerModal } from "../meetings/SchoolPickerCell";
import {
  RECIPIENT_ROLE_OPTIONS, CHANNEL_OPTIONS, describeCondition,
} from "./taskShared";

// Built-in starting point for the common "missing meeting" task pattern — auto-suggested
// (never forced) when the message step opens with an empty subject/body and the task looks
// like a "אין פגישה" scenario. {booking_link} is filled server-side per school at send time
// (see tasks_router._build_booking_link), reusing the same unique-scheduling-link machinery
// the existing "סוכן ניהול" AI agent already sends.
const BUILT_IN_TEMPLATE = {
  id: "__builtin_booking",
  name: "ברירת מחדל — קביעת פגישות",
  subject: "קביעת פגישה - {school_name}",
  body_template: "שלום,\n\nלבית הספר {school_name} טרם נקבעה פגישה. נשמח שתקבעו מועד בקישור הבא:\n{booking_link}\n\nתודה!",
};

// Round-12 — for the dedicated "קביעת פגישות" task track specifically (structured meeting
// requirements, not just a negated meeting filter), the default text matches exactly what
// _queue_messages_for_schools actually renders (see backend/routers/tasks_router.py):
// {meetings_list} is substituted server-side with the same per-range date/duration/participants
// block "תיאום ישיר" already sends. Editing this text is no longer silently discarded — every
// word here is genuinely what gets sent.
const MEETING_TASK_BUILT_IN_TEMPLATE = {
  id: "__builtin_meeting_task",
  name: "ברירת מחדל — קביעת פגישות",
  subject: "קביעת פגישה - {school_name}",
  body_template: "היי {recipient_name},\n\nלבית הספר {school_name} מבוקש לתאם עם {advisor_names} את הפגישות הבאות. נשמח שתקבעי מועד לכל אחת מהן בקישור המצורף — תוכלי לבחור זמן פנוי ביומן ישירות:\n\n{meetings_list}\n\n{booking_link}\n\nתודה!",
};

// Round-2 redesign: two parallel wizard tracks sharing the message-config/review steps.
// "קביעת פגישות" (isMeetingTask) — 4 steps, success is always "a meeting got booked", no
// separate success-definition step. "תקשורת כללית" — 5 steps, adds the "מה נחשב הצלחה?" step
// since success can't always be auto-derived from the audience filter (see plan's two
// motivating examples — a plain "send to whoever already has a meeting" broadcast where
// success is just the send itself, vs. a filtered audience whose success condition is
// unrelated to the filter). useFocusTrap + role="dialog" per CLAUDE.md accessibility checklist.
export default function TaskCreateWizard({ isMeetingTask, onClose, onCreated }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const PHASES = isMeetingTask
    ? ["meeting_audience", "message", "review"]
    : ["basics", "audience", "success", "message", "review"];
  const [step, setStep] = useState(1);
  const phase = PHASES[step - 1];

  const [name, setName] = useState("");
  const [scheduledFor, setScheduledFor] = useState(""); // datetime-local string, empty = evaluate now
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Meeting-path audience state — pre-filled with "סטטוס לקוח = פעיל" since the vast majority
  // of meeting-scheduling tasks target active clients; the manager can still change/remove it.
  const [audienceMode, setAudienceMode] = useState("filter"); // "filter" | "manual"
  const [fieldGroups, setFieldGroups] = useState([
    { conditions: [{ type: "field", field: "client_status", op: "eq", value: "active" }] },
  ]);
  const [manualSchoolIds, setManualSchoolIds] = useState([]);
  const [showSchoolPicker, setShowSchoolPicker] = useState(false);
  // A meeting task can require SEVERAL distinct meetings, each with its own conditions (e.g.
  // "needs a גפן meeting AND a שוטף meeting") — same {groups:[{conditions:[...]}]} shape
  // ConditionGroupsEditor already expects, constrained to a single implied AND group
  // (hideGroupChrome) since all listed meetings are mandatory, not alternatives.
  const [meetingRequirementGroups, setMeetingRequirementGroups] = useState([newConditionGroup(["meeting"])]);
  // Set once the manager tries to leave this step with an incomplete "פגישה" card — reveals
  // the inline alert + red-bordered fields in ConditionGroupsEditor.
  const [meetingReqAttempted, setMeetingReqAttempted] = useState(false);

  // General-path audience + success state
  const [groups, setGroups] = useState([newConditionGroup()]);
  const [audiences, setAudiences] = useState([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState("");
  const [showSaveAudience, setShowSaveAudience] = useState(false);
  const [newAudienceName, setNewAudienceName] = useState("");
  const [savingAudience, setSavingAudience] = useState(false);
  const [audienceSaveError, setAudienceSaveError] = useState(null);
  // The saved-audience picker lives in one shared modal (not per-phase inline) — when opened
  // from either the meeting-path field filter or the general audience step, this remembers
  // which state setter/"blank" value that phase's picker instance was opened from.
  const [showSavedAudiencesModal, setShowSavedAudiencesModal] = useState(false);
  const [audienceModalTarget, setAudienceModalTarget] = useState(null); // {setTargetGroups, emptyGroups}
  // Set by "ערוך" in the saved-audiences modal — while set, the save widget PATCHes this
  // audience instead of creating a new one.
  const [editingAudienceId, setEditingAudienceId] = useState(null);
  const [successMode, setSuccessMode] = useState("auto"); // "auto" | "custom" | "none"
  const [successGroups, setSuccessGroups] = useState([newConditionGroup()]);
  const [derivedSuccess, setDerivedSuccess] = useState(null); // {success_criteria, invertible}
  const [derivingSuccess, setDerivingSuccess] = useState(false);

  // Shared: field/meeting-type options, channel, message config
  const [fieldOptions, setFieldOptions] = useState([]);
  // goal/control_letter conditions need extra pickers (division/budget/goal) beyond the plain
  // field list — see ConditionGroupsEditor's "goal"/"control_letter" render branches.
  const [goalOptions, setGoalOptions] = useState([]);
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [budgetNameOptions, setBudgetNameOptions] = useState([]);
  const [controlLetterFields, setControlLetterFields] = useState([]);
  const [goalValueOptions, setGoalValueOptions] = useState([]);
  const [meetingTypes, setMeetingTypes] = useState([]);
  // Full school list — used only to build autocomplete suggestions for free-text field
  // conditions (ConditionGroupsEditor's TypeaheadValueInput), same source DashboardPage's own
  // filters already use (GET /schools/, role-scoped).
  const [allSchools, setAllSchools] = useState([]);
  const [channelAvailability, setChannelAvailability] = useState({ email_outlook: false, whatsapp_twilio: false });
  const [recipientRole, setRecipientRole] = useState("meeting_coordinator");
  const [channel, setChannel] = useState("email_resend");
  const [subject, setSubject] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [attachments, setAttachments] = useState([]); // [{storageKey, filename}] — already uploaded, see handleAttachmentUpload
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Preview + creation flow
  const [preview, setPreview] = useState(null); // {count, schools}
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreviewList, setShowPreviewList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [switchingChannel, setSwitchingChannel] = useState(false);
  const [checkingContacts, setCheckingContacts] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [outlookLimitWarning, setOutlookLimitWarning] = useState(null);
  const [error, setError] = useState(null);

  // Round-5: "אילו פגישות צריך לקבוע?" pre-creation check (missing advisor/participant) — runs
  // after the contact-resolution flow, before the actual POST /tasks/.
  const [orgUsers, setOrgUsers] = useState([]);
  const [checkingMeetings, setCheckingMeetings] = useState(false);
  const [showMeetingResolutionModal, setShowMeetingResolutionModal] = useState(false);
  const [excludedSchoolIds, setExcludedSchoolIds] = useState([]);
  const [meetingOverrides, setMeetingOverrides] = useState(null);

  useEffect(() => {
    axios.get("/tasks/field-options").then(r => {
      setFieldOptions(r.data?.fields || []);
      setMeetingTypes(r.data?.meeting_types || []);
      setGoalOptions(r.data?.goal_options || []);
      setDivisionOptions(r.data?.division_options || []);
      setBudgetNameOptions(r.data?.budget_name_options || []);
      setControlLetterFields(r.data?.control_letter_fields || []);
      setGoalValueOptions(r.data?.goal_value_options || []);
    }).catch(() => {});
    // Round 13 — one retry here specifically (unlike the other best-effort fetches on this page):
    // a transient failure otherwise silently leaves both channels stuck at their "not connected"
    // default for the whole lifetime of this wizard instance, misleading the manager into
    // thinking a genuinely connected channel (e.g. Outlook) is unavailable.
    axios.get("/tasks/channel-availability")
      .catch(() => axios.get("/tasks/channel-availability"))
      .then(r => {
        setChannelAvailability({
          email_outlook: !!r.data?.email_outlook,
          whatsapp_twilio: !!r.data?.whatsapp_twilio,
        });
      }).catch(() => {});
    axios.get("/tasks/templates").then(r => setTemplates(r.data || [])).catch(() => {});
    axios.get("/schools/").then(r => setAllSchools(r.data || [])).catch(() => {});
    axios.get("/schools/users/all").then(r => setOrgUsers(r.data || [])).catch(() => {});
    axios.get("/tasks/audiences").then(r => setAudiences(r.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function audiencePayload() {
    if (isMeetingTask) {
      if (audienceMode === "manual") {
        return { criteria: { groups: [] }, manual_school_ids: manualSchoolIds };
      }
      return { criteria: { groups: fieldGroups }, manual_school_ids: null };
    }
    return { criteria: { groups }, manual_school_ids: null };
  }

  function buildSuccessCriteria() {
    if (isMeetingTask) {
      return { groups: meetingRequirementGroups };
    }
    if (successMode === "custom") return { groups: successGroups };
    return null; // "auto" (server re-derives) or "none"
  }
  const trackSuccess = isMeetingTask ? true : successMode !== "none";

  const looksLikeMissingMeetingTask = isMeetingTask || groups.some(g => g.conditions.some(c => c.type === "meeting" && c.negate));

  // Auto-suggest (never overwrite) the built-in template the first time the message step
  // opens with an empty subject/body.
  useEffect(() => {
    if (phase === "message" && looksLikeMissingMeetingTask && !subject && !bodyTemplate) {
      const tpl = isMeetingTask ? MEETING_TASK_BUILT_IN_TEMPLATE : BUILT_IN_TEMPLATE;
      setSubject(tpl.subject);
      setBodyTemplate(tpl.body_template);
      setSelectedTemplateId(tpl.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function applyTemplate(templateId) {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tpl = templateId === MEETING_TASK_BUILT_IN_TEMPLATE.id
      ? MEETING_TASK_BUILT_IN_TEMPLATE
      : templateId === BUILT_IN_TEMPLATE.id
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

  // Generalized (not tied to `groups`) so the same save/load flow works for both the
  // general-path audience builder and the meeting-path field filter (`fieldGroups`) — the
  // caller passes whichever setter is active for the phase currently rendering the picker.
  function applyAudience(audienceId, setTargetGroups) {
    setSelectedAudienceId(audienceId);
    if (!audienceId) return;
    const aud = audiences.find(a => a.id === audienceId);
    if (aud?.criteria?.groups?.length) {
      setTargetGroups(aud.criteria.groups);
    }
  }

  async function handleSaveAudience(currentGroups) {
    if (!newAudienceName.trim()) return;
    setSavingAudience(true);
    setAudienceSaveError(null);
    try {
      const res = await axios.post("/tasks/audiences", {
        name: newAudienceName.trim(), criteria: { groups: currentGroups },
      });
      setAudiences(prev => [res.data, ...prev]);
      setSelectedAudienceId(res.data.id);
      setShowSaveAudience(false);
      setNewAudienceName("");
    } catch {
      // Shown inline in the widget itself (not the wizard's shared `error`, which only
      // renders on the review step — a save attempted on an earlier step would otherwise
      // fail with zero visible feedback, looking exactly like a no-op.
      setAudienceSaveError("שמירת הקהל נכשלה — נסה שוב.");
    } finally {
      setSavingAudience(false);
    }
  }

  async function handleUpdateAudience(currentGroups) {
    if (!newAudienceName.trim() || !editingAudienceId) return;
    setSavingAudience(true);
    setAudienceSaveError(null);
    try {
      const res = await axios.patch(`/tasks/audiences/${editingAudienceId}`, {
        name: newAudienceName.trim(), criteria: { groups: currentGroups },
      });
      setAudiences(prev => prev.map(a => a.id === editingAudienceId ? res.data : a));
      setShowSaveAudience(false);
      setNewAudienceName("");
      setEditingAudienceId(null);
    } catch {
      setAudienceSaveError("עדכון הקהל נכשל — נסה שוב.");
    } finally {
      setSavingAudience(false);
    }
  }

  async function handleDeleteAudience(audienceId) {
    await axios.delete(`/tasks/audiences/${audienceId}`);
    setAudiences(prev => prev.filter(a => a.id !== audienceId));
    if (editingAudienceId === audienceId) {
      setEditingAudienceId(null);
      setShowSaveAudience(false);
      setNewAudienceName("");
    }
  }

  // Shared "קהל שמור" save/load/clear widget — three same-sized pill buttons. Loading opens
  // the shared SavedAudiencesModal (a proper dialog with search, since an inline list gets
  // cramped once there are many saved audiences); the modal itself doesn't know which phase
  // opened it, so we stash setTargetGroups/emptyGroups in audienceModalTarget when opening it.
  function renderAudiencePicker(currentGroups, setTargetGroups, emptyGroups) {
    const hasSelection = currentGroups.some(g => g.conditions.some(c => c.type === "meeting" || !!c.field));
    const pillBase = "text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap disabled:opacity-40";
    return (
      <div className="border border-slate-200 rounded-lg p-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-600">קהל שמור</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => { setAudienceModalTarget({ setTargetGroups, emptyGroups }); setShowSavedAudiencesModal(true); }}
              disabled={audiences.length === 0}
              className={`${pillBase} bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:hover:bg-slate-100`}
            >
              {`טען קהל שמור${audiences.length ? ` (${audiences.length})` : ""}...`}
            </button>
            <button
              type="button"
              onClick={() => { setTargetGroups(emptyGroups); setSelectedAudienceId(""); setEditingAudienceId(null); setShowSaveAudience(false); }}
              disabled={!hasSelection}
              className={`${pillBase} bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:hover:bg-slate-100`}
            >
              נקה בחירה
            </button>
            {showSaveAudience ? (
              <div className="flex items-center gap-1.5">
                <label htmlFor="new-audience-name" className="sr-only">שם הקהל</label>
                <input
                  id="new-audience-name"
                  autoFocus
                  value={newAudienceName}
                  onChange={e => setNewAudienceName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      editingAudienceId ? handleUpdateAudience(currentGroups) : handleSaveAudience(currentGroups);
                    }
                  }}
                  placeholder="שם הקהל לשמירה"
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
                />
                <button
                  onClick={() => editingAudienceId ? handleUpdateAudience(currentGroups) : handleSaveAudience(currentGroups)}
                  disabled={savingAudience || !newAudienceName.trim()}
                  className={`${pillBase} bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600`}
                >
                  {savingAudience ? "שומר..." : editingAudienceId ? "עדכן קהל" : "שמור"}
                </button>
                <button
                  onClick={() => { setShowSaveAudience(false); setAudienceSaveError(null); setEditingAudienceId(null); }}
                  className="text-xs text-slate-500 hover:underline whitespace-nowrap"
                >
                  ביטול
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveAudience(true)}
                disabled={!hasSelection}
                className={`${pillBase} bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:hover:bg-blue-50`}
              >
                + שמור כקהל...
              </button>
            )}
          </div>
        </div>
        {showSaveAudience && audienceSaveError && (
          <p role="alert" className="text-xs text-red-600 mt-1.5">{audienceSaveError}</p>
        )}
      </div>
    );
  }

  // Live "how many schools match" preview — debounced, re-runs whenever the audience
  // definition changes on either path.
  useEffect(() => {
    const { criteria, manual_school_ids } = audiencePayload();
    const hasAudience = (manual_school_ids && manual_school_ids.length > 0) || criteria.groups.some(g => g.conditions.length > 0);
    if (!hasAudience) { setPreview(null); return; }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      axios.post("/tasks/preview", { criteria, manual_school_ids })
        .then(r => setPreview(r.data))
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeetingTask, audienceMode, JSON.stringify(fieldGroups), JSON.stringify(manualSchoolIds), JSON.stringify(groups)]);

  // Auto-derive success (general path, option (a)) — re-runs whenever the audience criteria
  // changes while successMode is "auto". If not invertible, falls back to "custom" so the
  // manager isn't stuck on a disabled/meaningless option.
  useEffect(() => {
    if (isMeetingTask || successMode !== "auto") return;
    const hasAudience = groups.some(g => g.conditions.length > 0);
    if (!hasAudience) { setDerivedSuccess(null); return; }
    setDerivingSuccess(true);
    axios.post("/tasks/derive-success-criteria", { criteria: { groups } })
      .then(r => {
        setDerivedSuccess(r.data);
        if (!r.data?.invertible) setSuccessMode("custom");
      })
      .catch(() => setDerivedSuccess(null))
      .finally(() => setDerivingSuccess(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeetingTask, successMode, JSON.stringify(groups)]);

  async function handleAttachmentUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Round 13 — uploaded immediately (not deferred to after task creation): task creation
      // sends the first wave of messages right away (round 2), so the real storage_key must
      // already exist by the time attemptCreate's POST /tasks/ fires, or that first wave goes
      // out with no attachment at all.
      const form = new FormData();
      form.append("file", file);
      const up = await axios.post("/tasks/attachments/upload", form);
      setAttachments(prev => [...prev, { storageKey: up.data.storage_key, filename: file.name }]);
    } catch {
      setError("העלאת הקובץ נכשלה — נסה שוב.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function attemptCreate({ confirmOutlook = false, overrideChannel, excludedIds, overrides } = {}) {
    const effectiveChannel = overrideChannel || channel;
    setSubmitting(true);
    setError(null);
    try {
      const { criteria, manual_school_ids } = audiencePayload();
      const res = await axios.post("/tasks/", {
        name,
        criteria,
        manual_school_ids,
        success_criteria: buildSuccessCriteria(),
        track_success: trackSuccess,
        is_meeting_task: isMeetingTask,
        excluded_school_ids: excludedIds || excludedSchoolIds,
        meeting_overrides: overrides || meetingOverrides,
        message_config: {
          recipient_role: recipientRole,
          channel: effectiveChannel,
          subject,
          body_template: bodyTemplate,
          attachment_keys: attachments.map(a => a.storageKey),
        },
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        confirm_outlook_limit: confirmOutlook,
      });
      const task = res.data;

      setOutlookLimitWarning(null);
      onCreated(task.id);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.outlook_limit_exceeded) {
        setOutlookLimitWarning(detail);
      } else {
        setError("יצירת המשימה נכשלה — נסה שוב.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function switchChannelAndCreate() {
    setSwitchingChannel(true);
    setChannel("email_resend");
    try {
      await attemptCreate({ overrideChannel: "email_resend" });
    } finally {
      setSwitchingChannel(false);
    }
  }

  // Flattened `meetingRequirementGroups` conditions, shaped for POST /tasks/meetings/check —
  // only meaningful once a meeting type + at least one participant role is chosen (an empty/
  // half-filled requirement has nothing to check yet).
  function meetingRequirementsPayload() {
    return meetingRequirementGroups.flatMap(g => g.conditions).map(c => ({
      meeting_service_type: c.meeting_service_type,
      date_from: c.date_from, date_to: c.date_to,
      advisor_mode: c.advisor_mode || "default", advisor_ids: c.advisor_ids || [],
      duration_mode: c.duration_mode || "default", duration_minutes: c.duration_minutes,
      participant_roles: c.participant_roles || [],
      stage_scope: c.stage_scope || null,
    }));
  }

  // Runs after the (general-task-only, round 6) contact-resolution step clears — meeting tasks
  // no longer go through this at all, see handleCreateClick below.
  async function proceedAfterContacts() {
    await attemptCreate();
  }

  // Round 6: unified pre-creation check for 'קביעת פגישות' tasks — replaces both the old call
  // to /tasks/contacts/check AND the separate /tasks/meetings/check call for meeting tasks
  // specifically. Opens the unified TaskMeetingResolutionModal (coordinator + participants +
  // meeting defaults, blocking) whenever any school has a problem.
  async function proceedMeetingCheck() {
    const requirements = meetingRequirementsPayload().filter(r => r.meeting_service_type && r.participant_roles.length);
    if (!requirements.length) {
      await attemptCreate();
      return;
    }
    setCheckingMeetings(true);
    try {
      const { criteria, manual_school_ids } = audiencePayload();
      const res = await axios.post("/tasks/meetings/check", {
        criteria, manual_school_ids, meeting_requirements: requirements, channel,
      });
      const hasIssues = (res.data?.schools?.length || 0) > 0;
      setCheckingMeetings(false);
      if (hasIssues) {
        setShowMeetingResolutionModal(true);
        return;
      }
    } catch {
      setCheckingMeetings(false);
      // non-blocking on a failed check itself — fall through to creation
    }
    await attemptCreate();
  }

  // Runs before the actual POST /tasks/. Meeting-scheduling tasks skip /tasks/contacts/check
  // entirely (round 6 — that coordinator-contact check is now folded into the unified
  // /tasks/meetings/check + TaskMeetingResolutionModal instead). General tasks are unchanged:
  // checks whether the audience has schools with no resolvable contact for the chosen role/
  // channel, and if so opens the interactive resolution modal instead of creating immediately
  // (round-2 redesign).
  async function handleCreateClick() {
    setError(null);
    if (isMeetingTask) {
      await proceedMeetingCheck();
      return;
    }
    setCheckingContacts(true);
    try {
      const { criteria, manual_school_ids } = audiencePayload();
      const res = await axios.post("/tasks/contacts/check", {
        criteria, manual_school_ids, recipient_role: recipientRole, channel, is_meeting_task: isMeetingTask,
      });
      if ((res.data?.missing_count || 0) > 0) {
        setShowContactModal(true);
      } else {
        await proceedAfterContacts();
      }
    } catch {
      await proceedAfterContacts();
    } finally {
      setCheckingContacts(false);
    }
  }

  const canNextFromBasics = name.trim().length > 0;
  const canNextFromMeetingAudience = isMeetingTask && name.trim().length > 0 && (
    audienceMode === "manual" ? manualSchoolIds.length > 0 : fieldGroups.some(g => g.conditions.length > 0)
  );
  const canNextFromAudience = !isMeetingTask && groups.some(g => g.conditions.length > 0);
  const canNextFromSuccess = !isMeetingTask && (successMode !== "custom" || successGroups.some(g => g.conditions.length > 0));
  const canNextFromMessage = recipientRole && channel && bodyTemplate.trim().length > 0;

  const canGoNext = {
    basics: canNextFromBasics,
    meeting_audience: canNextFromMeetingAudience,
    audience: canNextFromAudience,
    success: canNextFromSuccess,
    message: canNextFromMessage,
    review: true,
  }[phase];

  // Every "פגישה" card must be fully filled (type/dates/participants) before leaving this
  // step — checked on click (not folded into canGoNext/disabled) so an incomplete attempt can
  // surface a visible alert + red-bordered fields (ConditionGroupsEditor's
  // showValidationErrors) instead of the button just silently staying disabled.
  const meetingRequirementsComplete = meetingRequirementGroups.some(g => g.conditions.length > 0)
    && meetingRequirementGroups.every(g => g.conditions.every(isMeetingRequirementComplete));

  function handleNextClick() {
    if (phase === "meeting_audience" && isMeetingTask && !meetingRequirementsComplete) {
      setMeetingReqAttempted(true);
      return;
    }
    setStep(s => s + 1);
  }

  // Bag of everything describeCondition/ConditionGroupsEditor need to resolve raw stored
  // values (field/goal/division/control-letter) to Hebrew labels — built once per render
  // instead of threading 5 separate props through every call site.
  const taskFieldMeta = { fieldOptions, goalOptions, divisionOptions, controlLetterFields };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-wizard-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="task-wizard-title" className="font-bold text-black">
            {isMeetingTask ? "יצירת משימת קביעת פגישות" : "יצירת משימה"} — שלב {step} מתוך {PHASES.length}
          </h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {phase === "basics" && (
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
                <TaskDateTimeInput
                  id="task-scheduled-for"
                  value={scheduledFor}
                  onChange={setScheduledFor}
                />
                <p className="text-xs text-slate-400 mt-1">
                  אם לא נבחר תאריך — המשימה תיווצר מיד וההודעות יישלחו לכל מי שתואם כרגע. אם נבחר תאריך עתידי — המשימה תיווצר במצב "מתוזמן", ורשימת בתי הספר תיקבע וההודעות יישלחו אוטומטית רק בתאריך שנבחר, לפי מי שיעמוד בקריטריונים אז.
                </p>
              </div>
            </div>
          )}

          {phase === "meeting_audience" && (
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

              <div className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setAudienceMode("filter")}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium ${audienceMode === "filter" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  סינון לפי שדות
                </button>
                <button
                  type="button"
                  onClick={() => setAudienceMode("manual")}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium ${audienceMode === "manual" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  בחירה ידנית
                </button>
              </div>

              {audienceMode === "filter" ? (
                <>
                  {renderAudiencePicker(fieldGroups, setFieldGroups, [newConditionGroup(["field"])])}
                  <ConditionGroupsEditor
                    groups={fieldGroups} setGroups={setFieldGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes}
                    allSchools={allSchools} allowedTypes={["field"]}
                    goalOptions={goalOptions} divisionOptions={divisionOptions} budgetNameOptions={budgetNameOptions}
                    controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
                  />
                </>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowSchoolPicker(true)}
                    className="text-sm px-4 py-2 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    {manualSchoolIds.length > 0 ? `בחירת בתי ספר (${manualSchoolIds.length} נבחרו)` : "בחירת בתי ספר..."}
                  </button>
                  {showSchoolPicker && (
                    <SchoolMultiPickerModal
                      selectedIds={manualSchoolIds}
                      onChange={setManualSchoolIds}
                      onClose={() => setShowSchoolPicker(false)}
                    />
                  )}
                </div>
              )}

              {/* Moved right below the audience-defining UI (instead of below "פגישות") so the
                  match count is visible without scrolling every time a filter field changes. */}
              <div role="status" className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {previewLoading ? "בודק כמות בתי ספר תואמים..." : preview
                      ? <>נמצאו <b>{preview.count}</b> בתי ספר תואמים.</>
                      : "הגדר קריטריון סינון או בחר בתי ספר כדי לראות תצוגה מקדימה."}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => setShowScheduleModal(true)}
                      className="text-xs text-blue-700 hover:underline whitespace-nowrap">
                      {scheduledFor ? `תזמון: ${new Date(scheduledFor).toLocaleString("he-IL")}` : "תזמון (אופציונלי)"}
                    </button>
                    {preview?.count > 0 && (
                      <button type="button" onClick={() => setShowPreviewList(v => !v)} className="text-xs text-blue-700 hover:underline whitespace-nowrap">
                        {showPreviewList ? "הסתר רשימה" : "הצג רשימה"}
                      </button>
                    )}
                  </div>
                </div>
                {showPreviewList && preview?.schools?.length > 0 && (
                  <ul className="mt-2 max-h-40 overflow-auto space-y-1 border-t border-slate-200 pt-2">
                    {preview.schools.map(s => (
                      <li key={s.school_id} className="text-xs text-slate-600 flex items-center gap-2">
                        <span className="font-medium text-slate-800">{s.school_name}</span>
                        {s.symbol && <bdi className="text-slate-400">({s.symbol})</bdi>}
                        {s.authority && <span className="text-slate-400">— {s.authority}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <span className="text-sm font-semibold text-slate-700 block mb-2">
                  פגישות
                </span>
                <ConditionGroupsEditor
                  groups={meetingRequirementGroups}
                  setGroups={setMeetingRequirementGroups}
                  fieldOptions={fieldOptions}
                  meetingTypes={meetingTypes}
                  orgUsers={orgUsers}
                  allowedTypes={["meeting"]}
                  hideGroupChrome
                  forceMeetingNegateFalse
                  addConditionLabel="הוסף פגישה"
                  showValidationErrors={meetingReqAttempted}
                />
              </div>
            </div>
          )}

          {phase === "audience" && (
            <div className="space-y-4">
              {renderAudiencePicker(groups, setGroups, [newConditionGroup()])}

              <ConditionGroupsEditor
                groups={groups} setGroups={setGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes} allSchools={allSchools}
                goalOptions={goalOptions} divisionOptions={divisionOptions} budgetNameOptions={budgetNameOptions}
                controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
              />

              <div role="status" className="text-sm bg-slate-50 rounded-lg px-3 py-2 mt-2">
                {previewLoading ? "בודק כמות בתי ספר תואמים..." : preview ? (
                  <div className="flex items-center justify-between gap-2">
                    <span>נמצאו <b>{preview.count}</b> בתי ספר תואמים לקריטריון.</span>
                    {preview.count > 0 && (
                      <button type="button" onClick={() => setShowPreviewList(v => !v)} className="text-xs text-blue-700 hover:underline whitespace-nowrap">
                        {showPreviewList ? "הסתר רשימה" : "הצג רשימה"}
                      </button>
                    )}
                  </div>
                ) : "הגדר תנאי לפחות אחד כדי לראות תצוגה מקדימה."}
                {showPreviewList && preview?.schools?.length > 0 && (
                  <ul className="mt-2 max-h-40 overflow-auto space-y-1 border-t border-slate-200 pt-2">
                    {preview.schools.map(s => (
                      <li key={s.school_id} className="text-xs text-slate-600 flex items-center gap-2">
                        <span className="font-medium text-slate-800">{s.school_name}</span>
                        {s.symbol && <bdi className="text-slate-400">({s.symbol})</bdi>}
                        {s.authority && <span className="text-slate-400">— {s.authority}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {phase === "success" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                הסינון קובע <b>למי שולחים</b> את ההודעה. כאן קובעים בנפרד <b>מתי נחשב שהצלחנו</b> — לפעמים זה בדיוק ההפך מהסינון, ולפעמים זה תנאי אחר לגמרי (למשל: לשלוח לכל מי שיש לו פגישת שוטף, אבל להצליח יחשב שקבעו גם פגישת גפן).
              </p>

              <label className="flex items-start gap-2 border border-slate-200 rounded-xl p-3 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50/50">
                <input type="radio" name="success-mode" checked={successMode === "auto"} onChange={() => setSuccessMode("auto")} className="mt-1" />
                <div>
                  <div className="text-sm font-medium text-slate-800">אוטומטי — ההפך מהסינון (ברירת מחדל)</div>
                  {successMode === "auto" && (
                    <div className="text-xs text-slate-500 mt-1">
                      {derivingSuccess ? "מחשב..." : derivedSuccess?.invertible === false ? (
                        <span className="text-amber-600">לא ניתן לגזור הצלחה אוטומטית מהסינון הזה (יותר מקבוצת "או" אחת, או תנאי "מכיל") — יש להגדיר הצלחה מותאמת אישית.</span>
                      ) : derivedSuccess?.success_criteria ? (
                        <span>הצלחה = {derivedSuccess.success_criteria.groups[0].conditions.map(c => describeCondition(c, taskFieldMeta)).join(" וגם ")}</span>
                      ) : "הגדר קודם תנאי סינון בשלב הקודם."}
                    </div>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2 border border-slate-200 rounded-xl p-3 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50/50">
                <input type="radio" name="success-mode" checked={successMode === "custom"} onChange={() => setSuccessMode("custom")} className="mt-1" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-800">הגדרה מותאמת אישית</div>
                  {successMode === "custom" && (
                    <div className="mt-2">
                      <ConditionGroupsEditor
                        groups={successGroups} setGroups={setSuccessGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes} allSchools={allSchools}
                        goalOptions={goalOptions} divisionOptions={divisionOptions} budgetNameOptions={budgetNameOptions}
                        controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
                      />
                    </div>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2 border border-slate-200 rounded-xl p-3 cursor-pointer has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50/50">
                <input type="radio" name="success-mode" checked={successMode === "none"} onChange={() => setSuccessMode("none")} className="mt-1" />
                <div>
                  <div className="text-sm font-medium text-slate-800">רק מעקב שליחה, ללא מדד הצלחה</div>
                  <div className="text-xs text-slate-500 mt-1">מתאים למשל להודעת מידע כללית — המשימה תעקוב רק אחרי מי קיבל הודעה, בלי אחוז הצלחה.</div>
                </div>
              </label>
            </div>
          )}

          {phase === "message" && (
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
                  <option value={isMeetingTask ? MEETING_TASK_BUILT_IN_TEMPLATE.id : BUILT_IN_TEMPLATE.id}>
                    {isMeetingTask ? MEETING_TASK_BUILT_IN_TEMPLATE.name : BUILT_IN_TEMPLATE.name}
                  </option>
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
                  תוכן ההודעה — ניתן להשתמש ב-{"{school_name}"}, {"{recipient_name}"}
                  {isMeetingTask ? <>, {"{advisor_names}"}</> : null}
                  {looksLikeMissingMeetingTask ? <> וב-{"{booking_link}"}</> : null}
                  {isMeetingTask ? <> וב-{"{meetings_list}"} (רשימת הפגישות המבוקשות — מוצגת אוטומטית לפי הנתונים בפועל)</> : null}
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

          {phase === "review" && (
            <div className="space-y-3 text-sm">
              <div><span className="font-semibold text-slate-700">שם המשימה: </span>{name}</div>
              <div>
                <span className="font-semibold text-slate-700">תזמון: </span>
                {scheduledFor
                  ? <>המשימה תופעל וההודעות יישלחו אוטומטית ב-<bdi>{new Date(scheduledFor).toLocaleString("he-IL")}</bdi></>
                  : "המשימה תיווצר וההודעות יישלחו מיד עם היצירה"}
              </div>
              <div>
                <span className="font-semibold text-slate-700 block mb-1">קהל היעד:</span>
                {isMeetingTask && audienceMode === "manual" ? (
                  <span className="text-slate-600">{manualSchoolIds.length} בתי ספר נבחרו ידנית</span>
                ) : (
                  <ul className="list-disc pr-5 space-y-0.5 text-slate-600">
                    {(isMeetingTask ? fieldGroups : groups).map((g, gi) => (
                      <li key={gi}>
                        {gi > 0 && <span className="font-bold text-blue-600">או: </span>}
                        {g.conditions.map(c => describeCondition(c, taskFieldMeta)).join(" וגם ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <span className="font-semibold text-slate-700">מדד הצלחה: </span>
                {isMeetingTask ? (
                  meetingRequirementGroups.flatMap(g => g.conditions).map(c => describeCondition(c, taskFieldMeta)).join(" וגם ")
                ) : successMode === "none" ? (
                  "רק מעקב שליחה, ללא מדד הצלחה"
                ) : successMode === "custom" ? (
                  successGroups.map(g => g.conditions.map(c => describeCondition(c, taskFieldMeta)).join(" וגם ")).join(" או ")
                ) : derivedSuccess?.success_criteria ? (
                  derivedSuccess.success_criteria.groups[0].conditions.map(c => describeCondition(c, taskFieldMeta)).join(" וגם ")
                ) : "—"}
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
          {phase !== "review" ? (
            <button
              onClick={handleNextClick}
              disabled={!canGoNext}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              הבא
            </button>
          ) : (
            <button
              onClick={handleCreateClick}
              disabled={submitting || checkingContacts || checkingMeetings}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {checkingContacts ? "בודק פרטי קשר..." : checkingMeetings ? "בודק פרטי תיאום..." : submitting ? "יוצר משימה..." : "יצירת המשימה"}
            </button>
          )}
        </div>
      </div>

      {showContactModal && (
        <TaskContactResolutionModal
          criteria={audiencePayload().criteria}
          manualSchoolIds={audiencePayload().manual_school_ids}
          recipientRole={recipientRole}
          onChangeRecipientRole={setRecipientRole}
          channel={channel}
          isMeetingTask={isMeetingTask}
          onProceed={() => { setShowContactModal(false); proceedAfterContacts(); }}
          onClose={() => setShowContactModal(false)}
        />
      )}

      {showMeetingResolutionModal && (
        <TaskMeetingResolutionModal
          criteria={audiencePayload().criteria}
          manualSchoolIds={audiencePayload().manual_school_ids}
          meetingRequirements={meetingRequirementsPayload().filter(r => r.meeting_service_type && r.participant_roles.length)}
          channel={channel}
          orgUsers={orgUsers}
          onProceed={(removedIds, overrides) => {
            setExcludedSchoolIds(removedIds);
            setMeetingOverrides(overrides);
            setShowMeetingResolutionModal(false);
            attemptCreate({ excludedIds: removedIds, overrides });
          }}
          onClose={() => setShowMeetingResolutionModal(false)}
        />
      )}

      {outlookLimitWarning && (
        <OutlookLimitModal
          warning={outlookLimitWarning}
          primaryLoading={submitting}
          secondaryLoading={switchingChannel}
          onConfirm={() => attemptCreate({ confirmOutlook: true })}
          onSwitchChannel={switchChannelAndCreate}
          onClose={() => setOutlookLimitWarning(null)}
          primaryLabel="המשך בכל זאת דרך Outlook"
          primaryLoadingLabel="יוצר..."
          secondaryLabel="עבור למייל רגיל (Resend) וצור"
          secondaryLoadingLabel="מעביר ערוץ..."
        />
      )}

      {showSavedAudiencesModal && audienceModalTarget && (
        <SavedAudiencesModal
          audiences={audiences}
          fieldOptions={fieldOptions}
          onClose={() => setShowSavedAudiencesModal(false)}
          onSelect={a => {
            applyAudience(a.id, audienceModalTarget.setTargetGroups);
            setEditingAudienceId(null);
            setShowSavedAudiencesModal(false);
          }}
          onEdit={a => {
            applyAudience(a.id, audienceModalTarget.setTargetGroups);
            setEditingAudienceId(a.id);
            setNewAudienceName(a.name);
            setShowSaveAudience(true);
            setShowSavedAudiencesModal(false);
          }}
          onDelete={handleDeleteAudience}
        />
      )}

      {showScheduleModal && (
        <ScheduleCriteriaModal
          value={scheduledFor}
          onChange={setScheduledFor}
          onClose={() => setShowScheduleModal(false)}
        />
      )}
    </div>
  );
}

// Round-10 UX merge — for the meeting-task track, "תזמון בדיקת קריטריונים" moved out of its own
// wizard step into this small on-demand modal (opened from a button next to "הצג רשימה" on the
// merged name+audience step), instead of always taking up space on the main step.
function ScheduleCriteriaModal({ value, onChange, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="schedule-criteria-title" onKeyDown={handleKeyDown}
        className="glass-card rounded-2xl w-full max-w-md mx-4 p-6 space-y-3">
        <h3 id="schedule-criteria-title" className="font-bold text-slate-900">תזמון בדיקת הקריטריונים (אופציונלי)</h3>
        <TaskDateTimeInput id="task-scheduled-for-modal" value={value} onChange={onChange} />
        <p className="text-xs text-slate-400">
          אם לא נבחר תאריך — המשימה תיווצר מיד וההודעות יישלחו לכל מי שתואם כרגע. אם נבחר תאריך עתידי — המשימה תיווצר במצב "מתוזמן", ורשימת בתי הספר תיקבע וההודעות יישלחו אוטומטית רק בתאריך שנבחר, לפי מי שיעמוד בקריטריונים אז.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          {value && (
            <button type="button" onClick={() => onChange("")} className="text-xs text-slate-500 hover:underline px-2 py-1.5">
              נקה תזמון
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-blue text-sm px-4 py-1.5">אישור</button>
        </div>
      </div>
    </div>
  );
}
