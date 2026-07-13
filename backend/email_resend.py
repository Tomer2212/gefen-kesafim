import os
import logging

import httpx

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "גפן AI <noreply@gefenai.co.il>")


def send_resend_email(to_email: str, subject: str, html: str):
    if not RESEND_API_KEY:
        raise RuntimeError("Resend not configured")
    resp = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json={"from": RESEND_FROM, "to": [to_email], "subject": subject, "html": html},
        timeout=15,
    )
    resp.raise_for_status()
