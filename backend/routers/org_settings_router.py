"""ניהול → "הגדרות": the org's own details and its office phones.

- Org details come from `organizations`.
  name / business_number / business_type / owner_name / org_email are owner-only, always;
  owner_phone and the office phones need can_edit_org_settings (owner, or a manager the
  owner granted it). Viewing needs can_view_org_settings (or edit).
- `org_email` is a record-keeping field only: empty = the owner's signup email is shown.
  It never touches organizations.owner_email (used to detect duplicate orgs at approval)
  nor the owner's login email.
- Office phones (`org_phones`): label + number, "handlers" (users who get the calls'
  "which school?" / "unknown number" prompts and see them in "השיחות שלי"), and the calls
  lines assigned to them (calls_agent_mappings rows with org_phone_id instead of advisor_id —
  a line belongs to a user OR an office phone, never both). Calls with an office phone's
  number on the other side are named "{label} – {org name}" (calls_router).
"""
import logging
import re
import time
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from routers.signup_router import BUSINESS_TYPES
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

_TEMP_ERROR = "שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות"

OWNER_ONLY_FIELDS = ("name", "business_number", "business_type", "owner_name", "org_email")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _access(db, user: dict) -> tuple[bool, bool]:
    """(can_view, can_edit) for the org settings tab."""
    from routers.schools_router import _check_permission

    if user.get("role") == "owner":
        return True, True
    if user.get("role") != "manager":
        return False, False
    can_edit = _check_permission(db, user, "can_edit_org_settings")
    return (can_edit or _check_permission(db, user, "can_view_org_settings")), can_edit


def _require_view(db, user: dict) -> bool:
    can_view, can_edit = _access(db, user)
    if not can_view:
        raise HTTPException(status_code=403, detail="אין הרשאה לצפות בהגדרות הארגון")
    return can_edit


def _require_edit(db, user: dict) -> None:
    if not _access(db, user)[1]:
        raise HTTPException(status_code=403, detail="אין הרשאה לערוך את הגדרות הארגון")


def _phone_digits(raw: str | None) -> str:
    return "".join(ch for ch in str(raw or "") if ch.isdigit())


def _clean_phone(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if len(_phone_digits(value)) < 9:
        raise HTTPException(status_code=400, detail="מספר טלפון לא תקין")
    return value


def _get_phone(db, org_id: str, phone_id: str) -> dict:
    rows = db.table("org_phones").select("*").eq("id", phone_id).eq("org_id", org_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="הטלפון לא נמצא")
    return rows[0]


def _clean_handler_ids(db, org_id: str, ids: list[str] | None) -> list[str]:
    if not ids:
        return []
    rows = db.table("profiles").select("id").eq("org_id", org_id).in_("id", list(set(ids))).execute().data or []
    valid = {r["id"] for r in rows}
    return [i for i in dict.fromkeys(ids) if i in valid]


def _calls_provider(org_id: str) -> tuple[bool, str | None]:
    from routers.calls_router import _get_integration_config

    cfg = _get_integration_config(org_id)
    return bool(cfg and cfg.get("enabled")), (cfg or {}).get("provider")


# ---------------------------------------------------------------------------
# GET
# ---------------------------------------------------------------------------

@router.get("")
def get_org_settings(user: Annotated[dict, Depends(get_current_user)]):
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=404, detail="הארגון לא נמצא")
    for attempt in range(2):
        try:
            db = get_admin_client()
            can_edit = _require_view(db, user)
            org_rows = db.table("organizations").select(
                "id, name, business_number, business_type, owner_name, owner_email, org_email, owner_phone, created_at"
            ).eq("id", org_id).limit(1).execute().data or []
            phones = db.table("org_phones").select("*").eq("org_id", org_id).order("sort_order").order("created_at").execute().data or []
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_org_settings attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_org_settings failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    if not org_rows:
        raise HTTPException(status_code=404, detail="הארגון לא נמצא")
    org = org_rows[0]

    users: list = []
    try:
        db = get_admin_client()
        users = db.table("profiles").select("id, full_name, email, role").eq("org_id", org_id).order("full_name").execute().data or []
    except Exception as exc:
        logger.warning("get_org_settings: users lookup failed (non-fatal): %s", exc)

    calls = {"enabled": False, "provider": None, "known_agents": [], "taken_agent_keys": []}
    lines_by_phone: dict = {}
    try:
        enabled, provider = _calls_provider(org_id)
        if enabled and provider:
            db = get_admin_client()
            known = db.table("calls_known_agents").select("agent_key, agent_label").eq(
                "org_id", org_id).eq("provider", provider).order("agent_label").execute().data or []
            mappings = db.table("calls_agent_mappings").select("agent_key, agent_label, advisor_id, org_phone_id").eq(
                "org_id", org_id).eq("provider", provider).execute().data or []
            labels = {k["agent_key"]: k.get("agent_label") for k in known}
            for m in mappings:
                if m.get("org_phone_id"):
                    lines_by_phone.setdefault(m["org_phone_id"], []).append({
                        "agent_key": m["agent_key"],
                        "agent_label": m.get("agent_label") or labels.get(m["agent_key"]),
                    })
            calls = {
                "enabled": True,
                "provider": provider,
                "known_agents": known,
                # Lines of users — not offered for an office phone (a line has one owner).
                "taken_agent_keys": [m["agent_key"] for m in mappings if m.get("advisor_id")],
            }
    except Exception as exc:
        logger.warning("get_org_settings: calls lines lookup failed (non-fatal): %s", exc)

    return {
        "org": {
            "name": org.get("name"),
            "business_number": org.get("business_number"),
            "business_type": org.get("business_type"),
            "owner_name": org.get("owner_name"),
            "owner_phone": org.get("owner_phone"),
            "org_email": org.get("org_email") or org.get("owner_email"),
            "org_email_is_default": not org.get("org_email"),
            "signup_email": org.get("owner_email"),
            "created_at": org.get("created_at"),
        },
        "phones": [{
            "id": p["id"],
            "label": p.get("label"),
            "phone": p.get("phone"),
            "handler_ids": p.get("handler_ids") or [],
            "lines": lines_by_phone.get(p["id"], []),
        } for p in phones],
        "users": users,
        "calls": calls,
        "permissions": {"is_owner": user.get("role") == "owner", "can_edit": can_edit},
    }


# ---------------------------------------------------------------------------
# Org details
# ---------------------------------------------------------------------------

class OrgDetailsIn(BaseModel):
    name: str | None = None
    business_number: str | None = None
    business_type: str | None = None
    owner_name: str | None = None
    org_email: str | None = None
    owner_phone: str | None = None


@router.put("/details")
def update_org_details(body: OrgDetailsIn, user: Annotated[dict, Depends(get_current_user)]):
    org_id = user.get("org_id")
    db = get_admin_client()
    _require_edit(db, user)
    try:
        org_rows = db.table("organizations").select(
            "name, business_number, business_type, owner_name, owner_email, org_email, owner_phone"
        ).eq("id", org_id).limit(1).execute().data or []
    except Exception as exc:
        logger.error("update_org_details: org lookup failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    if not org_rows:
        raise HTTPException(status_code=404, detail="הארגון לא נמצא")
    org = org_rows[0]

    patch: dict = {}
    for field in ("name", "business_number", "owner_name"):
        value = getattr(body, field)
        if value is None:
            continue
        value = value.strip()
        if not value:
            raise HTTPException(status_code=400, detail="לא ניתן להשאיר שדה חובה ריק")
        if value != (org.get(field) or ""):
            patch[field] = value
    if body.business_type is not None:
        value = body.business_type or None
        if value is not None and value not in BUSINESS_TYPES:
            raise HTTPException(status_code=400, detail="סוג עוסק לא תקין")
        if value != org.get("business_type"):
            patch["business_type"] = value
    if body.org_email is not None:
        value = body.org_email.strip().lower()
        if value and not _EMAIL_RE.match(value):
            raise HTTPException(status_code=400, detail="כתובת מייל לא תקינה")
        # The signup email is the default — storing it again would pin it.
        stored = None if (not value or value == (org.get("owner_email") or "").lower()) else value
        if stored != org.get("org_email"):
            patch["org_email"] = stored
    if body.owner_phone is not None:
        value = body.owner_phone.strip()
        if not value:
            raise HTTPException(status_code=400, detail="לא ניתן להשאיר שדה חובה ריק")
        _clean_phone(value)
        if value != (org.get("owner_phone") or ""):
            patch["owner_phone"] = value

    if any(f in patch for f in OWNER_ONLY_FIELDS) and user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="רק הבעלים יכול לשנות את פרטי הארגון הללו")
    if not patch:
        return {"ok": True, "changed": []}
    try:
        db.table("organizations").update(patch).eq("id", org_id).execute()
    except Exception as exc:
        logger.error("update_org_details: update failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    return {"ok": True, "changed": list(patch.keys())}


# ---------------------------------------------------------------------------
# Office phones
# ---------------------------------------------------------------------------

class OrgPhoneIn(BaseModel):
    label: str | None = None
    phone: str | None = None
    handler_ids: list[str] | None = None


def _phone_out(row: dict) -> dict:
    return {
        "id": row["id"], "label": row.get("label"), "phone": row.get("phone"),
        "handler_ids": row.get("handler_ids") or [],
    }


@router.post("/phones")
def create_org_phone(body: OrgPhoneIn, user: Annotated[dict, Depends(get_current_user)]):
    org_id = user.get("org_id")
    db = get_admin_client()
    _require_edit(db, user)
    label = (body.label or "").strip() or "טלפון משרד"
    phone = _clean_phone(body.phone)
    try:
        handler_ids = _clean_handler_ids(db, org_id, body.handler_ids)
        existing = db.table("org_phones").select("sort_order").eq("org_id", org_id).execute().data or []
        sort_order = max([r.get("sort_order") or 0 for r in existing], default=-1) + 1
        row = db.table("org_phones").insert({
            "org_id": org_id, "label": label, "phone": phone,
            "handler_ids": handler_ids, "sort_order": sort_order,
        }).execute().data[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_org_phone failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    return {**_phone_out(row), "lines": []}


@router.put("/phones/{phone_id}")
def update_org_phone(phone_id: str, body: OrgPhoneIn, user: Annotated[dict, Depends(get_current_user)]):
    org_id = user.get("org_id")
    db = get_admin_client()
    _require_edit(db, user)
    _get_phone(db, org_id, phone_id)
    patch: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.label is not None:
        label = body.label.strip()
        if not label:
            raise HTTPException(status_code=400, detail="יש לתת שם לטלפון")
        patch["label"] = label
    if body.phone is not None:
        patch["phone"] = _clean_phone(body.phone)
    try:
        if body.handler_ids is not None:
            patch["handler_ids"] = _clean_handler_ids(db, org_id, body.handler_ids)
        row = db.table("org_phones").update(patch).eq("id", phone_id).eq("org_id", org_id).execute().data[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_org_phone failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    return _phone_out(row)


@router.delete("/phones/{phone_id}")
def delete_org_phone(phone_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Its calls lines go back to unassigned (calls_agent_mappings rows cascade)."""
    org_id = user.get("org_id")
    db = get_admin_client()
    _require_edit(db, user)
    _get_phone(db, org_id, phone_id)
    try:
        db.table("org_phones").delete().eq("id", phone_id).eq("org_id", org_id).execute()
    except Exception as exc:
        logger.error("delete_org_phone failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    return {"ok": True}


class OrgPhoneLinesIn(BaseModel):
    agent_keys: list[str]


@router.put("/phones/{phone_id}/lines")
def set_org_phone_lines(phone_id: str, body: OrgPhoneLinesIn, user: Annotated[dict, Depends(get_current_user)]):
    """Replace the calls lines assigned to an office phone. A line already assigned to a
    user or to another office phone is refused (409) — it must be released there first."""
    from routers.calls_router import clear_unmapped_agent_alerts

    org_id = user.get("org_id")
    db = get_admin_client()
    _require_edit(db, user)
    _get_phone(db, org_id, phone_id)
    enabled, provider = _calls_provider(org_id)
    if not enabled or not provider:
        raise HTTPException(status_code=400, detail="אין אינטגרציית שיחות מחוברת")

    wanted = list(dict.fromkeys(k for k in body.agent_keys if k))
    try:
        known = {
            r["agent_key"]: r.get("agent_label")
            for r in (db.table("calls_known_agents").select("agent_key, agent_label")
                      .eq("org_id", org_id).eq("provider", provider).execute().data or [])
        }
        mappings = db.table("calls_agent_mappings").select("id, agent_key, advisor_id, org_phone_id").eq(
            "org_id", org_id).eq("provider", provider).execute().data or []
    except Exception as exc:
        logger.error("set_org_phone_lines: lookup failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)

    unknown = [k for k in wanted if k not in known]
    if unknown:
        raise HTTPException(status_code=400, detail="קו שיחות לא מוכר")
    by_key = {m["agent_key"]: m for m in mappings}
    taken = [
        known.get(k) or k for k in wanted
        if k in by_key and by_key[k].get("org_phone_id") != phone_id
    ]
    if taken:
        raise HTTPException(
            status_code=409,
            detail=f"הקו {', '.join(taken)} כבר משויך למשתמש או לטלפון אחר — יש להסיר את השיוך הקיים תחילה",
        )

    current = {m["agent_key"] for m in mappings if m.get("org_phone_id") == phone_id}
    removed = [k for k in current if k not in wanted]
    added = [k for k in wanted if k not in current]
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        if removed:
            db.table("calls_agent_mappings").delete().eq("org_id", org_id).eq("provider", provider).eq(
                "org_phone_id", phone_id).in_("agent_key", removed).execute()
        if added:
            db.table("calls_agent_mappings").insert([{
                "org_id": org_id, "provider": provider, "agent_key": k, "agent_label": known.get(k),
                "advisor_id": None, "org_phone_id": phone_id, "updated_at": now_iso,
            } for k in added]).execute()
    except Exception as exc:
        logger.error("set_org_phone_lines: write failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail=_TEMP_ERROR)
    clear_unmapped_agent_alerts(org_id, provider, added)
    return {"lines": [{"agent_key": k, "agent_label": known.get(k)} for k in wanted]}
