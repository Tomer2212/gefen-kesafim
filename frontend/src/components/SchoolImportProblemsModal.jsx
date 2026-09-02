import { useMemo, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";
import HourMinuteInput from "./HourMinuteInput";

// Interactive resolution modal for the school Excel import. Mirrors the UX of
// MeetingImportProblemsModal: one card per problematic row, every problem must be
// resolved on the spot (or the row removed) before the import can run — the system
// never silently skips an unclear detail.

const COORDINATOR_ROLE_OPTIONS = [
  { value: "principal", label: "מנהל/ת" },
  { value: "secretary", label: "מנהלנ/ית" },
  { value: "finance_contact", label: "אחראי/ת כספים" },
];
const FINANCE_SOFTWARE_OPTIONS = [
  { value: "kesafim2000", label: "כספים 2000" },
  { value: "payscool", label: "פייסקול" },
  { value: "schoolcash", label: "סקולקאש" },
];
const SKIP = "__skip__";
const EMPTY = "__empty__"; // "leave this field empty" sentinel for select resolvers

function userLabel(list, id) {
  const u = list.find(x => x.id === id);
  return u ? (u.full_name || u.email || id) : id;
}

function InviteAdvisorForm({ onInvited, onCancel }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    if (!email.trim() || !fullName.trim()) { setErr("יש למלא אימייל ושם מלא"); return; }
    setBusy(true); setErr(null);
    try {
      const body = { email: email.trim(), full_name: fullName.trim(), role: "advisor", work_phone: phone.replace(/\D/g, "").slice(0, 10) || null };
      const res = await axios.post("/schools/users/invite", body);
      onInvited({ id: res.data.user_id, full_name: fullName.trim(), email: email.trim(), work_phone: body.work_phone || "", role: "advisor", status: "pending" });
    } catch (e) {
      setErr(e?.response?.data?.detail ? String(e.response.data.detail) : "הזמנת המשתמש נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-2.5 mt-1.5 space-y-2">
      <p className="text-[11px] font-semibold text-slate-600">הזמנת משתמש חדש</p>
      <div className="grid grid-cols-3 gap-2">
        <input aria-label="אימייל משתמש חדש" placeholder="אימייל" value={email} onChange={e => setEmail(e.target.value)}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
        <input aria-label="שם מלא של משתמש חדש" placeholder="שם מלא" value={fullName} onChange={e => setFullName(e.target.value)}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
        <input aria-label="טלפון של משתמש חדש" placeholder="טלפון (אופציונלי)" value={phone} onChange={e => setPhone(e.target.value)}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1.5" />
      </div>
      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={busy}
          className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
          {busy ? "מזמין..." : "הזמן ובחר"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-slate-500 hover:bg-slate-50">ביטול</button>
      </div>
    </div>
  );
}

export function SchoolImportProblemsModal({ rows, users, requiredTypesFor, onCommit, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [sessionUsers, setSessionUsers] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [res, setRes] = useState({});
  const [inviteOpenKey, setInviteOpenKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const allUsers = useMemo(() => [...(users || []), ...sessionUsers], [users, sessionUsers]);
  const reqFor = requiredTypesFor || (() => []);
  const problemRows = rows.filter(r => r.problems.length > 0);
  const okCount = rows.length - problemRows.length;

  function defaultRes(row) {
    // If the coordinator cell held a plain name (not an email / phone) that we could
    // not match to a contact role, prefill it as the name so the user only picks a role.
    const rawCoord = String(row.coordinatorRaw || "").trim();
    const coordNamePrefill = row.coordinatorName
      || (rawCoord && !rawCoord.includes("@") && !/^[\d\s\-()+.]+$/.test(rawCoord) ? rawCoord : "");
    return {
      name: row.name || "", symbol: row.symbol || "",
      coordRole: row.coordinator || "", coordName: coordNamePrefill,
      financeSoftware: undefined, // undefined = not chosen; "" = leave empty; canonical = chosen
      fields: {},  // field key -> resolved value (select string / number|null / minutes|null / array)
      drafts: {},  // field key -> working value before "אישור"
      picks: {}, adds: { gefen: [], current: [], district: [] },
    };
  }
  const getRes = (row) => res[row.rowIndex] || defaultRes(row);
  function patchRes(row, patch) {
    setRes(prev => {
      const cur = prev[row.rowIndex] || defaultRes(row);
      return { ...prev, [row.rowIndex]: { ...cur, ...patch } };
    });
  }
  const setPick = (row, k, v) => patchRes(row, { picks: { ...getRes(row).picks, [k]: v } });
  const addAdvisor = (row, t, id) => {
    if (!id) return;
    const cur = getRes(row);
    if (cur.adds[t].includes(id)) return;
    patchRes(row, { adds: { ...cur.adds, [t]: [...cur.adds[t], id] } });
  };
  const removeAdvisor = (row, t, id) => {
    const cur = getRes(row);
    patchRes(row, { adds: { ...cur.adds, [t]: cur.adds[t].filter(x => x !== id) } });
  };
  const setField = (row, field, val) => patchRes(row, { fields: { ...getRes(row).fields, [field]: val } });
  const clearField = (row, field) => patchRes(row, { fields: { ...getRes(row).fields, [field]: undefined } });
  const setDraft = (row, field, val) => patchRes(row, { drafts: { ...getRes(row).drafts, [field]: val } });
  function getDraft(row, fi) {
    const d = getRes(row).drafts;
    if (d && fi.field in d) return d[fi.field];
    if (fi.kind === "chips") return [...(fi.recognized || [])];
    if (fi.kind === "duration") return null;
    return "";
  }

  const advisorProblemList = (row) =>
    ["gefen", "current", "district"].flatMap(t => (row.advisorProblems[t] || []).map((p, i) => ({ ...p, _key: `${t}::${i}` })));

  function finalIds(row, t) {
    const r = getRes(row);
    const picks = Object.entries(r.picks)
      .filter(([k, v]) => k.startsWith(`${t}::`) && v && v !== SKIP)
      .map(([, v]) => v);
    return [...new Set([...(row.advisorBase[t] || []), ...picks, ...(r.adds[t] || [])])];
  }

  // Required advisor types recomputed live from whatever service type / client status
  // is currently in effect (a value resolved in this modal wins over the parsed one).
  function effRequiredTypes(row) {
    const f = getRes(row).fields;
    const svc = f.service_type !== undefined ? f.service_type : row.yearAdmin.service_type;
    const status = f.client_status !== undefined ? f.client_status : row.yearAdmin.client_status;
    return reqFor(svc || null, status || null) || [];
  }
  const typeLabel = (t) => (t === "gefen" ? "גפן" : t === "current" ? "שוטף" : "מחוז");

  function rowUnresolved(row) {
    if (excluded.has(row.rowIndex)) return [];
    const r = getRes(row);
    const items = [];
    if ((!row.name || !row.symbol) && !(r.name.trim() && r.symbol.trim())) items.push("identity");
    if ((!row.coordinator || !row.coordinatorName) && !(r.coordRole && r.coordName.trim())) items.push("coordinator");
    if (row.financeSoftwareIssue && r.financeSoftware === undefined) items.push("finance_software");
    for (const fi of (row.fieldIssues || [])) {
      if (r.fields[fi.field] === undefined) items.push(`field:${fi.field}`);
    }
    for (const p of advisorProblemList(row)) {
      if (!r.picks[p._key]) items.push(p._key);
    }
    for (const t of effRequiredTypes(row)) {
      if (finalIds(row, t).length === 0) items.push(`req::${t}`);
    }
    return items;
  }

  const remainingRows = problemRows.filter(r => rowUnresolved(r).length > 0);
  const allClear = remainingRows.length === 0;
  const includedCount = rows.length - excluded.size;

  function toggleExcluded(rowIndex) {
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex);
      return next;
    });
  }

  function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const commitRows = rows
        .filter(row => !excluded.has(row.rowIndex))
        .map(row => {
          const r = getRes(row);
          const school = { ...row.school };
          const yearAdmin = { ...row.yearAdmin };
          if (!row.name || !row.symbol) { school.name = r.name.trim(); school.symbol = r.symbol.trim(); }
          if (row.financeSoftwareIssue) school.finance_software = r.financeSoftware ?? "";
          for (const fi of (row.fieldIssues || [])) {
            const val = r.fields[fi.field];
            if (val === undefined) continue;
            (fi.target === "yearAdmin" ? yearAdmin : school)[fi.field] = val;
          }
          const needCoord = !row.coordinator || !row.coordinatorName;
          return {
            ...row,
            final: {
              school,
              yearAdmin,
              coordinator: {
                role: needCoord ? r.coordRole : row.coordinator,
                name: needCoord ? r.coordName.trim() : row.coordinatorName,
              },
              advisorIdsByType: {
                gefen: finalIds(row, "gefen"),
                current: finalIds(row, "current"),
                district: finalIds(row, "district"),
              },
            },
          };
        });
      onCommit(commitRows);
    } catch (e) {
      setSubmitError("אירעה שגיאה בהכנת הנתונים לייבוא");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-import-problems-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 id="school-import-problems-title" className="font-bold text-slate-800 text-lg">בדיקת שורות לייבוא</h2>
          <p className="text-sm text-slate-600 mt-1">יש לטפל בכל פרט שלא זוהה בוודאות לפני שניתן להריץ את הייבוא.</p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-2.5 text-sm">
          <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">מוכן לייבוא ללא בעיות: {okCount} שורות</p>
          {allClear && problemRows.length > 0 && (
            <p className="text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">כל הבעיות טופלו או שהשורות הוסרו — ניתן להמשיך ✓</p>
          )}
          {!allClear && (
            <p className="text-slate-600">נותרו <b className="text-slate-800">{remainingRows.length}</b> שורות עם בעיות לטיפול.</p>
          )}

          {problemRows.map(row => {
            const isExcluded = excluded.has(row.rowIndex);
            const isRowClear = isExcluded || rowUnresolved(row).length === 0;
            const r = getRes(row);
            const needIdentity = !row.name || !row.symbol;
            const needCoord = !row.coordinator || !row.coordinatorName;
            const needFinance = !!row.financeSoftwareIssue;
            const financeSelectValue = r.financeSoftware === undefined ? "" : r.financeSoftware === "" ? EMPTY : r.financeSoftware;
            return (
              <div key={row.rowIndex} className={`border rounded-xl p-3 ${isExcluded ? "border-slate-100 bg-slate-50 opacity-60" : isRowClear ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span aria-hidden="true" className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${isRowClear ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                      {isRowClear ? "✓" : "✕"}
                    </span>
                    <b className="text-slate-800">שורה {row.excelRow}</b>
                    <span className="text-slate-400 text-xs">
                      {(r.name || row.name || "ללא שם")} {(r.symbol || row.symbol) ? `(סמל ${r.symbol || row.symbol})` : ""}
                    </span>
                  </span>
                  <button type="button" onClick={() => toggleExcluded(row.rowIndex)} className="text-xs text-slate-400 hover:text-red-600">
                    {isExcluded ? "בטל הסרה" : "הסר שורה"}
                  </button>
                </div>

                {!isExcluded && (
                  <div className="space-y-2">
                    {needIdentity && (
                      <div className="bg-white rounded-lg border border-amber-100 p-2.5 space-y-1.5">
                        <p className="text-xs text-slate-700"><b>חסר שם בית ספר או סמל מוסד</b></p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`imp-name-${row.rowIndex}`} className="text-[11px] text-slate-500 block mb-0.5">שם מוסד</label>
                            <input id={`imp-name-${row.rowIndex}`} value={r.name} onChange={e => patchRes(row, { name: e.target.value })}
                              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
                          </div>
                          <div>
                            <label htmlFor={`imp-symbol-${row.rowIndex}`} className="text-[11px] text-slate-500 block mb-0.5">סמל מוסד</label>
                            <input id={`imp-symbol-${row.rowIndex}`} value={r.symbol} onChange={e => patchRes(row, { symbol: e.target.value })}
                              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
                          </div>
                        </div>
                      </div>
                    )}

                    {needCoord && (
                      <div className="bg-white rounded-lg border border-amber-100 p-2.5 space-y-1.5">
                        <p className="text-xs text-slate-700">
                          <b>מתאם/ת פגישות לא זוהה</b>
                          {row.coordinatorRaw ? <span className="text-slate-400"> — בקובץ: "{row.coordinatorRaw}"</span> : null}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`imp-coordrole-${row.rowIndex}`} className="text-[11px] text-slate-500 block mb-0.5">תפקיד</label>
                            <select id={`imp-coordrole-${row.rowIndex}`} value={r.coordRole} onChange={e => patchRes(row, { coordRole: e.target.value })}
                              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full bg-white">
                              <option value="">בחר תפקיד...</option>
                              {COORDINATOR_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`imp-coordname-${row.rowIndex}`} className="text-[11px] text-slate-500 block mb-0.5">שם מלא</label>
                            <input id={`imp-coordname-${row.rowIndex}`} value={r.coordName} onChange={e => patchRes(row, { coordName: e.target.value })}
                              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 w-full" />
                          </div>
                        </div>
                      </div>
                    )}

                    {needFinance && (
                      <div className={`rounded-lg border p-2.5 space-y-1.5 ${r.financeSoftware === undefined ? "bg-white border-amber-100" : "bg-emerald-50 border-emerald-200"}`}>
                        <p className="text-xs text-slate-700">
                          <b>תוכנת כספים לא זוהתה</b>
                          {row.financeSoftwareRaw ? <span className="text-slate-400"> — בקובץ: "{row.financeSoftwareRaw}"</span> : null}
                        </p>
                        <label htmlFor={`imp-finance-${row.rowIndex}`} className="sr-only">בחר תוכנת כספים</label>
                        <select id={`imp-finance-${row.rowIndex}`} value={financeSelectValue}
                          onChange={e => { if (e.target.value) patchRes(row, { financeSoftware: e.target.value === EMPTY ? "" : e.target.value }); }}
                          className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                          <option value="">בחר תוכנה...</option>
                          {FINANCE_SOFTWARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          <option value={EMPTY}>ללא תוכנת כספים (השאר ריק)</option>
                        </select>
                      </div>
                    )}

                    {(row.fieldIssues || []).map(fi => {
                      const done = r.fields[fi.field] !== undefined;
                      const inputId = `imp-fld-${row.rowIndex}-${fi.field}`;
                      const selVal = r.fields[fi.field] === undefined ? "" : r.fields[fi.field] === "" ? EMPTY : r.fields[fi.field];
                      const chipDraft = fi.kind === "chips" ? getDraft(row, fi) : null;
                      return (
                        <div key={fi.field} className={`rounded-lg border p-2.5 space-y-1.5 ${done ? "bg-emerald-50 border-emerald-200" : "bg-white border-amber-100"}`}>
                          <p className="text-xs text-slate-700">
                            <b>{fi.label} — לא זוהה</b>
                            {fi.raw ? <span className="text-slate-400"> — בקובץ: "{fi.raw}"</span> : null}
                          </p>

                          {fi.kind === "select" && (
                            <div className="flex items-center gap-2">
                              <label htmlFor={inputId} className="sr-only">{fi.label}</label>
                              <select id={inputId} value={selVal}
                                onChange={e => { if (e.target.value !== "") setField(row, fi.field, e.target.value === EMPTY ? "" : e.target.value); }}
                                className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                                <option value="">בחר...</option>
                                {fi.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                {fi.allowEmpty && <option value={EMPTY}>השאר ריק</option>}
                              </select>
                              {done && <button type="button" onClick={() => clearField(row, fi.field)} className="text-xs text-slate-400 hover:text-slate-700 underline">שנה</button>}
                            </div>
                          )}

                          {fi.kind === "number" && (
                            <div className="flex items-center gap-2">
                              <label htmlFor={inputId} className="sr-only">{fi.label}</label>
                              <input id={inputId} type="number" min="0" value={getDraft(row, fi)}
                                onChange={e => setDraft(row, fi.field, e.target.value)}
                                className="w-24 text-xs border border-amber-300 rounded-lg px-2 py-1.5" />
                              <button type="button"
                                onClick={() => setField(row, fi.field, getDraft(row, fi) === "" ? null : Number(getDraft(row, fi)))}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">אישור</button>
                              {done && <span className="text-xs text-emerald-800">נשמר: {r.fields[fi.field] ?? "ריק"}</span>}
                            </div>
                          )}

                          {fi.kind === "duration" && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <HourMinuteInput idPrefix={inputId} label={fi.label}
                                minutes={getDraft(row, fi)} onChange={v => setDraft(row, fi.field, v)} />
                              <button type="button" onClick={() => setField(row, fi.field, getDraft(row, fi) ?? null)}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">אישור</button>
                              {done && <span className="text-xs text-emerald-800">נשמר</span>}
                            </div>
                          )}

                          {fi.kind === "chips" && (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap gap-1">
                                {fi.options.map(o => {
                                  const on = chipDraft.includes(o.value);
                                  return (
                                    <button key={o.value} type="button"
                                      onClick={() => setDraft(row, fi.field, on ? chipDraft.filter(x => x !== o.value) : [...chipDraft, o.value])}
                                      className={`text-xs px-2 py-1 rounded-lg border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300"}`}>
                                      {o.label}
                                    </button>
                                  );
                                })}
                              </div>
                              <button type="button" onClick={() => setField(row, fi.field, [...chipDraft])}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700">אישור</button>
                              {done && <span className="text-xs text-emerald-800 mr-2">נשמר: {(r.fields[fi.field] || []).join(", ") || "ריק"}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {advisorProblemList(row).map(p => {
                      const picked = r.picks[p._key];
                      const done = !!picked;
                      const candidates = p.kind === "advisor_ambiguous" && p.candidateIds?.length
                        ? allUsers.filter(u => p.candidateIds.includes(u.id))
                        : allUsers;
                      return (
                        <div key={p._key} className={`rounded-lg border p-2.5 space-y-1.5 ${done ? "bg-emerald-50 border-emerald-200" : "bg-white border-amber-100"}`}>
                          <p className="text-xs text-slate-700">
                            <b>יועץ מלווה — {p.typeLabel}:</b>{" "}
                            {p.kind === "advisor_ambiguous"
                              ? <>"{p.token}" תואם למספר משתמשים — יש לבחור</>
                              : <>"{p.token}" לא זוהה כמשתמש במערכת</>}
                          </p>
                          {done ? (
                            <p className="text-xs text-emerald-800">
                              {picked === SKIP ? "דילוג על שיוך זה" : `נבחר: ${userLabel(allUsers, picked)}`}{" "}
                              <button type="button" onClick={() => setPick(row, p._key, "")} className="text-slate-400 hover:text-slate-700 underline">שנה</button>
                            </p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <select aria-label={`בחר יועץ עבור ${p.typeLabel}`} value="" onChange={e => e.target.value && setPick(row, p._key, e.target.value)}
                                className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                                <option value="">בחר משתמש...</option>
                                {candidates.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                              </select>
                              <button type="button" onClick={() => setPick(row, p._key, SKIP)}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-slate-500 hover:bg-slate-100">
                                דלג על שיוך זה
                              </button>
                              <button type="button" onClick={() => setInviteOpenKey(inviteOpenKey === `${row.rowIndex}:${p._key}` ? null : `${row.rowIndex}:${p._key}`)}
                                className="text-xs px-2.5 py-1.5 rounded-lg font-medium text-blue-600 hover:bg-blue-50">
                                הזמן משתמש חדש
                              </button>
                            </div>
                          )}
                          {inviteOpenKey === `${row.rowIndex}:${p._key}` && !done && (
                            <InviteAdvisorForm
                              onInvited={(u) => { setSessionUsers(prev => [...prev, u]); setPick(row, p._key, u.id); setInviteOpenKey(null); }}
                              onCancel={() => setInviteOpenKey(null)}
                            />
                          )}
                        </div>
                      );
                    })}

                    {effRequiredTypes(row).map(t => {
                      const ids = finalIds(row, t);
                      const missing = ids.length === 0;
                      return (
                        <div key={`req-${t}`} className={`rounded-lg border p-2.5 space-y-1.5 ${missing ? "bg-white border-amber-100" : "bg-emerald-50 border-emerald-200"}`}>
                          <p className="text-xs text-slate-700">
                            <b>יועץ מלווה — {typeLabel(t)} (חובה)</b> — נדרש לפחות יועץ אחד לפי סוג השירות שנבחר.
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {ids.map(id => (
                              <span key={id} className="inline-flex items-center gap-1 text-xs bg-slate-100 rounded-lg px-2 py-1">
                                {userLabel(allUsers, id)}
                                {(getRes(row).adds[t] || []).includes(id) && (
                                  <button type="button" aria-label="הסר יועץ" onClick={() => removeAdvisor(row, t, id)} className="text-slate-400 hover:text-red-600">×</button>
                                )}
                              </span>
                            ))}
                            <select aria-label={`הוסף יועץ ${typeLabel(t)}`} value="" onChange={e => { addAdvisor(row, t, e.target.value); e.target.value = ""; }}
                              className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white">
                              <option value="">הוסף יועץ...</option>
                              {allUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                            </select>
                          </div>
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
            <button type="button" onClick={handleSubmit} disabled={submitting || !allClear || includedCount === 0}
              className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {submitting ? "מייבא..." : `ייבא ${includedCount} בתי ספר`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
