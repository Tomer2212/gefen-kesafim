"""Microsoft Graph API client for the Outlook calendar integration.

Uses app-only (client-credentials) auth against a tenant that has granted
org-wide admin consent — no per-advisor login is required. All calls are
non-fatal from the caller's perspective: failures are logged and reflected
in the returned sync-status map, never raised, so a calendar outage never
blocks meeting scheduling in the app itself.
"""
import contextlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from cryptography.fernet import Fernet

from supabase_client import get_admin_client, reset_admin_client

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MS_CLIENT_ID = os.getenv("MS_CLIENT_ID")
MS_CLIENT_SECRET = os.getenv("MS_CLIENT_SECRET")
MS_REDIRECT_URI = os.getenv("MS_REDIRECT_URI")
BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL")


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
    """Client-credentials flow, cached in calendar_connections until near expiry.

    Retries once with a freshly-fetched Supabase client on a transient failure.
    Under the concurrent load this function now sees (many freebusy checks firing
    at once across a table full of rows), the shared httpx/HTTP2 client can end up
    in a corrupted state — the same class of issue documented elsewhere in this
    project for the Supabase singleton under load. Without this retry, a single such
    hiccup used to surface as "advisor is free" to the end user, which is exactly the
    failure mode this function's callers must never produce.
    """
    last_exc = None
    for attempt in range(2):
        try:
            if attempt == 1:
                db = get_admin_client()
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
        except RuntimeError:
            raise  # "no active connection" is a real state, not transient — never retry/mask it
        except Exception as exc:
            last_exc = exc
            if attempt == 0:
                logger.warning("_get_app_only_token attempt 1 failed for org %s, retrying: %s", org_id, exc)
                reset_admin_client()
                time.sleep(0.2)
    raise last_exc


def _resolve_advisor_email(db, advisor_id: str) -> str | None:
    for attempt in range(2):
        try:
            if attempt == 1:
                db = get_admin_client()
            res = db.table("profiles").select("email, calendar_sync_email").eq("id", advisor_id).execute()
            if not res.data:
                return None
            row = res.data[0]
            return row.get("calendar_sync_email") or row.get("email")
        except Exception as exc:
            if attempt == 0:
                logger.warning("_resolve_advisor_email attempt 1 failed for advisor %s, retrying: %s", advisor_id, exc)
                reset_admin_client()
                time.sleep(0.2)
            else:
                logger.warning("_resolve_advisor_email failed for advisor %s: %s", advisor_id, exc)
                return None


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
    payload = {
        "subject": subject,
        "body": {"contentType": "text", "content": meeting.get("notes") or ""},
        "start": {"dateTime": f"{date}T{start_time}:00", "timeZone": "Israel Standard Time"},
        "end": {"dateTime": f"{date}T{end_time}:00", "timeZone": "Israel Standard Time"},
    }
    # meeting["participants"] is already the full contact objects the frontend selects
    # from (schoolContacts.js's {key, label, name, email}) — no extra lookup needed here.
    # A real Outlook meeting invite (with attendees) gets sent by Graph/Exchange
    # automatically on create/update; no separate Mail.Send permission required for this.
    attendees = [
        {"emailAddress": {"address": p["email"].strip(), "name": p.get("name") or p["email"]}, "type": "required"}
        for p in (meeting.get("participants") or [])
        if (p.get("email") or "").strip()
    ]
    if attendees:
        payload["attendees"] = attendees
    return payload


# ---------------------------------------------------------------------------
# Free/Busy
# ---------------------------------------------------------------------------

def get_freebusy(db, org_id: str, advisor_id: str, start_iso: str, end_iso: str) -> list[dict] | None:
    """Returns busy time blocks (with subject) for one advisor.

    Uses calendarView (not getSchedule) so the response includes the event subject —
    the secretary needs to see *what* the advisor is booked for, not just that he's busy.
    The `Prefer: outlook.timezone` header makes Graph return times already converted to
    Israel local time, avoiding manual UTC conversion entirely.

    Returns:
    - list[dict] of busy blocks — including an empty list if the advisor genuinely has
      nothing booked, or isn't connected to a calendar at all (a stable, known state).
    - None if the check itself failed (token/network/Graph error) — never conflate this
      with "confirmed free"; callers must treat it as "couldn't determine," not as an
      empty calendar. A transient failure silently rendering as green/free would be a
      real safety issue for a scheduling tool.
    """
    try:
        token = _get_app_only_token(db, org_id)
    except Exception as exc:
        logger.info("freebusy skipped for org %s: %s", org_id, exc)
        return None

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
        return None


def persist_calendar_sync(db, meeting_id: str, sync_map: dict) -> None:
    """Single place that writes calendar_sync onto a meeting. Also keeps
    calendar_event_index up to date — a reverse lookup (external_event_id ->
    meeting_id) used by the webhook handler so an incoming Graph notification
    can find its meeting with one indexed query instead of scanning meetings.

    Clears out the meeting's old index rows first: an advisor removed from the
    meeting, or an event recreated with a new id, must not leave a stale row
    that would misroute a future webhook notification to this meeting.

    This write is the single most safety-critical one in the whole sync flow: by
    the time this function runs, the Graph-side event has *already* been
    created/updated. If this DB write silently fails (confirmed to happen under
    concurrent load — see the retry patterns elsewhere in this file), the meeting
    row is left pointing at the old/no event while a new real one now exists in
    Outlook, orphaned and invisible to us forever. Retries with a fresh client
    before giving up, matching this project's established resilience pattern.
    """
    last_exc = None
    for attempt in range(2):
        try:
            if attempt == 1:
                db = get_admin_client()
            db.table("meetings").update({"calendar_sync": sync_map}).eq("id", meeting_id).execute()
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
            if attempt == 0:
                logger.warning("persist_calendar_sync attempt 1 failed for meeting %s, retrying: %s", meeting_id, exc)
                reset_admin_client()
                time.sleep(0.2)
    if last_exc:
        logger.error("persist_calendar_sync failed for meeting %s after retry: %s", meeting_id, last_exc, exc_info=True)
        raise last_exc

    try:
        db.table("calendar_event_index").delete().eq("meeting_id", meeting_id).execute()
        rows = [
            {"meeting_id": meeting_id, "advisor_id": aid, "external_event_id": entry["external_event_id"]}
            for aid, entry in sync_map.items() if entry.get("external_event_id")
        ]
        if rows:
            db.table("calendar_event_index").upsert(rows, on_conflict="external_event_id").execute()
    except Exception as exc:
        logger.warning("calendar_event_index update failed for meeting %s (non-fatal): %s", meeting_id, exc)


_LOCK_STALE_SECONDS = 60   # worst case: token fetch + per-advisor Graph calls + persist retry
_LOCK_POLL_INTERVAL = 0.2  # seconds between poll attempts
_LOCK_MAX_WAIT = 4.0       # total bounded wait before giving up


@contextlib.contextmanager
def calendar_sync_lock(db, meeting_id: str):
    """Serializes the read-previous-sync -> Graph call -> persist_calendar_sync
    critical section per meeting_id, across all workers, via a Postgres-backed
    lock (never in-process — two concurrent requests for the same meeting, e.g.
    MeetingRow's onChange + onBlur autosaves, must not both independently decide
    "no event yet, create one", which is what caused real duplicate Outlook
    events in production).

    Yields True if the lock was acquired (caller should run its sync normally)
    or False if it couldn't be acquired within _LOCK_MAX_WAIT (caller must skip
    its own calendar sync for this attempt — the meeting's own DB save is
    unaffected either way, since this lock only ever wraps the calendar-sync
    side effect, never the meeting row's save itself). A future edit or the
    existing poll/webhook reconciler will catch up the sync later.

    Never raises: lock acquire/release failures are logged and treated as
    "lock unavailable", never fatal to the HTTP request.
    """
    token = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    acquired = False
    deadline = time.monotonic() + _LOCK_MAX_WAIT
    try:
        while time.monotonic() < deadline:
            try:
                db = get_admin_client()
                db.table("calendar_sync_locks").insert(
                    {"meeting_id": meeting_id, "locked_by": token}
                ).execute()
                acquired = True
                break
            except Exception:
                # Row already exists (PK conflict) — check whether it's stale enough to steal.
                try:
                    db = get_admin_client()
                    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=_LOCK_STALE_SECONDS)).isoformat()
                    stolen = (
                        db.table("calendar_sync_locks")
                        .update({"locked_at": datetime.now(timezone.utc).isoformat(), "locked_by": token})
                        .eq("meeting_id", meeting_id)
                        .lt("locked_at", cutoff)
                        .execute()
                    )
                    if stolen.data:
                        acquired = True
                        break
                except Exception as exc:
                    logger.warning("calendar_sync_lock: steal check failed for meeting %s: %s", meeting_id, exc)
            time.sleep(_LOCK_POLL_INTERVAL)

        if not acquired:
            logger.warning(
                "calendar_sync_lock: could not acquire for meeting %s within %.1fs, skipping sync",
                meeting_id, _LOCK_MAX_WAIT,
            )
        yield acquired
    finally:
        if acquired:
            try:
                db = get_admin_client()
                db.table("calendar_sync_locks").delete().eq("meeting_id", meeting_id).eq("locked_by", token).execute()
            except Exception as exc:
                logger.warning(
                    "calendar_sync_lock: release failed for meeting %s (will self-expire via stale-lock steal): %s",
                    meeting_id, exc,
                )


# ---------------------------------------------------------------------------
# Webhook subscriptions (Microsoft Graph change notifications) — one
# subscription per advisor mailbox, covering all of that advisor's events.
# Lets Microsoft push us a notification within seconds of a change instead of
# us polling on a schedule. Subscriptions expire after ~3 days (Graph's own
# hard limit for calendar resources) and must be renewed periodically — see
# renew_all_subscriptions_expiring_soon, called from a daily cron.
# ---------------------------------------------------------------------------

SUBSCRIPTION_MAX_MINUTES = 4230  # Graph's hard cap for calendar-resource subscriptions


def _get_subscription_row(db, org_id: str, advisor_id: str) -> dict | None:
    res = (
        db.table("calendar_subscriptions")
        .select("*")
        .eq("org_id", org_id)
        .eq("advisor_id", advisor_id)
        .execute()
    )
    return res.data[0] if res.data else None


def _ensure_subscription(db, org_id: str, advisor_id: str) -> None:
    """Non-fatal. Creates a webhook subscription for this advisor's calendar if
    one doesn't already exist with plenty of time left before it expires."""
    if not BACKEND_PUBLIC_URL:
        logger.info("_ensure_subscription skipped: BACKEND_PUBLIC_URL not configured")
        return
    try:
        now = datetime.now(timezone.utc)
        existing = _get_subscription_row(db, org_id, advisor_id)
        if existing:
            expires_at = datetime.fromisoformat(existing["expires_at"].replace("Z", "+00:00"))
            if expires_at - now > timedelta(hours=48):
                return  # still valid for a while, nothing to do

        token = _get_app_only_token(db, org_id)
        email = _resolve_advisor_email(db, advisor_id)
        if not email:
            return

        client_state = Fernet.generate_key().decode()
        expiration = now + timedelta(minutes=SUBSCRIPTION_MAX_MINUTES)
        # Unlike every other Graph call in this file, this one had zero retry — a single
        # transient blip (Graph 5xx, network hiccup) silently left an advisor's calendar
        # with no real-time sync until their next lucky edit re-triggered this function
        # (confirmed in production: a freshly-licensed advisor's subscription failed to
        # create on both the meeting-creation call AND a follow-up edit, yet the exact
        # same POST succeeded immediately when retried manually — a transient failure,
        # not a permission/mailbox-provisioning issue). Matches this file's established
        # one-retry-with-backoff pattern (_request_with_retry) used everywhere else.
        resp = _request_with_retry(
            "POST", f"{GRAPH_BASE}/subscriptions",
            headers=_headers(token),
            json={
                "changeType": "created,updated,deleted",
                "notificationUrl": f"{BACKEND_PUBLIC_URL.rstrip('/')}/calendar/webhook/microsoft",
                "resource": f"users/{email}/events",
                "expirationDateTime": expiration.isoformat(),
                "clientState": client_state,
            },
            timeout=15,
        )
        resp.raise_for_status()
        sub = resp.json()
        payload = {
            "org_id": org_id,
            "advisor_id": advisor_id,
            "subscription_id": sub["id"],
            "client_state": _encrypt(client_state),
            "expires_at": expiration.isoformat(),
            "updated_at": now.isoformat(),
        }
        if existing:
            db.table("calendar_subscriptions").update(payload).eq("id", existing["id"]).execute()
        else:
            db.table("calendar_subscriptions").insert(payload).execute()
    except Exception as exc:
        logger.warning("_ensure_subscription failed for advisor %s (non-fatal): %s", advisor_id, exc)


def renew_subscription(db, sub_row: dict) -> bool:
    """Non-fatal. Extends one subscription's expiry. If Graph no longer has it
    (404 — e.g. it silently expired already), recreates it from scratch via
    _ensure_subscription instead of failing. Returns True on success."""
    try:
        token = _get_app_only_token(db, sub_row["org_id"])
        now = datetime.now(timezone.utc)
        expiration = now + timedelta(minutes=SUBSCRIPTION_MAX_MINUTES)
        resp = httpx.patch(
            f"{GRAPH_BASE}/subscriptions/{sub_row['subscription_id']}",
            headers=_headers(token),
            json={"expirationDateTime": expiration.isoformat()},
            timeout=15,
        )
        if resp.status_code == 404:
            db.table("calendar_subscriptions").delete().eq("id", sub_row["id"]).execute()
            _ensure_subscription(db, sub_row["org_id"], sub_row["advisor_id"])
            return True
        resp.raise_for_status()
        db.table("calendar_subscriptions").update({
            "expires_at": expiration.isoformat(),
            "updated_at": now.isoformat(),
        }).eq("id", sub_row["id"]).execute()
        return True
    except Exception as exc:
        logger.warning("renew_subscription failed for %s (non-fatal): %s", sub_row.get("id"), exc)
        return False


def renew_all_subscriptions_expiring_soon(db) -> dict:
    """Cron entry point (daily). Renews any subscription expiring within 24h.
    Each row is independent/non-fatal — one failure never blocks the rest."""
    now = datetime.now(timezone.utc)
    cutoff = (now + timedelta(hours=24)).isoformat()
    rows = db.table("calendar_subscriptions").select("*").lte("expires_at", cutoff).execute().data or []
    renewed = failed = 0
    for row in rows:
        if renew_subscription(db, row):
            renewed += 1
        else:
            failed += 1
    return {"renewed": renewed, "failed": failed, "checked": len(rows)}


def verify_client_state(db, subscription_id: str, client_state: str) -> str | None:
    """Looks up the subscription by Graph's subscription_id and checks the
    clientState the notification carried matches what we generated when we
    created it. Returns the advisor_id on success, None otherwise (wrong/missing
    clientState, or an unknown subscription — never trust an unverified notification)."""
    res = db.table("calendar_subscriptions").select("advisor_id, client_state").eq("subscription_id", subscription_id).execute()
    if not res.data:
        return None
    row = res.data[0]
    try:
        if _decrypt(row["client_state"]) != client_state:
            return None
    except Exception:
        return None
    return row["advisor_id"]


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
    if blocks is None:
        return False  # couldn't check — don't claim a conflict we can't actually see
    for b in blocks:
        if exclude_event_id and b.get("id") == exclude_event_id:
            continue
        if _time_overlaps(start, end, b["start"][11:16], b["end"][11:16]):
            return True
    return False


def send_mail_as_advisor(db, org_id: str, advisor_id: str, subject: str, html_body: str, to_email: str,
                          attachments: list[dict] | None = None) -> None:
    """Sends an email as the resolved advisor's real mailbox via Graph application-permission
    Mail.Send (POST /users/{email}/sendMail — same authorization model app-only Calendars.ReadWrite
    already uses for /users/{email}/events, just a different Graph permission).

    Unlike the calendar-sync functions in this file (which are deliberately non-fatal — a failed
    sync shouldn't block saving a meeting), this RAISES on failure so callers on a paid-action path
    (the booking-request email queue) can mark the row 'failed' with the real error instead of
    silently losing it.

    attachments: [{"filename": str, "content_b64": str}] — mapped to Graph's fileAttachment shape.
    """
    token = _get_app_only_token(db, org_id)
    email = _resolve_advisor_email(db, advisor_id)
    if not email:
        raise RuntimeError(f"could not resolve mailbox for advisor {advisor_id}")

    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html_body},
        "toRecipients": [{"emailAddress": {"address": to_email}}],
    }
    if attachments:
        message["attachments"] = [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a["filename"],
                "contentBytes": a["content_b64"],
            }
            for a in attachments
        ]

    payload = {"message": message, "saveToSentItems": True}
    resp = _request_with_retry(
        "POST", f"{GRAPH_BASE}/users/{email}/sendMail",
        headers=_headers(token), json=payload, timeout=15,
    )
    resp.raise_for_status()


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
        entry = _create_event_for_advisor(db, org_id, token, advisor_id, meeting, subject)
        if entry.get("status") == "synced":
            entry["conflict"] = _check_meeting_conflict(db, org_id, advisor_id, meeting, entry.get("external_event_id"))
        sync_map[advisor_id] = entry
    return sync_map


def _create_event_for_advisor(db, org_id: str, token: str, advisor_id: str, meeting: dict, subject: str | None) -> dict:
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
        event_id = resp.json()["id"]
        _ensure_subscription(db, org_id, advisor_id)
        return {
            "provider": "microsoft",
            "external_event_id": event_id,
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
            entry = _update_event_for_advisor(db, org_id, token, advisor_id, email, prior["external_event_id"], meeting, subject)
        else:
            entry = _create_event_for_advisor(db, org_id, token, advisor_id, meeting, subject)
        if entry.get("status") == "synced":
            entry["conflict"] = _check_meeting_conflict(db, org_id, advisor_id, meeting, entry.get("external_event_id"))
        sync_map[advisor_id] = entry

    for advisor_id in previous_ids - current_ids:
        prior = previous_sync.get(advisor_id) or {}
        email = _resolve_advisor_email(db, advisor_id)
        if prior.get("external_event_id") and email:
            _delete_event_for_advisor(token, email, prior["external_event_id"])

    return sync_map


def _update_event_for_advisor(db, org_id: str, token: str, advisor_id: str, email: str, event_id: str, meeting: dict, subject: str | None) -> dict:
    try:
        resp = _request_with_retry(
            "PATCH", f"{GRAPH_BASE}/users/{email}/events/{event_id}",
            headers=_headers(token),
            json=_event_payload(meeting, subject),
            timeout=15,
        )
        if resp.status_code == 404:
            # A single 404 on PATCH could mean the event was genuinely deleted in
            # Outlook, OR it could be a transient Graph inconsistency (e.g. under the
            # kind of concurrent load this function now sees) — recreating blindly on
            # an unverified 404 would create a real duplicate event while orphaning the
            # original id (persist_calendar_sync only ever remembers the latest id per
            # advisor, so the old one would never get cleaned up again). Verify via a
            # fresh GET first; only recreate once that independently confirms it's gone.
            check = get_event(db, org_id, advisor_id, event_id)
            if check is None:
                logger.info("calendar event %s confirmed gone on re-check — recreating", event_id)
                return _create_event_for_advisor(db, org_id, token, advisor_id, meeting, subject)
            logger.warning(
                "calendar event %s returned 404 on PATCH but still exists (or check was inconclusive) on "
                "re-check — treating as transient, not recreating to avoid a duplicate", event_id,
            )
            return {"provider": "microsoft", "external_event_id": event_id, "status": "error"}
        resp.raise_for_status()
        _ensure_subscription(db, org_id, advisor_id)
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
