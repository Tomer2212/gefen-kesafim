import { useEffect, useState } from "react";
import axios from "axios";

// Inline (non-modal) school multi-select — same fetch/search/checkbox-list mechanics as
// SchoolMultiPickerModal.jsx (frontend/src/components/meetings/SchoolPickerCell.jsx), but
// rendered directly in the page instead of behind a button+popup, per the explicit product
// decision that a tab's content must be visible without an extra click to open anything.
export default function InlineSchoolMultiSelect({ selectedIds, onChange }) {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    axios.get("/schools/")
      .then(r => setSchools((Array.isArray(r.data) ? r.data : []).filter(s => s.status !== "deleted")))
      .catch(() => setSchools([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = schools.filter(s => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (s.name || "").toLowerCase().includes(q)
      || (s.symbol || "").toLowerCase().includes(q)
      || (s.city || "").toLowerCase().includes(q)
      || (s.authority || "").toLowerCase().includes(q);
  });

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="inline-school-search" className="sr-only">חיפוש בית ספר</label>
        <input
          id="inline-school-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם מוסד, סמל מוסד, עיר או בעלות..."
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400"
        />
        <span className="text-xs text-slate-500 whitespace-nowrap mr-2">{selectedIds.length} נבחרו</span>
      </div>
      <div className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-100" role="listbox" aria-multiselectable="true" aria-label="בתי ספר">
        {loading ? (
          <p className="text-xs text-slate-400 px-3 py-3 text-center">טוען...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-slate-400 px-3 py-3 text-center">לא נמצאו בתי ספר</p>
        ) : filtered.map(s => (
          <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggle(s.id)} />
            <span className="text-slate-800">{s.name}</span>
            <span className="text-xs text-slate-400">{s.symbol}{s.city ? ` · ${s.city}` : ""}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
