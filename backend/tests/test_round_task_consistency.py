"""The round dashboard and its tasks must agree (December 2026, schools 513036 / 510214): a remote
task of the round treated the school's physical שוטף meeting as missing (asked for it again — the
pre-send check then skipped that email), and the dashboard picked the skipped message of the same
instant as the school's "request", so it showed "no request sent". Fully offline."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_rounds  # noqa: E402
import task_logic  # noqa: E402
from routers import tasks_router  # noqa: E402

SCHOOL = {"id": "s1", "name": "טבנקין", "stage": "yesodi", "advisor_gefen": ["yuval"], "advisor_current": ["gal"],
          "advisor_district": [], "advisor_gefen_current_same": False}
PHYSICAL_CURRENT = {"id": "m1", "school_id": "s1", "meeting_date": "2026-12-14", "meeting_service_type": "current",
                    "meeting_type": "physical", "status": "scheduled", "stage_scope": None, "booking_token_id": None}


def remote_task_condition(stamped=True):
    c = {"type": "meeting", "meeting_service_type": "by_service", "gefen_current_split": "separate",
         "meeting_type": "remote", "stage_scope": None, "participant_roles": ["meeting_coordinator"],
         "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}]}
    if stamped:
        tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [c]}]}, "org", {})
    return c


def test_new_tasks_are_stamped():
    assert remote_task_condition()["count_any_meeting_type"] is True


def test_a_meeting_held_the_other_way_counts_in_a_stamped_task():
    c = {**remote_task_condition(), "meeting_service_type": "current"}
    assert task_logic._matching_meetings(c, [PHYSICAL_CURRENT], set()) == [PHYSICAL_CURRENT]
    # An older task (not stamped) keeps its results.
    old = {**remote_task_condition(stamped=False), "meeting_service_type": "current"}
    assert task_logic._matching_meetings(old, [PHYSICAL_CURRENT], set()) == []


def test_send_asks_only_the_missing_part_like_the_round():
    year = {"service_type": "gefen_current"}
    conds = tasks_router._school_meeting_conditions([remote_task_condition()], {"gefen": ["yuval"], "current": ["gal"]},
                                                    "gefen_current", "s1")
    missing = tasks_router._still_missing_conditions(conds, SCHOOL, [PHYSICAL_CURRENT], set())
    assert [c["meeting_service_type"] for c in missing] == ["gefen"]
    # The task's own result: one of the two meetings held — as the round sees it.
    res = task_logic._meeting_condition_result(remote_task_condition(), SCHOOL, [PHYSICAL_CURRENT], year, set())
    assert (res["actual_count"], res["required_count"]) == (1, 2)
    row = meeting_rounds.school_status(meeting_rounds.round_condition({
        "start_date": "2026-12-01", "end_date": "2026-12-31",
        "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "separate"},
    }), SCHOOL, [PHYSICAL_CURRENT], year, set(), None, None, None, "2026-12-01T00:00:00+00:00")
    assert (row["booked_count"], row["required_count"]) == (1, 2)


def msg(status, created_at="2026-11-23 12:15:27.5412+00", token="t"):
    return {"task_id": "task", "school_id": "s1", "status": status, "created_at": created_at, "booking_token_id": token}


def test_the_sent_message_of_the_same_instant_is_the_request():
    sent, skipped = msg("sent", token="gefen-link"), msg("skipped", token="current-link")
    assert meeting_rounds.school_request_message([skipped, sent]) is sent
    assert meeting_rounds.school_request_message([sent, skipped]) is sent


def test_a_newer_skipped_message_never_hides_the_request():
    older_sent = msg("sent", "2026-11-12 09:00:00+00")
    assert meeting_rounds.school_request_message([msg("skipped", "2026-11-23 12:00:00+00"), older_sent]) is older_sent
    # The newest real message still wins over an older one.
    newer = msg("pending", "2026-11-23 12:00:00+00")
    assert meeting_rounds.school_request_message([older_sent, newer]) is newer
    # Only skipped messages: the newest of them, as before.
    only = [msg("skipped", "2026-11-12 09:00:00+00"), msg("skipped", "2026-11-23 12:00:00+00")]
    assert meeting_rounds.school_request_message(only) is only[1]


def test_live_request_hides_the_dashboard_warning():
    sent = msg("sent")
    row = meeting_rounds.school_status(meeting_rounds.round_condition({
        "start_date": "2026-12-01", "end_date": "2026-12-31",
        "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "separate"},
    }), SCHOOL, [PHYSICAL_CURRENT], {"service_type": "gefen_current"}, set(),
        meeting_rounds.school_request_message([msg("skipped"), sent]), {"expires_at": "2027-01-03"}, None,
        "2026-11-23T13:00:00+00:00")
    assert (row["status"], row["needs_request"]) == ("partial", False)
