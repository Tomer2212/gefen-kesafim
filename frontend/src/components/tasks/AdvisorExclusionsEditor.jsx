import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// "יועצים שקובעים לעצמם": advisors who book some (or all) of their meetings themselves, so a
// meeting task / round never requests those parts — the school is asked only for what's left
// (task_logic.apply_advisor_exclusions). value = {advisor_id: ["all"] | ["gefen", ...]}.
// undefined = not set yet: filled from the org's default list (GET /tasks/advisor-exclusions-default)
// once it loads. A list that differs from the default can be saved as the new default.
export const EXCLUSION_TYPES = [
  { value: "gefen", label: "גפן" },
  { value: "current", label: "שוטף" },
  { value: "district", label: "מחוז" },
  { value: "takuma", label: "תקומה" },
];

export function exclusionTypesLabel(types) {
  if (!types?.length || types.includes("all")) return "כל הסוגים";
  return EXCLUSION_TYPES.filter(t => types.includes(t.value)).map(t => t.label).join(", ");
}

function sameMap(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every(k => JSON.stringify(a[k]) === JSON.stringify((b || {})[k]));
}

function TypesDialog({ name, initial, onCancel, onSave }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [mode, setMode] = useState(initial && !initial.includes("all") ? "some" : "all");
  const [types, setTypes] = useState(initial && !initial.includes("all") ? initial : []);
  const [attempted, setAttempted] = useState(false);

  function save() {
    if (mode === "some" && !types.length) { setAttempted(true); return; }
    onSave(mode === "all" ? ["all"] : EXCLUSION_TYPES.map(t => t.value).filter(v => types.includes(v)));
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="exclusion-types-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-3">
        <h2 id="exclusion-types-title" className="text-base font-bold text-slate-800">ממה להחריג את {name}?</h2>
        <p className="text-xs text-slate-500">
          בתי הספר לא יתבקשו לקבוע את הפגישות האלה איתו — הוא קובע אותן בעצמו. חלקים אחרים של הפגישה (למשל השוטף עם יועץ אחר) עדיין יתבקשו.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">סוגי הפגישות להחרגה</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="exclusion-mode" checked={mode === "all"} onChange={() => setMode("all")} />
            מכל סוגי הפגישות
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="exclusion-mode" checked={mode === "some"} onChange={() => setMode("some")} />
            רק מסוגים מסוימים
          </label>
          {mode === "some" && (
            <div className="flex flex-wrap gap-3 pr-6">
              {EXCLUSION_TYPES.map(t => (
                <label key={t.value} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={types.includes(t.value)}
                    onChange={e => setTypes(prev => e.target.checked ? [...prev, t.value] : prev.filter(v => v !== t.value))} />
                  {t.label}
                </label>
              ))}
            </div>
          )}
          {mode === "some" && (
            <p className="text-[11px] text-slate-500 pr-6">פגישת גפן+שוטף היא חלק גפן ועוד חלק שוטף — סמנו את שניהם כדי להחריג אותה כולה.</p>
          )}
        </fieldset>
        {attempted && <p role="alert" className="text-xs text-red-600">יש לסמן לפחות סוג אחד</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-50">ביטול</button>
          <button type="button" onClick={save} className="btn-blue text-sm px-5 py-2">אישור</button>
        </div>
      </div>
    </div>
  );
}

export default function AdvisorExclusionsEditor({ value, onChange, users = [], idPrefix = "exclusions" }) {
  const [orgDefault, setOrgDefault] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(null); // {id, initial}
  const [pickId, setPickId] = useState("");
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultMsg, setDefaultMsg] = useState("");

  useEffect(() => {
    axios.get("/tasks/advisor-exclusions-default")
      .then(r => {
        const d = r.data?.advisor_exclusions || {};
        setOrgDefault(d);
        if (value === undefined) onChange(d);
      })
      .catch(() => { setLoadFailed(true); if (value === undefined) onChange({}); });
  }, []);

  const list = value || {};
  const nameOf = id => { const u = users.find(x => x.id === id); return u ? (u.full_name || u.email) : "יועץ"; };
  const available = users.filter(u => !list[u.id]).sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "", "he"));
  const differs = orgDefault !== null && !sameMap(list, orgDefault);

  async function saveDefault() {
    setSavingDefault(true);
    setDefaultMsg("");
    try {
      const r = await axios.put("/tasks/advisor-exclusions-default", { advisor_exclusions: list });
      setOrgDefault(r.data?.advisor_exclusions || {});
      setDefaultMsg("נשמר כברירת המחדל של הארגון.");
    } catch {
      setDefaultMsg("השמירה נכשלה — נסו שוב.");
    } finally {
      setSavingDefault(false);
    }
  }

  return (
    <section aria-labelledby={`${idPrefix}-title`} className="border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
      <h3 id={`${idPrefix}-title`} className="text-sm font-bold text-slate-800">יועצים שקובעים לעצמם</h3>
      <p className="text-xs text-slate-500">
        לא תישלח בקשה לפגישות שלהם. בית ספר יתבקש רק את מה שנשאר — למשל אם יועץ הגפן מוחרג, רק פגישת שוטף עם יועץ השוטף.
        בית ספר שלא נשאר לו מה לקבוע לא יקבל בקשה.
      </p>
      {loadFailed && <p role="alert" className="text-xs text-amber-700">טעינת רשימת ברירת המחדל של הארגון נכשלה — הרשימה התחילה ריקה.</p>}
      <div className="flex flex-wrap gap-2">
        {Object.keys(list).length === 0 && <span className="text-xs text-slate-400">אין יועצים מוחרגים.</span>}
        {Object.entries(list).map(([id, types]) => (
          <span key={id} className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-full pr-3 pl-1.5 py-1">
            <button type="button" onClick={() => setEditing({ id, initial: types })} className="hover:underline"
              aria-label={`עריכת ההחרגה של ${nameOf(id)}`}>
              {nameOf(id)} — {exclusionTypesLabel(types)}
            </button>
            <button type="button" onClick={() => { const next = { ...list }; delete next[id]; onChange(next); }}
              aria-label={`הסרת ${nameOf(id)} מהרשימה`} className="text-amber-600 hover:text-red-600 px-1">✕</button>
          </span>
        ))}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <span className="flex flex-col gap-0.5">
          <label htmlFor={`${idPrefix}-pick`} className="text-[11px] text-slate-500">הוספת יועץ</label>
          <select id={`${idPrefix}-pick`} value={pickId} onChange={e => setPickId(e.target.value)} className="input-field text-sm py-1.5 min-w-[200px]">
            <option value="">בחרו יועץ...</option>
            {available.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
        </span>
        <button type="button" disabled={!pickId} onClick={() => setEditing({ id: pickId, initial: null })}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40">הוסף</button>
      </div>
      {differs && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <span className="text-slate-500">הרשימה שונה מברירת המחדל של הארגון.</span>
          <button type="button" disabled={savingDefault} onClick={saveDefault} className="text-blue-600 hover:underline">שמור גם כברירת מחדל לארגון</button>
          <button type="button" onClick={() => onChange(orgDefault)} className="text-slate-600 hover:underline">חזור לברירת המחדל</button>
        </div>
      )}
      {defaultMsg && <p role="status" className="text-xs text-slate-600">{defaultMsg}</p>}
      {editing && (
        <TypesDialog
          name={nameOf(editing.id)}
          initial={editing.initial}
          onCancel={() => setEditing(null)}
          onSave={types => { onChange({ ...list, [editing.id]: types }); setEditing(null); setPickId(""); }}
        />
      )}
    </section>
  );
}
