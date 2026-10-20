import { useRef, useState } from "react";
import { createPortal } from "react-dom";

// Renders the popup via a portal to document.body, positioned from the button's own
// viewport coordinates (position: fixed) — this keeps it from being clipped by any
// ancestor with overflow:hidden/auto (e.g. a horizontally-scrollable table wrapper),
// which an in-flow `position: absolute` popup would otherwise be cut off by.
export function QuestionTooltip({ text, label = "מידע נוסף" }) {
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);

  function show() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.top, left: rect.left + rect.width / 2 });
  }
  function hide() { setCoords(null); }

  return (
    <div className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-xs flex items-center justify-center cursor-help"
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >?</button>
      {coords && createPortal(
        <div
          role="tooltip"
          className="fixed z-[9999] text-sm text-slate-800 leading-relaxed p-3 rounded-lg shadow-lg pointer-events-none"
          style={{
            background: "#FEF08A",
            border: "1px solid #EAB308",
            top: coords.top - 8,
            left: coords.left,
            transform: "translate(-50%, -100%)",
            width: 230,
            whiteSpace: "normal",
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </div>
  );
}
