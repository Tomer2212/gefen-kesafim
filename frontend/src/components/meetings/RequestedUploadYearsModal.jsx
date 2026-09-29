import { useState } from "react";
import { ACADEMIC_YEARS } from "../../constants/academicYears";
import { useFocusTrap } from "../../hooks/useFocusTrap";

// Shown only at the academic-year "seam" (01.08–31.10) when scheduling a file-requesting
// meeting — lets the org ask the secretary for files from more than one academic year in
// the same meeting. Outside this window the question is skipped entirely; the requested
// year is derived silently from the meeting's date (see backend resolve_requested_upload_years).
export default function RequestedUploadYearsModal({ defaultYear, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(() => new Set([defaultYear]));
  const { ref, handleKeyDown } = useFocusTrap(onCancel);

  function toggle(year) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-years-modal-title"
        onKeyDown={handleKeyDown}
        className="glass-card rounded-3xl p-7 max-w-sm w-full anim-fade-up text-right" dir="rtl">
        <h2 id="upload-years-modal-title" className="text-base font-800 mb-2" style={{ fontWeight: 800, color: "#0f172a" }}>
          קבצים של אילו שנות לימוד תתבקש המנהלנית להעלות?
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          הפגישה נקבעה בתקופת המעבר בין שנות לימוד — ייתכן שיש צורך בקבצים גם משנת הלימודים הקודמת.
        </p>
        <div className="flex flex-col gap-2 mb-5">
          {ACADEMIC_YEARS.map(year => (
            <label key={year} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(year)}
                onChange={() => toggle(year)}
                className="w-4 h-4"
              />
              שנת לימודים {year}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(Array.from(selected).length ? Array.from(selected) : [defaultYear])}
            className="btn-blue flex-1 py-2.5 text-sm"
          >
            אישור
          </button>
          <button onClick={onCancel}
            className="flex-1 py-2.5 text-sm rounded-xl transition-all"
            style={{ fontWeight: 600, border: "1.5px solid #e2e8f0", color: "#64748b" }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
