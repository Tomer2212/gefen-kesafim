"""Booking requests (one range of a booking link — a task's or a direct-coordination one) and the
meetings that fill them, whichever way those meetings were made.

- open_requests_for_meeting: the requests a staff-made meeting may be replacing — the
  "מחליפה או נוספת?" question in MeetingRow (asked on every surface, answer kept in
  meeting_request_resolutions and in the meeting's activity log).
- record_resolution: saves that answer. "replaces" closes the request (booked_ranges) right away.
- requests_already_filled: which requests a meeting already fills ("replaces", or the automatic
  rule of the booking page minus meetings marked "additional") — used for "יומן יעיל" auto demand.
- reconcile_booked_ranges: run by the 5-minute task cron. booked_ranges of every live link =
  exactly the requests with a live (scheduled/completed) meeting booked through it or marked as
  replacing it, so a cancelled/postponed/deleted meeting reopens its request whichever of the
  ~30 meeting-writing paths changed it — until the request's own dates are over.
"""
import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import booking_lock
import meeting_activity
from supabase_client import get_admin_client

logger = logging.getLogger(__name__)

LIVE_STATUSES = ("scheduled", "completed")
DECISIONS = ("replaces", "additional")
_IL_TZ = ZoneInfo("Asia/Jerusalem")


def _today_il() -> str:
    return datetime.now(_IL_TZ).date().isoformat()


def range_segments(range_row: dict) -> list[dict]:
    return range_row.get("segments") or [{"start_date": range_row["start_date"], "end_date": range_row["end_date"]}]


def range_contains(range_row: dict, day_iso: str) -> bool:
    return any(seg["start_date"] <= day_iso <= seg["end_date"] for seg in range_segments(range_row))


def requests_already_filled(db, rows: list[dict], exclude_meeting_id: str | None = None) -> set[tuple[str, str]]:
    """(token_id, range_key) of the request rows ({token_id, school_id, range_key, range_row})
    that a meeting already fills: one marked "replaces" for it, or — unless the request asks for
    an additional meeting — the booking page's automatic rule (same type, a date of the request,
    the right division), skipping meetings marked "additional" for it. Two queries in all."""
    if not rows:
        return set()
    token_ids = list({str(r["token_id"]) for r in rows})
    resolutions = (
        db.table("meeting_request_resolutions").select("meeting_id, token_id, range_key, decision")
        .in_("token_id", token_ids).execute().data or []
    )
    resolutions = [r for r in resolutions if r["meeting_id"] != exclude_meeting_id]
    filled = {(str(r["token_id"]), r["range_key"]) for r in resolutions if r["decision"] == "replaces"}
    additional: dict[tuple[str, str], set] = {}
    for r in resolutions:
        if r["decision"] == "additional":
            additional.setdefault((str(r["token_id"]), r["range_key"]), set()).add(r["meeting_id"])
    segments = [seg for r in rows for seg in range_segments(r["range_row"])]
    meetings = (
        db.table("meetings").select("id, school_id, meeting_service_type, meeting_date, stage_scope")
        .in_("school_id", list({r["school_id"] for r in rows})).in_("status", list(LIVE_STATUSES))
        .gte("meeting_date", min(s["start_date"] for s in segments)).lte("meeting_date", max(s["end_date"] for s in segments))
        .execute().data or []
    ) if segments else []
    for r in rows:
        key = (str(r["token_id"]), r["range_key"])
        rng = r["range_row"]
        if key in filled or rng.get("require_additional_meeting"):
            continue
        scope = rng.get("stage_scope")
        counted_scopes = (scope, "both") if rng.get("explicit_stage_scope_only") else (scope, "both", None)
        for m in meetings:
            if (
                m["id"] != exclude_meeting_id and m["school_id"] == r["school_id"]
                and m["meeting_service_type"] == rng.get("service_type")
                and m["id"] not in additional.get(key, set())
                and range_contains(rng, m["meeting_date"])
                and (scope not in ("tichon", "chativa") or m.get("stage_scope") in counted_scopes)
            ):
                filled.add(key)
                break
    return filled


def _live_tokens(db, org_id: str, school_id: str | None = None, token_ids: list[str] | None = None) -> list[dict]:
    query = (
        db.table("meeting_booking_tokens").select("id, task_id, school_id, date_ranges, booked_ranges")
        .eq("org_id", org_id).gt("expires_at", datetime.now(timezone.utc).isoformat())
    )
    if school_id:
        query = query.eq("school_id", school_id)
    if token_ids is not None:
        query = query.in_("id", list(token_ids))
    tokens = [t for t in (query.execute().data or []) if t.get("date_ranges")]
    task_ids = list({t["task_id"] for t in tokens if t.get("task_id")})
    tasks = {}
    if task_ids:
        tasks = {t["id"]: t for t in db.table("org_tasks").select("id, name, status").in_("id", task_ids).execute().data or []}
    for t in tokens:
        task = tasks.get(t.get("task_id"))
        t["_task_name"] = (task or {}).get("name")
        t["_active"] = not t.get("task_id") or (task or {}).get("status") == "active"
    return tokens


def open_requests_for_meeting(db, org_id: str, meeting: dict) -> list[dict]:
    """Open requests of the meeting's school whose dates include the meeting's date and that this
    meeting hasn't been asked about yet. Only for a staff-made, dated, live meeting (one booked
    through a link already belongs to its own request). Never raises."""
    try:
        if (
            not meeting.get("meeting_date") or meeting.get("status") not in LIVE_STATUSES
            or meeting.get("booking_token_id")
        ):
            return []
        day = str(meeting["meeting_date"])[:10]
        tokens = [t for t in _live_tokens(db, org_id, meeting["school_id"]) if t["_active"]]
        answered = {
            (str(r["token_id"]), r["range_key"])
            for r in db.table("meeting_request_resolutions").select("token_id, range_key")
            .eq("meeting_id", meeting["id"]).execute().data or []
        }
        rows = []
        for t in tokens:
            booked = set(t.get("booked_ranges") or [])
            for rng in t["date_ranges"]:
                key = (str(t["id"]), rng["key"])
                if rng["key"] in booked or key in answered or not range_contains(rng, day):
                    continue
                rows.append({"token_id": t["id"], "school_id": t["school_id"], "range_key": rng["key"],
                             "range_row": rng, "task_id": t.get("task_id"), "task_name": t["_task_name"]})
        filled = requests_already_filled(db, rows, exclude_meeting_id=meeting["id"])
        return [
            {
                "token_id": r["token_id"], "range_key": r["range_key"], "task_id": r["task_id"],
                "task_name": r["task_name"], "label": r["range_row"].get("label"),
                "service_type": r["range_row"].get("service_type"),
                "start_date": r["range_row"].get("start_date"), "end_date": r["range_row"].get("end_date"),
            }
            for r in rows if (str(r["token_id"]), r["range_key"]) not in filled
        ]
    except Exception as exc:
        logger.warning("open_requests_for_meeting failed for %s (non-fatal): %s", meeting.get("id"), exc)
        return []


def record_resolution(db, *, org_id: str, user_id: str, meeting: dict, token: dict, range_row: dict,
                      decision: str, source: str | None) -> None:
    """Saves the staff's answer for one (meeting, request). "replaces" closes the request at once
    (under the same lock as a link booking of it); either answer is logged on the meeting."""
    previous = db.table("meeting_request_resolutions").select("decision").eq("meeting_id", meeting["id"])         .eq("token_id", token["id"]).eq("range_key", range_row["key"]).execute().data or []
    db.table("meeting_request_resolutions").upsert({
        "org_id": org_id, "meeting_id": meeting["id"], "token_id": token["id"], "range_key": range_row["key"],
        "task_id": token.get("task_id"), "service_type": range_row.get("service_type"),
        "stage_scope": range_row.get("stage_scope"), "decision": decision, "decided_by": user_id,
    }, on_conflict="meeting_id,token_id,range_key").execute()
    if previous and previous[0]["decision"] == "replaces" and decision == "additional":
        # Changed its mind: this meeting no longer fills the request, so reopen it (closed again
        # right away if another live meeting still fills it).
        reopen_for_deleted_meeting(db, org_id, [(token["id"], range_row["key"])])
    else:
        with booking_lock.booking_locks([booking_lock.range_key(token["id"], range_row["key"])]):
            reconcile_booked_ranges(get_admin_client(), org_id, token_ids=[token["id"]])
    task_name = None
    if token.get("task_id"):
        rows = db.table("org_tasks").select("name").eq("id", token["task_id"]).execute().data or []
        task_name = rows[0]["name"] if rows else None
    meeting_activity.log_meeting_activity(
        db, meeting_id=meeting["id"], school_id=meeting["school_id"], org_id=org_id,
        actor_id=user_id, actor_type="user", source=source, action="request_resolved",
        meta={"decision": decision, "task_id": token.get("task_id"), "task_name": task_name,
              "request_label": range_row.get("label"), "start_date": range_row.get("start_date"),
              "end_date": range_row.get("end_date")},
    )


def reconcile_booked_ranges(db, org_id: str, token_ids: list[str] | None = None) -> int:
    """booked_ranges of every live link of the org (or of token_ids) = the requests that have a
    live meeting booked through them or marked as replacing them. A request whose meeting is no
    longer live reopens — only while its own dates aren't over, and logged on that meeting.
    Returns how many links changed."""
    tokens = _live_tokens(db, org_id, token_ids=token_ids)
    if not tokens:
        return 0
    ids = [t["id"] for t in tokens]
    link_meetings = (
        db.table("meetings").select("id, school_id, booking_token_id, booking_range_key, status, meeting_service_type, meeting_date")
        .in_("booking_token_id", ids).execute().data or []
    )
    replaces = (
        db.table("meeting_request_resolutions").select("meeting_id, token_id, range_key")
        .in_("token_id", ids).eq("decision", "replaces").execute().data or []
    )
    replacing_meetings = {}
    if replaces:
        replacing_meetings = {
            m["id"]: m for m in db.table("meetings").select("id, school_id, status")
            .in_("id", list({r["meeting_id"] for r in replaces})).execute().data or []
        }
    today = _today_il()
    changed = 0
    for t in tokens:
        ranges = {r["key"]: r for r in t["date_ranges"]}
        fillers: dict[str, list[dict]] = {}
        for m in link_meetings:
            if m["booking_token_id"] != t["id"]:
                continue
            key = m.get("booking_range_key")
            if key is None:  # booked before booking_range_key existed: same type, a date of the request
                key = next((k for k, r in ranges.items() if r.get("service_type") == m.get("meeting_service_type")
                            and m.get("meeting_date") and range_contains(r, str(m["meeting_date"])[:10])), None)
            if key in ranges:
                fillers.setdefault(key, []).append(m)
        for r in replaces:
            if str(r["token_id"]) == str(t["id"]) and r["range_key"] in ranges and r["meeting_id"] in replacing_meetings:
                fillers.setdefault(r["range_key"], []).append(replacing_meetings[r["meeting_id"]])
        live = {k for k, ms in fillers.items() if any(m["status"] in LIVE_STATUSES for m in ms)}
        current = set(t.get("booked_ranges") or [])
        # Reopen only what is KNOWN to have lost its meeting: a request with a known filler
        # (booked through the link / marked "replaces") none of which is live any more. A booked
        # request with no known filler (links from before bookings recorded their link) is left
        # alone; a deleted meeting reopens its request in the delete endpoint (reopen_for_deleted_meeting).
        reopen = {k for k in current - live if k in fillers and k in ranges
                  and max(s["end_date"] for s in range_segments(ranges[k])) >= today}
        close = live - current
        if not reopen and not close:
            continue
        new_booked = sorted((current - reopen) | close)
        db.table("meeting_booking_tokens").update({"booked_ranges": new_booked}).eq("id", t["id"]).execute()
        changed += 1
        for k in reopen:
            for m in fillers.get(k, []):
                meeting_activity.log_meeting_activity(
                    db, meeting_id=m["id"], school_id=m.get("school_id"), org_id=org_id, actor_id=None,
                    actor_type="system", source=None, action="request_reopened",
                    meta={"task_id": t.get("task_id"), "task_name": t["_task_name"],
                          "request_label": ranges[k].get("label"), "status": m["status"]},
                )
    return changed


def requests_filled_by_meeting(db, meeting_id: str) -> list[tuple[str, str]]:
    """(token_id, range_key) this meeting fills — read BEFORE deleting it (afterwards neither the
    row nor its cascaded resolutions exist)."""
    rows = db.table("meetings").select("booking_token_id, booking_range_key").eq("id", meeting_id).execute().data or []
    out = [(rows[0]["booking_token_id"], rows[0]["booking_range_key"])] if rows and rows[0].get("booking_token_id") and rows[0].get("booking_range_key") else []
    out += [
        (r["token_id"], r["range_key"]) for r in db.table("meeting_request_resolutions").select("token_id, range_key")
        .eq("meeting_id", meeting_id).eq("decision", "replaces").execute().data or []
    ]
    return out


def reopen_for_deleted_meeting(db, org_id: str, filled: list[tuple[str, str]]) -> None:
    """After a meeting is deleted (or stops replacing a request): its requests reopen unless another live meeting still fills
    them (reconcile decides) or their dates are over. Never raises."""
    try:
        today = _today_il()
        for token_id, key in filled:
            with booking_lock.booking_locks([booking_lock.range_key(token_id, key)]):
                db = get_admin_client()
                tokens = db.table("meeting_booking_tokens").select("booked_ranges, date_ranges").eq("id", token_id).eq("org_id", org_id).execute().data or []
                if not tokens:
                    continue
                rng = next((r for r in tokens[0].get("date_ranges") or [] if r.get("key") == key), None)
                booked = list(tokens[0].get("booked_ranges") or [])
                if rng and key in booked and max(seg["end_date"] for seg in range_segments(rng)) >= today:
                    db.table("meeting_booking_tokens").update({"booked_ranges": [k for k in booked if k != key]}).eq("id", token_id).execute()
                reconcile_booked_ranges(db, org_id, token_ids=[token_id])  # still filled by another meeting → closed again
    except Exception as exc:
        logger.warning("reopen_for_deleted_meeting failed (non-fatal): %s", exc)
