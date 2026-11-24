"""A meeting with several performing advisors: deleting or moving the event in one advisor's
calendar (shared_meetings + _reconcile_meeting_from_outlook). Offline: calendars are a dict."""
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import graph_client  # noqa: E402
import shared_meetings  # noqa: E402
from routers import schools_router as sr  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402

ORG = "org"
OLD, NEW, OTHER = ["2036-11-23", "10:00", "11:00"], ["2036-11-24", "12:00", "13:00"], ["2036-11-25", "08:00", "09:00"]


def ev(t, modified="2026-11-22T10:00:00Z"):
    return {"start": f"{t[0]}T{t[1]}:00.0000000", "end": f"{t[0]}T{t[2]}:00.0000000", "subject": "s", "modified": modified}


class World:
    """One meeting, its advisors' calendars, and every write made to a calendar."""

    def __init__(self, advisors=("x", "y"), connected=("x", "y"), time=OLD, baseline=OLD):
        sync = {a: {"external_event_id": f"ev-{a}", "status": "synced", "mailbox": f"{a}@m",
                    **({"event_time": baseline} if baseline else {})} for a in connected}
        self.db = FakeDb({
            "meetings": [{"id": "m", "school_id": "s", "status": "scheduled", "meeting_date": time[0], "start_time": time[1],
                          "end_time": time[2], "advisor_ids": list(advisors), "calendar_sync": sync, "participants": []}],
            "profiles": [{"id": a, "org_id": ORG, "full_name": a.upper()} for a in ("x", "y", "z", "boss")],
            "schools": [{"id": "s", "name": "SCHOOL", "org_id": ORG}],
        })
        self.cal = {f"ev-{a}": ev(baseline or time) for a in connected}
        self.writes, self.fail_push = [], set()

    @property
    def row(self):
        return self.db.tables["meetings"][0]

    @property
    def time(self):
        return [self.row["meeting_date"], self.row["start_time"], self.row["end_time"]]

    def shows(self, a):
        return shared_meetings.event_time(self.cal[f"ev-{a}"])

    def run(self, prefetched=None):
        return sr._reconcile_meeting_from_outlook(self.db, ORG, dict(self.row), prefetched)["action"]

    def bells(self):
        return {n["recipient_id"]: n["data"] for n in self.db.tables.get("notifications", []) if not n.get("read_at")}


@pytest.fixture
def world(monkeypatch):
    def make(**kw):
        w = World(**kw)

        def get_event(db, org, advisor_id, event_id):
            return w.cal.get(event_id)

        def update(db, org, token, advisor_id, email, event_id, meeting, subject, show_as=None, clear=False):
            w.writes.append(advisor_id)
            if advisor_id in w.fail_push:
                return {"external_event_id": event_id, "status": "error", "error": "x"}
            t = graph_client.written_event_time(meeting)
            w.cal[event_id] = ev(t)
            return {"external_event_id": event_id, "status": "synced", "event_time": t, "mailbox": email}

        @contextmanager
        def lock(db, meeting_id):
            yield True

        monkeypatch.setattr(graph_client, "get_event", get_event)
        monkeypatch.setattr(graph_client, "_update_event_for_advisor", update)
        monkeypatch.setattr(graph_client, "_create_event_for_advisor", lambda *a, **k: {"status": "not_connected"})
        monkeypatch.setattr(graph_client, "_check_meeting_conflict", lambda *a, **k: False)
        monkeypatch.setattr(graph_client, "_get_app_only_token", lambda *a: "t")
        monkeypatch.setattr(graph_client, "_resolve_advisor_email", lambda db, org, a: f"{a}@m")
        monkeypatch.setattr(graph_client, "calendar_sync_lock", lock)
        monkeypatch.setattr(graph_client, "persist_calendar_sync",
                            lambda db, mid, sync: db.table("meetings").update({"calendar_sync": sync}).eq("id", mid).execute())
        monkeypatch.setattr(sr, "_build_meeting_subject", lambda *a, **k: "s")
        return w
    return make


# --- deleted ---------------------------------------------------------------------------------

def test_one_deletes_the_other_keeps_everything(world):
    w = world()
    del w.cal["ev-x"]
    assert w.run() == "advisor_removed"
    assert w.row["advisor_ids"] == ["y"] and w.row["status"] == "scheduled" and w.time == OLD
    assert list(w.row["calendar_sync"]) == ["y"] and w.writes == [] and w.bells() == {}
    act = w.db.tables["meeting_activity"][0]
    assert (act["action"], act["source"], act["meta"]["calendar_owner_ids"]) == ("advisor_left", "outlook", ["x"])
    assert w.run() == "none"
    del w.cal["ev-y"]  # now the only one
    assert w.run() == "cancelled" and w.row["status"] == "cancelled"


def test_the_only_connected_one_deletes_the_unconnected_stays(world):
    w = world(connected=("x",))
    del w.cal["ev-x"]
    assert w.run() == "advisor_removed" and w.row["advisor_ids"] == ["y"] and w.row["status"] == "scheduled"


def test_all_deleted_is_a_cancellation(world):
    w = world()
    w.cal.clear()
    assert w.run() == "cancelled" and w.row["advisor_ids"] == ["x", "y"]


def test_event_of_someone_no_longer_on_the_meeting_is_ignored(world):
    w = world()
    w.row["advisor_ids"] = ["y"]  # x pressed "remove me"; their event is already gone
    del w.cal["ev-x"]
    assert w.run() == "none" and w.row["status"] == "scheduled"
    w = world(connected=("x",))
    w.row["advisor_ids"] = ["y"]
    del w.cal["ev-x"]
    assert w.run() == "none" and w.row["status"] == "scheduled"


def test_a_former_user_is_not_who_the_meeting_stays_with(world):
    w = world(advisors=("x", "former"), connected=("x",))
    del w.cal["ev-x"]
    assert w.run() == "cancelled"


def test_changed_mailbox_is_never_a_deletion(world, monkeypatch):
    w = world()
    monkeypatch.setattr(graph_client, "_resolve_advisor_email", lambda db, org, a: "new@m")
    w.cal.clear()
    assert w.run() == "skipped" and w.row["status"] == "scheduled" and w.row["advisor_ids"] == ["x", "y"]


def test_failed_checks_change_nothing(world):
    w = world()
    w.cal["ev-x"] = w.cal["ev-y"] = graph_client.EVENT_CHECK_SKIPPED
    assert w.run() == "skipped" and w.row["advisor_ids"] == ["x", "y"]


# --- moved -----------------------------------------------------------------------------------

@pytest.mark.parametrize("mover, other", [("x", "y"), ("y", "x")])
@pytest.mark.parametrize("baseline", [OLD, None])
def test_a_move_reaches_everyone(world, mover, other, baseline):
    w = world(baseline=baseline)
    w.cal[f"ev-{mover}"] = ev(NEW)
    assert w.run() == "updated"
    assert w.time == NEW and w.shows(other) == NEW and w.writes == [other]
    bell = w.bells()
    assert list(bell) == [other] and bell[other]["from"] == OLD and bell[other]["to"] == NEW
    assert mover.upper() in bell[other]["title"] and "SCHOOL" in bell[other]["title"]
    assert w.run() == "none" and w.writes == [other]  # no loop


def test_failed_push_is_retried_never_reverted(world):
    w = world(baseline=None)
    w.cal["ev-x"], w.fail_push = ev(NEW), {"y"}
    assert w.run() == "updated" and w.time == NEW and w.shows("y") == OLD
    assert w.run() == "repushed" and w.time == NEW
    w.fail_push = set()
    assert w.run() == "repushed" and w.time == NEW and w.shows("y") == NEW
    assert w.run() == "none" and len(w.bells()) == 1


def test_failed_write_without_a_baseline_is_not_a_move(world):
    w = world(baseline=None)
    w.row.update(meeting_date=NEW[0], start_time=NEW[1], end_time=NEW[2])  # saved in the system; y's write failed
    w.cal["ev-x"] = ev(NEW)
    w.row["calendar_sync"]["y"]["status"] = "error"
    assert w.run() == "repushed" and w.time == NEW and w.shows("y") == NEW


def test_a_move_survives_a_crash_before_the_push(world, monkeypatch):
    w = world(baseline=None)
    w.cal["ev-x"] = ev(NEW)
    real = graph_client.sync_meeting_update
    monkeypatch.setattr(graph_client, "sync_meeting_update", lambda *a, **k: 1 / 0)
    assert w.run() == "skipped" and w.time == NEW and list(w.bells()) == ["y"]
    monkeypatch.setattr(graph_client, "sync_meeting_update", real)
    assert w.run() == "repushed" and w.time == NEW and w.shows("y") == NEW


def test_a_crash_before_the_meeting_is_updated_keeps_the_move(world, monkeypatch):
    w = world()
    w.cal["ev-x"] = ev(NEW)
    real = sr.meeting_activity.fetch_tracked
    monkeypatch.setattr(sr.meeting_activity, "fetch_tracked", lambda *a: 1 / 0)
    assert w.run() == "skipped" and w.time == OLD and w.bells() == {}
    monkeypatch.setattr(sr.meeting_activity, "fetch_tracked", real)
    assert w.run() == "updated" and w.time == NEW and w.shows("y") == NEW


def test_both_moved_the_later_change_wins(world):
    w = world()
    w.cal["ev-x"], w.cal["ev-y"] = ev(NEW, "2026-11-22T10:00:00Z"), ev(OTHER, "2026-11-22T10:05:00Z")
    assert w.run() == "updated" and w.time == OTHER and w.shows("x") == OTHER


def test_unconnected_advisor_is_notified(world):
    w = world(connected=("x",))
    w.cal["ev-x"] = ev(NEW)
    assert w.run() == "updated" and w.time == NEW and list(w.bells()) == ["y"]


def test_one_deleted_and_the_other_moved(world):
    w = world()
    del w.cal["ev-x"]
    w.cal["ev-y"] = ev(NEW)
    assert w.run() == "updated" and w.row["advisor_ids"] == ["y"] and w.time == NEW
    assert w.writes == [] and w.bells() == {}


def test_single_advisor_move_writes_to_no_calendar(world):
    w = world(advisors=("x",), connected=("x",))
    w.cal["ev-x"] = ev(NEW)
    assert w.run() == "updated" and w.time == NEW and w.writes == [] and w.bells() == {}


def test_meeting_without_hours_stays_without_hours(world):
    w = world(advisors=("x",), connected=("x",), time=["2036-11-23", None, None], baseline=["2036-11-23", "09:00", "10:00"])
    assert w.run() == "none" and w.time == ["2036-11-23", None, None]
    w.cal["ev-x"] = ev(NEW)
    assert w.run() == "updated" and w.time == NEW


def test_meeting_with_only_a_start_gets_the_default_end(world):
    w = world(time=["2036-11-23", "13:00", None], baseline=["2036-11-23", "13:00", "14:00"])
    assert w.run() == "updated" and w.time == ["2036-11-23", "13:00", "14:00"]
    assert w.writes == [] and w.bells() == {} and w.run() == "none"


def test_someone_joining_while_calendars_are_read_is_kept(world, monkeypatch):
    w = world()
    del w.cal["ev-x"]
    real = graph_client.get_event

    def slow(db, org, advisor_id, event_id):
        if advisor_id == "y":
            w.row["advisor_ids"] = ["x", "y", "z"]
        return real(db, org, advisor_id, event_id)

    monkeypatch.setattr(graph_client, "get_event", slow)
    assert w.run() == "advisor_removed" and w.row["advisor_ids"] == ["y", "z"]


def test_stale_poll_listing_after_a_save_is_not_a_move(world):
    w = world()
    stale = {"x": {"ev-x": ev(OLD)}, "y": {"ev-y": ev(OLD)}}
    w.row.update(meeting_date=NEW[0], start_time=NEW[1], end_time=NEW[2])
    for a in ("x", "y"):
        w.cal[f"ev-{a}"] = ev(NEW)
        w.row["calendar_sync"][a]["event_time"] = NEW
    w.run(stale)
    assert w.time == NEW and w.writes == []


# --- the notification ------------------------------------------------------------------------

def _m(t):
    return {"id": "m", "school_id": "s", "status": "scheduled", "meeting_date": t[0], "start_time": t[1], "end_time": t[2],
            "advisor_ids": ["x", "y"]}


def test_moves_in_a_row_share_one_notification_and_moving_back_drops_it(world):
    w = world()
    shared_meetings.notify_moved(w.db, ORG, _m(NEW), _m(OLD), "x")
    shared_meetings.notify_moved(w.db, ORG, _m(OTHER), _m(NEW), "x")
    assert {k: (d["from"], d["to"]) for k, d in w.bells().items()} == {"y": (OLD, OTHER)}
    shared_meetings.notify_moved(w.db, ORG, _m(OLD), _m(OTHER), "x")
    assert w.bells() == {}


def test_who_is_notified(world):
    w = world()
    shared_meetings.notify_moved(w.db, ORG, _m(NEW), _m(OLD), "boss", {"y": {"conflict": True}})
    assert sorted(w.bells()) == ["x", "y"] and "BOSS" in w.bells()["x"]["title"]
    assert len(w.bells()["y"]["text"].splitlines()) == 3 and len(w.bells()["x"]["text"].splitlines()) == 2
    for before, after in ((_m(OLD), _m(OLD)), (_m([OLD[0], None, None]), _m(NEW)), (_m(OLD), {**_m(NEW), "status": "cancelled"}),
                          (_m(OLD), {**_m(NEW), "advisor_ids": ["x"]}),
                          (_m(["2026-01-01", "10:00", "11:00"]), _m(["2026-01-02", "10:00", "11:00"])),
                          (_m(OLD), {**_m(NEW), "created_by": "boss", "created_at": datetime.now(timezone.utc).isoformat()})):
        w = world()
        shared_meetings.notify_moved(w.db, ORG, after, before, "boss")
        assert w.bells() == {}
