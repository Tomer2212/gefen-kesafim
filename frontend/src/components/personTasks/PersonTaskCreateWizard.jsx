import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import ConditionGroupsEditor, { newConditionGroup } from "../tasks/ConditionGroupsEditor";
import ScheduleCriteriaModal from "../tasks/ScheduleCriteriaModal";
import DirectStyleDateInput from "../tasks/DirectStyleDateInput";
import { AcademicYearSelector } from "../AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../../constants/academicYears";
import { URGENCY_LABELS } from "./personTaskColumns";

// Default audience filter for "יועץ מלווה" mode — mirrors TaskCreateWizard.jsx's own default
// pre-fill (client_status=active) exactly, plus a mandatory, deliberately-empty service_type
// condition: its value is what determines routing (gefen/current/district/gefen_current), so
// the creator must actively choose it rather than inherit a silent default. Both are mandatory
// (see advisorClientStatusSet/advisorServiceTypeSet below) — every "+ הוסף קבוצת 'או'" group
// gets the same pair via ConditionGroupsEditor's defaultGroupConditions prop.
const ADVISOR_DEFAULT_CONDITIONS = [
  { type: "field", field: "client_status", op: "eq", value: "active" },
  { type: "field", field: "service_type", op: "eq", value: "" },
];
function defaultAdvisorFieldGroups() {
  return [{ conditions: ADVISOR_DEFAULT_CONDITIONS.map(c => ({ ...c })) }];
}
const METRIC_KIND_OPTIONS = [
  { value: "field", pill: "עדכון שדה קיים", label: "עדכון שדה קיים במערכת", hint: "בחר/י את השדה וערכו הרצוי שיעידו על השלמת המשימה בהצלחה." },
  { value: "checkbox", pill: 'כפתור "בוצע"', label: "כפתור \"סימנתי שביצעתי\"", hint: "המשתמש עצמו מסמן שהשלים." },
  { value: "number", pill: "מילוי ערך מספרי", label: "מילוי ערך מספרי", hint: "המשתמש מזין מספר (למשל: כמות שיחות) — המילוי עצמו נחשב השלמה." },
  { value: "file", pill: "העלאת קובץ", label: "העלאת קובץ", hint: "המשתמש מעלה קובץ — רק לחיצה על \"שליחה\" (לא ההעלאה עצמה) מסמנת את המשימה כהושלמה." },
];
const PROBLEM_KIND_LABELS = {
  no_service_type: "לא הוגדר \"סוג שירות\" עבור בית הספר הזה — יש להגדיר בכרטיס בית הספר ואז ללחוץ \"בדוק שוב\".",
  missing: "לא הוגדר יועץ מלווה עבור החטיבה הזו — יש להגדיר בכרטיס בית הספר ואז ללחוץ \"בדוק שוב\".",
};
const STEP_TITLES = {
  details: "פרטי המשימה ובחירת יעד",
  metric: "בחירת מדד הצלחה",
  problems: "פתרון בעיות ניתוב",
};

// Mirrors TaskCreateWizard.jsx's step-based flow, scoped to the new "אנשי הארגון" track. Step 1
// merges the task's basic details with the target picker (tabs: "לפי בתי ספר" default / "משתמשים
// ספציפיים" — both tabs' content is visible inline immediately, no extra click-to-open-modal,
// per the explicit product decision). Step 2 builds the success metric. Step 3 (schools mode
// only, only reached if the pre-creation check finds a problem) is a BLOCKING "בעיות" resolution
// screen (POST /person-tasks/schools/check — missing advisor / ambiguous multiple-advisors-per-
// division), matching TaskMeetingResolutionModal's precedent from the school-tasks flow.
export default function PersonTaskCreateWizard({ onClose, onCreated, initialAcademicYear }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [step, setStep] = useState("details"); // details -> metric -> (problems) -> create
  const [academicYear, setAcademicYear] = useState(initialAcademicYear || DEFAULT_ACADEMIC_YEAR);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [urgency, setUrgency] = useState(1);
  const [assignmentMode, setAssignmentMode] = useState("schools"); // default tab: 'schools' | 'users'
  const [orgUsers, setOrgUsers] = useState([]);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [advisorFieldGroups, setAdvisorFieldGroups] = useState(() => defaultAdvisorFieldGroups());
  const [advisorCheck, setAdvisorCheck] = useState(null); // {rows, matched_school_ids, total_schools, ok_schools}
  const [advisorCheckLoading, setAdvisorCheckLoading] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(""); // datetime-local string, empty = create now
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [metricKind, setMetricKind] = useState("checkbox");
  const [metricLabel, setMetricLabel] = useState("");
  const [fieldOptions, setFieldOptions] = useState([]);
  const [goalOptions, setGoalOptions] = useState([]);
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [controlLetterFields, setControlLetterFields] = useState([]);
  const [budgetNameOptions, setBudgetNameOptions] = useState([]);
  const [goalValueOptions, setGoalValueOptions] = useState([]);
  const [meetingTypes, setMeetingTypes] = useState([]);
  const [fieldGroups, setFieldGroups] = useState(() => [newConditionGroup(["field"])]);
  const [checking, setChecking] = useState(false);
  const [resolvedAssignees, setResolvedAssignees] = useState({}); // "school_id:division" -> [advisor_ids]
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get("/schools/users/all").then(r => setOrgUsers(r.data || [])).catch(() => {});
    axios.get("/schools/users/me").then(r => setCurrentUserRole(r.data?.role)).catch(() => {});
    axios.get("/tasks/field-options").then(r => {
      setFieldOptions(r.data?.fields || []);
      setMeetingTypes(r.data?.meeting_types || []);
      setGoalOptions(r.data?.goal_options || []);
      setDivisionOptions(r.data?.division_options || []);
      setBudgetNameOptions(r.data?.budget_name_options || []);
      setControlLetterFields(r.data?.control_letter_fields || []);
      setGoalValueOptions(r.data?.goal_value_options || []);
    }).catch(() => {});
  }, []);

  const assignableUsers = orgUsers.filter(u => {
    if (currentUserRole === "owner") return true;
    if (currentUserRole === "manager") return u.role === "manager" || u.role === "advisor";
    return false;
  });
  const filteredAssignableUsers = assignableUsers.filter(u => {
    if (!userSearch.trim()) return true;
    const q = userSearch.trim().toLowerCase();
    return (u.full_name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
  });

  function toggleUser(id) {
    setSelectedUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  // client_status and service_type are both mandatory (service_type decides routing;
  // client_status defaults to "active" but can be cleared/blanked out) — "יועץ מלווה" mode
  // can't proceed until both have a value, matching the meeting-task wizard's mandatory-field
  // red-border pattern.
  const advisorClientStatusSet = advisorFieldGroups.some(g => g.conditions.some(c => c.type === "field" && c.field === "client_status" && c.value));
  const advisorServiceTypeSet = advisorFieldGroups.some(g => g.conditions.some(c => c.type === "field" && c.field === "service_type" && c.value));
  const canProceedDetails = name.trim().length > 0
    && (assignmentMode === "users"
      ? selectedUserIds.length > 0
      // A scheduled task defers matching entirely to activation time, so the live check isn't
      // required to proceed (see handleMetricNext/submitTask).
      : advisorClientStatusSet && advisorServiceTypeSet && (!!scheduledFor || !!advisorCheck?.total_schools));

  function advisorCriteria() {
    return { groups: advisorFieldGroups.filter(g => g.conditions.length > 0) };
  }

  // Live preview for "יועץ מלווה" mode — one call (POST /person-tasks/schools/check) doubles as
  // both the "X בתי ספר נמצאו" count/table AND the pre-creation "בעיות" check, so there's no
  // separate /tasks/preview round-trip. Skipped entirely once a future schedule is chosen.
  useEffect(() => {
    if (assignmentMode !== "schools" || scheduledFor) return;
    const criteria = advisorCriteria();
    if (!criteria.groups.some(g => g.conditions.length > 0)) { setAdvisorCheck(null); return; }
    setAdvisorCheckLoading(true);
    const timer = setTimeout(() => {
      axios.post("/person-tasks/schools/check", { criteria, academic_year: academicYear })
        .then(r => setAdvisorCheck(r.data))
        .catch(() => setAdvisorCheck(null))
        .finally(() => setAdvisorCheckLoading(false));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentMode, scheduledFor, academicYear, JSON.stringify(advisorFieldGroups)]);
  const canProceedMetric = metricKind === "field"
    ? fieldGroups.some(g => g.conditions.length > 0)
    : true;

  // "problems" is only ever REACHED, never a guaranteed part of the flow (it appears only when
  // a routing check actually finds one) — counting it into totalSteps unconditionally made the
  // header say "שלב 2 מתוך 3" even on the (much more common) run where "צור משימה" at step 2
  // creates the task directly. Only count it once we're actually there.
  const totalSteps = step === "problems" ? 3 : 2;
  const stepIndex = ["details", "metric", "problems"].indexOf(step) + 1;

  async function handleMetricNext() {
    if (assignmentMode === "users" || scheduledFor) {
      await submitTask({});
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await axios.post("/person-tasks/schools/check", { criteria: advisorCriteria(), academic_year: academicYear });
      setAdvisorCheck(res.data);
      if ((res.data?.rows || []).some(r => r.kind !== "ok")) {
        setStep("problems");
      } else {
        await submitTask({});
      }
    } catch {
      setError("הבדיקה נכשלה — נסה שוב.");
    } finally {
      setChecking(false);
    }
  }

  function toggleCandidate(schoolId, division, candidateId) {
    const key = `${schoolId}:${division}`;
    setResolvedAssignees(prev => {
      const current = new Set(prev[key] || []);
      current.has(candidateId) ? current.delete(candidateId) : current.add(candidateId);
      return { ...prev, [key]: [...current] };
    });
  }

  const problemRows = (advisorCheck?.rows || []).filter(r => r.kind !== "ok");
  const unresolvedNoServiceType = problemRows.filter(r => r.kind === "no_service_type");
  const unresolvedMissing = problemRows.filter(r => r.kind === "missing");
  const unresolvedMultiple = problemRows.filter(r => r.kind === "multiple" && !(resolvedAssignees[`${r.school_id}:${r.division}`]?.length));
  const allProblemsResolved = unresolvedNoServiceType.length === 0 && unresolvedMissing.length === 0 && unresolvedMultiple.length === 0;

  async function submitTask(extraResolved) {
    setSubmitting(true);
    setError(null);
    try {
      const success_metric = metricKind === "field"
        ? { kind: "field", criteria: { groups: fieldGroups.filter(g => g.conditions.length > 0) } }
        : { kind: metricKind, label: metricLabel || undefined };
      const res = await axios.post("/person-tasks/", {
        name: name.trim(), description: description.trim() || null,
        due_date: dueDate || null, urgency,
        assignment_mode: assignmentMode,
        target_user_ids: assignmentMode === "users" ? selectedUserIds : null,
        target_criteria: assignmentMode === "schools" ? advisorCriteria() : null,
        academic_year: academicYear,
        success_metric,
        resolved_school_assignees: { ...resolvedAssignees, ...extraResolved },
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      });
      onCreated(res.data.id);
    } catch (err) {
      setError(err?.response?.data?.detail || "יצירת המשימה נכשלה — נסה שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryAfterFixingMissing() {
    setChecking(true);
    try {
      const res = await axios.post("/person-tasks/schools/check", { criteria: advisorCriteria(), academic_year: academicYear });
      setAdvisorCheck(res.data);
      if (!(res.data?.rows || []).some(r => r.kind !== "ok")) setStep("metric");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-task-wizard-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="person-task-wizard-title" className="font-bold text-slate-800">
            {STEP_TITLES[step]} — שלב {stepIndex} מתוך {totalSteps}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4 text-sm">
          {step === "details" && (
            <>
              <div>
                <span className="block text-xs font-semibold text-slate-600 mb-1">שנת לימודים</span>
                <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
              </div>
              <div>
                <label htmlFor="pt-name" className="block text-xs font-semibold text-slate-600 mb-1">שם המשימה</label>
                <input id="pt-name" value={name} onChange={e => setName(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="למשל: בדיקת חוזים לרבעון 3" />
              </div>
              <div>
                <label htmlFor="pt-desc" className="block text-xs font-semibold text-slate-600 mb-1">מה צריך לעשות? (ההסבר יוצג למשתמשים שעליהם מוטלת המשימה, מומלץ לכלול מהו המדד להשלמת המשימה)</label>
                <textarea id="pt-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="מה בדיוק צריך לבצע..." />
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <label htmlFor="pt-due" className="block text-xs font-semibold text-slate-600 mb-1">תאריך יעד (אופציונלי)</label>
                  <DirectStyleDateInput id="pt-due" value={dueDate} onChange={setDueDate} />
                </div>
                <div>
                  <label htmlFor="pt-urgency" className="block text-xs font-semibold text-slate-600 mb-1">רמת דחיפות</label>
                  <select id="pt-urgency" value={urgency} onChange={e => setUrgency(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-2 bg-white">
                    {Object.entries(URGENCY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-600 mb-2">על מי מוטלת המשימה?</p>
                <div className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 w-fit mb-3">
                  <button
                    type="button"
                    onClick={() => setAssignmentMode("schools")}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium ${assignmentMode === "schools" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    יועץ מלווה
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssignmentMode("users")}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium ${assignmentMode === "users" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    משתמשים ספציפיים
                  </button>
                </div>

                {assignmentMode === "schools" ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      יש לסנן את בתי הספר שהמשימה תוטל על היועצים המלווים שלהם.
                    </p>
                    <ConditionGroupsEditor
                      groups={advisorFieldGroups} setGroups={setAdvisorFieldGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes}
                      allowedTypes={["field"]} goalOptions={goalOptions} divisionOptions={divisionOptions}
                      budgetNameOptions={budgetNameOptions} controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
                      defaultGroupConditions={ADVISOR_DEFAULT_CONDITIONS}
                    />
                    {!advisorClientStatusSet && (
                      <p role="alert" className="text-xs text-red-600">יש לבחור ערך עבור "סטטוס לקוח" — שדה חובה.</p>
                    )}
                    {!advisorServiceTypeSet && (
                      <p role="alert" className="text-xs text-red-600">יש לבחור ערך עבור "סוג שירות" — שדה חובה.</p>
                    )}
                    {scheduledFor ? (
                      <p className="text-xs text-slate-600">
                        בתי הספר יחושבו אוטומטית בזמן ההפעלה, ב-<bdi>{new Date(scheduledFor).toLocaleString("he-IL")}</bdi>.
                      </p>
                    ) : (
                      <div>
                        <p className="text-xs text-slate-600 mb-1">
                          {advisorCheckLoading ? "סופר בתי ספר תואמים..." : `${advisorCheck?.total_schools ?? 0} בתי ספר נמצאו`}
                        </p>
                        {!!advisorCheck?.rows?.length && (
                          <div className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-slate-50">
                                <tr>
                                  <th scope="col" className="text-right px-2.5 py-1.5 font-semibold text-slate-600">בית ספר</th>
                                  <th scope="col" className="text-right px-2.5 py-1.5 font-semibold text-slate-600">יועץ מלווה</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {advisorCheck.rows.map((r, i) => (
                                  <tr key={`${r.school_id}-${r.division || "none"}-${i}`}>
                                    <td className="px-2.5 py-1.5 text-slate-800">
                                      {[r.school_name, r.authority, r.symbol].filter(Boolean).join(" - ")}
                                    </td>
                                    <td className="px-2.5 py-1.5 text-slate-700">
                                      {r.kind === "ok"
                                        ? `${r.advisor_name} [${r.division_label}]`
                                        : r.kind === "no_service_type"
                                          ? <span className="text-amber-700">לא הוגדר סוג שירות</span>
                                          : r.kind === "missing"
                                            ? <span className="text-amber-700">חסר יועץ [{r.division_label}]</span>
                                            : <span className="text-amber-700">כמה יועצים [{r.division_label}]</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label htmlFor="pt-user-search" className="sr-only">חיפוש משתמש</label>
                    <input
                      id="pt-user-search"
                      type="search"
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      placeholder="חיפוש לפי שם או אימייל..."
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
                    />
                    <div className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {filteredAssignableUsers.map(u => (
                        <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
                          <span className="text-slate-800">{u.full_name || u.email}</span>
                          <span className="text-xs text-slate-400">{u.role === "owner" ? "בעלים" : u.role === "manager" ? "מנהל" : "יועץ"}</span>
                        </label>
                      ))}
                      {filteredAssignableUsers.length === 0 && <p className="text-xs text-slate-400 px-3 py-3">לא נמצאו משתמשים</p>}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-1">
                <button type="button" onClick={() => setShowScheduleModal(true)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">
                  {scheduledFor ? `תזמון: ${new Date(scheduledFor).toLocaleString("he-IL")}` : "תזמון (אופציונלי)"}
                </button>
              </div>
            </>
          )}

          {step === "metric" && (
            <div className="space-y-3">
              <p className="text-slate-600">מה ייחשב הצלחה עבור משימה זו?</p>
              <div className="flex flex-wrap gap-2">
                {METRIC_KIND_OPTIONS.filter(o => assignmentMode === "schools" || o.value !== "field").map(o => (
                  <button key={o.value} type="button" aria-pressed={metricKind === o.value}
                    onClick={() => setMetricKind(o.value)}
                    className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                      metricKind === o.value ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}>
                    {o.pill}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">{METRIC_KIND_OPTIONS.find(o => o.value === metricKind)?.hint}</p>

              {metricKind === "field" && (
                <ConditionGroupsEditor
                  groups={fieldGroups} setGroups={setFieldGroups} fieldOptions={fieldOptions} meetingTypes={meetingTypes}
                  allowedTypes={["field"]} goalOptions={goalOptions} divisionOptions={divisionOptions}
                  budgetNameOptions={budgetNameOptions} controlLetterFields={controlLetterFields} goalValueOptions={goalValueOptions}
                />
              )}
              {(metricKind === "checkbox" || metricKind === "number" || metricKind === "file") && (
                <div>
                  <label htmlFor="pt-metric-label" className="block text-xs font-semibold text-slate-600 mb-1">
                    {metricKind === "checkbox"
                      ? 'טקסט הכפתור/הפעולה (למשל: "בדקתי את הדוח")'
                      : metricKind === "number"
                        ? "מה מייצג הערך המספרי (למשל: כמות שיחות)"
                        : "מה יש להעלות (למשל: קובץ אישור חתום)"}
                  </label>
                  <input id="pt-metric-label" value={metricLabel} onChange={e => setMetricLabel(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
                </div>
              )}
              {error && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}

          {step === "problems" && (
            <div className="space-y-3">
              <p className="text-slate-600">
                יש לפתור את הבעיות הבאות לפני יצירת המשימה — <b className="text-slate-800">{unresolvedNoServiceType.length + unresolvedMissing.length + unresolvedMultiple.length}</b> נותרו.
              </p>
              {problemRows.map((r, i) => (
                <div key={`${r.school_id}-${r.division || "none"}-${i}`} className="border border-amber-200 bg-amber-50/50 rounded-xl p-3 space-y-2">
                  <div className="text-sm">
                    <b className="text-slate-800">{r.school_name}</b>{" "}
                    {r.symbol && <bdi className="text-slate-400 text-xs">({r.symbol})</bdi>}
                    {r.division_label && <span className="text-xs text-slate-500"> · {r.division_label}</span>}
                  </div>
                  {PROBLEM_KIND_LABELS[r.kind] ? (
                    <p className="text-xs text-slate-700">{PROBLEM_KIND_LABELS[r.kind]}</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-slate-700">נמצאו כמה יועצים מלווים עבור החטיבה הזו — בחר/י אחד או שניהם:</p>
                      {r.candidates.map(c => (
                        <label key={c.id} className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={(resolvedAssignees[`${r.school_id}:${r.division}`] || []).includes(c.id)} onChange={() => toggleCandidate(r.school_id, r.division, c.id)} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {(unresolvedMissing.length > 0 || unresolvedNoServiceType.length > 0) && (
                <button type="button" onClick={retryAfterFixingMissing} disabled={checking} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60">
                  {checking ? "בודק..." : "בדוק שוב"}
                </button>
              )}
              {error && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              if (step === "metric") setStep("details");
              else if (step === "problems") setStep("metric");
              else onClose();
            }}
            className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50"
          >
            {step === "details" ? "ביטול" : "חזרה"}
          </button>

          {step === "details" && (
            <button type="button" onClick={() => setStep("metric")} disabled={!canProceedDetails} className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">המשך</button>
          )}
          {step === "metric" && (
            <button type="button" onClick={handleMetricNext} disabled={!canProceedMetric || checking || submitting} className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {checking ? "בודק..." : submitting ? "יוצר..." : "צור משימה"}
            </button>
          )}
          {step === "problems" && (
            <button type="button" onClick={() => submitTask({})} disabled={!allProblemsResolved || submitting} className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {submitting ? "יוצר..." : "צור משימה"}
            </button>
          )}
        </div>
      </div>

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
