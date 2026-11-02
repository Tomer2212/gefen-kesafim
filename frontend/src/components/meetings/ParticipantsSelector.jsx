import { useEffect, useRef, useState } from "react";

const normName = n => (n || "").split(/\s+/).filter(Boolean).join(" ");

// Participant keys saved by the tasks flow (tasks_router._build_school_contacts) use the
// tasks-domain name for the finance role.
const KEY_ALIASES = { finance_contact: "finance" };
const normKey = k => KEY_ALIASES[k] || k;
// Key families buildSchoolContacts can offer. A saved participant with any other key
// (e.g. secretary_chativa from the tasks flow) can't be checked against the card here, so
// it's never flagged as changed.
const isCardKey = k => ["principal", "principal_chativa", "secretary", "finance"].includes(normKey(k))
  || (k || "").startsWith("extra_");

// A saved participant is a frozen snapshot of whoever held the role when it was picked.
// Match it to a current contact by PERSON (role key + name), not by role key alone — once
// a principal is replaced, the new one must not appear as this meeting's participant.
// extra_* keys are row indexes that shift when a row above is deleted, so any extra_* pair
// matches as long as the name does. A snapshot saved without a name (the public booking
// link can do that) has nothing to compare, so the role key alone decides.
function sameContact(s, c) {
  const sk = normKey(s.key), ck = normKey(c.key);
  const keyOk = sk === ck || (sk?.startsWith("extra_") && ck?.startsWith("extra_"));
  if (!keyOk) return false;
  return !normName(s.name) ? sk === ck : normName(s.name) === normName(c.name);
}

const CHANGED_WARNING = "פרטי איש הקשר השתנו בכרטיס מאז שנקבעה הפגישה — מומלץ לעדכן את המשתתפים";

// `contacts` is null while the school's contacts are unknown (school list still loading,
// or a school outside the caller's list) — then nothing is compared or flagged.
export function ParticipantsSelector({ contacts, selected, onChange, isPast = false }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function h(e) { if (!containerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const known = Array.isArray(contacts);
  const list = contacts || [];
  // Saved participants with no match on the current card — listed separately under their
  // original name so they stay visible and removable.
  const unmatched = selected.filter(s => !list.some(c => sameContact(s, c)));
  // Of those, the ones that really left / were replaced on the card.
  const isGone = s => known && isCardKey(s.key);
  // Future meetings only: a participant who left, or whose email changed on the card,
  // would still get the reminder/invite at the frozen (old) address.
  const hasChanged = known && !isPast && (unmatched.some(isGone) || selected.some(s => {
    const c = list.find(c => sameContact(s, c));
    return c && (s.email || "").trim() && (c.email || "").trim()
      && s.email.trim().toLowerCase() !== c.email.trim().toLowerCase();
  }));

  function toggle(c) {
    const exists = selected.some(s => sameContact(s, c));
    onChange(exists ? selected.filter(s => !sameContact(s, c)) : [...selected, c]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="w-full text-sm cursor-pointer px-1.5 py-0.5 rounded hover:ring-1 hover:ring-slate-300 min-h-[24px] transition-all"
        onClick={() => setOpen(o => !o)}>
        {selected.length === 0
          ? <span className="text-slate-400 text-lg font-light leading-none">+</span>
          : <span className="text-slate-700">
              {hasChanged && (
                <span className="text-amber-500 ml-1" title={CHANGED_WARNING}>
                  <span aria-hidden="true">⚠</span>
                  <span className="sr-only">{CHANGED_WARNING}</span>
                </span>
              )}
              {selected.map(s => s.name).join(", ")}
            </span>
        }
      </div>
      {open && (
        <div className="absolute z-30 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[210px] max-h-60 overflow-y-auto">
          {/* "בחר" header — clears all selection */}
          <button type="button"
            onMouseDown={e => { e.preventDefault(); onChange([]); }}
            className="w-full text-right px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50">
            בחר
          </button>
          {/* Saved participants who are no longer on the card — shown under their original
              name; only an explicit click on this row removes them. */}
          {unmatched.map((s, i) => (
            <button key={`saved-${i}`} type="button"
              className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 border-t border-slate-100"
              onMouseDown={e => { e.preventDefault(); onChange(selected.filter(x => x !== s)); }}>
              <span className="w-3.5 h-3.5 rounded border flex-shrink-0 bg-blue-500 border-blue-500" aria-hidden="true" />
              <span className="text-slate-700">{s.name || s.email || s.label}</span>
              {isGone(s) ? (
                <span className={`text-xs mr-auto ${isPast ? "text-slate-400" : "text-amber-600"}`}>
                  {isPast ? "לא מופיע עוד באנשי הקשר" : "השתנה בכרטיס מאז שנקבעה הפגישה"}
                </span>
              ) : s.label && <span className="text-slate-400 text-xs mr-auto">{s.label}</span>}
            </button>
          ))}
          {list.length === 0
            ? <div className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100">אין אנשי קשר מוגדרים</div>
            : list.map(c => (
              <button key={c.key} type="button"
                className="w-full text-right px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2"
                onMouseDown={e => { e.preventDefault(); toggle(c); }}>
                <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 ${selected.some(s => sameContact(s, c)) ? "bg-blue-500 border-blue-500" : "border-slate-300"}`} aria-hidden="true" />
                <span className="text-slate-700">{c.name}</span>
                <span className="text-slate-400 text-xs mr-auto">{c.label}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}
