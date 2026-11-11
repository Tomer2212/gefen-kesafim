"""Meeting tasks: "לפי סוג שירות בכרטיס בית ספר" (meeting_service_type="by_service") — each
school is asked for the meeting(s) of its own card service type. Fully offline: Supabase is faked.
"""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import task_logic  # noqa: E402
from routers import tasks_router  # noqa: E402

YEAR = "תשפ\"ז"
PLAIN = {"id": "plain", "name": "רגיל", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com", "principal_phone": "4"}
SIX_YEAR = {
    "id": "six", "name": "שש", "stage": "sheshshnati", "principal_same_person": True,
    "principal_name": "מנהל", "principal_email": "p@example.com", "principal_phone": "1",
}
DURATIONS = {"meeting_duration_gefen": 60, "meeting_duration_current": 90, "meeting_duration_district": 45}
SAME = {"gefen": ["a"], "current": ["a"], "district": ["d"], "takuma": ["a"]}
DIFFERENT = {"gefen": ["a"], "current": ["b"], "district": ["d"], "takuma": ["a"]}


def cond(split="separate", scope=None, service_type="by_service", **extra):
    return {
        "type": "meeting", "meeting_service_type": service_type, "gefen_current_split": split, "stage_scope": scope,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "meeting_type": "remote", "explicit_stage_scope_only": True, **extra,
    }


def types(conds):
    return [c["meeting_service_type"] for c in conds]


# --- the expansion ---

@pytest.mark.parametrize("card,same,split,expected", [
    ("gefen", False, "separate", ["gefen"]),
    ("current", False, "separate", ["current"]),
    ("district", False, "separate", ["district"]),
    ("takuma", False, "separate", ["takuma"]),
    ("gefen_current", True, "separate", ["gefen_current"]),
    ("gefen_current", True, "combined", ["gefen_current"]),
    ("gefen_current", False, "combined", ["gefen_current"]),
    ("gefen_current", False, "separate", ["gefen", "current"]),
])
def test_each_card_type_gets_its_meetings(card, same, split, expected):
    assert types(task_logic.expand_meeting_condition(cond(split), card, same)) == expected


@pytest.mark.parametrize("card", [None, "", "something_else"])
def test_no_service_type_asks_nothing(card):
    assert task_logic.expand_meeting_condition(cond(), card, False) == []


def test_plain_conditions_are_untouched():
    plain = cond(service_type="gefen")
    assert task_logic.expand_meeting_condition(plain, None, False) == [plain]


def test_current_meeting_has_no_division_choice():
    out = task_logic.expand_meeting_condition(cond(scope="both", stage_scope_by_school={"six": "tichon"}), "gefen_current", False)
    assert [(c["meeting_service_type"], c["stage_scope"], c["stage_scope_by_school"]) for c in out] == [
        ("gefen", "both", {"six": "tichon"}), ("current", None, None),
    ]


# --- booking ranges ---

@pytest.mark.parametrize("card,advisors,expected", [
    ("gefen", SAME, [("gefen", ["a"], 60)]),
    ("current", SAME, [("current", ["a"], 90)]),
    ("district", SAME, [("district", ["d"], 45)]),
    ("takuma", SAME, [("takuma", ["a"], 60)]),  # takuma: the גפן advisor and length
    ("gefen_current", SAME, [("gefen_current", ["a"], 150)]),
    ("gefen_current", DIFFERENT, [("gefen", ["a"], 60), ("current", ["b"], 90)]),
])
def test_ranges_follow_the_card(card, advisors, expected):
    conds = tasks_router._school_meeting_conditions([cond("separate")], advisors, card)
    ranges = tasks_router._build_meeting_ranges(PLAIN, conds, advisors, DURATIONS)
    assert [(r["service_type"], r["advisor_ids"], r["duration_minutes"]) for r in ranges] == expected


def test_combined_answer_is_one_meeting_with_all_advisors():
    conds = tasks_router._school_meeting_conditions([cond("combined")], DIFFERENT, "gefen_current")
    ranges = tasks_router._build_meeting_ranges(PLAIN, conds, DIFFERENT, DURATIONS)
    assert [(r["service_type"], r["advisor_ids"], r["duration_minutes"], r["label"]) for r in ranges] == [
        ("gefen_current", ["a", "b"], 150, "פגישת גפן+שוטף"),
    ]


def test_separate_meetings_on_a_six_year_school_keep_the_division_only_for_gefen():
    conds = tasks_router._school_meeting_conditions([cond("separate", scope="separate")], DIFFERENT, "gefen_current")
    ranges = tasks_router._build_meeting_ranges(SIX_YEAR, conds, DIFFERENT, DURATIONS)
    assert [(r["service_type"], r["stage_scope"]) for r in ranges] == [("gefen", "tichon"), ("gefen", "chativa"), ("current", None)]


def test_no_service_type_means_no_ranges():
    assert tasks_router._school_meeting_conditions([cond()], SAME, None) is None
    assert tasks_router._school_meeting_conditions([cond(service_type="gefen")], SAME, None) == [cond(service_type="gefen")]


def test_same_advisor_rule():
    assert tasks_router._same_gefen_current_advisors({"gefen": ["a", "b"], "current": ["b", "a"]}) is True
    assert tasks_router._same_gefen_current_advisors({"gefen": ["a"], "current": ["a", "b"]}) is False
    assert tasks_router._same_gefen_current_advisors({}) is False


# --- task creation ---

def test_creation_requires_the_split_answer_and_takes_advisor_and_length_from_the_card():
    with pytest.raises(tasks_router.HTTPException):
        tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [cond(split=None)]}]}, "org")
    c = cond(advisor_mode="manual", advisor_ids=["x"], duration_mode="manual", duration_minutes=30)
    tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [c]}]}, "org")
    assert (c["advisor_mode"], c["advisor_ids"], c["duration_mode"], c["duration_minutes"]) == ("default", [], "default", None)


# --- progress ---

def meeting(service_type, scope=None, mid="m"):
    return {"id": mid, "school_id": "plain", "meeting_date": "2026-12-10", "meeting_service_type": service_type,
            "status": "scheduled", "stage_scope": scope, "meeting_type": "remote", "booking_token_id": None}


def result(meetings, card="gefen_current", same=False, split="separate", school=PLAIN):
    s = {**school, "advisor_gefen_current_same": same}
    return task_logic._meeting_condition_result(cond(split), s, meetings, {"service_type": card}, set())


def test_separate_meetings_count_one_by_one():
    assert (result([])["actual_count"], result([])["required_count"]) == (0, 2)
    half = result([meeting("gefen")])
    assert (half["ok"], half["actual_count"], half["required_count"]) == (False, 1, 2)
    full = result([meeting("gefen", mid="1"), meeting("current", mid="2")])
    assert (full["ok"], full["actual_count"], full["resolved_types"]) == (True, 2, ["gefen", "current"])


def test_one_combined_meeting_is_one_of_one():
    res = result([meeting("gefen_current")], same=True)
    assert (res["ok"], res["actual_count"], res["required_count"], res["resolved_types"]) == (True, 1, 1, ["gefen_current"])
    # A plain גפן meeting doesn't satisfy a combined request.
    assert result([meeting("gefen")], same=True)["ok"] is False


def test_school_with_no_service_type_is_never_done():
    res = result([meeting("gefen")], card=None)
    assert (res["ok"], res["required_count"], res["resolved_types"]) == (False, 1, [])
    assert task_logic._resolve_condition(cond(), PLAIN, [meeting("gefen")], {}, None, None, set()) is False


def test_replaces_answer_counts_for_the_expanded_type():
    m = {**meeting("district"), "request_resolutions": [
        {"token_id": "t1", "service_type": "gefen", "decision": "replaces", "stage_scope": None}]}
    s = {**PLAIN, "advisor_gefen_current_same": False}
    res = task_logic._meeting_condition_result(cond("separate"), s, [m], {"service_type": "gefen_current"}, {"t1"})
    assert (res["actual_count"], res["required_count"]) == (1, 2)  # counted for the גפן request only


def test_plain_condition_result_is_unchanged():
    res = task_logic._meeting_condition_result(cond(service_type="gefen"), PLAIN, [meeting("gefen")], {}, set())
    assert (res["ok"], res["actual_count"], res["required_count"]) == (True, 1, 1)
    assert "resolved_types" not in res


def test_six_year_division_rows():
    s = {**SIX_YEAR, "advisor_gefen_current_same": False}
    meetings = [{**meeting("gefen", "tichon"), "school_id": "six"}, {**meeting("current", None, "2"), "school_id": "six"}]
    c = cond("separate", scope="separate")
    tichon = task_logic._by_service_stage_row(c, s, meetings, {"service_type": "gefen_current"}, set(), "tichon")
    chativa = task_logic._by_service_stage_row(c, s, meetings, {"service_type": "gefen_current"}, set(), "chativa")
    assert (tichon["ok"], chativa["ok"]) == (True, False)


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
    def run(service_type, advisors, durations=DURATIONS, split="separate"):
        year_row = {"school_id": "plain", "academic_year": YEAR, "service_type": service_type, **durations}
        db = _Db({
            "schools": [PLAIN],
            **{f"school_advisors_{t}": [{"school_id": "plain", "advisor_id": a} for a in advisors.get(t, [])]
               for t in ("gefen", "current", "district")},
            "school_year_admin_data": [year_row],
        })
        monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
        monkeypatch.setattr(tasks_router.task_logic, "find_matching_schools", lambda *a, **k: [{"school_id": "plain"}])
        monkeypatch.setattr(tasks_router.task_logic, "opted_out_recipients", lambda *a, **k: {})
        monkeypatch.setattr(tasks_router, "_resolve_recipient_with_cascade", lambda *a, **k: {"recipient": {}})
        monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot",
                            lambda school, slot: {"name": "רכז", "email": "c@example.com"})
        req = tasks_router.MeetingRequirementIn(meeting_service_type="by_service", gefen_current_split=split, participant_roles=["principal"])
        return tasks_router._check_meeting_problems("org", {}, None, [req], "email_resend", YEAR)
    return run


def test_missing_service_type_is_a_blocking_problem(run_check):
    res = run_check(None, SAME)
    entry = res["schools"][0]
    assert entry["missing_service_type"] == {"academic_year": YEAR}
    assert tasks_router._has_blocking_meeting_problem(entry) and res["ok_schools"] == 0


def test_clean_by_service_school(run_check):
    assert run_check("gefen_current", DIFFERENT)["schools"] == []


def test_missing_card_values_are_checked_for_the_resolved_types(run_check):
    res = run_check("gefen_current", {"gefen": ["a"]}, {"meeting_duration_gefen": 60})
    defaults = res["schools"][0]["meeting_defaults"]
    # Different (one empty) advisor lists + "separate" → a גפן and a שוטף meeting; only שוטף lacks values.
    assert [(d["meeting_service_type"], d["missing_advisor"], d["missing_duration"]) for d in defaults] == [("current", True, True)]
