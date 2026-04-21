import { useRef, useState } from "react";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SpreadsheetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="1" width="16" height="18" rx="2" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2"/>
      <path d="M6 6h8M6 9.5h8M6 13h5" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M2 5h16" stroke="#16a34a" strokeWidth="1.2"/>
    </svg>
  );
}

export default function FileUpload({ files, onChange }) {
  const inputRef = useRef();
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      f.name.endsWith(".xlsx") || f.name.endsWith(".xls")
    );
    if (dropped.length) onChange(prev => [...prev, ...dropped]);
  }

  function handleSelect(e) {
    const selected = Array.from(e.target.files);
    onChange(prev => [...prev, ...selected]);
    e.target.value = "";
  }

  function removeFile(index) {
    onChange(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        className={`drop-zone flex flex-col items-center justify-center gap-3 py-12 px-6 transition-all${dragOver ? " drag-over" : ""}`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === "Enter" && inputRef.current.click()}
      >
        {/* Upload cloud icon */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all"
          style={{
            background: dragOver
              ? "rgba(0,112,243,0.12)"
              : "rgba(219,234,254,0.6)",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path
              d="M14 18V10M14 10L10.5 13.5M14 10L17.5 13.5"
              stroke={dragOver ? "#0070F3" : "#60a5fa"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 22H6.5A5.5 5.5 0 0 1 6.5 11a5.5 5.5 0 0 1 1.1.11A7 7 0 0 1 21 13.5a4.5 4.5 0 0 1-1 8.88L19 22h-4"
              stroke={dragOver ? "#0070F3" : "#93c5fd"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="text-center">
          <p
            className="font-700 text-base"
            style={{ fontWeight: 700, color: dragOver ? "#0070F3" : "#334155" }}
          >
            העלה / גרור את הקבצים לכאן
          </p>
          <p className="text-xs text-slate-400 mt-1">
            קבצי .xlsx ו-.xls בלבד
          </p>
        </div>

        <span
          className="text-xs px-3 py-1.5 rounded-full border font-medium"
          style={{
            borderColor: "#bfdbfe",
            color: "#0070F3",
            background: "rgba(219,234,254,0.5)",
          }}
        >
          בחר קבצים
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleSelect}
      />

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="file-item glass-card-dark rounded-xl px-4 py-3 flex items-center gap-3"
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <SpreadsheetIcon />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-600 text-slate-700 truncate"
                  style={{ fontWeight: 600 }}
                  title={f.name}
                >
                  {f.name}
                </p>
                <p className="text-xs text-slate-400">{formatSize(f.size)}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); removeFile(i); }}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-slate-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                title="הסר קובץ"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hint */}
      {files.length === 1 && (
        <p className="text-xs text-amber-600 text-center bg-amber-50 border border-amber-200 rounded-xl py-2 px-3">
          יש להעלות לפחות 2 קבצים (קובץ גפן + קובץ כספים)
        </p>
      )}
    </div>
  );
}
