"""A reminder of a meeting task must only bother a school about what it hasn't booked yet
(2026-11-16, גפני שלו's physical round task): a meeting booked through the task's own link
counts as booked even when the link offered it remotely, a reminder's link leaves out what is
booked, and an older link of the same task can't book the same meeting twice. Fully offline.
"""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import booking_requests  # noqa: E402
import task_logic  # noqa: E402
from routers import meeting_booking_router as mbr  # noqa: E402
from routers import tasks_router  # noqa: E402

PLAIN = {"id": "plain", "name": "רגיל", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com", "principal_phone": "4"}
SIX_YEAR = {
    "id": "six", "name": "שש", "stage": "sheshshnati", "principal_same_person": True,
    "principal_name": "מנהל", "principal_email": "p@example.com", "principal_phone": "1",
}
ADVISORS = {"gefen": ["a"], "current": ["b"], "district": [], "takuma": ["a"]}
DURATIONS = {"meeting_duration_gefen": 60, "meeting_duration_current": 90}
TOKENS = {"tok-1", "tok-2"}


def cond(service_type, meeting_type="physical", **extra):
    return {
        "type": "meeting", "meeting_service_type": service_type, "meeting_type": meeting_type,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "require_additional_meeting": True,
        "explicit_stage_scope_only": True, **extra,
    }


def meeting(service_type, meeting_type, token=None, stage_scope=None, date="2026-12-22"):
    return {"id": f"{service_type}-{token}-{stage_scope}", "school_id": "plain", "meeting_date": date,
            "status": "scheduled", "meeting_service_type": service_type, "meeting_type": meeting_type,
            "booking_token_id": token, "stage_scope": stage_scope}


# --- counting: booked through the task's link = what the link offered ---

def test_remote_meeting_booked_through_task_link_counts_for_physical_condition():
    c = cond("gefen")
    m = meeting("gefen", "remote", token="tok-1")
    assert task_logic._fulfilled_count_for_meeting_condition(c, [m], TOKENS, PLAIN) == 1
    assert task_logic._meeting_exists_for_school(c, [m], PLAIN, TOKENS)


def test_remote_meeting_booked_another_way_still_does_not_count():
    c = {**cond("gefen"), "require_additional_meeting": False}
    m = meeting("gefen", "remote")
    assert task_logic._fulfilled_count_for_meeting_condition(c, [m], TOKENS, PLAIN) == 0
    assert not task_logic._meeting_exists_for_school(c, [m], PLAIN, TOKENS)


# --- the reminder asks only for what's missing ---

def test_reminder_drops_the_booked_part():
    conds = [cond("gefen"), cond("current")]
    left = tasks_router._still_missing_conditions(conds, PLAIN, [meeting("current", "physical", token="tok-1")], TOKENS)
    assert [c["meeting_service_type"] for c in left] == ["gefen"]


def test_reminder_asks_nothing_when_everything_is_booked():
    conds = [cond("gefen"), cond("current")]
    booked = [meeting("gefen", "remote", token="tok-1"), meeting("current", "physical", token="tok-2")]
    assert tasks_router._still_missing_conditions(conds, PLAIN, booked, TOKENS) == []


def test_reminder_does_not_count_a_meeting_from_before_the_task():
    conds = [cond("gefen")]
    left = tasks_router._still_missing_conditions(conds, PLAIN, [meeting("gefen", "physical")], TOKENS)
    assert [c["meeting_service_type"] for c in left] == ["gefen"]


def test_six_year_separate_keeps_only_the_division_not_booked():
    c = cond("gefen", meeting_type="remote", stage_scope="separate")
    booked = [{**meeting("gefen", "remote", token="tok-1", stage_scope="tichon"), "school_id": "six"}]
    left = tasks_router._still_missing_conditions([c], SIX_YEAR, booked, TOKENS)
    assert left[0]["skip_split_scopes"] == ["tichon"]
    ranges = tasks_router._build_meeting_ranges(SIX_YEAR, left, ADVISORS, DURATIONS)
    assert [r["stage_scope"] for r in ranges] == ["chativa"]


# --- an older link of the same task can't book the same meeting twice ---

class _Query:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        return _Query([r for r in self.rows if r.get(key) == value])

    def in_(self, key, values):
        return _Query([r for r in self.rows if r.get(key) in values])

    def gte(self, key, value):
        return _Query([r for r in self.rows if (r.get(key) or "") >= value])

    def lte(self, key, value):
        return _Query([r for r in self.rows if (r.get(key) or "") <= value])

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeDb:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


def _db(meetings, tok2_ranges=None):
    return _FakeDb({
        "meeting_booking_tokens": [{"id": "tok-1", "task_id": "task"},
                                   {"id": "tok-2", "task_id": "task", "date_ranges": tok2_ranges or [RANGE]},
                                   {"id": "other", "task_id": "another-task"}],
        "meetings": meetings,
        "meeting_request_resolutions": [],
    })


RANGE = {"key": "r0", "service_type": "current", "meeting_type": "physical", "require_additional_meeting": True,
         "segments": [{"start_date": "2026-12-01", "end_date": "2026-12-31"}]}
TOKEN = {"id": "tok-2", "task_id": "task", "school_id": "plain", "date_ranges": [RANGE]}


def test_meeting_booked_through_an_earlier_link_of_the_task_blocks_the_range():
    db = _db([meeting("current", "physical", token="tok-1", date="2026-12-13")])
    found = mbr._range_blocking_meeting(db, TOKEN, RANGE)
    assert found and found["meeting_date"] == "2026-12-13"


def test_meeting_from_before_the_task_or_another_task_does_not_block():
    db = _db([meeting("current", "physical"), meeting("current", "physical", token="other")])
    assert mbr._range_blocking_meeting(db, TOKEN, RANGE) is None


def test_link_asking_two_meetings_of_one_type_is_not_blocked_by_one():
    ranges = [RANGE, {**RANGE, "key": "r1"}]
    db = _db([meeting("current", "physical", token="tok-1")], tok2_ranges=ranges)
    assert mbr._range_blocking_meeting(db, {**TOKEN, "date_ranges": ranges}, RANGE) is None


def test_request_filled_through_the_task_is_not_open_demand():
    """"יומן יעיל" auto demand and "מחליפה או נוספת?" use the same rule as the booking page."""
    db = _db([meeting("current", "physical", token="tok-1", date="2026-12-13")])
    row = {"token_id": "tok-2", "school_id": "plain", "range_key": "r0", "range_row": RANGE, "task_id": "task"}
    other_task = {**row, "token_id": "other", "task_id": "another-task"}
    assert booking_requests.requests_already_filled(db, [row, other_task]) == {("tok-2", "r0")}


def test_six_year_both_needs_both_divisions_booked_through_the_task():
    both = {**RANGE, "service_type": "gefen", "stage_scope": "both"}
    token = {**TOKEN, "school_id": "six", "date_ranges": [both]}
    tichon_only = {**meeting("gefen", "remote", token="tok-1", stage_scope="tichon"), "school_id": "six"}
    chativa = {**meeting("gefen", "remote", token="tok-1", stage_scope="chativa", date="2026-12-20"), "school_id": "six"}
    assert mbr._range_blocking_meeting(_db([tichon_only], [both]), token, both) is None
    assert mbr._range_blocking_meeting(_db([tichon_only, chativa], [both]), token, both)


def test_closed_link_is_not_an_open_request():
    from tests.fake_supabase import FakeDb
    future = "2099-01-01T00:00:00+00:00"
    db = FakeDb({"meeting_booking_tokens": [
        {"id": "open", "org_id": "org", "school_id": "s", "expires_at": future, "date_ranges": [RANGE]},
        {"id": "closed", "org_id": "org", "school_id": "s", "expires_at": future, "date_ranges": [RANGE], "closed_message": "x"},
    ]})
    assert [t["id"] for t in booking_requests._live_tokens(db, "org")] == ["open"]


# --- a queued (e.g. scheduled) reminder is dropped at send time once nothing is left to book ---

def test_queued_reminder_is_dropped_once_everything_is_booked():
    gefen = {**RANGE, "key": "r1", "service_type": "gefen", "meeting_type": "remote"}
    tok2 = {"id": "tok-2", "task_id": "task", "school_id": "plain", "date_ranges": [RANGE, gefen], "booked_ranges": []}

    def db_with(meetings):
        db = _db(meetings)
        db.tables["meeting_booking_tokens"] = [t for t in db.tables["meeting_booking_tokens"] if t["id"] != "tok-2"] + [tok2]
        return db

    current_booked = meeting("current", "physical", token="tok-1", date="2026-12-13")
    assert not tasks_router._link_has_nothing_open(db_with([current_booked]), "tok-2")  # גפן still open
    assert tasks_router._link_has_nothing_open(db_with([current_booked, meeting("gefen", "remote", token="tok-1")]), "tok-2")


def test_queued_reminder_of_a_closed_link_is_dropped():
    db = _FakeDb({"meeting_booking_tokens": [{"id": "t", "closed_message": "x", "date_ranges": [RANGE]}]})
    assert tasks_router._link_has_nothing_open(db, "t")


# --- a link closed by the staff shows its message and books nothing ---

def test_closed_link_refuses_booking_but_loads_its_message():
    row = {"id": "t", "token": "x", "expires_at": "2099-01-01T00:00:00+00:00", "closed_message": "נשלח בטעות"}
    db = _FakeDb({"meeting_booking_tokens": [row]})
    with pytest.raises(HTTPException) as exc:
        mbr._get_valid_token(db, "x")
    assert exc.value.status_code == 410 and exc.value.detail == "נשלח בטעות"
    assert mbr._get_valid_token(db, "x", allow_closed=True)["closed_message"] == "נשלח בטעות"
