// "סגירת שנה" tab (SchoolPage) — closure status + notes toward parents and toward the
// authority, per school+academic_year. Backed by the same school_year_admin_data row as the
// admin schools table's other fields (yearAdminData/saveYearAdminField, owned by SchoolPage).
//
// Built as a CSS Grid (ARIA table roles, not a native <table>) rather than real table markup —
// a native table's row-height-distribution algorithm doesn't reliably stretch a single body
// row to fill extra table height across browsers, which is exactly what's needed here so the
// notes textareas can fill the card down to the bottom. A grid row sized with `1fr` gets a
// definite height from grid layout itself, which percentage/h-full children resolve against
// consistently.
import { useState } from "react";

function ClosureStatusToggle({ label, value, onChange, disabled }) {
  const noClass = value === false ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  const yesClass = value === true ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      style={{ direction: "ltr" }}
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
    </div>
  );
}

// One account column (הורים / רשות): group title row, then a "סטטוס סגירה" row with the
// label on the right and the toggle pinned to the far left of that same row, then an "הערות"
// label row, then the notes textarea filling the remaining height. Each cell is placed with an
// explicit gridColumn/gridRow (rather than relying on grid auto-placement) since the two
// AccountColumn instances must interleave into columns, not fill row-by-row in source order.
function AccountColumn({ col, title, statusLabel, statusValue, onStatusChange, statusSaving, notesId, notesLabel, notesValue, notesKey, onNotesBlur, borderSide }) {
  const sideCls = borderSide === "left" ? "border-l" : "";
  const gridColumn = String(col);
  return (
    <>
      <div role="columnheader" style={{ gridColumn, gridRow: "1" }}
        className={`py-4 px-2 text-[1.75rem] font-bold text-slate-700 text-center border-b border-slate-200 bg-slate-50/80 ${sideCls}`}>
        {title}
      </div>
      <div role="row" style={{ gridColumn, gridRow: "2" }}
        className={`flex items-center justify-between gap-3 py-3 px-2 border-b border-slate-200 bg-slate-50/80 ${sideCls}`}>
        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">סטטוס סגירה</span>
        <ClosureStatusToggle
          label={statusLabel}
          value={statusValue ?? false}
          disabled={statusSaving}
          onChange={onStatusChange}
        />
      </div>
      <div role="row" style={{ gridColumn, gridRow: "3" }}
        className={`py-3 px-2 border-b border-slate-200 ${sideCls}`}>
        <label htmlFor={notesId} className="text-xs font-semibold text-slate-500 whitespace-nowrap">הערות</label>
      </div>
      <div role="cell" style={{ gridColumn, gridRow: "4" }} className={`py-2 px-2 ${sideCls} ${sideCls ? "border-slate-200" : ""}`}>
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

export function SchoolYearClosureTab({ yearAdminData, saveYearAdminField, academicYear }) {
  const [saving, setSaving] = useState(null); // which field is currently saving (disables its control)

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

  return (
    <div dir="rtl" className="flex flex-col">
      <h2 className="text-lg font-bold text-slate-900 mb-4">סגירת שנה</h2>

      <div className="glass-card rounded-2xl border border-slate-200 flex flex-col overflow-hidden" style={{ minHeight: "calc(100vh - 240px)" }}>
        <div
          role="table"
          aria-label="סגירת שנה"
          className="flex-1 grid text-right"
          style={{ gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "auto auto auto 1fr" }}
        >
          <AccountColumn
            col={1}
            title="חשבון הורים"
            statusLabel="סטטוס סגירה מול הורים"
            statusValue={yearAdminData.closure_parents_status}
            statusSaving={saving === "closure_parents_status"}
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
            title="חשבון רשות"
            statusLabel="סטטוס סגירה מול הרשות"
            statusValue={yearAdminData.closure_authority_status}
            statusSaving={saving === "closure_authority_status"}
            onStatusChange={v => handleStatusChange("closure_authority_status", v)}
            notesId="closure-authority-notes"
            notesLabel="הערות סגירה מול הרשות"
            notesValue={yearAdminData.closure_authority_notes}
            notesKey={`authority-notes-${academicYear}-${yearAdminData.closure_authority_notes ?? ""}`}
            onNotesBlur={handleNotesBlur("closure_authority_notes", yearAdminData.closure_authority_notes)}
          />
        </div>
      </div>
    </div>
  );
}
