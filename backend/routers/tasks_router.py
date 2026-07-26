import base64
import logging
import os
import secrets
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel

import booking_token_logic
import graph_client
import task_logic
import whatsapp_twilio
from academic_years import DEFAULT_ACADEMIC_YEAR
from auth import get_current_user
from booking_logic import get_org_mailbox_capability
from email_resend import send_resend_email
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

CRON_SECRET = os.getenv("CRON_SECRET", "")

_ROLE_CONTACT_FIELDS = {
    "principal": ("principal_name", "principal_email", "principal_phone"),
    "secretary": ("secretary_name", "secretary_email", "secretary_phone"),
    "finance_contact": ("finance_contact_name", "finance_contact_email", "finance_contact_phone"),
}


def _require_manager(user: dict):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")


def _resolve_recipient(school: dict, recipient_role: str) -> dict:
    """Resolves a recipient_role ('meeting_coordinator'|'principal'|'secretary'|
    'finance_contact'|'extra:<index>') against a school row into {name, email, phone} —
    mirrors schools_router._resolve_meeting_coordinator's reference-resolution convention.
    'meeting_coordinator' is a level of indirection: it follows school['meeting_coordinator']
    (itself one of the other role refs, as configured in "פרטי בית הספר") rather than naming
    a fixed field — same value schools_router surfaces as meeting_coordinator_contact."""
    if recipient_role == "meeting_coordinator":
        ref = school.get("meeting_coordinator")
        return _resolve_recipient(school, ref) if ref else {"name": None, "email": None, "phone": None}
    if recipient_role in _ROLE_CONTACT_FIELDS:
        name_f, email_f, phone_f = _ROLE_CONTACT_FIELDS[recipient_role]
        return {"name": school.get(name_f), "email": school.get(email_f), "phone": school.get(phone_f)}
    if recipient_role and recipient_role.startswith("extra:"):
        try:
            idx = int(recipient_role.split(":", 1)[1])
        except ValueError:
            return {"name": None, "email": None, "phone": None}
        extra = (school.get("extra_contacts") or [])
        if 0 <= idx < len(extra):
            c = extra[idx]
            return {"name": c.get("name"), "email": c.get("email"), "phone": c.get("phone")}
    return {"name": None, "email": None, "phone": None}


def _channel_missing_contact(channel: str, recipient: dict) -> bool:
    if channel == "whatsapp_twilio":
        return not recipient.get("phone")
    return not recipient.get("email")


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=422, detail="פורמט תאריך/שעה לא תקין")


class ConditionsIn(BaseModel):
    groups: list[dict] = []


class MessageConfigIn(BaseModel):
    recipient_role: str
    channel: str  # 'email_resend' | 'email_outlook' | 'whatsapp_twilio'
    subject: str | None = None
    body_template: str = ""
    attachment_keys: list[str] = []


class TaskCreateIn(BaseModel):
    name: str
    criteria: ConditionsIn
    message_config: MessageConfigIn
    academic_year: str = DEFAULT_ACADEMIC_YEAR
    scheduled_for: str | None = None  # ISO datetime; if set (and in the future), the school
    # list is left empty and evaluated later by process-scheduled-tasks instead of now — lets
    # a manager set up a task ("קביעת פגישות רבעון 3") ahead of time, matched against whichever
    # schools meet the criteria on that future date rather than today's.


class TaskPatchIn(BaseModel):
    name: str | None = None
    status: str | None = None
    message_config: MessageConfigIn | None = None


class PreviewIn(BaseModel):
    criteria: ConditionsIn
    academic_year: str = DEFAULT_ACADEMIC_YEAR


class SendIn(BaseModel):
    only_school_ids: list[str] | None = None  # None = send to everyone not-yet-done
    scheduled_at: str | None = None  # ISO datetime; if set (and in the future), messages are
    # queued now but held until process-message-queue's scheduled_at filter releases them.


@router.get("/field-options")
def get_field_options(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    return {
        "fields": task_logic.field_options(),
        "meeting_types": task_logic.MEETING_SERVICE_TYPE_OPTIONS,
    }


class TemplateIn(BaseModel):
    name: str
    subject: str | None = None
    body_template: str = ""


@router.get("/templates")
def list_templates(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    rows = (
        db.table("org_task_message_templates")
        .select("*")
        .eq("org_id", user["org_id"])
        .order("created_at", desc=True)
        .execute()
        .data or []
    )
    return rows


@router.post("/templates")
def create_template(body: TemplateIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    row = (
        db.table("org_task_message_templates")
        .insert({
            "org_id": user["org_id"],
            "created_by": user["id"],
            "name": body.name,
            "subject": body.subject,
            "body_template": body.body_template,
        })
        .execute()
    )
    return row.data[0]


@router.delete("/templates/{template_id}")
def delete_template(template_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    db.table("org_task_message_templates").delete().eq("id", template_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True}


@router.get("/channel-availability")
def get_channel_availability(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    outlook = get_org_mailbox_capability(user["org_id"])
    twilio = whatsapp_twilio.get_org_twilio_connection(user["org_id"])
    return {"email_outlook": outlook["connected"], "whatsapp_twilio": twilio["connected"]}


class TwilioSettingsIn(BaseModel):
    account_sid: str | None = None
    auth_token: str | None = None
    from_number: str | None = None


@router.get("/twilio-settings")
def get_twilio_settings(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    rows = db.table("twilio_connections").select("*").eq("org_id", user["org_id"]).execute().data or []
    row = rows[0] if rows else {}
    return {
        "status": row.get("status", "disconnected"),
        "has_credentials": bool(row.get("account_sid") and row.get("auth_token")),
        "from_number": row.get("from_number"),
    }


@router.put("/twilio-settings")
def put_twilio_settings(body: TwilioSettingsIn, user: Annotated[dict, Depends(get_current_user)]):
    """Infra-only (see plan): stores credentials but never flips status to 'connected' —
    whatsapp_twilio.send_whatsapp_message always raises until real API wiring is built."""
    _require_manager(user)
    db = get_admin_client()
    db.table("twilio_connections").upsert({
        "org_id": user["org_id"],
        "account_sid": body.account_sid,
        "auth_token": body.auth_token,
        "from_number": body.from_number,
        "status": "disconnected",
    }, on_conflict="org_id").execute()
    return {"ok": True}


@router.post("/preview")
def preview_task(body: PreviewIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    matched = task_logic.find_matching_schools(user["org_id"], body.criteria.model_dump(), body.academic_year)
    return {"count": len(matched), "schools": matched}


@router.post("/")
def create_task(body: TaskCreateIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    criteria = body.criteria.model_dump()

    scheduled_for_dt = _parse_dt(body.scheduled_for)
    is_future_scheduled = bool(scheduled_for_dt and scheduled_for_dt > datetime.now(timezone.utc))
    if is_future_scheduled:
        matched_school_ids = []
        status = "scheduled"
    else:
        matched = task_logic.find_matching_schools(user["org_id"], criteria, body.academic_year)
        matched_school_ids = [m["school_id"] for m in matched]
        status = "active"

    for attempt in range(2):
        try:
            db = get_admin_client()
            row = (
                db.table("org_tasks")
                .insert({
                    "org_id": user["org_id"],
                    "created_by": user["id"],
                    "name": body.name,
                    "status": status,
                    "criteria": criteria,
                    "matched_school_ids": matched_school_ids,
                    "message_config": body.message_config.model_dump(),
                    "scheduled_for": scheduled_for_dt.isoformat() if is_future_scheduled else None,
                    "academic_year": body.academic_year,
                })
                .execute()
            )
            return row.data[0]
        except Exception as exc:
            if attempt == 0:
                logger.warning("create_task attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
            else:
                logger.error("create_task failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


@router.get("/")
def list_tasks(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("org_tasks")
                .select("*")
                .eq("org_id", user["org_id"])
                .order("created_at", desc=True)
                .execute()
                .data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("list_tasks attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
            else:
                logger.error("list_tasks failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    try:
        db = get_admin_client()
        creator_ids = list({r["created_by"] for r in rows if r.get("created_by")})
        names_map = {}
        if creator_ids:
            p_rows = db.table("profiles").select("id, full_name").in_("id", creator_ids).execute().data or []
            names_map = {p["id"]: p["full_name"] for p in p_rows}
        for r in rows:
            r["created_by_name"] = names_map.get(r.get("created_by"))
            r["total_schools"] = len(r.get("matched_school_ids") or [])
    except Exception as exc:
        logger.warning("list_tasks enrichment failed (non-fatal): %s", exc)

    return rows


def _get_task_or_404(db, task_id: str, org_id: str) -> dict:
    rows = db.table("org_tasks").select("*").eq("id", task_id).eq("org_id", org_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="משימה לא נמצאה")
    return rows[0]


@router.get("/{task_id}")
def get_task(task_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    task = _get_task_or_404(db, task_id, user["org_id"])
    progress = task_logic.compute_task_progress(user["org_id"], task)
    return {**task, "progress": progress}


@router.patch("/{task_id}")
def patch_task(task_id: str, body: TaskPatchIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    _get_task_or_404(db, task_id, user["org_id"])
    patch = {}
    if body.name is not None:
        patch["name"] = body.name
    if body.status is not None:
        patch["status"] = body.status
    if body.message_config is not None:
        patch["message_config"] = body.message_config.model_dump()
    if not patch:
        return _get_task_or_404(db, task_id, user["org_id"])
    row = db.table("org_tasks").update(patch).eq("id", task_id).eq("org_id", user["org_id"]).execute()
    return row.data[0]


@router.delete("/{task_id}")
def delete_task(task_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    _get_task_or_404(db, task_id, user["org_id"])
    db.table("org_tasks").delete().eq("id", task_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True}


def _render_template(template: str, school: dict, booking_link: str | None = None) -> str:
    text = (template or "").replace("{school_name}", school.get("name") or "")
    if "{booking_link}" in text:
        text = text.replace("{booking_link}", booking_link or "")
    return text


def _first_meeting_condition(criteria: dict) -> dict | None:
    for group in (criteria or {}).get("groups") or []:
        for c in group.get("conditions") or []:
            if c.get("type") == "meeting":
                return c
    return None


def _build_booking_link(db, org_id: str, task: dict, school_id: str) -> str | None:
    """Only relevant when the task's message body references {booking_link} — reuses the
    existing unique-scheduling-link machinery instead of building a new one (see plan)."""
    advisors = db.table("advisor_schools").select("advisor_id").eq("school_id", school_id).execute().data or []
    if not advisors:
        return None
    advisor_id = advisors[0]["advisor_id"]
    meeting_cond = _first_meeting_condition(task.get("criteria") or {}) or {}
    months = []
    if meeting_cond.get("date_from"):
        months = [meeting_cond["date_from"][:7]]
    window = {"days_of_week": [0, 1, 2, 3, 4], "start_hour": 8, "end_hour": 16, "duration_minutes": 60}
    # draft_id is nullable on meeting_booking_tokens (FK -> meeting_booking_drafts, which this
    # generalized Tasks feature intentionally does not create rows in — see plan §"extend, don't
    # fork"). Passing None reuses/creates a token keyed only on (school, advisor), which is fine:
    # the underlying link is meant to be reusable per school+advisor regardless of which task
    # asked for it.
    token_row = booking_token_logic.get_or_create_booking_token(db, org_id, school_id, advisor_id, None, months, window)
    return f"{os.getenv('APP_URL', '')}/book/{token_row['token']}"


def _queue_messages_for_schools(db, task: dict, org_id: str, school_ids: list[str],
                                 scheduled_at: datetime | None = None) -> list[str]:
    """Builds and inserts org_task_messages rows. Returns school_ids that were missing the
    contact info required by the chosen channel/recipient_role (queued for none of these).
    scheduled_at (if in the future) holds the message until process-message-queue releases it —
    rows always land with status 'pending', the queue drain just filters on scheduled_at."""
    message_config = task.get("message_config") or {}
    recipient_role = message_config.get("recipient_role")
    channel = message_config.get("channel")
    body_template = message_config.get("body_template") or ""
    needs_booking_link = "{booking_link}" in body_template

    schools = db.table("schools").select("*").in_("id", school_ids).execute().data or []
    missing = []
    queue_rows = []
    for school in schools:
        recipient = _resolve_recipient(school, recipient_role)
        if _channel_missing_contact(channel, recipient):
            missing.append(school["id"])
            continue
        booking_link = _build_booking_link(db, org_id, task, school["id"]) if needs_booking_link else None
        row = {
            "task_id": task["id"],
            "school_id": school["id"],
            "recipient_name": recipient.get("name"),
            "recipient_email": recipient.get("email"),
            "recipient_phone": recipient.get("phone"),
            "recipient_role": recipient_role,
            "channel": channel,
            "subject": _render_template(message_config.get("subject") or "", school),
            "body": _render_template(body_template, school, booking_link),
            "attachment_keys": message_config.get("attachment_keys") or [],
            "status": "pending",
        }
        if scheduled_at:
            row["scheduled_at"] = scheduled_at.isoformat()
        queue_rows.append(row)

    if queue_rows:
        db.table("org_task_messages").insert(queue_rows).execute()
    return missing


@router.post("/{task_id}/send")
def send_task_bulk(task_id: str, body: SendIn, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    task = _get_task_or_404(db, task_id, user["org_id"])
    scheduled_at = _parse_dt(body.scheduled_at)

    if body.only_school_ids:
        target_ids = body.only_school_ids
    else:
        progress = task_logic.compute_task_progress(user["org_id"], task)
        target_ids = [r["school_id"] for r in progress["schools"] if not r["done"]]

    if not target_ids:
        return {"queued": 0, "missing_contact_school_ids": []}

    missing = _queue_messages_for_schools(db, task, user["org_id"], target_ids, scheduled_at)
    queued = len(target_ids) - len(missing)
    if missing:
        raise HTTPException(status_code=409, detail={
            "message": "לחלק מבתי הספר חסרים פרטי קשר מתאימים לערוץ שנבחר",
            "missing_contact_school_ids": missing,
            "queued": queued,
        })
    return {"queued": queued, "missing_contact_school_ids": []}


@router.post("/{task_id}/schools/{school_id}/send")
def send_task_single(task_id: str, school_id: str, user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)
    db = get_admin_client()
    task = _get_task_or_404(db, task_id, user["org_id"])
    missing = _queue_messages_for_schools(db, task, user["org_id"], [school_id])
    if missing:
        raise HTTPException(status_code=409, detail={
            "message": "לבית הספר חסרים פרטי קשר מתאימים לערוץ שנבחר",
            "missing_contact_school_ids": missing,
        })
    return {"ok": True}


class ContactInfoIn(BaseModel):
    email: str | None = None
    phone: str | None = None


@router.put("/{task_id}/schools/{school_id}/contact-info")
def put_school_contact_info(task_id: str, school_id: str, body: ContactInfoIn, user: Annotated[dict, Depends(get_current_user)]):
    """Fills in the email/phone for whichever contact role the task's recipient_role actually
    resolves to on this school — needed because 'meeting_coordinator' is an indirection (it
    points at a *different* fixed role per school), so the missing-contact modal can't know
    which schools.<role>_email/<role>_phone column to write to without asking the backend."""
    _require_manager(user)
    db = get_admin_client()
    task = _get_task_or_404(db, task_id, user["org_id"])
    school_rows = db.table("schools").select("*").eq("id", school_id).eq("org_id", user["org_id"]).execute().data or []
    if not school_rows:
        raise HTTPException(status_code=404, detail="בית הספר לא נמצא")
    school = school_rows[0]

    recipient_role = (task.get("message_config") or {}).get("recipient_role")
    resolved_role = school.get("meeting_coordinator") if recipient_role == "meeting_coordinator" else recipient_role
    if resolved_role not in _ROLE_CONTACT_FIELDS:
        raise HTTPException(status_code=422, detail="לא ניתן לקבוע לאיזה איש קשר לשייך את הפרטים — יש להגדיר קודם 'אחראי/ת לתיאום פגישות' בפרטי בית הספר")

    _name_f, email_f, phone_f = _ROLE_CONTACT_FIELDS[resolved_role]
    patch = {}
    if body.email:
        patch[email_f] = body.email
    if body.phone:
        patch[phone_f] = body.phone
    if patch:
        db.table("schools").update(patch).eq("id", school_id).eq("org_id", user["org_id"]).execute()
    return {"ok": True, "resolved_role": resolved_role}


@router.post("/{task_id}/attachments")
async def upload_task_attachment(
    task_id: str,
    user: Annotated[dict, Depends(get_current_user)],
    file: UploadFile = File(...),
):
    _require_manager(user)
    db = get_admin_client()
    _get_task_or_404(db, task_id, user["org_id"])

    run_dir = Path(tempfile.mkdtemp(prefix=f"task_{task_id}_"))
    try:
        suffix = Path(file.filename or "").suffix
        dest = run_dir / f"attachment{suffix}"
        dest.write_bytes(await file.read())
        storage_key = f"tasks/{task_id}/{secrets.token_hex(8)}{suffix}"
        db.storage.from_("check-files").upload(storage_key, dest.read_bytes())
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)

    return {"storage_key": storage_key, "filename": file.filename}


@router.post("/process-message-queue")
def process_message_queue(request: Request):
    """Cron-triggered (same GitHub Actions convention as process-booking-email-queue in
    schools_router.py:2432) — drains a small batch of pending org_task_messages rows."""
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    db = get_admin_client()
    BATCH_SIZE = 20
    rows = (
        db.table("org_task_messages")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", datetime.now(timezone.utc).isoformat())
        .order("created_at")
        .limit(BATCH_SIZE)
        .execute()
        .data or []
    )

    sent, failed = 0, 0
    for row in rows:
        try:
            task = db.table("org_tasks").select("org_id").eq("id", row["task_id"]).execute().data
            org_id = task[0]["org_id"] if task else None
            if not org_id:
                raise ValueError(f"task {row['task_id']} not found for queued message {row['id']}")

            attachments = None
            if row.get("attachment_keys"):
                attachments = []
                for key in row["attachment_keys"]:
                    content = db.storage.from_("check-files").download(key)
                    attachments.append({
                        "filename": key.rsplit("/", 1)[-1],
                        "content_b64": base64.b64encode(content).decode("ascii"),
                    })

            if row["channel"] == "email_outlook":
                capability = get_org_mailbox_capability(org_id)
                if not capability["connected"]:
                    raise RuntimeError("הארגון אינו מחובר ל-Outlook")
                advisors = db.table("advisor_schools").select("advisor_id").eq("school_id", row["school_id"]).execute().data or []
                advisor_id = advisors[0]["advisor_id"] if advisors else None
                if not advisor_id:
                    raise RuntimeError("לא נמצא יועץ לבית הספר לצורך שליחה מ-Outlook")
                graph_client.send_mail_as_advisor(
                    db, org_id, advisor_id, row["subject"] or "", row["body"] or "",
                    row["recipient_email"], attachments=attachments,
                )
            elif row["channel"] == "whatsapp_twilio":
                whatsapp_twilio.send_whatsapp_message(org_id, row["recipient_phone"], row["body"] or "", row.get("attachment_keys"))
            else:  # email_resend (default)
                send_resend_email(row["recipient_email"], row["subject"] or "", row["body"] or "", attachments=attachments)

            db.table("org_task_messages").update({"status": "sent", "sent_at": "now()"}).eq("id", row["id"]).execute()
            sent += 1
        except Exception as exc:
            logger.warning("process_message_queue: failed to send row %s: %s", row["id"], exc)
            try:
                db.table("org_task_messages").update({"status": "failed", "error": str(exc)}).eq("id", row["id"]).execute()
            except Exception as log_exc:
                logger.error("process_message_queue: failed to mark row %s failed: %s", row["id"], log_exc)
            failed += 1

    return {"ok": True, "sent": sent, "failed": failed, "batch_size": len(rows)}


@router.post("/process-scheduled-tasks")
def process_scheduled_tasks(request: Request):
    """Cron-triggered (same convention as process-message-queue). Evaluates tasks that were
    created with a future scheduled_for — computing the school-match snapshot now (on/after the
    scheduled date) instead of at creation time, then flipping them to 'active' so they behave
    like any other task from that point on."""
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    db = get_admin_client()
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = (
        db.table("org_tasks")
        .select("*")
        .eq("status", "scheduled")
        .lte("scheduled_for", now_iso)
        .execute()
        .data or []
    )

    evaluated = 0
    for task in rows:
        try:
            matched = task_logic.find_matching_schools(
                task["org_id"], task.get("criteria") or {}, task.get("academic_year") or DEFAULT_ACADEMIC_YEAR,
            )
            db.table("org_tasks").update({
                "matched_school_ids": [m["school_id"] for m in matched],
                "status": "active",
            }).eq("id", task["id"]).execute()
            evaluated += 1
        except Exception as exc:
            logger.warning("process_scheduled_tasks: failed to evaluate task %s: %s", task["id"], exc)

    return {"ok": True, "evaluated": evaluated, "batch_size": len(rows)}
