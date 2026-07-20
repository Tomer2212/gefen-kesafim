import logging
import os
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import anthropic
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-5"

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


def _transcribe_audio(audio_path: Path) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(model="whisper-1", file=f)
    return result.text


def _summarize_transcript(transcript: str) -> str:
    client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": MEETING_SUMMARY_PROMPT_TEMPLATE.format(transcript=transcript)}],
    )
    return "".join(b.text for b in response.content if b.type == "text").strip()


def _process_recording(meeting_id: str, tmp_dir: Path, audio_path: Path) -> None:
    try:
        db = get_admin_client()

        storage_key = f"meeting-summaries/{meeting_id}/{secrets.token_hex(8)}{audio_path.suffix}"
        try:
            db.storage.from_("check-files").upload(storage_key, audio_path.read_bytes())
            db.table("meetings").update({"summary_audio_storage_key": storage_key}).eq("id", meeting_id).execute()
        except Exception as exc:
            logger.warning("meeting summary: audio storage upload failed (non-fatal): %s", exc)

        transcript = _transcribe_audio(audio_path)
        summary = _summarize_transcript(transcript)

        existing = db.table("meetings").select("notes").eq("id", meeting_id).execute()
        existing_notes = (existing.data[0].get("notes") or "") if existing.data else ""
        separator = "\n\n" if existing_notes.strip() else ""
        new_notes = f"{existing_notes}{separator}— סיכום אוטומטי מהקלטה —\n{summary}"

        db.table("meetings").update({
            "notes": new_notes,
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
    if not OPENAI_API_KEY or not CLAUDE_API_KEY:
        raise HTTPException(status_code=503, detail="שירות הסיכום האוטומטי אינו מוגדר כרגע")

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

    background_tasks.add_task(_process_recording, meeting_id, tmp_dir, audio_path)

    return {"ok": True, "summary_status": "processing"}


@router.post("/schools/meetings/{meeting_id}/summary/retry")
def retry_summary(meeting_id: str, background_tasks: BackgroundTasks, user: Annotated[dict, Depends(get_current_user)]):
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

    background_tasks.add_task(_process_recording, meeting_id, tmp_dir, audio_path)

    return {"ok": True, "summary_status": "processing"}
