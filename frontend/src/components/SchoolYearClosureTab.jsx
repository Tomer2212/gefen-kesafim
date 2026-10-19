// "סגירת שנה" tab (SchoolPage) — two separate glass-cards, stacked vertically:
// 1. "תוכנת הכספים": closure status + notes toward parents and toward the authority, per
//    school+academic_year. Backed by the same school_year_admin_data row as the admin
//    schools table's other fields (yearAdminData/saveYearAdminField, owned by SchoolPage).
// 2. "מערכת גפן": one section per (division, budget) combo that has at least one check in
//    this academic year (sourced from check_metrics via GET /{school_id}/gefen-closures),
//    backed by gefen_year_closures (gefenClosures/saveGefenClosure, owned by SchoolPage).
//    Purely dynamic — a school/year with no checks yet renders no second card at all.
//
// The two cards are deliberately separate elements (not one shared grid) so each card's
// white/glass background ends exactly at its own content, and the gap between them shows
// the page's regular background (.bg-scene) rather than white bleeding downward. Contrast
// against that background comes from each card's own bold border, not a darker backdrop.
//
// Both groups' "סגור"/"לא סגור" toggles are disabled outside the academic year's closure
// window (isClosureWindowOpen) — a guard against the common mistake of closing the wrong
// year while viewing a different one — with a tooltip explaining why. The notes textareas
// are never disabled by the date window.
//
// Each card is built as a CSS Grid (ARIA table roles, not a native <table>) rather than real
// table markup — a native table's row-height-distribution algorithm doesn't reliably stretch
// a single body row to fill extra table height across browsers, which is exactly what's
// needed here so the notes textareas can fill the card down to the bottom. A grid row sized
// with `1fr` gets a definite height from grid layout itself, which percentage/h-full children
// resolve against consistently. Every cell is placed with an explicit gridColumn/gridRow line
// number (rather than relying on grid auto-placement) since columns must interleave by
// position, not fill row-by-row in source order.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isClosureWindowOpen } from "../constants/academicYears";

const CLOSURE_WINDOW_TOOLTIP =
  'לא ניתן לעדכן סגירת שנה עבור שנת הלימודים הנוכחית כעת — עדכון סגירת שנה אפשרי רק בין 1 ביוני ל-31 בדצמבר של השנה שבה שנת הלימודים מסתיימת.';

// Small fixed-position tooltip rendered via a portal into <body>, positioned from the
// anchor element's own bounding rect — a plain `position: absolute` child gets silently
// clipped by the card's `overflow-hidden`, which is exactly what this avoids.
function DisabledWindowTooltip({ anchorRef }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, [anchorRef]);

  if (!pos) return null;
  return createPortal(
    <div
      role="tooltip"
      dir="rtl"
      className="fixed z-[9999] bg-amber-300 text-slate-900 border border-amber-400 rounded-lg shadow-lg px-3 py-2 text-xs font-semibold"
      style={{ top: pos.top, right: pos.right, width: "max-content", maxWidth: 280 }}
    >
      {CLOSURE_WINDOW_TOOLTIP}
    </div>,
    document.body
  );
}

function ClosureStatusToggle({ label, value, onChange, disabled, windowClosed }) {
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef(null);
  const noClass = value === false ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  const yesClass = value === true ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  return (
    <div
      ref={anchorRef}
      role="group"
      aria-label={label}
      className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      style={{ direction: "ltr" }}
      onMouseEnter={() => windowClosed && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => onChange(value === false ? null : false)}
        aria-pressed={value === false}
        className={`px-3 py-1.5 transition-colors focus:outline-none ${noClass}`}
      >לא סגור</button>
      <button
        type="button"
        onClick={() => onChange(value === true ? null : true)}
        aria-pressed={value === true}
        className={`px-3 py-1.5 border-r border-slate-200 transition-colors focus:outline-none ${yesClass}`}
      >סגור</button>
      {hovered && <DisabledWindowTooltip anchorRef={anchorRef} />}
    </div>
  );
}

// One account/budget column, placed at explicit grid lines `rows` = [titleRow, statusRow,
// notesLabelRow, textareaRow] in column `col`. `borderSide="left"` draws the vertical
// divider between this column and the one physically to its left (in RTL, every column
// except the first/rightmost one gets it, so each boundary gets exactly one divider).
function AccountColumn({ col, rows, title, statusLabel, statusValue, onStatusChange, statusSaving, windowClosed, notesId, notesLabel, notesValue, notesKey, onNotesBlur, borderSide }) {
  const sideCls = borderSide === "left" ? "border-l" : "";
  const gridColumn = String(col);
  return (
    <>
      <div role="columnheader" style={{ gridColumn, gridRow: String(rows[0]) }}
        className={`py-4 px-2 text-[1.75rem] font-bold text-slate-700 text-center border-b border-slate-200 bg-slate-50/80 ${sideCls}`}>
        {title}
      </div>
      <div role="row" style={{ gridColumn, gridRow: String(rows[1]) }}
        className={`flex items-center justify-between gap-3 py-3 px-2 border-b border-slate-200 bg-slate-50/80 ${sideCls}`}>
        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">סטטוס סגירה</span>
        <ClosureStatusToggle
          label={statusLabel}
          value={statusValue ?? false}
          disabled={statusSaving || windowClosed}
          windowClosed={windowClosed}
          onChange={onStatusChange}
        />
      </div>
      <div role="row" style={{ gridColumn, gridRow: String(rows[2]) }}
        className={`py-3 px-2 border-b border-slate-200 ${sideCls}`}>
        <label htmlFor={notesId} className="text-xs font-semibold text-slate-500 whitespace-nowrap">הערות</label>
      </div>
      <div role="cell" style={{ gridColumn, gridRow: String(rows[3]) }} className={`py-2 px-2 h-full ${sideCls} border-slate-200`}>
        <textarea
          id={notesId}
          aria-label={notesLabel}
          className="input-field text-sm w-full h-full resize-none"
          defaultValue={notesValue || ""}
          key={notesKey}
          onBlur={onNotesBlur}
        />
      </div>
    </>
  );
}

function GroupHeader({ span, title }) {
  return (
    <div
      style={{ gridColumn: `1 / span ${span}`, gridRow: "1" }}
      className="py-3 px-2 text-[1.75rem] font-bold text-slate-700 text-center bg-slate-100/60 border-b border-slate-200"
    >
      {title}
    </div>
  );
}

export function SchoolYearClosureTab({ yearAdminData, saveYearAdminField, gefenClosures, saveGefenClosure, academicYear }) {
  const [saving, setSaving] = useState(null); // which field is currently saving (disables its control)
  const windowClosed = !isClosureWindowOpen(academicYear);

  async function handleStatusChange(field, value) {
    setSaving(field);
    await saveYearAdminField(field, value);
    setSaving(null);
  }

  function handleNotesBlur(field, currentValue) {
    return e => {
      const v = e.target.value.trim() || null;
      if (v !== (currentValue || null)) saveYearAdminField(field, v);
    };
  }

  async function handleGefenStatusChange(divisionType, budgetName, value) {
    const key = `${divisionType}::${budgetName}`;
    setSaving(key);
    await saveGefenClosure(divisionType, budgetName, "status", value);
    setSaving(null);
  }

  function handleGefenNotesBlur(divisionType, budgetName, currentValue) {
    return e => {
      const v = e.target.value.trim() || null;
      if (v !== (currentValue || null)) saveGefenClosure(divisionType, budgetName, "notes", v);
    };
  }

  const combos = gefenClosures || [];
  // Balanced auto-grid for the dynamic Gefen combos: as close to a square as possible so
  // e.g. 7 combos become a 3x3 grid (one empty cell) rather than one long cramped row.
  const gefenCols = combos.length > 0 ? Math.ceil(Math.sqrt(combos.length)) : 0;
  const gefenRowCount = gefenCols > 0 ? Math.ceil(combos.length / gefenCols) : 0;

  const financeRows = [2, 3, 4, 5]; // header is row 1
  const gefenRowTemplate = ["auto", ...Array.from({ length: gefenRowCount }, () => ["auto", "auto", "auto", "1fr"]).flat()];

  return (
    <div dir="rtl" className="flex flex-col">
      <h2 className="text-lg font-bold text-slate-900 mb-4">סגירת שנה</h2>

      <div className="glass-card rounded-2xl border-2 border-slate-800 flex flex-col overflow-hidden">
        <div
          role="table"
          aria-label="סגירת שנה — תוכנת הכספים"
          className="grid text-right"
          style={{ gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "auto auto auto auto 1fr" }}
        >
          <GroupHeader span={2} title="תוכנת הכספים" />
          <AccountColumn
            col={1}
            rows={financeRows}
            title="חשבון הורים"
            statusLabel="סטטוס סגירה מול הורים"
            statusValue={yearAdminData.closure_parents_status}
            statusSaving={saving === "closure_parents_status"}
            windowClosed={windowClosed}
            onStatusChange={v => handleStatusChange("closure_parents_status", v)}
            notesId="closure-parents-notes"
            notesLabel="הערות סגירה מול הורים"
            notesValue={yearAdminData.closure_parents_notes}
            notesKey={`parents-notes-${academicYear}-${yearAdminData.closure_parents_notes ?? ""}`}
            onNotesBlur={handleNotesBlur("closure_parents_notes", yearAdminData.closure_parents_notes)}
            borderSide="left"
          />
          <AccountColumn
            col={2}
            rows={financeRows}
            title="חשבון רשות"
            statusLabel="סטטוס סגירה מול הרשות"
            statusValue={yearAdminData.closure_authority_status}
            statusSaving={saving === "closure_authority_status"}
            windowClosed={windowClosed}
            onStatusChange={v => handleStatusChange("closure_authority_status", v)}
            notesId="closure-authority-notes"
            notesLabel="הערות סגירה מול הרשות"
            notesValue={yearAdminData.closure_authority_notes}
            notesKey={`authority-notes-${academicYear}-${yearAdminData.closure_authority_notes ?? ""}`}
            onNotesBlur={handleNotesBlur("closure_authority_notes", yearAdminData.closure_authority_notes)}
          />
        </div>
      </div>

      {combos.length > 0 && (
        <>
          {/* At least 3 text-lines' worth of breathing room — the gap shows the page's
              regular background, not a white card stretching down. */}
          <div style={{ height: "4.5rem" }} aria-hidden="true" />

          <div className="glass-card rounded-2xl border-2 border-slate-800 flex flex-col overflow-hidden">
            <div
              role="table"
              aria-label="סגירת שנה — מערכת גפן"
              className="grid text-right"
              style={{ gridTemplateColumns: `repeat(${gefenCols}, 1fr)`, gridTemplateRows: gefenRowTemplate.join(" ") }}
            >
              <GroupHeader span={gefenCols} title="מערכת גפן" />
              {combos.map((combo, idx) => {
                const col = (idx % gefenCols) + 1;
                const rowIdx = Math.floor(idx / gefenCols);
                const titleRow = 2 + rowIdx * 4; // row 1 is the group header
                const rows = [titleRow, titleRow + 1, titleRow + 2, titleRow + 3];
                const key = `${combo.division_type}::${combo.budget_name}`;
                const title = `${combo.division_label} — ${combo.budget_name}`;
                return (
                  <AccountColumn
                    key={key}
                    col={col}
                    rows={rows}
                    title={title}
                    statusLabel={`סטטוס סגירה — ${title}`}
                    statusValue={combo.status}
                    statusSaving={saving === key}
                    windowClosed={windowClosed}
                    onStatusChange={v => handleGefenStatusChange(combo.division_type, combo.budget_name, v)}
                    notesId={`gefen-closure-notes-${key}`}
                    notesLabel={`הערות סגירה — ${title}`}
                    notesValue={combo.notes}
                    notesKey={`gefen-notes-${academicYear}-${key}-${combo.notes ?? ""}`}
                    onNotesBlur={handleGefenNotesBlur(combo.division_type, combo.budget_name, combo.notes)}
                    borderSide={col !== 1 ? "left" : undefined}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
