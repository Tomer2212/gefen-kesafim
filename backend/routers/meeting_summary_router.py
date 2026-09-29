import logging
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

OPENAI_SUMMARY_MODEL = "gpt-4o-mini"

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".mp4", ".webm", ".ogg", ".mpeg", ".mpga"}
MAX_AUDIO_SIZE_BYTES = 24 * 1024 * 1024  # stay under OpenAI's 25MB hard cap

# TODO: להשלים בהמשך את הקריטריונים המדויקים למה בדיוק הסוכן צריך לחפש בתמלול
# (למשל: החלטות שהתקבלו, משימות פתוחות, בעיות שעלו, תאריכי יעד). זהו קבוע יחיד
# כדי שיהיה אפשר לערוך את הפרומפט בלי לגעת בלוגיקת הפייפליין.
MEETING_SUMMARY_PROMPT_TEMPLATE = """את/ה מסכם/ת פגישות ייעוץ תקציבי בין יועץ גפ"ן לבין נציגי בית ספר.
להלן תמלול הפגישה. סכם/י בעברית את הנקודות המרכזיות בפורמט תמציתי וברור.

תמלול:
{transcript}
"""


def _transcribe_audio(audio_path: Path, api_key: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(model="whisper-1", file=f)
    return result.text


def _summarize_transcript(transcript: str, api_key: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=OPENAI_SUMMARY_MODEL,
        messages=[{"role": "user", "content": MEETING_SUMMARY_PROMPT_TEMPLATE.format(transcript=transcript)}],
    )
    return (response.choices[0].message.content or "").strip()


def _get_org_summary_config(org_id: str) -> dict | None:
    """Returns the org's meeting-summary integration row (enabled + has an api_key), or None
    if the org hasn't connected one yet — mirrors calls_router._get_integration_config."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("meeting_summary_integrations")
                .select("*")
                .eq("org_id", org_id)
                .limit(1)
                .execute()
            ).data
            if not rows:
                return None
            row = rows[0]
            if not row.get("enabled") or not (row.get("config") or {}).get("api_key"):
                return None
            return row
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("meeting summary: failed to load org integration config: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


def _process_recording(meeting_id: str, tmp_dir: Path, audio_path: Path, api_key: str) -> None:
    try:
        db = get_admin_client()

        storage_key = f"meeting-summaries/{meeting_id}/{secrets.token_hex(8)}{audio_path.suffix}"
        try:
            db.storage.from_("check-files").upload(storage_key, audio_path.read_bytes())
            db.table("meetings").update({"summary_audio_storage_key": storage_key}).eq("id", meeting_id).execute()
        except Exception as exc:
            logger.warning("meeting summary: audio storage upload failed (non-fatal): %s", exc)

        transcript = _transcribe_audio(audio_path, api_key)
        summary = _summarize_transcript(transcript, api_key)

        # Written as a new meeting_notes entry (author_id=None → rendered as "סיכום אוטומטי
        # מהקלטה" in the notes window), not appended to the legacy meetings.notes column —
        # see CLAUDE.md meeting-notes plan: notes are now an append-only thread, not a single
        # overwritable text field.
        meeting_row = db.table("meetings").select("school_id").eq("id", meeting_id).execute()
        school_id = meeting_row.data[0]["school_id"] if meeting_row.data else None
        if school_id:
            db.table("meeting_notes").insert({
                "meeting_id": meeting_id,
                "school_id": school_id,
                "group_id": str(uuid4()),
                "author_id": None,
                "content": f"— סיכום אוטומטי מהקלטה —\n{summary}",
            }).execute()

        db.table("meetings").update({
            "summary_status": "done",
            "summary_error": None,
            "summary_updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", meeting_id).execute()
    except Exception as exc:
        logger.error("meeting summary pipeline failed for meeting %s: %s", meeting_id, exc, exc_info=True)
        try:
            get_admin_client().table("meetings").update({
                "summary_status": "error",
                "summary_error": "אירעה שגיאה בעיבוד ההקלטה, נסה שוב",
                "summary_updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", meeting_id).execute()
        except Exception:
            pass
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@router.get("/schools/meetings/{meeting_id}/summary")
def get_summary_status(meeting_id: str, user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            res = db.table("meetings").select(
                "summary_status, summary_error, summary_updated_at"
            ).eq("id", meeting_id).execute()
            if not res.data:
                return {"summary_status": "none", "summary_error": None, "summary_updated_at": None}
            return res.data[0]
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("get_summary_status failed after 2 attempts: %s", exc)
                return {"summary_status": "none", "summary_error": None, "summary_updated_at": None}


@router.post("/schools/meetings/{meeting_id}/summary/recording")
async def upload_summary_recording(
    meeting_id: str,
    background_tasks: BackgroundTasks,
    user: Annotated[dict, Depends(get_current_user)],
    file: UploadFile = File(...),
):
    org_config = _get_org_summary_config(user["org_id"])
    if not org_config:
        raise HTTPException(status_code=503, detail="על הארגון לחבר API לצורך סיכום הפגישה")
    api_key = org_config["config"]["api_key"]

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="סוג קובץ לא נתמך — יש להעלות קובץ שמע (mp3, m4a, wav וכו')")

    db = get_admin_client()
    meeting_res = db.table("meetings").select("id").eq("id", meeting_id).execute()
    if not meeting_res.data:
        raise HTTPException(status_code=404, detail="הפגישה לא נמצאה")

    tmp_dir = Path(tempfile.mkdtemp(prefix=f"meetingsummary_{meeting_id}_"))
    audio_path = tmp_dir / f"recording{ext}"
    content = await file.read()
    if len(content) > MAX_AUDIO_SIZE_BYTES:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="קובץ ההקלטה גדול מדי (מעל 24MB) — יש להעלות קובץ קטן יותר")
    audio_path.write_bytes(content)

    db.table("meetings").update({
        "summary_status": "processing",
        "summary_error": None,
        "summary_updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", meeting_id).execute()

    background_tasks.add_task(_process_recording, meeting_id, tmp_dir, audio_path, api_key)

    return {"ok": True, "summary_status": "processing"}


@router.post("/schools/meetings/{meeting_id}/summary/retry")
def retry_summary(meeting_id: str, background_tasks: BackgroundTasks, user: Annotated[dict, Depends(get_current_user)]):
    org_config = _get_org_summary_config(user["org_id"])
    if not org_config:
        raise HTTPException(status_code=503, detail="על הארגון לחבר API לצורך סיכום הפגישה")
    api_key = org_config["config"]["api_key"]

    db = get_admin_client()
    meeting_res = db.table("meetings").select("summary_audio_storage_key").eq("id", meeting_id).execute()
    if not meeting_res.data or not meeting_res.data[0].get("summary_audio_storage_key"):
        raise HTTPException(status_code=400, detail="אין הקלטה שמורה לשחזור עבור פגישה זו")
    storage_key = meeting_res.data[0]["summary_audio_storage_key"]

    tmp_dir = Path(tempfile.mkdtemp(prefix=f"meetingsummary_retry_{meeting_id}_"))
    try:
        content = db.storage.from_("check-files").download(storage_key)
    except Exception as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=503, detail=f"שגיאה בשליפת ההקלטה השמורה: {exc}")

    audio_path = tmp_dir / f"recording{Path(storage_key).suffix}"
    audio_path.write_bytes(content)

    db.table("meetings").update({
        "summary_status": "processing",
        "summary_error": None,
        "summary_updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", meeting_id).execute()

    background_tasks.add_task(_process_recording, meeting_id, tmp_dir, audio_path, api_key)

    return {"ok": True, "summary_status": "processing"}


# ---------------------------------------------------------------------------
# Org-level AI summary integration settings — authenticated GET (any user, so
# every meetings surface can decide whether to enable the "סיכום פגישה"
# button); manager+ for PUT/DELETE. Mirrors calls_router.py's /settings.
# ---------------------------------------------------------------------------

class MeetingSummarySettingsIn(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None


def _require_manager(user: dict) -> None:
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה")


def _meeting_summary_settings_response(row: dict | None) -> dict:
    if not row:
        return {"provider": None, "enabled": False, "has_api_key": False}
    config = row.get("config") or {}
    return {
        "provider": row["provider"],
        "enabled": row["enabled"],
        "has_api_key": bool(config.get("api_key")),
    }


@router.get("/schools/meeting-summary-settings")
def get_meeting_summary_settings(user: Annotated[dict, Depends(get_current_user)]):
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = db.table("meeting_summary_integrations").select("*").eq("org_id", user["org_id"]).limit(1).execute().data
            return _meeting_summary_settings_response(rows[0] if rows else None)
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("get_meeting_summary_settings failed after 2 attempts: %s", exc)
                return {"provider": None, "enabled": False, "has_api_key": False}


@router.put("/schools/meeting-summary-settings")
def update_meeting_summary_settings(user: Annotated[dict, Depends(get_current_user)], body: MeetingSummarySettingsIn):
    _require_manager(user)

    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = db.table("meeting_summary_integrations").select("*").eq("org_id", user["org_id"]).limit(1).execute().data
            row = rows[0] if rows else None
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("update_meeting_summary_settings: failed to load row: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if not row:
        config: dict = {}
        if body.api_key:
            config["api_key"] = body.api_key
        insert_row = {
            "org_id": user["org_id"],
            "provider": "openai_whisper",
            "enabled": body.enabled if body.enabled is not None else True,
            "config": config,
        }
        for attempt in range(2):
            try:
                db = get_admin_client()
                row = db.table("meeting_summary_integrations").insert(insert_row).execute().data[0]
                break
            except Exception as exc:
                if attempt == 0:
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.error("update_meeting_summary_settings: failed to create integration: %s", exc, exc_info=True)
                    raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
        return _meeting_summary_settings_response(row)

    config = dict(row.get("config") or {})
    if body.api_key is not None:
        if body.api_key:
            config["api_key"] = body.api_key
        else:
            config.pop("api_key", None)

    updates: dict = {"config": config, "updated_at": datetime.now(timezone.utc).isoformat()}
    if body.enabled is not None:
        updates["enabled"] = body.enabled

    for attempt in range(2):
        try:
            db = get_admin_client()
            row = db.table("meeting_summary_integrations").update(updates).eq("org_id", user["org_id"]).execute().data[0]
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("update_meeting_summary_settings failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return _meeting_summary_settings_response(row)


@router.delete("/schools/meeting-summary-settings")
def disconnect_meeting_summary_integration(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)

    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("meeting_summary_integrations").delete().eq("org_id", user["org_id"]).execute()
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("disconnect_meeting_summary_integration failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"ok": True}
