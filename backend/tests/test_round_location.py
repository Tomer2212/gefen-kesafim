""""סבבי פגישות" — where each school's still-missing meeting is held, per part (location_need),
whether anyone asked for it (needs_request), and each part's own advisors and counts (parts).
Regression for the December 2026 round: a physical גפן+שוטף school whose visiting שוטף advisor
had already booked was skipped by the remote task, so its remote גפן meeting was never requested.
Fully offline."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_rounds  # noqa: E402

NOW = "2026-12-05T10:00:00+00:00"
SCHOOL = {"id": "s1", "name": "א", "stage": "yesodi", "advisor_gefen": ["g"], "advisor_current": ["c"],
          "advisor_district": [], "advisor_gefen_current_same": False}
ROUND = {"id": "r1", "org_id": "o", "academic_year": "תשפ\"ז", "start_date": "2026-12-01", "end_date": "2026-12-31",
         "requirement": {"meeting_service_type": "by_service", "gefen_current_split": "separate", "count_per_school": 1}}
YEAR = {"service_type": "gefen_current"}
SENT = {"task_id": "t", "status": "sent", "sent_at": "2026-11-12T09:00:00+00:00", "booking_token_id": "k"}
LIVE_TOKEN = {"first_viewed_at": None, "expires_at": "2027-01-01"}


def meeting(service_type, mid, meeting_type="remote"):
    return {"id": mid, "school_id": "s1", "meeting_date": "2026-12-16", "meeting_service_type": service_type,
            "status": "scheduled", "stage_scope": None, "meeting_type": meeting_type, "booking_token_id": None}


def status(meetings=(), msg=None, token=None, physical=False, visitors=None, exempt=None):
    cond = meeting_rounds.round_condition(ROUND)
    return meeting_rounds.school_status(cond, SCHOOL, list(meetings), YEAR, set(), msg, token, None, NOW,
                                        None, None, physical, visitors, exempt)


def test_physical_school_with_visiting_part_booked_needs_a_remote_meeting():
    # Only the שוטף advisor visits, and her meeting is booked: the גפן meeting left is remote.
    row = status([meeting("current", "m1", "physical")], physical=True, visitors=["c"])
    assert row["status"] == "partial"
    assert row["location_need"] == "remote"
    assert row["needs_request"] is True


def test_missing_visiting_part_keeps_the_school_physical():
    row = status([meeting("gefen", "m1")], physical=True, visitors=["c"])
    assert row["location_need"] == "physical"
    # Both missing: one of them is in person, so the physical task asks for both.
    assert status(physical=True, visitors=["c"])["location_need"] == "physical"


def test_exempt_advisor_doesnt_visit():
    assert status(physical=True, exempt={"g", "c"})["location_need"] == "remote"
    assert status(physical=True, exempt={"g"})["location_need"] == "physical"


def test_remote_school_and_nothing_missing():
    assert status()["location_need"] == "remote"
    done = status([meeting("gefen", "m1"), meeting("current", "m2")], physical=True)
    assert done["location_need"] is None and done["needs_request"] is False


def test_live_request_means_no_warning():
    row = status([meeting("current", "m1")], msg=SENT, token=LIVE_TOKEN)
    assert row["status"] == "partial" and row["needs_request"] is False
    expired = status([meeting("current", "m1")], msg=SENT, token={**LIVE_TOKEN, "expires_at": "2026-12-01"})
    assert expired["needs_request"] is True


def test_parts_credit_each_advisor_only_with_their_meeting():
    row = status([meeting("current", "m1")])
    parts = {p["type"]: p for p in row["parts"]}
    assert parts["gefen"]["advisor_ids"] == ["g"] and (parts["gefen"]["required"], parts["gefen"]["booked"]) == (1, 0)
    assert parts["current"]["advisor_ids"] == ["c"] and (parts["current"]["required"], parts["current"]["booked"]) == (1, 1)
    assert sum(p["required"] for p in row["parts"]) == row["required_count"]
    assert sum(p["booked"] for p in row["parts"]) == row["booked_count"]
