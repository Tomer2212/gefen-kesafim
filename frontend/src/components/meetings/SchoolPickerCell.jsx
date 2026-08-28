import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

function schoolLabel(s) {
  return `${s.name || ""} - ${s.symbol || ""} - ${s.city || ""}`;
}

export function SchoolResultsList({ schools, query, setQuery, pendingId, setPendingId, onConfirm, onCancel, submittingLabel = "יוצר..." }) {
  // onConfirm (e.g. createMeetingForSchool) is async and does real work (a school-
  // advisors lookup, then a POST) before the modal closes — with no per-click feedback,
  // a user who doesn't see anything happen right away tends to click again, and again;
  // each click fired a brand new meeting since nothing stopped the button from re-firing
  // mid-request. Guard against that here, once, for every caller of this shared list.
  const [submitting, setSubmitting] = useState(false);
  const filtered = schools.filter(s => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (s.name || "").toLowerCase().includes(q)
      || (s.symbol || "").toLowerCase().includes(q)
      || (s.city || "").toLowerCase().includes(q)
      || (s.authority || "").toLowerCase().includes(q)
      || (s.district || "").toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-2" style={{ minWidth: 280 }}>
      <label htmlFor="school-picker-search" className="sr-only">חיפוש בית ספר</label>
      <input
        id="school-picker-search"
        type="search"
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="חיפוש לפי שם מוסד, סמל מוסד, עיר, בעלות או מחוז..."
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 bg-white"
        aria-label="חיפוש בית ספר"
      />
      <div className="max-h-56 overflow-y-auto border border-slate-100 rounded-lg" role="listbox" aria-label="תוצאות חיפוש בתי ספר">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-400 px-3 py-3 text-center">לא נמצאו בתי ספר</p>
        ) : filtered.map(s => (
          <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0">
            <input
              type="checkbox"
              checked={pendingId === s.id}
              onChange={() => setPendingId(pendingId === s.id ? null : s.id)}
              className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
            />
            <span className="text-sm text-slate-700">{schoolLabel(s)}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 justify-end mt-1">
        <button type="button" onClick={onCancel} disabled={submitting} className="btn-ghost text-sm px-4 py-1.5 disabled:opacity-40">ביטול</button>
        <button type="button" disabled={!pendingId || submitting}
          onClick={async () => {
            const s = schools.find(x => x.id === pendingId);
            if (!s || submitting) return;
            setSubmitting(true);
            try {
              await onConfirm(s);
            } finally {
              setSubmitting(false);
            }
          }}
          className="btn-blue text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {submitting ? submittingLabel : "אישור"}
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
export function SchoolPickerModal({ schools, onConfirm, onCancel, title = "בחירת בית ספר לפגישה", submittingLabel }) {
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
          {...(submittingLabel ? { submittingLabel } : {})} />
      </div>
    </div>
  );
}

const STAGE_LABEL = { yesodi: "יסודי", beinayim: "חטיבת ביניים", tikkon: "תיכון", sheshshnati: "שש שנתי", other: "אחר" };

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
          <label htmlFor="school-multi-picker-stage" className="sr-only">סינון לפי שלב מוסד</label>
          <select id="school-multi-picker-stage" value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">כל שלב מוסד</option>
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
