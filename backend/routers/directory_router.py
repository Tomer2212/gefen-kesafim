"""National school directory ("מאגר בתי ספר") endpoints — see school_directory.py.

Superadmin: upload the Ministry file (preview, then publish), enable the directory per org,
link an org's existing schools by symbol (report first, then apply).
Org users (only where organizations.directory_enabled): search the directory, open an entry,
adopt it (create / reuse the org's private copy). Managers: move a copy into the client list
("הוסף לרשימת הלקוחות") or back ("החזר למאגר").
"""
import logging
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import school_activity
import school_directory
from academic_years import DEFAULT_ACADEMIC_YEAR
from auth import get_current_user
from routers.signup_router import _require_superadmin
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

STORAGE_BUCKET = "check-files"
_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
_TEMP_ERROR = "שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות"


def _org_enabled(db, org_id: str | None) -> bool:
    if not org_id:
        return False
    rows = db.table("organizations").select("directory_enabled").eq("id", org_id).execute().data or []
    return bool(rows and rows[0].get("directory_enabled"))


def _require_enabled(db, user: dict):
    if not _org_enabled(db, user.get("org_id")):
        raise HTTPException(status_code=403, detail="מאגר בתי הספר אינו פעיל בארגון")


def _with_retry(name: str, fn):
    for attempt in range(2):
        try:
            return fn(get_admin_client())
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("%s attempt 1 failed: %s — resetting and retrying", name, exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("%s failed after 2 attempts: %s", name, exc, exc_info=True)
                raise HTTPException(status_code=503, detail=_TEMP_ERROR)


# ---------------------------------------------------------------------------
# Org users
# ---------------------------------------------------------------------------

@router.get("/enabled")
def directory_enabled(user: Annotated[dict, Depends(get_current_user)]):
    # Polled by the sidebar on every page — never raises (Architecture Invariant #9).
    for attempt in range(2):
        try:
            return {"enabled": _org_enabled(get_admin_client(), user.get("org_id"))}
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("directory_enabled failed after 2 attempts: %s", exc)
                return {"enabled": False}


@router.get("/schools")
def search_directory_schools(
    user: Annotated[dict, Depends(get_current_user)],
    q: str | None = None,
    city: str | None = None,
    education_authority: str | None = None,
    ministry_stage: str | None = None,
    supervision: str | None = None,
    sector: str | None = None,
    district: str | None = None,
    page: int = 0,
):
    def run(db):
        _require_enabled(db, user)
        filters = {"city": city, "education_authority": education_authority, "ministry_stage": ministry_stage,
                   "supervision": supervision, "sector": sector, "district": district}
        return school_directory.search_directory(db, user["org_id"], q, filters, page)
    return _with_retry("search_directory_schools", run)


@router.get("/picker")
def directory_picker(user: Annotated[dict, Depends(get_current_user)], q: str | None = None):
    """The pickers' "מהמאגר" tab: directory schools the org already had meetings with first,
    then directory matches (entries already linked to a copy point at that copy)."""
    def run(db):
        _require_enabled(db, user)
        met = school_directory.met_copies(db, user["org_id"], q)
        result = school_directory.search_directory(db, user["org_id"], q, {}, 0, page_size=20) if (q or "").strip() else {"items": [], "total": 0}
        met_ids = {m["id"] for m in met}
        items = [i for i in result["items"] if i["school_id"] not in met_ids]
        return {"met": met, "items": items, "total": result["total"]}
    return _with_retry("directory_picker", run)


@router.get("/schools/{directory_id}")
def get_directory_school(directory_id: str, user: Annotated[dict, Depends(get_current_user)]):
    def run(db):
        _require_enabled(db, user)
        rows = db.table("school_directory").select(school_directory.DIRECTORY_SELECT).eq("id", directory_id).execute().data or []
        if not rows:
            raise HTTPException(status_code=404, detail="בית הספר לא נמצא במאגר")
        link = (
            db.table("school_directory_links").select("school_id")
            .eq("org_id", user["org_id"]).eq("directory_id", directory_id).execute().data or []
        )
        copy = None
        if link:
            copies = (
                db.table("schools").select(school_directory.COPY_SELECT)
                .eq("id", link[0]["school_id"]).eq("org_id", user["org_id"]).execute().data or []
            )
            copy = copies[0] if copies else None
        met = bool(copy) and copy["id"] in school_directory.schools_with_meetings(db, [copy["id"]])
        return school_directory._merge_item(rows[0], copy, met=met)
    return _with_retry("get_directory_school", run)


@router.post("/schools/{directory_id}/adopt")
def adopt_directory_school(directory_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    _require_enabled(db, user)
    try:
        return school_directory.adopt(db, user["org_id"], directory_id, user["id"])
    except school_directory.AdoptConflict as exc:
        raise HTTPException(status_code=409, detail=exc.detail)
    except LookupError:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא במאגר")


class ClientListIn(BaseModel):
    action: Literal["add", "return"]
    client_status: Literal["in_progress", "active"] | None = None
    academic_year: str = DEFAULT_ACADEMIC_YEAR


@router.post("/client-list/{school_id}")
def change_client_list(school_id: str, body: ClientListIn, user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")
    db = get_admin_client()
    rows = db.table("schools").select("id, org_id, status").eq("id", school_id).eq("org_id", user["org_id"]).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="בית ספר לא נמצא")
    school = rows[0]
    linked = bool(db.table("school_directory_links").select("id").eq("school_id", school_id).execute().data)

    if body.action == "add":
        if school["status"] != "directory":
            raise HTTPException(status_code=400, detail="בית הספר כבר ברשימת הלקוחות")
        if not body.client_status:
            raise HTTPException(status_code=400, detail="יש לבחור סטטוס לקוח")
        if body.client_status == "active" and not _has_typed_advisor(db, school_id):
            raise HTTPException(status_code=400, detail={
                "code": "missing_advisor",
                "message": "לקוח פעיל חייב יועץ מלווה. סמנו \"בתהליך\", או הגדירו קודם יועץ מלווה בפרטי הליווי.",
            })
        year_before = _year_row(db, school_id, body.academic_year)
        db.table("school_year_admin_data").upsert(
            {"school_id": school_id, "academic_year": body.academic_year, "client_status": body.client_status},
            on_conflict="school_id,academic_year",
        ).execute()
        db.table("schools").update({"status": "active"}).eq("id", school_id).execute()
        school_activity.log_school_activity(
            db, school_id=school_id, org_id=user["org_id"], actor_id=user["id"], source="directory",
            action="updated", before=year_before or {}, after={"client_status": body.client_status},
            fields=("client_status",), academic_year=body.academic_year,
        )
        return {"status": "active"}

    if school["status"] != "active":
        raise HTTPException(status_code=400, detail="אפשר להחזיר למאגר רק בית ספר שנמצא ברשימת הלקוחות")
    if not linked:
        raise HTTPException(status_code=400, detail="בית הספר אינו מקושר למאגר, ולכן אי אפשר להחזיר אותו אליו")
    db.table("schools").update({"status": "directory"}).eq("id", school_id).execute()
    school_activity.log_school_activity(
        db, school_id=school_id, org_id=user["org_id"], actor_id=user["id"], source="directory",
        action="updated", before={"status": "active"}, after={"status": "directory"}, fields=("status",),
    )
    return {"status": "directory"}


def _has_typed_advisor(db, school_id: str) -> bool:
    for table in ("school_advisors_gefen", "school_advisors_current", "school_advisors_district"):
        if db.table(table).select("advisor_id").eq("school_id", school_id).limit(1).execute().data:
            return True
    return False


def _year_row(db, school_id: str, academic_year: str) -> dict | None:
    rows = (
        db.table("school_year_admin_data").select("client_status")
        .eq("school_id", school_id).eq("academic_year", academic_year).execute().data or []
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Superadmin
# ---------------------------------------------------------------------------

@router.get("/admin/status")
def admin_status(user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)

    def run(db):
        count = db.table("school_directory").select("id", count="exact").is_("missing_since", "null").limit(1).execute().count or 0
        imports = (
            db.table("school_directory_imports").select("id, file_name, status, stats, created_at, published_at")
            .eq("kind", "directory").order("created_at", desc=True).limit(5).execute().data or []
        )
        orgs = db.table("organizations").select("id, name, directory_enabled").order("name").execute().data or []
        links = db.table("school_directory_links").select("org_id").execute().data or []
        per_org: dict[str, int] = {}
        for link in links:
            per_org[link["org_id"]] = per_org.get(link["org_id"], 0) + 1
        for o in orgs:
            o["linked_schools"] = per_org.get(o["id"], 0)
        return {"directory_count": count, "imports": imports, "orgs": orgs}
    return _with_retry("directory_admin_status", run)


@router.post("/admin/preview")
def admin_preview(user: Annotated[dict, Depends(get_current_user)], file: UploadFile = File(...)):
    _require_superadmin(user)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="יש להעלות קובץ אקסל (xlsx)")
    content = file.file.read(_MAX_UPLOAD_BYTES + 1)
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="הקובץ גדול מדי")
    run_dir = Path(tempfile.mkdtemp(prefix="directory_"))
    try:
        path = run_dir / "directory.xlsx"
        path.write_bytes(content)
        try:
            records, problems = school_directory.parse_ministry_rows(school_directory.read_xlsx_rows(path))
        except Exception as exc:
            logger.warning("directory preview: unreadable file: %s", exc)
            raise HTTPException(status_code=400, detail="לא ניתן לקרוא את הקובץ")
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    if problems:
        raise HTTPException(status_code=400, detail={"code": "invalid_file", "problems": problems[:50]})

    db = get_admin_client()
    stats = school_directory.diff_directory(school_directory.fetch_all_directory(db), records)
    stats["placeholder_phones"] = sum(1 for r in records if r["phone"] and not r["phone_valid"])
    import_id = str(uuid.uuid4())
    storage_key = f"directory-imports/{import_id}.xlsx"
    db.storage.from_(STORAGE_BUCKET).upload(
        storage_key, content,
        {"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    db.table("school_directory_imports").insert({
        "id": import_id, "kind": "directory", "uploaded_by": user["id"], "file_name": file.filename,
        "storage_key": storage_key, "stats": stats, "status": "previewed",
    }).execute()
    return {"import_id": import_id, "stats": stats}


@router.post("/admin/publish/{import_id}")
def admin_publish(import_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    db = get_admin_client()
    rows = db.table("school_directory_imports").select("*").eq("id", import_id).eq("kind", "directory").execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="ההעלאה לא נמצאה")
    imp = rows[0]
    if imp["status"] != "previewed":
        raise HTTPException(status_code=400, detail="ההעלאה הזו כבר פורסמה")
    run_dir = Path(tempfile.mkdtemp(prefix="directory_"))
    try:
        path = run_dir / "directory.xlsx"
        path.write_bytes(db.storage.from_(STORAGE_BUCKET).download(imp["storage_key"]))
        records, problems = school_directory.parse_ministry_rows(school_directory.read_xlsx_rows(path))
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    if problems:
        raise HTTPException(status_code=400, detail={"code": "invalid_file", "problems": problems[:50]})
    result = school_directory.publish(db, records, imp.get("file_name") or "")
    db.table("school_directory_imports").update({
        "status": "published", "published_at": datetime.now(timezone.utc).isoformat(),
        "stats": {**(imp.get("stats") or {}), "publish_result": result},
    }).eq("id", import_id).execute()
    return result


class OrgDirectoryIn(BaseModel):
    enabled: bool


@router.put("/admin/orgs/{org_id}")
def admin_set_org(org_id: str, body: OrgDirectoryIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_superadmin(user)
    db = get_admin_client()
    res = db.table("organizations").update({"directory_enabled": body.enabled}).eq("id", org_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="הארגון לא נמצא")
    return {"enabled": body.enabled}


@router.post("/admin/orgs/{org_id}/link")
def admin_link_org(org_id: str, user: Annotated[dict, Depends(get_current_user)], apply: bool = False):
    _require_superadmin(user)
    db = get_admin_client()
    if not db.table("organizations").select("id").eq("id", org_id).execute().data:
        raise HTTPException(status_code=404, detail="הארגון לא נמצא")
    return school_directory.link_existing_org_schools(db, org_id, apply, user["id"])


@router.post("/org-import")
def org_import(
    user: Annotated[dict, Depends(get_current_user)],
    file: UploadFile = File(...),
    apply: bool = Form(False),
    rights_confirmed: bool = Form(False),
):
    """An org's own file (by "סמל מוסד") into its own directory copies. The org confirms it may
    use the data; who, when and which file are recorded. Never changes the org's clients."""
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")
    if not rights_confirmed:
        raise HTTPException(status_code=400, detail="יש לאשר שלארגון יש זכות להשתמש בנתונים שבקובץ")
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="יש להעלות קובץ אקסל (xlsx)")
    db = get_admin_client()
    _require_enabled(db, user)
    content = file.file.read(_MAX_UPLOAD_BYTES + 1)
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="הקובץ גדול מדי")
    run_dir = Path(tempfile.mkdtemp(prefix="directory_org_"))
    try:
        path = run_dir / "org.xlsx"
        path.write_bytes(content)
        try:
            records, labels, problems = school_directory.parse_org_import(school_directory.read_xlsx_rows(path))
        except Exception as exc:
            logger.warning("org import: unreadable file: %s", exc)
            raise HTTPException(status_code=400, detail="לא ניתן לקרוא את הקובץ")
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    if problems:
        raise HTTPException(status_code=400, detail={"code": "invalid_file", "problems": problems})

    summary = school_directory.org_import(db, user["org_id"], records, apply, user["id"])
    summary["columns"] = labels
    if apply:
        import_id = str(uuid.uuid4())
        storage_key = f"directory-imports/org/{user['org_id']}/{import_id}.xlsx"
        try:
            db.storage.from_(STORAGE_BUCKET).upload(
                storage_key, content,
                {"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
            )
        except Exception as exc:
            logger.warning("org import: storing the file failed (non-fatal): %s", exc)
            storage_key = None
        db.table("school_directory_imports").insert({
            "id": import_id, "kind": "org", "org_id": user["org_id"], "uploaded_by": user["id"],
            "file_name": file.filename, "storage_key": storage_key, "stats": summary,
            "rights_confirmed": True, "status": "published",
            "published_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    return summary
