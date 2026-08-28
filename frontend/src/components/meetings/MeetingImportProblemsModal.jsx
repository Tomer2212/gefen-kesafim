import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ACADEMIC_YEARS } from "../../constants/academicYears";

const STAGE_OPTIONS = [
  { value: "", label: "בחר שלב מוסד" },
  { value: "yesodi", label: "יסודי" },
  { value: "beinayim", label: "חטיבת ביניים" },
  { value: "tikkon", label: "תיכון" },
  { value: "sheshshnati", label: "שש שנתי" },
  { value: "other", label: "אחר" },
];
const DISTRICT_OPTIONS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"];
const STAGE_SCOPE_OPTIONS = [
  { value: "tichon", label: "תיכון" },
  { value: "chativa", label: 'חט"ב' },
  { value: "both", label: "שתיהן" },
];
const CONTACT_ROLES = [
  { key: "principal", label: "מנהל/ת" },
  { key: "secretary", label: "מנהלנ/ית" },
  { key: "finance_contact", label: "אחראי/ת כספים" },
];
const PROBLEM_TITLES = {
  school_not_found: "בית ספר לא נמצא",
  invalid_date: "לא ניתן לפענח את התאריך",
  academic_year_out_of_range: "תאריך מחוץ לשנות הלימודים המוכרות",
  mode_date_mismatch: "אי-התאמה בין מצב הייבוא לתאריך השורה",
  advisor_unresolved: "לא נמצא יועץ תואם",
  stage_scope_ambiguous: "היקף פגישה לא ברור (בית ספר שש-שנתי)",
  calendar_conflict: "התנגשות ביומן Outlook",
  possible_duplicate: "ייתכן שזו כפילות של פגישה קיימת",
};

function normStr(s) { return (s || "").trim().toLowerCase(); }

function InvalidDateFix({ rowIndex, onConfirm }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`fix-date-${rowIndex}`} className="sr-only">תאריך מתוקן</label>
      <input id={`fix-date-${rowIndex}`} type="date" value={value} onChange={e => setValue(e.target.value)}
        className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white" />
      <button type="button" disabled={!value} onClick={() => onConfirm(value)}
        className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
        אישור תאריך
      </button>
    </div>
  );
}

function QuickAddSchoolForm({ row, orgUsers, academicYear, onCreated, onCancel }) {
  const [draft, setDraft] = useState({
    name: row.data.school_name || "", symbol: row.data.school_symbol || "", stage: "", city: "", authority: "", district: "",
    service_type: "",
    advisor_gefen: "", advisor_current: "", advisor_district: "",
    principal_name: "", principal_phone: "", principal_email: "",
    secretary_name: "", secretary_phone: "", secretary_email: "",
    finance_contact_name: "", finance_contact_phone: "", finance_contact_email: "",
    coordinator_email: "", coordinator_phone: "",
  });
  const [needsCoordinatorPick, setNeedsCoordinatorPick] = useState(false);
  const [pickedRole, setPickedRole] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  function set(patch) { setDraft(p => ({ ...p, ...patch })); }

  const contactsEntered = CONTACT_ROLES.filter(r => draft[`${r.key}_name`]?.trim())
    .map(r => ({ role: r.key, label: r.label, name: draft[`${r.key}_name`], phone: draft[`${r.key}_phone`], email: draft[`${r.key}_email`] }));

  const requiredOk = draft.name.trim() && draft.symbol.trim() && draft.stage && draft.city.trim() && draft.authority.trim() && draft.district
    && (draft.coordinator_email.trim() || draft.coordinator_phone.trim());

  async function handleSubmit() {
    if (!requiredOk) { setError("יש למלא את כל שדות החובה, כולל לפחות פרט זיהוי אחד של מתאם הפגישות"); return; }
    setError(null);

    let coordinatorRole = null;
    let autoSecretary = null;
    if (contactsEntered.length === 0) {
      coordinatorRole = "secretary";
      autoSecretary = {
        secretary_name: "מתאם פגישות",
        secretary_phone: draft.coordinator_phone.trim() || null,
        secretary_email: draft.coordinator_email.trim() || null,
      };
    } else {
      const emailMatches = contactsEntered.filter(c => draft.coordinator_email.trim() && normStr(c.email) === normStr(draft.coordinator_email));
      const phoneMatches = contactsEntered.filter(c => draft.coordinator_phone.trim() && normStr(c.phone) === normStr(draft.coordinator_phone));
      const matchedRoles = new Set([...emailMatches, ...phoneMatches].map(c => c.role));
      if (matchedRoles.size === 1) {
        coordinatorRole = [...matchedRoles][0];
      } else if (pickedRole) {
        coordinatorRole = pickedRole;
      } else {
        setNeedsCoordinatorPick(true);
        return;
      }
    }

    setCreating(true);
    try {
      const payload = {
        name: draft.name.trim(), symbol: draft.symbol.trim(), stage: draft.stage,
        city: draft.city.trim(), authority: draft.authority.trim(), district: draft.district,
        meeting_coordinator: coordinatorRole,
      };
      for (const c of contactsEntered) {
        payload[`${c.role}_name`] = c.name.trim();
        if (c.phone?.trim()) payload[`${c.role}_phone`] = c.phone.trim();
        if (c.email?.trim()) payload[`${c.role}_email`] = c.email.trim();
      }
      if (autoSecretary) Object.assign(payload, autoSecretary);

      const res = await axios.post("/schools/", payload);
      const newSchoolId = res.data.id;

      if (draft.service_type) {
        try {
          await axios.put(`/schools/${newSchoolId}/year-admin-data`, { service_type: draft.service_type }, { params: { academic_year: academicYear } });
        } catch (e) { /* non-fatal, matches CLAUDE.md enrichment rule */ }
      }
      for (const div of ["gefen", "current", "district"]) {
        const advisorId = draft[`advisor_${div}`];
        if (advisorId) {
          try { await axios.post(`/schools/${newSchoolId}/advisors/${div}`, { advisor_id: advisorId }); } catch (e) { /* non-fatal */ }
        }
      }
      onCreated(newSchoolId, draft.name.trim());
    } catch (e) {
      setError(e?.response?.data?.detail || "יצירת בית הספר נכשלה — נסה שוב");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-3 space-y-3 mt-2">
      <p className="text-xs font-semibold text-slate-700">הוספת בית ספר חדש (טופס מקוצר)</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`qa-name-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">שם מוסד *</label>
          <input id={`qa-name-${row.row_index}`} value={draft.name} onChange={e => set({ name: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
        </div>
        <div>
          <label htmlFor={`qa-symbol-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">סמל מוסד *</label>
          <input id={`qa-symbol-${row.row_index}`} value={draft.symbol} onChange={e => set({ symbol: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
        </div>
        <div>
          <label htmlFor={`qa-stage-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">שלב מוסד *</label>
          <select id={`qa-stage-${row.row_index}`} value={draft.stage} onChange={e => set({ stage: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full bg-white">
            {STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`qa-city-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">עיר *</label>
          <input id={`qa-city-${row.row_index}`} value={draft.city} onChange={e => set({ city: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
        </div>
        <div>
          <label htmlFor={`qa-authority-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">בעלות *</label>
          <input id={`qa-authority-${row.row_index}`} value={draft.authority} onChange={e => set({ authority: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
        </div>
        <div>
          <label htmlFor={`qa-district-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">מחוז *</label>
          <select id={`qa-district-${row.row_index}`} value={draft.district} onChange={e => set({ district: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full bg-white">
            <option value="">בחר מחוז</option>
            {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="h-px bg-slate-100" />
      <p className="text-[11px] text-slate-500">אנשי קשר (אופציונלי)</p>
      {CONTACT_ROLES.map(r => (
        <div key={r.key} className="grid grid-cols-3 gap-2">
          <input aria-label={`שם ${r.label}`} placeholder={`שם ${r.label}`} value={draft[`${r.key}_name`]}
            onChange={e => set({ [`${r.key}_name`]: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
          <input aria-label={`טלפון ${r.label}`} placeholder={`טלפון ${r.label}`} value={draft[`${r.key}_phone`]}
            onChange={e => set({ [`${r.key}_phone`]: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
          <input aria-label={`מייל ${r.label}`} placeholder={`מייל ${r.label}`} value={draft[`${r.key}_email`]}
            onChange={e => set({ [`${r.key}_email`]: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
        </div>
      ))}

      <div className="h-px bg-slate-100" />
      <p className="text-[11px] text-slate-500">זיהוי מתאם/ת פגישות — נדרש לפחות אחד (לצורך שיוך, לא נשמר כשדה)</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`qa-coord-email-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">מייל מתאם/ת פגישות</label>
          <input id={`qa-coord-email-${row.row_index}`} value={draft.coordinator_email} onChange={e => set({ coordinator_email: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
        </div>
        <div>
          <label htmlFor={`qa-coord-phone-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">טלפון מתאם/ת פגישות</label>
          <input id={`qa-coord-phone-${row.row_index}`} value={draft.coordinator_phone} onChange={e => set({ coordinator_phone: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
        </div>
      </div>

      <div className="h-px bg-slate-100" />
      <p className="text-[11px] text-slate-500">אופציונלי: סוג שירות ויועץ מלווה לפי חלוקה</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`qa-service-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">סוג שירות</label>
          <select id={`qa-service-${row.row_index}`} value={draft.service_type} onChange={e => set({ service_type: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full bg-white">
            <option value="">— לא נבחר —</option>
            <option value="gefen">גפן</option>
            <option value="current">שוטף</option>
            <option value="gefen_current">גפן+שוטף</option>
            <option value="district">מחוז</option>
          </select>
        </div>
        {["gefen", "current", "district"].map(div => (
          <div key={div}>
            <label htmlFor={`qa-advisor-${div}-${row.row_index}`} className="text-[11px] text-slate-500 block mb-0.5">
              יועץ מלווה — {div === "gefen" ? "גפן" : div === "current" ? "שוטף" : "מחוז"}
            </label>
            <select id={`qa-advisor-${div}-${row.row_index}`} value={draft[`advisor_${div}`]} onChange={e => set({ [`advisor_${div}`]: e.target.value })} className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full bg-white">
              <option value="">— לא נבחר —</option>
              {orgUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </div>
        ))}
      </div>

      {needsCoordinatorPick && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-1.5">
          <p className="text-xs text-amber-800">לא ניתן היה לזהות אוטומטית את מתאם/ת הפגישות — יש לבחור מבין אנשי הקשר שהוזנו:</p>
          <select aria-label="בחר מתאם/ת פגישות" value={pickedRole} onChange={e => setPickedRole(e.target.value)} className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="">בחר...</option>
            {contactsEntered.map(c => <option key={c.role} value={c.role}>{c.label} ({c.name})</option>)}
          </select>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleSubmit} disabled={creating || !requiredOk || (needsCoordinatorPick && !pickedRole)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
          {creating ? "יוצר..." : "צור בית ספר ושייך לשורה"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg font-medium text-slate-500 hover:bg-slate-50">ביטול</button>
      </div>
    </div>
  );
}

export default function MeetingImportProblemsModal({ mode, rows, orgUsers, academicYear, onSubmit, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [resolvedKeys, setResolvedKeys] = useState(new Set());
  const [excludedRows, setExcludedRows] = useState(new Set());
  const [rowResolutions, setRowResolutions] = useState({}); // row_index -> partial resolution fields
  const [quickAddOpenFor, setQuickAddOpenFor] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);

  function key(type, rowIndex) { return `${type}:${rowIndex}`; }
  function isResolved(type, rowIndex) { return resolvedKeys.has(key(type, rowIndex)); }
  function markResolved(type, rowIndex) { setResolvedKeys(prev => new Set(prev).add(key(type, rowIndex))); }
  function setRowField(rowIndex, patch) {
    setRowResolutions(prev => ({ ...prev, [rowIndex]: { ...prev[rowIndex], ...patch } }));
  }
  function toggleExcluded(rowIndex) {
    setExcludedRows(prev => {
      const next = new Set(prev);
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex);
      return next;
    });
  }

  const problemRows = rows.filter(r => r.problems.length > 0);
  const okCount = rows.length - problemRows.length;

  function rowUnresolvedCount(r) {
    if (excludedRows.has(r.row_index)) return 0;
    return r.problems.filter(p => !isResolved(p.type, r.row_index)).length;
  }
  const remainingRows = problemRows.filter(r => rowUnresolvedCount(r) > 0);
  const allClear = remainingRows.length === 0;

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payloadRows = rows.map(r => {
        const res = rowResolutions[r.row_index] || {};
        return {
          ...r.data,
          row_index: r.row_index,
          excluded: excludedRows.has(r.row_index),
          school_id: res.school_id ?? r.data.resolved_school_id ?? r.data.school_id ?? null,
          resolved_advisor_id: res.resolved_advisor_id ?? r.data.resolved_advisor_id ?? null,
          academic_year_override: res.academic_year_override ?? r.data.academic_year_override ?? null,
          meeting_date_override: res.meeting_date_override ?? r.data.meeting_date_override ?? null,
          accept_mode_mismatch: res.accept_mode_mismatch ?? r.data.accept_mode_mismatch ?? false,
          accept_conflict: res.accept_conflict ?? r.data.accept_conflict ?? false,
          accept_duplicate: res.accept_duplicate ?? r.data.accept_duplicate ?? false,
          stage_scope: res.stage_scope ?? r.data.stage_scope_normalized ?? r.data.stage_scope ?? null,
        };
      });
      const res = await axios.post("/schools/meetings/import/commit", { mode, rows: payloadRows });
      setSubmitResult(res.data);
    } catch (e) {
      setSubmitError(e?.response?.data?.detail ? String(e.response.data.detail) : "הייבוא נכשל — נסה שוב");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitResult) {
    const hasErrors = submitResult.errors?.length > 0;
    const noneImported = submitResult.imported === 0;
    return (
      <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="import-done-title" onKeyDown={handleKeyDown}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
          <h2 id="import-done-title" className="font-bold text-slate-800">
            {noneImported ? "הייבוא נכשל" : hasErrors ? "הייבוא הושלם חלקית" : "הייבוא הושלם"}
          </h2>
          {!noneImported && (
            <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
              יובאו בהצלחה {submitResult.imported} פגישות ({submitResult.past} מהעבר, {submitResult.future} עתידיות)
            </p>
          )}
          {hasErrors && (
            <div role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 max-h-32 overflow-y-auto space-y-1">
              <p className="font-semibold">{submitResult.errors.length} שורות לא יובאו:</p>
              {submitResult.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
          <button type="button" onClick={() => onSubmit(submitResult)} className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700">
            סגור
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="import-problems-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="import-problems-title" className="font-bold text-slate-800">בדיקת שורות לייבוא</h2>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2.5 text-sm">
          <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">מוכן לייבוא: {okCount} שורות</p>
          {allClear && problemRows.length > 0 && (
            <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">כל הבעיות טופלו או הוסרו — ניתן להמשיך ✓</p>
          )}
          {!allClear && (
            <p className="text-slate-600">נותרו <b className="text-slate-800">{remainingRows.length}</b> שורות עם בעיות לטיפול.</p>
          )}

          {problemRows.map(r => {
            const isExcluded = excludedRows.has(r.row_index);
            const isRowClear = isExcluded || rowUnresolvedCount(r) === 0;
            return (
              <div key={r.row_index} className={`border rounded-xl p-3 ${isExcluded ? "border-slate-100 bg-slate-50 opacity-60" : isRowClear ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span aria-hidden="true" className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${isRowClear ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                      {isRowClear ? "✓" : "✕"}
                    </span>
                    <b className="text-slate-800">שורה {r.row_index + 1}</b>
                    <span className="text-slate-400 text-xs">
                      {r.data.school_name || ""} {r.data.school_symbol ? `(סמל ${r.data.school_symbol})` : ""} {r.data.meeting_date ? `· ${r.data.meeting_date}` : ""}
                    </span>
                  </span>
                  <button type="button" onClick={() => toggleExcluded(r.row_index)} className="text-xs text-slate-400 hover:text-red-600">
                    {isExcluded ? "בטל הסרה" : "הסר שורה"}
                  </button>
                </div>

                {!isExcluded && (
                  <div className="space-y-2">
                    {r.problems.map((p, i) => {
                      const done = isResolved(p.type, r.row_index);
                      if (done) {
                        return (
                          <div key={i} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                            <span aria-hidden="true" className="text-emerald-600 text-xs font-bold">✓</span>
                            <span className="text-xs text-emerald-800">{PROBLEM_TITLES[p.type] || p.type} — טופל</span>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className="bg-white rounded-lg border border-amber-100 p-2.5 space-y-1.5">
                          <p className="text-xs text-slate-700"><b>{PROBLEM_TITLES[p.type] || p.type}:</b> {p.detail}</p>

                          {p.type === "school_not_found" && (
                            quickAddOpenFor === r.row_index ? (
                              <QuickAddSchoolForm
                                row={r} orgUsers={orgUsers} academicYear={academicYear}
                                onCreated={(schoolId) => { setRowField(r.row_index, { school_id: schoolId }); markResolved("school_not_found", r.row_index); setQuickAddOpenFor(null); }}
                                onCancel={() => setQuickAddOpenFor(null)}
                              />
                            ) : (
                              <button type="button" onClick={() => setQuickAddOpenFor(r.row_index)}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
                                הוסף בית ספר חדש
                              </button>
                            )
                          )}

                          {p.type === "invalid_date" && (
                            <InvalidDateFix rowIndex={r.row_index}
                              onConfirm={(iso) => { setRowField(r.row_index, { meeting_date_override: iso }); markResolved("invalid_date", r.row_index); }} />
                          )}

                          {p.type === "academic_year_out_of_range" && (
                            <button type="button"
                              onClick={() => { setRowField(r.row_index, { academic_year_override: ACADEMIC_YEARS[0] }); markResolved("academic_year_out_of_range", r.row_index); }}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
                              לכלול ולשייך ל{ACADEMIC_YEARS[0]}
                            </button>
                          )}

                          {p.type === "mode_date_mismatch" && (
                            <button type="button"
                              onClick={() => { setRowField(r.row_index, { accept_mode_mismatch: true }); markResolved("mode_date_mismatch", r.row_index); }}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
                              לכלול כפי שהוא
                            </button>
                          )}

                          {p.type === "advisor_unresolved" && (
                            <select aria-label="בחר יועץ" defaultValue=""
                              onChange={e => { if (!e.target.value) return; setRowField(r.row_index, { resolved_advisor_id: e.target.value }); markResolved("advisor_unresolved", r.row_index); }}
                              className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                              <option value="" disabled>בחר יועץ...</option>
                              {orgUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                            </select>
                          )}

                          {p.type === "stage_scope_ambiguous" && (
                            <select aria-label="בחר היקף פגישה" defaultValue=""
                              onChange={e => { if (!e.target.value) return; setRowField(r.row_index, { stage_scope: e.target.value }); markResolved("stage_scope_ambiguous", r.row_index); }}
                              className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                              <option value="" disabled>בחר...</option>
                              {STAGE_SCOPE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          )}

                          {p.type === "calendar_conflict" && (
                            <button type="button"
                              onClick={() => { setRowField(r.row_index, { accept_conflict: true }); markResolved("calendar_conflict", r.row_index); }}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
                              לכלול למרות ההתנגשות
                            </button>
                          )}

                          {p.type === "possible_duplicate" && (
                            <button type="button"
                              onClick={() => { setRowField(r.row_index, { accept_duplicate: true }); markResolved("possible_duplicate", r.row_index); }}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">
                              לייבא בכל זאת
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {submitError && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 flex-wrap">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">ביטול</button>
          <div className="flex flex-col items-end gap-1">
            {!allClear && <span className="text-xs text-slate-500">יש לטפל בכל הבעיות או להסיר את השורות הבעייתיות כדי להמשיך</span>}
            <button type="button" onClick={handleSubmit} disabled={submitting || !allClear}
              className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {submitting ? "מייבא..." : `ייבא ${rows.length - excludedRows.size} שורות`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
