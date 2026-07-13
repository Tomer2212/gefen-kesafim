import logging
import time
from datetime import datetime, timezone
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from chatbot_config import (
    CHATBOT_GLOBAL_DAILY_LIMIT,
    CHATBOT_PER_USER_DAILY_LIMIT,
    CHATBOT_PROVIDER,
    GOOGLE_API_KEY,
    GOOGLE_MODEL,
    GOOGLE_URL,
    MODEL,
    OPENROUTER_API_KEY,
    OPENROUTER_URL,
    get_system_prefix,
)
from supabase_client import get_admin_client, reset_admin_client

router = APIRouter()
_log = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 16
MAX_MESSAGE_CHARS = 4000


def _today_utc() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _check_quota(user_id: str) -> None:
    """Raise HTTPException(429) if the per-user or global daily message quota is met."""
    today = _today_utc()
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("chatbot_usage_daily")
                .select("user_id, message_count")
                .eq("usage_date", today)
                .execute()
                .data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                _log.warning("chatbot quota check attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("chatbot quota check failed after 2 attempts: %s", exc, exc_info=True)
                # Fail open — a transient DB issue shouldn't block a light-usage internal tool.
                return

    user_count = sum(r["message_count"] for r in rows if r["user_id"] == user_id)
    global_count = sum(r["message_count"] for r in rows)

    if user_count >= CHATBOT_PER_USER_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail={"reason": "user_limit"})
    if global_count >= CHATBOT_GLOBAL_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail={"reason": "global_limit"})


def _record_usage(user_id: str) -> None:
    """Best-effort atomic increment after a successful OpenRouter response. Never raises."""
    try:
        db = get_admin_client()
        db.rpc("increment_chatbot_usage", {"p_user_id": user_id}).execute()
    except Exception as exc:
        _log.warning("chatbot usage increment failed (non-fatal): %s", exc)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    history: list[ChatMessage] = []
    message: str = Field(max_length=MAX_MESSAGE_CHARS)


async def _stream_openrouter(payload: dict, user_id: str):
    if not OPENROUTER_API_KEY:
        yield 'data: {"error": "שירות הצ\'אט אינו מוגדר כרגע"}\n\n'
        return
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                OPENROUTER_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    _log.error("OpenRouter error %s: %s", response.status_code, body)
                    yield 'data: {"error": "שגיאה בפנייה לשרת ה-AI"}\n\n'
                    return
                usage_recorded = False
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        if not usage_recorded and '"usage"' in line:
                            _log.info("chatbot usage chunk: %s", line)
                            # Count only successful, billed responses against the user's quota —
                            # exactly once per request, regardless of how many chunks report usage.
                            _record_usage(user_id)
                            usage_recorded = True
                        yield line + "\n\n"
    except Exception as exc:
        _log.error("chatbot stream failed: %s", exc, exc_info=True)
        yield 'data: {"error": "שגיאה זמנית בשרת הצ\'אט"}\n\n'


async def _stream_google(payload: dict, user_id: str):
    if not GOOGLE_API_KEY:
        yield 'data: {"error": "שירות הצ\'אט אינו מוגדר כרגע"}\n\n'
        return
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                GOOGLE_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {GOOGLE_API_KEY}",
                    "Content-Type": "application/json",
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    _log.error("Google API error %s: %s", response.status_code, body)
                    yield 'data: {"error": "שגיאה בפנייה לשרת ה-AI"}\n\n'
                    return
                # Google (unlike OpenRouter) sends the usage field on multiple chunks during a
                # single stream, not just the final one — must only record it once per request.
                usage_recorded = False
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        if not usage_recorded and '"usage"' in line:
                            _log.info("chatbot usage chunk: %s", line)
                            _record_usage(user_id)
                            usage_recorded = True
                        yield line + "\n\n"
    except Exception as exc:
        _log.error("chatbot stream failed: %s", exc, exc_info=True)
        yield 'data: {"error": "שגיאה זמנית בשרת הצ\'אט"}\n\n'


@router.post("/ask")
async def ask(
    request: ChatRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    _check_quota(user["id"])

    bounded_history = request.history[-MAX_HISTORY_MESSAGES:]
    history_messages = [{"role": m.role, "content": m.content} for m in bounded_history]

    if CHATBOT_PROVIDER == "google":
        # Plain string system message — verified empirically that Gemini's automatic
        # (implicit) caching kicks in reliably when calling Google directly (no explicit
        # cache_control needed), unlike the same request routed through OpenRouter.
        payload = {
            "model": GOOGLE_MODEL,
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": [
                {"role": "system", "content": get_system_prefix()},
                *history_messages,
                {"role": "user", "content": request.message},
            ],
        }
        return StreamingResponse(_stream_google(payload, user["id"]), media_type="text/event-stream")

    # Inactive backup path (CHATBOT_PROVIDER=openrouter) — kept working intentionally.
    payload = {
        "model": MODEL,
        "stream": True,
        "usage": {"include": True},
        "messages": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": get_system_prefix(),
                        # Explicit breakpoint — Gemini via OpenRouter does NOT reliably cache
                        # on an identical prefix alone (implicit caching); this cache_control
                        # marker is what actually triggers the cost reduction on this provider.
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
            },
            *history_messages,
            {"role": "user", "content": request.message},
        ],
    }
    return StreamingResponse(_stream_openrouter(payload, user["id"]), media_type="text/event-stream")


@router.get("/usage-today")
def usage_today(user: Annotated[dict, Depends(get_current_user)]):
    if user["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")

    today = _today_utc()
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("chatbot_usage_daily")
                .select("user_id, message_count")
                .eq("usage_date", today)
                .order("message_count", desc=True)
                .execute()
                .data or []
            )
            break
        except Exception as exc:
            if attempt == 0:
                _log.warning("usage_today attempt 1 failed: %s — resetting and retrying", exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                _log.error("usage_today failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    profiles_map = {}
    try:
        user_ids = [r["user_id"] for r in rows]
        if user_ids:
            p_rows = get_admin_client().table("profiles").select("id, full_name, email").in_("id", user_ids).execute()
            profiles_map = {p["id"]: p for p in (p_rows.data or [])}
    except Exception as exc:
        _log.warning("usage_today profile enrichment failed (non-fatal): %s", exc)

    users = [
        {
            "user_id": r["user_id"],
            "name": (profiles_map.get(r["user_id"]) or {}).get("full_name")
                or (profiles_map.get(r["user_id"]) or {}).get("email")
                or r["user_id"],
            "message_count": r["message_count"],
        }
        for r in rows
    ]

    return {
        "users": users,
        "global_count": sum(r["message_count"] for r in rows),
        "per_user_limit": CHATBOT_PER_USER_DAILY_LIMIT,
        "global_limit": CHATBOT_GLOBAL_DAILY_LIMIT,
    }
