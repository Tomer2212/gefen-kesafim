import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

function schoolLabel(s) {
  return `${s.name || ""} - ${s.symbol || ""} - ${s.city || ""}`;
}

function SchoolResultsList({ schools, query, setQuery, pendingId, setPendingId, onConfirm, onCancel }) {
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
      || (s.city || "").toLowerCase().includes(q);
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
        placeholder="חיפוש לפי שם מוסד, סמל מוסד או עיר..."
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
          {submitting ? "יוצר..." : "אישור"}
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
export function SchoolPickerModal({ schools, onConfirm, onCancel }) {
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const { ref, handleKeyDown } = useFocusTrap(onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="school-picker-title"
        onKeyDown={handleKeyDown} dir="rtl"
        className="glass-card rounded-2xl p-6 w-full max-w-md flex flex-col gap-3">
        <h2 id="school-picker-title" className="font-bold text-slate-900">בחירת בית ספר לפגישה</h2>
        <SchoolResultsList schools={schools} query={query} setQuery={setQuery}
          pendingId={pendingId} setPendingId={setPendingId}
          onConfirm={onConfirm}
          onCancel={onCancel} />
      </div>
    </div>
  );
}

export { schoolLabel };
