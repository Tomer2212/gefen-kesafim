"""District / ownership ("מחוז" / "בעלות") client cards.

A consulting org sometimes works for a whole district or ownership (an hours bank, a contract)
and logs one work row on it instead of a meeting per school. Such a client is an ordinary
`schools` row with:
  client_type = 'district' | 'ownership'   ('school' for every real school)
  status      = 'entity'                   (never 'active' — every school list filters 'active',
                                            so a client card never reaches the dashboard's school
                                            tab, tasks, rounds, collection, …)
  entity_key  = the district name / the Ministry ownership code (UNIQUE per org + type)
  is_client   = marked "לקוח של הארגון" (owner/manager, or an approved advisor request)
Being a `schools` row is what lets every single-school meeting path (MeetingRow, notes,
offline work, calls "בפועל", Outlook, meeting_activity, meetings stats) work unchanged — the
same trick as the national directory's status='directory' copies.

The catalog is fixed: the 8 districts, and the Ministry directory's ownerships with 2+ schools
or a local authority (SQL `ownership_catalog()`). A card row is created lazily (`adopt`).
Mirrored by frontend/src/constants/clientEntities.js — keep in sync.
"""

from fastapi import HTTPException

# Same list (and order) as the school card's "מחוז" field — the only source for both.
DISTRICTS = ["צפון", "דרום", "מרכז", "ירושלים", "תל-אביב", "חיפה", "חינוך התיישבותי", "חרדי"]

ENTITY_TYPES = ("district", "ownership")
ENTITY_STATUS = "entity"

# "סוג" options of a district/ownership meeting (meetings.meeting_service_type).
ENTITY_MEETING_SERVICE_TYPES = ("gefen", "current")


def is_entity(row: dict | None) -> bool:
    return bool(row) and (row.get("client_type") or "school") in ENTITY_TYPES


def display_name(client_type: str, catalog_name: str) -> str:
    """The card's `schools.name`: "מחוז דרום" for a district (a bare "דרום" would be ambiguous
    wherever a school name is shown — Outlook subjects, notifications, calls), the ownership's
    name as is."""
    return f"מחוז {catalog_name}" if client_type == "district" else catalog_name


def client_label(row: dict) -> str:
    return (row or {}).get("name") or ""


def check_meeting_service_type(value: str | None) -> None:
    if value not in (None, "") and value not in ENTITY_MEETING_SERVICE_TYPES:
        raise HTTPException(status_code=400, detail="בפגישה של מחוז או בעלות אפשר לבחור רק גפן או שוטף")


def ownership_catalog(db) -> list[dict]:
    """[{ownership_code, ownership_name, school_count}] — see the SQL function's rule."""
    return db.rpc("ownership_catalog", {}).execute().data or []


def catalog(db, client_type: str) -> list[dict]:
    """[{key, name, directory_school_count}] for a type, in display order."""
    if client_type == "district":
        return [{"key": d, "name": d, "directory_school_count": None} for d in DISTRICTS]
    rows = ownership_catalog(db)
    out = [
        {"key": r["ownership_code"], "name": r["ownership_name"], "directory_school_count": r.get("school_count")}
        for r in rows if r.get("ownership_code") and r.get("ownership_name")
    ]
    out.sort(key=lambda r: r["name"])
    return out


def catalog_entry(db, client_type: str, key: str) -> dict | None:
    if client_type == "district":
        return {"key": key, "name": key} if key in DISTRICTS else None
    for r in ownership_catalog(db):
        if r.get("ownership_code") == key:
            return {"key": key, "name": r.get("ownership_name")}
    return None


def adopt(db, org_id: str, client_type: str, key: str) -> tuple[dict, bool]:
    """Return the org's card row for a catalog entry, creating it on first use.
    Returns (row, created). Race-safe through UNIQUE(org_id, client_type, entity_key)."""
    if client_type not in ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="סוג לקוח לא תקין")

    def _existing():
        return (
            db.table("schools").select("*")
            .eq("org_id", org_id).eq("client_type", client_type).eq("entity_key", key)
            .execute().data or []
        )

    rows = _existing()
    if rows:
        return rows[0], False
    entry = catalog_entry(db, client_type, key)
    if not entry:
        raise HTTPException(status_code=404, detail="לא נמצא ברשימה")
    payload = {
        "org_id": org_id,
        "name": display_name(client_type, entry["name"]),
        "client_type": client_type,
        "entity_key": key,
        "status": ENTITY_STATUS,
        "is_client": False,
        "extra_contacts": [],
        # Existing meetings-screen columns/filters read these school fields.
        "district": entry["name"] if client_type == "district" else None,
        "authority": entry["name"] if client_type == "ownership" else None,
    }
    try:
        created = db.table("schools").insert(payload).execute().data or []
        return created[0], True
    except Exception:
        # Lost a race with a concurrent adopt — the unique index kept one row.
        rows = _existing()
        if rows:
            return rows[0], False
        raise
