import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import ConditionGroupsEditor, { GEFEN_CURRENT_SPLIT_OPTIONS } from "../tasks/ConditionGroupsEditor";
import DirectStyleDateInput from "../tasks/DirectStyleDateInput";
import { SchoolMultiPickerModal } from "../meetings/SchoolPickerCell";
import { AcademicYearSelector } from "../AcademicYearSelector";
import { STAGE_SCOPE_OPTIONS } from "../tasks/taskShared";
import { DEFAULT_ACADEMIC_YEAR } from "../../constants/academicYears";

// "סבב פגישות חדש" — four short steps: name + period, which schools, what each needs, and the
// big constraint (which schools meet in person). Everything else (wording, channel, advisor
// calendar rules) is decided per task inside the round. See backend/routers/rounds_router.py.
const STEPS = ["שם ותקופה", "בתי הספר", "מה צריך", "אילוצים"];
const DEFAULT_CONDITIONS = [
  { type: "field", field: "client_status", op: "eq", value: "active" },
];
const TYPE_PILLS = [
  { value: "by_service", label: "לפי סוג שירות בכרטיס בית ספר" },
  { value: "gefen", label: "גפן" }, { value: "current", label: "שוטף" }, { value: "gefen_current", label: "גפן+שוטף" },
  { value: "district", label: "מחוז" }, { value: "takuma", label: "תקומה" },
];
const COUNT_OPTIONS = [1, 2, 3, 4, 5];

function pill(active) {
  return `text-sm px-4 py-1.5 rounded-lg border transition-colors ${active ? "bg-blue-600 border-blue-600 text-white font-semibold" : "border-black text-black hover:bg-slate-50"}`;
}

export default function RoundCreateModal({ initialAcademicYear, onClose, onCreated }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [step, setStep] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState(initialAcademicYear || DEFAULT_ACADEMIC_YEAR);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [audienceMode, setAudienceMode] = useState("filter");
  const [groups, setGroups] = useState([{ conditions: DEFAULT_CONDITIONS.map(c => ({ ...c })) }]);
  const [manualIds, setManualIds] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [fieldOptions, setFieldOptions] = useState([]);
  const [allSchools, setAllSchools] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [type, setType] = useState("by_service");
  const [split, setSplit] = useState(null);
  const [count, setCount] = useState(1);
  const [stageScope, setStageScope] = useState(null);
  const [hasPhysical, setHasPhysical] = useState(null);
  const [physicalIds, setPhysicalIds] = useState([]);
  const [physicalQuery, setPhysicalQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get("/tasks/field-options").then(r => setFieldOptions(r.data?.fields || [])).catch(() => {});
    axios.get("/schools/").then(r => setAllSchools(r.data || [])).catch(() => {});
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
  const physicalCandidates = useMemo(() => {
    const q = physicalQuery.trim();
    return q ? previewSchools.filter(s => `${s.school_name} ${s.symbol || ""} ${s.authority || ""}`.includes(q)) : previewSchools;
  }, [previewSchools, physicalQuery]);

  const stepValid = {
    1: name.trim() && startDate && endDate && startDate <= endDate,
    2: hasAudience && !previewLoading && previewSchools.length > 0,
    3: type && (type !== "by_service" || split) && (!hasSixYear || type === "current" || stageScope),
    4: hasPhysical === false || (hasPhysical === true && physicalIds.length > 0),
  };

  function next() {
    if (!stepValid[step]) { setAttempted(true); return; }
    setAttempted(false);
    setStep(step + 1);
  }

  async function submit() {
    if (!stepValid[4]) { setAttempted(true); return; }
    setSaving(true);
    setError("");
    try {
      const res = await axios.post("/rounds/", {
        name: name.trim(), academic_year: academicYear, start_date: startDate, end_date: endDate,
        criteria: audienceMode === "filter" ? criteria : null,
        manual_school_ids: audienceMode === "manual" ? manualIds : null,
        requirement: {
          meeting_service_type: type, gefen_current_split: type === "by_service" ? split : null,
          count_per_school: count, stage_scope: hasSixYear && type !== "current" ? stageScope : null,
        },
        physical_school_ids: hasPhysical ? physicalIds : [],
      });
      onCreated(res.data);
    } catch (e) {
      setError(typeof e.response?.data?.detail === "string" ? e.response.data.detail : "יצירת הסבב נכשלה — נסו שוב.");
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
          <h2 id="round-create-title" className="text-lg font-bold text-slate-800">סבב פגישות חדש — {STEPS[step - 1]} ({step} מתוך {STEPS.length})</h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4 text-sm">
          {step === 1 && (
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
                <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="round-start" className="text-xs font-medium text-black">מתאריך</label>
                  <DirectStyleDateInput id="round-start" value={startDate} onChange={setStartDate} invalid={attempted && !startDate} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="round-end" className="text-xs font-medium text-black">עד תאריך</label>
                  <DirectStyleDateInput id="round-end" value={endDate} onChange={setEndDate} invalid={(attempted && !endDate) || (startDate && endDate && startDate > endDate)} />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">כל פגישה מתאימה בתקופה הזו נספרת לסבב — גם כזו שנקבעה בטלפון או במשימה אחרת.</p>
            </>
          )}

          {step === 2 && (
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
              {attempted && !stepValid[2] && <p role="alert" className="text-xs text-red-600">יש לבחור לפחות בית ספר אחד.</p>}
            </>
          )}

          {step === 3 && (
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
                      <button key={o.value} type="button" aria-pressed={split === o.value} onClick={() => setSplit(o.value)} className={`${pill(split === o.value)} bg-white`}>{o.label}</button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-600">גפן ← פגישת גפן, שוטף ← פגישת שוטף, מחוז ← מחוז, תקומה ← תקומה; גפן+שוטף עם אותו יועץ ← פגישה משותפת אחת.</p>
                </fieldset>
              )}
              <div className="flex flex-col gap-1 w-48">
                <label htmlFor="round-count" className="text-xs font-medium text-black">כמה פגישות לכל בית ספר בתקופה?</label>
                <select id="round-count" value={count} onChange={e => setCount(Number(e.target.value))} className="text-sm border border-black rounded-lg px-2.5 py-1.5">
                  {COUNT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
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

          {step === 4 && (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-black">האם יש בתי ספר שהפגישה שלהם בסבב היא פיזית (היועץ מגיע לבית הספר)?</legend>
                <div className={`flex gap-2 ${invalid(hasPhysical !== null)}`}>
                  {[[true, "כן"], [false, "לא, כולן מרחוק"]].map(([v, l]) => (
                    <button key={String(v)} type="button" aria-pressed={hasPhysical === v} onClick={() => setHasPhysical(v)} className={pill(hasPhysical === v)}>{l}</button>
                  ))}
                </div>
              </fieldset>
              {hasPhysical && (
                <div className="flex flex-col gap-2">
                  <p className="text-[12px] text-slate-600">
                    סמנו את בתי הספר שהפגישה שלהם פיזית ({physicalIds.length} נבחרו). בתוך הסבב הם יוצגו בנפרד, כדי ליצור להם משימה עם מיקום "פיזי" ובתאריכים שבהם היועץ בשטח.
                  </p>
                  <label htmlFor="round-physical-search" className="sr-only">חיפוש בית ספר</label>
                  <input id="round-physical-search" value={physicalQuery} onChange={e => setPhysicalQuery(e.target.value)} placeholder="חיפוש..."
                    className="text-sm border border-slate-300 rounded-lg px-3 py-1.5" />
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="text-blue-600 hover:underline" onClick={() => setPhysicalIds(Array.from(new Set([...physicalIds, ...physicalCandidates.map(s => s.school_id)])))}>סמן את כל המוצגים</button>
                    <button type="button" className="text-slate-500 hover:underline" onClick={() => setPhysicalIds([])}>נקה</button>
                  </div>
                  <ul className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {physicalCandidates.slice(0, 300).map(s => (
                      <li key={s.school_id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50">
                          <input type="checkbox" checked={physicalIds.includes(s.school_id)} className="accent-blue-600"
                            onChange={() => setPhysicalIds(prev => prev.includes(s.school_id) ? prev.filter(x => x !== s.school_id) : [...prev, s.school_id])} />
                          <span>{[s.school_name, s.authority, s.symbol].filter(Boolean).join(" - ")}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {attempted && !physicalIds.length && <p role="alert" className="text-xs text-red-600">יש לסמן לפחות בית ספר אחד, או לבחור "לא".</p>}
                </div>
              )}
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={() => (step === 1 ? onClose() : setStep(step - 1))} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">
            {step === 1 ? "ביטול" : "הקודם"}
          </button>
          {step < STEPS.length ? (
            <button type="button" onClick={next} className="btn-blue text-sm px-5 py-2">הבא</button>
          ) : (
            <button type="button" onClick={submit} disabled={saving} className="btn-blue text-sm px-5 py-2 disabled:opacity-50">{saving ? "יוצר..." : "צור סבב"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
