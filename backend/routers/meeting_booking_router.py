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

    advisor_res = db.table("profiles").select("id, full_name").eq("id", token_row["advisor_id"]).execute()
    advisor_name = advisor_res.data[0]["full_name"] if advisor_res.data else ""

    return {
        "school_name": school["name"],
        "advisor_name": advisor_name,
        "open_months": _open_months(token_row),
        "scheduling_window": token_row["scheduling_window"],
    }


@router.get("/public/meeting-booking/{token}/freebusy")
def get_booking_freebusy(token: str, month: str):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)
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
