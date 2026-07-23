import json
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user
from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)
router = APIRouter()

_MANAGER_ROLES = ("owner", "manager")
_CALL_LOG_URL = "https://api.voicenter.com/hub/cdr/"
_TRANSCRIPTS_BUCKET = "voicenter-transcripts"


def _build_webhook_url(org_id: str, secret_value: str) -> str:
    base_url = os.getenv("BACKEND_PUBLIC_URL", "").rstrip("/")
    return f"{base_url}/voicenter/webhook/{org_id}/{secret_value}"


def _require_manager(user: dict) -> None:
    if user["role"] not in _MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="אין הרשאה")


def _require_owner(user: dict) -> None:
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="פעולה זו מותרת לבעלים בלבד")


def _derive_direction(call_type: str) -> str:
    t = (call_type or "").lower()
    if "outgoing" in t or "leg2" in t.replace(" ", ""):
        return "outgoing"
    if "incoming" in t or "queue" in t:
        return "incoming"
    return "internal"


def _get_integration_config(org_id: str) -> dict | None:
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_integrations")
                .select("*")
                .eq("org_id", org_id)
                .limit(1)
                .execute()
            ).data
            return rows[0] if rows else None
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter: failed to load integration config: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")


# ---------------------------------------------------------------------------
# Settings — authenticated (owner + manager). Stores ONLY our own credentials
# for calling Voicenter's Call Log API (their account code / bearer token) —
# never any call data itself.
# ---------------------------------------------------------------------------

class VoicenterSettingsIn(BaseModel):
    enabled: bool | None = None
    api_code: str | None = None
    api_bearer_token: str | None = None


@router.get("/settings")
def get_settings(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)

    row = _get_integration_config(user["org_id"])
    if not row:
        for attempt in range(2):
            try:
                db = get_admin_client()
                row = (
                    db.table("voicenter_integrations")
                    .insert({"org_id": user["org_id"], "enabled": True, "webhook_secret": secrets.token_urlsafe(32)})
                    .execute()
                ).data[0]
                break
            except Exception as exc:
                if attempt == 0:
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.error("voicenter get_settings: failed to create default config: %s", exc, exc_info=True)
                    raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
    elif not row.get("webhook_secret"):
        # Existing rows created before the webhook_secret column existed
        new_secret = secrets.token_urlsafe(32)
        for attempt in range(2):
            try:
                db = get_admin_client()
                db.table("voicenter_integrations").update({"webhook_secret": new_secret}).eq("org_id", user["org_id"]).execute()
                row["webhook_secret"] = new_secret
                break
            except Exception as exc:
                if attempt == 0:
                    reset_admin_client()
                    time.sleep(0.1)
                else:
                    logger.error("voicenter get_settings: failed to backfill webhook_secret: %s", exc, exc_info=True)
                    raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {
        "enabled": row["enabled"],
        "has_api_code": bool(row.get("api_code")),
        "has_bearer_token": bool(row.get("api_bearer_token")),
        "webhook_url": _build_webhook_url(user["org_id"], row["webhook_secret"]),
    }


@router.put("/settings")
def update_settings(user: Annotated[dict, Depends(get_current_user)], body: VoicenterSettingsIn):
    _require_manager(user)

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.enabled is not None:
        updates["enabled"] = body.enabled
    if body.api_code is not None:
        updates["api_code"] = body.api_code or None
    if body.api_bearer_token is not None:
        updates["api_bearer_token"] = body.api_bearer_token or None

    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("voicenter_integrations").update(updates).eq("org_id", user["org_id"]).execute()
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter update_settings failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"ok": True}


# ---------------------------------------------------------------------------
# Webhook — PUBLIC, no Supabase-JWT auth (Voicenter calls this directly).
# Deliberately narrow: captures ONLY the AI summary + transcript, since that's
# the one thing NOT available via the Call Log (pull) API. Every other call
# field continues to come live from the pull API above — nothing else is
# ever written here.
# ---------------------------------------------------------------------------

@router.post("/webhook/{org_id}/{secret}")
async def voicenter_webhook(org_id: str, secret: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        return {"err": 2, "errdesc": "invalid JSON body"}

    for attempt in range(2):
        try:
            db = get_admin_client()
            cfg_rows = (
                db.table("voicenter_integrations")
                .select("id, enabled, webhook_secret")
                .eq("org_id", org_id)
                .limit(1)
                .execute()
            ).data
            cfg = cfg_rows[0] if cfg_rows else None
            break
        except Exception as exc:
            if attempt == 0:
                logger.warning("voicenter_webhook: DB attempt 1 failed for org=%s: %s — retrying", org_id, exc)
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter_webhook: DB unreachable for org=%s: %s", org_id, exc, exc_info=True)
                return {"err": 2, "errdesc": "temporary server error"}

    if not cfg or cfg.get("webhook_secret") != secret or not cfg.get("enabled"):
        logger.warning("voicenter_webhook: rejected org=%s (missing config, secret mismatch, or disabled)", org_id)
        return {"err": 2, "errdesc": "unauthorized or disabled"}

    call_id = body.get("ivruniqueid")
    if not call_id:
        logger.warning("voicenter_webhook: payload missing ivruniqueid for org=%s", org_id)
        return {"err": 2, "errdesc": "missing ivruniqueid"}

    ai_data = body.get("aiData") or {}
    summary = ((ai_data.get("insights") or {}).get("summary"))
    transcript = ai_data.get("transcript")

    transcript_path = None
    if transcript:
        transcript_path = f"{org_id}/{call_id}.json"
        try:
            db.storage.from_(_TRANSCRIPTS_BUCKET).upload(
                transcript_path,
                json.dumps(transcript, ensure_ascii=False).encode("utf-8"),
                {"content-type": "application/json", "upsert": "true"},
            )
        except Exception as exc:
            logger.warning("voicenter_webhook: transcript upload failed (non-fatal) for call=%s: %s", call_id, exc)
            transcript_path = None

    try:
        db.table("voicenter_call_ai").upsert(
            {"org_id": org_id, "call_id": call_id, "summary": summary, "transcript_path": transcript_path},
            on_conflict="org_id,call_id",
        ).execute()
    except Exception as exc:
        logger.error("voicenter_webhook: upsert failed for org=%s call_id=%s: %s", org_id, call_id, exc, exc_info=True)
        return {"err": 2, "errdesc": "storage failure"}

    return {"err": 0, "errdesc": "OK"}


# ---------------------------------------------------------------------------
# Calls — live pull from Voicenter's Call Log API on every request.
# Nothing about the calls themselves is ever written to Supabase.
# ---------------------------------------------------------------------------

@router.get("/calls")
def list_calls(
    user: Annotated[dict, Depends(get_current_user)],
    date_from: str,
    date_to: str,
    advisor_id: str | None = None,
):
    _require_manager(user)

    cfg = _get_integration_config(user["org_id"])
    if not cfg or not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="אינטגרציית Voicenter אינה מוגדרת או כבויה")
    if not cfg.get("api_bearer_token"):
        raise HTTPException(status_code=400, detail="יש להזין טוקן API של Voicenter בהגדרות האינטגרציה")

    # Confirmed empirically (2026-07-23): the Call Log API's "code" body field
    # is gated by an account-level IP allowlist that our server's IP is not on.
    # The Authorization: Bearer path validates the JWT signature instead and
    # never reaches that IP check — it works from an unwhitelisted IP as long
    # as the token itself is a complete, properly-signed JWT.
    payload = {
        "search": {"fromdate": date_from, "todate": date_to},
        "sort": [{"field": "date", "order": "desc"}],
    }
    headers = {"Authorization": f"Bearer {cfg['api_bearer_token']}"}

    try:
        resp = httpx.post(_CALL_LOG_URL, json=payload, headers=headers, timeout=15)
        data = resp.json()
    except Exception as exc:
        logger.error("voicenter list_calls: request to Call Log API failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail="לא ניתן היה לשלוף שיחות מ-Voicenter כרגע — נסה שוב")

    if data.get("ERROR_NUMBER") not in (0, None):
        logger.warning("voicenter list_calls: Voicenter returned error %s: %s", data.get("ERROR_NUMBER"), data.get("ERROR_DESCRIPTION"))
        raise HTTPException(status_code=502, detail=f"Voicenter: {data.get('ERROR_DESCRIPTION', 'שגיאה לא ידועה')}")

    cdr_list = data.get("CDR_LIST") or []

    # Rep→advisor mapping is OUR OWN data (not Voicenter's), stored locally — non-fatal enrichment
    # NOTE: Voicenter's actual Call Log API response uses lowercase field names
    # (e.g. "representativecode", "callernumber") — this differs from the PascalCase
    # shown in their PDF documentation. Confirmed empirically against a real response.
    rep_codes = list({c.get("representativecode") for c in cdr_list if c.get("representativecode")})
    mapping_by_code: dict = {}
    profiles_map: dict = {}
    if rep_codes:
        try:
            db = get_admin_client()
            m_rows = (
                db.table("voicenter_rep_mappings")
                .select("representative_code, advisor_id")
                .eq("org_id", user["org_id"])
                .in_("representative_code", rep_codes)
                .execute()
            ).data or []
            mapping_by_code = {m["representative_code"]: m["advisor_id"] for m in m_rows}
            advisor_ids = list(set(mapping_by_code.values()))
            if advisor_ids:
                p_rows = db.table("profiles").select("id, full_name, email").in_("id", advisor_ids).execute()
                profiles_map = {p["id"]: p for p in (p_rows.data or [])}
        except Exception as exc:
            logger.warning("voicenter list_calls: advisor mapping enrichment failed (non-fatal): %s", exc)

    # AI summary/transcript come only from our own webhook capture (voicenter_call_ai) —
    # the Call Log API never returns them (confirmed empirically). Non-fatal enrichment,
    # same pattern as the rep→advisor mapping above.
    call_ids = [c.get("callid") for c in cdr_list if c.get("callid")]
    ai_by_call_id: dict = {}
    if call_ids:
        try:
            db = get_admin_client()
            ai_rows = (
                db.table("voicenter_call_ai")
                .select("call_id, summary, transcript_path")
                .eq("org_id", user["org_id"])
                .in_("call_id", call_ids)
                .execute()
            ).data or []
            ai_by_call_id = {r["call_id"]: r for r in ai_rows}
        except Exception as exc:
            logger.warning("voicenter list_calls: AI summary enrichment failed (non-fatal): %s", exc)

    calls = []
    for c in cdr_list:
        rep_code = c.get("representativecode")
        mapped_advisor_id = mapping_by_code.get(rep_code)
        if advisor_id and mapped_advisor_id != advisor_id:
            continue
        direction = _derive_direction(c.get("type"))
        counterpart = c.get("targetnumber") if direction == "outgoing" else c.get("callernumber")
        duration = c.get("duration") or 0
        ai_exists = str((c.get("customdata") or {}).get("AiExists", "")).lower() == "true"
        call_id = c.get("callid")
        ai_row = ai_by_call_id.get(call_id)
        calls.append({
            "call_id": call_id,
            "direction": direction,
            "counterpart_phone": counterpart,
            "representative_code": rep_code,
            "representative_name": c.get("representativename") or c.get("username"),
            "advisor_id": mapped_advisor_id,
            "advisor_profile": profiles_map.get(mapped_advisor_id),
            "start_time": c.get("date"),
            "duration_seconds": duration,
            "status": c.get("dialstatus"),
            "recording_url": c.get("recordurl"),
            "queue_name": c.get("queuename"),
            "department_name": c.get("departmentname"),
            "ai_summary": ai_row["summary"] if ai_row else None,
            "ai_summary_available": ai_exists,
            "ai_transcript_available": bool(ai_row and ai_row.get("transcript_path")),
        })

    return {"calls": calls, "total_hits": data.get("TOTAL_HITS"), "returned_hits": data.get("RETURN_HITS")}


@router.get("/calls/{call_id}/transcript")
def get_call_transcript(user: Annotated[dict, Depends(get_current_user)], call_id: str):
    _require_manager(user)

    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_call_ai")
                .select("transcript_path")
                .eq("org_id", user["org_id"])
                .eq("call_id", call_id)
                .limit(1)
                .execute()
            ).data
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter get_call_transcript failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    transcript_path = rows[0]["transcript_path"] if rows else None
    if not transcript_path:
        raise HTTPException(status_code=404, detail="לא נמצא תמלול לשיחה זו")

    try:
        signed = db.storage.from_(_TRANSCRIPTS_BUCKET).create_signed_url(transcript_path, 60)
        signed_url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as exc:
        logger.error("voicenter get_call_transcript: failed to sign URL for %s: %s", transcript_path, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="לא ניתן היה לטעון את התמלול כרגע")

    return {"url": signed_url}


# ---------------------------------------------------------------------------
# Rep → advisor mappings — OUR OWN data, authenticated (owner + manager)
# ---------------------------------------------------------------------------

class RepMappingIn(BaseModel):
    representative_code: str
    representative_name: str | None = None
    advisor_id: str


@router.get("/mappings")
def list_mappings(user: Annotated[dict, Depends(get_current_user)]):
    _require_manager(user)

    rows: list = []
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_rep_mappings")
                .select("*")
                .eq("org_id", user["org_id"])
                .order("representative_name")
                .execute()
            ).data or []
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter list_mappings failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    advisor_ids = list({r["advisor_id"] for r in rows if r.get("advisor_id")})
    profiles_map: dict = {}
    if advisor_ids:
        try:
            db = get_admin_client()
            p_rows = db.table("profiles").select("id, full_name, email").in_("id", advisor_ids).execute()
            profiles_map = {p["id"]: p for p in (p_rows.data or [])}
        except Exception as exc:
            logger.warning("voicenter list_mappings: advisor enrichment failed (non-fatal): %s", exc)

    for r in rows:
        r["advisor_profile"] = profiles_map.get(r.get("advisor_id"))

    return rows


@router.post("/mappings")
def upsert_mapping(user: Annotated[dict, Depends(get_current_user)], body: RepMappingIn):
    _require_manager(user)

    row = {
        "org_id": user["org_id"],
        "representative_code": body.representative_code,
        "representative_name": body.representative_name,
        "advisor_id": body.advisor_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = None
    for attempt in range(2):
        try:
            db = get_admin_client()
            result = (
                db.table("voicenter_rep_mappings")
                .upsert(row, on_conflict="org_id,representative_code")
                .execute()
            )
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter upsert_mapping failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return result.data[0] if result.data else row


@router.delete("/mappings/{mapping_id}")
def delete_mapping(user: Annotated[dict, Depends(get_current_user)], mapping_id: str):
    _require_manager(user)

    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("voicenter_rep_mappings").delete().eq("id", mapping_id).eq("org_id", user["org_id"]).execute()
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("voicenter delete_mapping failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"ok": True}
