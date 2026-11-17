"""Daily alerts on meetings still "בוטלה" (cancelled) — the cause of the cancellation hasn't been
looked into yet ("בוטלה ונבדקה" = cancelled_reviewed marks that it was).

Opt-in per org (owner only): organizations.cancel_review_alerts_enabled (default off) +
cancel_review_alert_recipient_ids. Run by the 5-minute task cron (tasks_router.recompute_tasks_progress);
an org with the feature off costs nothing.

- New cancellations are found in meeting_activity (every path that writes meetings must log there),
  so no meeting-writing path needs a hook: a status change to "cancelled", or a meeting created as
  "cancelled" (imports excluded — historical records). Only events after
  organizations.cancel_review_scan_after count; enabling sets it to "now", so turning the feature on
  never floods the org with its older cancellations.
- meeting_cancel_review_alerts holds one row per meeting: when it was cancelled, how many alerts were
  sent, the last alert's Israel date (at most one alert per meeting per day). A meeting cancelled
  again after leaving "cancelled" starts over.
- A meeting that left "cancelled" (reviewed, rescheduled, deleted) is resolved and its alert
  notifications are marked read for every recipient.
- Alerts are sent only Sun–Thu 08:00–20:00 and Fri 08:00–15:00 (Israel); never on Saturday.
"""
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_IL_TZ = ZoneInfo("Asia/Jerusalem")
NOTIFICATION_TYPE = "meeting_cancel_review"
ALERTS_TABLE = "meeting_cancel_review_alerts"
_EXCLUDED_SOURCES = ("import", "import_remap")
# Events this close to "now" are scanned again next run (idempotent), so a row inserted while a
# scan is running is never skipped.
_SCAN_OVERLAP = timedelta(minutes=2)


def in_send_window(now_il: datetime) -> bool:
    """Sun–Thu 08:00–20:00, Fri 08:00–15:00, never Saturday (Israel time)."""
    wd = now_il.weekday()  # Mon=0 … Fri=4, Sat=5, Sun=6
    if wd == 5:
        return False
    end_hour = 15 if wd == 4 else 20
    return 8 <= now_il.hour < end_hour


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_date(iso: str | None) -> str:
    if not iso:
        return "ללא תאריך"
    y, m, d = iso[:10].split("-")
    return f"{d}/{m}/{y}"


def _alert_title(school_name: str, meeting_date: str | None, first: bool, days_ago: int) -> str:
    what = f"הפגישה עם {school_name} מ-{_format_date(meeting_date)}"
    if first:
        return f"{what} בוטלה. יש לבדוק את סיבת הביטול, ולאחר הבדיקה לעדכן את הסטטוס ל'בוטלה ונבדקה'."
    when = "אתמול" if days_ago <= 1 else f"לפני {days_ago} ימים"
    return (f"תזכורת: {what} בוטלה {when}, וסיבת הביטול עדיין לא נבדקה. "
            f"אם נבדקה, יש לעדכן את הסטטוס ל'בוטלה ונבדקה'.")


def run_cancel_review_alerts(db, now: datetime | None = None) -> dict:
    """One pass over every org with the feature on. Never raises; a failing org is retried next run."""
    now = now or datetime.now(timezone.utc)
    summary = {"orgs": 0, "sent": 0, "resolved": 0, "failed_orgs": 0}
    try:
        orgs = (db.table("organizations")
                .select("id, cancel_review_alert_recipient_ids, cancel_review_scan_after")
                .eq("cancel_review_alerts_enabled", True).execute().data or [])
    except Exception as exc:
        logger.warning("cancel review alerts: org lookup failed (retried next run): %s", exc)
        return summary
    for org in orgs:
        summary["orgs"] += 1
        try:
            sent, resolved = _process_org(db, org, now)
            summary["sent"] += sent
            summary["resolved"] += resolved
        except Exception as exc:
            summary["failed_orgs"] += 1
            logger.warning("cancel review alerts failed for org %s (retried next run): %s", org.get("id"), exc)
    return summary


def _process_org(db, org: dict, now: datetime) -> tuple[int, int]:
    org_id = org["id"]
    _record_new_cancellations(db, org, now)
    resolved, pending = _resolve_and_collect_pending(db, org_id, now)
    sent = 0
    now_il = now.astimezone(_IL_TZ)
    if pending and in_send_window(now_il):
        sent = _send_alerts(db, org, pending, now_il)
    return sent, resolved


def _record_new_cancellations(db, org: dict, now: datetime) -> None:
    org_id = org["id"]
    scan_after = org.get("cancel_review_scan_after")
    if not scan_after:
        # Enabled without a starting point (shouldn't happen via the API): start counting now.
        db.table("organizations").update({"cancel_review_scan_after": now.isoformat()}).eq("id", org_id).execute()
        return
    cols = "meeting_id, school_id, source, created_at"
    changed = (db.table("meeting_activity").select(cols).eq("org_id", org_id).gte("created_at", scan_after)
               .eq("changes->status->>to", "cancelled").execute().data or [])
    created = (db.table("meeting_activity").select(cols).eq("org_id", org_id).gte("created_at", scan_after)
               .eq("action", "created").eq("snapshot->>status", "cancelled").execute().data or [])

    latest: dict[str, dict] = {}
    for ev in changed + created:
        if not ev.get("meeting_id") or ev.get("source") in _EXCLUDED_SOURCES:
            continue
        cur = latest.get(ev["meeting_id"])
        if cur is None or _parse_ts(ev["created_at"]) > _parse_ts(cur["created_at"]):
            latest[ev["meeting_id"]] = ev

    if latest:
        existing = {
            r["meeting_id"]: r for r in (
                db.table(ALERTS_TABLE).select("id, meeting_id, cancelled_at")
                .in_("meeting_id", list(latest)).execute().data or []
            )
        }
        for meeting_id, ev in latest.items():
            row = existing.get(meeting_id)
            if row is None:
                db.table(ALERTS_TABLE).insert({
                    "org_id": org_id, "school_id": ev.get("school_id"), "meeting_id": meeting_id,
                    "cancelled_at": ev["created_at"],
                }).execute()
            elif _parse_ts(ev["created_at"]) > _parse_ts(row["cancelled_at"]):
                # Cancelled again after leaving "cancelled" — a new cancellation, alerts start over.
                db.table(ALERTS_TABLE).update({
                    "cancelled_at": ev["created_at"], "alerts_sent": 0, "last_alerted_on": None,
                    "resolved_at": None,
                }).eq("id", row["id"]).execute()

    new_cursor = max(_parse_ts(scan_after), now - _SCAN_OVERLAP)
    db.table("organizations").update({"cancel_review_scan_after": new_cursor.isoformat()}).eq("id", org_id).execute()


def _resolve_and_collect_pending(db, org_id: str, now: datetime) -> tuple[int, list[dict]]:
    """Resolves open rows whose meeting left "cancelled" (or is gone) and marks their alerts read.
    Returns (resolved count, open rows still cancelled — each with its meeting attached)."""
    rows = (db.table(ALERTS_TABLE).select("*").eq("org_id", org_id).is_("resolved_at", "null")
            .execute().data or [])
    if not rows:
        return 0, []
    meetings = {
        m["id"]: m for m in (
            db.table("meetings").select("id, status, school_id, meeting_date, academic_year")
            .in_("id", [r["meeting_id"] for r in rows]).execute().data or []
        )
    }
    done = [r for r in rows if (meetings.get(r["meeting_id"]) or {}).get("status") != "cancelled"]
    if done:
        now_iso = now.isoformat()
        db.table(ALERTS_TABLE).update({"resolved_at": now_iso}).in_("id", [r["id"] for r in done]).execute()
        try:
            (db.table("notifications").update({"read_at": now_iso}).eq("type", NOTIFICATION_TYPE)
             .in_("ref_id", [r["meeting_id"] for r in done]).is_("read_at", "null").execute())
        except Exception as exc:
            logger.warning("cancel review alerts: marking notifications read failed (non-fatal): %s", exc)
    done_ids = {r["id"] for r in done}
    pending = [{**r, "meeting": meetings[r["meeting_id"]]} for r in rows if r["id"] not in done_ids]
    return len(done), pending


def _send_alerts(db, org: dict, pending: list[dict], now_il: datetime) -> int:
    today = now_il.date()
    due = [r for r in pending if r.get("last_alerted_on") != today.isoformat()]
    if not due:
        return 0
    wanted = [str(x) for x in (org.get("cancel_review_alert_recipient_ids") or [])]
    if not wanted:
        return 0
    # Only users still in this org (a removed user, or a stale id, never gets alerts).
    recipients = [
        p["id"] for p in (
            db.table("profiles").select("id").eq("org_id", org["id"]).in_("id", wanted).execute().data or []
        )
    ]
    if not recipients:
        return 0
    school_ids = list({r["meeting"].get("school_id") for r in due if r["meeting"].get("school_id")})
    school_names = {
        s["id"]: s.get("name") or "בית הספר" for s in (
            db.table("schools").select("id, name").in_("id", school_ids).execute().data or []
        )
    } if school_ids else {}

    # Claim each row for today first, atomically (the update matches only while today isn't marked
    # yet), so two overlapping cron runs (pg_cron + the GitHub backup fire on the same minutes)
    # never both alert. A failure after the insert can't re-send every 5 minutes either; if the
    # insert itself fails, the claims are undone so today's alert is retried next run.
    today_iso = today.isoformat()
    claimed = []
    for r in due:
        res = (db.table(ALERTS_TABLE)
               .update({"alerts_sent": (r.get("alerts_sent") or 0) + 1, "last_alerted_on": today_iso})
               .eq("id", r["id"]).or_(f"last_alerted_on.is.null,last_alerted_on.neq.{today_iso}")
               .execute())
        if res.data:
            claimed.append(r)
    if not claimed:
        return 0

    notifications = []
    for r in claimed:
        m = r["meeting"]
        school_id = m.get("school_id")
        cancelled_day = _parse_ts(r["cancelled_at"]).astimezone(_IL_TZ).date()
        title = _alert_title(
            school_names.get(school_id, "בית הספר"), m.get("meeting_date"),
            first=(r.get("alerts_sent") or 0) == 0, days_ago=(today - cancelled_day).days,
        )
        deeplink = f"/school/{school_id}?tab=meetings"
        if m.get("academic_year"):
            deeplink += f"&year={quote(m['academic_year'])}"
        for rid in recipients:
            notifications.append({
                "recipient_id": rid, "type": NOTIFICATION_TYPE, "school_id": school_id,
                "ref_id": r["meeting_id"], "data": {"title": title, "deeplink": deeplink},
            })
    try:
        db.table("notifications").insert(notifications).execute()
    except Exception:
        for r in claimed:
            try:
                db.table(ALERTS_TABLE).update({
                    "alerts_sent": r.get("alerts_sent") or 0, "last_alerted_on": r.get("last_alerted_on"),
                }).eq("id", r["id"]).execute()
            except Exception as exc:
                logger.warning("cancel review alerts: undo of row %s failed: %s", r["id"], exc)
        raise
    return len(claimed)
