import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

import graph_client
from academic_years import DEFAULT_ACADEMIC_YEAR
from supabase_client import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()


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


def _time_overlaps(s1: str, e1: str, s2: str, e2: str) -> bool:
    return s1 < e2 and s2 < e1


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
    start_hour, end_hour, duration = window["start_hour"], window["end_hour"], window["duration_minutes"]
    day_busy = [b for b in busy_blocks if b.get("start", "").startswith(day_iso)]
    slots = []
    cur_minutes = start_hour * 60
    end_minutes = end_hour * 60
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
        cur_minutes += 30  # offer slots on a 30-min grid regardless of meeting duration
    return slots


# ---------------------------------------------------------------------------
# Public (unauthenticated, token-gated) endpoints
# ---------------------------------------------------------------------------

@router.get("/public/meeting-booking/{token}")
def get_booking_info(token: str):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)

    school_res = db.table("schools").select("id, name").eq("id", token_row["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]

    if _is_range_mode(token_row):
        advisor_ids = token_row.get("advisor_ids") or [token_row["advisor_id"]]
        advisor_res = db.table("profiles").select("id, full_name").in_("id", advisor_ids).execute()
        advisor_names = [a["full_name"] for a in (advisor_res.data or [])]
        booked = set(token_row.get("booked_ranges") or [])
        ranges = [{**r, "booked": r["key"] in booked} for r in (token_row.get("date_ranges") or [])]
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


@router.get("/public/meeting-booking/{token}/freebusy")
def get_booking_freebusy(token: str, month: str | None = None, range_key: str | None = None):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)

    if range_key is not None:
        range_row = _range_by_key(token_row, range_key)
        if _range_is_booked(token_row, range_key):
            raise HTTPException(status_code=400, detail="הפגישה הזו כבר נקבעה")

        window = {**token_row["scheduling_window"], "duration_minutes": range_row["duration_minutes"]}
        dates = _range_dates_in_window(range_row["start_date"], range_row["end_date"], window["days_of_week"])
        if not dates:
            return {"days": [], "ok": True}

        advisor_ids = token_row.get("advisor_ids") or [token_row["advisor_id"]]
        range_start = f"{dates[0]}T00:00:00Z"
        range_end = f"{dates[-1]}T23:59:59Z"
        busy: list[dict] = []
        for advisor_id in advisor_ids:
            advisor_busy = graph_client.get_freebusy(db, token_row["org_id"], advisor_id, range_start, range_end)
            if advisor_busy is None:
                return {"days": [], "ok": False}
            busy.extend(advisor_busy)

        days = []
        for d in dates:
            slots = _slots_for_day(d, window, busy)
            if slots:
                days.append({"date": d, "slots": slots})
        return {"days": days, "ok": True}

    if month not in _open_months(token_row):
        raise HTTPException(status_code=400, detail="חודש זה כבר אינו פתוח לשריון")

    window = token_row["scheduling_window"]
    dates = _month_dates_in_window(month, window["days_of_week"])
    if not dates:
        return {"days": [], "ok": True}

    range_start = f"{dates[0]}T00:00:00Z"
    range_end = f"{dates[-1]}T23:59:59Z"
    busy = graph_client.get_freebusy(db, token_row["org_id"], token_row["advisor_id"], range_start, range_end)
    if busy is None:
        return {"days": [], "ok": False}

    days = []
    for d in dates:
        slots = _slots_for_day(d, window, busy)
        if slots:
            days.append({"date": d, "slots": slots})
    return {"days": days, "ok": True}


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
    if month not in _open_months(token_row):
        raise HTTPException(status_code=400, detail="חודש זה כבר אינו פתוח לשריון")

    # Re-check the slot is genuinely free server-side — never trust the client's earlier read.
    day_start = f"{meeting_date}T00:00:00Z"
    day_end = f"{meeting_date}T23:59:59Z"
    busy = graph_client.get_freebusy(db, token_row["org_id"], token_row["advisor_id"], day_start, day_end)
    if busy is None:
        raise HTTPException(status_code=503, detail="לא ניתן לאמת זמינות כרגע, נסה שוב")
    if any(_time_overlaps(start_time, end_time, b["start"][11:16], b["end"][11:16]) for b in busy):
        raise HTTPException(status_code=409, detail="המשבצת הזו כבר אינה פנויה, בחר מועד אחר")

    school_res = db.table("schools").select(
        "id, name, secretary_name, secretary_email, finance_contact_name, finance_contact_email"
    ).eq("id", token_row["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]

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
    }
    try:
        res = db.table("meetings").insert(meeting_data).execute()
        meeting = res.data[0]
    except Exception as exc:
        logger.error("book_meeting_slot insert failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="שגיאה זמנית בשמירת הפגישה, נסה שוב")

    calendar_synced = False
    try:
        with graph_client.calendar_sync_lock(db, meeting["id"]) as acquired:
            if acquired:
                sync_map = graph_client.sync_meeting_create(db, token_row["org_id"], meeting, subject=f"פגישת ליווי כלכלי - {school['name']}")
                if sync_map:
                    graph_client.persist_calendar_sync(db, meeting["id"], sync_map)
                    calendar_synced = any(v.get("status") == "synced" for v in sync_map.values())
    except Exception as exc:
        logger.warning("calendar sync failed for booked meeting %s (non-fatal): %s", meeting.get("id"), exc)

    try:
        booked_months = list(set((token_row.get("booked_months") or []) + [month]))
        db.table("meeting_booking_tokens").update({"booked_months": booked_months}).eq("id", token_row["id"]).execute()
    except Exception as exc:
        logger.warning("failed to update booked_months for token %s (non-fatal): %s", token_row["id"], exc)

    return {"ok": True, "calendar_synced": calendar_synced, "open_months": [m for m in _open_months(token_row) if m != month]}


def _book_range_slot(db, token_row: dict, range_key: str, body: dict) -> dict:
    """The 'תיאום ישיר' counterpart of book_meeting_slot: books one date-range/meeting-request
    from a direct-coordination token. Participants and service type are NOT taken from the
    request body — they were fixed by the manager when the request was sent, so the school's
    coordinator can only pick a time, never change who attends or what the meeting is about."""
    range_row = _range_by_key(token_row, range_key)
    if _range_is_booked(token_row, range_key):
        raise HTTPException(status_code=400, detail="הפגישה הזו כבר נקבעה")

    meeting_date = body.get("meeting_date")
    start_time = body.get("start_time")
    end_time = body.get("end_time")
    if not all([meeting_date, start_time, end_time]):
        raise HTTPException(status_code=400, detail="נתונים חסרים")

    advisor_ids = token_row.get("advisor_ids") or [token_row["advisor_id"]]
    day_start = f"{meeting_date}T00:00:00Z"
    day_end = f"{meeting_date}T23:59:59Z"
    busy: list[dict] = []
    for advisor_id in advisor_ids:
        advisor_busy = graph_client.get_freebusy(db, token_row["org_id"], advisor_id, day_start, day_end)
        if advisor_busy is None:
            raise HTTPException(status_code=503, detail="לא ניתן לאמת זמינות כרגע, נסה שוב")
        busy.extend(advisor_busy)
    if any(_time_overlaps(start_time, end_time, b["start"][11:16], b["end"][11:16]) for b in busy):
        raise HTTPException(status_code=409, detail="המשבצת הזו כבר אינה פנויה, בחר מועד אחר")

    school_res = db.table("schools").select("id, name").eq("id", token_row["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]

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
        "notes": "נקבע ע\"י בית הספר דרך קישור תיאום ישיר",
    }
    try:
        res = db.table("meetings").insert(meeting_data).execute()
        meeting = res.data[0]
    except Exception as exc:
        logger.error("_book_range_slot insert failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="שגיאה זמנית בשמירת הפגישה, נסה שוב")

    calendar_synced = False
    try:
        with graph_client.calendar_sync_lock(db, meeting["id"]) as acquired:
            if acquired:
                subject = f"{range_row.get('label') or 'פגישה'} - {school['name']}"
                sync_map = graph_client.sync_meeting_create(db, token_row["org_id"], meeting, subject=subject)
                if sync_map:
                    graph_client.persist_calendar_sync(db, meeting["id"], sync_map)
                    calendar_synced = any(v.get("status") == "synced" for v in sync_map.values())
    except Exception as exc:
        logger.warning("calendar sync failed for range-booked meeting %s (non-fatal): %s", meeting.get("id"), exc)

    try:
        booked_ranges = list(set((token_row.get("booked_ranges") or []) + [range_key]))
        db.table("meeting_booking_tokens").update({"booked_ranges": booked_ranges}).eq("id", token_row["id"]).execute()
    except Exception as exc:
        logger.warning("failed to update booked_ranges for token %s (non-fatal): %s", token_row["id"], exc)

    return {"ok": True, "calendar_synced": calendar_synced}
