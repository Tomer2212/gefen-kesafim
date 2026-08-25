import { useRef, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { History, CalendarPlus } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ImportMappingModal } from "../ImportMappingModal";
import MeetingImportProblemsModal from "./MeetingImportProblemsModal";
import {
  MEETING_IMPORT_FIELD_CONFIG, normalizeImportStageScope, normalizeImportMeetingType,
  normalizeImportServiceType, normalizeImportStatus, normalizeImportDate,
} from "../../constants/meetingImportFieldConfig";

const MODE_OPTIONS = [
  {
    value: "past",
    label: "תיעוד פגישות עבר",
    hint: "שמירת פגישות שכבר התקיימו, ללא הפעלת אוטומציות (יומן/תזכורות).",
    Icon: History,
  },
  {
    value: "future",
    label: "פגישות עתידיות",
    hint: "פגישות שנקבעו מראש — יתנהגו כמו פגישה שנקבעה ידנית במערכת.",
    Icon: CalendarPlus,
  },
];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SpreadsheetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="1" width="16" height="18" rx="2" fill="#dcfce7" stroke="#16a34a" strokeWidth="1.2" />
      <path d="M6 6h8M6 9.5h8M6 13h5" stroke="#16a34a" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 5h16" stroke="#16a34a" strokeWidth="1.2" />
    </svg>
  );
}

function fieldConfigForMode(mode) {
  return MEETING_IMPORT_FIELD_CONFIG.filter(f => {
    if (mode === "past" && f.key === "advisor_name_or_email") return false;
    if (mode === "future" && f.key === "advisor_name_text") return false;
    return true;
  });
}

function buildRowsFromSheet(mode, headers, dataRows, mapping) {
  function cell(row, key) {
    const idx = mapping[key];
    if (idx === null || idx === undefined) return "";
    return row[idx] !== undefined && row[idx] !== null ? String(row[idx]).trim() : "";
  }
  return dataRows.map((row, i) => ({
    row_index: i,
    meeting_date: normalizeImportDate(cell(row, "meeting_date")) || null,
    school_name: cell(row, "school_name") || null,
    school_symbol: cell(row, "school_symbol") || null,
    start_time: cell(row, "start_time") || null,
    end_time: cell(row, "end_time") || null,
    stage_scope: normalizeImportStageScope(cell(row, "stage_scope")),
    advisor_name_or_email: mode === "future" ? (cell(row, "advisor_name_or_email") || null) : null,
    advisor_name_text: mode === "past" ? (cell(row, "advisor_name_text") || null) : null,
    meeting_type: normalizeImportMeetingType(cell(row, "meeting_type")),
    meeting_service_type: normalizeImportServiceType(cell(row, "meeting_service_type")),
    participant_name: cell(row, "participant_name") || null,
    participant_phone: cell(row, "participant_phone") || null,
    participant_email: cell(row, "participant_email") || null,
    notes: cell(row, "notes") || null,
    status: normalizeImportStatus(cell(row, "status")),
  }));
}

export default function ImportMeetingsModal({ orgUsers, academicYear, onClose, onImported }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [step, setStep] = useState("mode"); // mode | upload | mapping | validating | problems
  const [mode, setMode] = useState(null);
  const [sheetData, setSheetData] = useState(null); // { headers, previewRow, dataRows }
  const [validateRows, setValidateRows] = useState(null);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  function readFile(file) {
    if (!file) return;
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      setError("יש להעלות קובץ מסוג .xlsx או .xls בלבד");
      return;
    }
    setError(null);
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const nonEmpty = allRows.filter(r => r.some(c => String(c).trim() !== ""));
        if (nonEmpty.length < 2) {
          setError("הקובץ ריק או לא מכיל נתונים");
          setSelectedFile(null);
          return;
        }
        const headers = nonEmpty[0].map(h => String(h).trim());
        const previewRow = nonEmpty[1].map(v => String(v).trim());
        const dataRows = nonEmpty.slice(1);
        setSheetData({ headers, previewRow, dataRows });
      } catch {
        setError("שגיאה בקריאת הקובץ — ודא שמדובר בקובץ Excel תקין");
        setSelectedFile(null);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleSelect(e) {
    const file = e.target.files[0];
    e.target.value = "";
    readFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    readFile(e.dataTransfer.files[0]);
  }

  function removeFile() {
    setSelectedFile(null);
    setSheetData(null);
    setError(null);
  }

  async function handleMappingConfirm(mapping) {
    const rows = buildRowsFromSheet(mode, sheetData.headers, sheetData.dataRows, mapping);
    setStep("validating");
    setError(null);
    try {
      const res = await axios.post("/schools/meetings/import/validate", { mode, rows });
      setValidateRows(res.data.rows);
      setStep("problems");
    } catch (e) {
      setError(e?.response?.data?.detail ? String(e.response.data.detail) : "בדיקת השורות נכשלה — נסה שוב");
      setStep("mapping");
    }
  }

  if (step === "problems" && validateRows) {
    return (
      <MeetingImportProblemsModal
        mode={mode}
        rows={validateRows}
        orgUsers={orgUsers}
        academicYear={academicYear}
        onClose={onClose}
        onSubmit={(result) => { onImported?.(); onClose(); }}
      />
    );
  }

  // ImportMappingModal renders its own full-screen overlay/dialog, so render it standalone
  // instead of nesting it inside this component's own dialog wrapper (avoids two stacked
  // role="dialog" containers).
  if (step === "mapping" && sheetData) {
    return (
      <ImportMappingModal
        headers={sheetData.headers}
        previewRow={sheetData.previewRow}
        totalRows={sheetData.dataRows.length}
        fieldConfig={fieldConfigForMode(mode)}
        confirmLabel={`בדוק ${sheetData.dataRows.length} שורות`}
        onConfirm={handleMappingConfirm}
        onCancel={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="import-meetings-title" onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {step === "upload" && (
              <button type="button" onClick={() => setStep("mode")} aria-label="חזרה" className="text-slate-400 hover:text-slate-600">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            )}
            <h2 id="import-meetings-title" className="font-bold text-black">
              {step === "mode" ? "ייבוא פגישות — בחר את סוג הייבוא" : `ייבוא פגישות — ${MODE_OPTIONS.find(o => o.value === mode)?.label}`}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {step === "mode" && (
          <div className="p-6 grid grid-cols-2 gap-3">
            {MODE_OPTIONS.map(o => (
              <button key={o.value} type="button" onClick={() => { setMode(o.value); setStep("upload"); }}
                className="text-right border border-slate-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50/50 transition-colors flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800 mb-1">{o.label}</div>
                  <div className="text-sm text-slate-500">{o.hint}</div>
                </div>
                <o.Icon aria-hidden="true" className="text-blue-500 shrink-0" size={28} strokeWidth={1.75} />
              </button>
            ))}
          </div>
        )}

        {step === "upload" && (
          <div className="p-6 space-y-4">
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
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all"
                style={{ background: dragOver ? "rgba(0,112,243,0.12)" : "rgba(219,234,254,0.6)" }}
              >
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                  <path d="M14 18V10M14 10L10.5 13.5M14 10L17.5 13.5" stroke={dragOver ? "#0070F3" : "#60a5fa"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 22H6.5A5.5 5.5 0 0 1 6.5 11a5.5 5.5 0 0 1 1.1.11A7 7 0 0 1 21 13.5a4.5 4.5 0 0 1-1 8.88L19 22h-4" stroke={dragOver ? "#0070F3" : "#93c5fd"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base" style={{ fontWeight: 700, color: dragOver ? "#0070F3" : "#334155" }}>
                  העלה / גרור את הקובץ לכאן
                </p>
                <p className="text-xs text-slate-400 mt-1">קובץ .xlsx או .xls בלבד</p>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-full border font-medium"
                style={{ borderColor: "#bfdbfe", color: "#0070F3", background: "rgba(219,234,254,0.5)" }}>
                בחר קובץ
              </span>
            </div>

            <input id="import-meetings-file" ref={inputRef} type="file" accept=".xlsx,.xls" aria-label="בחר קובץ Excel לייבוא"
              className="hidden" onChange={handleSelect} />

            {selectedFile && (
              <div className="file-item glass-card-dark rounded-xl px-4 py-3 flex items-center gap-3">
                <SpreadsheetIcon />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate" style={{ fontWeight: 600 }} title={selectedFile.name}>{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">{formatSize(selectedFile.size)}</p>
                </div>
                <button type="button" onClick={e => { e.stopPropagation(); removeFile(); }} aria-label="הסר קובץ"
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-slate-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}

            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

            <div className="flex items-center justify-between">
              <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">ביטול</button>
              <button type="button" disabled={!sheetData} onClick={() => setStep("mapping")}
                className="text-sm px-5 py-2.5 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                המשך למיפוי עמודות
              </button>
            </div>
          </div>
        )}

        {step === "validating" && (
          <p role="status" aria-label="בודק שורות" className="text-sm text-slate-500 p-6">בודק את השורות...</p>
        )}
      </div>
    </div>
  );
}
