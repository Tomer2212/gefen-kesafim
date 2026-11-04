"""Regression tests for near-real-time meeting auto-completion: the start-time gate, the
user-revert block, the process-new-calls attribution (incl. retry on failure), and the PUT
not overwriting status unless it was sent.

Fully offline: the Supabase client is faked.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers import schools_router  # noqa: E402

IL = ZoneInfo("Asia/Jerusalem")
ORG = "org-1"
SCHOOL = "school-1"
MID = "meeting-1"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return _Result(self.rows)


class _DB:
    def __init__(self, meeting=None, org_enabled=True):
        self.meeting = meeting
        self.org_enabled = org_enabled

    def table(self, name):
        if name == "organizations":
            return _Query([{"auto_complete_meetings_from_activity_enabled": self.org_enabled}])
        return _Query([self.meeting] if self.meeting else [])


def _meeting(start_offset_min=-10, seconds=600, **over):
    start = datetime.now(IL) + timedelta(minutes=start_offset_min)
    return {
        "id": MID, "school_id": SCHOOL, "status": "scheduled",
        "meeting_date": start.date().isoformat(), "start_time": start.strftime("%H:%M"),
        "calls_duration_seconds": seconds, "offline_work_entries": [],
        "auto_complete_blocked": False, **over,
    }


@pytest.fixture
def patches(monkeypatch):
    applied = []
    monkeypatch.setattr(schools_router, "_apply_meeting_patch", lambda *a, **k: applied.append((a, k)))
    return applied


def test_closes_once_start_time_passed_and_threshold_reached(patches):
    schools_router._maybe_auto_complete_meeting(_DB(_meeting()), ORG, MID)
    assert len(patches) == 1
    assert patches[0][0][4] == {"status": "completed"}
    assert patches[0][1]["source"] == "auto_complete"


def test_does_not_close_before_start_time(patches):
    # 5 minutes rather than a larger offset, so the meeting stays on today's date.
    now = datetime.now(IL)
    if (now + timedelta(minutes=5)).date() != now.date():
        pytest.skip("too close to midnight")
    schools_router._maybe_auto_complete_meeting(_DB(_meeting(start_offset_min=5)), ORG, MID)
    assert patches == []


@pytest.mark.parametrize("meeting, org_enabled", [
    (_meeting(seconds=299), True),
    (_meeting(auto_complete_blocked=True), True),
    (_meeting(status="cancelled"), True),
    (_meeting(status="postponed"), True),
    (_meeting(), False),
])
def test_does_not_close(patches, meeting, org_enabled):
    schools_router._maybe_auto_complete_meeting(_DB(meeting, org_enabled), ORG, MID)
    assert patches == []


def test_offline_work_counts_toward_threshold(patches):
    m = _meeting(seconds=0, offline_work_entries=[{"start_time": "10:00", "end_time": "10:05"}])
    schools_router._maybe_auto_complete_meeting(_DB(m), ORG, MID)
    assert len(patches) == 1


@pytest.mark.parametrize("current, data, expected", [
    ({"status": "completed", "meeting_date": "2026-11-04"}, {"status": "scheduled"}, {"status": "scheduled", "auto_complete_blocked": True}),
    ({"status": "scheduled", "meeting_date": "2026-11-04"}, {"status": "scheduled"}, {"status": "scheduled"}),
    ({"status": "scheduled", "meeting_date": "2026-11-04"}, {"status": "completed"}, {"status": "completed"}),
    # A PUT without status must never count as a revert.
    ({"status": "completed", "meeting_date": "2026-11-04"}, {"meeting_date": "2026-11-04"}, {"meeting_date": "2026-11-04"}),
    ({"status": "scheduled", "meeting_date": "2026-11-04"}, {"meeting_date": "2026-11-05"}, {"meeting_date": "2026-11-05", "auto_complete_blocked": False}),
    ({"status": "completed", "meeting_date": "2026-11-04"}, {"status": "scheduled", "meeting_date": "2026-11-05"},
     {"status": "scheduled", "meeting_date": "2026-11-05", "auto_complete_blocked": False}),
])
def test_block_rule_for_deliberate_changes(current, data, expected):
    schools_router._apply_auto_complete_block(_DB(current), SCHOOL, MID, data)
    assert data == expected


def test_unmarked_revert_from_an_old_tab_is_dropped_without_blocking():
    data = {"status": "scheduled", "end_time": "12:25"}
    schools_router._apply_auto_complete_block(_DB({"status": "completed", "meeting_date": "2026-11-04"}), SCHOOL, MID, data, status_is_deliberate=False)
    assert data == {"end_time": "12:25"}


def test_unmarked_other_status_changes_still_apply():
    data = {"status": "cancelled"}
    schools_router._apply_auto_complete_block(_DB({"status": "scheduled", "meeting_date": "2026-11-04"}), SCHOOL, MID, data, status_is_deliberate=False)
    assert data == {"status": "cancelled"}


class _UpdateCapturingDB(_DB):
    """Records the payload of the PUT's meetings update."""

    def __init__(self, meeting):
        super().__init__(meeting)
        self.written = None

    def table(self, name):
        query = super().table(name)
        if name == "meetings":
            def update(data):
                self.written = data
                return query
            query.update = update
        return query


def _put(monkeypatch, db, body):
    def no_calendar(*_a, **_k):
        raise RuntimeError("calendar sync is out of scope here (non-fatal in the endpoint)")

    monkeypatch.setattr(schools_router, "get_admin_client", lambda: db)
    monkeypatch.setattr(schools_router, "_enforce_advisor_ids_for_role", lambda _db, _user, ids, _ctx: ids)
    monkeypatch.setattr(schools_router.meeting_activity, "fetch_tracked", lambda *a, **k: None)
    monkeypatch.setattr(schools_router.meeting_activity, "log_meeting_activity", lambda *a, **k: None)
    monkeypatch.setattr(schools_router.graph_client, "calendar_sync_lock", no_calendar)
    user = {"id": "u1", "role": "owner", "org_id": ORG}
    schools_router.update_meeting(SCHOOL, MID, body, user)
    return db.written


def test_put_without_status_leaves_status_and_block_untouched(monkeypatch):
    # The row hasn't seen the auto-completion yet: its autosave must not reopen the meeting.
    db = _UpdateCapturingDB({"status": "completed", "meeting_date": "2026-11-04"})
    written = _put(monkeypatch, db, schools_router.MeetingIn(end_time="12:25", reminder_enabled=True))
    assert "status" not in written
    assert "auto_complete_blocked" not in written
    assert written["end_time"] == "12:25"


def test_put_with_explicit_revert_writes_status_and_blocks(monkeypatch):
    db = _UpdateCapturingDB({"status": "completed", "meeting_date": "2026-11-04"})
    written = _put(monkeypatch, db, schools_router.MeetingIn(status="scheduled", status_changed=True, reminder_enabled=True))
    assert written["status"] == "scheduled"
    assert written["auto_complete_blocked"] is True


def test_put_from_old_tab_cannot_reopen_a_completed_meeting(monkeypatch):
    # Pre-deploy tabs send the row's stale status on every save, with no status_changed.
    db = _UpdateCapturingDB({"status": "completed", "meeting_date": "2026-11-04"})
    written = _put(monkeypatch, db, schools_router.MeetingIn(status="scheduled", end_time="12:25", reminder_enabled=True))
    assert "status" not in written
    assert "auto_complete_blocked" not in written
    assert written["end_time"] == "12:25"


def _call(call_id, school_id="s1", **over):
    return {"call_id": call_id, "school_id": school_id, "start_time": "2026-11-04T08:13:00Z", **over}


@pytest.fixture
def attribution(monkeypatch):
    """Records recompute/auto-complete calls; a school id in `failing` raises on recompute."""
    state = {"recomputed": [], "completed": [], "failing": set()}

    def recompute(_db, _org, school_id, date_str, group):
        if school_id in state["failing"]:
            raise RuntimeError("boom")
        state["recomputed"].append((school_id, date_str, [c["call_id"] for c in group]))
        return [f"m-{school_id}"]

    monkeypatch.setattr(schools_router, "_recompute_meeting_call_activity", recompute)
    monkeypatch.setattr(schools_router, "_maybe_auto_complete_meeting", lambda _db, _org, mid: state["completed"].append(mid))
    monkeypatch.setattr(schools_router, "get_admin_client", lambda: _DB())
    return state


def test_attribution_groups_by_school_and_israel_date(attribution):
    # 22:30Z on Nov 3 is already Nov 4 in Israel.
    calls = [_call("a"), _call("b"), _call("c", school_id="s2", start_time="2026-11-03T22:30:00Z")]
    assert schools_router._attribute_new_calls_to_meetings(_DB(), ORG, calls) == set()
    assert sorted(attribution["recomputed"]) == [("s1", "2026-11-04", ["a", "b"]), ("s2", "2026-11-04", ["c"])]
    assert sorted(attribution["completed"]) == ["m-s1", "m-s2"]


def test_attribution_honours_manual_links_and_exclusions(attribution):
    calls = [_call("a", linked_school_ids=["s2"], excluded_school_ids=["s1"])]
    schools_router._attribute_new_calls_to_meetings(_DB(), ORG, calls)
    assert [r[0] for r in attribution["recomputed"]] == ["s2"]


def test_attribution_skips_calls_without_a_school(attribution):
    schools_router._attribute_new_calls_to_meetings(_DB(), ORG, [_call("a", school_id=None)])
    assert attribution["recomputed"] == []


def test_failed_attribution_is_returned_for_retry(attribution):
    attribution["failing"].add("s1")
    calls = [_call("a"), _call("b", school_id="s2")]
    assert schools_router._attribute_new_calls_to_meetings(_DB(), ORG, calls) == {"a"}
    assert attribution["completed"] == ["m-s2"]


def test_sweep_only_checks_meetings_over_the_threshold(monkeypatch):
    rows = [
        {"id": "over", "calls_duration_seconds": 300, "offline_work_entries": []},
        {"id": "under", "calls_duration_seconds": 299, "offline_work_entries": []},
    ]
    checked = []
    class DB:
        def __init__(self, enabled):
            self.enabled = enabled

        def table(self, name):
            if name == "organizations":
                return _Query([{"auto_complete_meetings_from_activity_enabled": self.enabled}])
            return _Query(rows)

    monkeypatch.setattr(schools_router, "_maybe_auto_complete_meeting", lambda _db, _org, mid: checked.append(mid))
    monkeypatch.setattr(schools_router, "get_admin_client", lambda: DB(True))
    schools_router._sweep_auto_complete_meetings(None, ORG)
    assert checked == ["over"]

    checked.clear()
    monkeypatch.setattr(schools_router, "get_admin_client", lambda: DB(False))
    schools_router._sweep_auto_complete_meetings(None, ORG)
    assert checked == []
