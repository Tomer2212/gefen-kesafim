import { ACCOUNT_TYPE_OPTIONS, MAX_ACCOUNTS, normalizeCovers, validateCoversList } from "../constants/gefenAccounts";

// "חשבונות במערכת גפן" — 0-3 accounts, each with the grade layers it covers. Shared by the
// school card (SchoolPage), the admin school modal (AdminPage) and AddSchoolPage. `value` is a
// list of draft rows ({key, id, covers, finance_software, tmura_model}); saving is the
// caller's (PUT /schools/{id}/accounts with accountsPayload()).
export function GefenAccountsEditor({ value, onChange, idPrefix = "gefen-account", selectClassName = "input-field text-sm", showErrors = false }) {
  const rows = value || [];
  const error = validateCoversList(rows.map(r => r.covers));

  function setRow(idx, covers) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, covers } : r)));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.length === 0 && <p className="text-xs text-slate-500">לא הוגדר חשבון — הבדיקות יופיעו באזור אחד כללי</p>}
      {rows.map((row, idx) => (
        <div key={row.key} className="flex gap-2 items-center">
          <label htmlFor={`${idPrefix}-${row.key}`} className="sr-only">{`חשבון גפן ${idx + 1}`}</label>
          <select id={`${idPrefix}-${row.key}`} className={`${selectClassName} flex-1`}
            value={normalizeCovers(row.covers).join("+")}
            onChange={e => setRow(idx, e.target.value ? e.target.value.split("+") : [])}>
            <option value="">בחר מה החשבון כולל</option>
            {ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
            className="text-red-400 hover:text-red-600 text-xl leading-none w-7 flex-shrink-0"
            aria-label={`הסר חשבון גפן ${idx + 1}`}>×</button>
        </div>
      ))}
      {rows.length < MAX_ACCOUNTS && (
        <button type="button"
          onClick={() => onChange([...rows, { key: `new-${Date.now()}`, id: null, covers: [], finance_software: null, tmura_model: null }])}
          className="self-start text-xs font-medium text-blue-600 hover:text-blue-800">
          + הוסף חשבון
        </button>
      )}
      {error && (showErrors || rows.some(r => normalizeCovers(r.covers).length)) && (
        <p className="text-xs text-red-500" role="alert">{error}</p>
      )}
    </div>
  );
}
