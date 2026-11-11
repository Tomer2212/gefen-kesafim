"""Booking requests and the meetings that fill them: "מחליפה או נוספת?", reopening after a
cancellation, the "אוטומטי" window of יומן יעיל, and the task progress override. Offline:
tests/fake_supabase.py stands in for Supabase."""
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import booking_lock  # noqa: E402
import booking_requests  # noqa: E402
import slot_policy  # noqa: E402
import task_logic  # noqa: E402
from routers import meeting_booking_router as mbr  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402

ORG = "org"
FUTURE = "2099-01-01T00:00:00+00:00"
RANGE = {"key": "r1", "service_type": "gefen", "label": "פגישת גפן", "duration_minutes": 60,
         "start_date": "2099-12-01", "end_date": "2099-12-31",
         "segments": [{"start_date": "2099-12-01", "end_date": "2099-12-31"}]}


def token(tid="t1", task_id="task1", school="s1", booked=None, ranges=None):
    return {"id": tid, "org_id": ORG, "school_id": school, "task_id": task_id, "expires_at": FUTURE,
            "date_ranges": ranges or [dict(RANGE)], "booked_ranges": booked or [], "advisor_ids": ["a"]}


def meeting(mid, school="s1", day="2099-12-10", status="scheduled", service="gefen", **extra):
    return {"id": mid, "school_id": school, "meeting_date": day, "status": status,
            "meeting_service_type": service, "stage_scope": None, "booking_token_id": None, **extra}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb({
        "org_tasks": [{"id": "task1", "name": "פגישות דצמבר", "status": "active"},
                      {"id": "old", "name": "ישנה", "status": "archived"}],
        "meeting_booking_tokens": [token()],
        "meetings": [],
        "meeting_request_resolutions": [],
    })
    monkeypatch.setattr(booking_requests, "get_admin_client", lambda: fake)
    monkeypatch.setattr(booking_lock, "get_admin_client", lambda: fake)
    monkeypatch.setattr(booking_requests.meeting_activity, "log_meeting_activity",
                        lambda _db, **kw: fake.tables.setdefault("meeting_activity", []).append(kw))
    return fake


# --- which requests a staff meeting is asked about ---

def test_open_request_in_range_is_offered(db):
    reqs = booking_requests.open_requests_for_meeting(db, ORG, meeting("m1"))
    assert [(r["token_id"], r["range_key"], r["task_name"]) for r in reqs] == [("t1", "r1", "פגישות דצמבר")]


@pytest.mark.parametrize("change", [
    {"meeting": {"meeting_date": "2099-11-30"}},          # outside the request's dates
    {"meeting": {"booking_token_id": "t1"}},               # booked through a link itself
    {"meeting": {"status": "cancelled"}},
    {"token": {"booked_ranges": ["r1"]}},                  # already booked
    {"token": {"task_id": "old"}},                         # task no longer active
    {"token": {"expires_at": "2000-01-01T00:00:00+00:00"}},
])
def test_requests_not_asked_about(db, change):
    db.tables["meeting_booking_tokens"][0].update(change.get("token", {}))
    assert booking_requests.open_requests_for_meeting(db, ORG, meeting("m1", **change.get("meeting", {}))) == []


def test_any_meeting_type_is_asked_about(db):
    assert booking_requests.open_requests_for_meeting(db, ORG, meeting("m1", service="gefen_current"))


def test_request_already_filled_by_another_meeting_is_not_asked(db):
    db.tables["meetings"].append(meeting("other"))
    assert booking_requests.open_requests_for_meeting(db, ORG, meeting("m1")) == []


def test_direct_coordination_requests_count(db):
    db.tables["meeting_booking_tokens"][0]["task_id"] = None
    assert booking_requests.open_requests_for_meeting(db, ORG, meeting("m1"))[0]["task_name"] is None


# --- recording the answer ---

def test_replaces_closes_the_request_and_is_logged(db):
    m = meeting("m1")
    db.tables["meetings"].append(m)
    booking_requests.record_resolution(db, org_id=ORG, user_id="u", meeting=m, token=db.tables["meeting_booking_tokens"][0],
                                       range_row=RANGE, decision="replaces", source="school_card")
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == ["r1"]
    assert db.tables["meeting_activity"][-1]["action"] == "request_resolved"
    assert db.tables["meeting_activity"][-1]["meta"]["decision"] == "replaces"
    assert booking_requests.open_requests_for_meeting(db, ORG, m) == []  # answered, not asked again


def test_additional_keeps_the_request_open(db):
    m = meeting("m1")
    db.tables["meetings"].append(m)
    booking_requests.record_resolution(db, org_id=ORG, user_id="u", meeting=m, token=db.tables["meeting_booking_tokens"][0],
                                       range_row=RANGE, decision="additional", source="personal")
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == []
    # ...and the meeting no longer fills it for the automatic rule
    rows = [{"token_id": "t1", "school_id": "s1", "range_key": "r1", "range_row": RANGE}]
    assert booking_requests.requests_already_filled(db, rows) == set()


def test_changing_the_answer_back_reopens(db):
    m = meeting("m1")
    db.tables["meetings"].append(m)
    tok = db.tables["meeting_booking_tokens"][0]
    booking_requests.record_resolution(db, org_id=ORG, user_id="u", meeting=m, token=tok, range_row=RANGE, decision="replaces", source=None)
    booking_requests.record_resolution(db, org_id=ORG, user_id="u", meeting=m, token=tok, range_row=RANGE, decision="additional", source=None)
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == []
    assert len(db.tables["meeting_request_resolutions"]) == 1


# --- reopening after a cancellation (the 5-minute cron) ---

def test_cancelled_link_meeting_reopens_and_back_closes(db):
    db.tables["meeting_booking_tokens"][0]["booked_ranges"] = ["r1"]
    db.tables["meetings"].append(meeting("m1", booking_token_id="t1", booking_range_key="r1", status="cancelled"))
    assert booking_requests.reconcile_booked_ranges(db, ORG) == 1
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == []
    assert db.tables["meeting_activity"][-1]["action"] == "request_reopened"
    db.tables["meetings"][0]["status"] = "scheduled"
    booking_requests.reconcile_booked_ranges(db, ORG)
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == ["r1"]


def test_cancelled_replacing_meeting_reopens(db):
    db.tables["meeting_booking_tokens"][0]["booked_ranges"] = ["r1"]
    db.tables["meetings"].append(meeting("m1", status="postponed"))
    db.tables["meeting_request_resolutions"].append({"meeting_id": "m1", "token_id": "t1", "range_key": "r1", "decision": "replaces"})
    booking_requests.reconcile_booked_ranges(db, ORG)
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == []


def test_request_whose_dates_are_over_stays_closed(db):
    over = {**RANGE, "end_date": "2000-01-31", "segments": [{"start_date": "2000-01-01", "end_date": "2000-01-31"}]}
    db.tables["meeting_booking_tokens"][0].update(date_ranges=[over], booked_ranges=["r1"])
    db.tables["meetings"].append(meeting("m1", day="2000-01-10", booking_token_id="t1", booking_range_key="r1", status="cancelled"))
    assert booking_requests.reconcile_booked_ranges(db, ORG) == 0


def test_booked_request_with_unknown_meeting_is_left_alone(db):
    # Links from before bookings recorded their link: no known meeting — never reopened by guess.
    db.tables["meeting_booking_tokens"][0]["booked_ranges"] = ["r1"]
    assert booking_requests.reconcile_booked_ranges(db, ORG) == 0
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == ["r1"]


def test_deleted_meeting_reopens_its_request(db):
    db.tables["meeting_booking_tokens"][0]["booked_ranges"] = ["r1"]
    db.tables["meetings"].append(meeting("m1", booking_token_id="t1", booking_range_key="r1"))
    filled = booking_requests.requests_filled_by_meeting(db, "m1")
    db.tables["meetings"] = []
    booking_requests.reopen_for_deleted_meeting(db, ORG, filled)
    assert db.tables["meeting_booking_tokens"][0]["booked_ranges"] == []


# --- "אוטומטי" window ---

def test_auto_window_follows_the_longest_waiting_request():
    pending = [
        {"advisor_ids": ["a"], "start_date": "2099-12-01", "end_date": "2099-12-31", "duration_minutes": 180},
        {"advisor_ids": ["a"], "start_date": "2099-12-01", "end_date": "2099-12-31", "duration_minutes": 60},
        {"advisor_ids": ["b"], "start_date": "2099-12-01", "end_date": "2099-12-31", "duration_minutes": 120},
        {"advisor_ids": ["a"], "start_date": "2100-01-01", "end_date": "2100-01-31", "duration_minutes": 300},
    ]
    assert slot_policy.auto_window_by_advisor(pending, "2099-12-10", ["a", "b", "c"], 60) == {"a": 180, "b": 120, "c": 60}


def test_window_per_advisor_changes_the_offer():
    h = slot_policy.parse_hhmm
    busy = {"a": [], "b": []}
    # Empty day, 1h meeting: with 3h protected on a, 10:00 (which would leave 8–10) is not offered.
    starts = [s for s, _ in slot_policy.allowed_slots(busy, 480, 960, 60, {"a": 180, "b": 60}, 60)]
    assert h("10:00") not in starts and h("08:00") in starts
    assert h("10:00") in [s for s, _ in slot_policy.allowed_slots(busy, 480, 960, 60, {"a": 120, "b": 60}, 60)]


def test_pending_demand_excludes_own_and_filled_requests(db, monkeypatch):
    monkeypatch.setattr(mbr, "get_admin_client", lambda: db)
    other = {**RANGE, "key": "r2", "duration_minutes": 180}
    db.rpc_results["pending_booking_demand"] = [
        {"token_id": "t1", "school_id": "s1", "range_key": "r1", "range_row": RANGE, "advisor_ids": ["a"]},
        {"token_id": "t2", "school_id": "s2", "range_key": "r2", "range_row": other, "advisor_ids": ["a"]},
        {"token_id": "t3", "school_id": "s3", "range_key": "r1", "range_row": RANGE, "advisor_ids": ["a"]},
    ]
    db.tables["meetings"].append(meeting("filled", school="s3"))  # s3 already has its gefen meeting
    pending = mbr._pending_demand(db, token(), RANGE, ["a"], "2099-12-01", "2099-12-31")
    assert [p["duration_minutes"] for p in pending] == [180]


# --- booking page: an "additional" meeting doesn't block the link ---

def test_additional_meeting_does_not_block_the_link(db):
    db.tables["meetings"].append(meeting("m1"))
    tok = db.tables["meeting_booking_tokens"][0]
    assert mbr._range_existing_meeting(db, tok, RANGE)
    db.tables["meeting_request_resolutions"].append({"meeting_id": "m1", "token_id": "t1", "range_key": "r1", "decision": "additional"})
    assert mbr._range_existing_meeting(db, tok, RANGE) is None


# --- task progress ---

COND = {"type": "meeting", "meeting_service_type": "gefen",
        "date_segments": [{"date_from": "2099-12-01", "date_to": "2099-12-31"}]}


def test_replacing_meeting_of_another_type_counts_for_the_task():
    m = {**meeting("m1", service="gefen_current"), "request_resolutions": [
        {"token_id": "t1", "service_type": "gefen", "stage_scope": "chativa", "decision": "replaces"}]}
    matches = task_logic._matching_meetings(COND, [m], {"t1"})
    assert len(matches) == 1 and matches[0]["stage_scope"] == "chativa"
    # Even when the task asks for an additional meeting:
    assert task_logic._matching_meetings({**COND, "require_additional_meeting": True}, [m], {"t1"})


def test_additional_meeting_never_counts_for_the_task():
    m = {**meeting("m1"), "request_resolutions": [{"token_id": "t1", "service_type": "gefen", "decision": "additional"}]}
    assert task_logic._matching_meetings(COND, [m], {"t1"}) == []
    # Another task's answer doesn't matter here, and no answer keeps today's rule.
    assert len(task_logic._matching_meetings(COND, [m], {"t9"})) == 1
    assert len(task_logic._matching_meetings(COND, [meeting("m2")], {"t1"})) == 1


def test_results_cell_follows_the_answers():
    replaced = {**meeting("m1", service="gefen_current"), "request_resolutions": [
        {"token_id": "t1", "service_type": "gefen", "decision": "replaces"}]}
    extra = {**meeting("m2"), "request_resolutions": [{"token_id": "t1", "service_type": "gefen", "decision": "additional"}]}
    assert task_logic._meeting_exists_for_school(COND, [replaced], None, {"t1"}) is True
    assert task_logic._meeting_exists_for_school(COND, [extra], None, {"t1"}) is False
    assert task_logic._meeting_exists_for_school(COND, [extra], None, None) is True  # no task context: as before
