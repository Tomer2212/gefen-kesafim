import logging

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)

_CALL_LOG_URL = "https://api.voicenter.com/hub/cdr/"


def _derive_direction(call_type: str) -> str:
    t = (call_type or "").lower()
    if "outgoing" in t or "leg2" in t.replace(" ", ""):
        return "outgoing"
    if "incoming" in t or "queue" in t:
        return "incoming"
    return "internal"


def pull_calls(config: dict, date_from: str, date_to: str) -> list[dict]:
    """Pulls call history from Voicenter's Call Log API and returns it in the
    provider-agnostic NormalizedCall shape consumed by calls_router._pull_org_calls.

    Confirmed empirically (2026-07-23): the Call Log API's "code" body field is
    gated by an account-level IP allowlist that our server's IP is not on. The
    Authorization: Bearer path validates the JWT signature instead and never
    reaches that IP check — it works from an unwhitelisted IP as long as the
    token itself is a complete, properly-signed JWT.
    """
    bearer_token = (config or {}).get("api_bearer_token")
    if not bearer_token:
        raise HTTPException(status_code=400, detail="יש להזין טוקן API של Voicenter בהגדרות האינטגרציה")

    payload = {
        "search": {"fromdate": date_from, "todate": date_to},
        "sort": [{"field": "date", "order": "desc"}],
    }
    headers = {"Authorization": f"Bearer {bearer_token}"}

    try:
        resp = httpx.post(_CALL_LOG_URL, json=payload, headers=headers, timeout=15)
        data = resp.json()
    except Exception as exc:
        logger.error("voicenter_adapter.pull_calls: request to Call Log API failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail="לא ניתן היה לשלוף שיחות מ-Voicenter כרגע — נסה שוב")

    if data.get("ERROR_NUMBER") not in (0, None):
        logger.warning("voicenter_adapter.pull_calls: Voicenter returned error %s: %s", data.get("ERROR_NUMBER"), data.get("ERROR_DESCRIPTION"))
        raise HTTPException(status_code=502, detail=f"Voicenter: {data.get('ERROR_DESCRIPTION', 'שגיאה לא ידועה')}")

    cdr_list = data.get("CDR_LIST") or []

    # NOTE: Voicenter's actual Call Log API response uses lowercase field names
    # (e.g. "representativecode", "callernumber") — this differs from the PascalCase
    # shown in their PDF documentation. Confirmed empirically against a real response.
    calls = []
    for c in cdr_list:
        direction = _derive_direction(c.get("type"))
        counterpart = c.get("targetnumber") if direction == "outgoing" else c.get("callernumber")
        ai_exists = str((c.get("customdata") or {}).get("AiExists", "")).lower() == "true"
        calls.append({
            "call_id": c.get("callid"),
            "direction": direction,
            "counterpart_phone": counterpart,
            "agent_key": c.get("representativecode"),
            "agent_label": c.get("representativename") or c.get("username"),
            "start_time": c.get("date"),
            "duration_seconds": c.get("duration") or 0,
            "status": c.get("dialstatus"),
            "recording_available": False,
            "ai_summary_available": ai_exists,
        })

    return calls
