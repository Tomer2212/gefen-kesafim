"""Meeting tasks: one combined "גפן+שוטף" meeting (gefen_current) — advisors of both types, the
sum of both card lengths, and a manager's choice when the two coordinators differ. Also the
"יועץ גפן ויועץ שוטף זהים" audience field. Fully offline: Supabase is faked.
"""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import task_logic  # noqa: E402
from routers import tasks_router  # noqa: E402

PLAIN = {"id": "plain", "name": "רגיל", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com", "principal_phone": "4"}
SIX_YEAR = {
    "id": "six", "name": "שש", "stage": "sheshshnati", "principal_same_person": True,
    "principal_name": "מנהל", "principal_email": "p@example.com", "principal_phone": "1",
}
DURATIONS = {"meeting_duration_gefen": 60, "meeting_duration_current": 90}
GEFEN_COORD = {"name": "רכזת גפן", "email": "g@example.com", "role_label": "מזכירה"}
CURRENT_COORD = {"name": "רכזת שוטף", "email": "c@example.com", "role_label": "אחראית כספים"}


def cond(service_type="gefen_current", scope=None, **extra):
    return {
        "type": "meeting", "meeting_service_type": service_type, "stage_scope": scope,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "meeting_type": "remote", **extra,
    }


def coordinators(by_slot):
    return lambda school, slot: by_slot.get(slot)


# --- defaults from the school card ---

def test_same_advisor_is_booked_once():
    ranges = tasks_router._build_meeting_ranges(PLAIN, [cond()], {"gefen": ["a"], "current": ["a"]}, DURATIONS)
    assert ranges[0]["advisor_ids"] == ["a"]
    assert ranges[0]["label"] == "פגישת גפן+שוטף"
    assert ranges[0]["service_type"] == "gefen_current"


def test_different_advisors_are_both_in_one_meeting():
    ranges = tasks_router._build_meeting_ranges(PLAIN, [cond()], {"gefen": ["a"], "current": ["b"]}, DURATIONS)
    assert len(ranges) == 1
    assert ranges[0]["advisor_ids"] == ["a", "b"]


def test_length_is_the_sum_of_both_card_lengths():
    ranges = tasks_router._build_meeting_ranges(PLAIN, [cond()], {"gefen": ["a"], "current": ["a"]}, DURATIONS)
    assert ranges[0]["duration_minutes"] == 150


def test_manual_length_and_override_still_win():
    manual = cond(duration_mode="manual", duration_minutes=45)
    assert tasks_router._build_meeting_ranges(PLAIN, [manual], {"gefen": ["a"], "current": ["a"]}, DURATIONS)[0]["duration_minutes"] == 45
    ranges = tasks_router._build_meeting_ranges(
        PLAIN, [cond()], {"gefen": ["a"], "current": ["a"]}, DURATIONS, {"gefen_current": {"duration_minutes": 120}},
    )
    assert ranges[0]["duration_minutes"] == 120


def test_missing_card_length_never_guesses_60():
    assert tasks_router._build_meeting_ranges(
        PLAIN, [cond()], {"gefen": ["a"], "current": ["a"]}, {"meeting_duration_gefen": 60},
    ) is None


def test_other_types_are_unchanged():
    ranges = tasks_router._build_meeting_ranges(
        PLAIN, [cond("gefen"), cond("current"), cond("takuma")],
        {"gefen": ["a"], "current": ["b"], "takuma": ["a"]}, DURATIONS,
    )
    assert [(r["advisor_ids"], r["duration_minutes"]) for r in ranges] == [(["a"], 60), (["b"], 90), (["a"], 60)]
    # A type with no card length keeps the old defensive 60.
    assert tasks_router._build_meeting_ranges(PLAIN, [cond("gefen")], {"gefen": ["a"]}, {})[0]["duration_minutes"] == 60


def test_six_year_separate_is_two_combined_meetings_with_the_full_length():
    ranges = tasks_router._build_meeting_ranges(
        SIX_YEAR, [cond(scope="separate")], {"gefen": ["a"], "current": ["a"]}, DURATIONS,
    )
    assert [(r["stage_scope"], r["duration_minutes"]) for r in ranges] == [("tichon", 150), ("chativa", 150)]


@pytest.mark.parametrize("advisors,durations,adv_missing,dur_missing", [
    ({"gefen": ["a"], "current": ["b"]}, DURATIONS, [], []),
    ({"gefen": ["a"]}, {"meeting_duration_current": 90}, ["current"], ["gefen"]),
    ({}, {}, ["gefen", "current"], ["gefen", "current"]),
])
def test_missing_default_types(advisors, durations, adv_missing, dur_missing):
    assert tasks_router._missing_default_advisor_types(advisors, "gefen_current") == adv_missing
    assert tasks_router._missing_default_duration_types(durations, "gefen_current") == dur_missing


# --- who receives the link ---

def test_same_coordinator_receives_the_link(monkeypatch):
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot",
                        coordinators({"gefen": GEFEN_COORD, "current": {**GEFEN_COORD, "email": "G@example.com "}}))
    r = {"service_type": "gefen_current", "stage_scope": None}
    assert tasks_router._resolve_range_coordinator(PLAIN, r) == GEFEN_COORD


def test_only_one_coordinator_set_receives_the_link(monkeypatch):
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot", coordinators({"current": CURRENT_COORD}))
    assert tasks_router._resolve_range_coordinator(PLAIN, {"service_type": "gefen_current"}) == CURRENT_COORD


def test_different_coordinators_need_the_managers_choice(monkeypatch):
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot",
                        coordinators({"gefen": GEFEN_COORD, "current": CURRENT_COORD}))
    r = {"service_type": "gefen_current"}
    assert tasks_router._resolve_range_coordinator(PLAIN, r) is None
    assert tasks_router._group_ranges_by_coordinator(PLAIN, [r]) is None
    assert tasks_router._resolve_range_coordinator(PLAIN, {**r, "coordinator_type": "gefen"}) == GEFEN_COORD
    assert tasks_router._resolve_range_coordinator(PLAIN, {**r, "coordinator_type": "current"}) == CURRENT_COORD


def test_choice_travels_from_the_override_to_the_range():
    ranges = tasks_router._build_meeting_ranges(
        PLAIN, [cond(), cond("gefen")], {"gefen": ["a"], "current": ["a"]}, DURATIONS,
        {"gefen_current": {"coordinator_type": "current"}, "gefen": {"coordinator_type": "current"}},
    )
    assert ranges[0]["coordinator_type"] == "current"
    assert "coordinator_type" not in ranges[1]


def test_missing_coordinator_check_accepts_either_division(monkeypatch):
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot", coordinators({"gefen": GEFEN_COORD}))
    monkeypatch.setattr(tasks_router, "_missing_contact_detail", lambda school: {})
    req = tasks_router.MeetingRequirementIn(meeting_service_type="gefen_current", participant_roles=["principal"])
    assert tasks_router._coordinator_problem(PLAIN, "email_resend", [req]) is None
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot", coordinators({}))
    assert tasks_router._coordinator_problem(PLAIN, "email_resend", [req])["needed_slots"] == ["gefen", "current"]


# --- the pre-check ---

class _Query:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *a):
        return self

    def eq(self, *a):
        return self

    def in_(self, *a):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _Db:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


@pytest.fixture
def run_check(monkeypatch):
    def run(by_slot, advisors, durations, overrides=None):
        db = _Db({
            "schools": [PLAIN],
            "school_advisors_gefen": [{"school_id": "plain", "advisor_id": a} for a in advisors.get("gefen", [])],
            "school_advisors_current": [{"school_id": "plain", "advisor_id": a} for a in advisors.get("current", [])],
            "school_year_admin_data": [{"school_id": "plain", **durations}],
        })
        monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
        monkeypatch.setattr(tasks_router.task_logic, "find_matching_schools", lambda *a, **k: [{"school_id": "plain"}])
        monkeypatch.setattr(tasks_router.task_logic, "opted_out_recipients", lambda *a, **k: {})
        monkeypatch.setattr(tasks_router, "_resolve_recipient_with_cascade", lambda *a, **k: {"recipient": {}})
        monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot", coordinators(by_slot))
        req = tasks_router.MeetingRequirementIn(meeting_service_type="gefen_current", participant_roles=["principal"])
        return tasks_router._check_meeting_problems("org", {}, None, [req], "email_resend", "תשפ\"ז", overrides)
    return run


def test_clean_school_has_no_problem(run_check):
    res = run_check({"gefen": GEFEN_COORD, "current": GEFEN_COORD}, {"gefen": ["a"], "current": ["b"]}, DURATIONS)
    assert res["schools"] == [] and res["ok_schools"] == 1


def test_different_coordinators_are_a_blocking_problem(run_check):
    res = run_check({"gefen": GEFEN_COORD, "current": CURRENT_COORD}, {"gefen": ["a"], "current": ["a"]}, DURATIONS)
    entry = res["schools"][0]
    assert entry["coordinator_conflict"]["scopes"][0]["gefen"]["email"] == "g@example.com"
    assert entry["coordinator_conflict"]["scopes"][0]["current"]["email"] == "c@example.com"
    assert res["ok_schools"] == 0
    assert tasks_router._has_blocking_meeting_problem(entry)


def test_saved_choice_clears_the_conflict(run_check):
    res = run_check({"gefen": GEFEN_COORD, "current": CURRENT_COORD}, {"gefen": ["a"], "current": ["a"]}, DURATIONS,
                    {"plain": {"gefen_current": {"coordinator_type": "gefen"}}})
    assert res["schools"] == []


def test_missing_side_is_reported(run_check):
    res = run_check({"gefen": GEFEN_COORD}, {"gefen": ["a"]}, {"meeting_duration_gefen": 60})
    defaults = res["schools"][0]["meeting_defaults"][0]
    assert defaults["meeting_service_type"] == "gefen_current"
    assert defaults["missing_advisor_types"] == ["current"]
    assert defaults["missing_duration_types"] == ["current"]


def test_saved_for_this_meeting_only_values_fill_the_gap(run_check):
    # A scheduled task re-runs this check at activation with its saved overrides; they must count,
    # or the task would be held back for a gap that was already filled.
    res = run_check({"gefen": GEFEN_COORD}, {"gefen": ["a"]}, {"meeting_duration_gefen": 60},
                    {"plain": {"gefen_current": {"advisor_ids": ["b"], "duration_minutes": 120}}})
    assert res["schools"] == []


def test_advisor_override_joins_the_card_advisors():
    # The modal offers it only for the missing side, so the existing גפן advisor stays in.
    ranges = tasks_router._build_meeting_ranges(
        PLAIN, [cond()], {"gefen": ["a"]}, DURATIONS, {"gefen_current": {"advisor_ids": ["b"]}},
    )
    assert ranges[0]["advisor_ids"] == ["a", "b"]
    # Other types keep replace semantics.
    ranges = tasks_router._build_meeting_ranges(
        PLAIN, [cond("gefen")], {"gefen": ["a"]}, DURATIONS, {"gefen": {"advisor_ids": ["b"]}},
    )
    assert ranges[0]["advisor_ids"] == ["b"]


# --- audience field ---

@pytest.mark.parametrize("actual,target,expected", [
    (True, ["yes"], True), (False, ["yes"], False), (False, ["no"], True), (True, ["yes", "no"], True),
    (True, "yes", True), (False, "yes", False),
])
def test_yes_no_chips_match_the_chosen_value(actual, target, expected):
    assert task_logic._compare("bool", "eq", actual, target) is expected


def test_same_advisor_field_is_offered():
    fields = {f["field"]: f for f in task_logic.field_options()["fields"]}
    assert fields["advisor_gefen_current_same"]["type"] == "bool"
    assert fields["advisor_gefen_current_same"]["label"] == "יועץ גפן ויועץ שוטף זהים"
