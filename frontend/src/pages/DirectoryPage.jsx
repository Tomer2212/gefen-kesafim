import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Sidebar from "../components/Sidebar";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { MINISTRY_STAGE_VALUES, MINISTRY_STAGE_OTHER } from "../constants/ministryStages";
import { adoptDirectorySchool, DIRECTORY_TAG_LABELS, DIRECTORY_TAG_CLASSES } from "../lib/directory";
import DirectoryOrgImportModal from "../components/DirectoryOrgImportModal";

// "מאגר בתי ספר" — the national school directory. The server returns 50 rows per page
// (search and filters run there), so the browser never holds the whole country's list.
const SUPERVISION_OPTIONS = ["ממלכתי", "ממלכתי דתי", "חרדי"];
const SECTOR_OPTIONS = ["יהודי", "ערבי", "בדואי", "דרוזי", "צ'רקסי"];
const STAGE_OPTIONS = MINISTRY_STAGE_VALUES.filter(v => v !== MINISTRY_STAGE_OTHER);
const EMPTY_FILTERS = { q: "", city: "", ministry_stage: "", supervision: "", sector: "" };

function TagBadge({ tag }) {
  if (!DIRECTORY_TAG_LABELS[tag]) return null;
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${DIRECTORY_TAG_CLASSES[tag]}`}>
      {DIRECTORY_TAG_LABELS[tag]}
    </span>
  );
}

function DirectoryPreviewModal({ item, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openCard(tab) {
    setBusy(true);
    setError("");
    try {
      const schoolId = item.school_id || await adoptDirectorySchool(item.directory_id);
      navigate(`/school/${schoolId}${tab ? `?tab=${tab}` : ""}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const rows = [
    ["סמל מוסד", item.symbol],
    ["יישוב", item.city],
    ["כתובת", item.address],
    ["טלפון", item.phone],
    ["שם מנהל/ת", item.principal_name],
    ["שלב חינוך", item.ministry_stage],
    ["שכבות", item.grades_raw],
    ["פיקוח", item.supervision],
    ["מגזר", item.sector],
    ["רשות", item.education_authority],
    ["בעלות", item.ownership_name],
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        ref={ref} role="dialog" aria-modal="true" aria-labelledby="directory-preview-title"
        onKeyDown={handleKeyDown} onMouseDown={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="directory-preview-title" className="text-lg font-bold text-slate-900">{item.name}</h2>
            <div className="mt-1"><TagBadge tag={item.tag} /></div>
          </div>
          <button type="button" onClick={onClose} aria-label="סגירה" className="text-slate-400 hover:text-slate-700 p-1">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mb-5">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-slate-900">{value || "—"}</dd>
            </div>
          ))}
        </dl>
        {item.tag === "none" && (
          <p className="text-xs text-slate-500 mb-4">
            פתיחת הכרטיס יוצרת עותק פרטי של בית הספר בארגון שלכם. העותק לא יופיע בלוח הבית, ומה שתעדכנו בו נשאר רק אצלכם.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
        {item.tag === "recycle" ? (
          <p className="text-sm text-slate-600">בית הספר נמצא בסל המחזור של הארגון. אפשר לשחזר אותו מניהול → בתי ספר.</p>
        ) : (
          <div className="flex gap-2 justify-end">
            <button type="button" disabled={busy} onClick={() => openCard("meetings")}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              פגישות
            </button>
            <button type="button" disabled={busy} onClick={() => openCard(null)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy ? "פותח…" : "פתח כרטיס"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DirectoryPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const requestRef = useRef(0);
  const [role, setRole] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    axios.get("/schools/users/me").then(r => setRole(r.data?.role || null)).catch(() => {});
  }, []);

  async function load(nextFilters, nextPage) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = { page: nextPage };
      Object.entries(nextFilters).forEach(([k, v]) => { if (v.trim()) params[k] = v.trim(); });
      const res = await axios.get("/directory/schools", { params });
      if (requestId !== requestRef.current) return;
      setItems(prev => (nextPage === 0 ? res.data.items : [...prev, ...res.data.items]));
      setTotal(res.data.total);
      setPage(nextPage);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "טעינת המאגר נכשלה. נסו שוב.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(filters, 0), 300);
    return () => clearTimeout(t);
  }, [filters]);

  const setFilter = (key) => (e) => setFilters(prev => ({ ...prev, [key]: e.target.value }));
  const selectCls = "border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white";

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />
      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>
        <div className="mx-auto px-6 pt-10 pb-12 max-w-6xl">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-900">מאגר בתי ספר</h1>
            {(role === "owner" || role === "manager") && (
              <button type="button" onClick={() => setImporting(true)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
                ייבוא פרטים מקובץ של הארגון
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-6">
            כל בתי הספר בארץ, לפי הקובץ הרשמי של משרד החינוך. בתי ספר שהארגון עבד איתם מוצגים לפי הפרטים שלכם.
          </p>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <label htmlFor="dir-q" className="block text-xs text-slate-500 mb-1">חיפוש</label>
              <input id="dir-q" type="search" value={filters.q} onChange={setFilter("q")}
                placeholder="שם, סמל, יישוב, מנהל/ת או טלפון"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="dir-city" className="block text-xs text-slate-500 mb-1">יישוב</label>
              <input id="dir-city" value={filters.city} onChange={setFilter("city")}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="dir-stage" className="block text-xs text-slate-500 mb-1">שלב חינוך</label>
              <select id="dir-stage" value={filters.ministry_stage} onChange={setFilter("ministry_stage")} className={`w-full ${selectCls}`}>
                <option value="">הכל</option>
                {STAGE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="dir-supervision" className="block text-xs text-slate-500 mb-1">פיקוח</label>
                <select id="dir-supervision" value={filters.supervision} onChange={setFilter("supervision")} className={`w-full ${selectCls}`}>
                  <option value="">הכל</option>
                  {SUPERVISION_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="dir-sector" className="block text-xs text-slate-500 mb-1">מגזר</label>
                <select id="dir-sector" value={filters.sector} onChange={setFilter("sector")} className={`w-full ${selectCls}`}>
                  <option value="">הכל</option>
                  {SECTOR_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2 text-sm text-slate-500">
            <span aria-live="polite">{loading && page === 0 ? "" : `${total.toLocaleString("he-IL")} בתי ספר`}</span>
            {(filters.q || filters.city || filters.ministry_stage || filters.supervision || filters.sector) && (
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="text-blue-600 hover:underline">נקה סינון</button>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">שם</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">סמל</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">יישוב</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">שלב חינוך</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">מנהל/ת</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5">טלפון</th>
                  <th scope="col" className="text-right font-medium px-4 py-2.5"><span className="sr-only">סטטוס בארגון</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.directory_id} className="border-t border-slate-100 hover:bg-blue-50/40">
                    <td className="px-4 py-2.5">
                      <button type="button" onClick={() => setSelected(item)} className="text-right font-medium text-slate-900 hover:text-blue-700 hover:underline">
                        {item.name}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{item.symbol}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.city}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.ministry_stage}</td>
                    <td className="px-4 py-2.5 text-slate-600">{item.principal_name}</td>
                    <td className="px-4 py-2.5 text-slate-600" dir="ltr">{item.phone}</td>
                    <td className="px-4 py-2.5"><TagBadge tag={item.tag} /></td>
                  </tr>
                ))}
                {!loading && items.length === 0 && !error && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">לא נמצאו בתי ספר</td></tr>
                )}
              </tbody>
            </table>
            {loading && (
              <div role="status" aria-label="טוען" className="py-6 flex justify-center">
                <span aria-hidden="true" className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {!loading && items.length < total && (
            <div className="flex justify-center mt-4">
              <button type="button" onClick={() => load(filters, page + 1)}
                className="px-5 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50">
                טען עוד
              </button>
            </div>
          )}
        </div>
      </div>
      {selected && <DirectoryPreviewModal item={selected} onClose={() => setSelected(null)} />}
      {importing && <DirectoryOrgImportModal onClose={() => { setImporting(false); load(filters, 0); }} />}
    </div>
  );
}
