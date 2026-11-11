"""Booking-link participant "מתאם פגישות [סוג]": resolved per school / range division to the
card's meeting coordinator, and never invited (or reminded) twice. Fully offline.
"""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers import schools_router, tasks_router  # noqa: E402

PLAIN = {
    "id": "plain", "name": "רגיל", "stage": "yesodi",
    "principal_name": "מנהלת", "principal_email": "p@example.com", "principal_phone": "1",
    "secretary_name": "מזכירה", "secretary_email": "s@example.com", "secretary_phone": "2",
    "finance_contact_name": "גזבר", "finance_contact_email": "f@example.com", "finance_contact_phone": "3",
    "extra_contacts": [{"name": "רכזת", "role": "רכזת פדגוגית", "email": "x@example.com", "phone": "4"}],
    "meeting_coordinators": {"gefen": "secretary", "current": "extra:0", "district": "finance_contact"},
}
SIX_YEAR = {
    "id": "six", "name": "שש", "stage": "sheshshnati",
    "principal_name": "מנהל", "principal_email": "p@example.com",
    "secretary_name": "מזכירה תיכון", "secretary_email": "s@example.com",
    "secretary_chativa_name": "מזכירה חטב", "secretary_chativa_email": "sc@example.com",
    "secretary_same_person": False, "principal_same_person": True,
    "meeting_coordinators": {
        "gefen_tichon": "secretary", "gefen_beinayim": "secretary_chativa",
        "current_tichon": "secretary", "current_beinayim": "secretary_chativa",
    },
}


def cond(service_type="gefen", roles=("meeting_coordinator",), scope=None):
    return {
        "type": "meeting", "meeting_service_type": service_type, "stage_scope": scope,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": list(roles), "meeting_type": "remote",
    }


def ranges_for(school, condition):
    advisors = {"gefen": ["a1"], "current": ["a2"], "district": ["a3"], "takuma": ["a1"]}
    durations = {"meeting_duration_gefen": 60, "meeting_duration_current": 60, "meeting_duration_district": 60}
    return tasks_router._build_meeting_ranges(school, [condition], advisors, durations)


def keys(r):
    return [p["key"] for p in r["participants"]]


@pytest.mark.parametrize("service_type,expected", [
    ("gefen", ["secretary"]), ("takuma", ["secretary"]), ("current", ["extra_0"]), ("district", ["finance_contact"]),
])
def test_resolves_the_coordinator_of_the_meeting_type(service_type, expected):
    assert keys(ranges_for(PLAIN, cond(service_type))[0]) == expected


def test_coordinator_who_is_also_a_chosen_role_is_invited_once():
    r = ranges_for(PLAIN, cond(roles=("secretary", "meeting_coordinator")))[0]
    assert keys(r) == ["secretary"]


def test_same_email_under_two_keys_is_invited_once():
    school = {**PLAIN, "principal_email": "s@example.com"}
    r = ranges_for(school, cond(roles=("principal", "meeting_coordinator")))[0]
    assert [p["email"] for p in r["participants"]] == ["s@example.com"]


def test_extra_contact_coordinator_keeps_its_role_label():
    p = ranges_for(PLAIN, cond("current"))[0]["participants"][0]
    assert p["name"] == "רכזת" and p["role_label"] == "רכזת פדגוגית" and p["email"] == "x@example.com"


def test_gefen_current_invites_both_coordinators():
    r = ranges_for(PLAIN, cond("gefen_current"))[0]
    assert keys(r) == ["secretary", "extra_0"]


def test_gefen_current_with_one_coordinator_for_both_is_one_person():
    school = {**PLAIN, "meeting_coordinators": {"gefen": "secretary", "current": "secretary"}}
    assert keys(ranges_for(school, cond("gefen_current"))[0]) == ["secretary"]


@pytest.mark.parametrize("scope,expected", [
    ("both", [["secretary", "secretary_chativa"]]),
    ("tichon", [["secretary"]]),
    ("chativa", [["secretary_chativa"]]),
    ("separate", [["secretary"], ["secretary_chativa"]]),
])
def test_six_year_division(scope, expected):
    assert [keys(r) for r in ranges_for(SIX_YEAR, cond(scope=scope))] == expected


def test_slot_without_coordinator_is_skipped():
    school = {**PLAIN, "meeting_coordinators": {}}
    assert ranges_for(school, cond(roles=("principal", "meeting_coordinator")))[0]["participants"][0]["key"] == "principal"
    assert not ranges_for(school, cond())  # nobody to invite → no range (the pre-check reports it)


def test_dedupe_participants_by_email_keeps_first_and_no_email_rows():
    rows = [
        {"key": "secretary", "email": "S@example.com"}, {"key": "principal", "email": "s@example.com "},
        {"key": "finance"}, {"key": "extra_0", "email": ""},
    ]
    assert [p["key"] for p in schools_router._dedupe_participants_by_email(rows)] == ["secretary", "finance", "extra_0"]


# --- the pre-check (TaskMeetingResolutionModal) ---

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
    def run(school, service_type="gefen_current"):
        db = _Db({
            "schools": [school],
            "school_advisors_gefen": [{"school_id": school["id"], "advisor_id": "a"}],
            "school_advisors_current": [{"school_id": school["id"], "advisor_id": "a"}],
            "school_year_admin_data": [{"school_id": school["id"], "meeting_duration_gefen": 60, "meeting_duration_current": 60}],
        })
        monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
        monkeypatch.setattr(tasks_router.task_logic, "find_matching_schools", lambda *a, **k: [{"school_id": school["id"]}])
        monkeypatch.setattr(tasks_router.task_logic, "opted_out_recipients", lambda *a, **k: {})
        monkeypatch.setattr(tasks_router, "_resolve_recipient_with_cascade", lambda *a, **k: {"recipient": {}})
        req = tasks_router.MeetingRequirementIn(meeting_service_type=service_type, participant_roles=["meeting_coordinator"])
        overrides = {school["id"]: {"gefen_current": {"coordinator_type": "gefen"}}}
        return tasks_router._check_meeting_problems("org", {}, None, [req], "email_resend", "תשפ\"ז", overrides)
    return run


def test_other_coordinator_without_email_is_a_fixable_participant_problem(run_check):
    school = {**PLAIN, "meeting_coordinators": {"gefen": "secretary", "current": "finance_contact"}, "finance_contact_email": None}
    entry = run_check(school)["schools"][0]
    assert entry["participants"]["roles"] == ["finance_contact"]
    assert entry["participants"]["role_labels"]["finance_contact"] == "מתאם פגישות [גפן+שוטף] — אחראי/ת כספים"
    assert tasks_router._has_blocking_meeting_problem(entry)


def test_extra_contact_coordinator_without_email_is_only_a_notice(run_check):
    extra = [{"name": "רכזת", "role": "רכזת פדגוגית", "email": None}]
    school = {**PLAIN, "extra_contacts": extra, "meeting_coordinators": {"gefen": "secretary", "current": "extra:0"}}
    res = run_check(school)
    entry = res["schools"][0]
    assert entry["participants"] is None
    assert entry["coordinator_missing_contact"][0]["name"] == "רכזת"
    assert not tasks_router._has_blocking_meeting_problem(entry) and res["ok_schools"] == 1
