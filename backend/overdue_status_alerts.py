"""Reminders to update meetings whose date has passed but are still "נקבעה" (scheduled) —
nobody closed them by hand and the call-based auto-completion didn't either.

Opt-in per org (the "אוטומציות" modal of the admin meetings tab): organizations.
overdue_status_alerts_enabled (default off) + overdue_status_alert_days (0=Sunday … 6=Saturday) +
overdue_status_alert_hours (start hour of each one-hour window, 7–19). Run by the 5-minute task
cron (tasks_router.recompute_tasks_progress); an org with the feature off costs nothing.

- Which meetings: status 'scheduled', academic_year = DEFAULT_ACADEMIC_YEAR, meeting_date before
  today (Israel). Today is left to the call-based auto-completion.
- Who: every advisor of the meeting still in the org; else its creator (still in the org); else
  the org's owners and managers (`recipients_for`).
- Personal alert: in each chosen window, every user with such meetings gets one bell
  notification (their older one is marked read — the bell holds only the latest) and a popup the
  first time they are active from then on (`popup_shown_at`). The list itself is always read live.
- Summary (optional): overdue_summary_enabled + overdue_summary_recipient_ids (owners/managers),
  daily or weekly (overdue_summary_weekday) at overdue_summary_hour — per responsible user, how many
  meetings are open. Same table, kind='summary'.
- meeting_overdue_status_alerts (UNIQUE org+user+date+hour+kind) is the claim that keeps two
  overlapping cron runs (pg_cron + the GitHub backup) from alerting twice.
- Every run also clears: a user whose list emptied gets their notifications marked read and any
  unshown popup marked shown, so a stale popup never opens outside a window.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from academic_years import DEFAULT_ACADEMIC_YEAR

logger = logging.getLogger(__name__)

_IL_TZ = ZoneInfo("Asia/Jerusalem")
ALERTS_TABLE = "meeting_overdue_status_alerts"
NOTIFICATION_TYPE = "meeting_overdue_status"
SUMMARY_NOTIFICATION_TYPE = "meeting_overdue_summary"
KIND_PERSONAL = "personal"
KIND_SUMMARY = "summary"

ALERT_HOURS = list(range(7, 20))  # window start hours: 07:00–08:00 … 19:00–20:00
DEFAULT_DAYS = [0, 1, 2, 3, 4]  # Sunday–Thursday
DEFAULT_HOURS = [8]
SUMMARY_FREQUENCIES = ("daily", "weekly")
# Statuses a user may set from the alert (the meeting is "scheduled" — anything else closes it).
ALLOWED_NEW_STATUSES = ("completed", "cancelled", "postponed", "other")
# An unshown popup older than this is ignored (the bell notification still holds the list).
POPUP_MAX_AGE_DAYS = 7

MEETING_COLS = ("id, school_id, meeting_date, start_time, end_time, meeting_type, meeting_service_type, "
                "advisor_ids, advisor_id, created_by, academic_year, "
                "schools!inner(org_id, name, status, client_type)")
_EXCLUDED_SCHOOL_STATUSES = ("deleted", "pending_deletion")


def il_now(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)).astimezone(_IL_TZ)


def il_weekday(d: date) -> int:
    """0 = Sunday … 6 = Saturday (Python's weekday() is Monday = 0)."""
    return (d.weekday() + 1) % 7


def clean_days(values) -> list[int]:
    return sorted({int(v) for v in (values or []) if str(v).lstrip("-").isdigit() and 0 <= int(v) <= 6})


def clean_hours(values) -> list[int]:
    return sorted({int(v) for v in (values or []) if str(v).lstrip("-").isdigit() and int(v) in ALERT_HOURS})


def _advisor_ids(meeting: dict) -> list[str]:
    ids = meeting.get("advisor_ids")
    if isinstance(ids, list) and ids:
        return [str(i) for i in ids if i]
    return [str(meeting["advisor_id"])] if meeting.get("advisor_id") else []


def recipients_for(meeting: dict, org_profiles: dict[str, dict]) -> list[str]:
    """Advisors still in the org → else the creator (still in the org) → else owners + managers."""
    advisors = [a for a in _advisor_ids(meeting) if a in org_profiles]
    if advisors:
        return advisors
    creator = str(meeting.get("created_by") or "")
    if creator and creator in org_profiles:
        return [creator]
    return [pid for pid, p in org_profiles.items() if p.get("role") in ("owner", "manager")]


def fetch_org_profiles(db, org_id: str) -> dict[str, dict]:
    rows = db.table("profiles").select("id, full_name, email, role").eq("org_id", org_id).execute().data or []
    return {str(p["id"]): p for p in rows}


def fetch_overdue_meetings(db, org_id: str, today: date) -> list[dict]:
    rows = (db.table("meetings").select(MEETING_COLS)
            .eq("schools.org_id", org_id).eq("status", "scheduled")
            .eq("academic_year", DEFAULT_ACADEMIC_YEAR).lt("meeting_date", today.isoformat())
            .order("meeting_date").execute().data or [])
    return [m for m in rows if (m.get("schools") or {}).get("status") not in _EXCLUDED_SCHOOL_STATUSES]


def group_by_user(meetings: list[dict], org_profiles: dict[str, dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for m in meetings:
        for uid in recipients_for(m, org_profiles):
            out.setdefault(uid, []).append(m)
    return out


def serialize_meeting(m: dict, org_profiles: dict[str, dict]) -> dict:
    school = m.get("schools") or {}
    return {
        "id": m["id"],
        "school_id": m.get("school_id"),
        "school_name": school.get("name") or "",
        "school_client_type": school.get("client_type") or "school",
        "meeting_date": m.get("meeting_date"),
        "start_time": m.get("start_time"),
        "end_time": m.get("end_time"),
        "meeting_type": m.get("meeting_type"),
        "meeting_service_type": m.get("meeting_service_type"),
        "academic_year": m.get("academic_year"),
        "advisor_names": [
            (org_profiles.get(a) or {}).get("full_name") or (org_profiles.get(a) or {}).get("email") or ""
            for a in _advisor_ids(m) if a in org_profiles
        ],
    }


def summary_rows(by_user: dict[str, list[dict]], org_profiles: dict[str, dict]) -> list[dict]:
    rows = []
    for uid, ms in by_user.items():
        p = org_profiles.get(uid) or {}
        rows.append({
            "user_id": uid,
            "name": p.get("full_name") or p.get("email") or "",
            "count": len(ms),
            "oldest_date": min((m.get("meeting_date") or "" for m in ms), default=None) or None,
            "meetings": [serialize_meeting(m, org_profiles) for m in ms],
        })
    rows.sort(key=lambda r: (-r["count"], r["name"]))
    return rows


def _personal_title(count: int) -> str:
    if count == 1:
        return "יש לך פגישה אחת שהתאריך שלה עבר והיא עדיין בסטטוס 'נקבעה'. יש לעדכן את הסטטוס שלה."
    return f"יש לך {count} פגישות שהתאריך שלהן עבר והן עדיין בסטטוס 'נקבעה'. יש לעדכן את הסטטוס שלהן."


def _summary_title(total: int, users: int) -> str:
    who = "משתמש אחד" if users == 1 else f"{users} משתמשים"
    what = "פגישה אחת" if total == 1 else f"{total} פגישות"
    return f"סיכום: {what} שהתאריך שלהן עבר עדיין בסטטוס 'נקבעה', אצל {who}."


def personal_window_due(org: dict, now_il: datetime) -> bool:
    days = clean_days(org.get("overdue_status_alert_days")) or DEFAULT_DAYS
    hours = clean_hours(org.get("overdue_status_alert_hours")) or DEFAULT_HOURS
    return il_weekday(now_il.date()) in days and now_il.hour in hours


def summary_window_due(org: dict, now_il: datetime) -> bool:
    if not org.get("overdue_summary_enabled"):
        return False
    if now_il.hour != (org.get("overdue_summary_hour") if org.get("overdue_summary_hour") is not None else 8):
        return False
    if (org.get("overdue_summary_frequency") or "weekly") == "daily":
        return True
    return il_weekday(now_il.date()) == int(org.get("overdue_summary_weekday") or 0)


def run_overdue_status_alerts(db, now: datetime | None = None) -> dict:
    """One pass over every org with the feature on. Never raises; a failing org is retried next run."""
    now_il = il_now(now)
    summary = {"orgs": 0, "sent": 0, "summaries": 0, "cleared": 0, "failed_orgs": 0}
    try:
        orgs = (db.table("organizations")
                .select("id, overdue_status_alert_days, overdue_status_alert_hours, overdue_summary_enabled, "
                        "overdue_summary_recipient_ids, overdue_summary_frequency, overdue_summary_weekday, "
                        "overdue_summary_hour")
                .eq("overdue_status_alerts_enabled", True).execute().data or [])
    except Exception as exc:
        logger.warning("overdue status alerts: org lookup failed (retried next run): %s", exc)
        return summary
    for org in orgs:
        summary["orgs"] += 1
        try:
            sent, summaries, cleared = _process_org(db, org, now_il)
            summary["sent"] += sent
            summary["summaries"] += summaries
            summary["cleared"] += cleared
        except Exception as exc:
            summary["failed_orgs"] += 1
            logger.warning("overdue status alerts failed for org %s (retried next run): %s", org.get("id"), exc)
    return summary


def _process_org(db, org: dict, now_il: datetime) -> tuple[int, int, int]:
    org_id = org["id"]
    profiles = fetch_org_profiles(db, org_id)
    by_user = group_by_user(fetch_overdue_meetings(db, org_id, now_il.date()), profiles)
    cleared = _clear_resolved(db, org_id, profiles, by_user, now_il)
    sent = _send_personal(db, org_id, by_user, now_il) if by_user and personal_window_due(org, now_il) else 0
    summaries = 0
    if by_user and summary_window_due(org, now_il):
        summaries = _send_summary(db, org, profiles, by_user, now_il)
    return sent, summaries, cleared


def _clear_resolved(db, org_id: str, profiles: dict, by_user: dict, now_il: datetime) -> int:
    """Users with nothing left: their alerts are marked read and their unshown popups shown."""
    done = [uid for uid in profiles if uid not in by_user]
    if not done:
        return 0
    now_iso = now_il.astimezone(timezone.utc).isoformat()
    types = [NOTIFICATION_TYPE] + ([SUMMARY_NOTIFICATION_TYPE] if not by_user else [])
    res = (db.table("notifications").update({"read_at": now_iso}).in_("type", types)
           .in_("recipient_id", done).is_("read_at", "null").execute())
    db.table(ALERTS_TABLE).update({"popup_shown_at": now_iso}).eq("org_id", org_id).eq("kind", KIND_PERSONAL) \
        .in_("user_id", done).is_("popup_shown_at", "null").execute()
    if not by_user:
        db.table(ALERTS_TABLE).update({"popup_shown_at": now_iso}).eq("org_id", org_id).eq("kind", KIND_SUMMARY) \
            .is_("popup_shown_at", "null").execute()
    return len(res.data or [])


def _claim(db, org_id: str, user_counts: dict[str, int], kind: str, now_il: datetime) -> list[str]:
    """Inserts this window's row per user; returns only users whose row is new (ON CONFLICT DO NOTHING)."""
    rows = [{"org_id": org_id, "user_id": uid, "kind": kind, "alert_date": now_il.date().isoformat(),
             "hour": now_il.hour, "meeting_count": n} for uid, n in user_counts.items()]
    res = db.table(ALERTS_TABLE).upsert(
        rows, on_conflict="org_id,user_id,alert_date,hour,kind", ignore_duplicates=True,
    ).execute()
    return [str(r["user_id"]) for r in (res.data or [])]


def _unclaim(db, org_id: str, user_ids: list[str], kind: str, now_il: datetime) -> None:
    try:
        db.table(ALERTS_TABLE).delete().eq("org_id", org_id).eq("kind", kind) \
            .eq("alert_date", now_il.date().isoformat()).eq("hour", now_il.hour).in_("user_id", user_ids).execute()
    except Exception as exc:
        logger.warning("overdue status alerts: undo of claims failed: %s", exc)


def _notify(db, org_id: str, user_ids: list[str], ntype: str, kind: str, now_il: datetime,
            build) -> int:
    """Replaces each user's unread alert of this type with a new one. If the insert fails, the
    claims are undone so the window is retried next run."""
    if not user_ids:
        return 0
    now_iso = now_il.astimezone(timezone.utc).isoformat()
    try:
        db.table("notifications").update({"read_at": now_iso}).eq("type", ntype) \
            .in_("recipient_id", user_ids).is_("read_at", "null").execute()
        db.table("notifications").insert([
            {"recipient_id": uid, "type": ntype, "data": build(uid)} for uid in user_ids
        ]).execute()
    except Exception:
        _unclaim(db, org_id, user_ids, kind, now_il)
        raise
    return len(user_ids)


def _send_personal(db, org_id: str, by_user: dict, now_il: datetime) -> int:
    claimed = _claim(db, org_id, {uid: len(ms) for uid, ms in by_user.items()}, KIND_PERSONAL, now_il)
    return _notify(db, org_id, claimed, NOTIFICATION_TYPE, KIND_PERSONAL, now_il, lambda uid: {
        "title": _personal_title(len(by_user[uid])), "count": len(by_user[uid]), "deeplink": "/notifications",
    })


def _send_summary(db, org: dict, profiles: dict, by_user: dict, now_il: datetime) -> int:
    wanted = {str(x) for x in (org.get("overdue_summary_recipient_ids") or [])}
    recipients = [uid for uid in wanted if (profiles.get(uid) or {}).get("role") in ("owner", "manager")]
    if not recipients:
        return 0
    total = len({m["id"] for ms in by_user.values() for m in ms})
    claimed = _claim(db, org["id"], {uid: total for uid in recipients}, KIND_SUMMARY, now_il)
    title = _summary_title(total, len(by_user))
    return _notify(db, org["id"], claimed, SUMMARY_NOTIFICATION_TYPE, KIND_SUMMARY, now_il, lambda uid: {
        "title": title, "count": total, "deeplink": "/notifications",
    })


def popups_due(db, org_id: str, user_id: str, now_il: datetime) -> set[str]:
    """Kinds with an alert not yet shown as a popup. One small query — this is what the sidebar
    polls every minute; the list itself is loaded only when a popup / bell row opens. Rows of a
    user whose list emptied are marked shown by the cron run, so a due popup has meetings."""
    since = (now_il.date() - timedelta(days=POPUP_MAX_AGE_DAYS - 1)).isoformat()
    rows = (db.table(ALERTS_TABLE).select("kind").eq("org_id", org_id).eq("user_id", user_id)
            .is_("popup_shown_at", "null").gte("alert_date", since).execute().data or [])
    return {r["kind"] for r in rows}


def popup_due(db, org_id: str, user_id: str, kind: str, now_il: datetime) -> bool:
    return kind in popups_due(db, org_id, user_id, now_il)


def mark_popup_shown(db, org_id: str, user_id: str, kind: str) -> None:
    db.table(ALERTS_TABLE).update({"popup_shown_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("org_id", org_id).eq("user_id", user_id).eq("kind", kind).is_("popup_shown_at", "null").execute()


def close_pending(db, org_id: str, kinds: tuple[str, ...]) -> None:
    """The org turned the feature (or the summary) off: pending popups are dropped and the bell
    alerts marked read, so nothing keeps popping up for a switched-off automation."""
    now_iso = datetime.now(timezone.utc).isoformat()
    db.table(ALERTS_TABLE).update({"popup_shown_at": now_iso}).eq("org_id", org_id).in_("kind", list(kinds)) \
        .is_("popup_shown_at", "null").execute()
    ntypes = [NOTIFICATION_TYPE if k == KIND_PERSONAL else SUMMARY_NOTIFICATION_TYPE for k in kinds]
    user_ids = list(fetch_org_profiles(db, org_id))
    if user_ids:
        db.table("notifications").update({"read_at": now_iso}).in_("type", ntypes) \
            .in_("recipient_id", user_ids).is_("read_at", "null").execute()
