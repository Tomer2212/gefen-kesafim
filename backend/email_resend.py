import os
import logging
import time

import httpx

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "גפן AI <noreply@gefenai.co.il>")
RATE_LIMIT_RETRIES = 2


class ResendQuotaExceeded(RuntimeError):
    """Resend refused the send because the account's daily/monthly quota is used up (a 429 whose
    error name ends in "_quota_exceeded"). Unlike a per-second rate limit, retrying won't help
    until the quota renews — queue callers keep the message pending instead of marking it failed."""


def send_resend_email(to_email: str, subject: str, html: str, reply_to: str | None = None,
                       attachments: list[dict] | None = None):
    """attachments: [{"filename": str, "content_b64": str}] — Resend expects base64 content
    under the "content" key; see https://resend.com/docs/api-reference/emails/send-email."""
    if not RESEND_API_KEY:
        raise RuntimeError("Resend not configured")
    payload = {"from": RESEND_FROM, "to": [to_email], "subject": subject, "html": html}
    if reply_to:
        payload["reply_to"] = reply_to
    if attachments:
        payload["attachments"] = [
            {"filename": a["filename"], "content": a["content_b64"]} for a in attachments
        ]
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=15,
        )
        if resp.status_code != 429:
            break
        try:
            error_name = str((resp.json() or {}).get("name") or "")
        except ValueError:
            error_name = ""
        if error_name.endswith("_quota_exceeded"):
            raise ResendQuotaExceeded(f"Resend {error_name}")
        if attempt < RATE_LIMIT_RETRIES:
            time.sleep(1 + attempt)  # per-second rate limit — the next second is free again
    resp.raise_for_status()
