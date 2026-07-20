// Renders the 08:00–19:00 day breakdown produced by dayScheduleUtils.computeSegments.
// Shared by DatePickerPopover (hover-a-day) and MeetingRow (hover the date/time cells)
// so both look and behave identically.
//
// `ownEventId`, when given, marks one busy block as "this meeting" (blue, distinct from
// both "free" green and "other busy" amber) — so it's visually obvious that slot isn't a
// genuine outside conflict, it's the very meeting you're looking at.
export function DayScheduleBlocks({ segments, ownEventId }) {
  return (
    <div className="flex flex-col gap-1">
      {segments.map((s, i) => {
        if (s.type === "free") {
          // Keep the time range (still useful — "free from X to Y") but drop the "פנוי"
          // word itself — the green color already says "nothing here", so the label was
          // pure repetition on every single free row.
          return (
            <div key={i} style={{ minHeight: s.heightPx }}
              className="flex items-center rounded-md px-3 py-1 bg-green-100" title="פנוי">
              <span dir="ltr" className="text-black font-medium whitespace-nowrap">{s.startHM}–{s.endHM}</span>
            </div>
          );
        }
        if (s.type === "busy") {
          const isOwn = ownEventId && s.id === ownEventId;
          const bg = isOwn ? "bg-blue-100" : "bg-amber-100";
          const label = isOwn ? `${s.subject || "הפגישה"} (פגישה זו)` : (s.subject || "תפוס");
          return (
            <div key={i} style={{ minHeight: s.heightPx }}
              className={`flex items-center gap-3 rounded-md px-3 py-1 ${bg}`}>
              <span dir="ltr" className="text-black font-medium whitespace-nowrap flex-shrink-0">{s.startHM}–{s.endHM}</span>
              <span className="text-black text-right min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
            </div>
          );
        }
        // cluster: genuinely overlapping events, rendered side-by-side in lanes.
        return (
          <div key={i} style={{ minHeight: s.heightPx }} className="flex gap-2">
            {s.lanes.map((lane, laneIdx) => (
              <div key={laneIdx} className="flex-1 flex flex-col gap-1 min-w-0">
                {lane.map((sub, subIdx) => {
                  if (sub.type === "empty") {
                    return <div key={subIdx} style={{ flexGrow: sub.grow, flexShrink: 0 }} aria-hidden="true" />;
                  }
                  const isOwn = ownEventId && sub.id === ownEventId;
                  const label = isOwn ? `${sub.subject || "הפגישה"} (פגישה זו)` : (sub.subject || "תפוס");
                  return (
                    <div key={subIdx} style={{ flexGrow: sub.grow, flexShrink: 0, minHeight: 26 }}
                      className={`flex items-center gap-2 px-2.5 py-1 rounded ${isOwn ? "bg-blue-100" : "bg-amber-100"}`}>
                      <span dir="ltr" className="text-black font-medium whitespace-nowrap flex-shrink-0">{sub.startHM}–{sub.endHM}</span>
                      <span className="text-black text-right min-w-0 flex-1 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
