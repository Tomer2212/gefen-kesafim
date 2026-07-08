import logging
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from chatbot_config import MODEL, OPENROUTER_API_KEY, OPENROUTER_URL, get_system_prefix

router = APIRouter()
_log = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 16
MAX_MESSAGE_CHARS = 4000


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    history: list[ChatMessage] = []
    message: str = Field(max_length=MAX_MESSAGE_CHARS)


async def _stream_openrouter(payload: dict):
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
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        if '"usage"' in line:
                            _log.info("chatbot usage chunk: %s", line)
                        yield line + "\n\n"
    except Exception as exc:
        _log.error("chatbot stream failed: %s", exc, exc_info=True)
        yield 'data: {"error": "שגיאה זמנית בשרת הצ\'אט"}\n\n'


@router.post("/ask")
async def ask(
    request: ChatRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    bounded_history = request.history[-MAX_HISTORY_MESSAGES:]
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
                        # Explicit breakpoint — verified empirically that Gemini via
                        # OpenRouter does NOT reliably cache on an identical prefix alone
                        # (implicit caching); this cache_control marker is what actually
                        # triggers the ~90% cost reduction on repeat requests within the TTL.
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
            },
            *[{"role": m.role, "content": m.content} for m in bounded_history],
            {"role": "user", "content": request.message},
        ],
    }
    return StreamingResponse(_stream_openrouter(payload), media_type="text/event-stream")
