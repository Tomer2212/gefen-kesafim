import logging
import os
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client
from meeting_upload_logic import build_upload_checklist, compute_upload_comparison
from email_resend import send_resend_email
from logic.file_identifier import identify_file
from logic.gefen_processor import load_gefen
from plan_roster import extract_plan_roster
from routers.analyze_router import _detect_gefen_division
from routers.schools_router import _create_notifications

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOAD_GRACE_DAYS = 3


def _classify_uploaded_file(path: Path) -> dict:
    """Lightweight classification only — never runs the real reconciliation."""
    kind = identify_file(str(path))
    division_type = None
    budgets = None
    if kind == "gefen":
        try:
            df, _ = load_gefen(str(path))
            div = _detect_gefen_division(df)
            division_type = None if div == "both" else div
        except Exception as exc:
            logger.warning("meeting-upload: gefen division detection failed for %s: %s", path.name, exc)
    elif kind == "tikhnun":
        try:
            roster = extract_plan_roster(str(path))
            budgets = list(roster.keys())
        except Exception as exc:
            logger.warning("meeting-upload: plan roster extraction failed for %s: %s", path.name, exc)
    return {"identified_type": kind, "division_type": division_type, "budgets": budgets}


def _get_valid_token(db, token: str) -> dict:
    res = db.table("meeting_upload_tokens").select("*").eq("token", token).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="קישור לא נמצא")
    row = res.data[0]
    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="פג תוקפו של קישור זה")
    return row


# ---------------------------------------------------------------------------
# Public (unauthenticated) endpoints — accessed via the magic link
# ---------------------------------------------------------------------------

@router.get("/public/meeting-upload/{token}")
def get_meeting_upload_checklist(token: str):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)
    meeting_id = token_row["meeting_id"]

    meeting_res = db.table("meetings").select("id, school_id, meeting_date, academic_year").eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
    meeting = meeting_res.data[0]

    school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]

    checklist = build_upload_checklist(db, school, meeting.get("academic_year"))

    files_res = db.table("meeting_upload_files").select("original_filename, identified_type, uploaded_at").eq("meeting_id", meeting_id).order("uploaded_at").execute()

    return {
        "school_name": school["name"],
        "meeting_date": meeting["meeting_date"],
        "checklist_items": [i["label"] for i in checklist["items"]],
        "no_baseline_this_year": checklist["no_baseline_this_year"],
        "already_uploaded": files_res.data or [],
    }


@router.post("/public/meeting-upload/{token}/files")
async def upload_meeting_files(token: str, files: list[UploadFile] = File(...)):
    db = get_admin_client()
    token_row = _get_valid_token(db, token)
    meeting_id = token_row["meeting_id"]

    meeting_res = db.table("meetings").select("id, school_id").eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")

    run_dir = Path(tempfile.mkdtemp(prefix=f"meetingupload_{meeting_id}_"))
    saved_rows = []
    try:
        for uf in files:
            dest = run_dir / uf.filename
            dest.write_bytes(await uf.read())
            classification = _classify_uploaded_file(dest)
            storage_key = f"meeting-uploads/{meeting_id}/{secrets.token_hex(8)}{dest.suffix}"
            try:
                db.storage.from_("check-files").upload(storage_key, dest.read_bytes())
            except Exception as exc:
                logger.error("meeting-upload: storage upload failed for %s: %s", uf.filename, exc)
                continue
            row = {
                "meeting_id": meeting_id,
                "token_id": token_row["id"],
                "storage_key": storage_key,
                "original_filename": uf.filename,
                **classification,
            }
            db.table("meeting_upload_files").insert(row).execute()
            saved_rows.append(row)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)

    try:
        _notify_advisors_files_arrived(db, meeting_id, meeting_res.data[0]["school_id"])
    except Exception as exc:
        logger.warning("meeting-upload: advisor notification failed (non-fatal): %s", exc)

    return {"ok": True, "received": len(saved_rows)}


def _notify_advisors_files_arrived(db, meeting_id: str, school_id: str):
    meeting_res = db.table("meetings").select("advisor_ids, advisor_id").eq("id", meeting_id).execute()
    meeting = meeting_res.data[0] if meeting_res.data else {}
    advisor_ids = meeting.get("advisor_ids") or ([meeting["advisor_id"]] if meeting.get("advisor_id") else [])
    if not advisor_ids:
        school_advisors = db.table("advisor_schools").select("advisor_id").eq("school_id", school_id).execute()
        advisor_ids = [r["advisor_id"] for r in (school_advisors.data or [])]
    if not advisor_ids:
        return
    notif_rows = [{
        "recipient_id": aid,
        "type": "meeting_files_arrived",
        "school_id": school_id,
        "data": {
            "title": "התקבלו קבצים לפגישה",
            "deeplink": f"/school/{school_id}?meeting={meeting_id}",
        },
    } for aid in advisor_ids]
    _create_notifications(db, notif_rows, pref_key="notify_meeting_files_arrived")


# ---------------------------------------------------------------------------
# Authenticated endpoints — advisor/manager side
# ---------------------------------------------------------------------------

@router.get("/schools/meetings/{meeting_id}/upload-comparison")
def get_upload_comparison(meeting_id: str, user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            meeting_res = db.table("meetings").select("id, school_id, academic_year").eq("id", meeting_id).execute()
            if not meeting_res.data:
                raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
            meeting = meeting_res.data[0]

            school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
            school = school_res.data[0]

            checklist = build_upload_checklist(db, school, meeting.get("academic_year"))
            files_res = db.table("meeting_upload_files").select("identified_type, division_type, budgets").eq("meeting_id", meeting_id).execute()
            comparison = compute_upload_comparison(checklist, files_res.data or [])
            return comparison
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_upload_comparison attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.3)
            else:
                logger.error("get_upload_comparison failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת")


@router.post("/schools/meetings/{meeting_id}/request-missing-files")
def request_missing_files(meeting_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """The one manual button in this feature — sends a targeted follow-up
    email to the secretary/finance contact naming exactly the missing items."""
    db = get_admin_client()
    meeting_res = db.table("meetings").select("id, school_id, participants, meeting_date").eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
    meeting = meeting_res.data[0]

    school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
    school = school_res.data[0]

    checklist = build_upload_checklist(db, school, None)
    files_res = db.table("meeting_upload_files").select("identified_type, division_type, budgets").eq("meeting_id", meeting_id).execute()
    comparison = compute_upload_comparison(checklist, files_res.data or [])
    missing_items = [i["label"] for i in comparison["items"] if not i["received"]]
    if not missing_items:
        raise HTTPException(status_code=400, detail="כל הקבצים הנדרשים כבר התקבלו")

    recipients = [p for p in (meeting.get("participants") or []) if p.get("key") in ("secretary", "finance") and (p.get("email") or "").strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="לא נמצא איש קשר עם מייל למזכירה/אחראית כספים בפגישה זו")

    token_row = db.table("meeting_upload_tokens").select("token").eq("meeting_id", meeting_id).order("created_at", desc=True).execute()
    if not token_row.data:
        raise HTTPException(status_code=400, detail="לא נמצא קישור העלאה פעיל לפגישה זו")
    upload_url = f"{os.getenv('APP_URL', '')}/upload/{token_row.data[0]['token']}"

    items_html = "".join(f"<li>{item}</li>" for item in missing_items)
    html = f"""
<html><body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b;">
<p>שלום,</p>
<p>קיבלנו חלק מהקבצים לפגישה הקרובה בבית הספר <b>{school['name']}</b> — תודה!
מתברר שעדיין חסרים הקבצים הבאים:</p>
<ul>{items_html}</ul>
<p>נשמח אם תוכלו להעלות רק את אלה בקישור: <a href="{upload_url}">{upload_url}</a></p>
</body></html>"""

    sent, failed_count = 0, 0
    for p in recipients:
        email_addr = p["email"].strip()
        status, error = "sent", None
        try:
            send_resend_email(email_addr, "חסרים קבצים לפגישה הקרובה", html)
            sent += 1
        except Exception as exc:
            status, error = "failed", str(exc)
            failed_count += 1
            logger.warning("request_missing_files: failed to email %s: %s", email_addr, exc)
        db.table("meeting_upload_followups").insert({
            "meeting_id": meeting_id,
            "school_id": meeting["school_id"],
            "recipient_email": email_addr,
            "missing_items": missing_items,
            "status": status,
            "error_message": error,
            "sent_by": user["id"],
        }).execute()

    return {"ok": True, "sent": sent, "failed": failed_count, "missing_items": missing_items}
