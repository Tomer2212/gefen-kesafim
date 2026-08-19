import { useEffect, useState } from "react";
import axios from "axios";

// Extracts the single condition a field-kind success_metric's criteria tree must reduce to for
// inline editing to be possible ("one group, one condition") — anything more complex (multiple
// AND'd conditions, or multiple OR'd groups) has no single obvious "the field to edit" and falls
// back to a read-only description instead of guessing which one the user means.
export function getSingleCondition(metric) {
  const groups = metric?.criteria?.groups || [];
  if (groups.length !== 1) return null;
  const conditions = groups[0].conditions || [];
  if (conditions.length !== 1) return null;
  return conditions[0];
}

const OP_SYMBOLS = { eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" };

// "תכנון 70%"/"דיווח 25%" — goal.kind (planning/reporting, from GET /tasks/field-options'
// goal_options) + goal_number, exactly the short form the user asked for instead of the raw
// goal_key or the long GOAL_DEFINITIONS label ("יעד תכנון: לפחות 70% מתקציב הגפ\"ן").
function goalTitle(cond, goalOptions, budgetName, showBudget) {
  const def = (goalOptions || []).find(g => g.key === cond.goal_key);
  const base = def ? `${def.kind === "reporting" ? "דיווח" : "תכנון"} ${def.goal_number}%` : (cond.goal_key || "יעד");
  return showBudget ? `${base} (${budgetName})` : base;
}

// "{שם השדה}{מפעיל}{ערך}" — e.g. "סטטוס = טופל 1", "ימים למענה > 5", "חוזה נשלח = כן". Shared by
// control_letter and year_admin_data conditions (both are "update an existing field" in spirit,
// just on different tables) — resolves the raw stored value to its Hebrew option label when one
// exists (select/bool), otherwise falls back to the raw value as-is (text/number).
function fieldTitle(fieldDef, cond) {
  const label = fieldDef?.label || cond.field;
  const opSymbol = OP_SYMBOLS[cond.op] || "=";
  const opt = fieldDef?.options?.find(o => String(o.value) === String(cond.value));
  const valueLabel = opt ? opt.label : (typeof cond.value === "boolean" ? (cond.value ? "כן" : "לא") : cond.value);
  return `${label} ${opSymbol} ${valueLabel ?? "—"}`;
}

// Exact visual mirror of GoalsTab.jsx's own "כן"/"לא" toggle group (same classes, same
// direction:ltr trick, same red/green active colors) — the user explicitly asked this inline
// editor look identical to the school card's own יעדים tab, not just behave the same.
function YesNoGroup({ title, value, onChange, disabled, ariaLabel }) {
  const noClass = value === false ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  const yesClass = value === true ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-slate-500 whitespace-nowrap">{title}</span>
      <div
        role="group"
        aria-label={ariaLabel || title}
        className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
        style={{ direction: "ltr" }}
      >
        <button type="button" onClick={() => onChange(false)} aria-pressed={value === false} className={`px-3 py-1.5 transition-colors focus:outline-none ${noClass}`}>לא</button>
        <button type="button" onClick={() => onChange(true)} aria-pressed={value === true} className={`px-3 py-1.5 border-r border-slate-200 transition-colors focus:outline-none ${yesClass}`}>כן</button>
      </div>
    </div>
  );
}

// Inline editor for a field-kind person-task's single success condition — writes through to the
// SAME endpoint/table the school card's own "יעדים"/"מכתבי בקרה"/admin-data tabs use (PATCH
// /schools/{id}/goals, PUT /schools/{id}/control-letters/{division}, PUT
// /schools/{id}/year-admin-data), never a parallel/duplicate field — so an update here is
// visible everywhere that field is shown, and vice versa.
export default function FieldMetricEditor({ cond, targetDivisionType, schoolId, academicYear, fieldMeta, onSaved }) {
  const divisionType = cond.division_type || targetDivisionType;
  if (cond.type === "goal") {
    return <GoalMetricEditor cond={cond} divisionType={divisionType} schoolId={schoolId} academicYear={academicYear} fieldMeta={fieldMeta} onSaved={onSaved} />;
  }
  if (cond.type === "control_letter") {
    return <ControlLetterMetricEditor cond={cond} divisionType={divisionType} schoolId={schoolId} fieldMeta={fieldMeta} onSaved={onSaved} />;
  }
  const fieldDef = (fieldMeta?.fieldOptions || []).find(f => f.field === cond.field);
  if (!fieldDef || fieldDef.table !== "school_year_admin_data") {
    return <span className="text-xs text-slate-400">לא ניתן לעריכה כאן — יש לעדכן דרך כרטיס בית הספר</span>;
  }
  return <YearFieldMetricEditor cond={cond} fieldDef={fieldDef} schoolId={schoolId} academicYear={academicYear} onSaved={onSaved} />;
}

function GoalMetricEditor({ cond, divisionType, schoolId, academicYear, fieldMeta, onSaved }) {
  const budgetNames = cond.budget_names?.length ? cond.budget_names : (cond.budget_name ? [cond.budget_name] : []);
  const [metByBudget, setMetByBudget] = useState({});
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all(budgetNames.map(b =>
      axios.get(`/schools/${schoolId}/goals`, { params: { division_type: divisionType, budget_name: b, academic_year: academicYear } })
        .then(r => [b, (r.data?.goals || []).find(g => g.key === cond.goal_key)?.met ?? null])
        .catch(() => [b, null]),
    )).then(entries => { if (alive) setMetByBudget(Object.fromEntries(entries)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, divisionType, academicYear, cond.goal_key, budgetNames.join(",")]);

  async function setMet(budgetName, value) {
    // Clicking the already-active button toggles back to unset — same as the school card's own
    // GoalsTab.jsx behavior — rather than forcing a permanent choice once made.
    const newMet = metByBudget[budgetName] === value ? null : value;
    setSaving(budgetName);
    try {
      await axios.patch(`/schools/${schoolId}/goals`, {
        division_type: divisionType, budget_name: budgetName, goal_key: cond.goal_key, academic_year: academicYear, met: newMet,
      });
      setMetByBudget(prev => ({ ...prev, [budgetName]: newMet }));
      onSaved?.();
    } finally {
      setSaving(null);
    }
  }

  if (!budgetNames.length) return <span className="text-xs text-slate-400">לא ניתן לעריכה כאן</span>;

  return (
    <div className="flex flex-col gap-2 items-center">
      {budgetNames.map(b => (
        <YesNoGroup
          key={b}
          title={goalTitle(cond, fieldMeta?.goalOptions, b, budgetNames.length > 1)}
          value={metByBudget[b] ?? null}
          onChange={v => setMet(b, v)}
          disabled={saving === b}
        />
      ))}
    </div>
  );
}

function ControlLetterMetricEditor({ cond, divisionType, schoolId, fieldMeta, onSaved }) {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const fieldDef = (fieldMeta?.controlLetterFields || []).find(f => f.field === cond.field);

  useEffect(() => {
    let alive = true;
    axios.get(`/schools/${schoolId}/control-letters`).then(r => {
      if (!alive) return;
      const row = (r.data || []).find(x => x.division_type === divisionType);
      setValue(row?.[cond.field] ?? "");
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [schoolId, divisionType, cond.field]);

  async function save(newValue) {
    setSaving(true);
    try {
      await axios.put(`/schools/${schoolId}/control-letters/${divisionType}`, { [cond.field]: newValue });
      setValue(newValue);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <span className="text-xs text-slate-400">טוען...</span>;
  const title = fieldTitle(fieldDef, cond);
  const inputId = `cl-${cond.field}-${schoolId}-${divisionType}`;

  if (fieldDef?.type === "select") {
    return (
      <div className="flex flex-col items-center gap-1">
        <label className="text-xs text-slate-500 whitespace-nowrap" htmlFor={inputId}>{title}</label>
        <select id={inputId} value={value || ""} disabled={saving} onChange={e => save(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 bg-white">
          <option value="">—</option>
          {(fieldDef.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <label className="text-xs text-slate-500 whitespace-nowrap" htmlFor={inputId}>{title}</label>
      <input
        id={inputId}
        type={fieldDef?.type === "number" ? "number" : "text"}
        defaultValue={value ?? ""}
        disabled={saving}
        onBlur={e => { if (e.target.value !== String(value ?? "")) save(fieldDef?.type === "number" ? Number(e.target.value) : e.target.value); }}
        className="w-24 text-xs border border-slate-200 rounded-lg px-1.5 py-1"
      />
    </div>
  );
}

function YearFieldMetricEditor({ cond, fieldDef, schoolId, academicYear, onSaved }) {
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    axios.get(`/schools/${schoolId}/year-admin-data`, { params: { academic_year: academicYear } }).then(r => {
      if (!alive) return;
      setValue(r.data?.[cond.field] ?? "");
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [schoolId, academicYear, cond.field]);

  async function save(newValue) {
    setSaving(true);
    try {
      await axios.put(`/schools/${schoolId}/year-admin-data`, { [cond.field]: newValue }, { params: { academic_year: academicYear } });
      setValue(newValue);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <span className="text-xs text-slate-400">טוען...</span>;
  const title = fieldTitle(fieldDef, cond);
  const inputId = `yf-${cond.field}-${schoolId}`;

  if (fieldDef.type === "bool") {
    // Stored as boolean in school_year_admin_data itself (unlike the condition's own `value`,
    // which may be the "yes"/"no" string ConditionGroupsEditor's bool-field dropdown produces).
    const boolValue = typeof value === "boolean" ? value : (value === "yes" ? true : value === "no" ? false : null);
    return <YesNoGroup title={fieldDef.label} value={boolValue} onChange={save} disabled={saving} />;
  }
  if (fieldDef.type === "select") {
    return (
      <div className="flex flex-col items-center gap-1">
        <label className="text-xs text-slate-500 whitespace-nowrap" htmlFor={inputId}>{title}</label>
        <select id={inputId} value={value || ""} disabled={saving} onChange={e => save(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 bg-white">
          <option value="">—</option>
          {(fieldDef.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <label className="text-xs text-slate-500 whitespace-nowrap" htmlFor={inputId}>{title}</label>
      <input
        id={inputId}
        type={fieldDef.type === "number" ? "number" : "text"}
        defaultValue={value ?? ""}
        disabled={saving}
        onBlur={e => { if (e.target.value !== String(value ?? "")) save(fieldDef.type === "number" ? Number(e.target.value) : e.target.value); }}
        className="w-24 text-xs border border-slate-200 rounded-lg px-1.5 py-1"
      />
    </div>
  );
}
