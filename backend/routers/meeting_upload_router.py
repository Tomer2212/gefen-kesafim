import base64
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
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client
from academic_years import DEFAULT_ACADEMIC_YEAR, get_academic_year_date_range, resolve_requested_upload_years
from meeting_upload_logic import (
    DIVISION_LABELS,
    UPLOAD_TOKEN_GRACE_DAYS,
    build_upload_checklist,
    compute_upload_comparison,
    file_divisions,
    file_matches_scope,
    file_type_label,
    get_or_create_upload_token,
    reusable_finance_file,
)
from email_resend import send_resend_email
from email_tracking import add_open_pixel, record_email_open
from logic.file_identifier import identify_file
from logic.gefen_processor import load_gefen
from plan_roster import extract_plan_roster
from zihuy_core import identify, normalize_budget_name
from routers.analyze_router import (
    MAX_UPLOAD_SIZE_BYTES,
    _detect_finance_division,
    _detect_gefen_division,
    _detect_tikhnun_division,
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
from routers.schools_router import (
    _create_notifications,
    _gefen_files_slots_for_meeting,
    _participant_role_label,
    _require_school_access_for_meeting_activity,
    _resolve_gefen_files_responsible_for_slot,
    resolve_inherited_year_admin,
)

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOAD_GRACE_DAYS = 3
_TRANSPARENT_GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")


def _classify_uploaded_file(path: Path, academic_year: str | None = None) -> dict:
    """Lightweight classification only — never runs the real reconciliation. division_type is
    what lets one uploaded file serve several recipients' checklists (see file_divisions)."""
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
            division_type = _detect_gefen_division(df, academic_year)
        except Exception as exc:
            logger.warning("meeting-upload: gefen division detection failed for %s: %s", path.name, exc)
    elif kind == "tikhnun":
        division_type = _detect_tikhnun_division(path)
        try:
            roster = extract_plan_roster(str(path))
            budgets = list(roster.keys())
        except Exception as exc:
            logger.warning("meeting-upload: plan roster extraction failed for %s: %s", path.name, exc)
    elif kind in ("kesafim2000", "payscool", "schoolcash"):
        division_type = _detect_finance_division(path, kind, academic_year)
    return {"identified_type": kind, "division_type": division_type, "budgets": budgets}


def _year_validation_result(entry: dict, expected_year: str) -> dict:
    severity = _entry_severity(entry, expected_year)
    detected = entry.get("detected_academic_year")
    if severity == "none":
        message = None
    elif entry["status"] == "recognized":
        message = f"הקובץ שייך לשנת הלימודים {detected}, ונדרשים קבצים של שנת הלימודים {expected_year}."
    else:
        message = f"לא ניתן לזהות שהקובץ שייך לשנת הלימודים {expected_year}."
    return {"severity": severity, "message": message, "status": entry["status"], "detected_academic_year": detected}


def _validate_uploaded_file(path: Path, kind: str, expected_year: str, expected_symbol: str | None) -> dict:
    """Runs the SAME symbol/year/scope severity model (_entry_severity — "none"/"warn"/
    "block") that the main advisor-facing check-creation flow uses, instead of a separate
    lightweight pass/fail check — keeps this public portal and the main flow from ever
    silently disagreeing on what counts as wrong. Returns {severity, message, status,
    detected_academic_year}. This portal has no acknowledgment UI, so the caller treats
    "warn" as accepted (only "block" actually rejects a file) — a deliberate, confirmed
    product decision."""
    def blocked(status: str, message: str) -> dict:
        return {"severity": "block", "message": message, "status": status, "detected_academic_year": None}

    if kind == "tikhnun":
        if expected_symbol:
            found = _read_tikhnun_institution_symbols(path)
            if found and found != {expected_symbol}:
                return blocked("symbol_mismatch", "קובץ התכנון שייך לבית ספר אחר (סמל מוסד לא תואם).")
        return _year_validation_result(_tikhnun_year_entry(path, expected_year), expected_year)
    if kind == "gefen":
        return _year_validation_result(_dated_file_entry("gefen", [path.name], _read_gefen_invoice_dates([path])), expected_year)
    if kind in ("kesafim2000", "payscool", "schoolcash"):
        if kind == "kesafim2000" and _kesafim_is_unreadable_binary(path):
            return blocked("unreadable_raw_file", "קובץ הכספים אינו קריא — ודאו שהוא הורד בצורתו המקורית מהמערכת, ללא שינויים.")
        if not _finance_budget_scoped([path], kind):
            return blocked("unscoped_budget", "קובץ הכספים כללי ואינו ממוקד לפי תקציב/חטיבה — יש להוריד קובץ ממוקד מתוכנת הכספים.")
        return _year_validation_result(_dated_file_entry(kind, [path.name], _read_finance_invoice_dates([path], kind)), expected_year)
    # An unidentified file can never take part in a check — _classify_files() would fail the
    # whole run on it.
    return blocked("unidentified", "קובץ זה לא זוהה כאחד מהקבצים הנדרשים. יש להעלות את קובצי האקסל המקוריים כפי שהורדו מהמערכות, ללא שינויים.")


def _inspect_uploaded_file(path: Path, expected_year: str, expected_symbol: str | None) -> tuple[dict, dict]:
    """Classifies and validates one file, returning (classification, validation). Any failure
    stays with this file: one workbook the parsers choke on must not fail the whole batch,
    which the secretary would see as a generic error with no hint of which file is at fault."""
    try:
        classification = _classify_uploaded_file(path, expected_year)
        return classification, _validate_uploaded_file(path, classification["identified_type"], expected_year, expected_symbol)
    except Exception as exc:
        logger.error("meeting-upload: could not inspect %s: %s", path.name, exc, exc_info=True)
        return (
            {"identified_type": None, "division_type": None, "budgets": None},
            {"severity": "block", "status": "unreadable", "detected_academic_year": None,
             "message": "לא הצלחנו לקרוא את הקובץ. ודאו שזה הקובץ המקורי כפי שהורד מהמערכת, ללא שינויים."},
        )


def _safe_upload_name(filename: str | None) -> str:
    # The name comes straight from an unauthenticated client; .name strips any directory
    # components so it can't escape the temp directory.
    name = Path((filename or "").replace("\x00", "")).name
    return name if name not in ("", ".", "..") else "upload"


def _load_upload_context(token: str) -> tuple[dict, dict, dict]:
    """(token row, meeting, school) for a magic-link upload, with the standard retry so a stale
    pooled connection doesn't reach the secretary as a failed upload."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            token_row = _get_valid_token(db, token)
            meeting_res = db.table("meetings").select("id, school_id, meeting_date, academic_year, requested_upload_years, participants").eq("id", token_row["meeting_id"]).execute()
            if not meeting_res.data:
                raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")
            meeting = meeting_res.data[0]
            school_res = db.table("schools").select("id, name, stage, finance_software, symbol").eq("id", meeting["school_id"]).execute()
            school = school_res.data[0] if school_res.data else {"id": meeting["school_id"], "name": ""}
            return token_row, meeting, school
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("meeting-upload: context load attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("meeting-upload: context load failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסו שוב בעוד מספר שניות")


def _year_date_range_label(academic_year: str) -> str:
    start, end = get_academic_year_date_range(academic_year)
    return f"ספטמבר {start.year} – אוגוסט {end.year}"


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


def _upload_request_recipients(db, meeting: dict, school: dict) -> dict[str, dict]:
    """{email_lower: {"email", "name", "role"}} — who the meeting's file request belongs to.
    Prefers who it was actually logged as sent to. Rows that predate message_type have no such
    record, so fall back to the school's "אחראי/ת קבצי גפן" (all slots, because the cron has
    never narrowed them by stage_scope), then to secretary/finance participants."""
    logged = (
        db.table("meeting_reminders")
        .select("recipient_email, recipient_name, recipient_role, status")
        .eq("meeting_id", meeting["id"]).eq("message_type", "upload_request")
        .execute().data or []
    )
    from_log = {
        r["recipient_email"].strip().lower(): {
            "email": r["recipient_email"].strip(), "name": r.get("recipient_name"), "role": r.get("recipient_role"),
        }
        for r in logged if r.get("status") != "skipped"
    }
    if from_log:
        return from_log

    resolved = {}
    for slot in _gefen_files_slots_for_meeting(school, None):
        contact = _resolve_gefen_files_responsible_for_slot(school, slot)
        if contact and contact.get("email"):
            resolved[contact["email"].strip().lower()] = {
                "email": contact["email"].strip(), "name": contact.get("name"), "role": contact.get("role_label"),
            }
    if resolved:
        return resolved

    return {
        p["email"].strip().lower(): {
            "email": p["email"].strip(), "name": p.get("name"), "role": _participant_role_label(p, school),
        }
        for p in (meeting.get("participants") or [])
        if p.get("key") in ("secretary", "finance") and (p.get("email") or "").strip()
    }


def _recipient_scopes(db, meeting_id: str) -> dict[str, list[str] | None]:
    """{email_lower: division scope} from each recipient's newest upload link. A recipient with
    no link of their own (an email sent before per-recipient links) answers for the whole meeting."""
    rows = (
        db.table("meeting_upload_tokens").select("recipient_email, division_scope")
        .eq("meeting_id", meeting_id).order("created_at").execute().data or []
    )
    return {r["recipient_email"]: r.get("division_scope") for r in rows if r.get("recipient_email")}


def _opted_out_recipients(db, school_id: str, emails: list[str]) -> set[str]:
    """Lowercased emails that opted out of mailing — the same rule send_due_reminders applies
    (an active client's contacts are still emailed)."""
    import task_logic  # local import — task_logic imports from schools_router at module level
    client_status = resolve_inherited_year_admin(db, [school_id], DEFAULT_ACADEMIC_YEAR).get(school_id, {}).get("client_status")
    if client_status == "active":
        return set()
    return task_logic.fetch_opted_out_emails(db, [e.strip().lower() for e in emails])


def _upload_link_is_open(meeting_date: str) -> bool:
    """Mirrors the expiry get_or_create_upload_token gives a new link — once it has passed,
    a follow-up email would only carry a dead link."""
    expires_at = datetime.fromisoformat(meeting_date).replace(tzinfo=timezone.utc) + timedelta(days=UPLOAD_TOKEN_GRACE_DAYS)
    return datetime.now(timezone.utc) < expires_at


# ---------------------------------------------------------------------------
# Public (unauthenticated) endpoints — accessed via the magic link
# ---------------------------------------------------------------------------

@router.get("/public/email-open/{token}.gif", include_in_schema=False)
def track_email_open(token: str):
    """Open-tracking pixel. Always answers with the image, so it reveals nothing about tokens
    and never shows a broken image inside a recipient's email."""
    try:
        record_email_open(get_admin_client(), token)
    except Exception as exc:
        logger.warning("track_email_open failed (non-fatal): %s", exc)
    return Response(content=_TRANSPARENT_GIF, media_type="image/gif", headers={"Cache-Control": "no-store, max-age=0"})


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
        "original_filename, identified_type, division_type, covers_divisions, budgets, academic_year, uploaded_at"
    ).eq("meeting_id", meeting_id).order("uploaded_at").execute()
    all_uploaded = files_res.data or []
    division_scope = token_row.get("division_scope")

    years_out = []
    for year in upload_years:
        checklist = build_upload_checklist(db, school, year, division_scope)
        uploaded_for_year = [f for f in all_uploaded if f.get("academic_year") == year]
        comparison = compute_upload_comparison(checklist, uploaded_for_year)
        # budgets is None (not yet attempted) vs [] (attempted, found nothing — final) —
        # only None means the background reclassification task might still improve this,
        # so the frontend keeps polling while any gefen file is still in that state. That task
        # needs a plan file and does nothing without one, so until one arrives there's nothing
        # to wait for.
        has_plan_file = any(f.get("identified_type") == "tikhnun" for f in uploaded_for_year)
        gefen_budgets_pending = has_plan_file and any(
            f.get("identified_type") == "gefen" and f.get("budgets") is None
            for f in uploaded_for_year
        )
        years_out.append({
            "academic_year": year,
            "date_range_label": _year_date_range_label(year),
            "items": [{"label": i["label"], "received": i["received"]} for i in comparison["items"]],
            "all_received": comparison["all_received"],
            "no_baseline_this_year": checklist["no_baseline_this_year"],
            "already_uploaded": [{"original_filename": f["original_filename"]} for f in uploaded_for_year if file_matches_scope(f, division_scope)],
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
    token_row, meeting, school = _load_upload_context(token)
    meeting_id = token_row["meeting_id"]

    upload_years = resolve_requested_upload_years(meeting)
    if academic_year not in upload_years:
        raise HTTPException(status_code=400, detail="שנת לימודים לא תקינה עבור פגישה זו")

    expected_symbol = _normalize_symbol(school.get("symbol"))

    db = get_admin_client()
    run_dir = Path(tempfile.mkdtemp(prefix=f"meetingupload_{meeting_id}_"))
    saved_rows = []
    rejected = []
    file_results = []
    try:
        for i, uf in enumerate(files):
            filename = _safe_upload_name(uf.filename)
            content = await uf.read()
            if len(content) > MAX_UPLOAD_SIZE_BYTES:
                message = "הקובץ גדול מדי (מקסימום 50MB)."
                file_results.append({"filename": filename, "kind": None, "valid": False, "reason": message, "status": "too_large", "detected_academic_year": None})
                rejected.append({"filename": filename, "reason": message})
                continue
            # Numbered subdirectory: two uploaded files may share a name (doch.xlsx).
            dest = run_dir / str(i) / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
            # Parsing a workbook is CPU work with no Supabase calls — off the event loop so
            # it doesn't stall every other request on this worker.
            classification, validation = await run_in_threadpool(_inspect_uploaded_file, dest, academic_year, expected_symbol)
            # "warn" has no acknowledgment UI on this public portal — treated as valid.
            is_valid = validation["severity"] != "block"
            message = None if is_valid else validation["message"]
            file_results.append({
                "filename": filename,
                "kind": classification["identified_type"],
                "valid": is_valid,
                "reason": message,
                "status": validation["status"],
                "detected_academic_year": validation["detected_academic_year"],
            })
            if not is_valid:
                rejected.append({"filename": filename, "reason": message})
                continue
            if not commit:
                continue
            storage_key = f"meeting-uploads/{meeting_id}/{secrets.token_hex(8)}{dest.suffix}"
            try:
                db.storage.from_("check-files").upload(storage_key, dest.read_bytes())
                row = {
                    "meeting_id": meeting_id,
                    "token_id": token_row["id"],
                    "storage_key": storage_key,
                    "original_filename": filename,
                    "academic_year": academic_year,
                    **classification,
                }
                db.table("meeting_upload_files").insert(row).execute()
            except Exception as exc:
                logger.error("meeting-upload: saving failed for %s: %s", filename, exc)
                rejected.append({"filename": filename, "reason": "שגיאה בהעלאת הקובץ לאחסון — נסו שוב."})
                file_results[-1] = {**file_results[-1], "valid": False, "reason": "שגיאה בהעלאת הקובץ לאחסון — נסו שוב."}
                continue
            saved_rows.append(row)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)

    # Secondary to the per-file results above: a failure here must not hide them, least of all
    # after files were really saved. The page refreshes its checklist right after a send.
    comparison = {"items": [], "all_received": False}
    try:
        checklist = build_upload_checklist(db, school, academic_year, token_row.get("division_scope"))
        all_files_res = db.table("meeting_upload_files").select(
            "identified_type, division_type, covers_divisions, budgets"
        ).eq("meeting_id", meeting_id).eq("academic_year", academic_year).execute()
        comparison = compute_upload_comparison(checklist, all_files_res.data or [])
    except Exception as exc:
        logger.warning("meeting-upload: checklist comparison failed (non-fatal): %s", exc)

    if saved_rows:
        try:
            secretary = next((p for p in (meeting.get("participants") or []) if p.get("key") in ("secretary", "finance")), None)
            _notify_advisors_files_arrived(
                db, meeting_id, meeting["school_id"],
                secretary_name=token_row.get("recipient_name") or (secretary or {}).get("name") or "המנהלנית",
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

def _meeting_upload_comparison(db, meeting_id: str, school: dict, year: str) -> dict:
    """The advisor's view of one year: what this meeting's recipients were asked for. Once
    recipients have their own division scopes, the whole-school list would be wrong both ways:
    it asks a one-division meeting for the other division's files, and its single finance item
    looks received while one recipient's division is still missing."""
    files = (
        db.table("meeting_upload_files").select("identified_type, division_type, covers_divisions, budgets")
        .eq("meeting_id", meeting_id).eq("academic_year", year).execute().data or []
    )
    scopes = _recipient_scopes(db, meeting_id)
    distinct_scopes = sorted({tuple(s) for s in scopes.values() if s})
    if not distinct_scopes or not all(scopes.values()):
        return compute_upload_comparison(build_upload_checklist(db, school, year), files)

    comparisons = [
        (scope, compute_upload_comparison(build_upload_checklist(db, school, year, list(scope)), files))
        for scope in distinct_scopes
    ]
    items = []
    for scope, comparison in comparisons:
        division_label = DIVISION_LABELS.get(scope[0], scope[0])
        for item in comparison["items"]:
            needs_suffix = len(distinct_scopes) > 1 and division_label not in item["label"]
            items.append({**item, "label": f"{item['label']} - {division_label}" if needs_suffix else item["label"]})
    return {
        "items": items,
        "all_received": all(c["all_received"] for _s, c in comparisons),
        "no_baseline_this_year": any(c["no_baseline_this_year"] for _s, c in comparisons),
        "gefen_division_unclear": any(c["gefen_division_unclear"] for _s, c in comparisons),
    }


@router.get("/schools/meetings/{meeting_id}/upload-comparison")
def get_upload_comparison(meeting_id: str, user: Annotated[dict, Depends(get_current_user)], academic_year: str | None = None):
    for attempt in range(2):
        try:
            db = get_admin_client()
            meeting = _require_meeting_access(db, user, meeting_id, "meeting_date, academic_year, requested_upload_years")
            year = academic_year or resolve_requested_upload_years(meeting)[0]

            school_res = db.table("schools").select("id, name, stage, finance_software").eq("id", meeting["school_id"]).execute()
            school = school_res.data[0]

            return _meeting_upload_comparison(db, meeting_id, school, year)
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


_MESSAGE_COLUMNS = "id, recipient_email, recipient_name, recipient_role, message_type, subject, body_html, open_token, opened_at, status, error_message, sent_at"


def _build_uploads_summary(db, meeting: dict, school: dict, division_scope: list[str] | None = None) -> dict:
    """Per-year files + what's still missing, for one recipient's divisions (None = the whole
    meeting). Files are a shared pool: one uploaded by anyone counts for every division it serves."""
    upload_years = resolve_requested_upload_years(meeting)
    multi_division = school.get("stage") == "sheshshnati"
    files = (
        db.table("meeting_upload_files")
        .select("id, token_id, original_filename, identified_type, division_type, covers_divisions, budgets, academic_year, uploaded_at")
        .eq("meeting_id", meeting["id"]).order("uploaded_at").execute().data or []
    )
    token_rows = db.table("meeting_upload_tokens").select("id, recipient_name").eq("meeting_id", meeting["id"]).execute().data or []
    uploader_names = {t["id"]: t.get("recipient_name") for t in token_rows}
    # Files uploaded before academic_year existed belong to the meeting's first requested year.
    for f in files:
        f["academic_year"] = f.get("academic_year") or upload_years[0]
    # A year with files but no longer requested (the meeting's date moved) still shows its files.
    extra_years = sorted({f["academic_year"] for f in files} - set(upload_years))

    years = []
    for year in upload_years + extra_years:
        year_files = [f for f in files if f["academic_year"] == year]
        visible_files = [f for f in year_files if file_matches_scope(f, division_scope)]
        if year not in upload_years and not visible_files:
            continue
        missing = []
        if year in upload_years:
            comparison = compute_upload_comparison(build_upload_checklist(db, school, year, division_scope), year_files)
            for item in comparison["items"]:
                if item["received"]:
                    continue
                reusable = reusable_finance_file(item, year_files)
                missing.append({
                    "label": item["label"],
                    "division_type": item.get("division_type"),
                    "reusable_file_id": reusable["id"] if reusable else None,
                    "reusable_filename": reusable["original_filename"] if reusable else None,
                })
        years.append({
            "academic_year": year,
            "files": [{
                "id": f["id"],
                "filename": f["original_filename"],
                "type_label": file_type_label(
                    f.get("identified_type"),
                    "both" if len(file_divisions(f) or ()) > 1 else f.get("division_type"),
                    f.get("budgets"),
                    multi_division,
                ),
                "uploaded_by": uploader_names.get(f.get("token_id")),
                "advisor_confirmed": bool(f.get("covers_divisions")),
            } for f in visible_files],
            "missing": missing,
        })
    return {"years": years, "all_received": not any(y["missing"] for y in years)}


@router.get("/schools/meetings/{meeting_id}/messages")
def get_meeting_messages(meeting_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Everything emailed to this meeting's participants (reminders, file requests, follow-ups)
    plus the upload status — the data behind the "נשלח ל..." popover. Loaded only when the
    popover opens; the row's badge keeps using the lighter /reminder-status."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            meeting = _require_meeting_access(db, user, meeting_id, "participants, meeting_date, meeting_service_type, academic_year, requested_upload_years")
            reminders = db.table("meeting_reminders").select(_MESSAGE_COLUMNS).eq("meeting_id", meeting_id).execute().data or []
            followups = (
                db.table("meeting_upload_followups").select(f"{_MESSAGE_COLUMNS}, missing_items")
                .eq("meeting_id", meeting_id).execute().data or []
            )
            school_res = db.table("schools").select("*").eq("id", meeting["school_id"]).execute()
            school = school_res.data[0]
            break
        except HTTPException:
            raise
        except Exception as exc:
            if attempt == 0:
                logger.warning("get_meeting_messages attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("get_meeting_messages failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    # Reconstruct what wasn't recorded on rows that predate message_type/recipient_role.
    upload_recipients: dict[str, dict] = {}
    has_upload_link = False
    try:
        db = get_admin_client()
        if (meeting.get("meeting_service_type") or "gefen") != "current":
            upload_recipients = _upload_request_recipients(db, meeting, school)
        has_upload_link = bool(db.table("meeting_upload_tokens").select("id").eq("meeting_id", meeting_id).limit(1).execute().data)
    except Exception as exc:
        logger.warning("get_meeting_messages: upload recipients lookup failed (non-fatal): %s", exc)
    participants_by_email = {
        (p.get("email") or "").strip().lower(): p for p in (meeting.get("participants") or [])
    }

    messages = []
    for row, is_followup in [(r, False) for r in reminders] + [(r, True) for r in followups]:
        email_lower = (row.get("recipient_email") or "").strip().lower()
        known = upload_recipients.get(email_lower) or {}
        participant = participants_by_email.get(email_lower)
        message_type = row.get("message_type") or (
            "upload_followup" if is_followup
            else "upload_request" if has_upload_link and known else "reminder"
        )
        messages.append({
            "id": row["id"],
            "message_type": message_type,
            "recipient_email": row.get("recipient_email"),
            "recipient_name": row.get("recipient_name") or known.get("name") or (participant or {}).get("name"),
            "recipient_role": row.get("recipient_role") or known.get("role")
                or (_participant_role_label(participant, school) if participant else None),
            "subject": row.get("subject"),
            "body_html": row.get("body_html"),
            "status": row.get("status"),
            "error_message": row.get("error_message"),
            "sent_at": row.get("sent_at"),
            "opened_at": row.get("opened_at"),
            "missing_items": row.get("missing_items"),
            "uploads": None,
            "can_request_again": False,
        })
    messages.sort(key=lambda m: m.get("sent_at") or "")

    upload_messages = [m for m in messages if m["message_type"] in ("upload_request", "upload_followup")]
    if upload_messages:
        try:
            db = get_admin_client()
            scopes = _recipient_scopes(db, meeting_id)
            summaries: dict[tuple, dict] = {}
            for m in upload_messages:
                scope = scopes.get(m["recipient_email"].strip().lower())
                scope_key = tuple(scope or ())
                if scope_key not in summaries:
                    summaries[scope_key] = _build_uploads_summary(db, meeting, school, scope)
                m["uploads"] = summaries[scope_key]

            if _upload_link_is_open(meeting["meeting_date"]):
                opted_out = _opted_out_recipients(db, meeting["school_id"], [m["recipient_email"] for m in upload_messages])
                # Sorted by time, so the last row seen per recipient is their latest one.
                latest_by_recipient = {m["recipient_email"].strip().lower(): m for m in upload_messages}
                for email_lower, m in latest_by_recipient.items():
                    m["can_request_again"] = (
                        not m["uploads"]["all_received"] and m["status"] != "skipped"
                        and email_lower in upload_recipients and email_lower not in opted_out
                    )
        except Exception as exc:
            logger.warning("get_meeting_messages: uploads summary failed (non-fatal): %s", exc)

    return {"messages": messages}


class FileCoverageIn(BaseModel):
    division: str | None = None  # None clears what the advisor confirmed earlier


@router.patch("/schools/meetings/{meeting_id}/uploaded-files/{file_id}/coverage")
def set_uploaded_file_coverage(meeting_id: str, file_id: str, body: FileCoverageIn, user: Annotated[dict, Depends(get_current_user)]):
    """An advisor confirms an uploaded finance file also serves another division, e.g. a combined
    export that looks single-division because the other division had no expenses. Finance only:
    the check splits a finance file by report code, but a gefen or planning file of one division
    would leave the other division with no data."""
    db = get_admin_client()
    _require_meeting_access(db, user, meeting_id)
    file_res = db.table("meeting_upload_files").select("identified_type, covers_divisions").eq("id", file_id).eq("meeting_id", meeting_id).execute()
    if not file_res.data:
        raise HTTPException(status_code=404, detail="הקובץ לא נמצא")
    uploaded = file_res.data[0]
    if uploaded.get("identified_type") not in ("kesafim2000", "payscool", "schoolcash"):
        raise HTTPException(status_code=400, detail="ניתן לסמן רק קובץ מתוכנת הכספים")
    if body.division is None:
        covers = None
    elif body.division in ("tikkon", "beinayim", "yesodi"):
        division = "beinayim" if body.division == "yesodi" else body.division
        covers = sorted(set(uploaded.get("covers_divisions") or []) | {division})
    else:
        raise HTTPException(status_code=400, detail="חטיבה לא תקינה")
    db.table("meeting_upload_files").update({"covers_divisions": covers}).eq("id", file_id).eq("meeting_id", meeting_id).execute()
    return {"ok": True, "covers_divisions": covers}


class RequestMissingFilesIn(BaseModel):
    recipient_email: str | None = None  # None = every recipient of the meeting's file request


def _missing_items_for_scope(db, meeting_id: str, school: dict, upload_years: list[str], division_scope: list[str] | None) -> list[str]:
    multi_year = len(upload_years) > 1
    missing_items = []
    for year in upload_years:
        checklist = build_upload_checklist(db, school, year, division_scope)
        files_res = db.table("meeting_upload_files").select("identified_type, division_type, covers_divisions, budgets").eq("meeting_id", meeting_id).eq("academic_year", year).execute()
        comparison = compute_upload_comparison(checklist, files_res.data or [])
        missing_items += [
            (f'{i["label"]} — {year}' if multi_year else i["label"])
            for i in comparison["items"] if not i["received"]
        ]
    return missing_items


@router.post("/schools/meetings/{meeting_id}/request-missing-files")
def request_missing_files(meeting_id: str, user: Annotated[dict, Depends(get_current_user)], body: RequestMissingFilesIn | None = None):
    """The one manual button in this feature — sends a targeted follow-up
    email to the file request's recipients naming exactly the missing items."""
    db = get_admin_client()
    meeting = _require_meeting_access(db, user, meeting_id, "participants, meeting_date, academic_year, requested_upload_years, advisor_ids")

    school_res = db.table("schools").select("*").eq("id", meeting["school_id"]).execute()
    school = school_res.data[0]

    upload_years = resolve_requested_upload_years(meeting)
    multi_year = len(upload_years) > 1

    recipients_by_email = _upload_request_recipients(db, meeting, school)
    if not recipients_by_email:
        raise HTTPException(status_code=400, detail="לא נמצא איש קשר עם מייל למזכירה/אחראית כספים בפגישה זו")
    if body and body.recipient_email:
        # Only ever someone this meeting's file request belongs to — never a client-supplied address.
        requested = recipients_by_email.get(body.recipient_email.strip().lower())
        if not requested:
            raise HTTPException(status_code=400, detail="הנמען אינו משויך לבקשת הקבצים של פגישה זו")
        recipients_by_email = {body.recipient_email.strip().lower(): requested}

    try:
        opted_out = _opted_out_recipients(db, meeting["school_id"], list(recipients_by_email))
    except Exception as exc:
        logger.warning("request_missing_files: opt-out lookup failed (non-fatal, treated as none opted out): %s", exc)
        opted_out = set()
    recipients = [r for email_lower, r in recipients_by_email.items() if email_lower not in opted_out]
    if not recipients:
        raise HTTPException(status_code=400, detail="הנמען ביקש הסרה מרשימת התפוצה")

    if not _upload_link_is_open(meeting["meeting_date"]):
        raise HTTPException(status_code=400, detail="פג תוקפו של קישור ההעלאה לפגישה זו")

    # Each recipient is asked only for what's still missing in their own divisions.
    scopes = _recipient_scopes(db, meeting_id)
    missing_by_scope: dict[tuple, list[str]] = {}
    requests = []
    for p in recipients:
        scope = scopes.get(p["email"].lower())
        scope_key = tuple(scope or ())
        if scope_key not in missing_by_scope:
            missing_by_scope[scope_key] = _missing_items_for_scope(db, meeting_id, school, upload_years, scope)
        if missing_by_scope[scope_key]:
            requests.append((p, scope, missing_by_scope[scope_key]))
    if not requests:
        raise HTTPException(status_code=400, detail="כל הקבצים הנדרשים כבר התקבלו")

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
    subject = "חסרים קבצים לפגישה הקרובה"
    for p, scope, missing_items in requests:
        email_addr = p["email"]
        # One recipient's failure must not stop the others from getting theirs.
        try:
            token = get_or_create_upload_token(
                db, meeting_id, meeting["meeting_date"],
                recipient_email=email_addr, recipient_name=p.get("name"), division_scope=scope,
            )
        except Exception as exc:
            failed_count += 1
            logger.warning("request_missing_files: upload link failed for %s: %s", email_addr, exc)
            continue
        upload_url = f"{os.getenv('APP_URL', '')}/upload/{token}"
        items_html = "".join(f"<li>{item}</li>" for item in missing_items)
        # With several years each missing item already names its own year.
        year_html = "" if multi_year else f"<p><b>הקבצים נדרשים עבור שנת הלימודים {upload_years[0]}.</b></p>"
        html = f"""
<html><body dir="rtl" style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b;">
<p>שלום,</p>
<p>קיבלנו חלק מהקבצים לפגישה הקרובה בבית הספר <b>{school['name']}</b> — תודה!
מתברר שעדיין חסרים הקבצים הבאים:</p>
<ul>{items_html}</ul>
{year_html}
<p>נשמח אם תוכלו להעלות רק את אלה בקישור: <a href="{upload_url}">{upload_url}</a></p>
</body></html>"""
        status, error = "sent", None
        tracked_html, open_token = add_open_pixel(html)
        try:
            send_resend_email(email_addr, subject, tracked_html, reply_to=reply_to)
            sent += 1
        except Exception as exc:
            status, error = "failed", str(exc)
            failed_count += 1
            logger.warning("request_missing_files: failed to email %s: %s", email_addr, exc)
        try:
            db.table("meeting_upload_followups").insert({
                "meeting_id": meeting_id,
                "school_id": meeting["school_id"],
                "recipient_email": email_addr,
                "recipient_name": p.get("name"),
                "recipient_role": p.get("role"),
                "message_type": "upload_followup",
                "subject": subject,
                "body_html": html,
                "open_token": open_token,
                "missing_items": missing_items,
                "status": status,
                "error_message": error,
                "sent_by": user["id"],
            }).execute()
        except Exception as exc:
            logger.error("request_missing_files: failed to log follow-up for %s: %s", email_addr, exc)

    all_missing = list(dict.fromkeys(item for _p, _scope, items in requests for item in items))
    return {"ok": True, "sent": sent, "failed": failed_count, "missing_items": all_missing}
