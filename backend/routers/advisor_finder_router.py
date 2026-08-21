import logging
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import booking_logic
import graph_client
from auth import get_current_user
from booking_token_logic import DIRECT_BOOKING_DAYS_OF_WEEK, DIRECT_BOOKING_START_HOUR, DIRECT_BOOKING_END_HOUR
from routers.meeting_booking_router import _local_meeting_busy_blocks, _range_dates_in_window
from supabase_client import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/advisor-finder")


def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


def _all_slots_for_day(day_iso: str, window: dict, busy_blocks: list[dict]) -> list[dict]:
    """Returns EVERY contiguous duration-sized slot in the day's work window, not just the
    first (unlike meeting_booking_router._slots_for_day). Free stretches are tiled back-to-back
    from their start with no gaps, so a 2-hour free block with a 1-hour duration yields two
    adjacent options (e.g. 9-10, 10-11) instead of one — Find Advisor shows every usable option
    so the secretary can pick whichever fits the school's callback best."""
    start_hour, end_hour, duration = window["start_hour"], window["end_hour"], window["duration_minutes"]
    day_busy = sorted(
        (b for b in busy_blocks if b.get("start", "").startswith(day_iso)),
        key=lambda b: b["start"],
    )
    # Merge overlapping/adjacent busy blocks (clipped to minutes-of-day) so free stretches
    # between them are computed correctly even if two sources (Graph + local) overlap.
    merged: list[list[int]] = []
    for b in day_busy:
        s = max(int(b["start"][11:13]) * 60 + int(b["start"][14:16]), start_hour * 60)
        e = min(int(b["end"][11:13]) * 60 + int(b["end"][14:16]), end_hour * 60)
        if e <= s:
            continue
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])

    slots = []
    cursor = start_hour * 60
    day_end = end_hour * 60
    for busy_start, busy_end in merged + [[day_end, day_end]]:
        free_end = min(busy_start, day_end)
        while cursor + duration <= free_end:
            slot_start = f"{cursor // 60:02d}:{cursor % 60:02d}"
            slot_end_min = cursor + duration
            slot_end = f"{slot_end_min // 60:02d}:{slot_end_min % 60:02d}"
            slots.append({"start_time": slot_start, "end_time": slot_end})
            cursor += duration
        cursor = max(cursor, busy_end)
    return slots


class AdvisorFinderSearchIn(BaseModel):
    control_domains: list[str]
    duration_minutes: int
    date_from: str
    date_to: str


@router.post("/search")
def search_advisors(body: AdvisorFinderSearchIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    if not body.control_domains or body.duration_minutes <= 0 or not body.date_from or not body.date_to:
        raise HTTPException(status_code=400, detail="נתונים חסרים")

    db = get_admin_client()
    org = db.table("organizations").select("advisor_finder_excluded_ids, advisor_finder_excluded_roles").eq("id", user["org_id"]).single().execute().data or {}
    excluded_ids = set(org.get("advisor_finder_excluded_ids") or [])
    excluded_roles = set(org.get("advisor_finder_excluded_roles") or [])
    domains = set(body.control_domains)

    profiles = db.table("profiles").select("id, full_name, role, control_domains").eq("org_id", user["org_id"]).execute().data or []
    candidates = [
        p for p in profiles
        if p["id"] not in excluded_ids and p.get("role") not in excluded_roles and domains.intersection(p.get("control_domains") or [])
    ]
    if not candidates:
        return {"advisors": []}

    dates = _range_dates_in_window(body.date_from, body.date_to, DIRECT_BOOKING_DAYS_OF_WEEK)
    if not dates:
        return {"advisors": []}

    window = {"start_hour": DIRECT_BOOKING_START_HOUR, "end_hour": DIRECT_BOOKING_END_HOUR, "duration_minutes": body.duration_minutes}
    range_start = f"{dates[0]}T00:00:00Z"
    range_end = f"{dates[-1]}T23:59:59Z"
    mailbox = booking_logic.get_org_mailbox_capability(user["org_id"])

    # A search whose range includes today shouldn't offer slots earlier than right now — those
    # hours are already gone. Modeled as one synthetic "busy" block from midnight to the current
    # moment, added only for today's date; _all_slots_for_day's own merge/clip step (which
    # already clamps every block to [start_hour, end_hour]) does the rest, so a search run before
    # start_hour leaves the day untouched and one run after end_hour empties it out entirely.
    now_il = datetime.now(ZoneInfo("Asia/Jerusalem"))
    today_str = now_il.date().isoformat()
    today_cutoff_block = {"start": f"{today_str}T00:00:00", "end": f"{today_str}T{now_il.strftime('%H:%M')}:00"} if today_str in dates else None

    results = []
    for candidate in candidates:
        advisor_id = candidate["id"]
        busy: list[dict] = list(_local_meeting_busy_blocks(db, [advisor_id], range_start, range_end))
        if mailbox["connected"]:
            graph_busy = graph_client.get_freebusy(db, user["org_id"], advisor_id, range_start, range_end)
            if graph_busy is not None:
                busy.extend(graph_client.reconcile_busy_blocks(db, graph_busy))
            else:
                logger.warning("advisor-finder: freebusy lookup failed for advisor %s (non-fatal, using local data only)", advisor_id)
        if today_cutoff_block:
            busy.append(today_cutoff_block)

        days = []
        for d in dates:
            slots = _all_slots_for_day(d, window, busy)
            if slots:
                days.append({"date": d, "slots": slots})
        if days:
            results.append({"advisor_id": advisor_id, "full_name": candidate.get("full_name") or "", "days": days})

    return {"advisors": results}


class AdvisorFinderSettingsIn(BaseModel):
    advisor_finder_excluded_ids: list[str]
    advisor_finder_excluded_roles: list[str]


@router.get("/settings")
def get_advisor_finder_settings(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    org = db.table("organizations").select("advisor_finder_excluded_ids, advisor_finder_excluded_roles").eq("id", user["org_id"]).single().execute().data or {}
    return {
        "advisor_finder_excluded_ids": org.get("advisor_finder_excluded_ids") or [],
        "advisor_finder_excluded_roles": org.get("advisor_finder_excluded_roles") or [],
    }


@router.put("/settings")
def set_advisor_finder_settings(body: AdvisorFinderSettingsIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    db.table("organizations").update({
        "advisor_finder_excluded_ids": body.advisor_finder_excluded_ids,
        "advisor_finder_excluded_roles": body.advisor_finder_excluded_roles,
    }).eq("id", user["org_id"]).execute()
    return {"ok": True}
