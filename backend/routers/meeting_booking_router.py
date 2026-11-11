import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

import booking_lock
import graph_client
import meeting_activity
import slot_policy
import task_logic
from academic_years import DEFAULT_ACADEMIC_YEAR
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()
_IL_TZ = ZoneInfo("Asia/Jerusalem")


def _now_il() -> datetime:
    return datetime.now(_IL_TZ)


def _upcoming_dates(dates: list[str]) -> list[str]:
    """A link lives for weeks, so its date range may already have started: past days are never
    offered (today is, from the current time on — see _not_started_yet)."""
    today = _now_il().date().isoformat()
    return [d for d in dates if d >= today]


def _not_started_yet(meeting_date: str, start_time: str) -> bool:
    now = _now_il()
    return (meeting_date, start_time) > (now.date().isoformat(), now.strftime("%H:%M"))


def _get_valid_token(db, token: str) -> dict:
    res = db.table("meeting_booking_tokens").select("*").eq("token", token).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="קישור לא נמצא")
    row = res.data[0]
    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="פג תוקפו של קישור זה")
    return row


def _open_months(token_row: dict) -> list[str]:
    booked = set(token_row.get("booked_months") or [])
    return [m for m in (token_row.get("months") or []) if m not in booked]


def _is_range_mode(token_row: dict) -> bool:
    return bool(token_row.get("date_ranges"))


def _range_by_key(token_row: dict, range_key: str) -> dict:
    for r in (token_row.get("date_ranges") or []):
        if r["key"] == range_key:
            return r
    raise HTTPException(status_code=404, detail="טווח לא נמצא")


def _range_is_booked(token_row: dict, range_key: str) -> bool:
    return range_key in set(token_row.get("booked_ranges") or [])


def _range_segments(range_row: dict) -> list[dict]:
    """A range's OR'd date segments — `segments` for ranges created after the multi-range
    feature; falls back to the single start_date/end_date pair for older tokens that predate
    it, so they keep working unchanged."""
    return range_row.get("segments") or [{"start_date": range_row["start_date"], "end_date": range_row["end_date"]}]


def _local_meeting_busy_blocks(db, advisor_ids: list[str], start_iso: str, end_iso: str) -> list[dict]:
    """Round 9 — the local counterpart to graph_client.get_freebusy: meetings already written to
    our own `meetings` table (status="scheduled") for any of these advisors, overlapping the
    given date range. Consulted alongside Graph's freebusy so a just-booked meeting is excluded
    from slot generation / re-checked at confirm time even before its Outlook sync completes
    (that sync is best-effort and can lag a few seconds) — this closes the double-booking race
    window that relying on Graph alone would leave open, since two nearly-simultaneous confirm
    requests both hit this same fast local check before either one's calendar sync finishes.
    Same busy-block shape as get_freebusy's return value: [{"start": iso, "end": iso}].
    Advisor membership is checked in Python (mirrors the existing pattern at
    schools_router.py's meetings-listing endpoint) rather than a DB-side array-overlap query —
    the date-range + status filters already keep the fetched row count small."""
    if not advisor_ids:
        return []
    rows = (
        db.table("meetings").select("meeting_date, start_time, end_time, advisor_ids")
        .eq("status", "scheduled")
        .gte("meeting_date", start_iso[:10]).lte("meeting_date", end_iso[:10])
        .execute().data or []
    )
    advisor_set = set(advisor_ids)
    blocks = []
    for m in rows:
        if advisor_set.isdisjoint(m.get("advisor_ids") or []):
            continue
        blocks.append({"start": f"{m['meeting_date']}T{m['start_time']}:00", "end": f"{m['meeting_date']}T{m['end_time']}:00"})
    return blocks


def _uses_slot_policy(range_row: dict) -> bool:
    """Ranges created with the "יומן יעיל" questions (min_free_window_minutes set, 0 included)
    go through slot_policy; older links keep the original earliest-slot behavior untouched."""
    return range_row.get("min_free_window_minutes") is not None


def _outlook_busy_by_advisor(db, org_id: str, advisor_ids: list[str], start_iso: str, end_iso: str) -> dict[str, list[dict]] | None:
    """Each advisor's own Outlook busy blocks. None when any advisor's calendar can't be read."""
    out: dict[str, list[dict]] = {}
    for advisor_id in advisor_ids:
        advisor_busy = graph_client.get_freebusy(db, org_id, advisor_id, start_iso, end_iso)
        if advisor_busy is None:
            return None
        out[advisor_id] = graph_client.reconcile_busy_blocks(db, advisor_busy)
    return out


def _busy_by_advisor(db, org_id: str, advisor_ids: list[str], start_iso: str, end_iso: str) -> dict[str, list[dict]] | None:
    """Each advisor's own busy blocks (Outlook + our scheduled meetings) — slot_policy checks
    every advisor's calendar separately. None when any advisor's calendar can't be read."""
    out = _outlook_busy_by_advisor(db, org_id, advisor_ids, start_iso, end_iso)
    if out is None:
        return None
    for advisor_id, blocks in _local_meeting_busy_by_advisor(db, advisor_ids, start_iso, end_iso).items():
        out[advisor_id] = out[advisor_id] + blocks
    return out


def _local_meeting_busy_by_advisor(db, advisor_ids: list[str], start_iso: str, end_iso: str) -> dict[str, list[dict]]:
    """_local_meeting_busy_blocks split per advisor, with one query for all of them."""
    out: dict[str, list[dict]] = {aid: [] for aid in advisor_ids}
    rows = (
        db.table("meetings").select("meeting_date, start_time, end_time, advisor_ids")
        .eq("status", "scheduled")
        .gte("meeting_date", start_iso[:10]).lte("meeting_date", end_iso[:10])
        .execute().data or []
    )
    for m in rows:
        block = {"start": f"{m['meeting_date']}T{m['start_time']}:00", "end": f"{m['meeting_date']}T{m['end_time']}:00"}
        for aid in m.get("advisor_ids") or []:
            if aid in out:
                out[aid].append(block)
    return out


def _with_elapsed_time(day_iso: str, busy_today: dict[str, list[tuple[int, int]]], start_grid: int) -> dict[str, list[tuple[int, int]]]:
    """On today's date the time already gone (rounded up to the start-time grid, so "now" never
    becomes an odd start like 10:21) counts as busy: the rule treats it like the start of the
    working day instead of offering, or counting gaps in, the past."""
    now = _now_il()
    if day_iso != now.date().isoformat():
        return busy_today
    elapsed = (0, -(-(now.hour * 60 + now.minute + 1) // start_grid) * start_grid)
    return {aid: [elapsed, *intervals] for aid, intervals in busy_today.items()}


def _policy_args(token_row: dict, range_row: dict) -> tuple[int, int, int, int, int]:
    sched = token_row["scheduling_window"]
    return (
        sched["start_hour"] * 60, sched["end_hour"] * 60, range_row["duration_minutes"],
        int(range_row.get("min_free_window_minutes") or 0), int(range_row.get("start_grid_minutes") or 30),
    )


def _policy_dates(token_row: dict, range_row: dict) -> set[str]:
    """The dates the range may be booked on (its segments x the working days). Blocked dates are
    checked separately by the booking endpoint (_find_blocking_rule)."""
    days_of_week = token_row["scheduling_window"]["days_of_week"]
    return {d for seg in _range_segments(range_row) for d in _range_dates_in_window(seg["start_date"], seg["end_date"], days_of_week)}


def _find_existing_meeting(db, school_id: str, service_type: str, start_date: str, end_date: str,
                            stage_scope: str | None = None) -> dict | None:
    """Round-7 live check — a school may already have a genuine scheduled meeting of this
    service_type overlapping the requested range (booked another way entirely, e.g. by phone,
    or via a different token) even though THIS token's own booked_ranges never recorded one.
    "scheduled" is the codebase's own convention for "a real, non-cancelled booking" (matches
    schools_router.py's existing filters, e.g. line 794/2909/3195) — "cancelled"/"postponed"/
    "other" must not count. Checked live on every page load, not baked into the token at
    creation time, so it also catches a meeting scheduled AFTER the link was sent.

    Round 17: stage_scope=("tichon"|"chativa") scopes the check to meetings for that specific
    principal (or a "both"/unset legacy meeting, which covers either) — without this, a
    "separate" split condition's two ranges (same school/type/date-window, different principal)
    were indistinguishable, so booking either one falsely "existing_meeting"-blocked the other.
    stage_scope=None (the normal, non-split case) keeps the exact original behavior."""
    query = (
        db.table("meetings").select("meeting_date, start_time, end_time")
        .eq("school_id", school_id).eq("meeting_service_type", service_type).eq("status", "scheduled")
        .gte("meeting_date", start_date).lte("meeting_date", end_date)
    )
    if stage_scope in ("tichon", "chativa"):
        query = query.or_(f"stage_scope.eq.{stage_scope},stage_scope.eq.both,stage_scope.is.null")
    rows = query.limit(1).execute().data or []
    return rows[0] if rows else None


def _find_existing_meeting_explicit_scope(db, school_id: str, service_type: str, segments: list[dict], stage_scope: str) -> dict | None:
    """The live check for a range minted with explicit_stage_scope_only, using the same
    stage_scope_is_covered rule as compute_task_progress so the booking page and the task's
    progress can't disagree: an unmarked meeting doesn't block booking here and doesn't count there.
    Completed meetings count too, as in progress: auto-completion closes a meeting soon after it
    happens, and a school opening its link afterwards must not be offered a duplicate."""
    rows = []
    for seg in segments:
        rows.extend(
            db.table("meetings").select("meeting_date, start_time, end_time, stage_scope")
            .eq("school_id", school_id).eq("meeting_service_type", service_type).in_("status", ["scheduled", "completed"])
            .gte("meeting_date", seg["start_date"]).lte("meeting_date", seg["end_date"])
            .execute().data or []
        )
    if not task_logic.stage_scope_is_covered(stage_scope, [r.get("stage_scope") for r in rows]):
        return None
    counted = (stage_scope, "both") if stage_scope in ("tichon", "chativa") else ("tichon", "chativa", "both")
    covering = next(r for r in rows if r.get("stage_scope") in counted)
    return {k: covering[k] for k in ("meeting_date", "start_time", "end_time")}


def _find_existing_meeting_any_segment(db, school_id: str, service_type: str, segments: list[dict],
                                        stage_scope: str | None = None, explicit_scope_only: bool = False) -> dict | None:
    """OR's _find_existing_meeting across every one of a range's date segments — a school
    already has a real scheduled meeting for this range if ANY of the offered "או" windows
    already has one. explicit_scope_only: the range's own flag, set only on ranges of tasks created
    under the explicit-division rule; direct-coordination links and older links keep this check."""
    if explicit_scope_only and stage_scope in ("tichon", "chativa", "both"):
        return _find_existing_meeting_explicit_scope(db, school_id, service_type, segments, stage_scope)
    for seg in segments:
        m = _find_existing_meeting(db, school_id, service_type, seg["start_date"], seg["end_date"], stage_scope)
        if m:
            return m
    return None


def _time_overlaps(s1: str, e1: str, s2: str, e2: str) -> bool:
    return s1 < e2 and s2 < e1


def _filter_blocked_dates(db, org_id: str, school_id: str, dates: list[str]) -> list[str]:
    """Drops any date covered by an org-wide or school-scoped blocked_dates row — a blocked
    date must never appear as a bookable slot on the public self-scheduling page. Fetches the
    school's scope fields + all overlapping blocked_dates rows once (not per-date) to keep this
    cheap even for a full month/range of candidate dates."""
    if not dates:
        return dates
    from routers.schools_router import BLOCKED_DATE_SCOPE_FIELDS
    school_res = db.table("schools").select(",".join(("id",) + BLOCKED_DATE_SCOPE_FIELDS)).eq("id", school_id).execute().data
    school = school_res[0] if school_res else None
    rules = (
        db.table("blocked_dates").select("*").eq("org_id", org_id)
        .lte("start_date", dates[-1]).gte("end_date", dates[0])
        .execute().data or []
    )
    if not rules:
        return dates

    def is_blocked(d):
        for r in rules:
            if not (r["start_date"] <= d <= r["end_date"]):
                continue
            if not r.get("scope_field"):
                return True
            if school and school.get(r["scope_field"]) in (r.get("scope_values") or []):
                return True
        return False

    return [d for d in dates if not is_blocked(d)]


def _month_dates_in_window(month: str, days_of_week: list[int]) -> list[str]:
    """All calendar dates in `month` (YYYY-MM) whose weekday is in days_of_week.
    Convention: 0=Sunday .. 6=Saturday (Israeli work week), matching Python's
    weekday() shifted by one (Python: 0=Monday..6=Sunday -> iso: (py_weekday+1)%7)."""
    year, mon = int(month[:4]), int(month[5:7])
    d = date(year, mon, 1)
    out = []
    while d.month == mon:
        israeli_weekday = (d.weekday() + 1) % 7
        if israeli_weekday in days_of_week:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _range_dates_in_window(start_date: str, end_date: str, days_of_week: list[int]) -> list[str]:
    """All calendar dates from start_date to end_date (inclusive, both YYYY-MM-DD) whose
    weekday is in days_of_week. Same weekday convention as _month_dates_in_window."""
    d = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    out = []
    while d <= end:
        israeli_weekday = (d.weekday() + 1) % 7
        if israeli_weekday in days_of_week:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _slots_for_day(day_iso: str, window: dict, busy_blocks: list[dict]) -> list[dict]:
    """Round 9: returns at most ONE slot per day — the earliest point in the window with enough
    contiguous free time for the full meeting duration. Previously enumerated every 30-minute
    grid position across the whole window regardless of duration, which let a school pick a
    time that left a gap too short for the advisor to ever book anything else into (e.g. a
    lone 30-minute hole before/after an existing meeting).

    window uses minute-of-day precision (start_minute/end_minute, same convention as
    advisor_finder_router._all_slots_for_day) rather than whole hours — needed so a school's
    "אפשרויות נוספות" narrowed re-search (e.g. 14:30-16:00) isn't rounded to the hour."""
    cur_minutes, end_minutes, duration = window["start_minute"], window["end_minute"], window["duration_minutes"]
    day_busy = [b for b in busy_blocks if b.get("start", "").startswith(day_iso)]
    slots = []
    while cur_minutes + duration <= end_minutes:
        slot_start = f"{cur_minutes // 60:02d}:{cur_minutes % 60:02d}"
        slot_end_min = cur_minutes + duration
        slot_end = f"{slot_end_min // 60:02d}:{slot_end_min % 60:02d}"
        overlap = any(
            _time_overlaps(slot_start, slot_end, b["start"][11:16], b["end"][11:16])
            for b in day_busy
        )
        if not overlap:
            slots.append({"start_time": slot_start, "end_time": slot_end})
            break
        cur_minutes += 30  # offer slots on a 30-min grid regardless of meeting duration
    return slots


# ---------------------------------------------------------------------------
# Public (unauthenticated, token-gated) endpoints
# ---------------------------------------------------------------------------

@router.get("/public/meeting-booking/{token}")
def get_booking_info(token: str):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)

    # Round-7: record the first time this link is actually opened — a 100%-reliable "link
    # clicked" signal for TaskPanel's send-status tooltip (unlike email-open pixel tracking,
    # which the product owner explicitly declined for its structural unreliability). Genuinely
    # non-fatal — this is a nice-to-have signal, not something that guards data integrity.
    if not token_row.get("first_viewed_at"):
        try:
            db.table("meeting_booking_tokens").update({"first_viewed_at": datetime.now(timezone.utc).isoformat()}).eq("id", token_row["id"]).execute()
        except Exception as exc:
            logger.warning("failed to record first_viewed_at for token %s (non-fatal): %s", token_row["id"], exc)

    school_res = db.table("schools").select("id, name").eq("id", token_row["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]

    if _is_range_mode(token_row):
        advisor_ids = token_row.get("advisor_ids") or [token_row["advisor_id"]]
        advisor_res = db.table("profiles").select("id, full_name").in_("id", advisor_ids).execute()
        advisor_names_by_id = {a["id"]: a["full_name"] for a in (advisor_res.data or [])}
        advisor_names = list(advisor_names_by_id.values())
        booked = set(token_row.get("booked_ranges") or [])
        ranges = []
        for r in (token_row.get("date_ranges") or []):
            is_booked = r["key"] in booked
            existing = None
            existing_fyi = None
            if not is_booked:
                found = _find_existing_meeting_any_segment(db, token_row["school_id"], r["service_type"], _range_segments(r), r.get("stage_scope"), r.get("explicit_stage_scope_only"))
                # "בקש לקבוע פגישה נוספת" — a pre-existing meeting must not block offering a
                # NEW slot for this range; surfaced as a non-blocking FYI instead (the frontend
                # still shows "בחר מועד").
                if found and r.get("require_additional_meeting"):
                    existing_fyi = found
                else:
                    existing = found
            # Round 9 fix: show which specific advisor(s) THIS meeting is with — previously
            # only the token-wide union was shown once at the top of the page, so a school with
            # e.g. a "גפן" meeting with advisor A and a "שוטף" meeting with advisor B saw both
            # names lumped together with no indication of which meeting was with whom.
            range_advisor_ids = r.get("advisor_ids") or advisor_ids
            range_advisor_names = [advisor_names_by_id[aid] for aid in range_advisor_ids if aid in advisor_names_by_id]
            ranges.append({**r, "booked": is_booked, "existing_meeting": existing, "existing_meeting_fyi": existing_fyi, "advisor_names": range_advisor_names})
        return {
            "mode": "ranges",
            "school_name": school["name"],
            "advisor_names": advisor_names,
            "ranges": ranges,
        }

    advisor_res = db.table("profiles").select("id, full_name").eq("id", token_row["advisor_id"]).execute()
    advisor_name = advisor_res.data[0]["full_name"] if advisor_res.data else ""

    return {
        "mode": "months",
        "school_name": school["name"],
        "advisor_name": advisor_name,
        "open_months": _open_months(token_row),
        "scheduling_window": token_row["scheduling_window"],
    }


def _parse_hhmm_to_minutes(text: str | None) -> int | None:
    m = re.fullmatch(r"(\d{2}):(\d{2})", text or "")
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def _policy_freebusy(db, token_row: dict, range_row: dict, segments: list[dict],
                     time_from: str | None, time_to: str | None) -> dict:
    """"יומן יעיל" ranges: "days" = each day's regular offer (earliest time the rule allows);
    "requested_days" = the times for the school's "אפשרויות נוספות" hours, each marked near=True
    when it's only the closest allowed time to them. requested_days is null when no hours were
    sent (or the range doesn't allow them) — the client then shows only the regular offer.
    The rule always looks at the whole working day, never only at the requested hours."""
    work_start, work_end, duration, min_window, start_grid = _policy_args(token_row, range_row)
    requested = None
    # Never trust the client: the hours are honored only when the org allowed this range to use
    # them, and only inside the org's own working day.
    if range_row.get("allow_time_range_search"):
        requested_from, requested_to = _parse_hhmm_to_minutes(time_from), _parse_hhmm_to_minutes(time_to)
        if requested_from is not None and requested_to is not None:
            requested = (max(work_start, requested_from), min(work_end, requested_to))
            if requested[0] >= requested[1]:
                return {"days": [], "requested_days": [], "ok": True}

    days_of_week = token_row["scheduling_window"]["days_of_week"]
    dates = _upcoming_dates(sorted({d for seg in segments for d in _range_dates_in_window(seg["start_date"], seg["end_date"], days_of_week)}))
    dates = _filter_blocked_dates(db, token_row["org_id"], token_row["school_id"], dates)
    if not dates:
        return {"days": [], "requested_days": [] if requested else None, "ok": True}

    advisor_ids = range_row.get("advisor_ids") or token_row.get("advisor_ids") or [token_row["advisor_id"]]
    busy = _busy_by_advisor(db, token_row["org_id"], advisor_ids, f"{dates[0]}T00:00:00Z", f"{dates[-1]}T23:59:59Z")
    if busy is None:
        return {"days": [], "requested_days": [] if requested else None, "ok": False}

    days, requested_days = [], []
    for d in dates:
        busy_today = _with_elapsed_time(d, {aid: slot_policy.day_intervals(d, blocks) for aid, blocks in busy.items()}, start_grid)
        offer = slot_policy.offer_for_day(busy_today, work_start, work_end, duration, min_window, start_grid, requested)
        if offer["regular"]:
            days.append({"date": d, "slots": [
                {"start_time": slot_policy.hhmm(s), "end_time": slot_policy.hhmm(e)} for s, e in offer["regular"]
            ]})
        if offer["requested"]:
            requested_days.append({"date": d, "slots": [
                {"start_time": slot_policy.hhmm(o["slot"][0]), "end_time": slot_policy.hhmm(o["slot"][1]), "near": o["near"]}
                for o in offer["requested"]
            ]})
    return {"days": days, "requested_days": requested_days if requested else None, "ok": True}


@router.get("/public/meeting-booking/{token}/freebusy")
def get_booking_freebusy(token: str, month: str | None = None, range_key: str | None = None,
                          time_from: str | None = None, time_to: str | None = None):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)

    if range_key is not None:
        range_row = _range_by_key(token_row, range_key)
        if _range_is_booked(token_row, range_key):
            raise HTTPException(status_code=400, detail="הפגישה הזו כבר נקבעה")
        segments = _range_segments(range_row)
        if not range_row.get("require_additional_meeting") and _find_existing_meeting_any_segment(db, token_row["school_id"], range_row["service_type"], segments, range_row.get("stage_scope"), range_row.get("explicit_stage_scope_only")):
            raise HTTPException(status_code=400, detail="כבר קיימת פגישה מסוג זה בטווח התאריכים הזה")

        if _uses_slot_policy(range_row):
            return _policy_freebusy(db, token_row, range_row, segments, time_from, time_to)

        sched = token_row["scheduling_window"]
        start_minute, end_minute = sched["start_hour"] * 60, sched["end_hour"] * 60
        # "אפשרויות נוספות" — a school-side re-search with a narrower time window. Only ever
        # honored when the org explicitly opted this range into it (allow_time_range_search) —
        # never trust the client's own flag, since these params are on an unauthenticated public
        # endpoint and can be sent regardless of what the UI shows. The window can only be
        # narrowed (intersected), never widened past the org's own configured scheduling_window.
        if range_row.get("allow_time_range_search"):
            requested_from = _parse_hhmm_to_minutes(time_from)
            requested_to = _parse_hhmm_to_minutes(time_to)
            if requested_from is not None and requested_to is not None:
                start_minute = max(start_minute, requested_from)
                end_minute = min(end_minute, requested_to)
        if start_minute >= end_minute:
            return {"days": [], "ok": True}

        window = {"days_of_week": sched["days_of_week"], "start_minute": start_minute, "end_minute": end_minute, "duration_minutes": range_row["duration_minutes"]}
        # Union of dates across every OR'd segment (deduped + sorted) — a date is offerable if
        # it falls in ANY of the range's date segments.
        dates = _upcoming_dates(sorted({d for seg in segments for d in _range_dates_in_window(seg["start_date"], seg["end_date"], window["days_of_week"])}))
        dates = _filter_blocked_dates(db, token_row["org_id"], token_row["school_id"], dates)
        if not dates:
            return {"days": [], "ok": True}

        # Round-7: per-range advisor_ids (set at token-creation time for task-generated links)
        # takes priority over the token-level union — falls back to the union for older/
        # "תיאום ישיר" tokens that never had per-range advisor data.
        advisor_ids = range_row.get("advisor_ids") or token_row.get("advisor_ids") or [token_row["advisor_id"]]
        range_start = f"{dates[0]}T00:00:00Z"
        range_end = f"{dates[-1]}T23:59:59Z"
        busy: list[dict] = []
        for advisor_id in advisor_ids:
            advisor_busy = graph_client.get_freebusy(db, token_row["org_id"], advisor_id, range_start, range_end)
            if advisor_busy is None:
                return {"days": [], "ok": False}
            busy.extend(graph_client.reconcile_busy_blocks(db, advisor_busy))
        busy.extend(_local_meeting_busy_blocks(db, advisor_ids, range_start, range_end))

        days = []
        today = _now_il()
        for d in dates:
            day_window = window
            if d == today.date().isoformat():
                # Today: start from the next half hour, never offering a time already gone.
                next_half_hour = -(-(today.hour * 60 + today.minute + 1) // 30) * 30
                day_window = {**window, "start_minute": max(window["start_minute"], next_half_hour)}
            slots = _slots_for_day(d, day_window, busy)
            if slots:
                days.append({"date": d, "slots": slots})
        return {"days": days, "ok": True}

    if month not in _open_months(token_row):
        raise HTTPException(status_code=400, detail="חודש זה כבר אינו פתוח לשריון")

    sched = token_row["scheduling_window"]
    window = {**sched, "start_minute": sched["start_hour"] * 60, "end_minute": sched["end_hour"] * 60}
    dates = _upcoming_dates(_month_dates_in_window(month, window["days_of_week"]))
    dates = _filter_blocked_dates(db, token_row["org_id"], token_row["school_id"], dates)
    if not dates:
        return {"days": [], "ok": True}

    range_start = f"{dates[0]}T00:00:00Z"
    range_end = f"{dates[-1]}T23:59:59Z"
    busy = graph_client.get_freebusy(db, token_row["org_id"], token_row["advisor_id"], range_start, range_end)
    if busy is None:
        return {"days": [], "ok": False}
    busy = graph_client.reconcile_busy_blocks(db, list(busy)) + _local_meeting_busy_blocks(db, [token_row["advisor_id"]], range_start, range_end)

    days = []
    for d in dates:
        slots = _slots_for_day(d, window, busy)
        if slots:
            days.append({"date": d, "slots": slots})
    return {"days": days, "ok": True}


def _log_booking_activity(db, token_row: dict, meeting: dict) -> None:
    """Activity log entry for a meeting the school booked itself via a public link."""
    meeting_activity.log_meeting_activity(
        db, meeting_id=meeting["id"], school_id=token_row.get("school_id"), org_id=token_row.get("org_id"),
        actor_id=None, actor_type="school",
        source="task_booking_link" if token_row.get("task_id") else "booking_link",
        action="created", after=meeting,
        meta={"task_id": token_row.get("task_id"), "token_advisor_id": token_row.get("advisor_id")},
    )


@router.post("/public/meeting-booking/{token}/book")
def book_meeting_slot(token: str, body: dict):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)

    range_key = body.get("range_key")
    if range_key is not None:
        return _book_range_slot(db, token_row, range_key, body)

    month = body.get("month")
    meeting_date = body.get("meeting_date")
    start_time = body.get("start_time")
    end_time = body.get("end_time")
    if not all([month, meeting_date, start_time, end_time]):
        raise HTTPException(status_code=400, detail="נתונים חסרים")
    if not _not_started_yet(str(meeting_date), str(start_time)):
        raise HTTPException(status_code=409, detail="המועד הזה כבר עבר. נא לבחור מועד אחר.")
    if month not in _open_months(token_row):
        raise HTTPException(status_code=400, detail="חודש זה כבר אינו פתוח לשריון")

    # Re-check the slot is genuinely free server-side — never trust the client's earlier read.
    day_start = f"{meeting_date}T00:00:00Z"
    day_end = f"{meeting_date}T23:59:59Z"
    # Outlook is read here; our own meetings are re-read inside the booking lock below.
    outlook_busy = graph_client.get_freebusy(db, token_row["org_id"], token_row["advisor_id"], day_start, day_end)
    if outlook_busy is None:
        raise HTTPException(status_code=503, detail="לא ניתן לאמת זמינות כרגע, נסה שוב")
    outlook_busy = graph_client.reconcile_busy_blocks(db, list(outlook_busy))

    from routers.schools_router import BLOCKED_DATE_SCOPE_FIELDS, _find_blocking_rule
    school_res = db.table("schools").select(
        "id, name, secretary_name, secretary_email, finance_contact_name, finance_contact_email, "
        + ",".join(BLOCKED_DATE_SCOPE_FIELDS)
    ).eq("id", token_row["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]
    if _find_blocking_rule(db, token_row["org_id"], meeting_date, school):
        raise HTTPException(status_code=400, detail="תאריך זה חסום לקביעת פגישות")

    participants = []
    if school.get("secretary_email"):
        participants.append({"key": "secretary", "name": school.get("secretary_name") or "", "email": school["secretary_email"]})
    elif school.get("finance_contact_email"):
        participants.append({"key": "finance", "name": school.get("finance_contact_name") or "", "email": school["finance_contact_email"]})

    meeting_data = {
        "school_id": token_row["school_id"],
        "status": "scheduled",
        "meeting_date": meeting_date,
        "start_time": start_time,
        "end_time": end_time,
        "advisor_ids": [token_row["advisor_id"]],
        "participants": participants,
        "academic_year": DEFAULT_ACADEMIC_YEAR,
        "reminder_enabled": True,
        "notes": "נקבע ע\"י בית הספר דרך קישור שריון עצמאי",
        # Same default as every other meeting-creation path — editable afterward like any
        # other meeting_type value, but should never land unset.
        "meeting_type": "remote",
        "booking_token_id": token_row["id"],
    }
    # Same two layers as _book_range_slot — see booking_lock.py.
    advisor_ids = [token_row["advisor_id"]]
    lock_keys = [booking_lock.advisor_day_key(token_row["advisor_id"], meeting_date), booking_lock.range_key(token_row["id"], f"month:{month}")]
    with booking_lock.booking_locks(lock_keys):
        db = get_admin_client()
        fresh_token = db.table("meeting_booking_tokens").select("booked_months").eq("id", token_row["id"]).execute().data or [{}]
        booked_months = fresh_token[0].get("booked_months") or []
        if month in booked_months:
            raise HTTPException(status_code=400, detail="חודש זה כבר אינו פתוח לשריון")
        busy = outlook_busy + _local_meeting_busy_blocks(db, advisor_ids, day_start, day_end)
        if any(_time_overlaps(start_time, end_time, b["start"][11:16], b["end"][11:16]) for b in busy):
            raise HTTPException(status_code=409, detail=booking_lock.TAKEN_DETAIL)
        try:
            res = db.table("meetings").insert(meeting_data).execute()
            meeting = res.data[0]
        except Exception as exc:
            logger.error("book_meeting_slot insert failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=503, detail="שגיאה זמנית בשמירת הפגישה, נסה שוב")
        if not booking_lock.keep_or_discard_booking(db, meeting, advisor_ids):
            raise HTTPException(status_code=409, detail=booking_lock.TAKEN_DETAIL)

        # Same reasoning as _book_range_slot's booked_ranges update — written while still locked.
        booked_months = list(set(booked_months + [month]))
        for attempt in range(2):
            try:
                db2 = get_admin_client()
                db2.table("meeting_booking_tokens").update({"booked_months": booked_months}).eq("id", token_row["id"]).execute()
                break
            except Exception as exc:
                if attempt == 0:
                    logger.warning("failed to update booked_months for token %s (attempt 1, retrying): %s", token_row["id"], exc)
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.error("failed to update booked_months for token %s after 2 attempts: %s", token_row["id"], exc, exc_info=True)
    _log_booking_activity(db, token_row, meeting)

    calendar_synced = False
    try:
        from routers.schools_router import _build_meeting_subject
        with graph_client.calendar_sync_lock(db, meeting["id"]) as acquired:
            if acquired:
                subject = _build_meeting_subject(db, token_row["school_id"], meeting.get("participants"), meeting.get("primary_contact_key"), meeting.get("meeting_service_type"))
                sync_map = graph_client.sync_meeting_create(db, token_row["org_id"], meeting, subject=subject)
                if sync_map:
                    graph_client.persist_calendar_sync(db, meeting["id"], sync_map)
                    calendar_synced = any(v.get("status") == "synced" for v in sync_map.values())
    except Exception as exc:
        logger.warning("calendar sync failed for booked meeting %s (non-fatal): %s", meeting.get("id"), exc)

    return {"ok": True, "calendar_synced": calendar_synced, "open_months": [m for m in _open_months(token_row) if m != month]}


def _book_range_slot(db, token_row: dict, range_key: str, body: dict) -> dict:
    """The 'תיאום ישיר' counterpart of book_meeting_slot: books one date-range/meeting-request
    from a direct-coordination token. Participants and service type are NOT taken from the
    request body — they were fixed by the manager when the request was sent, so the school's
    coordinator can only pick a time, never change who attends or what the meeting is about."""
    range_row = _range_by_key(token_row, range_key)
    if _range_is_booked(token_row, range_key):
        raise HTTPException(status_code=400, detail="הפגישה הזו כבר נקבעה")
    # Never trust the client's earlier read — same principle as the time-slot conflict check
    # below. Also the actual safety net behind round-7's booked_ranges write becoming best-
    # effort (see the retry block at the end of this function): even if that write silently
    # failed for a prior booking, this live check against `meetings` itself still catches it.
    if not range_row.get("require_additional_meeting") and _find_existing_meeting_any_segment(db, token_row["school_id"], range_row["service_type"], _range_segments(range_row), range_row.get("stage_scope"), range_row.get("explicit_stage_scope_only")):
        raise HTTPException(status_code=400, detail="כבר קיימת פגישה מסוג זה בטווח התאריכים הזה")

    meeting_date = body.get("meeting_date")
    start_time = body.get("start_time")
    end_time = body.get("end_time")
    if not all([meeting_date, start_time, end_time]):
        raise HTTPException(status_code=400, detail="נתונים חסרים")
    if not _not_started_yet(str(meeting_date), str(start_time)):
        raise HTTPException(status_code=409, detail="המועד הזה כבר עבר. נא לבחור מועד אחר.")

    # Round-7: per-range advisor_ids takes priority over the token-level union — see
    # get_booking_freebusy's identical fallback comment.
    advisor_ids = range_row.get("advisor_ids") or token_row.get("advisor_ids") or [token_row["advisor_id"]]
    day_start = f"{meeting_date}T00:00:00Z"
    day_end = f"{meeting_date}T23:59:59Z"
    uses_policy = _uses_slot_policy(range_row)
    start_min, end_min = _parse_hhmm_to_minutes(start_time), _parse_hhmm_to_minutes(end_time)
    # Whatever kind of link: only a date of the request, the request's own length, inside the
    # org's working hours — the endpoint is public, so the page's own offer is never assumed.
    work_start, work_end = token_row["scheduling_window"]["start_hour"] * 60, token_row["scheduling_window"]["end_hour"] * 60
    if (
        start_min is None or end_min is None or meeting_date not in _policy_dates(token_row, range_row)
        or end_min - start_min != range_row["duration_minutes"] or start_min < work_start or end_min > work_end
    ):
        raise HTTPException(status_code=409, detail="המועד הזה כבר לא זמין. נא לבחור מועד אחר.")
    # Outlook is read before the lock (slow, and unaffected by concurrent bookings, whose rows
    # are re-read from `meetings` inside it).
    outlook_busy = _outlook_busy_by_advisor(db, token_row["org_id"], advisor_ids, day_start, day_end)
    if outlook_busy is None:
        raise HTTPException(status_code=503, detail="לא ניתן לאמת זמינות כרגע, נסה שוב")

    from routers.schools_router import BLOCKED_DATE_SCOPE_FIELDS, _find_blocking_rule
    school_res = db.table("schools").select("id, name, " + ",".join(BLOCKED_DATE_SCOPE_FIELDS)).eq("id", token_row["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]
    if _find_blocking_rule(db, token_row["org_id"], meeting_date, school):
        raise HTTPException(status_code=400, detail="תאריך זה חסום לקביעת פגישות")

    meeting_data = {
        "school_id": token_row["school_id"],
        "status": "scheduled",
        "meeting_date": meeting_date,
        "start_time": start_time,
        "end_time": end_time,
        "advisor_ids": advisor_ids,
        "meeting_service_type": range_row["service_type"],
        "participants": range_row.get("participants") or [],
        "academic_year": DEFAULT_ACADEMIC_YEAR,
        "reminder_enabled": True,
        "notes": "נקבע ע\"י בית הספר דרך קישור תיאום עצמי",
        # Round 17 — tags which principal slot (or "both"/None) this booking is for, so
        # _find_existing_meeting and task_logic.py's success-check can tell a "separate"
        # condition's two sibling ranges apart instead of treating either one as satisfying both.
        "stage_scope": range_row.get("stage_scope"),
        # Chosen by the manager when building the meeting request (defaults to "remote"
        # for older tokens minted before this field existed).
        "meeting_type": range_row.get("meeting_type") or "remote",
        # Chosen by the manager in DirectCoordinationModal (null for older tokens / a
        # "current" range) — left null otherwise, resolved lazily from the actual meeting
        # date by academic_years.resolve_requested_upload_years.
        "requested_upload_years": range_row.get("requested_upload_years"),
        "booking_token_id": token_row["id"],
    }

    # No two bookings of the same advisor+day (or of the same request) run this section at once,
    # on any worker — see booking_lock.py. Everything that another booking could have changed
    # since this request started is re-read inside it.
    lock_keys = [booking_lock.advisor_day_key(aid, meeting_date) for aid in advisor_ids]
    lock_keys.append(booking_lock.range_key(token_row["id"], range_key))
    with booking_lock.booking_locks(lock_keys):
        db = get_admin_client()
        fresh_token = db.table("meeting_booking_tokens").select("booked_ranges").eq("id", token_row["id"]).execute().data or [{}]
        booked_ranges = fresh_token[0].get("booked_ranges") or []
        if range_key in booked_ranges:
            raise HTTPException(status_code=400, detail="הפגישה הזו כבר נקבעה")
        if not range_row.get("require_additional_meeting") and _find_existing_meeting_any_segment(db, token_row["school_id"], range_row["service_type"], _range_segments(range_row), range_row.get("stage_scope"), range_row.get("explicit_stage_scope_only")):
            raise HTTPException(status_code=400, detail="כבר קיימת פגישה מסוג זה בטווח התאריכים הזה")

        local_busy = _local_meeting_busy_by_advisor(db, advisor_ids, day_start, day_end)
        busy_by_advisor = {aid: outlook_busy[aid] + local_busy[aid] for aid in advisor_ids}
        if uses_policy:
            # "יומן יעיל": the submitted time must be one the rule allows on the advisors'
            # calendars right now — never taken on trust from the public page.
            if not slot_policy.is_allowed(
                _with_elapsed_time(meeting_date, {aid: slot_policy.day_intervals(meeting_date, blocks) for aid, blocks in busy_by_advisor.items()},
                                   _policy_args(token_row, range_row)[4]),
                *_policy_args(token_row, range_row), start_min, end_min,
            ):
                raise HTTPException(status_code=409, detail="המועד הזה כבר לא זמין. נא לבחור מועד אחר.")
        elif any(_time_overlaps(start_time, end_time, b["start"][11:16], b["end"][11:16])
                 for blocks in busy_by_advisor.values() for b in blocks):
            raise HTTPException(status_code=409, detail=booking_lock.TAKEN_DETAIL)

        try:
            res = db.table("meetings").insert(meeting_data).execute()
            meeting = res.data[0]
        except Exception as exc:
            logger.error("_book_range_slot insert failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=503, detail="שגיאה זמנית בשמירת הפגישה, נסה שוב")
        if not booking_lock.keep_or_discard_booking(db, meeting, advisor_ids):
            raise HTTPException(status_code=409, detail=booking_lock.TAKEN_DETAIL)

        # Written while still locked, so the same request's next click sees it. The live checks
        # above remain the real safety net if this write fails.
        booked_ranges = list(set(booked_ranges + [range_key]))
        for attempt in range(2):
            try:
                db2 = get_admin_client()
                db2.table("meeting_booking_tokens").update({"booked_ranges": booked_ranges}).eq("id", token_row["id"]).execute()
                break
            except Exception as exc:
                if attempt == 0:
                    logger.warning("failed to update booked_ranges for token %s (attempt 1, retrying): %s", token_row["id"], exc)
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.error("failed to update booked_ranges for token %s after 2 attempts: %s", token_row["id"], exc, exc_info=True)

    _log_booking_activity(db, token_row, meeting)

    calendar_synced = False
    try:
        from routers.schools_router import _build_meeting_subject
        with graph_client.calendar_sync_lock(db, meeting["id"]) as acquired:
            if acquired:
                subject = _build_meeting_subject(db, token_row["school_id"], meeting.get("participants"), meeting.get("primary_contact_key"), meeting.get("meeting_service_type"))
                sync_map = graph_client.sync_meeting_create(db, token_row["org_id"], meeting, subject=subject)
                if sync_map:
                    graph_client.persist_calendar_sync(db, meeting["id"], sync_map)
                    calendar_synced = any(v.get("status") == "synced" for v in sync_map.values())
    except Exception as exc:
        logger.warning("calendar sync failed for range-booked meeting %s (non-fatal): %s", meeting.get("id"), exc)

    return {"ok": True, "calendar_synced": calendar_synced}
