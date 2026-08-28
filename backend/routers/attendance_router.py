"""שעון נוכחות — דיווח נוכחות יומי לכל עובד (advisor/manager) + מסך ניהול.

Data model (see CLAUDE.md's Supabase migration checklist — already run, verified):
- attendance_entries: שורה אחת ליום לעובד (UNIQUE(user_id, entry_date)).
- attendance_month_locks: קיום שורה (user_id, month='YYYY-MM') = החודש נעול לעריכה.
- attendance_audit_log: עקבות שינויים (דרישת תיקון 24) — create/update/delete/lock/unlock/file_add/file_remove.

כל הגישה דרך service_role (RLS נעקף); בקרת הגישה האמיתית כאן ב-Python: org_id + בעלות + role.
העובד עורך רק את הרשומות שלו (/my). מנהל (owner/manager) עורך/נועל דרך /admin.
קבצי נוכחות נשמרים ב-Supabase Storage bucket "check-files" תחת attendance/{user_id}/{date}/...
ואינם נכללים בניקוי האוטומטי של main.py (חובה משפטית לשמור לצמיתות).
"""
import calendar
import logging
import secrets
import shutil
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

DAY_TYPES = {"work_home", "field", "vacation", "sick", "reserve", "other"}
WORK_TYPES = {"work_home", "field"}
ALLOWED_FILE_EXT = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_BYTES = 10 * 1024 * 1024
STORAGE_BUCKET = "check-files"
STAFF_ROLES = ("advisor", "manager")


# ── Pydantic ──────────────────────────────────────────────────────────────────
class AttendanceDayIn(BaseModel):
    day_type: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    notes: str | None = None


class LockIn(BaseModel):
    user_id: str
    month: str  # 'YYYY-MM'


# ── helpers ───────────────────────────────────────────────────────────────────
def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


def _parse_date(date_str: str) -> date:
    try:
        return date.fromisoformat(date_str)
    except Exception:
        raise HTTPException(status_code=400, detail="תאריך לא תקין")


def _parse_month(month: str) -> tuple[str, str]:
    """'YYYY-MM' → (first_day_iso, first_day_of_next_month_iso) for range queries."""
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
        if not (1 <= m <= 12):
            raise ValueError
    except Exception:
        raise HTTPException(status_code=400, detail="חודש לא תקין (נדרש YYYY-MM)")
    start = date(y, m, 1)
    last_day = calendar.monthrange(y, m)[1]
    nxt = date(y, m, last_day) + timedelta(days=1)
    return start.isoformat(), nxt.isoformat()


def _hhmm_to_min(v: str | None) -> int | None:
    if not v:
        return None
    try:
        h, mm = v.split(":")
        h, mm = int(h), int(mm)
        if not (0 <= h <= 23 and 0 <= mm <= 59):
            return None
        return h * 60 + mm
    except Exception:
        return None


def _compute_work_minutes(start: str | None, end: str | None) -> int | None:
    a, b = _hhmm_to_min(start), _hhmm_to_min(end)
    if a is None or b is None:
        return None
    diff = b - a
    if diff <= 0:  # crosses midnight
        diff += 1440
    return diff


def _norm_time(v: str | None) -> str | None:
    m = _hhmm_to_min(v)
    if m is None:
        return None
    return f"{m // 60:02d}:{m % 60:02d}"


def _is_month_locked(db, user_id: str, month: str) -> bool:
    try:
        res = (
            db.table("attendance_month_locks")
            .select("id")
            .eq("user_id", user_id)
            .eq("month", month)
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception as exc:
        logger.warning("_is_month_locked failed (treating as unlocked): %s", exc)
        return False


def _lock_info(db, user_id: str, month: str) -> dict:
    try:
        res = (
            db.table("attendance_month_locks")
            .select("locked_at, locked_by")
            .eq("user_id", user_id)
            .eq("month", month)
            .limit(1)
            .execute()
        )
        if not res.data:
            return {"locked": False, "locked_at": None, "locked_by_name": None}
        row = res.data[0]
        name = None
        try:
            p = (
                db.table("profiles")
                .select("full_name, email")
                .eq("id", row["locked_by"])
                .limit(1)
                .execute()
            )
            if p.data:
                name = p.data[0].get("full_name") or p.data[0].get("email")
        except Exception as exc:
            logger.warning("_lock_info name lookup failed (non-fatal): %s", exc)
        return {"locked": True, "locked_at": row.get("locked_at"), "locked_by_name": name}
    except Exception as exc:
        logger.warning("_lock_info failed (non-fatal): %s", exc)
        return {"locked": False, "locked_at": None, "locked_by_name": None}


def _audit(db, *, org_id, entry_id, target_user_id, actor_id, action, diff=None):
    """Best-effort audit trail write. Logs on failure but never blocks the primary op."""
    try:
        db.table("attendance_audit_log").insert({
            "org_id": org_id,
            "entry_id": entry_id,
            "target_user_id": target_user_id,
            "actor_id": actor_id,
            "action": action,
            "diff": diff,
        }).execute()
    except Exception as exc:
        logger.error("attendance audit write failed (%s / %s): %s", action, target_user_id, exc)


def _diff_entry(old: dict | None, new: dict) -> dict:
    fields = ["day_type", "start_time", "end_time", "notes", "work_minutes"]
    out = {}
    old = old or {}
    for f in fields:
        ov, nv = old.get(f), new.get(f)
        if ov != nv:
            out[f] = [ov, nv]
    return out


def _summary(entries: list[dict]) -> dict:
    total = 0
    work_days = sick = reserve = vacation = 0
    for e in entries:
        dt = e.get("day_type")
        if dt == "sick":
            sick += 1
        elif dt == "reserve":
            reserve += 1
        elif dt == "vacation":
            vacation += 1
        if dt in WORK_TYPES and e.get("start_time") and e.get("end_time"):
            wm = e.get("work_minutes")
            if wm is None:
                wm = _compute_work_minutes(e.get("start_time"), e.get("end_time")) or 0
            total += wm
            work_days += 1
    return {
        "total_work_minutes": total,
        "work_days": work_days,
        "sick_days": sick,
        "reserve_days": reserve,
        "vacation_days": vacation,
        "avg_minutes_per_day": round(total / work_days) if work_days else 0,
    }


def _fetch_entry(db, user_id: str, org_id: str, date_str: str) -> dict | None:
    res = (
        db.table("attendance_entries")
        .select("*")
        .eq("user_id", user_id)
        .eq("org_id", org_id)
        .eq("entry_date", date_str)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def _upsert_day(db, *, user_id: str, org_id: str, date_str: str, body: AttendanceDayIn,
                actor_id: str) -> dict:
    """Shared upsert for /my and /admin. Assumes lock already checked by caller."""
    day_type = body.day_type or "work_home"
    if day_type not in DAY_TYPES:
        raise HTTPException(status_code=400, detail="סוג יום לא תקין")
    start_t = _norm_time(body.start_time)
    end_t = _norm_time(body.end_time)
    old = _fetch_entry(db, user_id, org_id, date_str)
    payload = {
        "org_id": org_id,
        "user_id": user_id,
        "entry_date": date_str,
        "day_type": day_type,
        "start_time": start_t,
        "end_time": end_t,
        "work_minutes": _compute_work_minutes(start_t, end_t),
        "notes": (body.notes or None),
        "updated_by": actor_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if old is None:
        payload["created_by"] = actor_id
    row = (
        db.table("attendance_entries")
        .upsert(payload, on_conflict="user_id,entry_date")
        .execute()
    )
    new_row = row.data[0] if row.data else payload
    _audit(
        db, org_id=org_id, entry_id=new_row.get("id"), target_user_id=user_id,
        actor_id=actor_id, action=("create" if old is None else "update"),
        diff=_diff_entry(old, new_row),
    )
    return new_row


def _get_entries_for_month(db, user_id: str, org_id: str, month: str) -> list[dict]:
    start, end = _parse_month(month)
    res = (
        db.table("attendance_entries")
        .select("*")
        .eq("user_id", user_id)
        .eq("org_id", org_id)
        .gte("entry_date", start)
        .lt("entry_date", end)
        .order("entry_date")
        .execute()
    )
    return res.data or []


# ── employee endpoints (/my) ──────────────────────────────────────────────────
@router.get("/my")
def my_attendance(
    user: Annotated[dict, Depends(get_current_user)],
    month: str,
):
    for attempt in range(2):
        try:
            db = get_admin_client()
            entries = _get_entries_for_month(db, user["id"], user["org_id"], month)
            lock = _lock_info(db, user["id"], month)
            return {"entries": entries, "lock": lock}
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("my_attendance attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("my_attendance failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.put("/my/{date_str}")
def upsert_my_day(
    date_str: str,
    body: AttendanceDayIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _parse_date(date_str)
    month = date_str[:7]
    db = get_admin_client()
    if _is_month_locked(db, user["id"], month):
        raise HTTPException(status_code=403, detail="החודש נעול לעריכה")
    return _upsert_day(
        db, user_id=user["id"], org_id=user["org_id"], date_str=date_str,
        body=body, actor_id=user["id"],
    )


@router.delete("/my/{date_str}")
def delete_my_day(
    date_str: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _parse_date(date_str)
    db = get_admin_client()
    if _is_month_locked(db, user["id"], date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול לעריכה")
    old = _fetch_entry(db, user["id"], user["org_id"], date_str)
    if not old:
        return {"ok": True}
    db.table("attendance_entries").delete().eq("id", old["id"]).execute()
    _audit(
        db, org_id=user["org_id"], entry_id=old["id"], target_user_id=user["id"],
        actor_id=user["id"], action="delete", diff=_diff_entry(old, {}),
    )
    return {"ok": True}


# ── file attachments ──────────────────────────────────────────────────────────
def _ensure_entry(db, user_id: str, org_id: str, date_str: str, actor_id: str) -> dict:
    row = _fetch_entry(db, user_id, org_id, date_str)
    if row:
        return row
    res = (
        db.table("attendance_entries")
        .upsert({
            "org_id": org_id, "user_id": user_id, "entry_date": date_str,
            "day_type": "work_home", "files": [], "created_by": actor_id,
            "updated_by": actor_id,
        }, on_conflict="user_id,entry_date")
        .execute()
    )
    return res.data[0]


async def _add_file(db, *, user_id: str, org_id: str, date_str: str, actor_id: str,
                    file: UploadFile) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_FILE_EXT:
        raise HTTPException(status_code=400, detail="סוג קובץ לא נתמך (PDF/JPG/PNG בלבד)")
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="הקובץ גדול מדי (עד 10MB)")
    entry = _ensure_entry(db, user_id, org_id, date_str, actor_id)
    file_id = f"{secrets.token_hex(8)}{suffix}"
    storage_key = f"attendance/{user_id}/{date_str}/{file_id}"
    run_dir = Path(tempfile.mkdtemp(prefix=f"att_{user_id}_"))
    try:
        dest = run_dir / file_id
        dest.write_bytes(data)
        db.storage.from_(STORAGE_BUCKET).upload(storage_key, dest.read_bytes())
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    rec = {
        "id": file_id,
        "key": storage_key,
        "filename": file.filename or file_id,
        "size": len(data),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": actor_id,
    }
    files = list(entry.get("files") or [])
    files.append(rec)
    db.table("attendance_entries").update({
        "files": files, "updated_by": actor_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", entry["id"]).execute()
    _audit(
        db, org_id=org_id, entry_id=entry["id"], target_user_id=user_id,
        actor_id=actor_id, action="file_add", diff={"filename": [None, rec["filename"]]},
    )
    return rec


def _remove_file(db, *, user_id: str, org_id: str, date_str: str, actor_id: str,
                 file_id: str) -> dict:
    entry = _fetch_entry(db, user_id, org_id, date_str)
    if not entry:
        raise HTTPException(status_code=404, detail="לא נמצאה רשומה ליום זה")
    files = list(entry.get("files") or [])
    rec = next((f for f in files if f.get("id") == file_id), None)
    if not rec:
        raise HTTPException(status_code=404, detail="הקובץ לא נמצא")
    try:
        db.storage.from_(STORAGE_BUCKET).remove([rec["key"]])
    except Exception as exc:
        logger.warning("attendance file storage remove failed (non-fatal): %s", exc)
    files = [f for f in files if f.get("id") != file_id]
    db.table("attendance_entries").update({
        "files": files, "updated_by": actor_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", entry["id"]).execute()
    _audit(
        db, org_id=org_id, entry_id=entry["id"], target_user_id=user_id,
        actor_id=actor_id, action="file_remove", diff={"filename": [rec.get("filename"), None]},
    )
    return {"ok": True}


def _download_file(db, *, user_id: str, org_id: str, date_str: str, file_id: str) -> Response:
    entry = _fetch_entry(db, user_id, org_id, date_str)
    rec = None
    if entry:
        rec = next((f for f in (entry.get("files") or []) if f.get("id") == file_id), None)
    if not rec:
        raise HTTPException(status_code=404, detail="הקובץ לא נמצא")
    content = db.storage.from_(STORAGE_BUCKET).download(rec["key"])
    filename = rec.get("filename") or file_id
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.post("/my/{date_str}/files")
async def add_my_file(
    date_str: str,
    user: Annotated[dict, Depends(get_current_user)],
    file: UploadFile = File(...),
):
    _parse_date(date_str)
    db = get_admin_client()
    if _is_month_locked(db, user["id"], date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול לעריכה")
    return await _add_file(
        db, user_id=user["id"], org_id=user["org_id"], date_str=date_str,
        actor_id=user["id"], file=file,
    )


@router.delete("/my/{date_str}/files/{file_id}")
def delete_my_file(
    date_str: str,
    file_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _parse_date(date_str)
    db = get_admin_client()
    if _is_month_locked(db, user["id"], date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול לעריכה")
    return _remove_file(
        db, user_id=user["id"], org_id=user["org_id"], date_str=date_str,
        actor_id=user["id"], file_id=file_id,
    )


@router.get("/my/{date_str}/files/{file_id}")
def download_my_file(
    date_str: str,
    file_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _parse_date(date_str)
    db = get_admin_client()
    return _download_file(
        db, user_id=user["id"], org_id=user["org_id"], date_str=date_str, file_id=file_id,
    )


# ── admin endpoints (/admin) ──────────────────────────────────────────────────
def _assert_same_org_staff(db, org_id: str, target_user_id: str) -> dict:
    res = (
        db.table("profiles")
        .select("id, full_name, email, role, org_id")
        .eq("id", target_user_id)
        .limit(1)
        .execute()
    )
    if not res.data or res.data[0].get("org_id") != org_id:
        raise HTTPException(status_code=404, detail="המשתמש לא נמצא")
    return res.data[0]


@router.get("/admin")
def admin_user_attendance(
    user: Annotated[dict, Depends(get_current_user)],
    user_id: str,
    month: str,
):
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            target = _assert_same_org_staff(db, user["org_id"], user_id)
            entries = _get_entries_for_month(db, user_id, user["org_id"], month)
            lock = _lock_info(db, user_id, month)
            return {
                "entries": entries,
                "lock": lock,
                "user": {"id": target["id"], "full_name": target.get("full_name") or target.get("email")},
            }
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("admin_user_attendance attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("admin_user_attendance failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.get("/admin/all")
def admin_all_attendance(
    user: Annotated[dict, Depends(get_current_user)],
    month: str,
):
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            start, end = _parse_month(month)
            profs = (
                db.table("profiles")
                .select("id, full_name, email, role")
                .eq("org_id", user["org_id"])
                .in_("role", list(STAFF_ROLES))
                .execute()
            ).data or []
            rows = (
                db.table("attendance_entries")
                .select("*")
                .eq("org_id", user["org_id"])
                .gte("entry_date", start)
                .lt("entry_date", end)
                .order("entry_date")
                .execute()
            ).data or []
            by_user: dict[str, list] = {}
            for r in rows:
                by_user.setdefault(r["user_id"], []).append(r)
            locks = set()
            try:
                lk = (
                    db.table("attendance_month_locks")
                    .select("user_id")
                    .eq("org_id", user["org_id"])
                    .eq("month", month)
                    .execute()
                ).data or []
                locks = {x["user_id"] for x in lk}
            except Exception as exc:
                logger.warning("admin_all_attendance lock fetch failed (non-fatal): %s", exc)
            profs.sort(key=lambda p: (p.get("full_name") or p.get("email") or "").lower())
            out = []
            for p in profs:
                ents = by_user.get(p["id"], [])
                out.append({
                    "user": {"id": p["id"], "full_name": p.get("full_name") or p.get("email"), "role": p.get("role")},
                    "entries": ents,
                    "summary": _summary(ents),
                    "locked": p["id"] in locks,
                })
            return {"month": month, "users": out}
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("admin_all_attendance attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("admin_all_attendance failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.put("/admin/{user_id}/{date_str}")
def admin_upsert_day(
    user_id: str,
    date_str: str,
    body: AttendanceDayIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    _parse_date(date_str)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], user_id)
    if _is_month_locked(db, user_id, date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול — יש לשחרר את הנעילה לפני עריכה")
    return _upsert_day(
        db, user_id=user_id, org_id=user["org_id"], date_str=date_str,
        body=body, actor_id=user["id"],
    )


@router.delete("/admin/{user_id}/{date_str}")
def admin_delete_day(
    user_id: str,
    date_str: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    _parse_date(date_str)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], user_id)
    if _is_month_locked(db, user_id, date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול — יש לשחרר את הנעילה לפני עריכה")
    old = _fetch_entry(db, user_id, user["org_id"], date_str)
    if not old:
        return {"ok": True}
    db.table("attendance_entries").delete().eq("id", old["id"]).execute()
    _audit(
        db, org_id=user["org_id"], entry_id=old["id"], target_user_id=user_id,
        actor_id=user["id"], action="delete", diff=_diff_entry(old, {}),
    )
    return {"ok": True}


@router.post("/admin/{user_id}/{date_str}/files")
async def admin_add_file(
    user_id: str,
    date_str: str,
    user: Annotated[dict, Depends(get_current_user)],
    file: UploadFile = File(...),
):
    _require_manager(user)
    _parse_date(date_str)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], user_id)
    if _is_month_locked(db, user_id, date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול — יש לשחרר את הנעילה לפני עריכה")
    return await _add_file(
        db, user_id=user_id, org_id=user["org_id"], date_str=date_str,
        actor_id=user["id"], file=file,
    )


@router.delete("/admin/{user_id}/{date_str}/files/{file_id}")
def admin_delete_file(
    user_id: str,
    date_str: str,
    file_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    _parse_date(date_str)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], user_id)
    if _is_month_locked(db, user_id, date_str[:7]):
        raise HTTPException(status_code=403, detail="החודש נעול — יש לשחרר את הנעילה לפני עריכה")
    return _remove_file(
        db, user_id=user_id, org_id=user["org_id"], date_str=date_str,
        actor_id=user["id"], file_id=file_id,
    )


@router.get("/admin/{user_id}/{date_str}/files/{file_id}")
def admin_download_file(
    user_id: str,
    date_str: str,
    file_id: str,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    _parse_date(date_str)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], user_id)
    return _download_file(
        db, user_id=user_id, org_id=user["org_id"], date_str=date_str, file_id=file_id,
    )


@router.post("/admin/lock")
def lock_month(
    body: LockIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    _parse_month(body.month)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], body.user_id)
    db.table("attendance_month_locks").upsert({
        "org_id": user["org_id"],
        "user_id": body.user_id,
        "month": body.month,
        "locked_by": user["id"],
        "locked_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id,month").execute()
    _audit(
        db, org_id=user["org_id"], entry_id=None, target_user_id=body.user_id,
        actor_id=user["id"], action="lock", diff={"month": [None, body.month]},
    )
    return _lock_info(db, body.user_id, body.month)


@router.delete("/admin/lock")
def unlock_month(
    body: LockIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    _require_manager(user)
    db = get_admin_client()
    _assert_same_org_staff(db, user["org_id"], body.user_id)
    (
        db.table("attendance_month_locks")
        .delete()
        .eq("user_id", body.user_id)
        .eq("month", body.month)
        .execute()
    )
    _audit(
        db, org_id=user["org_id"], entry_id=None, target_user_id=body.user_id,
        actor_id=user["id"], action="unlock", diff={"month": [body.month, None]},
    )
    return {"ok": True, "locked": False}
