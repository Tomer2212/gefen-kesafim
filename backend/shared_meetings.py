"""A meeting with several performing advisors — what one of them does in their own calendar must
not harm the others. Provider-agnostic rules + the "moved" notification; the calendar I/O is the
caller's (schools_router._reconcile_meeting_from_outlook).

- Deleting the event in one's own calendar removes only that advisor from the meeting.
- Moving it moves the meeting for everyone: the system, the other advisors' calendars, and a
  notification to them.

Who moved: each calendar_sync entry keeps `event_time` — the [date, start, end] we last wrote to,
or saw in, that advisor's calendar. An event that differs from its own event_time was moved by its
owner; one that still shows it while the meeting differs is a push of ours that failed, and is
pushed again — never read as a move back. Entries saved before event_time existed are compared
with the meeting itself.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import meeting_overlaps

logger = logging.getLogger(__name__)

COLLAPSE_MINUTES = 15
NEW_MEETING_MINUTES = 15  # its creator is still filling it in — not a move
NOTIFICATION_TYPE = "meeting_moved"


def org_advisors(db, org_id: str, meeting: dict) -> list[dict]:
    """The meeting's performing advisors who are still users of the org, in order ({id, full_name})."""
    ids = meeting_overlaps.advisor_ids(meeting)
    if not ids:
        return []
    rows = db.table("profiles").select("id, full_name, email").eq("org_id", org_id).in_("id", ids).execute().data or []
    by_id = {r["id"]: r for r in rows}
    ids = list(dict.fromkeys(ids))
    return [{"id": i, "full_name": by_id[i].get("full_name") or by_id[i].get("email")} for i in ids if i in by_id]


def event_time(event: dict) -> list[str]:
    return [event["start"][:10], event["start"][11:16], event["end"][11:16]]


def decide(meeting: dict, advisors: list[str], expected: list[str] | None, events: dict) -> dict:
    """events: {advisor_id: event dict | None (confirmed gone)} — an advisor whose check failed is
    simply absent. expected: the event time this meeting writes to a calendar (None = no date).
    Returns {"gone": [...], "cancel": bool, "moved_by": advisor_id | None, "repush": [...],
    "end_time": the event's end for a meeting saved with a start only (a meeting without any hours
    stays without), else None}."""
    sync = meeting.get("calendar_sync") or {}
    gone = [a for a in advisors if a in events and events[a] is None]
    present = {a: events[a] for a in advisors if events.get(a)}
    moved, repush = [], []
    for a, ev in present.items():
        seen = event_time(ev)
        if seen == expected:
            continue
        entry = sync.get(a) or {}
        baseline = entry.get("event_time")
        # Without a baseline, an entry whose last write failed shows an old time of ours.
        if seen == baseline if baseline else entry.get("status") == "error":
            if expected:
                repush.append(a)
        else:
            moved.append(a)
    winner = max(moved, key=lambda a: present[a].get("modified") or "") if moved else None
    return {
        "gone": gone,
        "cancel": bool(gone) and len(gone) == len(advisors),
        "moved_by": winner,
        "repush": [] if winner else repush,
        "end_time": expected[2] if not winner and meeting.get("start_time") and not meeting.get("end_time")
        and any(event_time(e) == expected for e in present.values()) else None,
    }


def _when(m: dict) -> list:
    return [str(m.get("meeting_date") or "")[:10], str(m.get("start_time") or "")[:5], str(m.get("end_time") or "")[:5]]


def _when_text(when: list) -> str:
    d, s, e = when
    return f"{d[8:10]}/{d[5:7]}/{d[2:4]}, {s}–{e}"


def notify_moved(db, org_id: str, meeting: dict, before: dict | None, actor_id: str | None, sync_map: dict | None = None) -> None:
    """Tells the other performing advisors of a shared meeting that it was moved. Moves of one
    meeting within COLLAPSE_MINUTES share one unread notification (first original -> last new);
    moving back drops it. Never raises."""
    try:
        if not before or meeting.get("status") != "scheduled":
            return
        old, new = _when(before), _when(meeting)
        if old == new or not all(old) or not all(new):
            return
        advisors = org_advisors(db, org_id, meeting)
        if len(advisors) < 2:
            return
        now = datetime.now(timezone.utc)
        today = now.astimezone(ZoneInfo("Asia/Jerusalem")).date().isoformat()
        if max(old[0], new[0]) < today:
            return  # a correction of something already past
        if actor_id and actor_id == meeting.get("created_by") and meeting.get("created_at") and \
                datetime.fromisoformat(meeting["created_at"]) > now - timedelta(minutes=NEW_MEETING_MINUTES):
            return
        if actor_id:
            # They just set the time themselves — an older "X moved it" no longer matters to them.
            db.table("notifications").update({"read_at": now.isoformat()}).eq("recipient_id", actor_id) \
                .eq("type", NOTIFICATION_TYPE).eq("ref_id", meeting["id"]).is_("read_at", "null").execute()
        recipients = [a["id"] for a in advisors if a["id"] != actor_id]
        actor = next((a["full_name"] for a in advisors if a["id"] == actor_id), None)
        if not actor and actor_id:
            rows = db.table("profiles").select("full_name, email").eq("id", actor_id).execute().data or []
            actor = (rows[0].get("full_name") or rows[0].get("email")) if rows else None
        school = (db.table("schools").select("name").eq("id", meeting["school_id"]).execute().data or [{}])[0].get("name") or "בית הספר"
        pending = {
            r["recipient_id"]: r for r in (
                db.table("notifications").select("id, recipient_id, data").eq("type", NOTIFICATION_TYPE)
                .eq("ref_id", meeting["id"]).in_("recipient_id", recipients).is_("read_at", "null")
                .gte("created_at", (now - timedelta(minutes=COLLAPSE_MINUTES)).isoformat()).execute()
            ).data or []
        }
        rows = []
        for rid in recipients:
            first = ((pending.get(rid) or {}).get("data") or {}).get("from") or old
            if pending.get(rid) and first == new:
                db.table("notifications").delete().eq("id", pending[rid]["id"]).execute()
                continue
            text = f"המועד המקורי: {_when_text(first)}\nהמועד החדש: {_when_text(new)}"
            if ((sync_map or {}).get(rid) or {}).get("conflict"):
                text += "\nבמועד החדש כבר רשום לך משהו אחר ביומן."
            data = {
                "title": f"שימו לב! {actor or 'משתמש'} הזיז/ה את מועד הפגישה המשותפת שלכם עם {school}",
                "text": text, "from": first, "to": new, "school_name": school, "meeting_id": meeting["id"],
                "deeplink": f"/school/{meeting['school_id']}?tab=meetings",
            }
            if pending.get(rid):
                db.table("notifications").update({"data": data, "created_at": now.isoformat()}).eq("id", pending[rid]["id"]).execute()
            else:
                rows.append({"recipient_id": rid, "type": NOTIFICATION_TYPE, "ref_id": meeting["id"],
                             "school_id": meeting["school_id"], "data": data})
        if rows:
            db.table("notifications").insert(rows).execute()
    except Exception as exc:
        logger.warning("notify_moved failed for meeting %s (non-fatal): %s", meeting.get("id"), exc)
