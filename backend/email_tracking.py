"""Per-recipient open tracking for meeting emails, via a 1x1 image served by this backend.

Open data is inherently approximate: a recipient who blocks images looks "unopened", and some
clients (e.g. Apple Mail Privacy Protection) load images without the recipient reading anything."""
import logging
import os
import secrets
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Corporate mail scanners fetch images right after delivery — not a real open.
MIN_SECONDS_BEFORE_OPEN_COUNTS = 15
OPEN_TRACKED_TABLES = ("meeting_reminders", "meeting_upload_followups")


def add_open_pixel(html: str) -> tuple[str, str | None]:
    """Returns (html to send, open_token). open_token is None when BACKEND_PUBLIC_URL isn't
    set — no pixel went out. Store the ORIGINAL html for display, not the returned one: previewing the stored copy
    must never register as an open."""
    base_url = (os.getenv("BACKEND_PUBLIC_URL") or "").strip().rstrip("/")
    if not base_url:
        return html, None
    token = secrets.token_urlsafe(24)
    pixel = (
        f'<img src="{base_url}/public/email-open/{token}.gif" width="1" height="1" alt="" '
        'style="width:1px;height:1px;border:0;" />'
    )
    if "</body>" in html:
        return html.replace("</body>", f"{pixel}</body>", 1), token
    return html + pixel, token


def record_email_open(db, token: str) -> None:
    """Records the FIRST counted open for this token. Unknown tokens, failed sends, and hits
    too soon after sending are silently ignored."""
    for table in OPEN_TRACKED_TABLES:
        rows = db.table(table).select("id, status, sent_at, opened_at").eq("open_token", token).execute().data or []
        if not rows:
            continue
        row = rows[0]
        if row.get("opened_at") or row.get("status") != "sent":
            return
        now = datetime.now(timezone.utc)
        sent_at = datetime.fromisoformat(row["sent_at"].replace("Z", "+00:00"))
        if (now - sent_at).total_seconds() < MIN_SECONDS_BEFORE_OPEN_COUNTS:
            return
        db.table(table).update({"opened_at": now.isoformat()}).eq("id", row["id"]).is_("opened_at", "null").execute()
        return
