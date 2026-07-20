import axios from "axios";

// Short-lived in-memory cache for freebusy lookups — Graph calls are noticeably slower
// than normal CRUD, and without this every hover/reopen during the same edit re-fetches
// from scratch, which is where the "sometimes instant, sometimes slow" inconsistency
// came from. 60s is short enough that a genuinely new Outlook-side change still shows
// up quickly (the poll/webhook path already handles real-time correctness elsewhere —
// this cache is purely about not re-asking Graph the same question seconds apart).
const FREEBUSY_CACHE_TTL_MS = 60000;
const freebusyCache = new Map();

function getCached(key) {
  const entry = freebusyCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}
function setCached(key, data) {
  freebusyCache.set(key, { data, expiresAt: Date.now() + FREEBUSY_CACHE_TTL_MS });
}

// Must be called right after saving a meeting for this advisor — otherwise a freebusy
// popover reopened within the cache TTL would show pre-save data, silently omitting the
// meeting the user just created/edited from their own availability view.
export function invalidateFreebusyCache(advisorId) {
  if (!advisorId) return;
  for (const key of freebusyCache.keys()) {
    if (key.includes(`:${advisorId}:`)) freebusyCache.delete(key);
  }
}

export const DAY_START_MIN = 8 * 60;
export const DAY_END_MIN = 19 * 60;
export const WORK_START_MIN = 8 * 60;
export const WORK_END_MIN = 17 * 60;
export const PANEL_HEIGHT_PX = 220;
export const MIN_ROW_PX = 20;

export function toMinutes(hm) {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function fromMinutes(total) {
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Graph calendarView (Prefer: outlook.timezone="Israel Standard Time") already returns
// Israel wall-clock time — just slice the fixed-format string.
export function israelDayAndTime(dateTimeStr) {
  return { day: parseInt(dateTimeStr.slice(8, 10), 10), hm: dateTimeStr.slice(11, 16) };
}

// Returns the advisor's full busy list for the day, including this meeting's own synced
// event if any — callers that need to check for conflicts (where a meeting can't count
// as "conflicting" with itself) filter their own event id out of the result themselves.
//
// Returns `null` if the check itself failed (backend responded ok:false, or the request
// errored outright) — this must NEVER be treated the same as a real empty list. A failed
// check silently rendering as "confirmed free" is a real safety issue for a scheduling
// tool; callers should show a distinct "couldn't check" state instead of green/free.
// Failures are also deliberately not cached, so the next attempt is a real retry.
export async function fetchDayBusy(advisorId, dateStr) {
  if (!advisorId || !dateStr) return [];
  const cacheKey = `day:${advisorId}:${dateStr}`;
  const cached = getCached(cacheKey);
  if (cached) return cached.map(b => ({ id: b.id, startHM: b.start.slice(11, 16), endHM: b.end.slice(11, 16), subject: b.subject }));
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  try {
    const res = await axios.get("/calendar/freebusy", {
      params: { advisor_id: advisorId, start: dayStart.toISOString(), end: dayEnd.toISOString() },
    });
    if (res.data?.ok === false) return null;
    const busy = res.data?.busy || [];
    setCached(cacheKey, busy);
    return busy.map(b => ({ id: b.id, startHM: b.start.slice(11, 16), endHM: b.end.slice(11, 16), subject: b.subject }));
  } catch {
    return null;
  }
}

export async function fetchMonthBusyByDay(advisorId, viewYear, viewMonth) {
  if (!advisorId) return {};
  const cacheKey = `month:${advisorId}:${viewYear}-${viewMonth}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const start = new Date(viewYear, viewMonth, 1).toISOString();
  const end = new Date(viewYear, viewMonth + 1, 1).toISOString();
  try {
    const res = await axios.get("/calendar/freebusy", { params: { advisor_id: advisorId, start, end } });
    if (res.data?.ok === false) return null;
    const byDay = {};
    for (const b of (res.data?.busy || [])) {
      const startInfo = israelDayAndTime(b.start);
      const endInfo = israelDayAndTime(b.end);
      const day = startInfo.day;
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push({ id: b.id, startHM: startInfo.hm, endHM: endInfo.hm, subject: b.subject });
    }
    setCached(cacheKey, byDay);
    return byDay;
  } catch {
    return null;
  }
}

// Traffic-light classification for the day dot, restricted to 08:00–17:00: "green" = no
// events at all in that window, "orange" = a free gap bigger than 30 min exists, "red" =
// no gap bigger than 30 min (exactly 30 doesn't count as "enough").
export function classifyDay(ranges) {
  if (!ranges || ranges.length === 0) return "green";
  const sorted = [...ranges].sort((a, b) => toMinutes(a.startHM) - toMinutes(b.startHM));
  let cursor = WORK_START_MIN;
  let overlapsWorkHours = false;
  let hasFreeGapOver30 = false;
  for (const r of sorted) {
    const s = Math.max(toMinutes(r.startHM), WORK_START_MIN);
    const e = Math.min(toMinutes(r.endHM), WORK_END_MIN);
    if (s >= e) continue;
    overlapsWorkHours = true;
    if (s - cursor > 30) hasFreeGapOver30 = true;
    cursor = Math.max(cursor, e);
  }
  if (!overlapsWorkHours) return "green";
  if (WORK_END_MIN - cursor > 30) hasFreeGapOver30 = true;
  return hasFreeGapOver30 ? "orange" : "red";
}

function clusterOverlaps(sortedRanges) {
  const clusters = [];
  let current = null;
  for (const r of sortedRanges) {
    const s = toMinutes(r.startHM), e = toMinutes(r.endHM);
    if (!current || s >= current.end) {
      current = { start: s, end: e, items: [r] };
      clusters.push(current);
    } else {
      current.items.push(r);
      current.end = Math.max(current.end, e);
    }
  }
  return clusters;
}

function assignLanes(items) {
  const laneEnds = [];
  const laneOf = [];
  for (const it of items) {
    const s = toMinutes(it.startHM);
    let placed = false;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= s) { laneEnds[i] = toMinutes(it.endHM); laneOf.push(i); placed = true; break; }
    }
    if (!placed) { laneEnds.push(toMinutes(it.endHM)); laneOf.push(laneEnds.length - 1); }
  }
  return { laneCount: laneEnds.length, laneOf };
}

// Full-day timeline (08:00–19:00). Overlapping events (e.g. a day-off spanning a
// scheduled meeting) are grouped into "clusters" and rendered as side-by-side lanes
// instead of being naively stacked one below the other as if they were sequential.
export function computeSegments(ranges) {
  const clipped = (ranges || [])
    .map(r => ({
      startHM: fromMinutes(Math.max(toMinutes(r.startHM), DAY_START_MIN)),
      endHM: fromMinutes(Math.min(toMinutes(r.endHM), DAY_END_MIN)),
      subject: r.subject,
      id: r.id,
    }))
    .filter(r => toMinutes(r.startHM) < toMinutes(r.endHM))
    .sort((a, b) => toMinutes(a.startHM) - toMinutes(b.startHM));

  const clusters = clusterOverlaps(clipped);
  const totalMin = DAY_END_MIN - DAY_START_MIN;
  const blocks = [];
  let cursor = DAY_START_MIN;

  for (const c of clusters) {
    if (c.start > cursor) {
      blocks.push({ type: "free", startHM: fromMinutes(cursor), endHM: fromMinutes(c.start), heightPx: Math.max(MIN_ROW_PX, ((c.start - cursor) / totalMin) * PANEL_HEIGHT_PX) });
    }
    const { laneCount, laneOf } = assignLanes(c.items);
    if (laneCount === 1) {
      // No genuine overlap — a single item spanning this whole cluster window.
      // Render it as one plain busy row, not a lane grid.
      const it = c.items[0];
      blocks.push({ type: "busy", startHM: it.startHM, endHM: it.endHM, subject: it.subject, id: it.id, heightPx: Math.max(MIN_ROW_PX, ((c.end - c.start) / totalMin) * PANEL_HEIGHT_PX) });
      cursor = c.end;
      continue;
    }
    const lanes = Array.from({ length: laneCount }, () => []);
    c.items.forEach((it, i) => lanes[laneOf[i]].push(it));
    // Fill each lane with busy/empty sub-segments spanning exactly [c.start, c.end], using
    // flex-grow=duration so proportional sizing works without extra pixel math per lane.
    // A gap within a lane is *not* "free" — another lane may well be busy at that same
    // moment — so it renders as a blank spacer, never a green "פנוי" label.
    const laneSubSegments = lanes.map(laneItems => {
      const subs = [];
      let laneCursor = c.start;
      for (const it of laneItems) {
        const s = toMinutes(it.startHM), e = toMinutes(it.endHM);
        if (s > laneCursor) subs.push({ type: "empty", grow: s - laneCursor });
        subs.push({ type: "busy", startHM: it.startHM, endHM: it.endHM, subject: it.subject, id: it.id, grow: e - s });
        laneCursor = e;
      }
      if (laneCursor < c.end) subs.push({ type: "empty", grow: c.end - laneCursor });
      return subs;
    });
    blocks.push({
      type: "cluster",
      startHM: fromMinutes(c.start), endHM: fromMinutes(c.end),
      heightPx: Math.max(MIN_ROW_PX, ((c.end - c.start) / totalMin) * PANEL_HEIGHT_PX),
      lanes: laneSubSegments,
    });
    cursor = c.end;
  }
  if (cursor < DAY_END_MIN) {
    blocks.push({ type: "free", startHM: fromMinutes(cursor), endHM: fromMinutes(DAY_END_MIN), heightPx: Math.max(MIN_ROW_PX, ((DAY_END_MIN - cursor) / totalMin) * PANEL_HEIGHT_PX) });
  }
  return blocks;
}

// Just the genuinely free windows within 08:00–19:00 (top-level gaps only — a lane gap
// inside an overlap cluster does NOT mean free, since another lane may still be busy).
export function computeFreeWindows(ranges) {
  return computeSegments(ranges)
    .filter(b => b.type === "free")
    .map(b => ({ startHM: b.startHM, endHM: b.endHM }));
}

// For the end-time hover hint: given a chosen start time, find the next busy event
// starting at/after it on that day.
export function findNextEvent(startHM, ranges) {
  const s = toMinutes(startHM);
  if (s === null) return null;
  const upcoming = (ranges || [])
    .filter(r => toMinutes(r.startHM) >= s)
    .sort((a, b) => toMinutes(a.startHM) - toMinutes(b.startHM));
  return upcoming[0] || null;
}
