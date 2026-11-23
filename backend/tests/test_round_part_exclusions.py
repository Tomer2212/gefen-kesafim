""""פגישה לא נדרשת בסבב" — meeting_rounds.part_exclusions {school_id: [part]}: the parts a round
doesn't need from one school are neither asked (sends, reminders, pre-check) nor counted (task
progress, round status), and requests already sent for them are removed from the links.
Fully offline."""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_rounds  # noqa: E402
import task_logic  # noqa: E402
from routers import tasks_router  # noqa: E402

PLAIN = {"id": "plain", "name": "רגיל", "stage": "yesodi", "principal_name": "מ", "principal_email": "m@example.com", "principal_phone": "4"}
DURATIONS = {"meeting_duration_gefen": 60, "meeting_duration_current": 90, "meeting_duration_district": 45}
X_GEFEN_Y_CURRENT = {"gefen": ["x"], "current": ["y"], "district": ["d"], "takuma": ["x"]}
X_BOTH = {"gefen": ["x"], "current": ["x"], "district": ["d"], "takuma": ["x"]}
YEAR = {"service_type": "gefen_current"}
NOW = "2026-12-05T10:00:00+00:00"


def cond(service_type="by_service", split="separate", parts=None, **extra):
    c = {
        "type": "meeting", "meeting_service_type": service_type, "gefen_current_split": split, "stage_scope": None,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "meeting_type": "remote", "explicit_stage_scope_only": True, **extra,
    }
    if parts is not None:
        c["school_part_exclusions"] = {"plain": parts, "another": ["current"]}
    return c


def school(advisors, same=False):
    return {**PLAIN, "advisor_gefen": advisors.get("gefen", []), "advisor_current": advisors.get("current", []),
            "advisor_district": advisors.get("district", []), "advisor_gefen_current_same": same}


def meeting(service_type, mid="m"):
    return {"id": mid, "school_id": "plain", "meeting_date": "2026-12-10", "meeting_service_type": service_type,
            "status": "scheduled", "stage_scope": None, "meeting_type": "remote", "booking_token_id": None}


def ranges_for(conditions, advisors, card, school_id="plain"):
    school_conds = tasks_router._school_meeting_conditions(conditions, advisors, card, school_id)
    if not school_conds:
        return school_conds
    return [(r["service_type"], r["advisor_ids"], r["duration_minutes"])
            for r in tasks_router._build_meeting_ranges(PLAIN, school_conds, advisors, DURATIONS)]


# --- what is asked ---

@pytest.mark.parametrize("split", ["separate", "combined"])
def test_gefen_not_needed_leaves_only_the_current_meeting(split):
    assert ranges_for([cond(split=split, parts=["gefen"])], X_GEFEN_Y_CURRENT, "gefen_current") == [("current", ["y"], 90)]


def test_same_advisor_combined_meeting_becomes_the_remaining_part():
    assert ranges_for([cond(parts=["current"])], X_BOTH, "gefen_current") == [("gefen", ["x"], 60)]


def test_only_this_school_is_affected():
    out = ranges_for([cond(parts=["gefen"])], X_GEFEN_Y_CURRENT, "gefen_current", school_id="third")
    assert sorted(out) == [("current", ["y"], 90), ("gefen", ["x"], 60)]


def test_nothing_needed_means_nothing_asked():
    conditions = [cond(parts=["gefen", "current"])]
    assert ranges_for(conditions, X_GEFEN_Y_CURRENT, "gefen_current") == []
    assert tasks_router._is_self_scheduled(conditions, tasks_router._school_meeting_conditions(
        conditions, X_GEFEN_Y_CURRENT, "gefen_current", "plain"))


def test_works_with_advisor_exclusions():
    c = cond(parts=["current"], advisor_exclusions={"x": ["gefen"]})
    assert ranges_for([c], X_GEFEN_Y_CURRENT, "gefen_current") == []


def test_creation_never_takes_the_map_from_the_body():
    c = cond("gefen", parts=["gefen"])
    tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [c]}]}, "org", {})
    assert "school_part_exclusions" not in c


def test_clean():
    assert task_logic.clean_part_exclusions(["current", "bogus", "gefen"]) == ["gefen", "current"]


# --- progress and the round ---

def test_progress_counts_only_the_needed_part():
    c = cond(parts=["gefen"])
    s = school(X_GEFEN_Y_CURRENT)
    res = task_logic._meeting_condition_result(c, s, [], YEAR, set())
    assert (res["ok"], res["required_count"], res["resolved_types"]) == (False, 1, ["current"])
    assert task_logic._meeting_condition_result(c, s, [meeting("current")], YEAR, set())["ok"] is True
    # A combined meeting held anyway counts for the part left of a combined request (with
    # "separate" each part is its own meeting, as without the exception).
    combined = cond(split="combined", parts=["gefen"])
    assert task_logic._meeting_condition_result(combined, s, [meeting("gefen_current")], YEAR, set())["ok"] is True


def test_progress_when_nothing_is_needed():
    c = cond(parts=["gefen", "current"])
    res = task_logic._meeting_condition_result(c, school(X_GEFEN_Y_CURRENT), [], YEAR, set())
    assert res["not_needed"] is True and res["ok"] is True and res["required_count"] == 0
    assert task_logic._resolve_condition(c, school(X_GEFEN_Y_CURRENT), [], YEAR) is True


def round_row(part_exclusions):
    return {"id": "r", "start_date": "2026-12-01", "end_date": "2026-12-31",
            "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "separate"},
            "part_exclusions": part_exclusions}


def status(part_exclusions, meetings=()):
    rc = meeting_rounds.round_condition(round_row(part_exclusions))
    return meeting_rounds.school_status(rc, school(X_GEFEN_Y_CURRENT), list(meetings), YEAR, set(), None, None, None, NOW)


def test_round_school_whose_other_part_is_booked_is_done():
    # The Eliran case: the שוטף meeting is booked and his גפן meeting isn't needed this round.
    row = status({"plain": ["gefen"]}, [meeting("current")])
    assert (row["status"], row["required_count"], row["booked_count"], row["needs_request"]) == ("booked", 1, 1, False)
    assert row["excluded_parts"] == ["gefen"]
    # Without the exception the same school still misses its גפן meeting.
    assert status({}, [meeting("current")])["status"] == "partial"


def test_round_school_needing_nothing():
    row = status({"plain": ["gefen", "current"]})
    assert (row["status"], row["required_count"], row["problem"], row["needs_request"]) == ("not_needed", 0, None, False)


def test_round_offers_every_card_part_whatever_is_excluded():
    row = status({"plain": ["gefen"]})
    assert row["part_options"] == [{"part": "gefen", "advisor_ids": ["x"]}, {"part": "current", "advisor_ids": ["y"]}]


# --- requests already sent ---

class _Query:
    def __init__(self, db, rows):
        self.db, self.rows, self.patch = db, rows, None

    def select(self, *_a, **_k):
        return self

    def update(self, patch):
        self.patch = patch
        return self

    def eq(self, key, value):
        self.rows = [r for r in self.rows if r.get(key) == value]
        return self

    def execute(self):
        if self.patch is not None:
            for r in self.rows:
                r.update(self.patch)
                self.db.updates.append((r["id"], dict(self.patch)))
        return type("R", (), {"data": self.rows})()


class _FakeDb:
    def __init__(self, tokens):
        self.tokens, self.updates = tokens, []

    def table(self, _name):
        return _Query(self, self.tokens)


def rng(key, service_type):
    return {"key": key, "service_type": service_type, "advisor_ids": ["x"]}


def test_sent_requests_for_a_part_not_needed_are_removed():
    tokens = [
        {"id": "t1", "task_id": "task", "school_id": "plain", "closed_message": None, "booked_ranges": ["r1"],
         "date_ranges": [rng("r0", "gefen"), rng("r1", "gefen"), rng("r2", "current")]},
        {"id": "t2", "task_id": "task", "school_id": "plain", "closed_message": None, "booked_ranges": [],
         "date_ranges": [rng("r0", "gefen_current")]},
        {"id": "t3", "task_id": "task", "school_id": "another", "closed_message": None, "booked_ranges": [],
         "date_ranges": [rng("r0", "gefen")]},
    ]
    db = _FakeDb(tokens)
    removed = tasks_router._drop_self_scheduled_ranges(db, "task", {}, {"plain": ["gefen"]}, "plain")
    assert removed == 2
    # A booked request stays (it records what was booked); the שוטף request stays.
    assert [r["key"] for r in tokens[0]["date_ranges"]] == ["r1", "r2"] and not tokens[0]["closed_message"]
    # The combined request goes, and its link has nothing left — closed.
    assert tokens[1]["date_ranges"] == [] and tokens[1]["closed_message"] == tasks_router.NOT_NEEDED_LINK_CLOSED_MESSAGE
    # Another school's link is untouched.
    assert len(tokens[2]["date_ranges"]) == 1


def test_self_scheduled_removal_keeps_its_message():
    tokens = [{"id": "t1", "task_id": "task", "school_id": "plain", "closed_message": None, "booked_ranges": [],
               "date_ranges": [rng("r0", "gefen")]}]
    assert tasks_router._drop_self_scheduled_ranges(_FakeDb(tokens), "task", {"x": ["all"]}) == 1
    assert tokens[0]["closed_message"] == tasks_router.SELF_SCHEDULED_LINK_CLOSED_MESSAGE
