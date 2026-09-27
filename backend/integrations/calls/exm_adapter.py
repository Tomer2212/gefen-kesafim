import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.exm.co.il/v1"
_PAGE_ITEMS = 100
_MAX_PAGES = 50  # safety cap — 50 * 100 = 5,000 calls per pull, far above any realistic window
_IL_TZ = ZoneInfo("Asia/Jerusalem")


def _to_exm_timestamp(naive_local_str: str) -> str:
    """Callers of _pull_org_calls (the /calls list endpoint, the cron, schools_router)
    all pass plain naive date/time strings that represent Asia/Jerusalem wall-clock time —
    the same convention Voicenter's search filter already assumes. EXM's docs are explicit
    that its API expects ISO 8601 WITH a timezone offset (e.g. "...T15:00:00+03:00") and
    will otherwise misinterpret the bound — confirmed empirically (2026-09-27): sending a
    bare UTC-valued string with no offset silently returned zero calls, because EXM read it
    as Israel-local, shifting the window ~3 hours earlier than intended and cutting off
    calls made minutes earlier. Attaching the explicit Asia/Jerusalem offset here removes
    the ambiguity regardless of what convention the caller's naive string assumed.
    """
    dt = datetime.fromisoformat(naive_local_str).replace(tzinfo=_IL_TZ)
    return dt.isoformat()


def _call_time_to_utc_iso(local_str: str | None) -> str | None:
    """EXM's `time.start`/`time.end` come back as naive Asia/Jerusalem wall-clock strings
    (e.g. "2026-09-27 12:33:09" — no offset; confirmed against the live API). Every consumer
    of a call's start_time (schools_router._call_time_to_israel_hm, meeting attribution,
    etc.) assumes — correctly, for Voicenter — that a naive/no-offset timestamp is UTC, and
    converts it to Israel local by ADDING the UTC offset. Feeding EXM's already-local value
    through unconverted double-shifts it forward (seen once already: a 12:33 call rendered
    as 15:33 in the meeting's "תחילת שיחה" field). Converting to a real UTC-labelled ISO
    string here makes EXM's calls indistinguishable, timestamp-wise, from Voicenter's.
    """
    if not local_str:
        return None
    try:
        dt = datetime.fromisoformat(local_str).replace(tzinfo=_IL_TZ)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return local_str


def _derive_direction(call_type: str) -> str:
    t = (call_type or "").lower()
    if t.startswith("outgoing"):
        return "outgoing"
    if t.startswith("incoming"):
        return "incoming"
    return "internal"


def _derive_status(call_type: str) -> str:
    """EXM has no separate dial-status field like Voicenter's ANSWER/NOANSWER/BUSY/etc —
    the closest signal is the "_missed" suffix on `type`. Mapped onto Voicenter's status
    vocabulary so the existing frontend (CallRow.jsx STATUS_LABELS) renders a meaningful
    label instead of falling through to "לא ידוע" for every EXM call."""
    t = (call_type or "").lower()
    return "NOANSWER" if "missed" in t else "ANSWER"


def _headers(config: dict) -> dict:
    api_key = (config or {}).get("api_key")
    if not api_key:
        raise HTTPException(status_code=400, detail="יש להזין מפתח API של EXM בהגדרות האינטגרציה")
    return {"Authorization": f"Bearer {api_key}"}


def pull_calls(config: dict, date_from: str, date_to: str) -> list[dict]:
    """Pulls call history from EXM's Calls API and returns it in the provider-
    agnostic NormalizedCall shape consumed by calls_router._pull_org_calls.

    EXM has no per-call "agent/representative" field — the only thing tying a
    call to one of our users is which line (numbers.own.e164) it went through.
    That's why agent_key here is the line's e164, not a rep code (see
    calls_agent_mappings.provider='exm' rows, mapped by line instead of rep code).

    EXM returns business errors as HTTP 200 with success:false — never rely on
    the HTTP status code alone.
    """
    headers = _headers(config)
    calls: list[dict] = []
    cursor: str | None = None

    for _ in range(_MAX_PAGES):
        body = {
            "time": {"from": _to_exm_timestamp(date_from), "to": _to_exm_timestamp(date_to)},
            "pagination": {"items": _PAGE_ITEMS, **({"next": cursor} if cursor else {})},
        }
        try:
            resp = httpx.post(f"{_BASE_URL}/calls/", json=body, headers=headers, timeout=15)
            data = resp.json()
        except Exception as exc:
            logger.error("exm_adapter.pull_calls: request to Calls API failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=502, detail="לא ניתן היה לשלוף שיחות מ-EXM כרגע — נסה שוב")

        if data.get("success") is False:
            err = data.get("error") or {}
            errors = data.get("errors") or []
            desc = err.get("message") or (errors[0].get("description") if errors else None) or "שגיאה לא ידועה"
            logger.warning("exm_adapter.pull_calls: EXM returned an error: %s", desc)
            raise HTTPException(status_code=502, detail=f"EXM: {desc}")

        for c in data.get("calls") or []:
            direction = _derive_direction(c.get("type"))
            numbers = c.get("numbers") or {}
            own = numbers.get("own") or {}
            caller = numbers.get("caller") or {}
            destination = numbers.get("destination") or {}
            counterpart = destination.get("e164") if direction == "outgoing" else caller.get("e164")
            # Fall back to the "friendly" local format when e164 is missing — seen in
            # practice on at least one demo/test line, where `numbers.own.e164` came back
            # empty even though `numbers.own.friendly` was populated. agent_key only needs
            # to be a stable identifier for this line, not strictly E.164.
            agent_key = own.get("e164") or own.get("friendly")
            calls.append({
                "call_id": c.get("id"),
                "direction": direction,
                "counterpart_phone": counterpart,
                "agent_key": agent_key,
                "agent_label": own.get("friendly"),
                "start_time": _call_time_to_utc_iso((c.get("time") or {}).get("start")),
                "duration_seconds": c.get("duration") or 0,
                "status": _derive_status(c.get("type")),
                "recording_available": bool(c.get("recording")),
                "ai_summary_available": False,
            })

        cursor = (data.get("metadata") or {}).get("next_page_token")
        if not cursor:
            break

    return calls


def get_recording_url(config: dict, call_id: str) -> str | None:
    """Trades a call id for a short-lived (10 min) signed recording URL."""
    headers = _headers(config)
    body = {"ids": [call_id], "config": {"ttl": 10}}

    try:
        resp = httpx.post(f"{_BASE_URL}/calls/get-recording-urls/", json=body, headers=headers, timeout=15)
        data = resp.json()
    except Exception as exc:
        logger.error("exm_adapter.get_recording_url: request failed for call=%s: %s", call_id, exc, exc_info=True)
        raise HTTPException(status_code=502, detail="לא ניתן היה לטעון את ההקלטה כרגע")

    if data.get("success") is False:
        desc = (data.get("error") or {}).get("message", "שגיאה לא ידועה")
        logger.warning("exm_adapter.get_recording_url: EXM returned an error for call=%s: %s", call_id, desc)
        raise HTTPException(status_code=502, detail=f"EXM: {desc}")

    for entry in data.get("urls") or []:
        if entry.get("id") == call_id and entry.get("code") == 0:
            return entry.get("url")
    return None
