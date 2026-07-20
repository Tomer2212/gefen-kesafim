import secrets
from datetime import datetime, timedelta, timezone

BOOKING_TOKEN_GRACE_DAYS = 60


def get_or_create_booking_token(db, org_id: str, school_id: str, advisor_id: str, draft_id: str,
                                 months: list[str], scheduling_window: dict,
                                 grace_days: int = BOOKING_TOKEN_GRACE_DAYS) -> dict:
    """Reuses an unexpired token for this (school, advisor, draft) if one exists — one link
    per school per batch, reusable (not single-use) until it expires. Mirrors
    meeting_upload_logic.get_or_create_upload_token exactly. Returns the full row (id + token)
    since callers need the row id to reference in meeting_booking_email_queue.token_id."""
    existing = (
        db.table("meeting_booking_tokens")
        .select("id, token, expires_at")
        .eq("school_id", school_id)
        .eq("advisor_id", advisor_id)
        .eq("draft_id", draft_id)
        .order("created_at", desc=True)
        .execute()
    )
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
