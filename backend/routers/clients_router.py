"""District / ownership client cards ("סוג לקוח: מחוזות / בעלויות") — see client_entities.py."""

import logging
import re
import time
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, field_validator

import client_entities
import school_activity
from academic_years import DEFAULT_ACADEMIC_YEAR
from auth import get_current_user
from routers.schools_router import (
    _check_permission, _resync_school_meetings_after_contact_change, _school_phone_suffixes,
)
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

EntityType = Literal["district", "ownership"]

_ENTITY_SELECT = "id, name, client_type, entity_key, is_client, extra_contacts"


def _require_entity(db, user: dict, entity_id: str) -> dict:
    rows = (
        db.table("schools").select("*")
        .eq("id", entity_id).eq("org_id", user["org_id"]).in_("client_type", list(client_entities.ENTITY_TYPES))
        .execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="הלקוח לא נמצא")
    return rows[0]


def _row_out(row: dict) -> dict:
    out = {k: row.get(k) for k in ("id", "name", "client_type", "entity_key", "is_client", "extra_contacts", "status")}
    out["label"] = client_entities.client_label(row)
    return out


@router.get("/")
def list_clients(
    user: Annotated[dict, Depends(get_current_user)],
    type: EntityType,
    scope: Literal["clients", "all"] = "clients",
    academic_year: str = DEFAULT_ACADEMIC_YEAR,
):
    """`clients`: the org's cards marked as clients, plus cards with meetings this year (so work
    logged on an unmarked one is never hidden). `all`: the whole catalog merged with the org's cards."""
    entities: list = []
    for attempt in range(2):
        try:
            db = get_admin_client()
            entities = (
                db.table("schools").select(_ENTITY_SELECT)
                .eq("org_id", user["org_id"]).eq("client_type", type)
                .execute().data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_clients attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("list_clients failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    by_key = {e["entity_key"]: e for e in entities}
    entity_ids = [e["id"] for e in entities]

    # Meetings of the year: completed count + minutes per type, last / next meeting. Non-fatal.
    stats: dict = {}
    if entity_ids:
        try:
            db = get_admin_client()
            for r in db.rpc("get_meetings_stats", {"school_ids": entity_ids, "p_academic_year": academic_year}).execute().data or []:
                st = stats.setdefault(r["school_id"], {})
                st[r["service_type"]] = {"completed": r.get("completed") or 0, "minutes": r.get("total_minutes") or 0}
        except Exception as exc:
            logger.warning("list_clients meetings stats failed (non-fatal): %s", exc)
    dates: dict = {}
    if entity_ids:
        try:
            db = get_admin_client()
            today = date.today().isoformat()
            rows = (
                db.table("meetings").select("school_id, meeting_date, status")
                .in_("school_id", entity_ids).eq("academic_year", academic_year)
                .execute().data or []
            )
            for m in rows:
                d = dates.setdefault(m["school_id"], {"count": 0, "last": None, "next": None})
                d["count"] += 1
                md = m.get("meeting_date")
                if not md or m.get("status") not in ("scheduled", "completed"):
                    continue
                if md <= today and (d["last"] is None or md > d["last"]):
                    d["last"] = md
                if md > today and (d["next"] is None or md < d["next"]):
                    d["next"] = md
        except Exception as exc:
            logger.warning("list_clients meeting dates failed (non-fatal): %s", exc)

    # The org's own client schools under each district / ownership. Non-fatal.
    our_counts: dict = {}
    try:
        db = get_admin_client()
        field = "district" if type == "district" else "authority"
        for s in db.table("schools").select(field).eq("org_id", user["org_id"]).eq("status", "active").execute().data or []:
            v = (s.get(field) or "").strip()
            if v:
                our_counts[v] = our_counts.get(v, 0) + 1
    except Exception as exc:
        logger.warning("list_clients our-schools count failed (non-fatal): %s", exc)

    catalog: list = []
    try:
        db = get_admin_client()
        catalog = client_entities.catalog(db, type)
    except Exception as exc:
        logger.warning("list_clients catalog failed (non-fatal): %s", exc)
    catalog_by_key = {c["key"]: c for c in catalog}

    if scope == "all":
        keys = [c["key"] for c in catalog] + [k for k in by_key if k not in catalog_by_key]
    else:
        keys = [
            e["entity_key"] for e in entities
            if e.get("is_client") or (dates.get(e["id"]) or {}).get("count")
        ]

    result = []
    for key in keys:
        ent = by_key.get(key)
        cat = catalog_by_key.get(key) or {}
        # The bare district / ownership name, as the org's schools store it in district / authority.
        base_name = key if type == "district" else (cat.get("name") or (ent or {}).get("authority") or "")
        name = (ent or {}).get("name") or client_entities.display_name(type, base_name or key)
        eid = (ent or {}).get("id")
        st = stats.get(eid, {}) if eid else {}
        dt = dates.get(eid, {}) if eid else {}
        contacts = [c for c in ((ent or {}).get("extra_contacts") or []) if (c or {}).get("name")]
        result.append({
            "key": key,
            "id": eid,
            "client_type": type,
            "name": name,
            "label": name,
            "is_client": bool((ent or {}).get("is_client")),
            "contacts": [{"name": c.get("name"), "role": c.get("role") or ""} for c in contacts],
            "directory_school_count": cat.get("directory_school_count"),
            "our_school_count": our_counts.get(base_name, 0),
            "meetings_done_gefen": (st.get("gefen") or {}).get("completed", 0),
            "meetings_done_current": (st.get("current") or {}).get("completed", 0),
            "meetings_done_total": sum(v["completed"] for v in st.values()),
            "minutes_gefen": (st.get("gefen") or {}).get("minutes", 0),
            "minutes_current": (st.get("current") or {}).get("minutes", 0),
            "minutes_total": sum(v["minutes"] for v in st.values()),
            "meetings_in_year": dt.get("count", 0),
            "last_meeting_date": dt.get("last"),
            "next_meeting_date": dt.get("next"),
        })
    return result


class AdoptIn(BaseModel):
    type: EntityType
    key: str


@router.post("/adopt")
def adopt_client(body: AdoptIn, user: Annotated[dict, Depends(get_current_user)]):
    """The org's card for a district / ownership, created on first use (opening it, or picking it
    for a meeting). Any org user may — it only opens a card, it doesn't mark a client."""
    db = get_admin_client()
    row, created = client_entities.adopt(db, user["org_id"], body.type, body.key.strip())
    if created:
        school_activity.log_school_activity(
            db, school_id=row["id"], org_id=user["org_id"], actor_id=user["id"],
            source="client_card", action="created", after=row,
        )
    return _row_out(row)


@router.get("/{entity_id}")
def get_client(entity_id: str, user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            row = _require_entity(db, user, entity_id)
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_client attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_client failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    out = _row_out(row)
    try:
        db = get_admin_client()
        out["can_edit_directly"] = _check_permission(db, user, "can_edit_school_directly")
        out["can_request_update"] = _check_permission(db, user, "can_request_school_update")
    except Exception as exc:
        logger.warning("get_client permissions failed (non-fatal): %s", exc)
        out["can_edit_directly"] = user["role"] in ("owner", "manager")
        out["can_request_update"] = False
    out["can_mark_client"] = user["role"] in ("owner", "manager")
    return out


_PHONE_RE = re.compile(r"^0\d{8,9}$")


class ContactIn(BaseModel):
    role: str | None = None
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    day_off: list[str] | None = None

    @field_validator("phone")
    @classmethod
    def _phone_format(cls, v):
        # Same rule as ClientPage.phoneError: 9-10 digits starting with 0 (mobile or landline).
        # Normalized first like ClientPage.normalizePhone ("972524399715" / "052-439-9715" -> "0524399715").
        v = re.sub(r"\D", "", v or "")
        if v.startswith("972") and len(v) >= 11:
            v = "0" + v[3:]
        if v and not _PHONE_RE.match(v):
            raise ValueError("מספר טלפון חייב להכיל 9 או 10 ספרות ולהתחיל ב-0")
        return v or None


class ContactsIn(BaseModel):
    extra_contacts: list[ContactIn]


@router.put("/{entity_id}/contacts")
def update_client_contacts(entity_id: str, body: ContactsIn, user: Annotated[dict, Depends(get_current_user)],
                           background_tasks: BackgroundTasks):
    """Direct edit — owner/manager, or an advisor with "can_edit_school_directly" (no advisor
    assignment needed: every org user sees every district / ownership). Others submit an update
    request (POST /schools/{id}/update-requests) instead."""
    db = get_admin_client()
    row = _require_entity(db, user, entity_id)
    if user["role"] not in ("owner", "manager") and not _check_permission(db, user, "can_edit_school_directly"):
        raise HTTPException(status_code=403, detail="אין הרשאה לעריכה ישירה — יש להגיש בקשת עדכון")
    contacts = [c.model_dump(exclude_none=True) for c in body.extra_contacts]
    contacts = [c for c in contacts if any((c.get(k) or "").strip() for k in ("name", "phone", "email") if isinstance(c.get(k), str))]
    updated = db.table("schools").update({"extra_contacts": contacts}).eq("id", entity_id).eq("org_id", user["org_id"]).execute().data or []
    school_activity.log_school_activity(
        db, school_id=entity_id, org_id=user["org_id"], actor_id=user["id"], source="client_card",
        action="updated", before={"extra_contacts": row.get("extra_contacts")}, after={"extra_contacts": contacts},
        fields=("extra_contacts",),
    )
    # A contact phone changed → calls with that number may belong to past meetings too (as on the school card).
    if _school_phone_suffixes(row) != _school_phone_suffixes({**row, "extra_contacts": contacts}):
        background_tasks.add_task(_resync_school_meetings_after_contact_change, user["org_id"], entity_id)
    return _row_out(updated[0] if updated else {**row, "extra_contacts": contacts})


class ClientListIn(BaseModel):
    is_client: bool


@router.patch("/{entity_id}/client-list")
def set_client_list(entity_id: str, body: ClientListIn, user: Annotated[dict, Depends(get_current_user)]):
    """Mark / unmark "לקוח של הארגון" — owner/manager only. An advisor submits an update request
    with {is_client} (applied by the existing approval flow)."""
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="רק בעלים או מנהל יכולים לסמן לקוח — יש להגיש בקשה")
    db = get_admin_client()
    row = _require_entity(db, user, entity_id)
    if bool(row.get("is_client")) == body.is_client:
        return _row_out(row)
    db.table("schools").update({"is_client": body.is_client}).eq("id", entity_id).eq("org_id", user["org_id"]).execute()
    school_activity.log_school_activity(
        db, school_id=entity_id, org_id=user["org_id"], actor_id=user["id"], source="client_card",
        action="updated", before={"is_client": row.get("is_client")}, after={"is_client": body.is_client},
        fields=("is_client",),
    )
    return _row_out({**row, "is_client": body.is_client})
