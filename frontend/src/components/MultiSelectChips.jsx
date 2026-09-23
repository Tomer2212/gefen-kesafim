import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Generic controlled multi-select: options ({value,label}[]) + selected (string[]) + onChange(newArray).
// Structurally mirrors AccessSelector.jsx (closed chip box + dropdown checkbox-list + אישור footer).
// `compact`: matches the smaller/plain field style used in "פרטי מוסד" (SchoolPage ליווי grid)
// instead of the default glassy .input-field look used elsewhere (AdminPage ניהול table).
// `neutral`: forces the gray/neutral chip color (same one `compact` uses) while keeping the
// full-size `.input-field` box — for places that need input-field sizing without the legacy
// blue chip highlight (e.g. "תחומי שליטה" in the invite-user form).
// `emptyIcon`: when nothing is selected, show a small "+" icon button instead of the full
// box with placeholder text — used where the column should stay compact until populated.
//
// `levels`/`levelOptions`/`levelValues`/`onLevelChange`/`invalidLevelValues`: opt-in per-option
// single-select "level" picker (e.g. "תחומי ידע" proficiency: מתחיל/מתקדם/מומחה). Disabled by
// default so every other MultiSelectChips usage (grade levels, weekdays, funding methods, ...)
// is unaffected. When `levels` is true, a checked option's row grows a small segmented control
// on its far side (the popover's left edge in RTL) for choosing levelValues[option.value];
// `invalidLevelValues` (checked options with no level yet) get a red outline as a nudge.
//
// `title`: optional header line shown at the top of the open dropdown (e.g. "תחומי ידע - שם
// המשתמש"). When `levels` is also set, a second "רמה" header appears beside it, aligned over
// the level column so the two-column layout reads clearly from the first glance.
//
// `plainTrigger`: renders the closed box as plain text (like the "תפקיד" RoleSelect trigger in
// AdminPage.jsx) instead of removable chips — no per-item "×" button, so a slightly mis-aimed
// click while just trying to open the list can't silently delete a selection. Opt-in; other
// call sites keep the chip+"×" trigger.
//
// `checkIcon`: opt-in — a checked option's box shows a green checkmark instead of the plain
// gray-filled square. Used everywhere "תחומי ידע" is picked (AdminPage table + invite form,
// AdvisorFinderModal, ProfilePage "אזור אישי"); other MultiSelectChips consumers (weekdays,
// funding methods, grade levels, ...) keep the original filled-square look.
//
// `deferChanges`: opt-in — checkbox/level clicks only update an internal draft (reseeded from
// `selected`/`levelValues` each time the dropdown opens) instead of calling `onChange`/
// `onLevelChange` immediately. Nothing reaches the caller until אישור, which calls
// `onConfirm(draftSelected, draftLevelValues)`; ביטול (or clicking away) just closes and drops
// the draft. Used for AdminPage's per-user "תחומי ידע" table cell, where every checkbox used to
// fire its own PATCH — this batches it into one save on explicit confirm.
//
// Missing-level nudge (only meaningful when `levels` is on): a checked option with no level yet
// shows red text on the closed trigger with a banana-yellow hover tooltip, and the same note
// under its row inside the open dropdown — both share MISSING_LEVEL_MSG below.
//
// The dropdown is rendered via a portal into <body> with `position: fixed`, positioned from
// the trigger's bounding rect — same reasoning as DatePickerPopover.jsx: a plain
// `position: absolute` dropdown gets silently clipped/covered by any ancestor `.glass-card`
// (backdrop-filter creates a new stacking context, so a sibling card painted later can cover
// it regardless of z-index).
const MISSING_LEVEL_MSG = "נא לבחור רמה לתחום הידע שהוגדר.";

export function MultiSelectChips({ options, selected, onChange, placeholder = "בחר", className = "", compact = false, neutral = false, emptyIcon = false, placeholderClassName = "text-slate-400", boxClassName = null, showChevron = false, searchable = false, onConfirm = null, onCancel = null, cancelLabel = "ביטול", levels = false, levelOptions = [], levelValues = {}, onLevelChange = null, invalidLevelValues = [], title = null, plainTrigger = false, checkIcon = false, deferChanges = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [search, setSearch] = useState("");
  const [draftSel, setDraftSel] = useState(selected || []);
  const [draftLevels, setDraftLevels] = useState(levelValues || {});
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  const sel = deferChanges ? draftSel : (selected || []);
  const effLevelValues = deferChanges ? draftLevels : levelValues;
  const effInvalidLevelValues = deferChanges ? sel.filter(v => !effLevelValues[v]) : invalidLevelValues;
  const visibleOptions = searchable && search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  // Reseed the draft from the last-committed props every time the dropdown opens, so an old
  // in-progress edit never leaks into a fresh session (and a ביטול from last time is fully gone).
  useEffect(() => {
    if (deferChanges && open) {
      setDraftSel(selected || []);
      setDraftLevels(levelValues || {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const boxCls = boxClassName ?? (plainTrigger
    ? "text-sm text-slate-900 bg-transparent flex flex-wrap items-center gap-1 min-h-[26px] cursor-pointer hover:text-blue-600"
    : compact
    ? "w-full text-sm border border-slate-300 rounded-md px-2 py-0.5 bg-transparent flex flex-wrap items-center gap-1 min-h-[26px] cursor-pointer focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100"
    : "input-field flex flex-wrap items-center gap-1.5 min-h-[38px] cursor-pointer");
  const chipCls = (compact || neutral)
    ? "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
    : "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full";
  const chipStyle = (compact || neutral) ? {} : { background: "rgba(0,112,243,0.08)", color: "#1d4ed8" };
  const checkedBoxCls = (compact || neutral) ? "bg-slate-500 border-slate-500" : "bg-blue-500 border-blue-500";

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, levels ? 360 : 160);
    // Anchor by the trigger's right edge (not left) so the dropdown grows leftward — the
    // natural RTL direction — instead of spilling out to the right of its own column.
    setPos({ top: rect.bottom + 4, left: rect.right - width, width });
  }, [open, levels]);

  // Flip upward when a trigger near the bottom of the screen (e.g. the last rows of the
  // AdminPage users table) would otherwise render the dropdown partly below the viewport.
  // Runs after the dropdown is in the DOM so it can measure its real rendered height —
  // an estimate would be wrong once `levels`/search/option-count change its content.
  useLayoutEffect(() => {
    if (!open || !pos || !triggerRef.current || !dropdownRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = dropdownRef.current.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const fitsAbove = rect.top - 4 - dropdownHeight >= 0;
    const desiredTop = dropdownHeight > spaceBelow && fitsAbove
      ? rect.top - 4 - dropdownHeight
      : rect.bottom + 4;
    if (Math.abs(desiredTop - pos.top) > 1) {
      setPos(p => ({ ...p, top: desiredTop }));
    }
  }, [open, pos, visibleOptions.length, search]);

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // A fixed-position dropdown doesn't move with its trigger — scrolling the page (or any
  // scrollable ancestor) would otherwise leave it floating over the wrong spot. Closing it
  // matches the convention already used by DatePickerPopover.jsx.
  // Exception: scrolling *inside* the dropdown's own option list must NOT close it (that
  // scroll event also reaches this capture-phase listener) — otherwise long option lists
  // can never be scrolled through.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", handler, { capture: true });
  }, [open]);

  const showIconOnly = emptyIcon && sel.length === 0;

  return (
    <div className={`relative ${className}`}>
      {showIconOnly ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={placeholder}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
        </button>
      ) : (
        <div
          ref={triggerRef}
          className={boxCls}
          role="button"
          tabIndex={0}
          onClick={() => setOpen(o => !o)}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          {sel.length === 0 ? (
            <span className={`text-sm ${placeholderClassName}`}>{placeholder}</span>
          ) : plainTrigger ? (
            sel.map((v, i) => {
              const opt = options.find(o => o.value === v);
              const invalid = levels && effInvalidLevelValues.includes(v);
              return (
                <span key={v} className={`relative ${invalid ? "group text-red-500 font-semibold" : ""}`}>
                  {opt ? opt.label : v}{i < sel.length - 1 ? "," : ""}
                  {invalid && (
                    <span role="tooltip" className="pointer-events-none absolute bottom-full right-1/2 translate-x-1/2 mb-1.5 hidden group-hover:block whitespace-nowrap text-xs font-medium text-slate-900 bg-yellow-300 border border-yellow-400 rounded-md px-2 py-1 shadow-lg z-[10000]">
                      {MISSING_LEVEL_MSG}
                    </span>
                  )}
                </span>
              );
            })
          ) : sel.map(v => {
            const opt = options.find(o => o.value === v);
            const invalid = levels && effInvalidLevelValues.includes(v);
            return (
              <span key={v} className={`${chipCls} ${invalid ? "border border-red-500 ring-1 ring-red-300" : ""}`} style={chipStyle}>
                {opt ? opt.label : v}
                <button
                  type="button"
                  onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onChange(sel.filter(i => i !== v)); }}
                  className="hover:text-red-500 leading-none"
                  aria-label={`הסר ${opt ? opt.label : v}`}
                >×</button>
              </span>
            );
          })}
        </div>
      )}
      {showChevron && !showIconOnly && (
        <svg aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
          width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      )}

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          className={`fixed z-[9999] border rounded-xl bg-white shadow-lg ${levels ? "border-black" : "border-slate-200"}`}
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {(title || levels) && (
            <div className={`flex items-center gap-2 px-4 py-2 border-b ${levels ? "border-black" : "border-slate-100"}`}>
              <span className="flex-1 text-xs font-semibold text-slate-500 truncate">{title}</span>
              {levels && (
                <div className="w-40 flex-shrink-0 border-r border-black pr-2 text-center text-xs font-semibold text-slate-500 whitespace-nowrap">רמה</div>
              )}
            </div>
          )}
          {searchable && (
            <div className="p-2 border-b border-slate-100">
              <input
                ref={searchRef}
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש..."
                aria-label="חיפוש באפשרויות"
                dir="rtl"
                className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white"
              />
            </div>
          )}
          <div className={`overflow-y-auto divide-y divide-slate-50 ${levels ? "max-h-[194px]" : "max-h-44"}`} role="listbox">
            {visibleOptions.length === 0 ? (
              <p className="px-4 py-2.5 text-sm text-slate-400 text-center">לא נמצאו תוצאות</p>
            ) : visibleOptions.map(o => {
              const isChecked = sel.includes(o.value);
              const showLevels = levels && isChecked;
              const isInvalidLevel = showLevels && effInvalidLevelValues.includes(o.value);
              return (
                <div
                  key={o.value}
                  className={isInvalidLevel ? "ring-1 ring-inset ring-red-400" : ""}
                >
                  <div className="flex items-center gap-2 px-4 py-2">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isChecked}
                      onClick={() => {
                        const newSel = isChecked ? sel.filter(i => i !== o.value) : [...sel, o.value];
                        if (deferChanges) setDraftSel(newSel);
                        else onChange(newSel);
                      }}
                      className="text-right text-sm hover:bg-blue-50 flex items-center gap-2 flex-shrink-0"
                    >
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${isChecked && checkIcon ? "border-green-500 bg-white" : isChecked ? checkedBoxCls : "border-slate-300"}`} aria-hidden="true">
                        {isChecked && checkIcon && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      {o.label}
                    </button>
                    <div className="flex-1" aria-hidden="true" />
                    {showLevels && (
                      <div className="w-40 flex items-center justify-center gap-0.5 flex-shrink-0 border-r border-black pr-2" role="group" aria-label={`רמת ידע ל${o.label}`}>
                        {levelOptions.map(lvl => {
                          const active = effLevelValues[o.value] === lvl.value;
                          return (
                            <button
                              key={lvl.value}
                              type="button"
                              onClick={() => {
                                const newLevel = active ? null : lvl.value;
                                if (deferChanges) {
                                  setDraftLevels(prev => {
                                    const next = { ...prev };
                                    if (newLevel) next[o.value] = newLevel;
                                    else delete next[o.value];
                                    return next;
                                  });
                                } else {
                                  onLevelChange?.(o.value, newLevel);
                                }
                              }}
                              aria-pressed={active}
                              className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap ${active ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                            >
                              {lvl.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {isInvalidLevel && (
                    <p className="px-4 pb-2 -mt-1 text-xs font-medium text-amber-900">{MISSING_LEVEL_MSG}</p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="p-2 border-t border-slate-100 flex justify-center items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (deferChanges) onConfirm?.(sel, effLevelValues);
                else onConfirm?.();
                setOpen(false);
              }}
              className="btn-blue text-xs px-3 py-1.5"
            >אישור</button>
            {onCancel && (
              <button
                type="button"
                onClick={() => { onCancel(); setOpen(false); }}
                className="text-xs px-3 py-1.5 rounded-lg font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >{cancelLabel}</button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
