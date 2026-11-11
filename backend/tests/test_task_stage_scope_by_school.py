"""Meeting tasks: per-school division choice ("התאמה אישית") and the shared coverage rule between
task progress and the public booking page. Fully offline: Supabase is faked.
"""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import task_logic  # noqa: E402
from routers import meeting_booking_router, tasks_router  # noqa: E402

SIX_YEAR = {
    "id": "six", "name": "שש", "stage": "sheshshnati", "principal_same_person": False,
    "principal_name": "מנהל תיכון", "principal_email": "p@example.com", "principal_phone": "1",
    "principal_chativa_name": "מנהל חטב", "principal_chativa_email": "pc@example.com", "principal_chativa_phone": "2",
    "secretary_name": "מזכירה", "secretary_email": "s@example.com", "secretary_phone": "3",
    "secretary_same_person": True,
}
ONE_PRINCIPAL = {**SIX_YEAR, "id": "one", "principal_same_person": True}
PLAIN = {"id": "plain", "name": "רגיל", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com", "principal_phone": "4"}


def cond(scope=None, overrides=None, **extra):
    return {
        "type": "meeting", "meeting_service_type": "gefen", "stage_scope": scope,
        "stage_scope_by_school": overrides,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "meeting_type": "remote", "explicit_stage_scope_only": True, **extra,
    }


def meeting(scope, school_id="six", day="2026-12-10"):
    return {"id": f"m-{scope}", "school_id": school_id, "meeting_date": day, "meeting_service_type": "gefen",
            "status": "scheduled", "stage_scope": scope, "meeting_type": "remote", "booking_token_id": None}


# --- effective_stage_scope ---

def test_override_wins_and_other_schools_get_the_default():
    c = cond("both", {"six": "tichon"})
    assert task_logic.effective_stage_scope(c, SIX_YEAR) == "tichon"
    assert task_logic.effective_stage_scope(c, ONE_PRINCIPAL) == "both"


def test_condition_without_the_new_field_is_unchanged():
    legacy = {"type": "meeting", "stage_scope": "chativa"}
    assert task_logic.effective_stage_scope(legacy, SIX_YEAR) == "chativa"


# --- required / fulfilled ---

@pytest.mark.parametrize("school,scope,required", [
    (SIX_YEAR, "tichon", 1), (SIX_YEAR, "chativa", 1), (SIX_YEAR, "both", 1), (SIX_YEAR, "separate", 2),
    (ONE_PRINCIPAL, "separate", 2), (ONE_PRINCIPAL, "both", 1),
    (PLAIN, "separate", 1), (PLAIN, "tichon", 1),
])
def test_required_count(school, scope, required):
    assert task_logic._required_count_for_condition(cond(scope), school) == required
    assert task_logic._required_count_for_condition(cond("both", {school["id"]: scope}), school) == required


@pytest.mark.parametrize("requested,meeting_scopes,fulfilled", [
    ("tichon", ["tichon"], 1), ("tichon", ["both"], 1), ("tichon", ["chativa"], 0), ("tichon", [None], 0),
    ("chativa", ["chativa"], 1), ("chativa", ["both"], 1), ("chativa", ["tichon"], 0), ("chativa", [None], 0),
    ("both", ["both"], 1), ("both", ["tichon", "chativa"], 1), ("both", ["tichon"], 0), ("both", [None], 0),
    ("separate", ["tichon"], 1), ("separate", ["chativa"], 1), ("separate", ["tichon", "chativa"], 2),
    ("separate", ["both"], 2), ("separate", [None], 0), ("separate", [None, "tichon"], 1),
])
def test_fulfilled_count_follows_coverage_rule(requested, meeting_scopes, fulfilled):
    meetings = [meeting(s) for s in meeting_scopes]
    assert task_logic._fulfilled_count_for_meeting_condition(cond(requested), meetings, None, SIX_YEAR) == fulfilled


def test_non_six_year_school_counts_any_meeting():
    meetings = [meeting(None, "plain")]
    for scope in ("tichon", "both", "separate"):
        assert task_logic._fulfilled_count_for_meeting_condition(cond(scope), meetings, None, PLAIN) == 1


def test_six_year_condition_without_division_choice_counts_any_meeting():
    assert task_logic._fulfilled_count_for_meeting_condition(cond(None), [meeting(None)], None, SIX_YEAR) == 1


def test_meeting_exists_cell_follows_the_coverage_rule():
    assert task_logic._meeting_exists_for_school(cond("tichon"), [meeting("chativa")], SIX_YEAR) is False
    assert task_logic._meeting_exists_for_school(cond("tichon"), [meeting("both")], SIX_YEAR) is True
    assert task_logic._meeting_exists_for_school(cond("tichon"), [meeting(None, "plain")], PLAIN) is True


# --- tasks created before the explicit-division rule keep their results ---

@pytest.mark.parametrize("requested,meeting_scopes,fulfilled", [
    ("tichon", ["chativa"], 1), ("tichon", [None], 1), ("both", [None], 1), ("both", ["tichon"], 1),
    ("chativa", ["tichon", None], 2), ("separate", ["tichon"], 1), ("separate", [None], 0),
])
def test_condition_without_the_stamp_keeps_the_old_count(requested, meeting_scopes, fulfilled):
    legacy = cond(requested)
    del legacy["explicit_stage_scope_only"]
    meetings = [meeting(s) for s in meeting_scopes]
    assert task_logic._fulfilled_count_for_meeting_condition(legacy, meetings, None, SIX_YEAR) == fulfilled
    assert task_logic._meeting_exists_for_school(legacy, meetings, SIX_YEAR) is True


# --- compute_task_progress ---

@pytest.fixture
def progress_of(monkeypatch):
    def run(condition, schools, meetings):
        monkeypatch.setattr(task_logic, "_fetch_schools_and_meetings", lambda *a: (schools, meetings, {}, {}, {}))
        monkeypatch.setattr(task_logic, "get_admin_client", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
        task = {"id": "t", "matched_school_ids": [s["id"] for s in schools],
                "success_criteria": {"groups": [{"conditions": [condition]}]}}
        out = task_logic.compute_task_progress("org", task)
        out["by_id"] = {r["school_id"]: r for r in out["schools"]}
        return out
    return run


def test_progress_sums_each_schools_own_requirement(progress_of):
    schools = [{**SIX_YEAR, "id": "a"}, {**SIX_YEAR, "id": "b"}, {**SIX_YEAR, "id": "c"}, PLAIN]
    c = cond("both", {"a": "tichon", "c": "separate"})
    out = progress_of(c, schools, [meeting("tichon", "a"), meeting("tichon", "c")])
    assert out["action_progress"]["required"] == 5  # a=1, b=1, c=2, plain=1
    assert out["action_progress"]["completed"] == 2  # a=1, c=1
    assert out["by_id"]["a"]["done"] is True
    assert out["by_id"]["c"]["done"] is False
    assert out["by_id"]["a"]["condition_results"][0]["requested_scope"] == "tichon"
    assert out["by_id"]["b"]["condition_results"][0]["requested_scope"] == "both"
    assert out["by_id"]["plain"]["condition_results"][0]["requested_scope"] is None


def test_stage_rows_follow_the_schools_own_choice(progress_of):
    schools = [{**SIX_YEAR, "id": "a"}, {**SIX_YEAR, "id": "b"}, {**SIX_YEAR, "id": "c"}]
    c = cond("both", {"a": "tichon", "c": "separate"})
    by_id = progress_of(c, schools, [meeting("chativa", "c")])["by_id"]
    tichon_row, chativa_row = by_id["a"]["stage_rows"]
    assert chativa_row["condition_results"][0]["not_applicable"] is True
    assert tichon_row["condition_results"][0]["ok"] is False
    assert by_id["b"]["stage_rows"] is None
    assert [r["condition_results"][0]["ok"] for r in by_id["c"]["stage_rows"]] == [False, True]


def test_one_principal_school_keeps_two_rows_for_separate(progress_of):
    # The select in _fetch_schools_and_meetings omits principal_same_person on purpose.
    school = {k: v for k, v in ONE_PRINCIPAL.items() if k != "principal_same_person"}
    assert len(progress_of(cond("separate"), [school], [])["by_id"]["one"]["stage_rows"]) == 2


# --- _build_meeting_ranges ---

def ranges_for(school, condition):
    return tasks_router._build_meeting_ranges(school, [condition], {"gefen": ["adv"]}, {})


def test_ranges_follow_the_override():
    default_both = cond("both", {"six": "separate"})
    assert [r["stage_scope"] for r in ranges_for(SIX_YEAR, default_both)] == ["tichon", "chativa"]
    assert [r["stage_scope"] for r in ranges_for(ONE_PRINCIPAL | {"id": "other"}, default_both)] == ["both"]
    assert [r["stage_scope"] for r in ranges_for(SIX_YEAR, cond("separate", {"six": "chativa"}))] == ["chativa"]


def test_non_six_year_school_ignores_any_choice():
    assert [r["stage_scope"] for r in ranges_for(PLAIN, cond("separate", {"plain": "separate"}))] == [None]


def test_separate_splits_without_a_principal_in_the_roles():
    ranges = ranges_for(SIX_YEAR, cond("separate", participant_roles=["secretary"]))
    assert [r["stage_scope"] for r in ranges] == ["tichon", "chativa"]


def test_separate_on_one_principal_school_is_two_meetings_named_by_division():
    ranges = ranges_for(ONE_PRINCIPAL, cond("separate"))
    assert [r["label"] for r in ranges] == ["פגישת גפן — תיכון", 'פגישת גפן — חט"ב']
    assert all(p["email"] == "p@example.com" for r in ranges for p in r["participants"])


@pytest.mark.parametrize("scope,label", [
    ("tichon", "פגישת גפן — תיכון"), ("chativa", 'פגישת גפן — חט"ב'), ("both", 'פגישת גפן — תיכון וחט"ב'), (None, "פגישת גפן"),
])
def test_six_year_label_names_the_division(scope, label):
    assert ranges_for(SIX_YEAR, cond(scope))[0]["label"] == label


def test_non_six_year_label_has_no_division():
    assert ranges_for(PLAIN, cond("both"))[0]["label"] == "פגישת גפן"


def test_two_cards_of_one_type_are_numbered_per_card_not_per_range():
    ranges = tasks_router._build_meeting_ranges(SIX_YEAR, [cond("separate"), cond("both")], {"gefen": ["adv"]}, {})
    assert [r["label"] for r in ranges] == [
        "פגישת גפן (1) — תיכון", 'פגישת גפן (1) — חט"ב', 'פגישת גפן (2) — תיכון וחט"ב',
    ]


def test_range_carries_its_conditions_rule():
    assert ranges_for(SIX_YEAR, cond("tichon"))[0]["explicit_stage_scope_only"] is True
    legacy = cond("tichon")
    del legacy["explicit_stage_scope_only"]
    assert ranges_for(SIX_YEAR, legacy)[0]["explicit_stage_scope_only"] is False


# --- contact checks ---

def requirement(scope, overrides=None):
    return tasks_router.MeetingRequirementIn(
        meeting_service_type="gefen", date_from="2026-12-01", date_to="2026-12-31",
        participant_roles=["principal"], stage_scope=scope, stage_scope_by_school=overrides,
    )


@pytest.mark.parametrize("scope,expected_slots", [
    ("separate", ["gefen_beinayim"]),  # send needs a coordinator per division, so one isn't enough
    ("both", None),  # a merged meeting needs just one recipient
    ("tichon", None),
])
def test_coordinator_check_matches_what_send_needs(monkeypatch, scope, expected_slots):
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot",
                        lambda school, slot: {"email": "c@example.com"} if slot == "gefen_tichon" else None)
    monkeypatch.setattr(tasks_router, "_missing_contact_detail", lambda school: {})
    problem = tasks_router._coordinator_problem(SIX_YEAR, "email_resend", [requirement(scope)])
    assert (problem["needed_slots"] if problem else None) == expected_slots
    # The same answer when the choice arrives as this school's override.
    problem = tasks_router._coordinator_problem(SIX_YEAR, "email_resend", [requirement("chativa" if scope != "chativa" else "both", {"six": scope})])
    assert (problem["needed_slots"] if problem else None) == expected_slots


# --- create-time validation ---

class _FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *a):
        return self

    def eq(self, *a):
        return self

    def in_(self, *a):
        self.status_filter = a[1]
        return self

    def gte(self, *a):
        return self

    def lte(self, *a):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _FakeDb:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return _FakeQuery(self.rows)


def test_new_tasks_get_the_rule_stamp_even_without_overrides():
    plain_cond = {k: v for k, v in cond("both").items() if k != "explicit_stage_scope_only"}
    field_cond = {"type": "field", "field": "x"}
    criteria = {"groups": [{"conditions": [plain_cond, field_cond]}]}
    tasks_router._prepare_meeting_conditions(criteria, "org")
    assert plain_cond["explicit_stage_scope_only"] is True
    assert "explicit_stage_scope_only" not in field_cond


def test_validation_drops_schools_outside_the_orgs_six_year_list(monkeypatch):
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: _FakeDb([{"id": "mine"}]))
    criteria = {"groups": [{"conditions": [cond("both", {"mine": "tichon", "other-org": "separate"})]}]}
    tasks_router._prepare_meeting_conditions(criteria, "org")
    assert criteria["groups"][0]["conditions"][0]["stage_scope_by_school"] == {"mine": "tichon"}


@pytest.mark.parametrize("condition", [
    cond(None, {"mine": "tichon"}),  # no default for the schools without an entry
    cond("both", {"mine": "nonsense"}),
    cond("both", ["mine"]),
])
def test_validation_rejects_bad_choices(monkeypatch, condition):
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: _FakeDb([{"id": "mine"}]))
    with pytest.raises(HTTPException) as exc:
        tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [condition]}]}, "org")
    assert exc.value.status_code == 422


def test_validation_leaves_tasks_without_overrides_alone(monkeypatch):
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: (_ for _ in ()).throw(AssertionError("no query expected")))
    criteria = {"groups": [{"conditions": [cond("both"), cond(None)]}]}
    tasks_router._prepare_meeting_conditions(criteria, "org")
    tasks_router._prepare_meeting_conditions(None, "org")


# --- booking page ---

SEGMENTS = [{"start_date": "2026-12-01", "end_date": "2026-12-31"}]


def booking_row(scope):
    return {"meeting_date": "2026-12-10", "start_time": "09:00", "end_time": "10:00", "stage_scope": scope}


@pytest.mark.parametrize("requested,scopes,blocked", [
    ("tichon", [None], False), ("tichon", ["chativa"], False), ("tichon", ["tichon"], True), ("tichon", ["both"], True),
    ("chativa", ["tichon"], False), ("chativa", ["both"], True),
    ("both", [None], False), ("both", ["tichon"], False), ("both", ["both"], True), ("both", ["tichon", "chativa"], True),
])
def test_task_link_uses_the_coverage_rule(requested, scopes, blocked):
    db = _FakeDb([booking_row(s) for s in scopes])
    found = meeting_booking_router._find_existing_meeting_any_segment(db, "six", "gefen", SEGMENTS, requested, True)
    assert bool(found) is blocked
    if found:
        assert set(found) == {"meeting_date", "start_time", "end_time"}


def test_task_link_reports_the_covering_meeting_not_another_divisions():
    db = _FakeDb([booking_row("tichon") | {"start_time": "08:00"}, booking_row("chativa")])
    found = meeting_booking_router._find_existing_meeting_any_segment(db, "six", "gefen", SEGMENTS, "chativa", True)
    assert found["start_time"] == "09:00"


def test_task_link_counts_completed_meetings_like_progress_does():
    db = _FakeDb([booking_row("tichon")])
    queries = []
    db.table = lambda _name: queries.append(_FakeQuery(db.rows)) or queries[-1]
    assert meeting_booking_router._find_existing_meeting_any_segment(db, "six", "gefen", SEGMENTS, "tichon", True)
    assert queries[0].status_filter == ["scheduled", "completed"]


def test_range_without_the_flag_keeps_the_original_check(monkeypatch):
    calls = []

    def original(db, school_id, service_type, start, end, scope, excluded_ids=frozenset()):
        calls.append(scope)
        return {"meeting_date": "2026-12-10"}

    monkeypatch.setattr(meeting_booking_router, "_find_existing_meeting", original)
    found = meeting_booking_router._find_existing_meeting_any_segment(_FakeDb([]), "six", "gefen", SEGMENTS, "tichon", None)
    assert found and calls == ["tichon"]


# --- the send path, end to end up to the queue ---

class _RecordingDb:
    """Serves `schools` and records org_task_messages inserts; every other table is empty."""
    def __init__(self, schools):
        self.schools, self.inserted, self._table = schools, [], None

    def table(self, name):
        self._table = name
        return self

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def insert(self, rows):
        self.inserted.extend(rows)
        return self

    def execute(self):
        data = self.schools if self._table == "schools" else []
        return type("R", (), {"data": data})()


def test_queue_sends_each_school_its_own_meetings(monkeypatch):
    # gefen_tichon and gefen_beinayim resolve to different coordinators.
    coordinators = {"gefen_tichon": {"name": "ת", "email": "t@example.com"}, "gefen_beinayim": {"name": "ח", "email": "c@example.com"}}
    schools = [{**SIX_YEAR, "id": "keeps-default"}, {**SIX_YEAR, "id": "wants-separate"}, {**SIX_YEAR, "id": "wants-chativa"}]
    minted = []

    def mint(db, org_id, school_id, ranges, task_id):
        minted.append((school_id, [(r["stage_scope"], r["label"]) for r in ranges]))
        return "https://link", f"token-{len(minted)}"

    monkeypatch.setattr(tasks_router, "_mint_meeting_booking_link", mint)
    monkeypatch.setattr(tasks_router._schools_router, "_resolve_meeting_coordinator_for_slot", lambda school, slot: coordinators.get(slot))
    monkeypatch.setattr(tasks_router, "resolve_inherited_year_admin", lambda *a: {})
    monkeypatch.setattr(tasks_router, "_fetch_school_notes_map", lambda *a: {})
    monkeypatch.setattr(tasks_router.task_logic, "opted_out_recipients", lambda *a: {})
    db = _RecordingDb(schools)
    c = cond("both", {"wants-separate": "separate", "wants-chativa": "chativa"}, advisor_mode="manual", advisor_ids=["adv"])
    task = {"id": "t", "is_meeting_task": True, "success_criteria": {"groups": [{"conditions": [c]}]},
            "message_config": {"recipient_role": "meeting_coordinator", "channel": "email_outlook", "subject": "s",
                               "body_template": "{meetings_list} {booking_link}"}}
    missing, _ = tasks_router._queue_messages_for_schools(db, task, "org", [s["id"] for s in schools])
    assert missing == []
    assert minted == [
        ("keeps-default", [("both", 'פגישת גפן — תיכון וחט"ב')]),
        ("wants-separate", [("tichon", "פגישת גפן — תיכון")]),
        ("wants-separate", [("chativa", 'פגישת גפן — חט"ב')]),
        ("wants-chativa", [("chativa", 'פגישת גפן — חט"ב')]),
    ]
    assert [(m["school_id"], m["recipient_email"]) for m in db.inserted] == [
        ("keeps-default", "t@example.com"),
        ("wants-separate", "t@example.com"), ("wants-separate", "c@example.com"),
        ("wants-chativa", "c@example.com"),
    ]
    assert 'תיכון וחט"ב' in db.inserted[0]["body"]
