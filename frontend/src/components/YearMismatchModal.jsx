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

// Used instead of FILE_ROLE_LABEL whenever a row represents more than one physical
// file (finance-software rows can merge several files into one logical ledger) —
// makes it visually explicit this is a group, not a single file that might be missing.
const FILE_ROLE_LABEL_PLURAL = {
  tikhnun: "קבצי תכנון",
  gefen: "קבצי דיווח ביצוע",
  kesafim2000: "קבצי כספים2000",
  payscool: "קבצי פייסקול",
  schoolcash: "קבצי סקולקאש",
};

const FINANCE_SOFTWARE_NAME = {
  kesafim2000: "כספים2000",
  payscool: "פייסקול",
};

const DIVISION_WORD = { tikkon: "תיכון", beinayim: "חטיבת ביניים" };

function rowNote(row, selectedYear) {
  if (row.status === "unreadable_raw_file") {
    return "המערכת לא הצליחה לעבד את קובץ כספים2000. במידה והקובץ אינו הקובץ הגולמי כפי שהורד מהמערכת, יש לנסות מחדש עם הקובץ הגולמי.";
  }
  if (row.status === "unscoped_budget") {
    const softwareName = FINANCE_SOFTWARE_NAME[row.fileRole] || "תוכנת הכספים";
    return `הקובץ שהועלה אינו תקין. נא להוריד מחדש את הקובץ מ${softwareName} ולוודא שבחרתם "לפי סוג תקציב". לאחר מכן החליפו את הקובץ הקיים ונסו שוב.`;
  }
  if (row.status === "empty") {
    if (row.severity !== "warn") return null;
    const roleLabel = FILE_ROLE_LABEL[row.fileRole] || row.fileRole;
    return `שים לב — ${roleLabel} שהעלית ריק מאסמכתאות. האם לבצע איתו את הבדיקה בכל זאת?`;
  }
  if (row.status === "mixed_years") {
    return "שים לב — יש אסמכתאות משנות לימוד שונות בקובץ זה.";
  }
  if (row.status === "unrecognized") {
    return "לא ניתן לזהות בבירור לאיזו שנת לימודים קובץ זה שייך.";
  }
  return null;
}

// Division line shown alongside the year line, only for rows that carry division
// info (gefen/tikhnun, on a six-year/sheshshnati school). Returns null when there's
// nothing meaningful to say (no detection, or this row is part of a legitimate
// "both divisions at once" upload — divisionExempt).
function divisionNote(row, selectedDivision) {
  if (!row.detectedDivision) return null;
  if (row.detectedDivision === "both") {
    return { text: "לא ניתן לקבוע בבירור את החטיבה של קובץ זה", color: "text-amber-700" };
  }
  const label = DIVISION_WORD[row.detectedDivision] || row.detectedDivision;
  const matches = row.divisionExempt || row.detectedDivision === selectedDivision;
  return {
    text: `זוהתה חטיבה: ${label}`,
    color: matches ? "text-green-600" : "text-red-600",
  };
}

const REMOVABLE_ROLES = new Set(["gefen", "kesafim2000", "payscool", "schoolcash"]);
// Statuses that mean "this file itself is invalid" (wrong software format / not
// scoped to one budget type) — always block, grouped under the "קובץ לא תקין" heading,
// as opposed to a plain year mismatch which the year selector can resolve.
const INVALID_FILE_STATUSES = new Set(["unscoped_budget", "unreadable_raw_file"]);

function RowItem({ row, index, selectedYear, selectedDivision, isSheshsSnati, onSwap, onRemove, onAcknowledge }) {
  const note = rowNote(row, selectedYear);
  const mismatched = row.status === "recognized" && row.detectedYear !== selectedYear;
  const divNote = isSheshsSnati ? divisionNote(row, selectedDivision) : null;
  const isMultiFile = row.currentFilenames.length > 1;
  const roleLabel = (isMultiFile ? FILE_ROLE_LABEL_PLURAL[row.fileRole] : FILE_ROLE_LABEL[row.fileRole]) || row.fileRole;
  const divisionWord = isSheshsSnati && row.detectedDivision && row.detectedDivision !== "both"
    ? DIVISION_WORD[row.detectedDivision] : null;
  return (
    <li className="flex items-start gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">
          {roleLabel}{divisionWord ? ` ${divisionWord}` : ""}
        </div>
        <div className="text-xs text-slate-500">
          {row.currentFilenames.map((name, i) => (
            <div key={i} className="truncate">{name}</div>
          ))}
        </div>
        {row.status === "recognized" ? (
          <div className={`text-xs font-semibold mt-1 ${mismatched ? "text-red-600" : "text-green-600"}`}>
            זוהתה שנת לימודים: {row.detectedYear}
          </div>
        ) : (
          note && (
            <div className={`text-xs mt-1 ${INVALID_FILE_STATUSES.has(row.status) ? "text-red-600 font-semibold" : "text-amber-700"}`}>{note}</div>
          )
        )}
        {divNote && (
          <div className={`text-xs font-semibold mt-1 ${divNote.color}`}>{divNote.text}</div>
        )}
        {row.severity === "warn" && (
          <label htmlFor={`warn-ack-${index}`} className="flex items-center gap-2 mt-1.5 text-xs text-slate-700">
            <input
              id={`warn-ack-${index}`}
              type="checkbox"
              checked={row.warnAcknowledged}
              onChange={e => onAcknowledge(index, e.target.checked)}
            />
            אני מאשר/ת שבדקתי מול בית הספר ובחרתי להמשיך עם הקובץ כפי שהוא
          </label>
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

export function YearMismatchModal({
  issues, files, initialYear, detectFileYear, onRun, onCancel,
  isSheshsSnati = false, accounts = [], initialDivision = null,
  allowYearOverride = true,
}) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const divisionAccounts = accounts.filter(a => a.division_type === "tikkon" || a.division_type === "beinayim");
  const [selectedDivision, setSelectedDivision] = useState(
    initialDivision || divisionAccounts[0]?.division_type || "tikkon"
  );
  const [rows, setRows] = useState(() => issues.map(iss => ({
    fileRole: iss.fileRole,
    originalFilenames: iss.filenames,
    currentFilenames: iss.filenames,
    status: iss.status,
    detectedYear: iss.detectedAcademicYear,
    detectedDivision: iss.detectedDivision ?? null,
    // "exempt" rows (division_status omitted by the backend despite a detected
    // division) are part of a legitimate "both divisions at once" upload — never
    // block/flag them regardless of which division is currently selected.
    divisionExempt: isSheshsSnati && iss.detectedDivision != null && !iss.divisionStatus,
    severity: iss.severity ?? "block",
    warnAcknowledged: false,
    replacementFile: null,
    checking: false,
    removed: false,
  })));

  // "recognized" is re-checked live against the currently selected year (the dropdown
  // lets the advisor retarget the whole check to a different year without swapping any
  // file) — every other status's severity was computed server-side once and doesn't
  // change based on that selector. "warn"-severity rows (empty/mixed_years) can ALSO be
  // resolved by ticking their acknowledgment checkbox, not only by swapping the file.
  function rowBlocked(row) {
    if (INVALID_FILE_STATUSES.has(row.status)) return true;
    if (row.status === "recognized") return row.detectedYear !== selectedYear;
    if (row.severity === "warn") return !row.warnAcknowledged;
    return row.severity === "block";
  }

  const canRun = rows.every(r => r.removed || (
    !rowBlocked(r)
    && (!isSheshsSnati || r.divisionExempt || !r.detectedDivision || r.detectedDivision === "both" || r.detectedDivision === selectedDivision)
  ));
  const rowsWithIndex = rows.map((row, index) => ({ row, index })).filter(({ row }) => !row.removed);
  const yearIssueRows = rowsWithIndex.filter(({ row }) => !INVALID_FILE_STATUSES.has(row.status));
  const budgetIssueRows = rowsWithIndex.filter(({ row }) => INVALID_FILE_STATUSES.has(row.status));

  function handleRemove(index) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, removed: true } : r)));
  }

  function handleAcknowledge(index, checked) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, warnAcknowledged: checked } : r)));
  }

  async function handleSwap(index, file) {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, checking: true } : r)));
    try {
      const result = await detectFileYear(file, rows[index].fileRole, selectedYear);
      setRows(prev => prev.map((r, i) => (i === index ? {
        ...r,
        checking: false,
        status: result.status,
        detectedYear: result.detected_academic_year,
        // A swapped-in file's division is checked fresh against the currently
        // selected division target — the "both divisions at once" exemption only
        // ever applied to the ORIGINAL pairing, so it's cleared on swap.
        detectedDivision: result.detected_division ?? null,
        divisionExempt: false,
        severity: result.severity ?? "block",
        warnAcknowledged: false,
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
    // Only a row that's (a) still carrying its ORIGINAL file (no replacement — a
    // swapped-in file gets re-classified fresh server-side) and (b) explicitly
    // acknowledged needs to tell the backend to skip re-flagging it, or re-submitting
    // the same file would re-trigger the identical "warn" classification forever.
    const acknowledgedRoles = rows
      .filter(r => !r.removed && !r.replacementFile && r.severity === "warn" && r.warnAcknowledged)
      .map(r => r.fileRole);
    onRun(finalFiles, selectedYear, selectedDivision, acknowledgedRoles);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="year-mismatch-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-xl flex flex-col gap-4">
        <h2 id="year-mismatch-title" className="text-base font-bold text-slate-800">חוסר התאמה בקבצים שהועלו</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          {allowYearOverride
            ? "שימו לב: יש בעיה באחד או יותר מהקבצים שהועלו — בדקו את הפרטים למטה והחליפו קובץ, או בחרו את שנת הלימודים/החטיבה המתאימה."
            : "שימו לב: יש בעיה באחד או יותר מהקבצים שהועלו — בדקו את הפרטים למטה והחליפו את הקובץ המתאים."}
        </p>

        {yearIssueRows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {yearIssueRows.map(({ row, index }) => (
              <RowItem key={index} row={row} index={index} selectedYear={selectedYear} selectedDivision={selectedDivision} isSheshsSnati={isSheshsSnati} onSwap={handleSwap} onRemove={handleRemove} onAcknowledge={handleAcknowledge} />
            ))}
          </ul>
        )}

        {budgetIssueRows.length > 0 && (
          <>
            <h3 className="text-base font-bold text-slate-800">קובץ לא תקין</h3>
            <ul className="flex flex-col gap-2">
              {budgetIssueRows.map(({ row, index }) => (
                <RowItem key={index} row={row} index={index} selectedYear={selectedYear} selectedDivision={selectedDivision} isSheshsSnati={isSheshsSnati} onSwap={handleSwap} onRemove={handleRemove} onAcknowledge={handleAcknowledge} />
              ))}
            </ul>
          </>
        )}

        {allowYearOverride && (
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
        )}

        {isSheshsSnati && divisionAccounts.length > 1 && (
          <div>
            <label htmlFor="year-mismatch-division-select" className="block text-sm font-semibold text-slate-700 mb-1">
              בצע בדיקה עבור חטיבה
            </label>
            <select
              id="year-mismatch-division-select"
              value={selectedDivision}
              onChange={e => setSelectedDivision(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white"
            >
              {divisionAccounts.map(acc => (
                <option key={acc.id} value={acc.division_type}>
                  {acc.custom_label || DIVISION_WORD[acc.division_type] || acc.division_type}
                </option>
              ))}
            </select>
          </div>
        )}

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
