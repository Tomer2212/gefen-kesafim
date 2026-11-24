"""Two meetings of one school at the same time — asked about right after a save ("זו אותה
פגישה?"), so colleagues documenting one conversation don't each open a meeting for it.

Pure rules + one read. The answers: schools_router.merge_meeting_into (join the existing one) and
confirm_meeting_separate (meetings.separate_from_ids — that pair is never asked about again).
"""
import logging
import math

logger = logging.getLogger(__name__)

LIVE_STATUSES = ("scheduled", "completed")
SELECT = (
    "id, school_id, meeting_date, start_time, end_time, status, meeting_service_type, stage_scope, "
    "advisor_ids, advisor_id, participants, calls_start_time, calls_duration_seconds, separate_from_ids"
)


def _minutes(hm) -> int | None:
    try:
        h, m = str(hm).split(":")[:2]
        return int(h) * 60 + int(m)
    except ValueError:
        return None


def advisor_ids(meeting: dict) -> list[str]:
    return meeting.get("advisor_ids") or ([meeting["advisor_id"]] if meeting.get("advisor_id") else [])


def has_hours(meeting: dict) -> bool:
    s, e = _minutes(meeting.get("start_time")), _minutes(meeting.get("end_time"))
    return s is not None and e is not None and s < e


# graph_client gives a dated meeting saved without hours this event time, and the Outlook echo
# writes it back to the meeting — hours nobody entered.
_PLACEHOLDER_HOURS = ("09:00", "10:00")


def without_placeholder_hours(db, meetings: list[dict]) -> list[dict]:
    """The meetings with such echoed hours blanked (copies). Non-fatal: unchanged on failure."""
    suspects = [m["id"] for m in meetings if (str(m.get("start_time"))[:5], str(m.get("end_time"))[:5]) == _PLACEHOLDER_HOURS]
    if not suspects:
        return meetings
    try:
        events = db.table("meeting_activity").select("meeting_id, changes").eq("source", "outlook").in_("meeting_id", suspects).execute().data or []
    except Exception as exc:
        logger.warning("placeholder-hours lookup failed (non-fatal): %s", exc)
        return meetings
    echoed = set()
    for ev in events:
        start = (ev.get("changes") or {}).get("start_time") or {}
        if not start.get("from") and str(start.get("to"))[:5] == _PLACEHOLDER_HOURS[0]:
            echoed.add(ev["meeting_id"])
    return [{**m, "start_time": None, "end_time": None} if m["id"] in echoed else m for m in meetings]


def time_ranges(meeting: dict) -> list[tuple[int, int]]:
    """When the meeting takes place, in minutes of the day: its hours and the span of its actual
    calls (work often happens outside the planned hours). Empty = unknown."""
    out = []
    if has_hours(meeting):
        out.append((_minutes(meeting["start_time"]), _minutes(meeting["end_time"])))
    start, seconds = _minutes(meeting.get("calls_start_time")), meeting.get("calls_duration_seconds") or 0
    if start is not None and seconds:
        out.append((start, start + math.ceil(seconds / 60)))
    return out


def may_be_same(meeting: dict, other: dict) -> bool:
    """For two meetings of one school and day. Unknown hours on either side = can't tell them apart."""
    if other["id"] == meeting["id"] or other.get("status") not in LIVE_STATUSES:
        return False
    if other["id"] in (meeting.get("separate_from_ids") or []) or meeting["id"] in (other.get("separate_from_ids") or []):
        return False
    if {meeting.get("stage_scope"), other.get("stage_scope")} == {"tichon", "chativa"}:
        return False
    mine, theirs = time_ranges(meeting), time_ranges(other)
    if not mine or not theirs:
        return True
    return any(a[0] < b[1] and b[0] < a[1] for a in mine for b in theirs)


def should_check(before: dict | None, after: dict) -> bool:
    """Worth asking on this save: the meeting has hours and its date/hours are new, or it was just
    marked completed (someone documenting a call often enters no hours). Never on every same-day
    meeting or an unrelated autosave."""
    if after.get("status") not in LIVE_STATUSES or not after.get("meeting_date"):
        return False
    before = before or {}

    def changed(field):
        return str(before.get(field) or "")[:10] != str(after.get(field) or "")[:10]

    if after["status"] == "completed" and (changed("status") or changed("meeting_date")):
        return True
    return has_hours(after) and any(changed(f) for f in ("meeting_date", "start_time", "end_time"))


def overlapping_meetings(db, meeting: dict, before: dict | None) -> list[dict]:
    """The school's other meetings this one may duplicate, with advisor names. Never raises."""
    try:
        if not should_check(before, meeting):
            return []
        rows = (
            db.table("meetings").select(SELECT)
            .eq("school_id", meeting["school_id"]).eq("meeting_date", str(meeting["meeting_date"])[:10])
            .neq("id", meeting["id"]).execute()
        ).data or []
        if not rows:
            return []
        mine, *rows = without_placeholder_hours(db, [meeting, *rows])
        hits = [r for r in rows if may_be_same(mine, r)]
        if not hits:
            return []
        ids = {uid for r in hits for uid in advisor_ids(r)}
        names = {}
        if ids:
            names = {p["id"]: p["full_name"] for p in db.table("profiles").select("id, full_name").in_("id", list(ids)).execute().data or []}
        shown = ("id", "meeting_date", "start_time", "end_time", "status", "meeting_service_type", "stage_scope",
                 "calls_start_time", "calls_duration_seconds")
        return [{
            **{f: r.get(f) for f in shown},
            "advisors": [{"id": uid, "full_name": names.get(uid)} for uid in advisor_ids(r)],
            "participants": [{"name": p.get("name"), "label": p.get("label")} for p in r.get("participants") or [] if isinstance(p, dict)],
        } for r in hits]
    except Exception as exc:
        logger.warning("overlapping_meetings failed for %s (non-fatal): %s", meeting.get("id"), exc)
        return []
