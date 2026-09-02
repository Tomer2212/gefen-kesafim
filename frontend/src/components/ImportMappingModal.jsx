import { useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

// Extracted from AdminPage.jsx (was defined inline there, duplicated conceptually between
// the schools-import and users-import flows). Generic {key, label, required, hint}-driven
// column mapper with a live preview of the file's first data row — used by any bulk-import
// flow in the app that needs to map arbitrary Excel columns onto known field keys.
function ColumnSelect({ headers, previewRow, value, required, error, placeholder, onChange }) {
  return (
    <select
      className={`input-field text-sm ${error ? "border-red-400" : ""}`}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      <option value="">{placeholder ?? (required ? "— בחר עמודה —" : "— לא ממפה —")}</option>
      {headers.map((h, i) => {
        const preview = previewRow[i] ? String(previewRow[i]).slice(0, 35) : "";
        return (
          <option key={i} value={String(i)}>
            {h || `עמודה ${i + 1}`}{preview ? `  (${preview})` : ""}
          </option>
        );
      })}
    </select>
  );
}

function FieldMappingRow({ label, hint, required, ranked, headers, previewRow, value, error, onChange }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-44 flex-shrink-0 text-right pt-2">
        <span className="text-sm text-slate-700">{label}</span>
        {required && <span className="text-red-500 mr-1 text-xs">*</span>}
        {hint && <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{hint}</p>}
      </div>
      <div className="flex-1">
        {ranked ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: ranked }).map((_, r) => (
              <div key={r} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-14 flex-shrink-0">עדיפות {r + 1}</span>
                <div className="flex-1">
                  <ColumnSelect
                    headers={headers} previewRow={previewRow}
                    value={Array.isArray(value) ? value[r] : null}
                    required={required && r === 0}
                    error={error && r === 0}
                    placeholder={r === 0 ? "— בחר עמודה —" : "— ללא —"}
                    onChange={v => onChange(r, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ColumnSelect
            headers={headers} previewRow={previewRow} value={value} required={required} error={error}
            onChange={v => onChange(v)}
          />
        )}
        {error && <span className="text-xs text-red-500 block mt-0.5" role="alert">נדרש מיפוי</span>}
      </div>
    </div>
  );
}

export function ImportMappingModal({ headers, previewRow, totalRows, fieldConfig, confirmLabel, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [mapping, setMapping] = useState(() =>
    Object.fromEntries(fieldConfig.map(f => [f.key, f.ranked ? Array(f.ranked).fill(null) : null]))
  );
  const [tried, setTried] = useState(false);

  const isUnmapped = (f) => (f.ranked ? (mapping[f.key]?.[0] ?? null) === null : mapping[f.key] === null);

  function setRanked(key, rankIdx, colIdx) {
    setMapping(p => {
      const arr = Array.isArray(p[key]) ? [...p[key]] : [];
      arr[rankIdx] = colIdx;
      return { ...p, [key]: arr };
    });
  }

  function handleConfirm() {
    setTried(true);
    if (fieldConfig.some(f => f.required && isUnmapped(f))) return;
    onConfirm(mapping);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        onKeyDown={handleKeyDown}
        dir="rtl"
        className="glass-card rounded-2xl w-full flex flex-col"
        style={{ maxWidth: 640, maxHeight: "88vh" }}
      >
        <div className="px-6 pt-5 pb-3 border-b border-slate-100 flex-shrink-0">
          <h2 id="import-modal-title" className="font-bold text-slate-900 text-lg">מיפוי עמודות לייבוא</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            נמצאו <strong>{totalRows}</strong> שורות · התאם כל שדה לעמודה המתאימה בקובץ
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">שדות חובה</p>
          <div className="flex flex-col gap-3 mb-6">
            {fieldConfig.filter(f => f.required).map(f => (
              <FieldMappingRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                required
                ranked={f.ranked}
                headers={headers}
                previewRow={previewRow}
                value={mapping[f.key]}
                error={tried && isUnmapped(f)}
                onChange={f.ranked
                  ? (rankIdx, v) => setRanked(f.key, rankIdx, v)
                  : v => setMapping(p => ({ ...p, [f.key]: v }))}
              />
            ))}
          </div>
          <div className="h-px bg-slate-100 mb-5" />
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">שדות אופציונליים</p>
          <div className="flex flex-col gap-3">
            {fieldConfig.filter(f => !f.required).map(f => (
              <FieldMappingRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                ranked={f.ranked}
                headers={headers}
                previewRow={previewRow}
                value={mapping[f.key]}
                onChange={f.ranked
                  ? (rankIdx, v) => setRanked(f.key, rankIdx, v)
                  : v => setMapping(p => ({ ...p, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3 flex-shrink-0">
          <button onClick={handleConfirm} className="btn-blue text-sm px-5 py-2">
            {confirmLabel}
          </button>
          <button onClick={onCancel} className="btn-ghost text-sm px-5 py-2">ביטול</button>
        </div>
      </div>
    </div>
  );
}

export default ImportMappingModal;
