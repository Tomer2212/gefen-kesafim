import logging
import time

from supabase_client import get_admin_client, reset_admin_client

_log = logging.getLogger(__name__)

_TABLE = "org_task_drafts"


def _create_draft(org_id: str, created_by: str, request_text: str, schools: list[dict],
                   criteria: dict | None = None, needs_booking_link: bool = False) -> dict:
    for attempt in range(2):
        try:
            db = get_admin_client()
            row = (
                db.table(_TABLE)
                .insert({
                    "org_id": org_id,
                    "created_by": created_by,
                    "request_text": request_text,
                    "criteria": criteria,
                    "schools": schools,
                    "needs_booking_link": needs_booking_link,
                    "status": "collecting",
                })
                .execute()
            )
            return row.data[0]
        except Exception as exc:
            if attempt == 0:
                _log.warning("_create_draft attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("_create_draft failed after 2 attempts: %s", exc, exc_info=True)
                raise


def _get_draft(draft_id: str, org_id: str) -> dict | None:
    """Fetch a draft, always scoped to org_id — never trust a draft_id alone
    (a stale draft_id echoed from an old conversation must not leak across orgs)."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table(_TABLE)
                .select("*")
                .eq("id", draft_id)
                .eq("org_id", org_id)
                .execute()
                .data or []
            )
            return rows[0] if rows else None
        except Exception as exc:
            if attempt == 0:
                _log.warning("_get_draft attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("_get_draft failed after 2 attempts: %s", exc, exc_info=True)
                raise


def _update_draft(draft_id: str, org_id: str, patch: dict) -> dict:
    """Raises on failure — this is on the critical path of a paid action (sending emails),
    a silently-dropped update could let a partially-resolved draft be confirmed."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            row = (
                db.table(_TABLE)
                .update(patch)
                .eq("id", draft_id)
                .eq("org_id", org_id)
                .execute()
            )
            if not row.data:
                raise ValueError(f"draft {draft_id} not found for org {org_id}")
            return row.data[0]
        except Exception as exc:
            if attempt == 0:
                _log.warning("_update_draft attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("_update_draft failed after 2 attempts: %s", exc, exc_info=True)
                raise
