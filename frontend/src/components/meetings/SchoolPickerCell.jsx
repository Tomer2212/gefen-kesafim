import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { adoptDirectorySchool } from "../../lib/directory";
import { ENTITY_TYPE_LABELS, clientLabel } from "../../constants/clientEntities";

function schoolLabel(s) {
  // A district/ownership has no symbol/city — skip empty parts instead of "name -  - ".
  return [s.name, s.symbol, s.city].filter(Boolean).join(" - ");
}

// "מחוזות" / "בעלויות" tabs (includeClientEntities): the catalog with the org's clients first,
// fetched once per type per page load.
const entityCatalogPromises = {};
function useEntityCatalog(type, active) {
  const [state, setState] = useState({ items: [], loading: false });
  useEffect(() => {
    if (!active || !type) return;
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    if (!entityCatalogPromises[type]) {
      entityCatalogPromises[type] = axios.get("/clients/", { params: { type, scope: "all" } })
        .then(r => r.data || [])
        .catch(err => { delete entityCatalogPromises[type]; throw err; });
    }
    entityCatalogPromises[type]
      .then(items => {
        if (cancelled) return;
        const sorted = [...items].sort((a, b) => (b.is_client - a.is_client) || a.label.localeCompare(b.label, "he"));
        setState({ items: sorted, loading: false });
      })
      .catch(() => { if (!cancelled) setState({ items: [], loading: false }); });
    return () => { cancelled = true; };
  }, [type, active]);
  return state;
}

// An entity choice -> the school-shaped row callers expect (created on first use).
async function resolveEntityChoice(type, item) {
  let id = item.id;
  if (!id) id = (await axios.post("/clients/adopt", { type, key: item.key })).data.id;
  const res = await axios.get("/schools/", { params: { ids: id } });
  const row = (res.data || [])[0] || { id, name: item.name, client_type: type, status: "entity", extra_contacts: [] };
  return { ...row, name: clientLabel(row) };
}

// Whether the org has the national school directory ("מאגר בתי ספר") — asked once per page load.
let directoryEnabledPromise = null;
export function isDirectoryEnabled() {
  if (!directoryEnabledPromise) {
    directoryEnabledPromise = axios.get("/directory/enabled").then(r => !!r.data?.enabled).catch(() => false);
  }
  return directoryEnabledPromise;
}
function useDirectoryEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    isDirectoryEnabled().then(v => { if (!cancelled) setEnabled(v); });
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

const EMPTY_DIRECTORY_RESULTS = { met: [], items: [], total: 0 };
// GET /directory/picker returns at most this many directory matches (directory_router.directory_picker).
const DIRECTORY_PAGE_SIZE = 20;

// "מהמאגר" results for `query` (debounced): directory schools the org already met first, then directory entries.
function useDirectoryResults(query, active) {
  const [data, setData] = useState(EMPTY_DIRECTORY_RESULTS);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      axios.get("/directory/picker", { params: { q: query.trim() } })
        .then(r => { if (!cancelled) setData(r.data || EMPTY_DIRECTORY_RESULTS); })
        .catch(() => { if (!cancelled) setData(EMPTY_DIRECTORY_RESULTS); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, active]);
  return { ...data, loading };
}

// A directory choice -> the full school object callers expect. The org's copy is created
// (adopted) only here, on confirm — never on a mere pick.
async function resolveDirectoryChoice(choice) {
  const schoolId = choice.schoolId || await adoptDirectorySchool(choice.directoryId);
  const res = await axios.get("/schools/", { params: { ids: schoolId } });
  // A copy in the recycle bin isn't returned by /schools/ — keep its real status, not "directory".
  return (res.data || [])[0] || { id: schoolId, name: choice.name, symbol: choice.symbol, city: choice.city, status: choice.tag === "recycle" ? "pending_deletion" : "directory" };
}

// One tab per client type: "בתי ספר" (the org's client schools, plus — once 2+ characters are
// typed — matching directory schools, tagged "מהמאגר"), and with includeClientEntities also
// "מחוזות" / "בעלויות". Nothing big is loaded up front: the client schools are the caller's
// list, directory matches are a debounced server search, the district/ownership catalog is small.
// addMode ("הוסף בית ספר"): nothing is listed until the user types, client schools are tagged
// "כבר לקוח", and onManualAdd adds a small "הוסף בית ספר ידנית" link to the footer.
export function SchoolResultsList({ schools, query, setQuery, pendingId, setPendingId, onConfirm, onCancel, submittingLabel = "יוצר...", includeClientEntities = false, addMode = false, onManualAdd, confirmLabel = "אישור" }) {
  // onConfirm (e.g. createMeetingForSchool) is async and does real work (a school-
  // advisors lookup, then a POST) before the modal closes — with no per-click feedback,
  // a user who doesn't see anything happen right away tends to click again, and again;
  // each click fired a brand new meeting since nothing stopped the button from re-firing
  // mid-request. Guard against that here, once, for every caller of this shared list.
  const [submitting, setSubmitting] = useState(false);
  const directoryEnabled = useDirectoryEnabled();
  const [tab, setTab] = useState("schools");
  const [dirChoice, setDirChoice] = useState(null);
  const [entityChoice, setEntityChoice] = useState(null);
  const [error, setError] = useState("");
  const trimmed = query.trim();

  // Directory copies / district-ownership cards a screen loaded for its meetings are not
  // client schools — they come from the directory search / their own tabs.
  const filtered = schools.filter(s => {
    if (s.status === "directory" || s.status === "entity") return false;
    if (!trimmed) return !addMode;
    const q = trimmed.toLowerCase();
    return (s.name || "").toLowerCase().includes(q)
      || (s.symbol || "").toLowerCase().includes(q)
      || (s.city || "").toLowerCase().includes(q)
      || (s.authority || "").toLowerCase().includes(q)
      || (s.district || "").toLowerCase().includes(q);
  });

  const onSchoolsTab = tab === "schools";
  const searchDirectory = directoryEnabled && onSchoolsTab && trimmed.length >= 2;
  const directory = useDirectoryResults(query, searchDirectory);
  const clientIds = new Set(filtered.map(s => s.id));
  const directoryOptions = searchDirectory ? [
    ...(directory.met || []).map(w => ({ key: `s:${w.id}`, schoolId: w.id, name: w.name, symbol: w.symbol, city: w.city, met: true })),
    ...directory.items.map(i => ({
      key: i.school_id ? `s:${i.school_id}` : `d:${i.directory_id}`, schoolId: i.school_id, directoryId: i.directory_id,
      name: i.name, symbol: i.symbol, city: i.city, tag: i.tag,
    })),
  ].filter((o, idx, arr) => !(o.schoolId && clientIds.has(o.schoolId)) && arr.findIndex(x => x.key === o.key) === idx) : [];

  const entityTab = includeClientEntities && (tab === "district" || tab === "ownership") ? tab : null;
  const entityCatalog = useEntityCatalog(entityTab, !!entityTab);
  const entityOptions = entityTab
    ? entityCatalog.items.filter(i => !trimmed || i.label.includes(trimmed)
        || (i.contacts || []).some(c => (c.name || "").includes(trimmed)))
    : [];

  // One selection at a time across the lists.
  function pickClient(id) { setPendingId(pendingId === id ? null : id); setDirChoice(null); setEntityChoice(null); }
  function pickDirectory(key) { setDirChoice(dirChoice === key ? null : key); setPendingId(null); setEntityChoice(null); }
  function pickEntity(key) { setEntityChoice(entityChoice === key ? null : key); setPendingId(null); setDirChoice(null); }

  // A directory pick counts only while it's still among the results (typing on replaces them).
  const dirChoiceShown = !!dirChoice && directoryOptions.some(o => o.key === dirChoice);
  const hasChoice = entityTab ? !!entityChoice : !!(pendingId || dirChoiceShown);

  async function confirm() {
    if (!hasChoice || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      if (entityTab) {
        const item = entityOptions.find(i => i.key === entityChoice);
        if (item) await onConfirm(await resolveEntityChoice(entityTab, item));
      } else if (pendingId) {
        const s = schools.find(x => x.id === pendingId);
        if (s) await onConfirm(s);
      } else {
        const choice = directoryOptions.find(o => o.key === dirChoice);
        if (choice) await onConfirm(await resolveDirectoryChoice(choice));
      }
    } catch (err) {
      setError(err.message || "הפעולה נכשלה. נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  const tabCls = active => `px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`;
  const rowCls = "flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0";
  const checkCls = "w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0";
  const badgeCls = "text-[11px] rounded-full px-1.5 border";

  return (
    <div className="flex flex-col gap-2" style={{ minWidth: 280 }}>
      {includeClientEntities && (
        <div className="flex border-b border-slate-200" role="tablist" aria-label="סוג לקוח">
          {[{ value: "schools", label: "בתי ספר" }, { value: "district", label: ENTITY_TYPE_LABELS.district.plural },
            { value: "ownership", label: ENTITY_TYPE_LABELS.ownership.plural }].map(t => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={tabCls(tab === t.value)}
              onClick={() => { setTab(t.value); setError(""); }}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <label htmlFor="school-picker-search" className="sr-only">חיפוש</label>
      <input
        id="school-picker-search"
        type="search"
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={entityTab ? `חיפוש ${ENTITY_TYPE_LABELS[entityTab].singular} לפי שם או איש קשר...`
          : "חיפוש לפי שם מוסד, סמל מוסד, עיר, בעלות או מחוז..."}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white"
        aria-label={entityTab ? `חיפוש ${ENTITY_TYPE_LABELS[entityTab].plural}` : "חיפוש בית ספר"}
      />

      <div className="max-h-56 overflow-y-auto border border-slate-100 rounded-lg" role="listbox"
        aria-label={entityTab ? `תוצאות חיפוש ${ENTITY_TYPE_LABELS[entityTab].plural}` : "תוצאות חיפוש בתי ספר"}>
        {entityTab ? (
          entityCatalog.loading ? (
            <p role="status" className="text-xs text-slate-400 px-3 py-3 text-center">טוען…</p>
          ) : entityOptions.length === 0 ? (
            <p className="text-xs text-slate-400 px-3 py-3 text-center">לא נמצאו {ENTITY_TYPE_LABELS[entityTab].plural}</p>
          ) : entityOptions.map(i => (
            <label key={i.key} className={rowCls}>
              <input type="checkbox" checked={entityChoice === i.key} onChange={() => pickEntity(i.key)} className={checkCls} />
              <span className="text-sm text-slate-700">{i.label}</span>
              {i.is_client && <span className={`${badgeCls} text-emerald-700 bg-emerald-50 border-emerald-200`}>לקוח</span>}
            </label>
          ))
        ) : (
          <>
            {filtered.map(s => (
              <label key={s.id} className={rowCls}>
                <input type="checkbox" checked={pendingId === s.id} onChange={() => pickClient(s.id)} className={checkCls} />
                <span className="text-sm text-slate-700">{schoolLabel(s)}</span>
                {addMode && <span className={`${badgeCls} text-emerald-700 bg-emerald-50 border-emerald-200`}>כבר לקוח</span>}
              </label>
            ))}
            {directoryOptions.map(o => (
              <label key={o.key} className={rowCls}>
                <input type="checkbox" checked={dirChoice === o.key} onChange={() => pickDirectory(o.key)} className={checkCls} />
                <span className="text-sm text-slate-700">{schoolLabel(o)}</span>
                {o.tag === "client"
                  ? <span className={`${badgeCls} text-emerald-700 bg-emerald-50 border-emerald-200`}>{addMode ? "כבר לקוח" : "לקוח"}</span>
                  : o.tag === "recycle"
                    ? <span className={`${badgeCls} text-slate-600 bg-slate-100 border-slate-200`}>בסל המחזור</span>
                    : <span className={`${badgeCls} text-slate-500 bg-slate-50 border-slate-200`}>מהמאגר</span>}
                {(o.met || o.tag === "met") && <span className={`${badgeCls} text-blue-700 bg-blue-50 border-blue-200`}>היו פגישות</span>}
              </label>
            ))}
            {searchDirectory && !directory.loading && directory.total > DIRECTORY_PAGE_SIZE && (
              <p className="text-xs text-slate-400 px-3 py-2 text-center">
                מוצגות {DIRECTORY_PAGE_SIZE} התאמות ראשונות מהמאגר (מתוך {directory.total.toLocaleString("he-IL")}) — המשיכו להקליד לצמצום
              </p>
            )}
            {searchDirectory && directory.loading && (
              <p role="status" className="text-xs text-slate-400 px-3 py-2 text-center">מחפש גם במאגר…</p>
            )}
            {filtered.length === 0 && directoryOptions.length === 0 && !(searchDirectory && directory.loading) && (
              <p className="text-xs text-slate-400 px-3 py-3 text-center">
                {addMode && !trimmed ? "הקלידו שם מוסד, סמל מוסד או עיר"
                  : directoryEnabled && trimmed.length < 2 && trimmed ? "הקלידו לפחות 2 תווים כדי לחפש גם במאגר"
                  : "לא נמצאו בתי ספר"}
              </p>
            )}
          </>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2 justify-end mt-1">
        {onManualAdd && (
          <button type="button" onClick={onManualAdd} disabled={submitting}
            className="me-auto text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-40">
            הוסף בית ספר ידנית
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={submitting} className="btn-ghost text-sm px-4 py-1.5 disabled:opacity-40">ביטול</button>
        <button type="button" disabled={!hasChoice || submitting} onClick={confirm}
          className="btn-blue text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {submitting ? submittingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** Popover variant — used for the שם מוסד cell of an existing row. */
export function SchoolPickerPopover({ schools, currentSchoolId, onConfirm, onClose }) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState(currentSchoolId || null);
  const ref = useRef(null);

  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3" style={{ top: "calc(100% + 4px)", right: 0 }} dir="rtl">
      <SchoolResultsList schools={schools} query={query} setQuery={setQuery}
        pendingId={pendingId} setPendingId={setPendingId}
        onConfirm={s => { onConfirm(s); onClose(); }}
        onCancel={onClose} />
    </div>
  );
}

/** Modal variant — used when creating a new meeting; blocks creation until a school is chosen. */
export function SchoolPickerModal({ schools, onConfirm, onCancel, title = "בחירת בית ספר לפגישה", submittingLabel, includeClientEntities = false }) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const { ref, handleKeyDown } = useFocusTrap(onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-picker-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-3">
        <h2 id="school-picker-title" className="font-bold text-slate-900">{title}</h2>
        <SchoolResultsList schools={schools} query={query} setQuery={setQuery}
          pendingId={pendingId} setPendingId={setPendingId}
          onConfirm={onConfirm}
          onCancel={onCancel}
          includeClientEntities={includeClientEntities}
          {...(submittingLabel ? { submittingLabel } : {})} />
      </div>
    </div>
  );
}

// schools.stage ("חשבונות במערכת גפן")
const STAGE_LABEL = { yesodi: "חשבון אחד – יסודי", beinayim: 'חשבון אחד – חט"ב', tikkon: "חשבון אחד – עליונה", sheshshnati: 'שני חשבונות – חט"ב + עליונה', other: "אחר" };

function distinctValues(schools, field) {
  return [...new Set(schools.map(s => s[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
}

/** Multi-select variant — used by the Tasks wizard's "בחירה ידנית" audience mode (round-2
 * redesign). Unlike SchoolResultsList (single-select, pendingId is a scalar), this keeps its
 * own filtered-list rendering since the selection mechanics (checkbox array vs. radio-like
 * single id) don't fit the same component — but reuses schoolLabel/the search-input pattern.
 * Fetches its own active-schools list (same GET /schools/ + status-filter convention as
 * PersonalMeetingsTab.jsx), so callers don't need to plumb a schools list down themselves.
 * Free-text search AND structured per-field filters are both offered, combined (AND) — the
 * user explicitly wants both, not one instead of the other, for narrowing down large lists. */
export function SchoolMultiPickerModal({ selectedIds, onChange, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [authorityFilter, setAuthorityFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");

  useEffect(() => {
    axios.get("/schools/")
      .then(r => setSchools((r.data || []).filter(s => s.status !== "deleted")))
      .catch(() => setSchools([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = schools.filter(s => {
    if (stageFilter && s.stage !== stageFilter) return false;
    if (cityFilter && s.city !== cityFilter) return false;
    if (authorityFilter && s.authority !== authorityFilter) return false;
    if (districtFilter && s.district !== districtFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (s.name || "").toLowerCase().includes(q)
      || (s.symbol || "").toLowerCase().includes(q)
      || (s.city || "").toLowerCase().includes(q)
      || (s.authority || "").toLowerCase().includes(q)
      || (s.district || "").toLowerCase().includes(q);
  });

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-multi-picker-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="school-multi-picker-title" className="font-bold text-slate-900">בחירת בתי ספר</h2>
          <span className="text-xs text-slate-500">{selectedIds.length} נבחרו</span>
        </div>
        <label htmlFor="school-multi-picker-search" className="sr-only">חיפוש בית ספר</label>
        <input
          id="school-multi-picker-search"
          type="search"
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם מוסד, סמל מוסד, עיר, בעלות או מחוז..."
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="school-multi-picker-stage" className="sr-only">סינון לפי חשבונות במערכת גפן</label>
          <select id="school-multi-picker-stage" value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">כל סוגי החשבונות</option>
            {Object.keys(STAGE_LABEL).map(k => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
          </select>
          <label htmlFor="school-multi-picker-city" className="sr-only">סינון לפי עיר</label>
          <select id="school-multi-picker-city" value={cityFilter} onChange={e => setCityFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">כל עיר</option>
            {distinctValues(schools, "city").map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <label htmlFor="school-multi-picker-authority" className="sr-only">סינון לפי בעלות</label>
          <select id="school-multi-picker-authority" value={authorityFilter} onChange={e => setAuthorityFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">כל בעלות</option>
            {distinctValues(schools, "authority").map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <label htmlFor="school-multi-picker-district" className="sr-only">סינון לפי מחוז</label>
          <select id="school-multi-picker-district" value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">כל מחוז</option>
            {distinctValues(schools, "district").map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {(stageFilter || cityFilter || authorityFilter || districtFilter) && (
            <button
              type="button"
              onClick={() => { setStageFilter(""); setCityFilter(""); setAuthorityFilter(""); setDistrictFilter(""); }}
              className="text-xs text-blue-700 hover:underline"
            >
              נקה סינון
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto border border-slate-100 rounded-lg" role="listbox" aria-label="תוצאות חיפוש בתי ספר" aria-multiselectable="true">
          {loading ? (
            <p className="text-xs text-slate-400 px-3 py-3 text-center">טוען...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-400 px-3 py-3 text-center">לא נמצאו בתי ספר</p>
          ) : filtered.map(s => (
            <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0">
              <input
                type="checkbox"
                checked={selectedIds.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
              />
              <span className="text-sm text-slate-700">{schoolLabel(s)}{s.authority ? ` - ${s.authority}` : ""}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 justify-end mt-1">
          <button type="button" onClick={onClose} className="btn-blue text-sm px-4 py-1.5">סגור</button>
        </div>
      </div>
    </div>
  );
}

export { schoolLabel };
