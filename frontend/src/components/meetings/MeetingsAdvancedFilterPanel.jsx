import { MEETING_STATUS_OPTIONS } from "./constants";

export function MeetingsAdvancedFilterPanel({ filters, onChange, onClear, advisors }) {
  function set(key, val) {
    onChange({ ...filters, [key]: val || null });
  }

  return (
    <div className="glass-card rounded-xl p-4 mb-3 flex flex-wrap items-end gap-4" dir="rtl">
      <div>
        <label htmlFor="filter-date-from" className="block text-xs font-medium text-slate-500 mb-1">מתאריך</label>
        <input id="filter-date-from" type="date" value={filters.date_from || ""}
          onChange={e => set("date_from", e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white" />
      </div>
      <div>
        <label htmlFor="filter-date-to" className="block text-xs font-medium text-slate-500 mb-1">עד תאריך</label>
        <input id="filter-date-to" type="date" value={filters.date_to || ""}
          onChange={e => set("date_to", e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white" />
      </div>
      <div>
        <label htmlFor="filter-status" className="block text-xs font-medium text-slate-500 mb-1">סטטוס</label>
        <select id="filter-status" value={filters.status || ""} onChange={e => set("status", e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white">
          <option value="">הכל</option>
          {MEETING_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="filter-advisor" className="block text-xs font-medium text-slate-500 mb-1">יועץ מבצע</label>
        <select id="filter-advisor" value={filters.advisor_id || ""} onChange={e => set("advisor_id", e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white">
          <option value="">הכל</option>
          {(advisors || []).map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
      </div>
      <button type="button" onClick={onClear} className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-2 py-1.5">
        נקה סינון / הצג הכל
      </button>
    </div>
  );
}
