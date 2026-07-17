import logging
import os
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import graph_client
from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

APP_URL = os.getenv("APP_URL", "http://localhost:5173")


def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


@router.get("/connection")
def get_connection_status(user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            org_conn = graph_client.get_org_connection(db, user["org_id"])
            user_conn = graph_client.get_user_connection(db, user["org_id"], user["id"])
            return {
                "org": {"status": org_conn["status"]} if org_conn else {"status": "disconnected"},
                "personal": {"status": user_conn["status"]} if user_conn else {"status": "disconnected"},
            }
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.warning("get_connection_status failed after 2 attempts: %s", exc)
                return {"org": {"status": "disconnected"}, "personal": {"status": "disconnected"}}


@router.get("/connect/microsoft/admin-consent-url")
def admin_consent_url(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    state = graph_client.make_state_token(user["org_id"], user["id"])
    return {"url": graph_client.get_admin_consent_url(state)}


@router.get("/connect/microsoft/callback")
def microsoft_admin_consent_callback(
    tenant: str | None = None,
    admin_consent: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Browser redirect target from Microsoft's admin-consent flow — no bearer token available here."""
    if error or not tenant or not state:
        return RedirectResponse(f"{APP_URL}/admin?tab=integrations&calendar=error")

    try:
        parsed = graph_client.parse_state_token(state)
    except Exception:
        return RedirectResponse(f"{APP_URL}/admin?tab=integrations&calendar=error")

    org_id = parsed["org_id"]
    user_id = parsed["user_id"]

    try:
        db = get_admin_client()
        existing = graph_client.get_org_connection(db, org_id)
        payload = {
            "org_id": org_id,
            "scope": "org",
            "provider": "microsoft",
            "tenant_id": tenant,
            "status": "connected",
            "connected_by": user_id,
        }
        if existing:
            db.table("calendar_connections").update(payload).eq("id", existing["id"]).execute()
        else:
            db.table("calendar_connections").insert(payload).execute()
    except Exception as exc:
        logger.error("failed to persist org calendar connection: %s", exc, exc_info=True)
        return RedirectResponse(f"{APP_URL}/admin?tab=integrations&calendar=error")

    return RedirectResponse(f"{APP_URL}/admin?tab=integrations&calendar=connected")


@router.get("/connect/microsoft/personal/start")
def personal_oauth_start(user: Annotated[dict, Depends(get_current_user)]):
    """Delegated OAuth fallback for a solo advisor without an org-wide admin connection."""
    state = graph_client.make_state_token(user["org_id"], user["id"])
    return {"url": graph_client.get_personal_oauth_url(state)}


@router.get("/connect/microsoft/personal/callback")
def personal_oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error or not code or not state:
        return RedirectResponse(f"{APP_URL}/notifications?calendar=error")

    try:
        parsed = graph_client.parse_state_token(state)
        token_data = graph_client.exchange_personal_code(code)
    except Exception as exc:
        logger.warning("personal Outlook OAuth exchange failed: %s", exc)
        return RedirectResponse(f"{APP_URL}/notifications?calendar=error")

    org_id = parsed["org_id"]
    user_id = parsed["user_id"]

    try:
        from datetime import datetime, timedelta, timezone
        db = get_admin_client()
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=token_data.get("expires_in", 3600))
        payload = {
            "org_id": org_id,
            "scope": "user",
            "provider": "microsoft",
            "user_id": user_id,
            "status": "connected",
            "access_token": graph_client.encrypt_token(token_data["access_token"]),
            "refresh_token": graph_client.encrypt_token(token_data["refresh_token"]),
            "expires_at": expires_at.isoformat(),
            "connected_by": user_id,
        }
        existing = graph_client.get_user_connection(db, org_id, user_id)
        if existing:
            db.table("calendar_connections").update(payload).eq("id", existing["id"]).execute()
        else:
            db.table("calendar_connections").insert(payload).execute()
    except Exception as exc:
        logger.error("failed to persist personal calendar connection: %s", exc, exc_info=True)
        return RedirectResponse(f"{APP_URL}/notifications?calendar=error")

    return RedirectResponse(f"{APP_URL}/notifications?calendar=connected")


class SyncEmailIn(BaseModel):
    calendar_sync_email: str | None = None


@router.get("/sync-email")
def get_sync_email(user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            res = db.table("profiles").select("email, calendar_sync_email").eq("id", user["id"]).execute()
            row = res.data[0] if res.data else {}
            return {"email": row.get("email"), "calendar_sync_email": row.get("calendar_sync_email")}
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.warning("get_sync_email failed after 2 attempts: %s", exc)
                return {"email": None, "calendar_sync_email": None}


@router.patch("/sync-email")
def set_sync_email(body: SyncEmailIn, user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("profiles").update({"calendar_sync_email": body.calendar_sync_email}).eq("id", user["id"]).execute()
            return {"ok": True}
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("set_sync_email failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.get("/freebusy")
def freebusy(
    advisor_id: str,
    start: str = Query(..., description="ISO datetime, e.g. 2026-07-20T00:00:00"),
    end: str = Query(..., description="ISO datetime, e.g. 2026-07-21T00:00:00"),
    user: Annotated[dict, Depends(get_current_user)] = None,
):
    for attempt in range(2):
        try:
            db = get_admin_client()
            blocks = graph_client.get_freebusy(db, user["org_id"], advisor_id, start, end)
            return {"busy": blocks}
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.warning("freebusy failed after 2 attempts: %s", exc)
                return {"busy": []}
