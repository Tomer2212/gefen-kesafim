import { useEffect, useState } from "react";
import axios from "axios";
import { MultiSelectChips } from "../components/MultiSelectChips";

// ניהול → "הגדרות": the org's details + office phones. Backend: routers/org_settings_router.py.
// Owner-only fields stay read-only for managers even with edit permission (the API refuses them).
// An office phone's calls lines are the same lines as "שיוך קו שיחות" in the users tab — a line
// belongs to a user or to an office phone, never both.

const BUSINESS_TYPE_OPTIONS = [
  { value: "osek_patur", label: "עוסק פטור" },
  { value: "osek_murshe", label: "עוסק מורשה" },
  { value: "company", label: 'חברה בע"מ' },
];

const DETAIL_FIELDS = [
  { key: "name", label: "שם הארגון", ownerOnly: true },
  { key: "business_number", label: "ח.פ / מספר עוסק", ownerOnly: true },
  { key: "business_type", label: "סוג עוסק", ownerOnly: true, select: BUSINESS_TYPE_OPTIONS },
  { key: "owner_name", label: "שם הבעלים", ownerOnly: true },
  {
    key: "org_email", label: "מייל הארגון", ownerOnly: true, type: "email",
    hint: "מייל הארגון לצורכי רישום בלבד — אינו משנה את המייל שאיתו הבעלים מתחבר למערכת.",
  },
  { key: "owner_phone", label: "טלפון הבעלים", type: "tel" },
];

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("he-IL");
}

function errorText(err, fallback) {
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function detailsFrom(org) {
  return Object.fromEntries(DETAIL_FIELDS.map(f => [f.key, org?.[f.key] || ""]));
}

export default function OrgSettingsTab() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({});
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsMsg, setDetailsMsg] = useState({ type: "", text: "" });
  const [phonesError, setPhonesError] = useState("");
  const [drafts, setDrafts] = useState([]);           // new, unsaved phone rows
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  async function load() {
    setLoadError("");
    try {
      const res = await axios.get("/org-settings");
      setData(res.data);
      setForm(detailsFrom(res.data.org));
      // An org with no office phone yet starts with one "טלפון משרד" row to fill in.
      if (!res.data.phones?.length) setDrafts(d => d.length ? d : [{ tempId: "first", label: "טלפון משרד", phone: "" }]);
    } catch (err) {
      setLoadError(errorText(err, "לא ניתן לטעון את הגדרות הארגון — נסו לרענן"));
    }
  }
  useEffect(() => { load(); }, []);

  if (loadError) {
    return <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{loadError}</div>;
  }
  if (!data) {
    return (
      <div role="status" aria-label="טוען הגדרות ארגון" className="flex justify-center py-16">
        <div aria-hidden="true" className="spinner w-8 h-8" />
      </div>
    );
  }

  const { org, phones, users, calls, permissions } = data;
  const canEdit = permissions.can_edit;
  const isOwner = permissions.is_owner;
  const fieldEditable = (f) => canEdit && (!f.ownerOnly || isOwner);
  const original = detailsFrom(org);
  const dirtyKeys = DETAIL_FIELDS.filter(f => fieldEditable(f) && (form[f.key] || "") !== (original[f.key] || "")).map(f => f.key);

  async function saveDetails() {
    setSavingDetails(true);
    setDetailsMsg({ type: "", text: "" });
    try {
      await axios.put("/org-settings/details", Object.fromEntries(dirtyKeys.map(k => [k, form[k]])));
      await load();
      setDetailsMsg({ type: "ok", text: "הפרטים נשמרו" });
    } catch (err) {
      setDetailsMsg({ type: "error", text: errorText(err, "השמירה נכשלה — נסו שוב") });
    } finally {
      setSavingDetails(false);
    }
  }

  function patchPhoneLocal(id, patch) {
    setData(d => ({ ...d, phones: d.phones.map(p => (p.id === id ? { ...p, ...patch } : p)) }));
  }

  // Not optimistic: on failure the text field keeps what was typed (and blur re-sends it).
  async function savePhone(phone, patch) {
    setPhonesError("");
    try {
      const res = await axios.put(`/org-settings/phones/${phone.id}`, patch);
      patchPhoneLocal(phone.id, { label: res.data.label, phone: res.data.phone, handler_ids: res.data.handler_ids });
    } catch (err) {
      setPhonesError(errorText(err, "השמירה נכשלה — נסו שוב"));
    }
  }

  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

  async function saveLines(phone, keys) {
    setPhonesError("");
    try {
      const res = await axios.put(`/org-settings/phones/${phone.id}/lines`, { agent_keys: keys });
      patchPhoneLocal(phone.id, { lines: res.data.lines });
    } catch (err) {
      setPhonesError(errorText(err, "שיוך הקו נכשל — נסו שוב"));
    }
  }

  async function createDraft(draft) {
    setPhonesError("");
    if (!draft.label.trim() || !draft.phone.trim()) {
      setPhonesError("יש למלא שם ומספר טלפון");
      return;
    }
    try {
      const res = await axios.post("/org-settings/phones", { label: draft.label, phone: draft.phone });
      setDrafts(ds => ds.filter(d => d.tempId !== draft.tempId));
      setData(d => ({ ...d, phones: [...d.phones, res.data] }));
    } catch (err) {
      setPhonesError(errorText(err, "השמירה נכשלה — נסו שוב"));
    }
  }

  async function deletePhone(phone) {
    setPhonesError("");
    try {
      await axios.delete(`/org-settings/phones/${phone.id}`);
      setConfirmDeleteId(null);
      setData(d => ({ ...d, phones: d.phones.filter(p => p.id !== phone.id) }));
    } catch (err) {
      setPhonesError(errorText(err, "המחיקה נכשלה — נסו שוב"));
    }
  }

  const userOptions = (users || []).map(u => ({ value: u.id, label: u.full_name || u.email }));
  const usedByPhones = new Set(phones.flatMap(p => (p.lines || []).map(l => l.agent_key)));
  const takenByUsers = new Set(calls.taken_agent_keys || []);
  const lineLabel = (key) => (calls.known_agents || []).find(a => a.agent_key === key)?.agent_label || key;
  const showCalls = calls.enabled;

  return (
    <div className="flex flex-col gap-8" dir="rtl">
      {/* ---------------- Org details ---------------- */}
      <section aria-labelledby="org-details-title">
        <h2 id="org-details-title" className="text-xl font-bold text-slate-800 mb-3">פרטי הארגון</h2>
        <div className="glass-card rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {DETAIL_FIELDS.map(f => {
                const editable = fieldEditable(f);
                const inputId = `org-field-${f.key}`;
                return (
                  <tr key={f.key} className="border-b border-slate-100">
                    <th scope="row" className="text-right align-top px-5 py-3 font-semibold text-slate-600 whitespace-nowrap w-56">
                      <label htmlFor={editable ? inputId : undefined}>{f.label}</label>
                      {f.ownerOnly && !isOwner && (
                        <span className="block text-[11px] font-normal text-slate-400 mt-0.5">ניתן לעריכה ע"י הבעלים בלבד</span>
                      )}
                    </th>
                    <td className="px-5 py-3">
                      {editable ? (
                        f.select ? (
                          <select id={inputId} className="input-field max-w-sm" value={form[f.key] || ""}
                            onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}>
                            <option value="">— בחר —</option>
                            {f.select.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input id={inputId} type={f.type || "text"} dir={f.type ? "ltr" : undefined}
                            className="input-field max-w-sm text-right" value={form[f.key] || ""}
                            onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} />
                        )
                      ) : (
                        <span className="text-slate-800">
                          {f.select ? (f.select.find(o => o.value === org[f.key])?.label || "—") : (org[f.key] || "—")}
                        </span>
                      )}
                      {f.key === "org_email" && org.org_email_is_default && (
                        <p className="text-[11px] text-slate-400 mt-1">כרגע מוצג המייל שאיתו הבעלים נרשם למערכת.</p>
                      )}
                      {f.hint && <p className="text-[11px] text-slate-500 mt-1">{f.hint}</p>}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row" className="text-right px-5 py-3 font-semibold text-slate-600">תאריך הצטרפות</th>
                <td className="px-5 py-3 text-slate-800">{fmtDate(org.created_at)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3 mt-3">
            <button type="button" onClick={saveDetails} disabled={!dirtyKeys.length || savingDetails}
              className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
              {savingDetails ? "שומר..." : "שמור פרטים"}
            </button>
            {dirtyKeys.length > 0 && !savingDetails && (
              <button type="button" onClick={() => setForm(original)} className="btn-ghost px-4 py-2 text-sm">ביטול שינויים</button>
            )}
            {detailsMsg.text && (
              <span role={detailsMsg.type === "error" ? "alert" : "status"}
                className={`text-sm ${detailsMsg.type === "error" ? "text-red-600" : "text-green-600"}`}>
                {detailsMsg.text}
              </span>
            )}
          </div>
        )}
      </section>

      {/* ---------------- Office phones ---------------- */}
      <section aria-labelledby="org-phones-title">
        <h2 id="org-phones-title" className="text-xl font-bold text-slate-800 mb-1">טלפוני משרד</h2>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          שיחות עם מספרי המשרד יוצגו בטבלאות השיחות בשם הטלפון (למשל "{(phones[0]?.label || "טלפון משרד")} – {org.name}"),
          ולא יקפיצו התראה על "מספר לא מוכר".
          {showCalls && <> קו שיחות שמשויך כאן לא ישויך לאף משתמש, ו"המטפלים" שנבחרו יקבלו את השאלות על השיחות בקו ("מאיזה בית ספר?" / "מספר לא מוכר") ויראו אותן ב"השיחות שלי".</>}
        </p>
        {phonesError && <div role="alert" className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{phonesError}</div>}
        <div className="glass-card rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#1e3a5f" }}>
                <th scope="col" className="text-right px-4 py-3 font-semibold text-white">שם הטלפון</th>
                <th scope="col" className="text-right px-4 py-3 font-semibold text-white">מספר</th>
                {showCalls && <th scope="col" className="text-right px-4 py-3 font-semibold text-white">שיוך קו שיחות</th>}
                {showCalls && <th scope="col" className="text-right px-4 py-3 font-semibold text-white">מטפלים</th>}
                {canEdit && <th scope="col" className="px-4 py-3"><span className="sr-only">פעולות</span></th>}
              </tr>
            </thead>
            <tbody>
              {phones.map(p => {
                const ownLines = (p.lines || []).map(l => l.agent_key);
                const lineOptions = (calls.known_agents || [])
                  .filter(a => ownLines.includes(a.agent_key) || (!takenByUsers.has(a.agent_key) && !usedByPhones.has(a.agent_key)))
                  .map(a => ({ value: a.agent_key, label: a.agent_label || a.agent_key }));
                return (
                  <tr key={p.id} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-2.5">
                      {canEdit ? (
                        <PhoneTextInput ariaLabel="שם הטלפון" value={p.label} onCommit={v => v !== p.label && savePhone(p, { label: v })} />
                      ) : <span>{p.label}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {canEdit ? (
                        <PhoneTextInput ariaLabel={`מספר — ${p.label}`} type="tel" value={p.phone || ""}
                          onCommit={v => v !== (p.phone || "") && savePhone(p, { phone: v })} />
                      ) : <span dir="ltr">{p.phone || "—"}</span>}
                    </td>
                    {showCalls && (
                      <td className="px-4 py-2.5 min-w-[11rem]">
                        {canEdit ? (
                          <MultiSelectChips compact plainTrigger stackedTrigger emptyIcon deferChanges
                            options={lineOptions} selected={ownLines}
                            onChange={keys => saveLines(p, keys)}
                            onConfirm={keys => !sameSet(keys, ownLines) && saveLines(p, keys)}
                            placeholder="בחר קו/נציג" />
                        ) : (
                          <span>{ownLines.length ? ownLines.map(lineLabel).join(", ") : "—"}</span>
                        )}
                      </td>
                    )}
                    {showCalls && (
                      <td className="px-4 py-2.5 min-w-[11rem]">
                        {canEdit ? (
                          <MultiSelectChips compact plainTrigger stackedTrigger emptyIcon searchable deferChanges
                            options={userOptions} selected={p.handler_ids || []}
                            onChange={ids => savePhone(p, { handler_ids: ids })}
                            onConfirm={ids => !sameSet(ids, p.handler_ids || []) && savePhone(p, { handler_ids: ids })}
                            placeholder="בחר מטפלים" />
                        ) : (
                          <span>{(p.handler_ids || []).map(id => userOptions.find(o => o.value === id)?.label).filter(Boolean).join(", ") || "—"}</span>
                        )}
                      </td>
                    )}
                    {canEdit && (
                      <td className="px-4 py-2.5 whitespace-nowrap text-left">
                        {confirmDeleteId === p.id ? (
                          <span className="inline-flex items-center gap-2">
                            <button type="button" onClick={() => deletePhone(p)} className="text-xs font-semibold text-red-600 hover:underline">מחק</button>
                            <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-xs text-slate-500 hover:underline">ביטול</button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteId(p.id)} aria-label={`מחיקת ${p.label}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0l1 12h6l1-12" />
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {canEdit && drafts.map(d => (
                <tr key={d.tempId} className="border-b border-slate-100 bg-blue-50/40 align-top">
                  <td className="px-4 py-2.5">
                    <label className="sr-only" htmlFor={`draft-label-${d.tempId}`}>שם הטלפון</label>
                    <input id={`draft-label-${d.tempId}`} className="input-field" value={d.label} placeholder="למשל: קבלה"
                      onChange={e => setDrafts(ds => ds.map(x => (x.tempId === d.tempId ? { ...x, label: e.target.value } : x)))} />
                  </td>
                  <td className="px-4 py-2.5">
                    <label className="sr-only" htmlFor={`draft-phone-${d.tempId}`}>מספר</label>
                    <input id={`draft-phone-${d.tempId}`} type="tel" dir="ltr" className="input-field text-right" value={d.phone}
                      onChange={e => setDrafts(ds => ds.map(x => (x.tempId === d.tempId ? { ...x, phone: e.target.value } : x)))} />
                  </td>
                  {showCalls && <td className="px-4 py-2.5 text-xs text-slate-400">יתאפשר אחרי השמירה</td>}
                  {showCalls && <td className="px-4 py-2.5" />}
                  <td className="px-4 py-2.5 whitespace-nowrap text-left">
                    <span className="inline-flex items-center gap-2">
                      <button type="button" onClick={() => createDraft(d)} className="btn-primary px-3 py-1.5 text-xs">שמור</button>
                      <button type="button" onClick={() => setDrafts(ds => ds.filter(x => x.tempId !== d.tempId))}
                        className="text-xs text-slate-500 hover:underline">ביטול</button>
                    </span>
                  </td>
                </tr>
              ))}
              {!phones.length && !(canEdit && drafts.length) && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">לא הוזנו טלפוני משרד</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <button type="button"
            onClick={() => setDrafts(ds => [...ds, { tempId: `d${Date.now()}`, label: "", phone: "" }])}
            className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">
            + הוספת טלפון נוסף
          </button>
        )}
      </section>
    </div>
  );
}

// Text input that saves on blur / Enter. It re-syncs from props only when the saved value
// changes, so a failed save leaves the typed text in place (and the next blur re-sends it).
function PhoneTextInput({ value, onCommit, ariaLabel, type = "text" }) {
  const [text, setText] = useState(value || "");
  useEffect(() => { setText(value || ""); }, [value]);
  return (
    <input type={type} aria-label={ariaLabel} dir={type === "tel" ? "ltr" : undefined}
      className={`input-field ${type === "tel" ? "text-right" : ""}`}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text.trim())}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}
