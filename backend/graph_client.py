"""Microsoft Graph API client for the Outlook calendar integration.

Uses app-only (client-credentials) auth against a tenant that has granted
org-wide admin consent — no per-advisor login is required. All calls are
non-fatal from the caller's perspective: failures are logged and reflected
in the returned sync-status map, never raised, so a calendar outage never
blocks meeting scheduling in the app itself.
"""
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import httpx
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_CLIENT_ID = os.getenv("MS_CLIENT_ID")
MS_CLIENT_SECRET = os.getenv("MS_CLIENT_SECRET")
MS_REDIRECT_URI = os.getenv("MS_REDIRECT_URI")


def _fernet() -> Fernet:
    key = os.getenv("CALENDAR_TOKEN_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("CALENDAR_TOKEN_ENCRYPTION_KEY not configured")
    return Fernet(key.encode())


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


# Public aliases for use by calendar_router.py when persisting a delegated
# (per-user) connection's tokens directly.
encrypt_token = _encrypt
decrypt_token = _decrypt


# ---------------------------------------------------------------------------
# OAuth state token (used to carry org_id/user_id through the Microsoft
# admin-consent redirect, which is a plain browser navigation with no
# Authorization header). Reuses the same Fernet key as token encryption —
# Fernet's own TTL check on decrypt gives us tamper protection + expiry.
# ---------------------------------------------------------------------------

def make_state_token(org_id: str, user_id: str) -> str:
    payload = json.dumps({"org_id": org_id, "user_id": user_id}).encode()
    return _fernet().encrypt(payload).decode()


def parse_state_token(state: str) -> dict:
    payload = _fernet().decrypt(state.encode(), ttl=600)
    return json.loads(payload.decode())


# ---------------------------------------------------------------------------
# Admin consent / connection setup
# ---------------------------------------------------------------------------

def get_admin_consent_url(state: str) -> str:
    """URL that starts the org-wide admin-consent flow (tenant unknown in advance)."""
    return (
        "https://login.microsoftonline.com/common/adminconsent"
        f"?client_id={MS_CLIENT_ID}&redirect_uri={MS_REDIRECT_URI}&state={state}"
    )


def get_personal_oauth_url(state: str) -> str:
    """Delegated per-user OAuth URL — fallback for solo advisors without an org tenant/admin."""
    scope = "offline_access Calendars.ReadWrite"
    return (
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        f"?client_id={MS_CLIENT_ID}&response_type=code&redirect_uri={MS_REDIRECT_URI}"
        f"&scope={scope}&state={state}"
    )


def exchange_personal_code(code: str) -> dict:
    """Delegated flow: exchange an auth code for access/refresh tokens."""
    resp = httpx.post(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        data={
            "client_id": MS_CLIENT_ID,
            "client_secret": MS_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": MS_REDIRECT_URI,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Connection lookup
# ---------------------------------------------------------------------------

def get_org_connection(db, org_id: str) -> dict | None:
    res = (
        db.table("calendar_connections")
        .select("*")
        .eq("org_id", org_id)
        .eq("scope", "org")
        .eq("provider", "microsoft")
        .execute()
    )
    return res.data[0] if res.data else None


def get_user_connection(db, org_id: str, user_id: str) -> dict | None:
    res = (
        db.table("calendar_connections")
        .select("*")
        .eq("org_id", org_id)
        .eq("scope", "user")
        .eq("provider", "microsoft")
        .eq("user_id", user_id)
        .execute()
    )
    return res.data[0] if res.data else None


def _get_app_only_token(db, org_id: str) -> str:
    """Client-credentials flow, cached in calendar_connections until near expiry."""
    conn = get_org_connection(db, org_id)
    if not conn or conn.get("status") != "connected" or not conn.get("tenant_id"):
        raise RuntimeError("no active org-level Microsoft calendar connection")

    now = datetime.now(timezone.utc)
    if conn.get("access_token") and conn.get("expires_at"):
        expires_at = datetime.fromisoformat(conn["expires_at"].replace("Z", "+00:00"))
        if expires_at - now > timedelta(minutes=5):
            return _decrypt(conn["access_token"])

    resp = httpx.post(
        f"https://login.microsoftonline.com/{conn['tenant_id']}/oauth2/v2.0/token",
        data={
            "client_id": MS_CLIENT_ID,
            "client_secret": MS_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=15,
    )
    resp.raise_for_status()
    token_data = resp.json()
    access_token = token_data["access_token"]
    new_expires_at = now + timedelta(seconds=token_data.get("expires_in", 3600))

    db.table("calendar_connections").update({
        "access_token": _encrypt(access_token),
        "expires_at": new_expires_at.isoformat(),
        "updated_at": now.isoformat(),
    }).eq("id", conn["id"]).execute()

    return access_token


def _resolve_advisor_email(db, advisor_id: str) -> str | None:
    res = db.table("profiles").select("email, calendar_sync_email").eq("id", advisor_id).execute()
    if not res.data:
        return None
    row = res.data[0]
    return row.get("calendar_sync_email") or row.get("email")


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _request_with_retry(method: str, url: str, **kwargs) -> httpx.Response:
    """One retry with a short backoff for transient network/5xx failures. Graph API
    occasionally has brief hiccups — don't let a one-off blip permanently mark a
    meeting's calendar sync as failed when a second attempt would have succeeded."""
    last_exc = None
    for attempt in range(2):
        try:
            resp = httpx.request(method, url, **kwargs)
            if resp.status_code >= 500 and attempt == 0:
                time.sleep(0.5)
                continue
            return resp
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt == 0:
                time.sleep(0.5)
                continue
    raise last_exc


# Sentinel returned by get_event() when the check itself couldn't be completed
# (network/5xx/no connection) — distinct from a confirmed 404 (event genuinely
# gone), so callers never mistake "couldn't verify" for "deleted".
EVENT_CHECK_SKIPPED = "__skipped__"


def get_event(db, org_id: str, advisor_id: str, event_id: str) -> dict | str | None:
    """Fetch a single event's current state, for reconciling Outlook-side edits/deletes
    back into our own meetings table. Returns:
    - dict {start, end, subject} if the event still exists
    - None if it's confirmed gone (404, or Outlook marked it cancelled)
    - EVENT_CHECK_SKIPPED if the check itself failed (never treat this as "deleted")
    """
    try:
        token = _get_app_only_token(db, org_id)
    except Exception as exc:
        logger.info("get_event skipped for org %s: %s", org_id, exc)
        return EVENT_CHECK_SKIPPED

    email = _resolve_advisor_email(db, advisor_id)
    if not email:
        return EVENT_CHECK_SKIPPED

    try:
        resp = httpx.get(
            f"{GRAPH_BASE}/users/{email}/events/{event_id}",
            headers={**_headers(token), "Prefer": 'outlook.timezone="Israel Standard Time"'},
            params={"$select": "id,subject,start,end,isCancelled"},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        logger.warning("get_event request failed for advisor %s event %s: %s", advisor_id, event_id, exc)
        return EVENT_CHECK_SKIPPED

    if resp.status_code == 404:
        return None
    if resp.status_code >= 500:
        logger.warning("get_event got %s for advisor %s event %s — skipping this round", resp.status_code, advisor_id, event_id)
        return EVENT_CHECK_SKIPPED
    try:
        resp.raise_for_status()
        e = resp.json()
    except Exception as exc:
        logger.warning("get_event failed to parse response for advisor %s event %s: %s", advisor_id, event_id, exc)
        return EVENT_CHECK_SKIPPED

    if e.get("isCancelled"):
        return None
    return {"start": e["start"]["dateTime"], "end": e["end"]["dateTime"], "subject": e.get("subject")}


def _event_payload(meeting: dict, subject: str | None) -> dict:
    subject = subject or "פגישת ליווי כלכלי"
    date = meeting.get("meeting_date")
    start_time = meeting.get("start_time") or "09:00"
    end_time = meeting.get("end_time") or "10:00"
    return {
        "subject": subject,
        "body": {"contentType": "text", "content": meeting.get("notes") or ""},
        "start": {"dateTime": f"{date}T{start_time}:00", "timeZone": "Israel Standard Time"},
        "end": {"dateTime": f"{date}T{end_time}:00", "timeZone": "Israel Standard Time"},
    }


# ---------------------------------------------------------------------------
# Free/Busy
# ---------------------------------------------------------------------------

def get_freebusy(db, org_id: str, advisor_id: str, start_iso: str, end_iso: str) -> list[dict]:
    """Returns busy time blocks (with subject) for one advisor. Empty list (never raises) if unavailable.

    Uses calendarView (not getSchedule) so the response includes the event subject —
    the secretary needs to see *what* the advisor is booked for, not just that he's busy.
    The `Prefer: outlook.timezone` header makes Graph return times already converted to
    Israel local time, avoiding manual UTC conversion entirely.
    """
    try:
        token = _get_app_only_token(db, org_id)
    except Exception as exc:
        logger.info("freebusy skipped for org %s: %s", org_id, exc)
        return []

    email = _resolve_advisor_email(db, advisor_id)
    if not email:
        return []

    try:
        resp = httpx.get(
            f"{GRAPH_BASE}/users/{email}/calendarView",
            headers={**_headers(token), "Prefer": 'outlook.timezone="Israel Standard Time"'},
            params={
                "startDateTime": start_iso,
                "endDateTime": end_iso,
                "$select": "id,subject,start,end,showAs",
                "$orderby": "start/dateTime",
                "$top": 200,
            },
            timeout=15,
        )
        resp.raise_for_status()
        events = resp.json().get("value", [])
        return [
            {
                "id": e.get("id"),
                "start": e["start"]["dateTime"],
                "end": e["end"]["dateTime"],
                "subject": e.get("subject") or "(ללא כותרת)",
            }
            for e in events
            if e.get("showAs", "busy") not in ("free", "workingElsewhere")
        ]
    except Exception as exc:
        logger.warning("freebusy fetch failed for advisor %s: %s", advisor_id, exc)
        return []


# ---------------------------------------------------------------------------
# Meeting sync (create / update / cancel)
# ---------------------------------------------------------------------------

def _time_overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    def to_min(hm: str) -> int:
        h, m = hm.split(":")
        return int(h) * 60 + int(m)
    try:
        s, e, bs, be = to_min(a_start), to_min(a_end), to_min(b_start), to_min(b_end)
    except Exception:
        return False
    return s < be and bs < e


def _check_meeting_conflict(db, org_id: str, advisor_id: str, meeting: dict, exclude_event_id: str | None) -> bool:
    """Does this meeting's own time genuinely overlap another event already on the
    advisor's Outlook calendar that day (other than the meeting's own synced event)?
    Persisted into calendar_sync so the UI can show it immediately on load, instead of
    depending on a fresh live fetch finishing first (which flickers/looks momentary)."""
    date, start, end = meeting.get("meeting_date"), meeting.get("start_time"), meeting.get("end_time")
    if not date or not start or not end:
        return False
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
    except Exception:
        return False
    start_iso = day_start.strftime("%Y-%m-%dT00:00:00.000Z")
    end_iso = (day_start + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00.000Z")
    blocks = get_freebusy(db, org_id, advisor_id, start_iso, end_iso)
    for b in blocks:
        if exclude_event_id and b.get("id") == exclude_event_id:
            continue
        if _time_overlaps(start, end, b["start"][11:16], b["end"][11:16]):
            return True
    return False


def sync_meeting_create(db, org_id: str, meeting: dict, subject: str | None = None) -> dict:
    """Creates one event per advisor in meeting['advisor_ids']. Returns the calendar_sync map."""
    sync_map: dict = {}
    if not meeting.get("meeting_date"):
        return sync_map
    try:
        token = _get_app_only_token(db, org_id)
    except Exception as exc:
        logger.info("calendar sync (create) skipped for meeting %s: %s", meeting.get("id"), exc)
        return sync_map

    for advisor_id in meeting.get("advisor_ids") or []:
        entry = _create_event_for_advisor(db, token, advisor_id, meeting, subject)
        if entry.get("status") == "synced":
            entry["conflict"] = _check_meeting_conflict(db, org_id, advisor_id, meeting, entry.get("external_event_id"))
        sync_map[advisor_id] = entry
    return sync_map


def _create_event_for_advisor(db, token: str, advisor_id: str, meeting: dict, subject: str | None) -> dict:
    email = _resolve_advisor_email(db, advisor_id)
    if not email:
        return {"provider": "microsoft", "status": "not_connected"}
    try:
        resp = _request_with_retry(
            "POST", f"{GRAPH_BASE}/users/{email}/events",
            headers=_headers(token),
            json=_event_payload(meeting, subject),
            timeout=15,
        )
        resp.raise_for_status()
        return {
            "provider": "microsoft",
            "external_event_id": resp.json()["id"],
            "status": "synced",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.warning("calendar event create failed for advisor %s: %s", advisor_id, exc)
        return {"provider": "microsoft", "status": "error"}


def sync_meeting_update(db, org_id: str, meeting: dict, previous_sync: dict, subject: str | None = None) -> dict:
    """Reconciles calendar events against the current advisor_ids: updates existing,
    creates for newly-added advisors, deletes for removed ones."""
    if not meeting.get("meeting_date"):
        # Meeting has no date yet (e.g. still being filled in) — nothing to send Graph,
        # and leave any previously-synced events untouched rather than guessing.
        logger.info("calendar sync (update) skipped for meeting %s: no meeting_date", meeting.get("id"))
        return previous_sync

    current_ids = set(meeting.get("advisor_ids") or [])
    previous_ids = set(previous_sync.keys())

    try:
        token = _get_app_only_token(db, org_id)
    except Exception as exc:
        logger.info("calendar sync (update) skipped for meeting %s: %s", meeting.get("id"), exc)
        return previous_sync

    sync_map: dict = {}
    for advisor_id in current_ids:
        prior = previous_sync.get(advisor_id)
        email = _resolve_advisor_email(db, advisor_id)
        if prior and prior.get("external_event_id") and email:
            entry = _update_event_for_advisor(db, token, advisor_id, email, prior["external_event_id"], meeting, subject)
        else:
            entry = _create_event_for_advisor(db, token, advisor_id, meeting, subject)
        if entry.get("status") == "synced":
            entry["conflict"] = _check_meeting_conflict(db, org_id, advisor_id, meeting, entry.get("external_event_id"))
        sync_map[advisor_id] = entry

    for advisor_id in previous_ids - current_ids:
        prior = previous_sync.get(advisor_id) or {}
        email = _resolve_advisor_email(db, advisor_id)
        if prior.get("external_event_id") and email:
            _delete_event_for_advisor(token, email, prior["external_event_id"])

    return sync_map


def _update_event_for_advisor(db, token: str, advisor_id: str, email: str, event_id: str, meeting: dict, subject: str | None) -> dict:
    try:
        resp = _request_with_retry(
            "PATCH", f"{GRAPH_BASE}/users/{email}/events/{event_id}",
            headers=_headers(token),
            json=_event_payload(meeting, subject),
            timeout=15,
        )
        if resp.status_code == 404:
            # The event was deleted directly in Outlook — recreate it rather than
            # leaving the meeting permanently stuck in an error state.
            logger.info("calendar event %s no longer exists — recreating", event_id)
            return _create_event_for_advisor(db, token, advisor_id, meeting, subject)
        resp.raise_for_status()
        return {
            "provider": "microsoft",
            "external_event_id": event_id,
            "status": "synced",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.warning("calendar event update failed (event %s): %s", event_id, exc)
        return {"provider": "microsoft", "external_event_id": event_id, "status": "error"}


def _delete_event_for_advisor(token: str, email: str, event_id: str) -> None:
    try:
        resp = httpx.delete(f"{GRAPH_BASE}/users/{email}/events/{event_id}", headers=_headers(token), timeout=15)
        if resp.status_code not in (200, 202, 204, 404):
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("calendar event delete failed (event %s): %s", event_id, exc)


def sync_meeting_cancel(db, org_id: str, previous_sync: dict) -> None:
    """Deletes all calendar events tied to a meeting (used on meeting delete / status=cancelled)."""
    if not previous_sync:
        return
    try:
        token = _get_app_only_token(db, org_id)
    except Exception as exc:
        logger.info("calendar cancel sync skipped: %s", exc)
        return
    for advisor_id, entry in previous_sync.items():
        event_id = entry.get("external_event_id")
        if not event_id:
            continue
        email = _resolve_advisor_email(db, advisor_id)
        if email:
            _delete_event_for_advisor(token, email, event_id)
