"""תוכנית פגישות (meeting_plan.py) — cleaning, even spreading, and what a period of a round
covers. Fully offline."""
import sys
from datetime import date
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_plan  # noqa: E402

YEAR = "תשפ\"ז"  # Sep 2026 – Aug 2027


def test_spread_matches_the_org_rhythms():
    assert meeting_plan.spread(12) == {m: 1 for m in meeting_plan.ACADEMIC_MONTHS}
    assert meeting_plan.spread(6) == {"09": 1, "11": 1, "01": 1, "03": 1, "05": 1, "07": 1}
    # One per quarter, in the quarter's first month.
    assert meeting_plan.spread(4) == {"09": 1, "12": 1, "03": 1, "06": 1}
    assert meeting_plan.spread(3) == {"09": 1, "01": 1, "05": 1}
    assert meeting_plan.spread(1) == {"09": 1}


def test_spread_handles_odd_and_empty_allocations():
    assert sum(meeting_plan.spread(10).values()) == 10
    assert sum(meeting_plan.spread(24).values()) == 24
    assert meeting_plan.spread(24)["09"] == 2
    assert meeting_plan.spread(4.0) == meeting_plan.spread(4)
    assert meeting_plan.spread(None) == {}
    assert meeting_plan.spread(0) == {}
    assert meeting_plan.spread("abc") == {}


def test_normalize_drops_empty_and_unknown():
    assert meeting_plan.normalize_plan(None) is None
    assert meeting_plan.normalize_plan({}) is None
    assert meeting_plan.normalize_plan({"gefen": {"09": 0, "10": ""}}) is None
    assert meeting_plan.normalize_plan({"gefen": {"09": "2", "13": 1}, "other": {"09": 1}}) == {"gefen": {"09": 2}}
    assert meeting_plan.normalize_plan({"current": {"01": 50}}) == {"current": {"01": meeting_plan.MAX_PER_MONTH}}


def test_normalize_rejects_bad_counts():
    with pytest.raises(ValueError):
        meeting_plan.normalize_plan({"gefen": {"09": "x"}})
    with pytest.raises(ValueError):
        meeting_plan.normalize_plan({"gefen": {"09": -1}})
    # A malformed value is rejected, never turned into "clear the plan".
    for bad in ([1, 2], "plan", {"gefen": [1]}, {"physical": ["09"]}, {"gefen": {"09": 1}, "physical": {"gefen": "09"}}):
        with pytest.raises(ValueError):
            meeting_plan.normalize_plan(bad)


def test_physical_marks_stay_only_on_months_with_a_meeting():
    plan = meeting_plan.normalize_plan({
        "gefen": {"09": 1, "12": 1},
        "physical": {"gefen": ["12", "01"], "current": ["09"]},
    })
    assert plan == {"gefen": {"09": 1, "12": 1}, "physical": {"gefen": ["12"]}}
    assert meeting_plan.physical_months(plan, "gefen") == ["12"]
    assert meeting_plan.physical_months(plan, "current") == []
    # Removing the month's meeting drops its mark too.
    assert meeting_plan.normalize_plan({"gefen": {"12": 0}, "physical": {"gefen": ["12"]}}) is None


def test_month_bounds_cross_the_calendar_year():
    assert meeting_plan.month_date(YEAR, "09") == date(2026, 9, 1)
    assert meeting_plan.month_date(YEAR, "02") == date(2027, 2, 1)
    assert meeting_plan.month_end(YEAR, "02") == date(2027, 2, 28)
    assert meeting_plan.month_end(YEAR, "12") == date(2026, 12, 31)


def test_quarter_round_sees_the_missed_september_meeting():
    # Allocation 4 → one per quarter. A round for Dec–Feb: September's meeting was due before
    # it, December's is inside it.
    plan = {"gefen": meeting_plan.spread(4)}
    start, end = date(2026, 12, 1), date(2027, 2, 28)
    assert meeting_plan.planned_before(plan, "gefen", YEAR, start) == 1
    assert meeting_plan.planned_in(plan, "gefen", YEAR, start, end) == 1


def test_a_month_already_started_still_belongs_to_the_round():
    plan = {"gefen": {"12": 1}}
    start, end = date(2026, 12, 15), date(2027, 1, 31)
    assert meeting_plan.planned_before(plan, "gefen", YEAR, start) == 0
    assert meeting_plan.planned_in(plan, "gefen", YEAR, start, end) == 1


def test_type_total():
    plan = {"gefen": {"09": 1, "12": 2}}
    assert meeting_plan.type_total(plan, "gefen") == 3
    assert meeting_plan.type_total(plan, "current") == 0
    assert meeting_plan.type_total(None, "gefen") == 0


def test_year_admin_model_cleans_the_plan():
    from pydantic import ValidationError
    from routers.schools_router import SchoolYearAdminDataIn

    body = SchoolYearAdminDataIn(meeting_plan={"gefen": {"09": 1, "10": 0}, "bogus": {"09": 1}})
    assert body.meeting_plan == {"gefen": {"09": 1}}
    assert SchoolYearAdminDataIn(meeting_plan={}).meeting_plan is None
    assert "meeting_plan" in SchoolYearAdminDataIn(meeting_plan=None).model_fields_set
    with pytest.raises(ValidationError):
        SchoolYearAdminDataIn(meeting_plan={"gefen": {"09": "abc"}})
