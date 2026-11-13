"""Meeting tasks: a school with several card advisors of one type — the manager picks which of them
a school-booked meeting is for (or all), per division on a six-year school with separate meetings,
remembered by a round. Fully offline: Supabase is faked.
"""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers import tasks_router  # noqa: E402

YEAR = "תשפ\"ז"
PLAIN = {"id": "plain", "name": "רגיל", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com", "principal_phone": "4"}
SIX_YEAR = {
    "id": "six", "name": "שש", "stage": "sheshshnati", "principal_same_person": True,
    "principal_name": "מנהל", "principal_email": "p@example.com", "principal_phone": "1",
}
DURATIONS = {"meeting_duration_gefen": 60, "meeting_duration_current": 90}


def cond(service_type="gefen", scope=None, **extra):
    return {
        "type": "meeting", "meeting_service_type": service_type, "stage_scope": scope,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "meeting_type": "remote", **extra,
    }


# --- the rule ---

def test_one_advisor_is_never_asked():
    ids, questions = tasks_router._chosen_default_advisors({"gefen": ["a"]}, "gefen", [], None, {})
    assert ids == ["a"] and questions == []


def test_two_advisors_ask_and_keep_everyone_until_answered():
    ids, questions = tasks_router._chosen_default_advisors({"gefen": ["a", "b"]}, "gefen", [], None, {})
    assert ids == ["a", "b"]
    assert [(q["key"], q["advisor_ids"]) for q in questions] == [("gefen", ["a", "b"])]


def test_an_answer_narrows_the_part():
    ids, questions = tasks_router._chosen_default_advisors({"gefen": ["a", "b"]}, "gefen", [], None, {"gefen": ["b"]})
    assert ids == ["b"] and questions == []


def test_an_answer_no_longer_on_the_card_is_asked_again():
    ids, questions = tasks_router._chosen_default_advisors({"gefen": ["a", "b"]}, "gefen", [], None, {"gefen": ["z"]})
    assert ids == ["a", "b"] and len(questions) == 1


def test_excluded_advisors_dont_count():
    ids, questions = tasks_router._chosen_default_advisors({"gefen": ["a", "b"]}, "gefen", ["b"], None, {})
    assert ids == ["a"] and questions == []


def test_takuma_shares_the_gefen_answer():
    ids, _ = tasks_router._chosen_default_advisors({"gefen": ["a", "b"], "takuma": ["a", "b"]}, "takuma", [], None, {"gefen": ["a"]})
    assert ids == ["a"]


def test_combined_meeting_asks_each_side_separately():
    _, questions = tasks_router._chosen_default_advisors({"gefen": ["a", "b"], "current": ["c", "d"]}, "gefen_current", [], None, {})
    assert [q["key"] for q in questions] == ["gefen", "current"]
    ids, _ = tasks_router._chosen_default_advisors(
        {"gefen": ["a", "b"], "current": ["c", "d"]}, "gefen_current", [], None, {"gefen": ["a"], "current": ["c", "d"]},
    )
    assert ids == ["a", "c", "d"]


def test_combined_meeting_with_the_same_people_is_one_question():
    _, questions = tasks_router._chosen_default_advisors({"gefen": ["a", "b"], "current": ["b", "a"]}, "gefen_current", [], None, {})
    assert [q["key"] for q in questions] == ["gefen_current"]


def test_six_year_divisions_have_their_own_keys():
    assert tasks_router.advisor_choice_key("gefen", "tichon") == "gefen@tichon"
    assert tasks_router.advisor_choice_key("gefen", "both") == "gefen"
    assert tasks_router.advisor_choice_key("gefen", None) == "gefen"


# --- ranges ---

def test_ranges_use_the_chosen_advisor():
    ranges = tasks_router._build_meeting_ranges(PLAIN, [cond()], {"gefen": ["a", "b"]}, DURATIONS, None, None, None, None, {"gefen": ["b"]})
    assert ranges[0]["advisor_ids"] == ["b"]


def test_ranges_without_an_answer_keep_everyone():
    ranges = tasks_router._build_meeting_ranges(PLAIN, [cond()], {"gefen": ["a", "b"]}, DURATIONS)
    assert ranges[0]["advisor_ids"] == ["a", "b"]


def test_separate_six_year_ranges_get_their_own_advisor():
    ranges = tasks_router._build_meeting_ranges(
        SIX_YEAR, [cond(scope="separate")], {"gefen": ["a", "b"]}, DURATIONS, None, None, None, None,
        {"gefen@tichon": ["a"], "gefen@chativa": ["b"]},
    )
    assert [(r["stage_scope"], r["advisor_ids"]) for r in ranges] == [("tichon", ["a"]), ("chativa", ["b"])]


def test_manual_advisor_ignores_choices():
    ranges = tasks_router._build_meeting_ranges(
        PLAIN, [cond(advisor_mode="manual", advisor_ids=["m"])], {"gefen": ["a", "b"]}, DURATIONS, None, None, None, None, {"gefen": ["a"]},
    )
    assert ranges[0]["advisor_ids"] == ["m"]


def test_task_choice_wins_over_the_round():
    overrides = {"plain": {"advisor_choices": {"gefen": ["a"]}}}
    rounds = {"plain": {"gefen": ["b"], "current": ["c"]}}
    assert tasks_router._effective_advisor_choices("plain", overrides, rounds) == {"gefen": ["a"], "current": ["c"]}


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

    def gte(self, *a):
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
    def run(school, advisors, req_extra=None, overrides=None, round_choices=None, ask_all=True):
        db = _Db({
            "schools": [school],
            **{f"school_advisors_{t}": [{"school_id": school["id"], "advisor_id": a} for a in advisors.get(t, [])]
               for t in ("gefen", "current", "district")},
            "school_year_admin_data": [{"school_id": school["id"], "academic_year": YEAR, **DURATIONS}],
            "meeting_rounds": [{"advisor_choices": round_choices, "field_exempt_advisor_ids": [], "physical_visitors": {}}] if round_choices else [],
            "profiles": [{"id": a, "full_name": f"יועץ {a}"} for t in advisors.values() for a in t],
        })
        monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
        monkeypatch.setattr(tasks_router.task_logic, "find_matching_schools", lambda *a, **k: [{"school_id": school["id"]}])
        monkeypatch.setattr(tasks_router.task_logic, "opted_out_recipients", lambda *a, **k: {})
        monkeypatch.setattr(tasks_router, "_resolve_recipient_with_cascade", lambda *a, **k: {"recipient": {}})
        monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot",
                            lambda school, slot: {"name": "רכז", "email": "c@example.com"})
        req = tasks_router.MeetingRequirementIn(meeting_service_type="gefen", participant_roles=["principal"], **(req_extra or {}))
        return tasks_router._check_meeting_problems(
            "org", {}, None, [req], "email_resend", YEAR, overrides, "round" if round_choices else None,
            ask_all_advisor_choices=ask_all,
        )
    return run


def test_two_advisors_block_until_chosen(run_check):
    res = run_check(PLAIN, {"gefen": ["a", "b"]})
    entry = res["schools"][0]
    [q] = entry["advisor_choice"]
    assert q["key"] == "gefen" and q["chosen"] is None
    assert [a["name"] for a in q["advisors"]] == ["יועץ a", "יועץ b"]
    assert tasks_router._has_blocking_meeting_problem(entry) and res["ok_schools"] == 0


def test_a_saved_task_choice_clears_the_school(run_check):
    res = run_check(PLAIN, {"gefen": ["a", "b"]}, overrides={"plain": {"advisor_choices": {"gefen": ["a"]}}})
    assert res["schools"] == []


def test_a_round_choice_clears_the_school(run_check):
    assert run_check(PLAIN, {"gefen": ["a", "b"]}, round_choices={"plain": {"gefen": ["b"]}})["schools"] == []


def test_six_year_separate_asks_per_division(run_check):
    res = run_check(SIX_YEAR, {"gefen": ["a", "b"]}, {"stage_scope": "separate"})
    assert [q["key"] for q in res["schools"][0]["advisor_choice"]] == ["gefen@tichon", "gefen@chativa"]


def test_old_tasks_are_not_held_back(run_check):
    assert run_check(PLAIN, {"gefen": ["a", "b"]}, ask_all=False)["schools"] == []
    res = run_check(PLAIN, {"gefen": ["a", "b"]}, {"ask_advisor_choice": True}, ask_all=False)
    assert res["schools"][0]["advisor_choice"][0]["chosen"] is None


# --- rounds: the school's advisors follow the round's remembered choice ---

def test_round_row_lists_open_choice_advisors_until_chosen():
    import meeting_rounds
    rnd = {"id": "r1", "org_id": "o", "academic_year": YEAR, "start_date": "2026-12-01", "end_date": "2026-12-31",
           "requirement": {"meeting_service_type": "gefen", "count_per_school": 1}}
    school = {"id": "s1", "name": "א", "stage": "yesodi", "advisor_gefen": ["a", "b"], "advisor_current": [],
              "advisor_district": [], "advisor_gefen_current_same": False}
    cond = meeting_rounds.round_condition(rnd)
    row = meeting_rounds.school_status(cond, school, [], None, set(), None, None, None, "2026-12-05T10:00:00+00:00")
    assert row["advisor_ids"] == ["a", "b"] and row["advisor_choice_open_ids"] == ["a", "b"]
    row = meeting_rounds.school_status(cond, school, [], None, set(), None, None, None, "2026-12-05T10:00:00+00:00", {"gefen": ["b"]})
    assert row["advisor_ids"] == ["b"] and row["advisor_choice_open_ids"] == []
