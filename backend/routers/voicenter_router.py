import json
import logging
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
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
CRON_SECRET = os.getenv("CRON_SECRET", "")

# Minimum call length (seconds) for an unknown-number call to be worth prompting the
# advisor about — filters out missed calls / hang-ups.
UNKNOWN_CALL_MIN_SECONDS = 10
# How many further calls from the same unknown number (to the same advisor) must arrive
# after that advisor answered "not a school" before we prompt them about it again.
UNKNOWN_CALL_REPROMPT_AFTER = 3


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


def _phone_suffix(raw) -> str | None:
    """Normalize a phone number to its last 9 digits, so '972524399715', '0524399715'
    and '524399715' all compare equal — strips country code / leading zero variance."""
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    return digits[-9:] if len(digits) >= 9 else (digits or None)


def _build_contact_map(org_id: str) -> dict:
    """OUR OWN data (schools/contacts) — not Voicenter's — used to resolve the
    counterpart phone number of a call to known person(s), their role, and school(s).
    Returns dict[phone_suffix] -> list of matches (usually one; more than one means the
    same phone number is a contact at multiple schools — an ambiguity the caller must
    resolve, not silently pick a "winner")."""
    contact_map: dict = {}
    try:
        db = get_admin_client()
        rows = (
            db.table("schools")
            .select("id, name, school_phone, principal_name, principal_phone, "
                     "principal_chativa_name, principal_chativa_phone, "
                     "secretary_name, secretary_phone, "
                     "finance_contact_name, finance_contact_phone, extra_contacts")
            .eq("org_id", org_id)
            .execute()
        ).data or []
        for s in rows:
            school_id = s.get("id")
            school_name = s.get("name")
            for name_field, phone_field, role_label in (
                ("principal_name", "principal_phone", "מנהל/ת"),
                ("principal_chativa_name", "principal_chativa_phone", "מנהל/ת חט\"ב"),
                ("secretary_name", "secretary_phone", "מנהלנ/ית"),
                ("finance_contact_name", "finance_contact_phone", "אחראי/ת כספים"),
            ):
                suffix = _phone_suffix(s.get(phone_field))
                if suffix and s.get(name_field):
                    contact_map.setdefault(suffix, []).append(
                        {"name": s[name_field], "role": role_label, "school_id": school_id, "school_name": school_name}
                    )
            for ec in (s.get("extra_contacts") or []):
                suffix = _phone_suffix(ec.get("phone"))
                if suffix and ec.get("name"):
                    contact_map.setdefault(suffix, []).append(
                        {"name": ec["name"], "role": ec.get("role") or "", "school_id": school_id, "school_name": school_name}
                    )
            # The school's own main line (פרטי מוסד → "טלפון בית הספר") belongs to the school
            # just as certainly as any named contact. Register it as a synthetic contact so
            # calls from that number resolve to the school. Skip if it duplicates a number
            # already mapped to THIS school (otherwise it would look ambiguous within one school).
            school_suffix = _phone_suffix(s.get("school_phone"))
            if school_suffix and not any(
                m["school_id"] == school_id for m in contact_map.get(school_suffix, [])
            ):
                contact_map.setdefault(school_suffix, []).append(
                    {"name": school_name, "role": "טלפון בית הספר", "school_id": school_id, "school_name": school_name}
                )
    except Exception as exc:
        logger.warning("voicenter: contact map enrichment failed (non-fatal): %s", exc)
    return contact_map


def _get_call_resolutions(org_id: str, call_ids: list[str]) -> dict:
    """Existing voicenter_call_contact_resolutions rows for the given call_ids, keyed by call_id."""
    if not call_ids:
        return {}
    try:
        db = get_admin_client()
        rows = (
            db.table("voicenter_call_contact_resolutions")
            .select("*")
            .eq("org_id", org_id)
            .in_("call_id", call_ids)
            .execute()
        ).data or []
        return {r["call_id"]: r for r in rows}
    except Exception as exc:
        logger.warning("voicenter: call resolutions lookup failed (non-fatal): %s", exc)
        return {}


def _get_manual_school_overrides(org_id: str, call_ids: list[str]) -> tuple[dict, dict]:
    """Manual per-school overrides for the given call_ids (voicenter_call_school_links).
    Two independent, per-call kinds of override:
    - 'linked' — manually attaches a call to a school's שיחות tab, IN ADDITION to (never
      instead of) any auto-detected contact match. A call can be linked to any number of
      schools.
    - 'excluded' — hides a call from ONE specific school's שיחות tab only (e.g. an owner/
      manager removed a row from that school's card). This is purely local to that school's
      tab: it never touches the underlying Voicenter/AI call data, never affects any other
      school's tab, and never affects the admin "ניהול-שיחות" table, which always shows
      every call regardless of any school's exclusion.
    Returns (linked_by_call_id, excluded_by_call_id), each call_id -> list of school_ids."""
    if not call_ids:
        return {}, {}
    try:
        db = get_admin_client()
        rows = (
            db.table("voicenter_call_school_links")
            .select("call_id, school_id, state")
            .eq("org_id", org_id)
            .in_("call_id", call_ids)
            .execute()
        ).data or []
        linked: dict = {}
        excluded: dict = {}
        for r in rows:
            target = excluded if r.get("state") == "excluded" else linked
            target.setdefault(r["call_id"], []).append(r["school_id"])
        return linked, excluded
    except Exception as exc:
        logger.warning("voicenter: manual school overrides lookup failed (non-fatal): %s", exc)
        return {}, {}


def _resolve_contact_for_call(contact_map: dict, resolutions_by_call_id: dict, call_id: str, counterpart: str) -> dict:
    """Resolves a single call's contact/school given the org-wide contact_map and any
    persisted resolutions. Returns a dict with contact_name/contact_role/school_id/
    school_name (all possibly None) plus pending_school_resolution + candidate_schools
    for the ambiguous-and-unresolved case."""
    matches = contact_map.get(_phone_suffix(counterpart)) or []
    if len(matches) <= 1:
        m = matches[0] if matches else None
        return {
            "contact_name": m["name"] if m else None,
            "contact_role": m["role"] if m else None,
            "school_id": m["school_id"] if m else None,
            "school_name": m["school_name"] if m else None,
            "pending_school_resolution": False,
            "candidate_schools": None,
        }

    resolution = resolutions_by_call_id.get(call_id)
    candidate_schools = [{"id": m["school_id"], "name": m["school_name"]} for m in matches]
    if resolution and resolution.get("resolved_school_id"):
        resolved_id = resolution["resolved_school_id"]
        resolved_match = next((m for m in matches if m["school_id"] == resolved_id), None)
        return {
            "contact_name": resolved_match["name"] if resolved_match else resolution.get("contact_name"),
            "contact_role": resolved_match["role"] if resolved_match else None,
            "school_id": resolved_id,
            "school_name": resolved_match["school_name"] if resolved_match else None,
            "pending_school_resolution": False,
            "candidate_schools": None,
        }

    return {
        "contact_name": matches[0]["name"],
        "contact_role": None,
        "school_id": None,
        "school_name": None,
        "pending_school_resolution": True,
        "candidate_schools": candidate_schools,
    }


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
# Nothing about the calls themselves is ever written to Supabase (except the
# ambiguous-contact resolution rows in voicenter_call_contact_resolutions).
# ---------------------------------------------------------------------------

def _pull_org_calls(org_id: str, date_from: str, date_to: str) -> dict:
    """Shared puller: Call Log API fetch + advisor/AI/contact enrichment. Used by the admin
    /calls endpoint, the per-school /schools/{id}/calls endpoint, and the scheduled
    process-new-calls job. Raises HTTPException on hard failures (bad/missing config,
    Voicenter API errors) — callers that want a soft-fail (e.g. the cron job) should catch it."""
    cfg = _get_integration_config(org_id)
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
        logger.error("voicenter _pull_org_calls: request to Call Log API failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail="לא ניתן היה לשלוף שיחות מ-Voicenter כרגע — נסה שוב")

    if data.get("ERROR_NUMBER") not in (0, None):
        logger.warning("voicenter _pull_org_calls: Voicenter returned error %s: %s", data.get("ERROR_NUMBER"), data.get("ERROR_DESCRIPTION"))
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
                .eq("org_id", org_id)
                .in_("representative_code", rep_codes)
                .execute()
            ).data or []
            mapping_by_code = {m["representative_code"]: m["advisor_id"] for m in m_rows}
            advisor_ids = list(set(mapping_by_code.values()))
            if advisor_ids:
                p_rows = db.table("profiles").select("id, full_name, email").in_("id", advisor_ids).execute()
                profiles_map = {p["id"]: p for p in (p_rows.data or [])}
        except Exception as exc:
            logger.warning("voicenter _pull_org_calls: advisor mapping enrichment failed (non-fatal): %s", exc)

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
                .eq("org_id", org_id)
                .in_("call_id", call_ids)
                .execute()
            ).data or []
            ai_by_call_id = {r["call_id"]: r for r in ai_rows}
        except Exception as exc:
            logger.warning("voicenter _pull_org_calls: AI summary enrichment failed (non-fatal): %s", exc)

    # Contact matching is OUR OWN data (schools/contacts), not Voicenter's — resolves the
    # counterpart phone number to known person(s)/role/school(s). Non-fatal enrichment.
    contact_map = _build_contact_map(org_id)
    resolutions_by_call_id = _get_call_resolutions(org_id, call_ids)
    manual_links_by_call_id, manual_exclusions_by_call_id = _get_manual_school_overrides(org_id, call_ids)

    calls = []
    for c in cdr_list:
        rep_code = c.get("representativecode")
        mapped_advisor_id = mapping_by_code.get(rep_code)
        direction = _derive_direction(c.get("type"))
        counterpart = c.get("targetnumber") if direction == "outgoing" else c.get("callernumber")
        duration = c.get("duration") or 0
        ai_exists = str((c.get("customdata") or {}).get("AiExists", "")).lower() == "true"
        call_id = c.get("callid")
        ai_row = ai_by_call_id.get(call_id)
        contact = _resolve_contact_for_call(contact_map, resolutions_by_call_id, call_id, counterpart)
        calls.append({
            "call_id": call_id,
            "direction": direction,
            "counterpart_phone": counterpart,
            "contact_name": contact["contact_name"],
            "contact_role": contact["contact_role"],
            "school_id": contact["school_id"],
            "school_name": contact["school_name"],
            "pending_school_resolution": contact["pending_school_resolution"],
            "candidate_schools": contact["candidate_schools"],
            "linked_school_ids": manual_links_by_call_id.get(call_id, []),
            "excluded_school_ids": manual_exclusions_by_call_id.get(call_id, []),
            "representative_code": rep_code,
            "representative_name": c.get("representativename") or c.get("username"),
            "advisor_id": mapped_advisor_id,
            "advisor_profile": profiles_map.get(mapped_advisor_id),
            "start_time": c.get("date"),
            "duration_seconds": duration,
            "status": c.get("dialstatus"),
            "ai_summary": ai_row["summary"] if ai_row else None,
            "ai_summary_available": ai_exists,
            "ai_transcript_available": bool(ai_row and ai_row.get("transcript_path")),
        })

    return {"calls": calls, "total_hits": data.get("TOTAL_HITS"), "returned_hits": data.get("RETURN_HITS")}


@router.get("/calls")
def list_calls(
    user: Annotated[dict, Depends(get_current_user)],
    date_from: str,
    date_to: str,
    advisor_id: str | None = None,
):
    _require_manager(user)
    result = _pull_org_calls(user["org_id"], date_from, date_to)
    if advisor_id:
        result["calls"] = [c for c in result["calls"] if c["advisor_id"] == advisor_id]
    return result


class LinkCallSchoolIn(BaseModel):
    school_id: str


@router.post("/calls/{call_id}/link-school")
def link_call_school(
    call_id: str,
    body: LinkCallSchoolIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    """Manually attaches a call to a school's שיחות tab — independent of (and in addition
    to) any auto-detected contact match. A call can be linked to any number of schools;
    linking to one never removes it from another."""
    _require_manager(user)

    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("voicenter_call_school_links").upsert({
                "org_id": user["org_id"],
                "call_id": call_id,
                "school_id": body.school_id,
                "linked_by": user["id"],
                "state": "linked",
            }, on_conflict="org_id,call_id,school_id").execute()
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("link_call_school failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"ok": True}


class ExcludeCallSchoolIn(BaseModel):
    school_id: str


@router.post("/calls/{call_id}/exclude-from-school")
def exclude_call_from_school(
    call_id: str,
    body: ExcludeCallSchoolIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    """Hides a call from ONE specific school's שיחות tab — purely local to that school's
    card. Never deletes the underlying Voicenter/AI call data, never affects any other
    school's tab, and never affects the admin 'ניהול-שיחות' table (which keeps showing
    every call regardless). Owner/manager always allowed; advisor only if explicitly
    granted the can_remove_call_from_school permission (role default or per-user override —
    see schools_router.PERMISSION_DEFAULTS)."""
    from routers.schools_router import _advisor_has_access_to_school_row, _check_permission

    db = get_admin_client()
    if user["role"] not in _MANAGER_ROLES:
        if not _check_permission(db, user, "can_remove_call_from_school"):
            raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")
        school_row = db.table("schools").select("id, restrict_access_to").eq("id", body.school_id).eq("org_id", user["org_id"]).execute()
        if not school_row.data or not _advisor_has_access_to_school_row(db, user["id"], school_row.data[0]):
            raise HTTPException(status_code=403, detail="אין הרשאה לצפות בבית ספר זה")

    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("voicenter_call_school_links").upsert({
                "org_id": user["org_id"],
                "call_id": call_id,
                "school_id": body.school_id,
                "linked_by": user["id"],
                "state": "excluded",
            }, on_conflict="org_id,call_id,school_id").execute()
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("exclude_call_from_school failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"ok": True}


class ResolveCallContactSchoolIn(BaseModel):
    school_id: str


@router.patch("/calls/{call_id}/resolve-contact-school")
def resolve_call_contact_school(
    call_id: str,
    body: ResolveCallContactSchoolIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    """Resolves which school a call belongs to. Handles two resolution kinds:
    - 'ambiguous' — same contact number is a contact at several schools; the chosen school
      must be one of the candidates. Resolution flows back through _resolve_contact_for_call.
    - 'unknown' — the counterpart number matches no school at all; any school in the org is
      a valid target. Resolution is persisted as a manual voicenter_call_school_links row so
      the call shows in that school's שיחות tab and is attributed to a same-day meeting.
    Only the notified recipient(s) or an owner/manager may decide."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_call_contact_resolutions")
                .select("*")
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
                logger.error("resolve_call_contact_school failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if not rows:
        raise HTTPException(status_code=404, detail="לא נמצאה שיחה הממתינה לשיוך")
    resolution = rows[0]
    kind = resolution.get("kind") or "ambiguous"

    is_recipient = user["id"] in (resolution.get("notified_recipient_ids") or [])
    if not is_recipient and user["role"] not in _MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="אין הרשאה לשייך שיחה זו")

    if kind == "unknown":
        school_row = (
            db.table("schools").select("id, name")
            .eq("id", body.school_id).eq("org_id", user["org_id"]).limit(1).execute()
        ).data
        if not school_row:
            raise HTTPException(status_code=400, detail="בית הספר שנבחר אינו תקין")
    else:
        candidate_ids = [s["id"] for s in (resolution.get("candidate_schools") or [])]
        if body.school_id not in candidate_ids:
            raise HTTPException(status_code=400, detail="בית הספר שנבחר אינו אחד מהמועמדים לשיחה זו")

    now_iso = datetime.now(timezone.utc).isoformat()
    for attempt in range(2):
        try:
            db = get_admin_client()
            db.table("voicenter_call_contact_resolutions").update({
                "resolved_school_id": body.school_id,
                "resolved_by": user["id"],
                "resolved_at": now_iso,
            }).eq("id", resolution["id"]).execute()
            if kind == "unknown":
                # Unknown numbers have no contact_map entry to flow through — persist the
                # school attribution as a manual per-call link (same mechanism as the admin
                # "שייך שיחה לבית ספר" action).
                db.table("voicenter_call_school_links").upsert({
                    "org_id": user["org_id"],
                    "call_id": call_id,
                    "school_id": body.school_id,
                    "linked_by": user["id"],
                    "state": "linked",
                }, on_conflict="org_id,call_id,school_id").execute()
            # Mark every notification tied to this call as read for every recipient — a decision
            # made by one owner/manager shouldn't leave the same "pending" notification open for
            # the others who were notified as a fallback.
            recipient_ids = resolution.get("notified_recipient_ids") or []
            if recipient_ids:
                db.table("notifications").update({"read_at": now_iso}).in_(
                    "recipient_id", recipient_ids
                ).contains("data", {"call_id": call_id}).execute()
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("resolve_call_contact_school: update failed for call=%s: %s", call_id, exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if kind == "unknown":
        # Immediately attribute the newly-linked call to a same-day meeting + run the opt-in
        # auto-completion check, so the effect is visible now instead of after the 10-min cron.
        # Non-fatal: the link write above already succeeded and the cron will catch up anyway.
        try:
            from routers.schools_router import (
                _maybe_auto_complete_meeting,
                _recompute_meeting_call_activity,
            )
            call_time_iso = resolution.get("call_time")
            if call_time_iso:
                dt = datetime.fromisoformat(str(call_time_iso).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                from zoneinfo import ZoneInfo
                date_str = dt.astimezone(ZoneInfo("Asia/Jerusalem")).date().isoformat()
                result = _pull_org_calls(user["org_id"], f"{date_str}T00:00:00", f"{date_str}T23:59:59")
                calls_for_school = [
                    c for c in result["calls"]
                    if body.school_id not in (c.get("excluded_school_ids") or [])
                    and (c.get("school_id") == body.school_id or body.school_id in (c.get("linked_school_ids") or []))
                ]
                db = get_admin_client()
                affected = _recompute_meeting_call_activity(db, user["org_id"], body.school_id, date_str, calls_for_school)
                for mid in affected:
                    _maybe_auto_complete_meeting(db, user["org_id"], mid)
        except Exception as exc:
            logger.warning("resolve_call_contact_school: inline meeting recompute failed (non-fatal): %s", exc)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Unknown-number call prompts — the interrupting popup that asks the advisor
# whether an unrecognised number belongs to a school (and optionally saves it
# as a contact). Rows live in voicenter_call_contact_resolutions with kind='unknown'.
# ---------------------------------------------------------------------------

def _fmt_phone(raw) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 12 and digits.startswith("972"):
        digits = "0" + digits[3:]
    return digits or str(raw or "")


@router.get("/calls/unknown/my-prompts")
def list_my_unknown_call_prompts(user: Annotated[dict, Depends(get_current_user)]):
    """Open 'unknown number' prompts addressed to the current user — feeds the Sidebar poll
    that raises the interrupting popup. Denormalised call fields on the row mean no Voicenter
    round-trip is needed here."""
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_call_contact_resolutions")
                .select("call_id, call_time, call_direction, call_duration_seconds, counterpart_phone")
                .eq("org_id", user["org_id"])
                .eq("kind", "unknown")
                .eq("caller_advisor_id", user["id"])
                .is_("resolved_school_id", "null")
                .is_("dismissed_at", "null")
                .order("call_time", desc=True)
                .execute()
            ).data or []
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("list_my_unknown_call_prompts failed after 2 attempts: %s", exc)
                return {"prompts": []}

    return {"prompts": [{
        "call_id": r["call_id"],
        "call_time": r.get("call_time"),
        "direction": r.get("call_direction"),
        "duration_seconds": r.get("call_duration_seconds") or 0,
        "counterpart_phone": r.get("counterpart_phone"),
        "counterpart_phone_display": _fmt_phone(r.get("counterpart_phone")),
    } for r in rows]}


@router.post("/calls/{call_id}/dismiss-unknown")
def dismiss_unknown_call(call_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Advisor answered 'not a school'. Per-user: mutes this number for THIS advisor only,
    and re-prompts them after UNKNOWN_CALL_REPROMPT_AFTER further calls from it."""
    now_iso = datetime.now(timezone.utc).isoformat()
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_call_contact_resolutions")
                .select("*")
                .eq("org_id", user["org_id"]).eq("call_id", call_id).eq("kind", "unknown")
                .limit(1).execute()
            ).data
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.error("dismiss_unknown_call failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    if not rows:
        raise HTTPException(status_code=404, detail="לא נמצאה שיחה הממתינה לשיוך")
    resolution = rows[0]
    if resolution.get("caller_advisor_id") != user["id"] and user["role"] not in _MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="אין הרשאה לפעולה זו")

    suffix = resolution.get("contact_phone_suffix") or _phone_suffix(resolution.get("counterpart_phone"))
    try:
        db = get_admin_client()
        db.table("voicenter_call_contact_resolutions").update({
            "dismissed_at": now_iso, "dismissed_by": user["id"],
        }).eq("id", resolution["id"]).execute()
        if suffix:
            db.table("voicenter_unknown_number_state").upsert({
                "org_id": user["org_id"],
                "advisor_id": user["id"],
                "phone_suffix": suffix,
                "muted": True,
                "calls_since_prompt": 0,
                "last_dismissed_at": now_iso,
                "updated_at": now_iso,
            }, on_conflict="org_id,advisor_id,phone_suffix").execute()
        db.table("notifications").update({"read_at": now_iso}).eq(
            "recipient_id", user["id"]
        ).contains("data", {"call_id": call_id}).execute()
    except Exception as exc:
        logger.error("dismiss_unknown_call: write failed for call=%s: %s", call_id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"ok": True}


class SaveCallContactIn(BaseModel):
    school_id: str
    role: str | None = None
    name: str
    phone: str
    email: str | None = None


@router.post("/calls/{call_id}/save-contact")
def save_call_contact(
    call_id: str,
    body: SaveCallContactIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    """Optional follow-up after an unknown call was attributed: save the number as a contact
    of the chosen school. Immediate write if the user may edit the school directly (and, for
    an advisor, is assigned to it); otherwise a school_update_request for owner/manager review."""
    from routers.schools_router import (
        _advisor_has_access_to_school_row,
        _check_permission,
        _create_notifications,
        _get_approver_ids,
    )

    db = get_admin_client()
    school_rows = (
        db.table("schools").select("id, name, extra_contacts, restrict_access_to")
        .eq("id", body.school_id).eq("org_id", user["org_id"]).limit(1).execute()
    ).data
    if not school_rows:
        raise HTTPException(status_code=404, detail="בית ספר לא נמצא")
    school = school_rows[0]

    existing = list(school.get("extra_contacts") or [])
    new_suffix = _phone_suffix(body.phone)
    if any(_phone_suffix(ec.get("phone")) == new_suffix for ec in existing):
        return {"mode": "duplicate", "detail": "המספר כבר קיים ברשימת אנשי הקשר"}
    new_contact = {
        "role": (body.role or "").strip(),
        "name": body.name.strip(),
        "phone": body.phone.strip(),
        "email": (body.email or "").strip(),
    }
    next_contacts = existing + [new_contact]

    is_manager = user["role"] in _MANAGER_ROLES
    can_direct = is_manager or (
        _check_permission(db, user, "can_edit_school_directly")
        and _advisor_has_access_to_school_row(db, user["id"], school)
    )

    if can_direct:
        try:
            db.table("schools").update({"extra_contacts": next_contacts}).eq("id", body.school_id).execute()
        except Exception as exc:
            logger.error("save_call_contact: direct update failed for school=%s: %s", body.school_id, exc, exc_info=True)
            raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
        return {"mode": "applied"}

    if not _check_permission(db, user, "can_request_school_update"):
        raise HTTPException(status_code=403, detail="אין הרשאה לשמור איש קשר לבית ספר זה")

    try:
        row = db.table("school_update_requests").insert({
            "school_id": body.school_id,
            "requester_id": user["id"],
            "proposed_changes": {"extra_contacts": next_contacts},
            "status": "pending",
        }).execute()
        req_id = row.data[0]["id"]
        approver_ids = _get_approver_ids(db, user["org_id"])
        notif_rows = [{
            "recipient_id": aid,
            "type": "update_request_submitted",
            "ref_id": req_id,
            "school_id": body.school_id,
            "data": {
                "title": f'{user.get("full_name", "יועץ")} ביקש להוסיף איש קשר ל{school.get("name", "בית ספר")}',
                "school_name": school.get("name", ""),
                "sender_name": user.get("full_name", ""),
                "proposed_changes": {"extra_contacts": next_contacts},
                "current_values": {"extra_contacts": existing},
                "deeplink": "/notifications",
            },
        } for aid in approver_ids if aid != user["id"]]
        _create_notifications(db, notif_rows, pref_key="notify_update_request_submitted")
    except Exception as exc:
        logger.error("save_call_contact: update-request insert failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return {"mode": "requested"}


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


@router.delete("/calls/{call_id}")
def delete_call_ai_data(user: Annotated[dict, Depends(get_current_user)], call_id: str):
    """Deletes only OUR captured AI summary/transcript for this call — the call itself
    lives permanently in Voicenter and is never affected by this."""
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
                logger.error("voicenter delete_call_ai_data failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    transcript_path = rows[0]["transcript_path"] if rows else None
    if transcript_path:
        try:
            db.storage.from_(_TRANSCRIPTS_BUCKET).remove([transcript_path])
        except Exception as exc:
            logger.warning("voicenter delete_call_ai_data: transcript file removal failed (non-fatal): %s", exc)

    try:
        db.table("voicenter_call_ai").delete().eq("org_id", user["org_id"]).eq("call_id", call_id).execute()
    except Exception as exc:
        logger.error("voicenter delete_call_ai_data: row delete failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="לא ניתן היה למחוק את הנתונים כרגע — נסה שוב")

    return {"ok": True}

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

    # This rep code now has an advisor — clear the "unmapped" alert marker (so a future gap
    # re-alerts) and close any open "rep unmapped" notifications for it.
    try:
        db = get_admin_client()
        db.table("voicenter_known_reps").update({"unmapped_alert_sent_at": None}).eq(
            "org_id", user["org_id"]
        ).eq("representative_code", body.representative_code).execute()
        db.table("notifications").update({"read_at": datetime.now(timezone.utc).isoformat()}).eq(
            "type", "voicenter_rep_unmapped"
        ).contains("data", {"representative_code": body.representative_code}).is_("read_at", "null").execute()
    except Exception as exc:
        logger.warning("upsert_mapping: clearing unmapped-rep alert failed (non-fatal): %s", exc)

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


@router.get("/known-reps")
def list_known_reps(user: Annotated[dict, Depends(get_current_user)]):
    """Every (representative_code, representative_name) pair ever seen in this org's calls —
    populated by process_new_calls below. This is the option list for the VOICENTER-mapping
    picker in ניהול-משתמשים: it lets the picker show every rep that has ever called without
    hitting Voicenter's live API (which has no "list all agents" endpoint) on every page load."""
    _require_manager(user)

    rows: list = []
    for attempt in range(2):
        try:
            db = get_admin_client()
            rows = (
                db.table("voicenter_known_reps")
                .select("representative_code, representative_name, last_seen_at")
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
                logger.error("voicenter list_known_reps failed after 2 attempts: %s", exc, exc_info=True)
                raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")

    return rows


# ---------------------------------------------------------------------------
# Scheduled job — detects new calls with an ambiguous contact (same phone number
# is a contact at more than one school) and notifies who needs to resolve it.
# Cron-secured (GitHub Actions, every 15 min — see voicenter-poll-calls.yml).
# ---------------------------------------------------------------------------

@router.post("/process-new-calls")
def process_new_calls(request: Request):
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=403, detail="אין הרשאה")

    from routers.schools_router import _create_notifications

    db = get_admin_client()
    now = datetime.now(timezone.utc)
    try:
        orgs = db.table("voicenter_integrations").select("org_id, enabled, last_call_scan_at").eq("enabled", True).execute().data or []
    except Exception as exc:
        logger.error("process_new_calls: failed to load integrations: %s", exc, exc_info=True)
        raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת")

    processed_orgs = 0
    new_ambiguous_calls = 0
    new_unknown_calls = 0
    new_rep_unmapped = 0

    for org in orgs:
        org_id = org["org_id"]
        last_scan = org.get("last_call_scan_at")
        # First run for this org: only look back 1 hour, to avoid a flood of historical
        # ambiguous-contact notifications on rollout.
        window_start = (datetime.fromisoformat(last_scan) if last_scan else now - timedelta(hours=1)) - timedelta(minutes=5)
        date_from = window_start.strftime("%Y-%m-%dT%H:%M:%S")
        date_to = now.strftime("%Y-%m-%dT%H:%M:%S")

        try:
            result = _pull_org_calls(org_id, date_from, date_to)
        except HTTPException as exc:
            logger.warning("process_new_calls: skipping org=%s (pull failed: %s)", org_id, exc.detail)
            continue
        except Exception as exc:
            logger.warning("process_new_calls: skipping org=%s (unexpected error: %s)", org_id, exc)
            continue

        # Record every rep code/name seen in this scan window — feeds the option list for the
        # VOICENTER-mapping picker in ניהול-משתמשים (see list_known_reps above). Non-fatal:
        # a failure here must never block the ambiguous-contact notification logic below.
        try:
            seen_reps = {c["representative_code"]: c.get("representative_name") for c in result["calls"] if c.get("representative_code")}
            if seen_reps:
                now_iso = now.isoformat()
                db.table("voicenter_known_reps").upsert(
                    [
                        {"org_id": org_id, "representative_code": code, "representative_name": name, "last_seen_at": now_iso}
                        for code, name in seen_reps.items()
                    ],
                    on_conflict="org_id,representative_code",
                ).execute()
        except Exception as exc:
            logger.warning("process_new_calls: known-reps upsert failed (non-fatal) for org=%s: %s", org_id, exc)

        ambiguous_calls = [c for c in result["calls"] if c.get("pending_school_resolution")]
        if ambiguous_calls:
            call_ids = [c["call_id"] for c in ambiguous_calls]
            already_tracked = set(_get_call_resolutions(org_id, call_ids).keys())

            managers_and_owners: list[str] = []
            try:
                rows = db.table("profiles").select("id").in_("role", ["owner", "manager"]).eq("org_id", org_id).execute().data or []
                managers_and_owners = [r["id"] for r in rows]
            except Exception as exc:
                logger.warning("process_new_calls: failed to load owners/managers for org=%s: %s", org_id, exc)

            for c in ambiguous_calls:
                if c["call_id"] in already_tracked:
                    continue
                recipient_ids = [c["advisor_id"]] if c.get("advisor_id") else managers_and_owners
                if not recipient_ids:
                    continue

                try:
                    db.table("voicenter_call_contact_resolutions").insert({
                        "org_id": org_id,
                        "call_id": c["call_id"],
                        "call_time": c["start_time"],
                        "contact_phone_suffix": _phone_suffix(c["counterpart_phone"]),
                        "contact_name": c["contact_name"],
                        "candidate_schools": c["candidate_schools"],
                        "caller_advisor_id": c.get("advisor_id"),
                        "notified_recipient_ids": recipient_ids,
                    }).execute()
                except Exception as exc:
                    logger.warning("process_new_calls: failed to insert resolution row for call=%s: %s", c["call_id"], exc)
                    continue

                school_names = " ו-".join(s["name"] for s in c["candidate_schools"] if s.get("name"))
                notif_rows = [{
                    "recipient_id": rid,
                    "type": "call_contact_ambiguous",
                    "data": {
                        "title": f"שיחה עם {c['contact_name']} — יש לשייך לבית ספר",
                        "contact_name": c["contact_name"],
                        "call_id": c["call_id"],
                        "candidate_schools": c["candidate_schools"],
                        "text": f"{c['contact_name']} שאיתו/ה דיברת הוא/היא איש/אשת קשר גם ב{school_names}. יש לשייך את השיחה לבית הספר הנכון.",
                    },
                } for rid in recipient_ids]
                _create_notifications(db, notif_rows, pref_key="notify_call_contact_ambiguous")
                new_ambiguous_calls += 1

        # --- owners/managers for this org (shared by both tracks below) ---
        owners_managers: list[str] = []
        try:
            om_rows = db.table("profiles").select("id").in_("role", ["owner", "manager"]).eq("org_id", org_id).execute().data or []
            owners_managers = [r["id"] for r in om_rows]
        except Exception as exc:
            logger.warning("process_new_calls: failed to load owners/managers for org=%s: %s", org_id, exc)

        # --- Track A: org-side number not mapped to any user ---
        # A rep code seen in calls but with no voicenter_rep_mappings row can't be attributed
        # to an advisor. Alert owners/managers once (they own ניהול-משתמשים → VOICENTER mapping);
        # the marker is cleared by upsert_mapping so a future gap re-alerts.
        try:
            seen_now = {}
            for c in result["calls"]:
                code = c.get("representative_code")
                if code and code not in seen_now:
                    seen_now[code] = c
            codes = list(seen_now.keys())
            if codes:
                mapped = {
                    m["representative_code"]
                    for m in (db.table("voicenter_rep_mappings").select("representative_code")
                              .eq("org_id", org_id).in_("representative_code", codes).execute().data or [])
                }
                known = {
                    r["representative_code"]: r
                    for r in (db.table("voicenter_known_reps").select("representative_code, unmapped_alert_sent_at")
                              .eq("org_id", org_id).in_("representative_code", codes).execute().data or [])
                }
                to_alert = [
                    code for code in codes
                    if code not in mapped and not (known.get(code) or {}).get("unmapped_alert_sent_at")
                ]
                for code in to_alert:
                    if not owners_managers:
                        break
                    c = seen_now[code]
                    notif_rows = [{
                        "recipient_id": rid,
                        "type": "voicenter_rep_unmapped",
                        "data": {
                            "title": "נרשמה שיחה ממספר ארגוני שאינו משויך לאף משתמש",
                            "representative_code": code,
                            "representative_name": c.get("representative_name"),
                            "call_id": c.get("call_id"),
                            "call_time": c.get("start_time"),
                            "counterpart_phone": c.get("counterpart_phone"),
                            "direction": c.get("direction"),
                            "text": f"נציג {c.get('representative_name') or code} אינו משויך למשתמש. יש לשייך אותו באזור 'משתמשים'.",
                            "deeplink": "/admin?tab=users",
                        },
                    } for rid in owners_managers]
                    _create_notifications(db, notif_rows, pref_key="notify_voicenter_rep_unmapped")
                    db.table("voicenter_known_reps").update(
                        {"unmapped_alert_sent_at": now.isoformat()}
                    ).eq("org_id", org_id).eq("representative_code", code).execute()
                    new_rep_unmapped += 1
        except Exception as exc:
            logger.warning("process_new_calls: Track A (rep unmapped) failed for org=%s: %s", org_id, exc)

        # --- Track B: counterpart number matches no school — prompt the advisor ---
        unknown_calls = [
            c for c in result["calls"]
            if c.get("advisor_id") and not c.get("school_id")
            and not c.get("pending_school_resolution")
            and not c.get("linked_school_ids")
            and c.get("direction") != "internal"
            and (c.get("duration_seconds") or 0) >= UNKNOWN_CALL_MIN_SECONDS
        ]
        unknown_tracked = set(_get_call_resolutions(org_id, [c["call_id"] for c in unknown_calls]).keys())
        for c in unknown_calls:
            advisor_id = c["advisor_id"]
            suffix = _phone_suffix(c.get("counterpart_phone"))
            if not suffix or c["call_id"] in unknown_tracked:
                continue
            try:
                open_row = (
                    db.table("voicenter_call_contact_resolutions")
                    .select("id, missed_calls_since_prompt")
                    .eq("org_id", org_id).eq("kind", "unknown")
                    .eq("caller_advisor_id", advisor_id).eq("contact_phone_suffix", suffix)
                    .is_("resolved_school_id", "null").is_("dismissed_at", "null")
                    .limit(1).execute()
                ).data
                if open_row:
                    db.table("voicenter_call_contact_resolutions").update({
                        "missed_calls_since_prompt": (open_row[0].get("missed_calls_since_prompt") or 0) + 1,
                    }).eq("id", open_row[0]["id"]).execute()
                    continue

                state = (
                    db.table("voicenter_unknown_number_state").select("*")
                    .eq("org_id", org_id).eq("advisor_id", advisor_id).eq("phone_suffix", suffix)
                    .limit(1).execute()
                ).data
                state = state[0] if state else None
                if state and state.get("muted") and (state.get("calls_since_prompt") or 0) < UNKNOWN_CALL_REPROMPT_AFTER:
                    db.table("voicenter_unknown_number_state").update({
                        "calls_since_prompt": (state.get("calls_since_prompt") or 0) + 1,
                        "updated_at": now.isoformat(),
                    }).eq("id", state["id"]).execute()
                    continue

                db.table("voicenter_unknown_number_state").upsert({
                    "org_id": org_id, "advisor_id": advisor_id, "phone_suffix": suffix,
                    "muted": False, "calls_since_prompt": 0,
                    "last_prompt_at": now.isoformat(), "updated_at": now.isoformat(),
                }, on_conflict="org_id,advisor_id,phone_suffix").execute()

                db.table("voicenter_call_contact_resolutions").insert({
                    "org_id": org_id,
                    "call_id": c["call_id"],
                    "kind": "unknown",
                    "call_time": c["start_time"],
                    "contact_phone_suffix": suffix,
                    "counterpart_phone": c.get("counterpart_phone"),
                    "call_direction": c.get("direction"),
                    "call_duration_seconds": c.get("duration_seconds") or 0,
                    "candidate_schools": None,
                    "caller_advisor_id": advisor_id,
                    "notified_recipient_ids": [advisor_id],
                }).execute()

                _create_notifications(db, [{
                    "recipient_id": advisor_id,
                    "type": "voicenter_unknown_call",
                    "data": {
                        "title": "שיחה עם מספר לא מוכר — האם לשייך לבית ספר?",
                        "call_id": c["call_id"],
                        "counterpart_phone": c.get("counterpart_phone"),
                        "call_time": c.get("start_time"),
                        "text": "זיהינו שיחה עם מספר שאינו מופיע באנשי הקשר של אף בית ספר. ניתן לשייך אותה לבית ספר.",
                    },
                }], pref_key="notify_voicenter_unknown_call")
                new_unknown_calls += 1
            except Exception as exc:
                logger.warning("process_new_calls: Track B (unknown call) failed for call=%s: %s", c.get("call_id"), exc)

        try:
            db.table("voicenter_integrations").update({"last_call_scan_at": now.isoformat()}).eq("org_id", org_id).execute()
        except Exception as exc:
            logger.warning("process_new_calls: failed to update cursor for org=%s: %s", org_id, exc)

        processed_orgs += 1

    # Auto-dismiss stale 'unknown' prompts (>14 days, never acted on) — the underlying call
    # has likely aged out of Voicenter's log window, so the popup can no longer be useful.
    try:
        cutoff = (now - timedelta(days=14)).isoformat()
        db.table("voicenter_call_contact_resolutions").update(
            {"dismissed_at": now.isoformat()}
        ).eq("kind", "unknown").is_("resolved_school_id", "null").is_("dismissed_at", "null") \
         .lt("call_time", cutoff).execute()
    except Exception as exc:
        logger.warning("process_new_calls: stale unknown-prompt cleanup failed (non-fatal): %s", exc)

    return {
        "ok": True,
        "processed_orgs": processed_orgs,
        "new_ambiguous_calls": new_ambiguous_calls,
        "new_unknown_calls": new_unknown_calls,
        "new_rep_unmapped": new_rep_unmapped,
    }
