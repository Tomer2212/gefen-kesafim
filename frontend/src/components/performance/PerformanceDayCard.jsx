import { useState } from "react";
import { createPortal } from "react-dom";
import { toMinutes, fromMinutes } from "../meetings/dayScheduleUtils";

// Fixed time-ruler grid (07:00–19:00, 30-min slots) — unlike DayScheduleBlocks (used
// elsewhere for the compact freebusy popover), every slot here has the SAME pixel height
// regardless of how busy the day is, so block thickness is a true, comparable measure of
// duration across the whole "ביצועים" tab, and the grid stretches down as far as it needs to.
export const RULER_START_MIN = 7 * 60;
export const RULER_END_MIN = 19 * 60;
const SLOT_MIN = 30;
const SLOT_PX = 44;
const MIN_BLOCK_PX = 16;
const RULER_WIDTH_PX = 44;
const TOTAL_SLOTS = (RULER_END_MIN - RULER_START_MIN) / SLOT_MIN;
// A few extra pixels above the 07:00 line — without it, the very first hour label sits at
// top:-5px (half its own height above the grid's origin) and gets clipped by the scroll
// container, which starts clipping exactly at y=0. Shifting the whole grid (lines + labels +
// blocks) down by this same constant keeps every label aligned with its own line, just lower.
const TOP_PAD_PX = 12;
const TOTAL_HEIGHT_PX = TOTAL_SLOTS * SLOT_PX + TOP_PAD_PX;
const GRID_BG = "linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)";
const GRID_BG_POSITION = `0 ${TOP_PAD_PX}px`;
const CARD_VIEWPORT_PX = 560;

function kindMeta(kind) {
  if (kind === "call") return { bg: "bg-green-100", border: "border-green-300", fallback: "שיחה" };
  if (kind === "offline") return { bg: "bg-purple-100", border: "border-purple-300", fallback: "עבודה עצמאית" };
  return { bg: "bg-amber-100", border: "border-amber-300", fallback: "תפוס" };
}

function formatDurationHM(totalMinutes) {
  const rounded = Math.round(totalMinutes || 0);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Clips items to the ruler window, clusters overlapping ones, and assigns each a lane
// (side-by-side column) within its cluster — same idea as dayScheduleUtils' lane
// assignment, but producing absolute top/height/left/width instead of flex-grow segments,
// since blocks here are positioned against a shared fixed-height time axis.
function layoutBlocks(items) {
  const clipped = (items || [])
    .map(it => ({ ...it, s: Math.max(toMinutes(it.startHM), RULER_START_MIN), e: Math.min(toMinutes(it.endHM), RULER_END_MIN) }))
    .filter(it => it.e > it.s)
    .sort((a, b) => a.s - b.s || a.e - b.e);

  const clusters = [];
  let cur = null;
  for (const it of clipped) {
    if (!cur || it.s >= cur.end) { cur = { end: it.e, items: [it] }; clusters.push(cur); }
    else { cur.items.push(it); cur.end = Math.max(cur.end, it.e); }
  }

  const out = [];
  for (const c of clusters) {
    const laneEnds = [];
    const laneOf = [];
    for (const it of c.items) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= it.s) { laneEnds[i] = it.e; laneOf.push(i); placed = true; break; }
      }
      if (!placed) { laneEnds.push(it.e); laneOf.push(laneEnds.length - 1); }
    }
    const laneCount = laneEnds.length;
    c.items.forEach((it, idx) => {
      out.push({
        ...it,
        topPx: ((it.s - RULER_START_MIN) / SLOT_MIN) * SLOT_PX,
        heightPx: Math.max(((it.e - it.s) / SLOT_MIN) * SLOT_PX, MIN_BLOCK_PX),
        leftPct: (laneOf[idx] / laneCount) * 100,
        widthPct: (1 / laneCount) * 100,
      });
    });
  }
  return out;
}

function sumMinutes(items) {
  return (items || []).reduce((sum, it) => {
    const s = Math.max(toMinutes(it.startHM), RULER_START_MIN);
    const e = Math.min(toMinutes(it.endHM), RULER_END_MIN);
    return sum + Math.max(0, e - s);
  }, 0);
}

function RulerColumn() {
  const labels = [];
  for (let m = RULER_START_MIN; m <= RULER_END_MIN; m += SLOT_MIN) labels.push(m);
  return (
    <div className="relative flex-shrink-0" style={{ width: RULER_WIDTH_PX, height: TOTAL_HEIGHT_PX, backgroundImage: GRID_BG, backgroundSize: `100% ${SLOT_PX}px`, backgroundPosition: GRID_BG_POSITION }}>
      {labels.map(m => (
        <span key={m} className="absolute right-1 text-[12px] text-black leading-none" style={{ top: TOP_PAD_PX + ((m - RULER_START_MIN) / SLOT_MIN) * SLOT_PX - 5 }}>
          {fromMinutes(m)}
        </span>
      ))}
    </div>
  );
}

// Offline-work blocks get a rich hover card (title line + a separately-scrollable full note)
// instead of a plain native `title` tooltip, since a note can be much longer than a native
// tooltip can display legibly. Rendered via a portal so it isn't clipped by the day-card's
// own `overflow-y-auto` scroll container.
function OfflineHoverCard({ rect, timeRangeText, notes }) {
  return createPortal(
    <div
      className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-slate-200 p-2 text-xs"
      style={{ top: rect.bottom + 4, left: rect.left, width: 220 }}
    >
      <div className="font-semibold text-black mb-1">{timeRangeText}</div>
      <div className="text-black max-h-28 overflow-y-auto whitespace-pre-wrap break-words">{notes}</div>
    </div>,
    document.body,
  );
}

function TimeColumn({ items, isPlanned }) {
  const laidOut = layoutBlocks(items);
  const [hover, setHover] = useState(null); // { id, rect, timeRangeText, notes }

  return (
    <div className="relative flex-1 min-w-0" style={{ height: TOTAL_HEIGHT_PX, backgroundImage: GRID_BG, backgroundSize: `100% ${SLOT_PX}px`, backgroundPosition: GRID_BG_POSITION }}>
      {laidOut.map(it => {
        const meta = kindMeta(it.kind);
        const timeRangeText = `משעה ${fromMinutes(it.s)} עד שעה ${fromMinutes(it.e)}, סה"כ ${formatDurationHM(it.e - it.s)}`;
        const isOffline = it.kind === "offline";
        const titleText = isPlanned ? `${it.subject || meta.fallback} - ${timeRangeText}` : timeRangeText;
        return (
          <div
            key={it.id}
            title={isOffline ? undefined : titleText}
            onMouseEnter={isOffline ? (e) => setHover({ id: it.id, rect: e.currentTarget.getBoundingClientRect(), timeRangeText, notes: it.subject || meta.fallback }) : undefined}
            onMouseLeave={isOffline ? () => setHover(null) : undefined}
            className={`absolute flex items-center rounded px-1 overflow-hidden border ${meta.bg} ${meta.border}`}
            style={{ top: TOP_PAD_PX + it.topPx, height: Math.max(it.heightPx - 1, MIN_BLOCK_PX), left: `${it.leftPct}%`, width: `calc(${it.widthPct}% - 2px)` }}
          >
            <div className="text-[10px] text-black leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{it.subject || meta.fallback}</div>
          </div>
        );
      })}
      {hover && <OfflineHoverCard rect={hover.rect} timeRangeText={hover.timeRangeText} notes={hover.notes} />}
    </div>
  );
}

export function PerformanceDayCard({ dayLabel, plannedItems, actualItems, plannedFailed, width = 300 }) {
  const callMinutes = sumMinutes((actualItems || []).filter(it => it.kind === "call"));
  const offlineMinutes = sumMinutes((actualItems || []).filter(it => it.kind === "offline"));

  return (
    <div className="glass-card rounded-xl p-3 flex-shrink-0 flex flex-col" style={{ width, height: CARD_VIEWPORT_PX }}>
      {/* Date + column-name header stays pinned at the top while the grid below scrolls. */}
      <div className="flex-shrink-0 bg-white">
        <h2 className="text-sm font-bold text-black mb-2 text-center">{dayLabel}</h2>
        <div className="flex gap-1 mb-1">
          <div style={{ width: RULER_WIDTH_PX }} aria-hidden="true" />
          <p className="flex-1 text-xs font-medium text-black text-center">מתוכנן</p>
          <p className="flex-1 text-xs font-medium text-black text-center">בפועל</p>
        </div>
      </div>

      {/* Only this middle section scrolls — the header above and the summary below stay put. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex gap-1">
          <RulerColumn />
          {plannedFailed ? (
            <div className="flex-1 flex items-center justify-center text-xs text-black text-center" style={{ height: TOTAL_HEIGHT_PX }}>
              לא ניתן<br />לבדוק
            </div>
          ) : (
            <TimeColumn items={plannedItems} isPlanned />
          )}
          <TimeColumn items={actualItems} />
        </div>
      </div>

      <div className="flex-shrink-0 bg-white mt-2 pt-2 border-t border-slate-100 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <span className="text-black">זמן שיחות:</span>
        <span className="font-medium text-black" dir="ltr">{formatDurationHM(callMinutes)}</span>
        <span className="text-black">זמן עבודה אופליין:</span>
        <span className="font-medium text-black" dir="ltr">{formatDurationHM(offlineMinutes)}</span>
        <span className="text-black font-semibold">סה״כ:</span>
        <span className="font-semibold text-black" dir="ltr">{formatDurationHM(callMinutes + offlineMinutes)}</span>
      </div>
    </div>
  );
}
