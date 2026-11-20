// Soft segmented control (home screen "סוג לקוח:" tabs, "הלקוחות שלנו / כל ..." toggle): a light
// gray track with the selected option raised as a white card — visible at a glance without a
// saturated color competing with the table below.
// role="tablist" renders the options as tabs (aria-selected); otherwise as toggle buttons (aria-pressed).
export function SegmentedControl({ options, value, onChange, role, ariaLabel, ariaLabelledBy }) {
  const isTabs = role === "tablist";
  return (
    <div
      role={isTabs ? "tablist" : "group"}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="inline-flex items-center gap-0.5 p-1 rounded-xl bg-slate-200/70 text-sm"
    >
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={isTabs ? "tab" : undefined}
            aria-selected={isTabs ? active : undefined}
            aria-pressed={isTabs ? undefined : active}
            onClick={() => onChange(o.value)}
            className={`px-4 py-1 rounded-lg transition-all ${
              active
                ? "bg-white text-slate-900 font-semibold shadow-sm ring-1 ring-slate-900/5"
                : "text-slate-500 font-medium hover:text-slate-800"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
