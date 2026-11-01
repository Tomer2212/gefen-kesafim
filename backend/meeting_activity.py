"""Per-meeting activity log ("תיעוד פעילות") — who created/changed what in a meeting, and when.

Every write path to `meetings` (and the related notes / offline-work / summary actions) calls
`log_meeting_activity` AFTER its own write succeeded. Logging is strictly non-fatal: a failure
here only logs a warning and never affects the meeting write itself.

Rows live in `meeting_activity` (service_role only, no FK to meetings so the log outlives a
deleted meeting). `changes` holds only the tracked fields that really changed; an "updated"
event with no real change is not recorded at all — autosave-on-blur and the 10-minute call
aggregate recompute send many identical saves, which must not flood the log.
"""
import logging

logger = logging.getLogger(__name__)

# Meeting fields shown in the activity log. Technical/noisy columns (calendar_sync,
# calls_synced_at, summary_*, import_raw, legacy notes) are deliberately excluded.
TRACKED_FIELDS = (
    "meeting_date", "status", "start_time", "end_time", "advisor_ids", "participants",
    "stage_scope", "meeting_type", "meeting_service_type", "reminder_enabled",
    "requested_upload_years", "academic_year", "school_id",
    "calls_start_time", "calls_duration_seconds",
)
# primary_contact_key is intentionally not tracked: it only picks which participant names the
# Outlook subject and changes implicitly with participants — on its own it would highlight a
# cell whose visible value didn't change.
TRACKED_SELECT = "id, " + ", ".join(TRACKED_FIELDS) + ", advisor_id"

# Actions whose meaning is a change of meeting fields (diffed; an "updated" with no real
# change is dropped). Every other action (created, deleted, note_*, offline_*, summary_*)
# is recorded as-is.
FIELD_CHANGE_ACTIONS = {"updated", "moved_year", "reassigned_school", "advisor_joined"}

# Client surfaces allowed in the X-Client-Surface header (anything else is stored as None).
CLIENT_SURFACES = {"school_card", "personal", "admin", "status_popup"}


def client_surface(value: str | None) -> str | None:
    return value if value in CLIENT_SURFACES else None


def _norm(field: str, value):
    """Normalizes values so cosmetic differences (None vs [] vs "", "09:00:00" vs "09:00")
    don't register as a change."""
    if value in ("", [], {}):
        value = None
    if field == "calls_duration_seconds" and not value:
        value = None  # never-synced (NULL) and "no calls" (0) are the same thing to a reader
    if field in ("start_time", "end_time", "calls_start_time") and isinstance(value, str):
        value = value[:5]
    if field == "reminder_enabled":
        value = bool(value)
    return value


def snapshot_of(row: dict | None) -> dict:
    row = row or {}
    snap = {f: row.get(f) for f in TRACKED_FIELDS}
    if not snap.get("advisor_ids") and row.get("advisor_id"):
        snap["advisor_ids"] = [row["advisor_id"]]
    return snap


def diff_fields(before: dict | None, after: dict | None) -> dict:
    """{field: {from, to}} for every tracked field that is present in `after` and differs."""
    before = snapshot_of(before)
    changes = {}
    for f in TRACKED_FIELDS:
        if after is None or f not in after:
            continue
        old, new = before.get(f), after.get(f)
        if _norm(f, old) != _norm(f, new):
            changes[f] = {"from": old, "to": new}
    return changes


def fetch_tracked(db, meeting_id: str) -> dict | None:
    """Reads the tracked fields of one meeting (the "before" state). Non-fatal: None on failure."""
    try:
        rows = db.table("meetings").select(TRACKED_SELECT).eq("id", meeting_id).execute().data
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("meeting activity: before-state read failed for %s (non-fatal): %s", meeting_id, exc)
        return None


def fetch_tracked_many(db, meeting_ids: list[str]) -> dict[str, dict]:
    if not meeting_ids:
        return {}
    try:
        rows = db.table("meetings").select(TRACKED_SELECT).in_("id", meeting_ids).execute().data or []
        return {r["id"]: r for r in rows}
    except Exception as exc:
        logger.warning("meeting activity: bulk before-state read failed (non-fatal): %s", exc)
        return {}


def _org_of_school(db, school_id: str | None) -> str | None:
    if not school_id:
        return None
    try:
        rows = db.table("schools").select("org_id").eq("id", school_id).execute().data
        return rows[0]["org_id"] if rows else None
    except Exception:
        return None


def build_event(*, meeting_id: str, school_id: str | None, org_id: str | None, actor_id: str | None,
                actor_type: str, source: str | None, action: str,
                before: dict | None = None, after: dict | None = None, meta: dict | None = None) -> dict | None:
    """Builds one meeting_activity row, or None when an "updated" event has no real change."""
    merged_after = {**snapshot_of(before), **(after or {})} if after is not None else snapshot_of(before)
    if action not in FIELD_CHANGE_ACTIONS:
        # created / deleted / note_* / offline_* / summary_* — no field diff.
        changes = {}
    else:
        if before is None:
            # Before-state read failed — every field would look "changed"; skip rather than mislead.
            return None
        changes = diff_fields(before, after)
        if not changes:
            return None
    return {
        "meeting_id": meeting_id,
        "school_id": school_id or merged_after.get("school_id"),
        "org_id": org_id,
        "actor_id": actor_id,
        "actor_type": actor_type,
        "source": source,
        "action": action,
        "changes": changes or None,
        "snapshot": {f: merged_after.get(f) for f in TRACKED_FIELDS},
        "meta": meta or None,
    }


def log_meeting_activity(db, **kwargs) -> None:
    """Records one activity event. Never raises."""
    try:
        event = build_event(**kwargs)
        if not event:
            return
        if not event["org_id"]:
            event["org_id"] = _org_of_school(db, event["school_id"])
        db.table("meeting_activity").insert(event).execute()
    except Exception as exc:
        logger.warning("meeting activity log failed for %s (non-fatal): %s", kwargs.get("meeting_id"), exc)


def log_meeting_activity_bulk(db, events: list[dict]) -> None:
    """Records many events (each a kwargs dict for build_event) in one insert. Never raises."""
    try:
        rows = [e for e in (build_event(**kw) for kw in events) if e]
        if not rows:
            return
        org_cache: dict = {}
        for r in rows:
            if not r["org_id"] and r["school_id"]:
                if r["school_id"] not in org_cache:
                    org_cache[r["school_id"]] = _org_of_school(db, r["school_id"])
                r["org_id"] = org_cache[r["school_id"]]
        for i in range(0, len(rows), 500):
            db.table("meeting_activity").insert(rows[i:i + 500]).execute()
    except Exception as exc:
        logger.warning("meeting activity bulk log failed (non-fatal): %s", exc)
