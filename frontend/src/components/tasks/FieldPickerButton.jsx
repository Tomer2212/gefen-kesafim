import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { goalShortLabel } from "./taskShared";

// Categorizes SCHOOL_FIELDS/YEAR_ADMIN_FIELDS (backend/task_logic.py) into named groups for
// the wide picker panel below — mirrors DashboardPage.jsx's "עמודות להצגה" column picker
// (categorized, portaled, searchable) rather than the plain <select> this replaces.
const FIELD_CATEGORIES = [
  {
    title: "פרטי בית ספר",
    fields: ["name", "symbol", "city", "authority", "stage", "district", "finance_software", "address", "school_phone", "notes"],
  },
  {
    title: "אנשי קשר",
    fields: [
      "principal_name", "principal_phone", "principal_email",
      "secretary_name", "secretary_phone", "secretary_email",
      "finance_contact_name", "finance_contact_phone", "finance_contact_email",
      "meeting_coordinator",
    ],
  },
  {
    title: "סטטוס והתקשרות",
    fields: ["service_type", "client_status", "order_method", "requested_price", "contract_sent", "contract_received", "receipts_sent"],
  },
  {
    // advisor_gefen/current/district — no advisor_takuma field: "תקומה" reuses the school's
    // גפן advisor list everywhere else in the app, so filtering by "יועץ מלווה [גפן]" already
    // finds schools where that person is the תקומה advisor too.
    title: "יועץ מלווה",
    fields: ["advisor_gefen", "advisor_current", "advisor_district"],
  },
  {
    title: "פיננסי",
    fields: [
      "order_amount_gefen", "hours_ordered", "rate", "payment_received", "payment_requests_sent",
      "invoice_transaction_status", "payment_method", "amount_paid",
    ],
  },
  {
    title: "סגירה מול הורים/רשות",
    fields: ["closure_parents_status", "closure_parents_notes", "closure_authority_status", "closure_authority_notes"],
  },
  {
    title: "מכסות ומשכי פגישה",
    fields: [
      "meeting_allocation_gefen", "meeting_allocation_current", "meeting_allocation_district",
      "meeting_duration_gefen", "meeting_duration_current", "meeting_duration_district",
    ],
  },
];

// Replaces the plain <select> field-picker inside each field-condition row. Supports picking
// several fields at once (checkboxes + "הוסף N תנאים") so the caller can add them all as
// sibling AND conditions in one action, instead of repeating "הוסף תנאי" per field.
//
// goalOptions/controlLetterFields (from GET /tasks/field-options) render as two extra
// categories — "יעדים"/"מכתב בקרה" — with entries keyed "goal:<goal_key>"/
// "control_letter:<field>" instead of a plain field name, since those two condition types need
// an extra division/budget picker the caller (ConditionGroupsEditor) builds a different
// condition shape for. The prefix is how the caller's onConfirm handler tells them apart.
//
// allowMeeting adds a third such category, "פגישות" — a single "meeting:has" entry that builds
// a compound meeting-filter condition (type/status/location/date-range/existence, all one
// condition — see ConditionGroupsEditor's EMPTY_MEETING_CONDITION). Gated behind a prop
// (default off) because this same button is also used inside the meeting-task wizard's OWN
// dedicated "פגישות" requirements block, which must never offer "meeting" as a pickable field
// there (it already IS one, structurally) — only the general audience/success-criteria callers
// pass allowMeeting.
export default function FieldPickerButton({ value, fieldOptions, goalOptions, controlLetterFields, allowMeeting = false, onConfirm }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState([]);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  const labelByField = Object.fromEntries((fieldOptions || []).map(f => [f.field, f.label]));
  for (const g of (goalOptions || [])) labelByField[`goal:${g.key}`] = `יעד ${goalShortLabel(g)}`;
  for (const f of (controlLetterFields || [])) labelByField[`control_letter:${f.field}`] = `מכתב בקרה: ${f.label}`;
  if (allowMeeting) labelByField["meeting:has"] = "פגישה (סוג / סטטוס / תאריכים)";
  const knownFields = new Set(Object.keys(labelByField));
  const categories = [
    ...FIELD_CATEGORIES,
    { title: "יעדים", fields: (goalOptions || []).map(g => `goal:${g.key}`) },
    { title: "מכתב בקרה", fields: (controlLetterFields || []).map(f => `control_letter:${f.field}`) },
    ...(allowMeeting ? [{ title: "פגישות", fields: ["meeting:has"] }] : []),
  ];

  function openPanel() {
    setChecked(value ? [value] : []);
    setQuery("");
    setOpen(true);
  }

  // Tall side panel (opens beside the field, not below it) — mirrors DashboardPage's "עמודות
  // להצגה" picker's categorized layout, but anchored to the right of the trigger button instead
  // of stacking below/above it, so its height isn't squeezed into whatever sliver of viewport
  // happens to be left under a field that sits deep inside a tall scrollable modal. Height
  // spans at least the surrounding dialog's own height (found via the nearest role="dialog"
  // ancestor) so every category is visible with minimal internal scrolling. Falls back to
  // opening to the *left* of the button when there isn't enough room on the right (e.g. a
  // narrow viewport, or a field sitting near the screen's right edge).
  useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const gap = 8;
    const dialogRect = buttonRef.current.closest('[role="dialog"]')?.getBoundingClientRect();
    const width = Math.min(630, window.innerWidth - margin * 2);
    const spaceRight = window.innerWidth - rect.right - margin;
    const spaceLeft = rect.left - margin;
    let left = spaceRight >= width || spaceRight >= spaceLeft ? rect.right + gap : rect.left - gap - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const maxHeight = Math.min(dialogRect?.height || 560, window.innerHeight - margin * 2);
    const top = Math.max(margin, Math.min(dialogRect?.top ?? rect.top, window.innerHeight - maxHeight - margin));
    const columns = width >= 600 ? 3 : width >= 420 ? 2 : 1;
    setPos({ top, left, width, maxHeight, columns });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (buttonRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  function toggle(field) {
    setChecked(prev => prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]);
  }

  function confirm() {
    if (checked.length) onConfirm(checked);
    setOpen(false);
  }

  const q = query.trim();
  const visibleCategories = categories.map(cat => ({
    ...cat,
    fields: cat.fields.filter(f => knownFields.has(f) && (!q || (labelByField[f] || f).includes(q))),
  })).filter(cat => cat.fields.length > 0);

  return (
    <div>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-haspopup="true"
        className="w-full text-xs border border-black rounded-lg px-2 py-1.5 bg-white text-right text-black"
      >
        {value ? (labelByField[value] || value) : "בחר שדה"}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          dir="rtl"
          className="fixed z-[80] flex flex-col border border-slate-200 rounded-xl bg-white shadow-xl"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxWidth: "95vw", maxHeight: pos.maxHeight }}
        >
          <div className="p-2 border-b border-slate-100 flex-shrink-0">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חיפוש שדה..."
              aria-label="חיפוש שדה"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-blue-400 bg-white"
            />
          </div>
          <div className="overflow-y-auto px-3 py-1 flex-1 min-h-0">
            {visibleCategories.length === 0 && (
              <p className="text-xs text-slate-400 px-3 py-3 text-center">לא נמצאו שדות</p>
            )}
            {visibleCategories.map(cat => (
              <div key={cat.title} className="mb-2">
                <p className="text-xs font-semibold text-slate-500 px-2 pt-2 pb-1">{cat.title}</p>
                <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${pos.columns}, minmax(0, 1fr))` }}>
                  {cat.fields.map(f => (
                    <label key={f} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked.includes(f)}
                        onChange={() => toggle(f)}
                        className="w-3.5 h-3.5 rounded accent-blue-600 flex-shrink-0"
                      />
                      <span className="text-sm text-slate-700 whitespace-nowrap">{labelByField[f] || f}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100 flex-shrink-0">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1">
              ביטול
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={checked.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {checked.length > 1 ? `הוסף ${checked.length} תנאים` : "בחר שדה"}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
