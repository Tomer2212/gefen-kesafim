import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";

// Extracted from AdminPage.jsx (was defined inline there, duplicated conceptually between
// the schools-import and users-import flows). Generic {key, label, required, hint}-driven
// column mapper with a live preview of the file's first data row — used by any bulk-import
// flow in the app that needs to map arbitrary Excel columns onto known field keys.

// Custom searchable column picker (replaces a native <select>): a free-text search box to
// narrow the list, and each option laid out as two bordered columns — the file's column
// header on one side, its sample value on the other — so long lists are quick to scan.
function ColumnSelect({ headers, previewRow, value, required, error, placeholder, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);

  const noneLabel = placeholder ?? (required ? "— בחר עמודה —" : "— לא ממפה —");
  const options = useMemo(
    () => headers.map((h, i) => ({
      idx: i,
      header: h || `עמודה ${i + 1}`,
      sample: previewRow[i] != null && previewRow[i] !== "" ? String(previewRow[i]).slice(0, 60) : "",
    })),
    [headers, previewRow],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.header.toLowerCase().includes(q) || o.sample.toLowerCase().includes(q));
  }, [options, query]);

  const selected = value === null || value === undefined ? null : options[value];

  useEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setQuery("");
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    function onScroll(e) {
      // Don't close when the scroll happens inside the popover's own list.
      if (popRef.current && (e.target === popRef.current || popRef.current.contains(e.target))) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function pick(idx) {
    onChange(idx);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`input-field text-sm text-right flex items-center justify-between gap-2 ${error ? "border-red-400" : ""}`}
      >
        <span className={`truncate ${selected ? "text-slate-800" : "text-slate-400"}`}>
          {selected ? selected.header : noneLabel}
          {selected?.sample ? <span className="text-slate-400 text-xs"> ({selected.sample})</span> : null}
        </span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className="flex-shrink-0 text-slate-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          dir="rtl"
          className="fixed z-[80] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 320), maxWidth: "calc(100vw - 24px)" }}
        >
          <div className="p-2 border-b border-slate-100">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חיפוש עמודה..."
              aria-label="חיפוש עמודה"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400"
            />
          </div>
          <div className="grid grid-cols-2 bg-slate-50 border-b border-slate-100 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            <span className="px-3 py-1.5 text-right border-l border-slate-100">כותרת בקובץ</span>
            <span className="px-3 py-1.5 text-right">ערך לדוגמה</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={selected === null}
              onClick={() => pick(null)}
              className={`w-full text-right px-3 py-2 text-sm hover:bg-slate-50 ${selected === null ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}
            >
              {noneLabel}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400 text-center">לא נמצאו עמודות תואמות</p>
            ) : (
              filtered.map(o => (
                <button
                  type="button"
                  key={o.idx}
                  role="option"
                  aria-selected={value === o.idx}
                  onClick={() => pick(o.idx)}
                  className={`w-full grid grid-cols-2 hover:bg-blue-50/60 ${value === o.idx ? "bg-blue-50" : ""}`}
                >
                  <span className={`px-3 py-2 text-sm text-right truncate border-l border-slate-100 ${value === o.idx ? "text-blue-700 font-medium" : "text-slate-800"}`}>
                    {o.header}
                  </span>
                  <span className="px-3 py-2 text-xs text-right truncate text-slate-500">
                    {o.sample || "—"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
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

export function ImportMappingModal({ headers, previewRow, totalRows, fieldConfig, confirmLabel, onConfirm, onCancel, error }) {
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

        <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0">
          {error && <p role="alert" className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="flex items-center gap-3">
            <button onClick={handleConfirm} className="btn-blue text-sm px-5 py-2">
              {confirmLabel}
            </button>
            <button onClick={onCancel} className="btn-ghost text-sm px-5 py-2">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImportMappingModal;
