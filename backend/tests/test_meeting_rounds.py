""""סבבי פגישות" — each school's status in a round (meeting_rounds.py). Fully offline."""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_rounds  # noqa: E402

NOW = "2026-12-05T10:00:00+00:00"
SCHOOL = {"id": "s1", "name": "א", "stage": "yesodi", "advisor_gefen": ["g"], "advisor_current": ["c"],
          "advisor_district": [], "advisor_gefen_current_same": False}
ROUND = {"id": "r1", "org_id": "o", "academic_year": "תשפ\"ז", "start_date": "2026-12-01", "end_date": "2026-12-31",
         "requirement": {"meeting_service_type": "gefen", "count_per_school": 1}}


def meeting(service_type="gefen", day="2026-12-10", status="scheduled", mid="m1", token=None):
    return {"id": mid, "school_id": "s1", "meeting_date": day, "meeting_service_type": service_type,
            "status": status, "stage_scope": None, "meeting_type": "remote", "booking_token_id": token}


def status(meetings=(), msg=None, token=None, note=None, rnd=ROUND, year_row=None):
    cond = meeting_rounds.round_condition(rnd)
    return meeting_rounds.school_status(cond, SCHOOL, list(meetings), year_row, set(), msg, token, note, NOW)


def test_untouched_school():
    row = status()
    assert row["status"] == "untouched" and (row["required_count"], row["booked_count"]) == (1, 0)
    assert row["advisor_ids"] == ["g"]


def test_meeting_booked_any_way_counts():
    assert status([meeting()])["status"] == "booked"  # e.g. by phone, no request at all
    assert status([meeting(status="completed")])["status"] == "done"


def test_meeting_outside_the_round_doesnt_count():
    assert status([meeting(day="2027-01-05")])["status"] == "untouched"


def test_request_states():
    sent = {"task_id": "t", "status": "sent", "sent_at": "2026-12-01T09:00:00+00:00", "booking_token_id": "k"}
    assert status(msg=sent, token={"first_viewed_at": None, "expires_at": "2027-01-01"})["status"] == "requested"
    opened = status(msg=sent, token={"first_viewed_at": "2026-12-02", "expires_at": "2027-01-01"})
    assert opened["status"] == "opened" and opened["request"]["open"] is True
    expired = status(msg=sent, token={"first_viewed_at": None, "expires_at": "2026-12-04"})
    assert expired["request"]["open"] is False
    assert status(msg={**sent, "status": "failed"})["status"] == "problem"
    assert status(note={"skip_reason": "missing_contact"})["status"] == "problem"


def test_by_service_separate_is_partial_then_booked():
    rnd = {**ROUND, "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "separate"}}
    year = {"service_type": "gefen_current"}
    row = status([meeting("gefen")], rnd=rnd, year_row=year)
    assert (row["status"], row["required_types"], row["booked_count"], row["required_count"]) == ("partial", ["gefen", "current"], 1, 2)
    assert row["advisor_ids"] == ["g", "c"]
    assert status([meeting("gefen"), meeting("current", mid="m2")], rnd=rnd, year_row=year)["status"] == "booked"


def test_missing_service_type_is_a_problem():
    rnd = {**ROUND, "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "combined"}}
    row = status(rnd=rnd, year_row={})
    assert (row["status"], row["problem"]) == ("problem", "missing_service_type")


def test_count_per_school():
    rnd = {**ROUND, "requirement": {"meeting_service_type": "gefen", "count_per_school": 2}}
    row = status([meeting()], rnd=rnd)
    assert (row["status"], row["booked_count"], row["required_count"]) == ("partial", 1, 2)


def test_round_members_skip_excluded():
    assert meeting_rounds.round_school_ids({"school_ids": ["a", "b", "c"], "excluded_school_ids": ["b"]}) == ["a", "c"]


def test_cache_patch_only_when_changed():
    result = {"totals": {"schools": 3, "required": 3, "booked": 1, "counts": {"untouched": 2}}}
    rnd = {"cached_total_schools": 3, "cached_required": 3, "cached_booked": 1, "cached_untouched": 2}
    assert meeting_rounds.cache_patch(rnd, result) is None
    assert meeting_rounds.cache_patch({**rnd, "cached_booked": 0}, result)["cached_booked"] == 1


@pytest.mark.parametrize("count", [0, 11])
def test_requirement_count_is_bounded(count):
    from routers import rounds_router
    with pytest.raises(rounds_router.HTTPException):
        rounds_router._validate_requirement(rounds_router.RequirementIn(meeting_service_type="gefen", count_per_school=count))


# --- ימי שטח ---

from routers import meeting_booking_router, tasks_router  # noqa: E402
from fake_supabase import FakeDb  # noqa: E402


def test_field_day_segments_are_the_days_all_advisors_share_in_the_window():
    fd = {"a": ["2026-12-08", "2026-12-10", "2026-12-15"], "b": ["2026-12-10", "2026-12-15"]}
    assert tasks_router._field_day_segments([("2026-12-01", "2026-12-12")], ["a", "b"], fd) == [{"start_date": "2026-12-10", "end_date": "2026-12-10"}]
    assert tasks_router._field_day_segments([("2026-12-01", "2026-12-31")], ["a"], fd)[0]["start_date"] == "2026-12-08"
    assert tasks_router._field_day_segments([("2026-12-01", "2026-12-31")], ["c"], fd) == []


def test_physical_range_is_offered_only_on_field_days():
    school = {"id": "s", "name": "א", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com"}
    cond = {"type": "meeting", "meeting_service_type": "gefen", "use_field_days": True, "meeting_type": "physical",
            "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}], "participant_roles": ["principal"]}
    ranges = tasks_router._build_meeting_ranges(school, [cond], {"gefen": ["a"]}, {"meeting_duration_gefen": 60}, None,
                                                {"a": ["2026-12-10", "2026-12-17"]})
    assert ranges[0]["segments"] == [{"start_date": "2026-12-10", "end_date": "2026-12-10"}, {"start_date": "2026-12-17", "end_date": "2026-12-17"}]
    assert ranges[0]["meeting_type"] == "physical"
    assert tasks_router._build_meeting_ranges(school, [cond], {"gefen": ["a"]}, {"meeting_duration_gefen": 60}, None, {}) is None


def test_field_day_blocks_remote_offers_only():
    db = FakeDb()
    db.table("advisor_field_days").insert({"advisor_id": "a", "day": "2026-12-10", "org_id": "o"}).execute()
    remote = meeting_booking_router._local_meeting_busy_by_advisor(db, ["a"], "2026-12-10T00:00:00Z", "2026-12-10T23:59:59Z", True)
    physical = meeting_booking_router._local_meeting_busy_by_advisor(db, ["a"], "2026-12-10T00:00:00Z", "2026-12-10T23:59:59Z", False)
    assert remote["a"] == [{"start": "2026-12-10T00:00:00", "end": "2026-12-10T23:59:00"}]
    assert physical["a"] == []
    assert meeting_booking_router._is_remote({"meeting_type": "physical"}) is False
    assert meeting_booking_router._is_remote({}) is True


# --- a task of the round: any filter, but never a second live request ---

def test_round_task_audience_skips_open_requests_unless_asked(monkeypatch):
    db = FakeDb({"meeting_rounds": [{"id": "r", "org_id": "o", "school_ids": ["a", "b", "c"], "excluded_school_ids": ["c"]}]})
    monkeypatch.setattr(meeting_rounds, "open_request_school_ids", lambda _db, rid: {"b"})
    assert tasks_router._round_member_ids(db, "o", "r", include_open_requests=False) == {"a"}
    assert tasks_router._round_member_ids(db, "o", "r", include_open_requests=True) == {"a", "b"}
    assert tasks_router._round_member_ids(db, "o", None) is None
    with pytest.raises(tasks_router.HTTPException):
        tasks_router._round_member_ids(db, "other-org", "r")


def test_open_request_means_a_live_unanswered_link():
    now = "2026-12-05T10:00:00+00:00"
    sent = {"status": "sent", "booking_token_id": "k"}
    assert meeting_rounds._is_open_request(sent, {"expires_at": "2027-01-01"}, now) is True
    assert meeting_rounds._is_open_request(sent, {"expires_at": "2026-12-01"}, now) is False
    assert meeting_rounds._is_open_request({**sent, "status": "failed"}, None, now) is False
    assert meeting_rounds._is_open_request(None, None, now) is False


# --- advisors removed from field days (don't visit) ---

def test_exempt_advisor_doesnt_narrow_the_field_days():
    fd = {"g": ["2026-12-10", "2026-12-17"]}  # the שוטף advisor "c" has no field days
    window = [("2026-12-01", "2026-12-31")]
    assert tasks_router._field_day_segments(window, ["g", "c"], fd) == []  # both must visit → no day
    assert [s["start_date"] for s in tasks_router._field_day_segments(window, ["g", "c"], fd, {"c"})] == ["2026-12-10", "2026-12-17"]


def test_meeting_whose_advisors_are_all_exempt_keeps_its_dates():
    window = [("2026-12-01", "2026-12-31")]
    assert tasks_router._field_day_segments(window, ["c"], {}, {"c"}) == [{"start_date": "2026-12-01", "end_date": "2026-12-31"}]
    assert tasks_router._field_day_segments(window, [], {}, {"c"}) == []


def test_combined_physical_meeting_uses_the_visiting_advisors_days():
    school = {"id": "s", "name": "א", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com"}
    cond = {"type": "meeting", "meeting_service_type": "gefen_current", "use_field_days": True, "meeting_type": "physical",
            "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}], "participant_roles": ["principal"]}
    ranges = tasks_router._build_meeting_ranges(
        school, [cond], {"gefen": ["g"], "current": ["c"]}, {"meeting_duration_gefen": 60, "meeting_duration_current": 60},
        None, {"g": ["2026-12-10"]}, {"c"},
    )
    assert ranges[0]["advisor_ids"] == ["g", "c"]  # both still attend (and must be free)
    assert ranges[0]["segments"] == [{"start_date": "2026-12-10", "end_date": "2026-12-10"}]


# --- who goes out to each physical school (meeting_rounds.physical_visitors) ---

SCHOOL_GC = {"id": "s", "name": "א", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com"}
GC_ADVISORS = {"gefen": ["g"], "current": ["c"]}
GC_DURATIONS = {"meeting_duration_gefen": 60, "meeting_duration_current": 60}


def physical_cond(service_type, **extra):
    return {"type": "meeting", "meeting_service_type": service_type, "use_field_days": True, "meeting_type": "physical",
            "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}], "participant_roles": ["principal"], **extra}


def test_visitors_choose_whose_field_days_count():
    assert tasks_router._visiting_advisors(["g", "c"], set(), ["g"]) == ["g"]
    assert tasks_router._visiting_advisors(["g", "c"], set(), None) == ["g", "c"]
    assert tasks_router._visiting_advisors(["g", "c"], {"g"}, ["g", "c"]) == ["c"]
    ranges = tasks_router._build_meeting_ranges(SCHOOL_GC, [physical_cond("gefen_current")], GC_ADVISORS, GC_DURATIONS,
                                                None, {"g": ["2026-12-10"], "c": ["2026-12-20"]}, set(), ["c"])
    assert ranges[0]["segments"] == [{"start_date": "2026-12-20", "end_date": "2026-12-20"}]


def test_separate_meeting_of_the_advisor_who_stays_is_remote():
    conds = [physical_cond("gefen"), physical_cond("current")]  # a separate גפן+שוטף pair
    ranges = tasks_router._build_meeting_ranges(SCHOOL_GC, conds, GC_ADVISORS, GC_DURATIONS, None, {"g": ["2026-12-10"]}, set(), ["g"])
    by_type = {r["service_type"]: r for r in ranges}
    assert by_type["gefen"]["meeting_type"] == "physical" and by_type["gefen"]["segments"] == [{"start_date": "2026-12-10", "end_date": "2026-12-10"}]
    assert by_type["current"]["meeting_type"] == "remote"
    assert by_type["current"]["segments"] == [{"start_date": "2026-12-01", "end_date": "2026-12-31"}]
