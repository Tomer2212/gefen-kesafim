""""יועצים שקובעים לעצמם" — advisor_exclusions on a meeting condition: only the parts of a meeting
that belong to an excluded advisor are dropped, the rest is still requested. Fully offline.
"""
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
X_Z_GEFEN = {"gefen": ["x", "z"], "current": ["y"], "district": ["d"], "takuma": ["x", "z"]}


def cond(service_type="by_service", split="separate", exclusions=None, **extra):
    c = {
        "type": "meeting", "meeting_service_type": service_type, "gefen_current_split": split, "stage_scope": None,
        "date_segments": [{"date_from": "2026-12-01", "date_to": "2026-12-31"}],
        "participant_roles": ["principal"], "meeting_type": "remote", "explicit_stage_scope_only": True, **extra,
    }
    if exclusions is not None:
        c["advisor_exclusions"] = exclusions
    return c


def ranges_for(conditions, advisors, card):
    school_conds = tasks_router._school_meeting_conditions(conditions, advisors, card)
    if not school_conds:
        return school_conds
    return [(r["service_type"], r["advisor_ids"], r["duration_minutes"])
            for r in tasks_router._build_meeting_ranges(PLAIN, school_conds, advisors, DURATIONS)]


# --- the rule ---

@pytest.mark.parametrize("split", ["separate", "combined"])
def test_excluded_gefen_advisor_leaves_only_the_current_meeting(split):
    out = ranges_for([cond(split=split, exclusions={"x": ["gefen"]})], X_GEFEN_Y_CURRENT, "gefen_current")
    assert out == [("current", ["y"], 90)]


def test_explicit_gefen_current_task_is_reduced_too():
    out = ranges_for([cond("gefen_current", exclusions={"x": ["gefen"]})], X_GEFEN_Y_CURRENT, None)
    assert out == [("current", ["y"], 90)]


def test_same_advisor_on_both_sides_excluded_from_gefen_gets_current_only():
    out = ranges_for([cond(exclusions={"x": ["gefen"]})], X_BOTH, "gefen_current")
    assert out == [("current", ["x"], 90)]


def test_other_gefen_advisor_still_gets_the_gefen_meeting():
    out = ranges_for([cond("gefen", exclusions={"x": ["gefen"]})], X_Z_GEFEN, None)
    assert out == [("gefen", ["z"], 60)]


def test_gefen_and_current_exclusion_covers_the_combined_meeting():
    assert ranges_for([cond(exclusions={"x": ["gefen", "current"]})], X_BOTH, "gefen_current") == []


def test_all_types():
    assert ranges_for([cond("district", exclusions={"d": ["all"]})], X_GEFEN_Y_CURRENT, None) == []
    assert ranges_for([cond("takuma", exclusions={"x": ["all"]})], X_GEFEN_Y_CURRENT, None) == []


def test_exclusion_of_another_type_changes_nothing():
    out = ranges_for([cond("district", exclusions={"x": ["gefen"]})], X_GEFEN_Y_CURRENT, None)
    assert out == [("district", ["d"], 45)]
    out = ranges_for([cond("takuma", exclusions={"x": ["gefen"]})], X_GEFEN_Y_CURRENT, None)
    assert out == [("takuma", ["x"], 60)]  # takuma is its own type in the exclusion list


def test_a_part_with_no_advisor_on_the_card_stays_for_the_pre_check():
    out = task_logic.apply_advisor_exclusions(cond("gefen_current", exclusions={"x": ["gefen"]}), {"gefen": ["x"], "current": []})
    assert [c["meeting_service_type"] for c in out] == ["current"]
    out = task_logic.apply_advisor_exclusions(cond("gefen", exclusions={"x": ["current"]}), {})
    assert [c["meeting_service_type"] for c in out] == ["gefen"]


def test_no_exclusions_changes_nothing():
    c = cond("gefen")
    assert task_logic.apply_advisor_exclusions(c, X_GEFEN_Y_CURRENT) == [c]
    assert tasks_router._school_meeting_conditions([c], X_GEFEN_Y_CURRENT, None) == [c]


def test_manual_advisor_list():
    out = task_logic.apply_advisor_exclusions(
        cond("gefen", exclusions={"x": ["gefen"]}, advisor_mode="manual", advisor_ids=["x", "q"]), {})
    assert out[0]["advisor_ids"] == ["q"]
    assert task_logic.apply_advisor_exclusions(
        cond("gefen", exclusions={"x": ["gefen"]}, advisor_mode="manual", advisor_ids=["x"]), {}) == []


def test_self_scheduled_school():
    conditions = [cond(exclusions={"x": ["all"]})]
    school_conds = tasks_router._school_meeting_conditions(conditions, X_BOTH, "gefen_current")
    assert tasks_router._is_self_scheduled(conditions, school_conds)
    # A missing service type is not "self scheduled".
    assert not tasks_router._is_self_scheduled(conditions, tasks_router._school_meeting_conditions(conditions, X_BOTH, None))


def test_clean():
    assert task_logic.clean_advisor_exclusions(
        {"x": ["current", "gefen", "bogus"], "y": ["all", "gefen"], "z": [], "other": ["gefen"]}, {"x", "y", "z"},
    ) == {"x": ["gefen", "current"], "y": ["all"]}
    assert task_logic.clean_advisor_exclusions(None) == {}


def test_creation_stamps_the_task_list_and_ignores_body_fields():
    c = cond("gefen", exclude_advisor_ids=["evil"], also_matches_types=["district"])
    tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [c]}]}, "org", {"x": ["gefen"]})
    assert c["advisor_exclusions"] == {"x": ["gefen"]}
    assert "exclude_advisor_ids" not in c and "also_matches_types" not in c
    c2 = cond("gefen", exclusions={"x": ["gefen"]})
    tasks_router._prepare_meeting_conditions({"groups": [{"conditions": [c2]}]}, "org", {})
    assert "advisor_exclusions" not in c2


# --- progress ---

def school(advisors, same=False):
    return {**PLAIN, "advisor_gefen": advisors.get("gefen", []), "advisor_current": advisors.get("current", []),
            "advisor_district": advisors.get("district", []), "advisor_gefen_current_same": same}


def meeting(service_type, mid="m"):
    return {"id": mid, "school_id": "plain", "meeting_date": "2026-12-10", "meeting_service_type": service_type,
            "status": "scheduled", "stage_scope": None, "meeting_type": "remote", "booking_token_id": None}


def test_progress_counts_only_what_is_left():
    c = cond(split="separate", exclusions={"x": ["gefen"]})
    s = school(X_GEFEN_Y_CURRENT)
    res = task_logic._meeting_condition_result(c, s, [], {"service_type": "gefen_current"}, set())
    assert (res["ok"], res["required_count"], res["resolved_types"]) == (False, 1, ["current"])
    res = task_logic._meeting_condition_result(c, s, [meeting("current")], {"service_type": "gefen_current"}, set())
    assert res["ok"] is True


def test_a_combined_meeting_counts_for_the_reduced_part():
    c = cond("gefen_current", exclusions={"x": ["gefen"]})
    s = school(X_GEFEN_Y_CURRENT)
    assert task_logic._meeting_condition_result(c, s, [meeting("gefen_current")], {}, set())["ok"] is True
    # Without exclusions a plain current condition still ignores a combined meeting.
    assert task_logic._meeting_condition_result(cond("current"), s, [meeting("gefen_current")], {}, set())["ok"] is False


def test_progress_of_a_self_scheduled_school():
    c = cond(exclusions={"x": ["all"]})
    res = task_logic._meeting_condition_result(c, school(X_BOTH, same=True), [], {"service_type": "gefen_current"}, set())
    assert res["self_scheduled"] is True and res["ok"] is True and res["required_count"] == 0
    assert task_logic._resolve_condition(c, school(X_BOTH, same=True), [], {"service_type": "gefen_current"}) is True


# --- rounds ---

def round_row(exclusions):
    return {"id": "r", "start_date": "2026-12-01", "end_date": "2026-12-31",
            "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "separate"},
            "advisor_exclusions": exclusions}


def test_round_status_self_scheduled():
    rc = meeting_rounds.round_condition(round_row({"x": ["all"]}))
    row = meeting_rounds.school_status(rc, school(X_BOTH, same=True), [], {"service_type": "gefen_current"}, set(),
                                       None, None, None, "2026-12-05")
    assert (row["status"], row["required_count"], row["problem"]) == ("self_scheduled", 0, None)


def test_round_reduced_school_lists_only_the_remaining_advisor():
    rc = meeting_rounds.round_condition(round_row({"x": ["gefen"]}))
    row = meeting_rounds.school_status(rc, school(X_GEFEN_Y_CURRENT), [], {"service_type": "gefen_current"}, set(),
                                       None, None, None, "2026-12-05")
    assert (row["status"], row["required_types"], row["advisor_ids"]) == ("untouched", ["current"], ["y"])
