import secrets
from datetime import date, datetime, timedelta, timezone

BOOKING_TOKEN_GRACE_DAYS = 60
DIRECT_BOOKING_DAYS_OF_WEEK = [0, 1, 2, 3, 4]  # Sunday..Thursday
DIRECT_BOOKING_START_HOUR = 8
DIRECT_BOOKING_END_HOUR = 16


def get_or_create_booking_token(db, org_id: str, school_id: str, advisor_id: str, draft_id: str,
                                 months: list[str], scheduling_window: dict,
                                 grace_days: int = BOOKING_TOKEN_GRACE_DAYS) -> dict:
    """Reuses an unexpired token for this (school, advisor, draft) if one exists — one link
    per school per batch, reusable (not single-use) until it expires. Mirrors
    meeting_upload_logic.get_or_create_upload_token exactly. Returns the full row (id + token)
    since callers need the row id to reference in meeting_booking_email_queue.token_id."""
    query = (
        db.table("meeting_booking_tokens")
        .select("id, token, expires_at")
        .eq("school_id", school_id)
        .eq("advisor_id", advisor_id)
    )
    # draft_id is nullable (callers outside the AI-agent booking flow — e.g. the generalized
    # Tasks feature — pass None since they have no meeting_booking_drafts row of their own).
    # .eq() would not match NULL rows, so it needs the explicit IS NULL form here.
    query = query.is_("draft_id", "null") if draft_id is None else query.eq("draft_id", draft_id)
    existing = query.order("created_at", desc=True).execute()
    now = datetime.now(timezone.utc)
    if existing.data:
        row = existing.data[0]
        expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
        if expires_at > now:
            return row

    token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(days=grace_days)
    res = db.table("meeting_booking_tokens").insert({
        "org_id": org_id,
        "school_id": school_id,
        "advisor_id": advisor_id,
        "draft_id": draft_id,
        "months": months,
        "scheduling_window": scheduling_window,
        "token": token,
        "expires_at": expires_at.isoformat(),
    }).execute()
    return res.data[0]


def create_direct_booking_token(db, org_id: str, school_id: str, advisor_ids: list[str],
                                 ranges: list[dict]) -> dict:
    """Always mints a brand-new token — unlike get_or_create_booking_token, a 'תיאום ישיר'
    request is a one-off admin action with its own content (advisors/ranges/participants),
    not an idempotent recurring reminder, so there is no reuse-by-(school,advisor) semantics
    here. `ranges` is the list of {key, start_date, end_date, service_type, duration_minutes,
    label, participants} dicts built by the caller (schools_router.py)."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    last_end = max(date.fromisoformat(r["end_date"]) for r in ranges)
    expires_at = max(
        datetime.combine(last_end, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=3),
        now + timedelta(days=7),
    )
    res = db.table("meeting_booking_tokens").insert({
        "org_id": org_id,
        "school_id": school_id,
        "advisor_id": advisor_ids[0],
        "advisor_ids": advisor_ids,
        "draft_id": None,
        "months": [],
        "scheduling_window": {
            "days_of_week": DIRECT_BOOKING_DAYS_OF_WEEK,
            "start_hour": DIRECT_BOOKING_START_HOUR,
            "end_hour": DIRECT_BOOKING_END_HOUR,
        },
        "date_ranges": ranges,
        "token": token,
        "expires_at": expires_at.isoformat(),
    }).execute()
    return res.data[0]
