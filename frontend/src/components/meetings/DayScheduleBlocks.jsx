// Renders the 08:00–19:00 day breakdown produced by dayScheduleUtils.computeSegments.
// Shared by DatePickerPopover (hover-a-day) and MeetingRow (hover the date/time cells)
// so both look and behave identically.
export function DayScheduleBlocks({ segments }) {
  return (
    <div className="flex flex-col gap-0.5">
      {segments.map((s, i) => {
        if (s.type === "free" || s.type === "busy") {
          return (
            <div key={i} style={{ minHeight: s.heightPx }}
              className={`flex items-center justify-between gap-2 rounded-md px-2 py-0.5 ${s.type === "free" ? "bg-green-100" : "bg-amber-100"}`}>
              <span dir="ltr" className="text-black font-medium whitespace-nowrap flex-shrink-0">{s.startHM}–{s.endHM}</span>
              <span className="text-black text-right min-w-0">{s.type === "free" ? "פנוי" : (s.subject || "תפוס")}</span>
            </div>
          );
        }
        // cluster: genuinely overlapping events, rendered side-by-side in lanes.
        return (
          <div key={i} style={{ minHeight: s.heightPx }} className="flex gap-1">
            {s.lanes.map((lane, laneIdx) => (
              <div key={laneIdx} className="flex-1 flex flex-col gap-0.5 min-w-0">
                {lane.map((sub, subIdx) => sub.type === "empty" ? (
                  <div key={subIdx} style={{ flexGrow: sub.grow, flexShrink: 0 }} aria-hidden="true" />
                ) : (
                  <div key={subIdx} style={{ flexGrow: sub.grow, flexShrink: 0, minHeight: 14 }}
                    className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-amber-100">
                    <span dir="ltr" className="text-black font-medium whitespace-nowrap flex-shrink-0">{sub.startHM}–{sub.endHM}</span>
                    <span className="text-black text-right min-w-0 leading-tight">{sub.subject || "תפוס"}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
