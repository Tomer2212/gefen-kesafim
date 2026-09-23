import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user, invalidate_device_cache
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

CRON_SECRET = os.getenv("CRON_SECRET", "")
MAX_SESSIONS_PER_USER = 3
MAX_PRIMARY_SESSIONS_PER_USER = 2


def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _fetch_one(query) -> dict | None:
    """Like .maybe_single(), but tolerant of the 0-row case — the installed
    postgrest-py raises APIError('Missing response') from .maybe_single() when
    a query legitimately matches no rows, instead of returning data=None."""
    rows = query.limit(1).execute().data or []
    return rows[0] if rows else None


def _row_out(r: dict, current_device_id: str | None) -> dict:
    return {
        "id": r["id"],
        "device_label": r.get("device_label"),
        "ip_address": r.get("ip_address"),
        "is_primary": bool(r.get("is_primary")),
        "created_at": r.get("created_at"),
        "last_seen_at": r.get("last_seen_at"),
        "is_current": r.get("device_id") == current_device_id,
    }


class SessionRegisterIn(BaseModel):
    device_id: str
    device_label: str | None = None


# ---------------------------------------------------------------------------
# Personal ("אזור אישי") endpoints
# ---------------------------------------------------------------------------

@router.post("/register")
def register_session(
    body: SessionRegisterIn,
    request: Request,
    user: Annotated[dict, Depends(get_current_user)],
):
    """Called by the frontend right after login/app-load to track this browser
    as one of the user's active connections. Enforces the 3-connection cap.

    device_id identifies the browser only, not the (browser, user) pair — the
    same physical browser can be used by several different accounts over time
    (shared computer, account switching), so each gets its own row, keyed by
    the row's own server-generated id. See user_sessions_device_user_unique."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            now_iso = datetime.now(timezone.utc).isoformat()

            existing = _fetch_one(
                db.table("user_sessions")
                .select("id, revoked_at")
                .eq("device_id", body.device_id)
                .eq("user_id", user["id"])
            )
            if existing and not existing.get("revoked_at"):
                db.table("user_sessions").update({
                    "last_seen_at": now_iso,
                    "ip_address": _client_ip(request),
                }).eq("id", existing["id"]).execute()
                break

            active_res = (
                db.table("user_sessions")
                .select("id, is_primary", count="exact")
                .eq("user_id", user["id"])
                .is_("revoked_at", "null")
                .execute()
            )
            active_rows = active_res.data or []
            if len(active_rows) >= MAX_SESSIONS_PER_USER:
                raise HTTPException(
                    status_code=409,
                    detail="הגעת למספר המקסימלי של חיבורים פעילים (3). יש לנתק חיבור קיים כדי להמשיך.",
                )
            is_primary = not any(r.get("is_primary") for r in active_rows)

            db.table("user_sessions").insert({
                "device_id": body.device_id,
                "user_id": user["id"],
                "org_id": user["org_id"],
                "device_label": body.device_label,
                "ip_address": _client_ip(request),
                "is_primary": is_primary,
                "created_at": now_iso,
                "last_seen_at": now_iso,
            }).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("register_session attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("register_session failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    invalidate_device_cache(body.device_id, user["id"])
    return {"ok": True}


@router.get("/me")
def list_my_sessions(request: Request, user: Annotated[dict, Depends(get_current_user)]):
    current_device_id = request.headers.get("X-Device-Id")
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("user_sessions")
                .select("id, device_id, device_label, ip_address, is_primary, created_at, last_seen_at")
                .eq("user_id", user["id"])
                .is_("revoked_at", "null")
                .order("created_at")
                .execute()
                .data or []
            )
            return {"sessions": [_row_out(r, current_device_id) for r in rows]}
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_my_sessions attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("list_my_sessions failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.delete("/me/{session_id}")
def disconnect_my_session(session_id: str, user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            row = _fetch_one(
                db.table("user_sessions")
                .select("id, user_id, device_id, is_primary")
                .eq("id", session_id)
            )
            if not row or row.get("user_id") != user["id"]:
                raise HTTPException(status_code=404, detail="החיבור לא נמצא")
            if row.get("is_primary"):
                raise HTTPException(
                    status_code=403,
                    detail="לא ניתן לנתק חיבור ראשי בעצמך — פנה לבעלים/מנהל כדי להסיר או להחליף אותו.",
                )
            db.table("user_sessions").update({
                "revoked_at": datetime.now(timezone.utc).isoformat(),
                "revoked_by": user["id"],
            }).eq("id", session_id).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("disconnect_my_session attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("disconnect_my_session failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    invalidate_device_cache(row["device_id"], user["id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin ("אזור ניהול") endpoints
# ---------------------------------------------------------------------------

@router.get("/users/counts")
def list_all_session_counts(user: Annotated[dict, Depends(get_current_user)]):
    """Active-connection count + primary-device list per user in the org, for the
    admin table (manager+). Registered before /users/{user_id} — otherwise FastAPI
    would match "counts" as a user_id."""
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("user_sessions")
                .select("user_id, is_primary, device_label, ip_address")
                .eq("org_id", user["org_id"])
                .is_("revoked_at", "null")
                .execute()
                .data or []
            )
            counts: dict[str, int] = {}
            # A user can have up to MAX_PRIMARY_SESSIONS_PER_USER primaries at once —
            # a list per user, not a single object.
            primary: dict[str, list] = {}
            for r in rows:
                counts[r["user_id"]] = counts.get(r["user_id"], 0) + 1
                if r.get("is_primary"):
                    primary.setdefault(r["user_id"], []).append(
                        {"device_label": r.get("device_label"), "ip_address": r.get("ip_address")}
                    )
            return {"counts": counts, "primary": primary}
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_all_session_counts attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("list_all_session_counts failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.get("/users/{user_id}")
def list_user_sessions(user_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = _fetch_one(db.table("profiles").select("id, org_id").eq("id", user_id))
            if not target or target.get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            rows = (
                db.table("user_sessions")
                .select("id, device_label, ip_address, is_primary, created_at, last_seen_at")
                .eq("user_id", user_id)
                .is_("revoked_at", "null")
                .order("created_at")
                .execute()
                .data or []
            )
            return {"sessions": [_row_out(r, None) for r in rows]}
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_user_sessions attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("list_user_sessions failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.delete("/users/{user_id}/{session_id}")
def disconnect_user_session(user_id: str, session_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = _fetch_one(db.table("profiles").select("id, org_id").eq("id", user_id))
            if not target or target.get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            row = _fetch_one(db.table("user_sessions").select("id, device_id").eq("id", session_id).eq("user_id", user_id))
            if not row:
                raise HTTPException(status_code=404, detail="החיבור לא נמצא")
            db.table("user_sessions").update({
                "revoked_at": datetime.now(timezone.utc).isoformat(),
                "revoked_by": user["id"],
            }).eq("id", session_id).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("disconnect_user_session attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("disconnect_user_session failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    invalidate_device_cache(row["device_id"], user_id)
    return {"ok": True}


class SetPrimaryIn(BaseModel):
    is_primary: bool = True


@router.patch("/users/{user_id}/{session_id}/primary")
def set_primary_session(user_id: str, session_id: str, body: SetPrimaryIn, user: Annotated[dict, Depends(get_current_user)]):
    """Toggles is_primary on one connection (manager+). Up to MAX_PRIMARY_SESSIONS_PER_USER
    connections can be primary at once per user (e.g. a regular home + office computer) —
    this is NOT exclusive like it used to be, so turning one on no longer turns others off."""
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = _fetch_one(db.table("profiles").select("id, org_id").eq("id", user_id))
            if not target or target.get("org_id") != user["org_id"]:
                raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
            row = _fetch_one(
                db.table("user_sessions")
                .select("id, is_primary")
                .eq("id", session_id)
                .eq("user_id", user_id)
                .is_("revoked_at", "null")
            )
            if not row:
                raise HTTPException(status_code=404, detail="החיבור לא נמצא או שנותק")
            if body.is_primary and not row.get("is_primary"):
                primary_count = (
                    db.table("user_sessions")
                    .select("id", count="exact")
                    .eq("user_id", user_id)
                    .eq("is_primary", True)
                    .is_("revoked_at", "null")
                    .execute()
                )
                if (primary_count.count or 0) >= MAX_PRIMARY_SESSIONS_PER_USER:
                    raise HTTPException(
                        status_code=400,
                        detail=f"כבר יש {MAX_PRIMARY_SESSIONS_PER_USER} חיבורים ראשיים למשתמש זה — יש להסיר אחד קודם.",
                    )
            db.table("user_sessions").update({"is_primary": body.is_primary}).eq("id", session_id).execute()
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("set_primary_session attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.error("set_primary_session failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Org-level auto-disconnect setting + config endpoints
# ---------------------------------------------------------------------------

class AutoDisconnectIn(BaseModel):
    session_auto_disconnect_hours: int | None = None


@router.get("/automations")
def get_session_automations(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    org = (
        db.table("organizations")
        .select("session_auto_disconnect_hours")
        .eq("id", user["org_id"])
        .single()
        .execute()
        .data or {}
    )
    return {"session_auto_disconnect_hours": org.get("session_auto_disconnect_hours")}


@router.put("/automations")
def set_session_automations(body: AutoDisconnectIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    hours = body.session_auto_disconnect_hours
    patch = {"session_auto_disconnect_hours": hours}
    if hours and hours > 0:
        patch["session_auto_disconnect_next_run_at"] = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    else:
        patch["session_auto_disconnect_next_run_at"] = None
    db.table("organizations").update(patch).eq("id", user["org_id"]).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Cron-triggered: revoke non-primary connections for orgs whose interval is due
# ---------------------------------------------------------------------------

@router.post("/auto-disconnect")
def auto_disconnect(request: Request):
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    orgs = []
    for attempt in range(2):
        try:
            db = get_admin_client()
            res = (
                db.table("organizations")
                .select("id, session_auto_disconnect_hours, session_auto_disconnect_next_run_at")
                .not_.is_("session_auto_disconnect_hours", "null")
                .gt("session_auto_disconnect_hours", 0)
                .execute()
            )
            orgs = res.data or []
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("auto_disconnect attempt 1 failed: %s — resetting", exc)
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("auto_disconnect failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת")

    due_orgs = [o for o in orgs if not o.get("session_auto_disconnect_next_run_at") or o["session_auto_disconnect_next_run_at"] <= now_iso]
    disconnected_orgs = 0
    for org in due_orgs:
        try:
            db = get_admin_client()
            db.table("user_sessions").update({"revoked_at": now_iso}).eq("org_id", org["id"]).eq("is_primary", False).is_("revoked_at", "null").execute()
            next_run = (now + timedelta(hours=org["session_auto_disconnect_hours"])).isoformat()
            db.table("organizations").update({"session_auto_disconnect_next_run_at": next_run}).eq("id", org["id"]).execute()
            disconnected_orgs += 1
        except Exception as exc:
            logger.warning("auto_disconnect: org %s failed (non-fatal, will retry next run): %s", org["id"], exc)

    return {"ok": True, "orgs_processed": disconnected_orgs, "orgs_due": len(due_orgs)}
