import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

_MANAGER_ROLES = ("owner", "manager")


def _require_manager(user: dict) -> None:
    if user["role"] not in _MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="אין הרשאה")


@router.get("/offline-work")
def get_offline_work(
    advisor_id: str,
    date_from: str,
    date_to: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    """Offline-work entries (`meetings.offline_work_entries`) attributed to one advisor
    across ALL schools in the org, within a date range — used by the "ביצועים" admin tab.
    Filtering happens entirely in Postgres via `get_offline_work_for_advisor` (unnests the
    JSONB array server-side) — never fetch every meeting into Python and filter here."""
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            res = db.rpc("get_offline_work_for_advisor", {
                "p_org_id": user["org_id"],
                "p_advisor_id": advisor_id,
                "p_date_from": date_from,
                "p_date_to": date_to,
            }).execute()
            return {"entries": res.data or []}
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_offline_work attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("get_offline_work failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
