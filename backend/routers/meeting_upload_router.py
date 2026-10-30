import logging
import os
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, UploadFile, File, Form

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client
from academic_years import resolve_requested_upload_years
from meeting_upload_logic import build_upload_checklist, compute_upload_comparison, file_type_label
from email_resend import send_resend_email
from logic.file_identifier import identify_file
from logic.gefen_processor import load_gefen
from plan_roster import extract_plan_roster
from zihuy_core import identify, normalize_budget_name
from routers.analyze_router import (
    _detect_gefen_division,
    _normalize_symbol,
    _read_tikhnun_institution_symbols,
    _read_gefen_invoice_dates,
    _read_finance_invoice_dates,
    _tikhnun_year_entry,
    _dated_file_entry,
    _entry_severity,
    _finance_budget_scoped,
    _kesafim_is_unreadable_binary,
)
from routers.schools_router import _create_notifications, _require_school_access_for_meeting_activity

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
            # "both" is a real, informative outcome (a combined file genuinely covering
            # both divisions, common for six-year schools) — kept as-is, not collapsed to
            # None. compute_upload_comparison() in meeting_upload_logic.py is what decides
            # how "both" satisfies per-division checklist items.
            division_type = _detect_gefen_division(df)
        except Exception as exc:
            logger.warning("meeting-upload: gefen division detection failed for %s: %s", path.name, exc)
    elif kind == "tikhnun":
        try:
            roster = extract_plan_roster(str(path))
            budgets = list(roster.keys())
        except Exception as exc:
            logger.warning("meeting-upload: plan roster extraction failed for %s: %s", path.name, exc)
    return {"identified_type": kind, "division_type": division_type, "budgets": budgets}


def _validate_uploaded_file(path: Path, kind: str, expected_year: str, expected_symbol: str | None) -> tuple[str, str | None]:
    """Runs the SAME symbol/year/scope severity model (_entry_severity — "none"/"warn"/
    "block") that the main advisor-facing check-creation flow uses, instead of a separate
    lightweight pass/fail check — keeps this public portal and the main flow from ever
    silently disagreeing on what counts as wrong. Returns (severity, Hebrew message | None).
    This portal has no acknowledgment UI, so the caller treats "warn" as accepted (only
    "block" actually rejects a file) — a deliberate, confirmed product decision."""
    if kind == "tikhnun":
        if expected_symbol:
            found = _read_tikhnun_institution_symbols(path)
            if found and found != {expected_symbol}:
                return "block", "קובץ התכנון שייך לבית ספר אחר (סמל מוסד לא תואם)."
        entry = _tikhnun_year_entry(path, expected_year)
        severity = _entry_severity(entry, expected_year)
        if severity != "none":
            return severity, f"קובץ התכנון אינו תואם את שנת הלימודים {expected_year}."
    elif kind == "gefen":
        entry = _dated_file_entry("gefen", [path.name], _read_gefen_invoice_dates([path]))
        severity = _entry_severity(entry, expected_year)
        if severity != "none":
            return severity, f"קובץ דיווח הביצוע אינו תואם את שנת הלימודים {expected_year}."
    elif kind in ("kesafim2000", "payscool", "schoolcash"):
        if kind == "kesafim2000" and _kesafim_is_unreadable_binary(path):
            return "block", "קובץ הכספים אינו קריא — ודאו שהוא הורד בצורתו המקורית מהמערכת, ללא שינויים."
        if not _finance_budget_scoped([path], kind):
            return "block", "קובץ הכספים כללי ואינו ממוקד לפי תקציב/חטיבה — יש להוריד קובץ ממוקד מתוכנת הכספים."
        entry = _dated_file_entry(kind, [path.name], _read_finance_invoice_dates([path], kind))
        severity = _entry_severity(entry, expected_year)
        if severity != "none":
            return severity, f"קובץ הכספים אינו תואם את שנת הלימודים {expected_year}."
    return "none", None


def _reclassify_gefen_budgets(meeting_id: str, academic_year: str) -> None:
    """Background task: runs the real identify() engine (the same one the main
    check-creation flow trusts) once per still-unconfirmed gefen/doch file uploaded for
    this meeting+year, cross-referencing it against every tikhnun/plan file uploaded so
    far for the SAME meeting+year (never across meetings/links). Scoped per-file (not one
    combined identify() call) to avoid touching zihuy_core.py's shared row-dedup logic,
    which has no per-source-file provenance today. Never raises — a failure just leaves
    budgets unconfirmed for this cycle; this task is re-triggered the next time a new
    tikhnun or gefen file is saved for this meeting+year, so it's naturally retried."""
    try:
        db = get_admin_client()
        rows_res = (
            db.table("meeting_upload_files")
            .select("id, storage_key, original_filename, identified_type, budgets")
            .eq("meeting_id", meeting_id).eq("academic_year", academic_year)
            .in_("identified_type", ["tikhnun", "gefen"])
            .execute()
        )
        rows = rows_res.data or []
        tikhnun_rows = [r for r in rows if r["identified_type"] == "tikhnun"]
        gefen_rows = [r for r in rows if r["identified_type"] == "gefen" and not r.get("budgets")]
        if not tikhnun_rows or not gefen_rows:
            return

        run_dir = Path(tempfile.mkdtemp(prefix=f"meetingupload_reclassify_{meeting_id}_"))
        try:
            plan_paths = []
            for r in tikhnun_rows:
                dest = run_dir / f"plan_{r['id']}_{r['original_filename']}"
                try:
                    dest.write_bytes(db.storage.from_("check-files").download(r["storage_key"]))
                    plan_paths.append(dest)
                except Exception as exc:
                    logger.warning("meeting-upload: failed to download plan file %s for reclassification: %s", r["original_filename"], exc)
            if not plan_paths:
                return

            for r in gefen_rows:
                dest = run_dir / f"gefen_{r['id']}_{r['original_filename']}"
                budgets: list[str] = []
                try:
                    dest.write_bytes(db.storage.from_("check-files").download(r["storage_key"]))
                    results_clean, _warnings, _missing, _all = identify([str(dest)], [str(p) for p in plan_paths], academic_year)
                    budgets = sorted({normalize_budget_name(row["budget"]) for row in results_clean if row.get("budget")})
                except Exception as exc:
                    logger.warning("meeting-upload: identify() failed for %s (non-fatal): %s", r["original_filename"], exc)
                try:
                    db.table("meeting_upload_files").update({"budgets": budgets}).eq("id", r["id"]).execute()
                except Exception as exc:
                    logger.warning("meeting-upload: failed to save classified budgets for %s: %s", r["original_filename"], exc)
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)
    except Exception as exc:
        logger.warning("meeting-upload: gefen budget reclassification failed (non-fatal): %s", exc)


def _require_meeting_access(db, user: dict, meeting_id: str, extra_select: str = "") -> dict:
    """Resolves meeting_id -> its school -> org_id and reuses
    schools_router._require_school_access_for_meeting_activity to enforce the org +
    advisor-assignment check — service_role bypasses RLS, so this is the only thing
    standing between a user and another org's meeting. Returns the meeting row (including
    extra_select fields) on success. A missing meeting and a meeting belonging to a
    different org both come back as the same 404 "הפגישה לא נמצאה" — never reveal to the
    caller that a different org's meeting_id exists. Only used by the AUTHENTICATED
    advisor/manager endpoints below — the public /public/meeting-upload/{token} endpoints
    are intentionally unauthenticated and scoped by the magic-link token instead."""
    select_fields = f"id, school_id{(', ' + extra_select) if extra_select else ''}"
    meeting_res = db.table("meetings").select(select_fields).eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
    meeting = meeting_res.data[0]
    try:
        _require_school_access_for_meeting_activity(db, user, meeting["school_id"])
    except HTTPException as exc:
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
        raise
    return meeting


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

    meeting_res = db.table("meetings").select("id, school_id, meeting_date, academic_year, requested_upload_years").eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
    meeting = meeting_res.data[0]

    school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
    if not school_res.data:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_res.data[0]

    upload_years = resolve_requested_upload_years(meeting)

    files_res = db.table("meeting_upload_files").select(
        "original_filename, identified_type, division_type, budgets, academic_year, uploaded_at"
    ).eq("meeting_id", meeting_id).order("uploaded_at").execute()
    all_uploaded = files_res.data or []

    years_out = []
    for year in upload_years:
        checklist = build_upload_checklist(db, school, year)
        uploaded_for_year = [f for f in all_uploaded if f.get("academic_year") == year]
        comparison = compute_upload_comparison(checklist, uploaded_for_year)
        # budgets is None (not yet attempted) vs [] (attempted, found nothing — final) —
        # only None means the background reclassification task might still improve this,
        # so the frontend keeps polling while any gefen file is still in that state.
        gefen_budgets_pending = any(
            f.get("identified_type") == "gefen" and f.get("budgets") is None
            for f in uploaded_for_year
        )
        years_out.append({
            "academic_year": year,
            "items": [{"label": i["label"], "received": i["received"]} for i in comparison["items"]],
            "all_received": comparison["all_received"],
            "no_baseline_this_year": checklist["no_baseline_this_year"],
            "already_uploaded": [{"original_filename": f["original_filename"]} for f in uploaded_for_year],
            "gefen_budgets_pending": gefen_budgets_pending,
        })

    return {
        "school_name": school["name"],
        "meeting_date": meeting["meeting_date"],
        "years": years_out,
    }


@router.post("/public/meeting-upload/{token}/files")
async def upload_meeting_files(
    token: str,
    background_tasks: BackgroundTasks,
    academic_year: str = Form(...),
    commit: bool = Form(False),
    files: list[UploadFile] = File(...),
):
    """commit=False (the default "בדוק קבצים" step): validates every submitted file and
    returns a per-file status WITHOUT saving anything — no Storage write, no DB insert, no
    advisor notification. commit=True ("שלח חלקית"/final send): re-validates (never trusts
    a stale client-side result) and actually saves whatever passes. Both paths share the
    same validation/classification code so they can never drift apart."""
    db = get_admin_client()
    token_row = _get_valid_token(db, token)
    meeting_id = token_row["meeting_id"]

    meeting_res = db.table("meetings").select("id, school_id, meeting_date, academic_year, requested_upload_years, participants").eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
    meeting = meeting_res.data[0]

    upload_years = resolve_requested_upload_years(meeting)
    if academic_year not in upload_years:
        raise HTTPException(status_code=400, detail="שנת לימודים לא תקינה עבור פגישה זו")

    school_res = db.table("schools").select("id, name, stage, finance_software, symbol").eq("id", meeting["school_id"]).execute()
    school = school_res.data[0] if school_res.data else {"id": meeting["school_id"], "name": ""}
    expected_symbol = _normalize_symbol(school.get("symbol"))

    run_dir = Path(tempfile.mkdtemp(prefix=f"meetingupload_{meeting_id}_"))
    saved_rows = []
    rejected = []
    file_results = []
    try:
        for uf in files:
            dest = run_dir / uf.filename
            dest.write_bytes(await uf.read())
            classification = _classify_uploaded_file(dest)
            kind = classification["identified_type"]
            severity, message = _validate_uploaded_file(dest, kind, academic_year, expected_symbol) if kind else ("block", "סוג הקובץ לא זוהה.")
            # "warn" has no acknowledgment UI on this public portal — treated as valid.
            is_valid = severity != "block"
            file_results.append({"filename": uf.filename, "kind": kind, "valid": is_valid, "reason": None if is_valid else message})
            if not is_valid:
                rejected.append({"filename": uf.filename, "reason": message})
                continue
            if not commit:
                continue
            storage_key = f"meeting-uploads/{meeting_id}/{secrets.token_hex(8)}{dest.suffix}"
            try:
                db.storage.from_("check-files").upload(storage_key, dest.read_bytes())
            except Exception as exc:
                logger.error("meeting-upload: storage upload failed for %s: %s", uf.filename, exc)
                rejected.append({"filename": uf.filename, "reason": "שגיאה בהעלאת הקובץ לאחסון — נסו שוב."})
                file_results[-1] = {**file_results[-1], "valid": False, "reason": "שגיאה בהעלאת הקובץ לאחסון — נסו שוב."}
                continue
            row = {
                "meeting_id": meeting_id,
                "token_id": token_row["id"],
                "storage_key": storage_key,
                "original_filename": uf.filename,
                "academic_year": academic_year,
                **classification,
            }
            db.table("meeting_upload_files").insert(row).execute()
            saved_rows.append(row)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)

    checklist = build_upload_checklist(db, school, academic_year)
    all_files_res = db.table("meeting_upload_files").select(
        "identified_type, division_type, budgets"
    ).eq("meeting_id", meeting_id).eq("academic_year", academic_year).execute()
    comparison = compute_upload_comparison(checklist, all_files_res.data or [])

    if saved_rows:
        try:
            secretary = next((p for p in (meeting.get("participants") or []) if p.get("key") in ("secretary", "finance")), None)
            _notify_advisors_files_arrived(
                db, meeting_id, meeting["school_id"],
                secretary_name=(secretary or {}).get("name") or "המנהלנית",
                school_name=school.get("name", ""),
                meeting_date=meeting["meeting_date"],
                academic_year=academic_year,
            )
        except Exception as exc:
            logger.warning("meeting-upload: advisor notification failed (non-fatal): %s", exc)
        # Real per-budget gefen classification runs in the background (it parses full
        # Excel workbooks via the same identify() engine the main check flow uses) —
        # the response below reflects pre-classification state; the frontend polls
        # GET /public/meeting-upload/{token} (gefen_budgets_pending) until it settles.
        if any(r["identified_type"] in ("tikhnun", "gefen") for r in saved_rows):
            background_tasks.add_task(_reclassify_gefen_budgets, meeting_id, academic_year)

    return {
        "ok": True,
        "committed": commit,
        "received": len(saved_rows),
        "rejected": rejected,
        "files": file_results,
        "items": [{"label": i["label"], "received": i["received"]} for i in comparison["items"]],
        "all_received": comparison["all_received"],
        "gefen_division_unclear": comparison.get("gefen_division_unclear", False),
    }


def _notify_advisors_files_arrived(db, meeting_id: str, school_id: str, secretary_name: str, school_name: str, meeting_date: str, academic_year: str | None = None):
    from datetime import date
    meeting_res = db.table("meetings").select("advisor_ids, advisor_id").eq("id", meeting_id).execute()
    meeting = meeting_res.data[0] if meeting_res.data else {}
    advisor_ids = meeting.get("advisor_ids") or ([meeting["advisor_id"]] if meeting.get("advisor_id") else [])
    if not advisor_ids:
        school_advisors = db.table("advisor_schools").select("advisor_id").eq("school_id", school_id).execute()
        advisor_ids = [r["advisor_id"] for r in (school_advisors.data or [])]
    if not advisor_ids:
        return
    date_fmt = date.fromisoformat(meeting_date).strftime("%d/%m/%y")
    year_suffix = f" — שנת לימודים {academic_year}" if academic_year else ""
    title = f"התקבלו קבצים מ{secretary_name} לקראת הפגישה עם בית הספר {school_name} ב{date_fmt}{year_suffix}"
    notif_rows = [{
        "recipient_id": aid,
        "type": "meeting_files_arrived",
        "school_id": school_id,
        "ref_id": meeting_id,
        "data": {"title": title, "academic_year": academic_year},
    } for aid in advisor_ids]
    _create_notifications(db, notif_rows, pref_key="notify_meeting_files_arrived")


# ---------------------------------------------------------------------------
# Authenticated endpoints — advisor/manager side
# ---------------------------------------------------------------------------

@router.get("/schools/meetings/{meeting_id}/upload-comparison")
def get_upload_comparison(meeting_id: str, user: Annotated[dict, Depends(get_current_user)], academic_year: str | None = None):
    for attempt in range(2):
        try:
            db = get_admin_client()
            meeting = _require_meeting_access(db, user, meeting_id, "meeting_date, academic_year, requested_upload_years")
            year = academic_year or resolve_requested_upload_years(meeting)[0]

            school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
            school = school_res.data[0]

            checklist = build_upload_checklist(db, school, year)
            files_res = db.table("meeting_upload_files").select("identified_type, division_type, budgets").eq("meeting_id", meeting_id).eq("academic_year", year).execute()
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


@router.get("/schools/meetings/{meeting_id}/uploaded-files")
def get_uploaded_files(meeting_id: str, user: Annotated[dict, Depends(get_current_user)], academic_year: str | None = None):
    for attempt in range(2):
        try:
            db = get_admin_client()
            _require_meeting_access(db, user, meeting_id)
            query = db.table("meeting_upload_files").select(
                "id, original_filename, identified_type, division_type, budgets, uploaded_at"
            ).eq("meeting_id", meeting_id)
            if academic_year:
                query = query.eq("academic_year", academic_year)
            files_res = query.order("uploaded_at").execute()
            return [{
                "id": f["id"],
                "filename": f["original_filename"],
                "type_label": file_type_label(f.get("identified_type"), f.get("division_type"), f.get("budgets")),
                "uploaded_at": f["uploaded_at"],
            } for f in (files_res.data or [])]
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("get_uploaded_files failed (non-fatal): %s", exc)
                return []


@router.get("/schools/meetings/{meeting_id}/uploaded-files/{file_id}/download")
def download_uploaded_file(meeting_id: str, file_id: str, user: Annotated[dict, Depends(get_current_user)]):
    db = get_admin_client()
    _require_meeting_access(db, user, meeting_id)
    file_res = db.table("meeting_upload_files").select("storage_key, original_filename").eq("id", file_id).eq("meeting_id", meeting_id).execute()
    if not file_res.data:
        raise HTTPException(status_code=404, detail="הקובץ לא נמצא")
    row = file_res.data[0]
    try:
        content = db.storage.from_("check-files").download(row["storage_key"])
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"שגיאה בהורדת הקובץ: {exc}")
    # HTTP headers must be ASCII — a raw Hebrew filename in Content-Disposition
    # breaks the response entirely. RFC 5987's filename* handles non-ASCII names
    # correctly (with an ASCII fallback for older clients).
    import urllib.parse
    ext = Path(row["original_filename"]).suffix or ".xlsx"
    ascii_fallback = f"file{ext}"
    encoded_name = urllib.parse.quote(row["original_filename"])
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded_name}"},
    )


@router.post("/schools/meetings/{meeting_id}/request-missing-files")
def request_missing_files(meeting_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """The one manual button in this feature — sends a targeted follow-up
    email to the secretary/finance contact naming exactly the missing items."""
    db = get_admin_client()
    meeting = _require_meeting_access(db, user, meeting_id, "participants, meeting_date, academic_year, requested_upload_years, advisor_ids")

    school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
    school = school_res.data[0]

    upload_years = resolve_requested_upload_years(meeting)
    multi_year = len(upload_years) > 1
    missing_items = []
    for year in upload_years:
        checklist = build_upload_checklist(db, school, year)
        files_res = db.table("meeting_upload_files").select("identified_type, division_type, budgets").eq("meeting_id", meeting_id).eq("academic_year", year).execute()
        comparison = compute_upload_comparison(checklist, files_res.data or [])
        missing_items += [
            (f'{i["label"]} — {year}' if multi_year else i["label"])
            for i in comparison["items"] if not i["received"]
        ]
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

    # Replies go to the meeting's first advisor with an email, falling back to the clicking user.
    reply_to = None
    advisor_ids = meeting.get("advisor_ids") or []
    if advisor_ids:
        try:
            p_res = db.table("profiles").select("id, email").in_("id", advisor_ids).execute()
            emails_map = {p["id"]: (p.get("email") or "").strip() for p in (p_res.data or [])}
            reply_to = next((emails_map[aid] for aid in advisor_ids if emails_map.get(aid)), None)
        except Exception as exc:
            logger.warning("request_missing_files: advisor email lookup failed (non-fatal): %s", exc)
    reply_to = reply_to or (user.get("email") or "").strip() or None

    sent, failed_count = 0, 0
    for p in recipients:
        email_addr = p["email"].strip()
        status, error = "sent", None
        try:
            send_resend_email(email_addr, "חסרים קבצים לפגישה הקרובה", html, reply_to=reply_to)
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
