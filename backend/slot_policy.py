""""יומן יעיל" — which meeting times a public booking link may offer on one day, so schools
can't scatter short meetings across an advisor's day and leave no room for longer ones.

Pure logic (no DB): meeting_booking_router.py uses it both to list the offered times and to
re-validate the time a school actually submits.

The rule ("ספירת חלונות"), per advisor and per day, with the working-day edges counting as
events:
- every free gap of G minutes is worth floor(G / X) windows of X minutes (X = the task's
  "min free window");
- a candidate time costs (windows lost, minutes of "locked" dead time left) summed over the
  meeting's advisors — locked dead time = free gaps shorter than X, which only a short meeting
  can ever use (a spare hour inside a long gap is not locked: it still floats);
- only the candidates with the lowest cost of that day are allowed (lexicographic: windows
  first, then locked minutes). Among them the regular offer is the earliest one.

Candidate start times: the start-time grid (30 or 60 minutes, aligned to the clock) plus every
time that touches an event or a day edge exactly, which is allowed off the grid.
"""
from __future__ import annotations

AUTO_MIN_FREE_WINDOW = -1  # "אוטומטי": X per advisor and day from the requests still waiting (auto_window_by_advisor)
MIN_FREE_WINDOW_OPTIONS = (AUTO_MIN_FREE_WINDOW, 0, 30, 60, 90, 120, 180)  # 0 = "ללא הגבלה"
START_GRID_OPTIONS = (30, 60)
# How far outside a school's requested hours (on each side) a "closest to what you asked"
# time may still be offered.
NEAR_REQUEST_MARGIN = 60


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def parse_hhmm(text: str | None) -> int | None:
    try:
        hour, minute = str(text or "")[:5].split(":")
        value = int(hour) * 60 + int(minute)
    except ValueError:
        return None
    return value if 0 <= value <= 24 * 60 else None


def day_intervals(day_iso: str, blocks: list[dict]) -> list[tuple[int, int]]:
    """Busy blocks ({"start","end"} local ISO datetimes, as graph_client.get_freebusy and
    _local_meeting_busy_blocks return them) clipped to one day, in minutes of that day. Handles
    events that start on an earlier day or end on a later one (e.g. all-day events)."""
    out = []
    for b in blocks:
        start, end = str(b.get("start") or ""), str(b.get("end") or "")
        if len(start) < 16 or len(end) < 16 or start[:10] > day_iso or end[:10] < day_iso:
            continue
        s = parse_hhmm(start[11:16]) if start[:10] == day_iso else 0
        e = parse_hhmm(end[11:16]) if end[:10] == day_iso else 24 * 60
        if s is not None and e is not None and e > s:
            out.append((s, e))
    return out


def _free_gaps(busy: list[tuple[int, int]], work_start: int, work_end: int) -> list[tuple[int, int]]:
    gaps = []
    cursor = work_start
    for s, e in sorted(busy):
        if e <= cursor:
            continue
        if s > cursor:
            gaps.append((cursor, min(s, work_end)))
        cursor = max(cursor, e)
        if cursor >= work_end:
            break
    if cursor < work_end:
        gaps.append((cursor, work_end))
    return [(s, e) for s, e in gaps if e > s]


def _gap_value(length: int, min_window: int) -> tuple[int, int]:
    """(windows of min_window it holds, minutes of locked dead time)."""
    if length <= 0:
        return 0, 0
    if length < min_window:
        return 0, length
    return length // min_window, 0


def _candidate_cost(gaps_by_advisor: list[tuple[list[tuple[int, int]], int]], start: int, end: int) -> tuple[int, int] | None:
    """(windows lost, locked minutes after booking) for a candidate, or None if any advisor is
    busy at that time. Each advisor comes with its own min_window."""
    lost = locked_after = 0
    for gaps, min_window in gaps_by_advisor:
        containing = next(((gs, ge) for gs, ge in gaps if gs <= start and end <= ge), None)
        if containing is None:
            return None
        if not min_window:
            continue
        gs, ge = containing
        windows_before, _ = _gap_value(ge - gs, min_window)
        windows_a, locked_a = _gap_value(start - gs, min_window)
        windows_b, locked_b = _gap_value(ge - end, min_window)
        lost += windows_before - windows_a - windows_b
        locked_after += locked_a + locked_b + sum(
            _gap_value(e - s, min_window)[1] for s, e in gaps if (s, e) != containing
        )
    return lost, locked_after


def allowed_slots(busy_by_advisor: dict[str, list[tuple[int, int]]], work_start: int, work_end: int,
                  duration: int, min_window: int | dict[str, int], start_grid: int) -> list[tuple[int, int]]:
    """Every allowed (start, end) of one day under the rule, earliest first. A day where the
    meeting fits nowhere returns []. min_window is one X for everyone or {advisor_id: X}."""
    if duration <= 0 or work_end - work_start < duration:
        return []
    advisor_busy = list(busy_by_advisor.values()) or [[]]
    windows = [min_window.get(aid, 0) if isinstance(min_window, dict) else min_window for aid in busy_by_advisor] or [0]
    gaps_by_advisor = [(_free_gaps(busy, work_start, work_end), w) for busy, w in zip(advisor_busy, windows)]

    starts = {t for t in range(work_start, work_end - duration + 1) if t % start_grid == 0}
    starts.update({work_start, work_end - duration})
    for busy in advisor_busy:
        for s, e in busy:
            starts.update({e, s - duration})
    candidates = []
    for t in sorted(starts):
        if t < work_start or t + duration > work_end:
            continue
        cost = _candidate_cost(gaps_by_advisor, t, t + duration)
        if cost is not None:
            candidates.append((cost, t))
    if not candidates:
        return []
    best = min(cost for cost, _ in candidates)
    return [(t, t + duration) for cost, t in candidates if cost == best]


def offer_for_day(busy_by_advisor: dict[str, list[tuple[int, int]]], work_start: int, work_end: int,
                  duration: int, min_window: int | dict[str, int], start_grid: int,
                  requested: tuple[int, int] | None = None) -> dict:
    """The times shown for one day: "regular" = the earliest allowed time (one per day, as the
    booking page has always shown); "requested" = for a school's "אפשרויות נוספות" hours, the
    earliest allowed time inside them, else the closest one within NEAR_REQUEST_MARGIN of them
    (near=True)."""
    allowed = allowed_slots(busy_by_advisor, work_start, work_end, duration, min_window, start_grid)
    result = {"regular": allowed[:1], "requested": []}
    if requested and allowed:
        req_from, req_to = requested
        inside = [(s, e) for s, e in allowed if s >= req_from and e <= req_to]
        if inside:
            result["requested"] = [{"slot": inside[0], "near": False}]
        else:
            def distance(slot):
                s, e = slot
                return max(0, req_from - s) + max(0, e - req_to)
            near = [slot for slot in allowed
                    if slot[0] >= req_from - NEAR_REQUEST_MARGIN and slot[1] <= req_to + NEAR_REQUEST_MARGIN]
            if near:
                result["requested"] = [{"slot": min(near, key=lambda sl: (distance(sl), sl[0])), "near": True}]
    return result


def is_allowed(busy_by_advisor: dict[str, list[tuple[int, int]]], work_start: int, work_end: int,
               duration: int, min_window: int | dict[str, int], start_grid: int, start: int, end: int) -> bool:
    """Booking-time re-check: the submitted time must be one the rule allows right now."""
    if end - start != duration:
        return False
    return (start, end) in allowed_slots(busy_by_advisor, work_start, work_end, duration, min_window, start_grid)


def auto_window_by_advisor(pending: list[dict], day_iso: str, advisor_ids: list[str], own_duration: int) -> dict[str, int]:
    """"אוטומטי": for each advisor, X = the longest request still waiting to be booked with that
    advisor whose date range covers this day (pending rows: {"advisor_ids", "start_date",
    "end_date", "duration_minutes"}; the caller leaves out the school's own request). With none,
    X = the meeting's own length, so meetings of the same length still sit back to back."""
    out = {}
    for aid in advisor_ids:
        lengths = [
            int(p.get("duration_minutes") or 0) for p in pending
            if aid in (p.get("advisor_ids") or []) and str(p.get("start_date")) <= day_iso <= str(p.get("end_date"))
        ]
        out[aid] = max(lengths) if lengths else own_duration
    return out
