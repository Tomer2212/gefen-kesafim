"""Infrastructure-only WhatsApp channel via Twilio. No real API call is made yet —
this module only reflects the per-org connection state stored in `twilio_connections`
so the rest of the Tasks feature (UI, queue) can treat WhatsApp as a real channel
option that happens to always be disabled until an org actually connects Twilio."""

import logging
import time

from supabase_client import get_admin_client, reset_admin_client

_log = logging.getLogger(__name__)


def get_org_twilio_connection(org_id: str) -> dict:
    """{"connected": bool}. Mirrors booking_logic.get_org_mailbox_capability's shape."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("twilio_connections")
                .select("org_id, status, from_number")
                .eq("org_id", org_id)
                .execute()
                .data or []
            )
            connected = bool(rows) and rows[0].get("status") == "connected"
            return {"connected": connected, "from_number": rows[0].get("from_number") if rows else None}
        except Exception as exc:
            if attempt == 0:
                _log.warning("get_org_twilio_connection attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("get_org_twilio_connection failed after 2 attempts: %s", exc, exc_info=True)
                return {"connected": False, "from_number": None}


def send_whatsapp_message(org_id: str, to_phone: str, body: str, attachment_keys: list[str] | None = None) -> None:
    """Always raises until a real Twilio connection exists — no outbound HTTP call is made.
    This is intentional scaffolding (per plan: infra only, no live Twilio integration yet)."""
    capability = get_org_twilio_connection(org_id)
    if not capability["connected"]:
        raise RuntimeError("Twilio not configured — התחבר לוואטסאפ (Twilio) באזור ניהול → אינטגרציות")
    raise RuntimeError("Twilio sending is not implemented yet")
