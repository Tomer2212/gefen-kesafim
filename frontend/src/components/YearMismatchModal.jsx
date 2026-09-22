import { useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ACADEMIC_YEARS } from "../constants/academicYears";

const FILE_ROLE_LABEL = {
  tikhnun: "קובץ תכנון",
  gefen: "קובץ דיווח ביצוע",
  kesafim2000: "קובץ כספים2000",
  payscool: "קובץ פייסקול",
  schoolcash: "קובץ סקולקאש",
};

const FINANCE_SOFTWARE_NAME = {
  kesafim2000: "כספים2000",
  payscool: "פייסקול",
};

function rowNote(row, selectedYear) {
  if (row.status === "unreadable_raw_file") {
    return "המערכת לא הצליחה לעבד את קובץ כספים2000. במידה והקובץ אינו הקובץ הגולמי כפי שהורד מהמערכת, יש לנסות מחדש עם הקובץ הגולמי.";
  }
  if (row.status === "unscoped_budget") {
    const softwareName = FINANCE_SOFTWARE_NAME[row.fileRole] || "תוכנת הכספים";
    return `הקובץ שהועלה אינו תקין. נא להוריד מחדש את הקובץ מ${softwareName} ולוודא שבחרתם "לפי סוג תקציב". לאחר מכן החליפו את הקובץ הקיים ונסו שוב.`;
  }
  if (row.status === "empty") {
    return `אין אסמכתאות מתוארכות בקובץ זה — נא לוודא שהוא שייך לשנת הלימודים ${selectedYear}.`;
  }
  if (row.status === "unrecognized") {
    return "לא ניתן לזהות בבירור לאיזו שנת לימודים קובץ זה שייך.";
  }
  return null;
}

const REMOVABLE_ROLES = new Set(["gefen", "kesafim2000", "payscool", "schoolcash"]);
// Statuses that mean "this file itself is invalid" (wrong software format / not
// scoped to one budget type) — always block, grouped under the "קובץ לא תקין" heading,
// as opposed to a plain year mismatch which the year selector can resolve.
const INVALID_FILE_STATUSES = new Set(["unscoped_budget", "unreadable_raw_file"]);

function RowItem({ row, index, selectedYear, onSwap, onRemove }) {
  const note = rowNote(row, selectedYear);
  const mismatched = row.status === "recognized" && row.detectedYear !== selectedYear;
  return (
    <li className="flex items-start gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{FILE_ROLE_LABEL[row.fileRole] || row.fileRole}</div>
        <div className="text-xs text-slate-500 truncate">{row.currentFilenames.join(", ")}</div>
        {row.status === "recognized" ? (
          <div className={`text-xs font-semibold mt-1 ${mismatched ? "text-red-600" : "text-green-600"}`}>
            זוהתה שנת לימודים: {row.detectedYear}
          </div>
        ) : (
          <div className={`text-xs mt-1 ${INVALID_FILE_STATUSES.has(row.status) ? "text-red-600 font-semibold" : "text-amber-700"}`}>{note}</div>
        )}
      </div>
      <SwapFileButton rowId={`swap-file-${index}`} disabled={row.checking} onPick={file => onSwap(index, file)} />
      {REMOVABLE_ROLES.has(row.fileRole) && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          הסר
        </button>
      )}
    </li>
  );
}

function SwapFileButton({ rowId, disabled, onPick }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        id={rowId}
        type="file"
        className="sr-only"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      <label
        htmlFor={rowId}
        className={`shrink-0 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        החלף קובץ
      </label>
    </>
  );
}

export function YearMismatchModal({ issues, files, initialYear, detectFileYear, onRun, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [rows, setRows] = useState(() => issues.map(iss => ({
    fileRole: iss.fileRole,
    originalFilenames: iss.filenames,
    currentFilenames: iss.filenames,
    status: iss.status,
    detectedYear: iss.detectedAcademicYear,
    replacementFile: null,
    checking: false,
    removed: false,
  })));

  const canRun = rows.every(r => r.removed || (!INVALID_FILE_STATUSES.has(r.status) && (r.status !== "recognized" || r.detectedYear === selectedYear)));
  const rowsWithIndex = rows.map((row, index) => ({ row, index })).filter(({ row }) => !row.removed);
  const yearIssueRows = rowsWithIndex.filter(({ row }) => !INVALID_FILE_STATUSES.has(row.status));
  const budgetIssueRows = rowsWithIndex.filter(({ row }) => INVALID_FILE_STATUSES.has(row.status));

  function handleRemove(index) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, removed: true } : r)));
  }

  async function handleSwap(index, file) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, checking: true } : r)));
    try {
      const result = await detectFileYear(file, rows[index].fileRole);
      setRows(prev => prev.map((r, i) => (i === index ? {
        ...r,
        checking: false,
        status: result.status,
        detectedYear: result.detected_academic_year,
        currentFilenames: [file.name],
        replacementFile: file,
      } : r)));
    } catch {
      setRows(prev => prev.map((r, i) => (i === index ? { ...r, checking: false } : r)));
    }
  }

  function handleRun() {
    // Rows with a replacement drop ALL of their original filenames from the upload
    // (a finance-software row may represent several merged files) and add the one
    // replacement file in their place. Removed rows just drop their filenames, with
    // no replacement — the check proceeds without that (optional) file entirely.
    const excludedNames = new Set();
    const replacements = [];
    rows.forEach(r => {
      if (r.removed) {
        r.originalFilenames.forEach(n => excludedNames.add(n));
      } else if (r.replacementFile) {
        r.originalFilenames.forEach(n => excludedNames.add(n));
        replacements.push(r.replacementFile);
      }
    });
    const finalFiles = [...files.filter(f => !excludedNames.has(f.name)), ...replacements];
    onRun(finalFiles, selectedYear);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="year-mismatch-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-xl flex flex-col gap-4">
        <h2 id="year-mismatch-title" className="text-base font-bold text-slate-800">חוסר התאמה בשנת לימודים</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          שימו לב: חלק מהקבצים שהועלו אינם תואמים את שנת הלימודים עליה אתם נמצאים במערכת.
        </p>

        {yearIssueRows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {yearIssueRows.map(({ row, index }) => (
              <RowItem key={index} row={row} index={index} selectedYear={selectedYear} onSwap={handleSwap} onRemove={handleRemove} />
            ))}
          </ul>
        )}

        {budgetIssueRows.length > 0 && (
          <>
            <h3 className="text-base font-bold text-slate-800">קובץ לא תקין</h3>
            <ul className="flex flex-col gap-2">
              {budgetIssueRows.map(({ row, index }) => (
                <RowItem key={index} row={row} index={index} selectedYear={selectedYear} onSwap={handleSwap} onRemove={handleRemove} />
              ))}
            </ul>
          </>
        )}

        <div>
          <label htmlFor="year-mismatch-year-select" className="block text-sm font-semibold text-slate-700 mb-1">
            בצע בדיקה עבור שנת הלימודים
          </label>
          <select
            id="year-mismatch-year-select"
            value={selectedYear}
            onChange={e => setSelectedYear(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white"
          >
            {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="flex gap-3 mt-1">
          <button type="button" onClick={handleRun} disabled={!canRun}
            className="btn-blue flex-1 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            בצע בדיקה
          </button>
          <button type="button" onClick={onCancel}
            className="flex-1 py-2.5 text-sm rounded-full border border-slate-300 hover:bg-slate-50 text-slate-600 font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
