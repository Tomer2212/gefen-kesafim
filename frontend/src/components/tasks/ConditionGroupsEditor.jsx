import { useEffect, useState } from "react";
import TaskDateTimeInput from "./TaskDateTimeInput";
import DirectStyleDateInput from "./DirectStyleDateInput";
import FieldPickerButton from "./FieldPickerButton";
import { MEETING_STATUS_OPTIONS, MEETING_TYPE_OPTIONS } from "../meetings/constants";

// Only scheduled/completed meetings are ever fetched for condition-matching at all (see
// backend/task_logic.py's _fetch_schools_and_meetings, which pre-filters at the query level for
// BOTH audience-filtering and success-tracking) — cancelled/postponed/other meetings never
// reach this evaluation regardless of what a condition asks for. Restricting the dropdown to
// just these two avoids offering options that could never actually match anything.
const MEETING_CONDITION_STATUS_OPTIONS = MEETING_STATUS_OPTIONS.filter(s => s.value === "scheduled" || s.value === "completed");

const EMPTY_MEETING_CONDITION = {
  type: "meeting", meeting_service_type: "", status: "", meeting_type: "", date_from: "", date_to: "", negate: false,
  // Round-5 "אילו פגישות צריך לקבוע?" metadata — ignored entirely by success-condition
  // evaluation (_eval_meeting_condition/_resolve_condition only read the fields above), used
  // only by the booking-link generator when this condition lives inside a meeting-scheduling
  // task's success_criteria. Harmless extra keys in every other context.
  advisor_mode: "default", advisor_ids: [], duration_mode: "default", duration_minutes: null,
  participant_roles: [],
  // Round 8: 'tichon' | 'chativa' | 'both' — which principal(s) to invite for a six-year
  // school's "מנהל/ת" participant. Mandatory whenever meeting_service_type != "current" and
  // "principal" is a chosen participant_role (see isMeetingRequirementComplete below) —
  // "שוטף" is school-wide and never stage-dependent, so it's never asked there.
  stage_scope: null,
};
const MEETING_TYPE_PILLS = [{ value: "gefen", label: "גפן" }, { value: "current", label: "שוטף" }, { value: "district", label: "מחוז" }];
const PARTICIPANT_ROLE_OPTIONS = [
  { value: "principal", label: "מנהל/ת" }, { value: "secretary", label: "מנהלנ/ית" }, { value: "finance_contact", label: "אחראי/ת כספים" },
];
// Round 16 — "separate" mirrors StageScopeModal.jsx's existing "שתי פגישות נפרדות" option
// (frontend/src/components/meetings/StageScopeModal.jsx), which this task-level requirement
// previously had no equivalent for: _build_meeting_booking_link now builds two independent
// bookable ranges (one per principal) instead of merging both into one range's participant list.
const STAGE_SCOPE_PILLS = [
  { value: "tichon", label: "תיכון" },
  { value: "chativa", label: 'חט"ב' },
  { value: "both", label: "שניהם (פגישה אחת)" },
  { value: "separate", label: "שתי פגישות נפרדות" },
];
function needsStageScope(cond) {
  return cond.meeting_service_type && cond.meeting_service_type !== "current" && (cond.participant_roles || []).includes("principal");
}
export const DURATION_OPTIONS = Array.from({ length: (180 - 30) / 15 + 1 }, (_, i) => 30 + i * 15);
export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} דק'`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} שעות` : `${Math.floor(hours)}:${String(minutes % 60).padStart(2, "0")} שעות`;
}

// (DirectStyleDateInput now lives in its own file — see ./DirectStyleDateInput.jsx — reused by
// PersonTaskCreateWizard.jsx's "תאריך יעד" field.)
const MEETING_SERVICE_TYPE_LABELS = { gefen: "גפן", current: "שוטף", gefen_current: "גפן+שוטף", district: "מחוז" };
export function isMeetingRequirementComplete(cond) {
  return !!(
    cond.meeting_service_type && cond.date_from && cond.date_to && (cond.participant_roles || []).length > 0 &&
    (!needsStageScope(cond) || cond.stage_scope)
  );
}
const EMPTY_FIELD_CONDITION = { type: "field", field: "", op: "eq", value: "" };
// division_type is intentionally absent — which division(s) apply is inherently per-school (a
// six-year school has two), so it's auto-detected server-side rather than pre-chosen here (see
// task_logic._eval_goal_condition/_eval_control_letter_condition). budget_names defaults to a
// single pre-selected "גפן" pill since that's the overwhelmingly common case.
const EMPTY_GOAL_CONDITION = { type: "goal", goal_key: "", budget_names: ["גפן"], value: "" };
const EMPTY_CONTROL_LETTER_CONDITION = { type: "control_letter", field: "", op: "eq", value: "" };

// Which comparison operators make sense per field type — a free-text field can be "contains",
// but ">"/"<" on a closed dropdown or a boolean is meaningless. Bool fields get no operator UI
// at all (their value IS the whole condition — "yes"/"no").
const OPS_BY_TYPE = {
  text: [{ value: "eq", label: "=" }, { value: "ne", label: "≠" }, { value: "contains", label: "מכיל" }],
  select: [{ value: "eq", label: "=" }, { value: "ne", label: "≠" }],
  number: [
    { value: "eq", label: "=" }, { value: "ne", label: "≠" }, { value: "gt", label: ">" },
    { value: "gte", label: "≥" }, { value: "lt", label: "<" }, { value: "lte", label: "≤" },
  ],
  bool: [],
};

function uniq(arr) {
  return [...new Set(arr.filter(v => v !== null && v !== undefined && v !== ""))].sort();
}

// Single-value autocomplete for free-text school fields (symbol/city/authority/etc.) — typing
// narrows suggestions built from real distinct values already on the school list, but doesn't
// force a pick (useful for op="contains" or a value that doesn't exist yet).
function TypeaheadValueInput({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const suggestions = (options || [])
    .filter(o => !value || o.toLowerCase().includes(String(value).toLowerCase()))
    .slice(0, 8);
  return (
    <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 right-0 left-0 mt-1 border border-slate-200 rounded-lg bg-white shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="w-full text-right px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "meeting" is no longer chosen via a type-selector — it's reached through the field-picker's
// "פגישות" category (see conditionForPickedKey) — so a freshly-added blank condition should
// default to a plain field condition whenever that's allowed at all, falling back to meeting
// only for the dedicated meeting-requirements block (allowedTypes=["meeting"] only).
function defaultConditionFor(allowedTypes) {
  return allowedTypes.includes("field") ? { ...EMPTY_FIELD_CONDITION } : { ...EMPTY_MEETING_CONDITION };
}

export function newConditionGroup(allowedTypes = ["meeting", "field"]) {
  return { conditions: [defaultConditionFor(allowedTypes)] };
}

// Extracted from TaskCreateWizard.jsx's original inline step-2 JSX (round-2 redesign) —
// reused in four places: general-path audience criteria (both types), general-path custom
// success criteria (both types), the meeting-fast-path's field-only audience filter
// (allowedTypes=["field"]), and the meeting-fast-path's "פגישות שצריך לקבוע" requirement list
// (allowedTypes=["meeting"], hideGroupChrome + forceMeetingNegateFalse — see those props below).
export default function ConditionGroupsEditor({
  groups, setGroups, fieldOptions, meetingTypes, allSchools, allowedTypes = ["meeting", "field"],
  goalOptions, divisionOptions, budgetNameOptions, controlLetterFields, goalValueOptions, orgUsers,
  hideGroupChrome = false, forceMeetingNegateFalse = false, addConditionLabel = "+ הוסף תנאי (וגם)",
  showValidationErrors = false, valueFieldLabel = "ערך",
  // When set, "+ הוסף קבוצת 'או'" seeds the new group with these conditions instead of a single
  // blank one — used by PersonTaskCreateWizard.jsx's "יועץ מלווה" audience filter, where every
  // alternative group needs the same client_status/service_type pair the first group starts
  // with (a bare group otherwise gives no hint that service_type is expected there too).
  defaultGroupConditions = null,
}) {
  function updateCondition(gi, ci, patch) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : {
      ...g, conditions: g.conditions.map((c, j) => j !== ci ? c : { ...c, ...patch }),
    }));
  }
  // FieldPickerButton's checked keys carry a "goal:"/"control_letter:" prefix for those two
  // condition types (see FieldPickerButton's own comment) — plain field keys build a regular
  // {type:"field",...} condition as before. The user can check several at once: the first
  // picked key replaces the current row, every additional one is inserted right after it as a
  // new sibling AND condition, so one confirm can add a whole batch instead of repeating
  // "הוסף תנאי" per field.
  function conditionForPickedKey(key) {
    if (key.startsWith("goal:")) return { ...EMPTY_GOAL_CONDITION, goal_key: key.slice("goal:".length) };
    if (key.startsWith("control_letter:")) return { ...EMPTY_CONTROL_LETTER_CONDITION, field: key.slice("control_letter:".length) };
    if (key === "meeting:has") return { ...EMPTY_MEETING_CONDITION };
    return { type: "field", field: key, op: "eq", value: "" };
  }
  function handleFieldPick(gi, ci, keys) {
    if (!keys.length) return;
    setGroups(prev => prev.map((g, i) => {
      if (i !== gi) return g;
      const conditions = [...g.conditions];
      conditions[ci] = conditionForPickedKey(keys[0]);
      const extra = keys.slice(1).map(conditionForPickedKey);
      return { ...g, conditions: [...conditions.slice(0, ci + 1), ...extra, ...conditions.slice(ci + 1)] };
    }));
  }
  function addCondition(gi) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : { ...g, conditions: [...g.conditions, defaultConditionFor(allowedTypes)] }));
  }
  function removeCondition(gi, ci) {
    setGroups(prev => prev.map((g, i) => i !== gi ? g : { ...g, conditions: g.conditions.filter((_, j) => j !== ci) }));
  }
  function addGroup() {
    setGroups(prev => [
      ...prev,
      defaultGroupConditions ? { conditions: defaultGroupConditions.map(c => ({ ...c })) } : newConditionGroup(allowedTypes),
    ]);
  }
  function removeGroup(gi) {
    setGroups(prev => prev.filter((_, i) => i !== gi));
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => (
        <div key={gi}>
          {!hideGroupChrome && gi > 0 && (
            <div className="text-center text-xs font-bold text-blue-600 my-2">— או —</div>
          )}
          <div className={hideGroupChrome ? "space-y-2" : "border border-slate-200 rounded-xl p-3 space-y-2"}>
            {!hideGroupChrome && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">קבוצת תנאים (וגם ביניהם)</span>
                {groups.length > 1 && (
                  <button onClick={() => removeGroup(gi)} className="text-xs text-red-600 hover:bg-red-50 rounded px-2 py-0.5">
                    הסר קבוצה
                  </button>
                )}
              </div>
            )}
            {group.conditions.map((cond, ci) => {
              const isMeetingCard = cond.type === "meeting" && forceMeetingNegateFalse;
              return (
              <div key={ci} className={isMeetingCard ? "border border-slate-200 rounded-xl p-4 bg-white/60 space-y-3" : "border border-slate-100 rounded-lg p-2.5 bg-slate-50 space-y-2"}>
                <div className="flex items-center gap-2">
                  {isMeetingCard && <span className="text-sm font-semibold text-slate-700">פגישה {ci + 1}</span>}
                  {group.conditions.length > 1 && (
                    <button onClick={() => removeCondition(gi, ci)} aria-label={`הסרת פגישה ${ci + 1}`} className="text-slate-400 hover:text-red-500 mr-auto">
                      {isMeetingCard ? "✕" : (
                        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>

                {cond.type === "meeting" && forceMeetingNegateFalse ? (
                  // "פגישות" card — same look as DirectCoordinationModal.jsx's "תיאום ישיר"
                  // (סוג פגישה pills, DD/MM/YY date fields, single-select duration) — plus one
                  // extra single-select, "יועץ מבצע", styled identically to "משך הפגישה" there.
                  // Both default to *that school's own* card values (advisor_gefen/current/
                  // district, meeting_duration_gefen/current/district) per meeting type,
                  // resolved per-school at send time in tasks_router._build_meeting_booking_link
                  // (the wizard doesn't know which school yet) — "ברירת מחדל" is a real option
                  // in the list, not a separate toggle. Participants are role-level (not named
                  // people) for the same reason.
                  <div className="flex flex-col gap-3">
                    {showValidationErrors && !isMeetingRequirementComplete(cond) && (
                      <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                        יש להשלים את כל השדות המסומנים באדום בפגישה זו לפני שממשיכים.
                      </p>
                    )}
                    <fieldset className="flex flex-col gap-1.5">
                      <legend className="text-xs font-medium text-slate-500">סוג פגישה</legend>
                      <div className={`flex gap-2 ${showValidationErrors && !cond.meeting_service_type ? "border border-red-400 rounded-lg p-1.5 -m-1.5" : ""}`}>
                        {MEETING_TYPE_PILLS.map(opt => (
                          <button key={opt.value} type="button"
                            aria-pressed={cond.meeting_service_type === opt.value}
                            onClick={() => updateCondition(gi, ci, { meeting_service_type: opt.value })}
                            className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                              cond.meeting_service_type === opt.value
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
                        <label htmlFor={`mtg-start-${gi}-${ci}`} className="text-xs font-medium text-slate-500">מתאריך</label>
                        <DirectStyleDateInput id={`mtg-start-${gi}-${ci}`} value={cond.date_from} onChange={v => updateCondition(gi, ci, { date_from: v })} invalid={showValidationErrors && !cond.date_from} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`mtg-end-${gi}-${ci}`} className="text-xs font-medium text-slate-500">עד תאריך</label>
                        <DirectStyleDateInput id={`mtg-end-${gi}-${ci}`} value={cond.date_to} onChange={v => updateCondition(gi, ci, { date_to: v })} invalid={showValidationErrors && !cond.date_to} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1 relative group">
                        <label htmlFor={`mtg-advisor-${gi}-${ci}`} className="text-xs font-medium text-slate-500">יועץ מבצע</label>
                        <select id={`mtg-advisor-${gi}-${ci}`}
                          value={cond.advisor_mode === "manual" ? (cond.advisor_ids?.[0] || "") : "__default__"}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === "__default__") updateCondition(gi, ci, { advisor_mode: "default", advisor_ids: [] });
                            else updateCondition(gi, ci, { advisor_mode: "manual", advisor_ids: [v] });
                          }}
                          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 w-full">
                          <option value="__default__">
                            {cond.meeting_service_type ? `יועץ מלווה [${MEETING_SERVICE_TYPE_LABELS[cond.meeting_service_type]}]` : "יועץ מלווה"}
                          </option>
                          {(orgUsers || []).map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                        </select>
                        <div className="pointer-events-none absolute -top-7 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-400 text-amber-950 text-[11px] font-medium px-2 py-1 rounded-md shadow-lg whitespace-nowrap z-10">
                          בהתאם להגדרה בכרטיס בית הספר
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 relative group">
                        <label htmlFor={`mtg-duration-${gi}-${ci}`} className="text-xs font-medium text-slate-500">משך הפגישה</label>
                        <select id={`mtg-duration-${gi}-${ci}`}
                          value={cond.duration_mode === "manual" ? String(cond.duration_minutes || 60) : "__default__"}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === "__default__") updateCondition(gi, ci, { duration_mode: "default", duration_minutes: null });
                            else updateCondition(gi, ci, { duration_mode: "manual", duration_minutes: Number(v) });
                          }}
                          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 w-full">
                          <option value="__default__">
                            {cond.meeting_service_type ? `זמן פגישה [${MEETING_SERVICE_TYPE_LABELS[cond.meeting_service_type]}]` : "זמן פגישה"}
                          </option>
                          {DURATION_OPTIONS.map(d => <option key={d} value={d}>{formatDuration(d)}</option>)}
                        </select>
                        <div className="pointer-events-none absolute -top-7 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-400 text-amber-950 text-[11px] font-medium px-2 py-1 rounded-md shadow-lg whitespace-nowrap z-10">
                          בהתאם להקצאה בכרטיס בית הספר
                        </div>
                      </div>
                    </div>

                    <fieldset className="flex flex-col gap-1.5">
                      <legend className="text-xs font-medium text-slate-500">משתתפים מצד בית הספר</legend>
                      <div className={`flex flex-wrap gap-2 ${showValidationErrors && (cond.participant_roles || []).length === 0 ? "border border-red-400 rounded-lg p-1.5 -m-1.5" : ""}`}>
                        {PARTICIPANT_ROLE_OPTIONS.map(opt => {
                          const checked = (cond.participant_roles || []).includes(opt.value);
                          return (
                            <label key={opt.value} className="flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-slate-50">
                              <input type="checkbox" checked={checked}
                                onChange={() => updateCondition(gi, ci, {
                                  participant_roles: checked ? (cond.participant_roles || []).filter(r => r !== opt.value) : [...(cond.participant_roles || []), opt.value],
                                })}
                                className="w-3.5 h-3.5 rounded accent-blue-600" />
                              <span>{opt.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>

                    {needsStageScope(cond) && (
                      <fieldset className="flex flex-col gap-1.5">
                        <legend className="text-xs font-medium text-slate-500">חטיבה</legend>
                        <p className="text-[11px] text-slate-400">
                          רלוונטי לבתי ספר שש-שנתיים בלבד, לשאר בתי הספר תיקבע פגישה עם המנהל היחיד שלהם.
                        </p>
                        <div className={`flex gap-2 ${showValidationErrors && !cond.stage_scope ? "border border-red-400 rounded-lg p-1.5 -m-1.5" : ""}`}>
                          {STAGE_SCOPE_PILLS.map(opt => (
                            <button key={opt.value} type="button"
                              aria-pressed={cond.stage_scope === opt.value}
                              onClick={() => updateCondition(gi, ci, { stage_scope: opt.value })}
                              className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                                cond.stage_scope === opt.value
                                  ? "bg-blue-600 border-blue-600 text-white font-semibold"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {showValidationErrors && !cond.stage_scope && (
                          <p role="alert" className="text-[11px] text-red-600">יש לבחור לאיזו חטיבה מיועדת הפגישה (רלוונטי לבתי ספר שש-שנתיים)</p>
                        )}
                      </fieldset>
                    )}
                  </div>
                ) : cond.type === "meeting" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-500 col-span-2">
                      שדה
                      <div className="mt-0.5">
                        <FieldPickerButton
                          value="meeting:has"
                          fieldOptions={fieldOptions}
                          goalOptions={goalOptions}
                          controlLetterFields={controlLetterFields}
                          allowMeeting
                          onConfirm={keys => handleFieldPick(gi, ci, keys)}
                        />
                      </div>
                    </label>
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
                      סטטוס פגישה
                      <select value={cond.status || ""} onChange={e => updateCondition(gi, ci, { status: e.target.value })}
                        className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">כל סטטוס</option>
                        {MEETING_CONDITION_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">
                      מיקום פגישה
                      <select value={cond.meeting_type || ""} onChange={e => updateCondition(gi, ci, { meeting_type: e.target.value })}
                        className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">כל מיקום</option>
                        {MEETING_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">
                      מתאריך
                      <div className="mt-0.5">
                        <TaskDateTimeInput
                          dateOnly
                          value={cond.date_from}
                          onChange={v => updateCondition(gi, ci, { date_from: v })}
                        />
                      </div>
                    </label>
                    <label className="text-xs text-slate-500">
                      עד תאריך
                      <div className="mt-0.5">
                        <TaskDateTimeInput
                          dateOnly
                          value={cond.date_to}
                          onChange={v => updateCondition(gi, ci, { date_to: v })}
                        />
                      </div>
                    </label>
                  </div>
                ) : cond.type === "goal" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-500 col-span-2">
                      יעד
                      <div className="mt-0.5">
                        <FieldPickerButton
                          value={`goal:${cond.goal_key}`}
                          fieldOptions={fieldOptions}
                          goalOptions={goalOptions}
                          controlLetterFields={controlLetterFields}
                          allowMeeting={allowedTypes.includes("meeting")}
                          onConfirm={keys => handleFieldPick(gi, ci, keys)}
                        />
                      </div>
                    </label>
                    <div className="text-xs text-slate-500">
                      סוג תקציב
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {(budgetNameOptions || []).map(b => {
                          const selected = (cond.budget_names || []).includes(b.value);
                          return (
                            <button key={b.value} type="button" aria-pressed={selected}
                              onClick={() => updateCondition(gi, ci, {
                                budget_names: selected
                                  ? (cond.budget_names || []).filter(v => v !== b.value)
                                  : [...(cond.budget_names || []), b.value],
                              })}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                selected ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}>
                              {b.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="text-xs text-slate-500">
                      ערך מדד הצלחה
                      <select value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                        className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                        <option value="">בחר</option>
                        {(goalValueOptions || []).map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                      </select>
                    </label>
                  </div>
                ) : cond.type === "control_letter" ? (() => {
                  const clOpt = (controlLetterFields || []).find(f => f.field === cond.field);
                  const ops = OPS_BY_TYPE[clOpt?.type] || OPS_BY_TYPE.text;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-slate-500 col-span-2">
                        שדה
                        <div className="mt-0.5">
                          <FieldPickerButton
                            value={`control_letter:${cond.field}`}
                            fieldOptions={fieldOptions}
                            goalOptions={goalOptions}
                            controlLetterFields={controlLetterFields}
                            allowMeeting={allowedTypes.includes("meeting")}
                            onConfirm={keys => handleFieldPick(gi, ci, keys)}
                          />
                        </div>
                      </label>
                      {ops.length > 1 && (
                        <label className="text-xs text-slate-500">
                          יחס
                          <select value={cond.op} onChange={e => updateCondition(gi, ci, { op: e.target.value })}
                            className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                            {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                      )}
                      <label className="text-xs text-slate-500 col-span-2">
                        ערך
                        {(() => {
                          if (clOpt?.options) {
                            return (
                              <select value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                <option value="">בחר</option>
                                {clOpt.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            );
                          }
                          if (clOpt?.type === "number") {
                            return (
                              <input type="number" value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                            );
                          }
                          return (
                            <input value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                              className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                          );
                        })()}
                      </label>
                    </div>
                  );
                })() : (() => {
                  const opt = (fieldOptions || []).find(f => f.field === cond.field);
                  const ops = OPS_BY_TYPE[opt?.type] || OPS_BY_TYPE.text;
                  const isBool = opt?.type === "bool";
                  return (
                    <div className={`grid gap-2 ${isBool ? "grid-cols-2" : "grid-cols-3"}`}>
                      <label className="text-xs text-slate-500 col-span-1">
                        שדה
                        <div className="mt-0.5">
                          <FieldPickerButton
                            value={cond.field}
                            fieldOptions={fieldOptions}
                            goalOptions={goalOptions}
                            controlLetterFields={controlLetterFields}
                            allowMeeting={allowedTypes.includes("meeting")}
                            onConfirm={keys => handleFieldPick(gi, ci, keys)}
                          />
                        </div>
                      </label>
                      {!isBool && ops.length > 1 && (
                        <label className="text-xs text-slate-500 col-span-1">
                          יחס
                          <select value={cond.op} onChange={e => updateCondition(gi, ci, { op: e.target.value })}
                            className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                            {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                      )}
                      <label className="text-xs text-slate-500 col-span-1">
                        {valueFieldLabel}
                        {(() => {
                          if (opt?.options) {
                            return (
                              <select value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                <option value="">בחר</option>
                                {opt.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            );
                          }
                          if (opt?.type === "number") {
                            return (
                              <input type="number" value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                                className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                            );
                          }
                          if (opt?.type === "text" && opt?.table === "schools" && allSchools) {
                            return (
                              <TypeaheadValueInput
                                value={cond.value}
                                options={uniq(allSchools.map(s => s[cond.field]))}
                                onChange={v => updateCondition(gi, ci, { value: v })}
                              />
                            );
                          }
                          return (
                            <input value={cond.value} onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                              className="w-full mt-0.5 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white" />
                          );
                        })()}
                      </label>
                    </div>
                  );
                })()}
              </div>
              );
            })}
            <div className="flex items-center gap-2">
              <button onClick={() => addCondition(gi)} className="text-xs px-3 py-1.5 rounded-full font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap">
                {addConditionLabel}
              </button>
              {!hideGroupChrome && gi === groups.length - 1 && (
                <button onClick={addGroup} className="text-xs px-3 py-1.5 rounded-full font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap">
                  + הוסף קבוצת "או"
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
