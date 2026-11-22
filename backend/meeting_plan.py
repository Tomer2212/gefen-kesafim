"""תוכנית פגישות — how many meetings a school needs in each month of an academic year, per service
type. Stored in school_year_admin_data.meeting_plan as
    {"gefen": {"09": 1, "12": 1}, "current": {"09": 1, ...}, "district": {...},
     "physical": {"gefen": ["12"]}}
(month "MM" → count; months with no meeting are left out; a type with no meetings is left out;
an empty plan is NULL). Per year, like the allocation it is usually derived from — no inheritance.
"physical" marks the months in which one of that type's meetings has to be in person. It is
information only: a round uses it to pre-mark its in-person schools for the manager to confirm,
and nothing is ever booked from it (in-person meetings are offered only on the advisor's field days).

The plan is the "כרטיסייה": a round asks for everything the plan says should have happened by its
end, minus what the school already had that year — so a missed meeting is never lost, it is due
again in the next round (planned_before / planned_in below are what a round reads).

Mirrored by frontend/src/constants/meetingPlan.js — keep the two in sync.
"""
from __future__ import annotations

from datetime import date

from academic_years import get_academic_year_date_range

PLAN_TYPES = ("gefen", "current", "district")
# Academic-year order: September first.
ACADEMIC_MONTHS = ("09", "10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08")
MAX_PER_MONTH = 9


def normalize_plan(value) -> dict | None:
    """Cleans a plan from a client: known types and months only, whole counts 1..MAX_PER_MONTH,
    zero months and empty types dropped, physical marks kept only on months that have a meeting.
    None / {} → None (cleared). Raises ValueError on anything malformed (not a dict, a count that
    isn't a number, a negative count), so a bad value is rejected — never stored, never a silent wipe."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("plan must be an object")
    out: dict = {}
    for t in PLAN_TYPES:
        months = value.get(t)
        if months is None:
            continue
        if not isinstance(months, dict):
            raise ValueError("months must be an object")
        clean: dict[str, int] = {}
        for m in ACADEMIC_MONTHS:
            raw = months.get(m)
            if raw in (None, "", 0):
                continue
            n = int(raw)
            if n < 0:
                raise ValueError("negative count")
            if n:
                clean[m] = min(n, MAX_PER_MONTH)
        if clean:
            out[t] = clean
    physical_in = value.get("physical") or {}
    if not isinstance(physical_in, dict):
        raise ValueError("physical must be an object")
    physical = {}
    for t in PLAN_TYPES:
        marked = physical_in.get(t) or []
        if not isinstance(marked, list):
            raise ValueError("physical months must be a list")
        keep = [m for m in ACADEMIC_MONTHS if m in marked and m in out.get(t, {})]
        if keep:
            physical[t] = keep
    if physical:
        out["physical"] = physical
    return out or None


def physical_months(plan: dict | None, plan_type: str) -> list[str]:
    """Months in which one of `plan_type`'s meetings has to be in person."""
    return list(((plan or {}).get("physical") or {}).get(plan_type) or [])


def spread(total) -> dict[str, int]:
    """`total` meetings spread evenly over the academic year, starting in September:
    12 → every month, 6 → every second month, 4 → the first month of every quarter,
    3 → every four months. Used for "לפי ההקצאה" and the fixed-rhythm buttons."""
    try:
        n = int(round(float(total or 0)))
    except (TypeError, ValueError):
        return {}
    out: dict[str, int] = {}
    for i in range(max(0, n)):
        m = ACADEMIC_MONTHS[(i * 12) // n]
        out[m] = min(out.get(m, 0) + 1, MAX_PER_MONTH)
    return out


def type_total(plan: dict | None, plan_type: str) -> int:
    return sum((plan or {}).get(plan_type, {}).values())


def month_date(academic_year: str, month: str) -> date:
    """The first day of `month` ("MM") inside `academic_year`."""
    start, _end = get_academic_year_date_range(academic_year)
    m = int(month)
    return date(start.year if m >= 9 else start.year + 1, m, 1)


def month_end(academic_year: str, month: str) -> date:
    first = month_date(academic_year, month)
    nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1)


def planned_before(plan: dict | None, plan_type: str, academic_year: str, start: date) -> int:
    """Meetings of `plan_type` in months that ended before `start` — what should already have
    happened when a round starting on `start` opens."""
    return sum(n for m, n in (plan or {}).get(plan_type, {}).items() if month_end(academic_year, m) < start)


def planned_in(plan: dict | None, plan_type: str, academic_year: str, start: date, end: date) -> int:
    """Meetings of `plan_type` in months that overlap [start, end] and hadn't ended before it —
    a round from Dec 15 still includes December's meeting (the month isn't over yet)."""
    return sum(
        n for m, n in (plan or {}).get(plan_type, {}).items()
        if month_end(academic_year, m) >= start and month_date(academic_year, m) <= end
    )


def physical_in(plan: dict | None, plan_type: str, academic_year: str, start: date, end: date) -> list[str]:
    """The physically-marked months of `plan_type` that belong to a round [start, end]."""
    return [m for m in physical_months(plan, plan_type)
            if month_end(academic_year, m) >= start and month_date(academic_year, m) <= end]


# ---------------------------------------------------------------------------
# A round "לפי תוכנית" (meeting_rounds.plan_mode = "plan") — what each school needs in it.
# A "part" is one service type a school is asked meetings of: gefen / current / district (they
# have a plan), takuma (no plan — always entered by hand). The round stores per school and part
# meeting_rounds.school_plan[sid][part] = {planned_before, planned_in, offer, manual, source}:
#   planned_before = the plan's meetings in months that ended before the round (snapshot),
#   planned_in     = the plan's meetings inside the round (snapshot; the manager may change it),
#   offer          = whether meetings missing from before the round are asked now (else deferred
#                    to the next round — never dropped),
#   manual         = the school had no plan for the part; planned_in was typed in by the manager,
#   source         = plan_source(...) of the card when the snapshot was taken ("card changed").
# What the school already has is read live (meetings_before), so a cancelled meeting is missing
# again at once.
# ---------------------------------------------------------------------------

# Which parts a round meeting type is made of, and which meeting types count for a part
# (a combined גפן+שוטף meeting covers both).
MEETING_TYPE_PARTS = {"gefen": ["gefen"], "current": ["current"], "district": ["district"],
                      "takuma": ["takuma"], "gefen_current": ["gefen", "current"]}
PART_MEETING_TYPES = {"gefen": {"gefen", "gefen_current"}, "current": {"current", "gefen_current"},
                      "district": {"district"}, "takuma": {"takuma"}}
PART_LABELS = {"gefen": "גפן", "current": "שוטף", "district": "מחוז", "takuma": "תקומה"}
MAX_PER_ROUND = 30


def parts_for_types(meeting_types: list[str]) -> list[str]:
    out: list[str] = []
    for t in meeting_types:
        for p in MEETING_TYPE_PARTS.get(t, []):
            if p not in out:
                out.append(p)
    return out


def plan_source(plan: dict | None, part: str) -> str:
    """A fingerprint of the card's plan for one part — compared later to tell the manager the
    card changed after the round took its snapshot."""
    months = (plan or {}).get(part) or {}
    marks = physical_months(plan, part)
    return ",".join(f"{m}:{months[m]}" for m in ACADEMIC_MONTHS if m in months) + "|" + ",".join(marks)


def meetings_before(school_meetings: list[dict], part: str, academic_year: str, start: date) -> int:
    """Scheduled/completed meetings of the part this academic year, dated before the round."""
    year_start, _ = get_academic_year_date_range(academic_year)
    types = PART_MEETING_TYPES.get(part, set())
    count = 0
    for m in school_meetings:
        d = m.get("meeting_date")
        if not d or m.get("status") not in ("scheduled", "completed") or m.get("meeting_service_type") not in types:
            continue
        if year_start.isoformat() <= d[:10] < start.isoformat():
            count += 1
    return count


def snapshot_part(plan: dict | None, part: str, academic_year: str, start: date, end: date) -> dict | None:
    """The round's entry for one part from the card's plan, or None when the card has no plan
    for it (takuma never has one) — the manager must then enter the number."""
    if part not in PLAN_TYPES or not type_total(plan, part):
        return None
    return {
        "planned_before": planned_before(plan, part, academic_year, start),
        "planned_in": planned_in(plan, part, academic_year, start, end),
        "offer": True, "manual": False, "source": plan_source(plan, part),
    }


def part_need(entry: dict, held_before: int) -> dict:
    """{carried, ahead, required}: meetings missing from before the round (asked now only when
    offered), meetings held ahead of the plan (they reduce what the round asks), and the number
    the round asks of the school for the part."""
    pb, pin = int(entry.get("planned_before") or 0), int(entry.get("planned_in") or 0)
    carried = max(0, pb - held_before)
    ahead = max(0, held_before - pb)
    in_need = max(0, pin - ahead)
    return {"carried": carried, "ahead": ahead,
            "required": in_need + (carried if entry.get("offer", True) else 0)}


def required_by_meeting_type(school_entry: dict | None, held_before: dict[str, int]) -> dict[str, int] | None:
    """{meeting type: required count} for a school's expanded round conditions, from its
    school_plan entry — a combined גפן+שוטף meeting needs as many as the larger of its parts.
    None when a part has no entry (the school still needs numbers — "missing_plan")."""
    if school_entry is None:
        return None
    req = {}
    for part, entry in school_entry.items():
        if part in PART_MEETING_TYPES and isinstance(entry, dict):
            req[part] = part_need(entry, held_before.get(part, 0))["required"]
    out = dict(req)
    if "gefen" in req and "current" in req:
        out["gefen_current"] = max(req["gefen"], req["current"])
    return out


# ---------------------------------------------------------------------------
# Requests of a task created from a round "לפי תוכנית": the school gets one request per meeting
# it still needs, each with its own dates — the plan's month (clipped to the round) for a
# meeting planned inside the round, the whole round for one missing from before it.
# ---------------------------------------------------------------------------

def split_evenly(start: date, end: date, n: int) -> list[tuple[date, date]]:
    """[start, end] cut into n consecutive windows of (almost) equal length."""
    if n <= 0:
        return []
    days = (end - start).days + 1
    out = []
    for i in range(n):
        a = start.toordinal() + (days * i) // n
        b = start.toordinal() + (days * (i + 1)) // n - 1
        out.append((date.fromordinal(a), date.fromordinal(max(a, b))))
    return out


def in_round_windows(card_plan: dict | None, entry: dict, part: str, academic_year: str,
                     start: date, end: date) -> list[tuple[date, date]]:
    """One window per meeting planned inside the round: the plan's own months (clipped to the
    round) while the card still matches the round's snapshot, else the round split evenly —
    a number the manager typed in has no months of its own."""
    n = int(entry.get("planned_in") or 0)
    windows: list[tuple[date, date]] = []
    if not entry.get("manual") and plan_source(card_plan, part) == entry.get("source"):
        for m in ACADEMIC_MONTHS:
            count = ((card_plan or {}).get(part) or {}).get(m, 0)
            a, b = max(month_date(academic_year, m), start), min(month_end(academic_year, m), end)
            if count and a <= b:
                windows.extend([(a, b)] * count)
    return windows if len(windows) == n else split_evenly(start, end, n)


def request_windows(card_plan: dict | None, entry: dict, part: str, academic_year: str, start: date,
                    end: date, held_before: int, in_round_dates: list[str], today: date) -> list[tuple[date, date]]:
    """The windows of the requests still to send for one part: the round's meetings (in-round
    windows minus those covered by meetings held ahead of the plan, plus whole-round windows for
    offered missed meetings), minus one window per meeting already in the round (the window
    holding its date, else a whole-round one, else the earliest). Windows already over move to
    the rest of the round; nothing is sent once the round is over."""
    if today > end:
        return []
    need = part_need(entry, held_before)
    windows = in_round_windows(card_plan, entry, part, academic_year, start, end)[need["ahead"]:]
    windows += [(start, end)] * (need["carried"] if entry.get("offer", True) else 0)
    for d in sorted(in_round_dates):
        dd = date.fromisoformat(d[:10])
        idx = next((i for i, (a, b) in enumerate(windows) if a <= dd <= b and (a, b) != (start, end)), None)
        if idx is None:
            idx = next((i for i, w in enumerate(windows) if w == (start, end)), None)
        if idx is None and windows:
            idx = 0
        if idx is not None:
            windows.pop(idx)
    out = []
    for a, b in windows:
        if b < today:
            a, b = today, end  # its month is over — any day left in the round
        out.append((max(a, today), b))
    return sorted(out)
