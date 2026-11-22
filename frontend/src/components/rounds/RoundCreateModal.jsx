import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import ConditionGroupsEditor, { GEFEN_CURRENT_SPLIT_OPTIONS } from "../tasks/ConditionGroupsEditor";
import DirectStyleDateInput from "../tasks/DirectStyleDateInput";
import { SchoolMultiPickerModal } from "../meetings/SchoolPickerCell";
import { AcademicYearSelector } from "../AcademicYearSelector";
import { STAGE_SCOPE_OPTIONS } from "../tasks/taskShared";
import { DEFAULT_ACADEMIC_YEAR } from "../../constants/academicYears";
import PhysicalVisitorsModal from "./PhysicalVisitorsModal";
import AdvisorExclusionsEditor from "../tasks/AdvisorExclusionsEditor";
import RoundPlanStep, { missingParts, planPayload } from "./RoundPlanStep";

// "סבב פגישות חדש" — four short steps: name + period, which schools, what each needs, and the
// big constraint (which schools meet in person). Everything else (wording, channel, advisor
// calendar rules) is decided per task inside the round. See backend/routers/rounds_router.py.
// A round "לפי תוכנית הפגישות" (plan_mode "plan") adds a "מי צריך כמה" step: each school's own
// number of meetings from its card plan (RoundPlanStep, backend/meeting_plan.py).
const STEP_LABELS = { name: "שם ותקופה", schools: "בתי הספר", need: "מה צריך", plan: "מי צריך כמה", constraints: "אילוצים" };
const DEFAULT_CONDITIONS = [
  { type: "field", field: "client_status", op: "eq", value: "active" },
];
const TYPE_PILLS = [
  { value: "by_service", label: "לפי סוג שירות בכרטיס בית ספר" },
  { value: "gefen", label: "גפן" }, { value: "current", label: "שוטף" }, { value: "gefen_current", label: "גפן+שוטף" },
  { value: "district", label: "מחוז" }, { value: "takuma", label: "תקומה" },
];
const COUNT_OPTIONS = [1, 2, 3, 4, 5];
const EMPTY_PHYSICAL_GROUPS = [{ conditions: [{ type: "field", field: "", op: "eq", value: "" }] }];

// The physical-schools filter's conditions that can already be evaluated: a field condition
// counts once a field and a value were chosen. Empty groups are dropped; [] = no active filter.
function readyGroups(groups) {
  const ready = c => c.type !== "field" || (c.field && c.value !== "" && c.value != null && !(Array.isArray(c.value) && !c.value.length));
  return groups.map(g => ({ ...g, conditions: g.conditions.filter(ready) })).filter(g => g.conditions.length);
}

function pill(active) {
  return `text-sm px-4 py-1.5 rounded-lg border transition-colors ${active ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-black text-black hover:bg-slate-50"}`;
}

// round (optional) = "עריכת הסבב": the same steps, filled from the round; saving PATCHes it. The
// school list is rebuilt only when the filter or selection was changed.
export default function RoundCreateModal({ initialAcademicYear, onClose, onCreated, round = null }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const req0 = round?.requirement || {};
  const [step, setStep] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [name, setName] = useState(round?.name || "");
  const [academicYear, setAcademicYear] = useState(round?.academic_year || initialAcademicYear || DEFAULT_ACADEMIC_YEAR);
  const [startDate, setStartDate] = useState(round?.start_date || "");
  const [endDate, setEndDate] = useState(round?.end_date || "");
  const initialAudienceMode = round && !round.criteria ? "manual" : "filter";
  const initialGroups = round?.criteria?.groups?.length ? round.criteria.groups : [{ conditions: DEFAULT_CONDITIONS.map(c => ({ ...c })) }];
  const initialManualIds = round && !round.criteria ? round.school_ids || [] : [];
  const [audienceMode, setAudienceMode] = useState(initialAudienceMode);
  const [groups, setGroups] = useState(initialGroups);
  const [manualIds, setManualIds] = useState(initialManualIds);
  const [showPicker, setShowPicker] = useState(false);
  const [fieldOptions, setFieldOptions] = useState([]);
  const [allSchools, setAllSchools] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [type, setType] = useState(req0.meeting_service_type || "by_service");
  const [split, setSplit] = useState(req0.gefen_current_split || null);
  const [count, setCount] = useState(req0.count_per_school || 1);
  // "plan" = each school's number from its card plan; "fixed" = the same count for everyone.
  // An existing round keeps its mode (null for a new round until chosen).
  const [planMode, setPlanMode] = useState(round ? (round.plan_mode === "plan" ? "plan" : "fixed") : null);
  const [planRows, setPlanRows] = useState([]);
  const [planOverlaps, setPlanOverlaps] = useState([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [planAnswers, setPlanAnswers] = useState({});
  const [excludedIds, setExcludedIds] = useState(() => new Set(round?.excluded_school_ids || []));
  // In-person months in the plans pre-mark schools in "אילוצים" — once, for a new round only.
  const physicalPrefilledRef = useRef(false);
  const stepKeys = planMode === "plan" ? ["name", "schools", "need", "plan", "constraints"] : ["name", "schools", "need", "constraints"];
  const stepKey = stepKeys[step - 1];
  const [stageScope, setStageScope] = useState(req0.stage_scope || null);
  const [hasPhysical, setHasPhysical] = useState(round ? (round.physical_school_ids || []).length > 0 : null);
  const [physicalIds, setPhysicalIds] = useState(round?.physical_school_ids || []);
  const [physicalQuery, setPhysicalQuery] = useState("");
  // "סימון לפי סינון": the same field filter as step 2, run on the round's schools only.
  const [filterOpen, setFilterOpen] = useState(false);
  const [physicalGroups, setPhysicalGroups] = useState(EMPTY_PHYSICAL_GROUPS);
  const [physicalMatchIds, setPhysicalMatchIds] = useState(null); // null = no active filter
  const [physicalMatchLoading, setPhysicalMatchLoading] = useState(false);
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [physicalMatchError, setPhysicalMatchError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // "יועצים שקובעים לעצמם" — a new round starts from the org's default list (undefined until it loads).
  const [exclusions, setExclusions] = useState(round ? (round.advisor_exclusions || {}) : undefined);
  const [orgUsers, setOrgUsers] = useState([]);

  useEffect(() => {
    axios.get("/tasks/field-options").then(r => setFieldOptions(r.data?.fields || [])).catch(() => {});
    axios.get("/schools/").then(r => setAllSchools(r.data || [])).catch(() => {});
    axios.get("/schools/users/all").then(r => setOrgUsers(r.data || [])).catch(() => {});
  }, []);

  const criteria = { groups: audienceMode === "filter" ? groups : [] };
  const hasAudience = audienceMode === "manual" ? manualIds.length > 0 : groups.some(g => g.conditions.length > 0);
  useEffect(() => {
    if (!hasAudience) { setPreview(null); return; }
    let stale = false;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      axios.post("/tasks/preview", {
        criteria, manual_school_ids: audienceMode === "manual" ? manualIds : null, academic_year: academicYear,
      })
        .then(r => { if (!stale) setPreview(r.data); })
        .catch(() => { if (!stale) setPreview(null); })
        .finally(() => { if (!stale) setPreviewLoading(false); });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceMode, academicYear, JSON.stringify(groups), JSON.stringify(manualIds)]);

  const previewSchools = preview?.schools || [];
  const hasSixYear = previewSchools.some(s => s.stage === "sheshshnati");
  const activePhysicalGroups = readyGroups(physicalGroups);
  useEffect(() => {
    setPhysicalMatchError(false);
    if (!activePhysicalGroups.length) { setPhysicalMatchIds(null); setPhysicalMatchLoading(false); return; }
    let stale = false;
    setPhysicalMatchLoading(true);
    const timer = setTimeout(() => {
      axios.post("/tasks/preview", { criteria: { groups: activePhysicalGroups }, academic_year: academicYear })
        .then(r => { if (!stale) setPhysicalMatchIds(new Set((r.data?.schools || []).map(s => s.school_id))); })
        // A failed check must not read as "0 schools match" — show it, and offer no bulk action.
        .catch(() => { if (!stale) { setPhysicalMatchIds(null); setPhysicalMatchError(true); } })
        .finally(() => { if (!stale) setPhysicalMatchLoading(false); });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear, JSON.stringify(activePhysicalGroups)]);

  // The round's schools that match the filter (the preview itself runs on the whole org).
  const physicalMatches = useMemo(
    () => physicalMatchIds ? previewSchools.filter(s => physicalMatchIds.has(s.school_id)) : null,
    [previewSchools, physicalMatchIds],
  );
  const physicalIdSet = useMemo(() => new Set(physicalIds), [physicalIds]);
  // Marks outside the round (its school list changed in step 2) are kept in case the school comes
  // back, but they are never counted, validated or sent — the server would drop them anyway.
  const physicalIdsInRound = previewSchools.filter(s => physicalIdSet.has(s.school_id)).map(s => s.school_id);
  const physicalMatchSelected = physicalMatches ? physicalMatches.filter(s => physicalIdSet.has(s.school_id)).length : 0;
  const physicalCandidates = useMemo(() => {
    const q = physicalQuery.trim();
    let list = physicalMatches || previewSchools;
    if (showOnlySelected) list = list.filter(s => physicalIdSet.has(s.school_id));
    return q ? list.filter(s => `${s.school_name} ${s.symbol || ""} ${s.city || ""} ${s.authority || ""}`.includes(q)) : list;
  }, [previewSchools, physicalMatches, physicalQuery, showOnlySelected, physicalIdSet]);

  const planActiveRows = planRows.filter(r => !excludedIds.has(r.school_id));
  const stepValid = {
    name: name.trim() && startDate && endDate && startDate <= endDate,
    schools: hasAudience && !previewLoading && previewSchools.length > 0 && exclusions !== undefined,
    need: type && (type !== "by_service" || split) && (!hasSixYear || type === "current" || stageScope) && planMode,
    plan: !planLoading && !planError && planActiveRows.length > 0 && planActiveRows.every(r => !missingParts(r, planAnswers).length),
    constraints: hasPhysical === false || (hasPhysical === true && physicalIdsInRound.length > 0),
  };

  function next() {
    if (!stepValid[stepKey]) { setAttempted(true); return; }
    setAttempted(false);
    setStep(step + 1);
  }

  // The "מי צריך כמה" table — reloaded whenever the step opens (dates, schools or type may have changed).
  // Numbers typed in for other dates / schools / type no longer fit, so they are dropped then.
  const planInputsRef = useRef(null);
  useEffect(() => {
    if (stepKey !== "plan") return;
    const inputs = JSON.stringify([startDate, endDate, type, split, stageScope, audienceMode,
      audienceMode === "filter" ? groups : manualIds, exclusions]);
    if (planInputsRef.current !== null && planInputsRef.current !== inputs) setPlanAnswers({});
    planInputsRef.current = inputs;
    let stale = false;
    setPlanLoading(true);
    setPlanError("");
    axios.post("/rounds/plan-preview", {
      academic_year: academicYear, start_date: startDate, end_date: endDate,
      criteria: audienceMode === "filter" ? criteria : null,
      manual_school_ids: audienceMode === "manual" ? manualIds : null,
      requirement: requirementPayload(), advisor_exclusions: exclusions || {}, round_id: round?.id || null,
    })
      .then(r => { if (!stale) { setPlanRows(r.data?.schools || []); setPlanOverlaps(r.data?.overlaps || []); } })
      .catch(() => { if (!stale) setPlanError("טעינת תוכניות הפגישות נכשלה — חזרו שלב אחורה ונסו שוב."); })
      .finally(() => { if (!stale) setPlanLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // Schools whose plan has an in-person month inside the round (🏫).
  const planPhysicalIds = useMemo(
    () => planRows.filter(r => !excludedIds.has(r.school_id) && Object.values(r.parts).some(p => p.physical_months?.length)).map(r => r.school_id),
    [planRows, excludedIds],
  );
  const planPhysicalSet = useMemo(() => new Set(planPhysicalIds), [planPhysicalIds]);
  useEffect(() => {
    if (stepKey !== "constraints" || round || physicalPrefilledRef.current || !planPhysicalIds.length || planMode !== "plan") return;
    physicalPrefilledRef.current = true;
    setHasPhysical(true);
    setPhysicalIds(prev => Array.from(new Set([...prev, ...planPhysicalIds])));
  }, [stepKey, round, planPhysicalIds, planMode]);

  const [visitorConflicts, setVisitorConflicts] = useState(null); // schools for the "מי מגיע לשטח?" window

  function requirementPayload() {
    return {
      meeting_service_type: type, gefen_current_split: type === "by_service" ? split : null,
      count_per_school: planMode === "plan" ? 1 : count, stage_scope: hasSixYear && type !== "current" ? stageScope : null,
    };
  }

  // Before creating: physical גפן+שוטף schools with two different advisors must say who visits.
  async function submit() {
    if (!stepValid.constraints) { setAttempted(true); return; }
    if (hasPhysical && physicalIdsInRound.length && ["by_service", "gefen_current"].includes(type)) {
      setSaving(true);
      setError("");
      try {
        const r = await axios.post("/rounds/physical-check", {
          academic_year: academicYear, school_ids: physicalIdsInRound, requirement: requirementPayload(), advisor_exclusions: exclusions || {},
        });
        const conflicts = r.data?.schools || [];
        // Editing: schools already answered keep their answer; the window opens only for new ones.
        const known = round?.physical_visitors || {};
        if (conflicts.some(s => !known[s.school_id])) {
          setVisitorConflicts(conflicts);
          return;
        }
        if (conflicts.length) {
          await create(Object.fromEntries(conflicts.map(s => [s.school_id, known[s.school_id]])));
          return;
        }
      } catch {
        setError("בדיקת בתי הספר הפיזיים נכשלה — נסו שוב.");
        return;
      } finally {
        setSaving(false);
      }
    }
    await create({});
  }

  async function create(physicalVisitors) {
    setSaving(true);
    setError("");
    try {
      const common = {
        name: name.trim(), start_date: startDate, end_date: endDate,
        requirement: requirementPayload(),
        physical_school_ids: hasPhysical ? physicalIdsInRound : [],
        physical_visitors: hasPhysical ? physicalVisitors : {},
        advisor_exclusions: exclusions || {},
        ...(planMode === "plan" ? {
          school_plan: planPayload(planRows, planAnswers, excludedIds),
          excluded_school_ids: [...excludedIds],
        } : {}),
      };
      let res;
      if (round) {
        // The school list is rebuilt only from a changed filter or selection.
        const audienceChanged = audienceMode !== initialAudienceMode
          || JSON.stringify(audienceMode === "filter" ? groups : manualIds) !== JSON.stringify(audienceMode === "filter" ? initialGroups : initialManualIds);
        const audience = !audienceChanged ? {} : audienceMode === "manual" ? { manual_school_ids: manualIds } : { criteria };
        res = await axios.patch(`/rounds/${round.id}`, { ...common, ...audience });
      } else {
        res = await axios.post("/rounds/", {
          ...common, academic_year: academicYear, plan_mode: planMode === "plan" ? "plan" : null,
          criteria: audienceMode === "filter" ? criteria : null,
          manual_school_ids: audienceMode === "manual" ? manualIds : null,
        });
      }
      onCreated(res.data);
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(typeof detail === "string" ? detail
        : detail?.code === "missing_plan" ? `${detail.message}: ${(detail.schools || []).map(x => x.school_name).join(", ")}`
        : round ? "שמירת השינויים נכשלה — נסו שוב." : "יצירת הסבב נכשלה — נסו שוב.");
    } finally {
      setSaving(false);
    }
  }

  const invalid = cond => attempted && !cond ? "border border-red-400 rounded-lg p-1.5 -m-1.5" : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="round-create-title" onKeyDown={handleKeyDown}
        className="bg-white shadow-2xl rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="round-create-title" className="text-lg font-bold text-slate-800">{round ? "עריכת הסבב" : "סבב פגישות חדש"} — {STEP_LABELS[stepKey]} ({step} מתוך {stepKeys.length})</h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4 text-sm">
          {stepKey === "name" && (
            <>
              <p className="text-slate-600">
                סבב הוא מטרה אחת לתקופה — למשל "פגישות דצמבר". מגדירים פעם אחת מי צריך פגישה ואיזו, והסבב מראה בכל רגע מי כבר קבע, מי קיבל בקשה ומי עוד לא טופל. המשימות לקביעת הפגישות נוצרות מתוכו.
              </p>
              <div className="flex flex-col gap-1">
                <label htmlFor="round-name" className="text-xs font-medium text-black">שם הסבב</label>
                <input id="round-name" value={name} onChange={e => setName(e.target.value)} placeholder='למשל: פגישות דצמבר'
                  className={`text-sm border rounded-lg px-3 py-2 ${attempted && !name.trim() ? "border-red-400" : "border-black"}`} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-black">שנת לימודים</span>
                {round ? <span className="text-sm">{academicYear}</span> : <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="round-start" className="text-xs font-medium text-black">מתאריך</label>
                  <DirectStyleDateInput id="round-start" value={startDate} onChange={setStartDate} invalid={attempted && !startDate} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="round-end" className="text-xs font-medium text-black">עד תאריך</label>
                  <DirectStyleDateInput id="round-end" value={endDate} onChange={setEndDate} minDate={startDate || undefined} invalid={(attempted && !endDate) || (startDate && endDate && startDate > endDate)} />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">כל פגישה מתאימה בתקופה הזו נספרת לסבב — גם כזו שנקבעה בטלפון או במשימה אחרת.</p>
              {round && (
                <p role="note" className="text-[12px] bg-amber-50 text-amber-900 rounded-lg px-3 py-2">
                  עריכה משנה את הגדרת הסבב ואת החישוב בלוח שלו. משימות שכבר נשלחו מתוכו לא משתנות — בתי ספר שכבר קיבלו בקשה ממשיכים איתה.
                </p>
              )}
            </>
          )}

          {stepKey === "schools" && (
            <>
              <p className="text-slate-600">אילו בתי ספר צריכים פגישה בסבב הזה? הרשימה נשמרת כפי שהיא עכשיו, ואפשר לעדכן אותה מתוך הסבב בהמשך.</p>
              <div className="flex items-center gap-2 border border-black rounded-lg p-1 w-fit">
                {[["filter", "סינון"], ["manual", "בחירה ידנית"]].map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={audienceMode === v} onClick={() => setAudienceMode(v)}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium ${audienceMode === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
                ))}
              </div>
              {audienceMode === "filter" ? (
                <ConditionGroupsEditor groups={groups} setGroups={setGroups} fieldOptions={fieldOptions} meetingTypes={[]}
                  allSchools={allSchools} allowedTypes={["field"]} goalValueContext="audience"
                  defaultGroupConditions={DEFAULT_CONDITIONS} nonRemovableFields={["client_status"]} />
              ) : (
                <div>
                  <button type="button" onClick={() => setShowPicker(true)} className="text-sm px-4 py-2 rounded-xl font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">
                    {manualIds.length ? `בחירת בתי ספר (${manualIds.length} נבחרו)` : "בחירת בתי ספר..."}
                  </button>
                  {showPicker && <SchoolMultiPickerModal selectedIds={manualIds} onChange={setManualIds} onClose={() => setShowPicker(false)} />}
                </div>
              )}
              <div role="status" className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                {previewLoading ? "בודק..." : preview ? <><b>{preview.count}</b> בתי ספר בסבב</> : "בחרו בתי ספר"}
              </div>
              {attempted && !stepValid.schools && <p role="alert" className="text-xs text-red-600">יש לבחור לפחות בית ספר אחד.</p>}
              <AdvisorExclusionsEditor value={exclusions} onChange={setExclusions} users={orgUsers} idPrefix="round-exclusions" />
            </>
          )}

          {stepKey === "need" && (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-black">איזו פגישה כל בית ספר צריך?</legend>
                <div className={`flex flex-wrap gap-2 ${invalid(type)}`}>
                  {TYPE_PILLS.map(o => (
                    <button key={o.value} type="button" aria-pressed={type === o.value} onClick={() => setType(o.value)} className={pill(type === o.value)}>{o.label}</button>
                  ))}
                </div>
              </fieldset>
              {type === "by_service" && (
                <fieldset className="flex flex-col gap-1.5 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <legend className="text-xs font-medium text-black px-1">
                    בית ספר עם סוג שירות גפן+שוטף, שיש לו יועץ גפן ויועץ שוטף שונים — איך לקבוע? <span className="text-red-600">(שדה חובה)</span>
                  </legend>
                  <div className={`flex flex-wrap gap-2 ${invalid(split)}`}>
                    {GEFEN_CURRENT_SPLIT_OPTIONS.map(o => (
                      <button key={o.value} type="button" aria-pressed={split === o.value} onClick={() => setSplit(o.value)} className={`${pill(split === o.value)}${split === o.value ? "" : " bg-white"}`}>{o.label}</button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-600">גפן ← פגישת גפן, שוטף ← פגישת שוטף, מחוז ← מחוז, תקומה ← תקומה; גפן+שוטף עם אותו יועץ ← פגישה משותפת אחת.</p>
                </fieldset>
              )}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-black">כמה פגישות כל בית ספר צריך בתקופה?</legend>
                {round ? (
                  <p className="text-sm text-slate-700">{planMode === "plan" ? "לפי תוכנית הפגישות של כל בית ספר" : "מספר קבוע לכל בית ספר"}</p>
                ) : (
                  <div className={`flex flex-wrap gap-2 ${invalid(planMode)}`}>
                    <button type="button" aria-pressed={planMode === "plan"} onClick={() => setPlanMode("plan")} className={pill(planMode === "plan")}>לפי תוכנית הפגישות בכרטיס</button>
                    <button type="button" aria-pressed={planMode === "fixed"} onClick={() => setPlanMode("fixed")} className={pill(planMode === "fixed")}>מספר קבוע לכל בית ספר</button>
                  </div>
                )}
                {planMode === "plan" && (
                  <p className="text-[11px] text-slate-600">
                    כל בית ספר יקבל את מה שמגיע לו לפי התוכנית בכרטיס, כולל פגישות שלא התקיימו קודם. בשלב הבא תראו את הטבלה ותוכלו לשנות כל מספר.
                  </p>
                )}
              </fieldset>
              {planMode === "fixed" && (
                <div className="flex flex-col gap-1 w-48">
                  <label htmlFor="round-count" className="text-xs font-medium text-black">כמה פגישות לכל בית ספר?</label>
                  <select id="round-count" value={count} onChange={e => setCount(Number(e.target.value))} className="text-sm border border-black rounded-lg px-2.5 py-1.5">
                    {COUNT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
              {hasSixYear && type !== "current" && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="text-xs font-medium text-black">בתי ספר שש-שנתיים: לאילו חטיבות? <span className="text-red-600">(שדה חובה)</span></legend>
                  <div className={`flex flex-wrap gap-2 ${invalid(stageScope)}`}>
                    {STAGE_SCOPE_OPTIONS.map(o => (
                      <button key={o.value} type="button" aria-pressed={stageScope === o.value} onClick={() => setStageScope(o.value)}
                        className={`text-[13px] px-2.5 py-1.5 rounded-lg border ${stageScope === o.value ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-black text-black hover:bg-slate-50"}`}>{o.label}</button>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          )}

          {stepKey === "plan" && (
            <RoundPlanStep rows={planRows} loading={planLoading} error={planError} answers={planAnswers} setAnswers={setPlanAnswers}
              excludedIds={excludedIds} setExcludedIds={setExcludedIds} overlaps={planOverlaps} attempted={attempted} />
          )}

          {stepKey === "constraints" && (
            <>
              {planMode === "plan" && planPhysicalIds.length > 0 && (
                <p role="note" className="text-[12px] bg-amber-50 text-amber-900 rounded-lg px-3 py-2">
                  <span aria-hidden="true">🏫</span> ל-{planPhysicalIds.length} בתי ספר יש בתוכנית פגישה פיזית בתקופת הסבב{round ? "" : " — הם סומנו מראש למטה"}. זו רק הצעה: אפשר להוריד כל סימון. פגישה פיזית מוצעת לבית הספר רק בימי השטח של היועץ.
                </p>
              )}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-black">האם יש בתי ספר שהפגישה שלהם בסבב היא פיזית (היועץ מגיע לבית הספר)?</legend>
                <div className={`flex gap-2 ${invalid(hasPhysical !== null)}`}>
                  {[[true, "כן"], [false, "לא, כולן מרחוק"]].map(([v, l]) => (
                    <button key={String(v)} type="button" aria-pressed={hasPhysical === v} onClick={() => setHasPhysical(v)} className={pill(hasPhysical === v)}>{l}</button>
                  ))}
                </div>
              </fieldset>
              {hasPhysical && (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[12px] text-slate-600">
                    סמנו את בתי הספר שהפגישה שלהם פיזית. בתוך הסבב הם יוצגו בנפרד, כדי ליצור להם משימה עם מיקום "פיזי" ובתאריכים שבהם היועץ בשטח.
                  </p>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <span role="status" aria-live="polite" className="text-sm text-slate-800">
                      <b className="text-base text-blue-700">{physicalIdsInRound.length}</b> מתוך {previewSchools.length} בתי הספר בסבב סומנו כפגישה פיזית
                    </span>
                    {physicalIds.length > 0 && (
                      <button type="button" className="text-xs text-slate-600 hover:underline whitespace-nowrap" onClick={() => { setPhysicalIds([]); setShowOnlySelected(false); }}>נקה הכל</button>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200">
                    <button type="button" aria-expanded={filterOpen} aria-controls="round-physical-filter" onClick={() => setFilterOpen(o => !o)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg">
                      <span>סימון לפי סינון (למשל: כל בתי הספר בעיר מסוימת)</span>
                      <span aria-hidden="true">{filterOpen ? "▴" : "▾"}</span>
                    </button>
                    {filterOpen && (
                      <div id="round-physical-filter" className="flex flex-col gap-2 border-t border-slate-200 p-3">
                        <ConditionGroupsEditor groups={physicalGroups} setGroups={setPhysicalGroups} fieldOptions={fieldOptions} meetingTypes={[]}
                          allSchools={allSchools} allowedTypes={["field"]} goalValueContext="audience" />
                        <div role="status" className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                          {!activePhysicalGroups.length ? "בחרו שדה וערך כדי לראות כמה בתי ספר בסבב עונים לסינון."
                            : physicalMatchLoading ? "בודק..."
                            : physicalMatchError ? <span role="alert" className="text-red-600">בדיקת הסינון נכשלה — שנו את הסינון או נסו שוב.</span>
                            : <><b>{physicalMatches?.length || 0}</b> בתי ספר בסבב עונים לסינון{physicalMatchSelected > 0 && ` · ${physicalMatchSelected} מהם כבר מסומנים`}</>}
                        </div>
                        {physicalMatches && !physicalMatchLoading && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" disabled={!physicalMatches?.length || physicalMatchSelected === physicalMatches.length}
                              onClick={() => setPhysicalIds(prev => Array.from(new Set([...prev, ...physicalMatches.map(s => s.school_id)])))}
                              className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40">
                              סמן את כל ה-{physicalMatches?.length || 0}
                            </button>
                            <button type="button" disabled={!physicalMatchSelected}
                              onClick={() => { const drop = new Set(physicalMatches.map(s => s.school_id)); setPhysicalIds(prev => prev.filter(id => !drop.has(id))); }}
                              className="text-sm px-3 py-1.5 rounded-lg border border-black text-black bg-white hover:bg-slate-50 disabled:opacity-40">
                              בטל סימון מה-{physicalMatches?.length || 0}
                            </button>
                            <button type="button" onClick={() => setPhysicalGroups(EMPTY_PHYSICAL_GROUPS)} className="text-xs text-slate-500 hover:underline mr-auto">נקה סינון</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <label htmlFor="round-physical-search" className="sr-only">חיפוש בית ספר</label>
                    <input id="round-physical-search" value={physicalQuery} onChange={e => setPhysicalQuery(e.target.value)} placeholder="חיפוש לפי שם, סמל, עיר או בעלות..."
                      className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-1.5" />
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap cursor-pointer">
                      <input type="checkbox" checked={showOnlySelected} onChange={e => setShowOnlySelected(e.target.checked)} className="accent-blue-600" />
                      הצג רק מסומנים
                    </label>
                  </div>
                  {physicalMatches && (
                    <p className="text-[11px] text-slate-500">הרשימה מציגה רק את בתי הספר שעונים לסינון.</p>
                  )}
                  <ul className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {physicalCandidates.slice(0, 300).map(s => (
                      <li key={s.school_id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50">
                          <input type="checkbox" checked={physicalIdSet.has(s.school_id)} className="accent-blue-600"
                            onChange={() => setPhysicalIds(prev => prev.includes(s.school_id) ? prev.filter(x => x !== s.school_id) : [...prev, s.school_id])} />
                          <span>{[s.school_name, s.city, s.authority, s.symbol].filter(Boolean).join(" - ")}</span>
                          {planPhysicalSet.has(s.school_id) && <span className="text-[11px] text-amber-800">🏫 פיזית בתוכנית</span>}
                        </label>
                      </li>
                    ))}
                    {!physicalCandidates.length && <li className="px-3 py-2 text-xs text-slate-500">אין בתי ספר להצגה.</li>}
                  </ul>
                  {physicalCandidates.length > 300 && (
                    <p className="text-[11px] text-slate-500">מוצגים 300 מתוך {physicalCandidates.length} — צמצמו בחיפוש או בסינון. "סמן את כל ה-N" מסמן את כולם, גם את מי שלא מוצג.</p>
                  )}
                  {attempted && !physicalIdsInRound.length &&<p role="alert" className="text-xs text-red-600">יש לסמן לפחות בית ספר אחד, או לבחור "לא".</p>}
                </div>
              )}
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </>
          )}
        </div>

        {visitorConflicts && (
          <PhysicalVisitorsModal
            schools={visitorConflicts}
            initialVisitors={round?.physical_visitors || {}}
            onCancel={() => setVisitorConflicts(null)}
            onConfirm={(visitors) => { setVisitorConflicts(null); create(visitors); }}
          />
        )}

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={() => (step === 1 ? onClose() : setStep(step - 1))} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">
            {step === 1 ? "ביטול" : "הקודם"}
          </button>
          {step < stepKeys.length ? (
            <button type="button" onClick={next} className="btn-blue text-sm px-5 py-2">הבא</button>
          ) : (
            <button type="button" onClick={submit} disabled={saving} className="btn-blue text-sm px-5 py-2 disabled:opacity-50">{saving ? "שומר..." : round ? "שמור שינויים" : "צור סבב"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
