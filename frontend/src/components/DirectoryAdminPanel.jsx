import { useEffect, useState } from "react";
import axios from "axios";

// Superadmin "מאגר בתי ספר": upload the Ministry of Education file (preview → publish), turn the
// directory on per org, and link an org's existing schools to it by symbol (report → apply).
// Linking writes only the separate links table — no school field of the org changes.
const STAT_LABELS = [
  ["total", "מוסדות בקובץ"],
  ["new", "חדשים"],
  ["changed", "השתנו"],
  ["missing", "לא מופיעים בקובץ"],
  ["unchanged", "ללא שינוי"],
  ["placeholder_phones", "טלפון מדומה"],
];

function errorText(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.problems) return detail.problems.join(" · ");
  return detail?.message || fallback;
}

function LinkReport({ org, onClose, onApplied }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.post(`/directory/admin/orgs/${org.id}/link`, null, { params: { apply: false } })
      .then(r => setReport(r.data))
      .catch(err => setError(errorText(err, "הפקת הדוח נכשלה")))
      .finally(() => setBusy(false));
  }, [org.id]);

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await axios.post(`/directory/admin/orgs/${org.id}/link`, null, { params: { apply: true } });
      setReport(r.data);
      onApplied();
    } catch (err) {
      setError(errorText(err, "הקישור נכשל"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-slate-800">קישור בתי הספר של {org.name} למאגר</h4>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">סגור</button>
      </div>
      {busy && !report && <p role="status" className="text-slate-500">מכין דוח…</p>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {report && (
        <>
          <ul className="text-slate-700 space-y-0.5 mb-3">
            <li>בתי ספר בארגון: {report.org_schools}</li>
            <li>{report.applied ? "קושרו עכשיו" : "יקושרו לפי סמל מוסד"}: {report.to_link}</li>
            <li>כבר מקושרים: {report.already_linked}</li>
            <li>לא נמצאו במאגר: {report.unmatched.length}</li>
            {report.duplicate_symbols.length > 0 && <li>סמלים כפולים בארגון (לא יקושרו): {report.duplicate_symbols.join(", ")}</li>}
          </ul>
          {report.unmatched.length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-slate-600">בתי ספר שלא נמצאו במאגר</summary>
              <ul className="mt-1 text-xs text-slate-600 space-y-0.5">
                {report.unmatched.map(u => <li key={u.id}>{u.symbol || "ללא סמל"} · {u.name}{u.city ? ` · ${u.city}` : ""}</li>)}
              </ul>
            </details>
          )}
          <p className="text-xs text-slate-500 mb-3">הקישור נשמר בטבלה נפרדת. אף פרט של בתי הספר בארגון לא משתנה.</p>
          {!report.applied && report.to_link > 0 && (
            <button type="button" disabled={busy} onClick={apply}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy ? "מקשר…" : `קשר ${report.to_link} בתי ספר`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function DirectoryAdminPanel() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [linkOrg, setLinkOrg] = useState(null);

  const load = () => axios.get("/directory/admin/status")
    .then(r => setStatus(r.data))
    .catch(err => setError(errorText(err, "טעינת המאגר נכשלה")));
  useEffect(() => { load(); }, []);

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await axios.post("/directory/admin/preview", form);
      setPreview(r.data);
    } catch (err) {
      setError(errorText(err, "בדיקת הקובץ נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError("");
    try {
      await axios.post(`/directory/admin/publish/${preview.import_id}`);
      setPreview(null);
      setFile(null);
      await load();
    } catch (err) {
      setError(errorText(err, "הפרסום נכשל"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleOrg(org) {
    try {
      await axios.put(`/directory/admin/orgs/${org.id}`, { enabled: !org.directory_enabled });
      await load();
    } catch (err) {
      setError(errorText(err, "העדכון נכשל"));
    }
  }

  if (!status) {
    return error
      ? <p role="alert" className="text-sm text-red-600">{error}</p>
      : <p role="status" className="text-sm text-slate-500">טוען…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-lg font-bold text-slate-800 mb-1">המאגר הארצי</h2>
        <p className="text-sm text-slate-600 mb-4">
          {status.directory_count.toLocaleString("he-IL")} מוסדות במאגר. רק הקובץ הרשמי של משרד החינוך עולה לכאן. ארגונים לא יכולים לשנות את המאגר.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="directory-file" className="text-sm text-slate-700">קובץ אקסל:</label>
          <input id="directory-file" type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }} className="text-sm" />
          <button type="button" disabled={!file || busy} onClick={runPreview}
            className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy && !preview ? "בודק…" : "בדוק קובץ"}
          </button>
        </div>

        {preview && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="font-semibold text-blue-900 mb-2">תצוגה מקדימה – עדיין לא נשמר דבר</h3>
            <dl className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-3">
              {STAT_LABELS.map(([key, label]) => (
                <div key={key} className="bg-white rounded-lg border border-blue-100 px-3 py-2">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="text-lg font-bold text-slate-800">{(preview.stats[key] ?? 0).toLocaleString("he-IL")}</dd>
                </div>
              ))}
            </dl>
            {preview.stats.changed_sample?.length > 0 && (
              <details className="mb-3 text-sm">
                <summary className="cursor-pointer text-slate-700">דוגמאות לשינויים</summary>
                <ul className="mt-1 text-xs text-slate-600 space-y-1">
                  {preview.stats.changed_sample.map(c => (
                    <li key={c.symbol}>{c.symbol} · {c.name}: {Object.entries(c.fields).map(([f, [a, b]]) => `${f}: "${a ?? ""}" ← "${b ?? ""}"`).join(" · ")}</li>
                  ))}
                </ul>
              </details>
            )}
            <button type="button" disabled={busy} onClick={publish}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy ? "מפרסם…" : "פרסם למאגר"}
            </button>
          </div>
        )}

        {status.imports.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">העלאות אחרונות</h3>
            <ul className="text-xs text-slate-600 space-y-0.5">
              {status.imports.map(i => (
                <li key={i.id}>
                  {new Date(i.created_at).toLocaleString("he-IL")} · {i.file_name} · {i.status === "published" ? "פורסם" : "נבדק, לא פורסם"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-lg font-bold text-slate-800 mb-3">ארגונים</h2>
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="text-right font-medium py-2">ארגון</th>
              <th scope="col" className="text-right font-medium py-2">בתי ספר מקושרים</th>
              <th scope="col" className="text-right font-medium py-2">מאגר פעיל</th>
              <th scope="col" className="text-right font-medium py-2"><span className="sr-only">פעולות</span></th>
            </tr>
          </thead>
          <tbody>
            {status.orgs.map(org => (
              <tr key={org.id} className="border-t border-slate-100 align-top">
                <td className="py-2 text-slate-800">
                  {org.name}
                  {linkOrg?.id === org.id && <LinkReport org={org} onClose={() => setLinkOrg(null)} onApplied={load} />}
                </td>
                <td className="py-2 text-slate-600">{org.linked_schools}</td>
                <td className="py-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!org.directory_enabled} onChange={() => toggleOrg(org)} aria-label={`מאגר בתי ספר פעיל עבור ${org.name}`} />
                    <span className="text-slate-600">{org.directory_enabled ? "פעיל" : "כבוי"}</span>
                  </label>
                </td>
                <td className="py-2 text-left">
                  <button type="button" onClick={() => setLinkOrg(org)} disabled={!status.directory_count}
                    className="text-xs text-blue-700 hover:underline disabled:opacity-40">
                    קישור בתי ספר קיימים
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
