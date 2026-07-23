import os
import logging

import httpx

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "גפן AI <noreply@gefenai.co.il>")


def send_resend_email(to_email: str, subject: str, html: str, reply_to: str | None = None):
    if not RESEND_API_KEY:
        raise RuntimeError("Resend not configured")
    payload = {"from": RESEND_FROM, "to": [to_email], "subject": subject, "html": html}
    if reply_to:
        payload["reply_to"] = reply_to
    resp = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=15,
    )
    resp.raise_for_status()
