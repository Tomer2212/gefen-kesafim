""""יומן יעיל" (slot_policy) — the examples agreed with the product owner, plus edge cases."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import slot_policy  # noqa: E402

DAY = (8 * 60, 16 * 60)
H = 60


def h(text):
    return slot_policy.parse_hhmm(text)


def busy(*ranges):
    return [(h(s), h(e)) for s, e in ranges]


def allowed(events, duration, x=120, grid=60, **more_advisors):
    by_advisor = {"a": busy(*events), **{k: busy(*v) for k, v in more_advisors.items()}}
    return [(slot_policy.hhmm(s), slot_policy.hhmm(e))
            for s, e in slot_policy.allowed_slots(by_advisor, *DAY, duration, x, grid)]


def test_owner_example_two_hour_meeting():
    assert allowed([("10:00", "11:00"), ("13:00", "15:00")], 2 * H) == [("08:00", "10:00"), ("11:00", "13:00")]


def test_owner_example_closest_to_request():
    offer = slot_policy.offer_for_day({"a": busy(("10:00", "11:00"), ("13:00", "15:00"))}, *DAY, 2 * H, 120, 60,
                                      requested=(h("12:00"), h("14:00")))
    assert offer["regular"] == [(h("08:00"), h("10:00"))]
    assert offer["requested"] == [{"slot": (h("11:00"), h("13:00")), "near": True}]


def test_one_hour_goes_after_the_noon_event_not_at_eight():
    assert allowed([("12:00", "13:00")], H)[0] == ("13:00", "14:00")


def test_existing_hole_is_filled():
    assert allowed([("08:00", "10:00"), ("11:00", "16:00")], H) == [("10:00", "11:00")]


def test_two_and_a_half_hour_gap_takes_a_two_hour_meeting():
    assert ("10:00", "12:00") in allowed([("08:00", "10:00"), ("12:30", "16:00")], 2 * H)


def test_empty_day_one_hour_never_locks_a_single_hour():
    assert allowed([], H) == [("08:00", "09:00"), ("10:00", "11:00"), ("11:00", "12:00"),
                              ("12:00", "13:00"), ("13:00", "14:00"), ("15:00", "16:00")]


def test_after_eight_to_nine_windows_float():
    # Each one still leaves three two-hour windows, just at other hours.
    assert allowed([("08:00", "09:00")], H) == [("09:00", "10:00"), ("11:00", "12:00"), ("13:00", "14:00"), ("15:00", "16:00")]


def test_ten_to_twelve_booked():
    assert allowed([("10:00", "12:00")], H) == [("12:00", "13:00"), ("15:00", "16:00")]


def test_no_limit_is_plain_earliest():
    assert allowed([("08:00", "08:30")], H, x=0)[0] == ("08:30", "09:30")


def test_touching_an_event_is_allowed_off_the_round_hour():
    assert allowed([("08:00", "10:30")], H, x=0, grid=60)[0] == ("10:30", "11:30")


def test_each_advisor_calendar_counts_separately():
    # Advisor b is busy 08-09, so 09-10 is free for both — but on a's calendar (event at 12-13)
    # it would lock 08-09, so the shared offer follows both calendars, not their union.
    result = allowed([("12:00", "13:00")], H, b=[("08:00", "09:00")])
    assert result and all(s >= "09:00" for s, _ in result)
    assert ("13:00", "14:00") in result


def test_request_with_no_allowed_time_nearby():
    offer = slot_policy.offer_for_day({"a": busy(("08:00", "10:00"), ("11:00", "16:00"))}, *DAY, H, 120, 60,
                                      requested=(h("14:00"), h("15:00")))
    assert offer["regular"] == [(h("10:00"), h("11:00"))]
    assert offer["requested"] == []


def test_request_inside_is_not_marked_near():
    offer = slot_policy.offer_for_day({"a": []}, *DAY, H, 120, 60, requested=(h("11:00"), h("13:00")))
    assert offer["requested"] == [{"slot": (h("11:00"), h("12:00")), "near": False}]


def test_booking_check():
    events = {"a": busy(("12:00", "13:00"))}
    assert slot_policy.is_allowed(events, *DAY, H, 120, 60, h("13:00"), h("14:00"))
    assert not slot_policy.is_allowed(events, *DAY, H, 120, 60, h("09:00"), h("10:00"))
    assert not slot_policy.is_allowed(events, *DAY, H, 120, 60, h("13:00"), h("14:30"))  # wrong length


def test_day_intervals_clip_multi_day_events():
    blocks = [
        {"start": "2026-12-01T00:00:00.0000000", "end": "2026-12-02T00:00:00.0000000"},
        {"start": "2026-11-30T15:00:00", "end": "2026-12-01T09:00:00"},
        {"start": "2026-12-02T09:00:00", "end": "2026-12-02T10:00:00"},
    ]
    assert slot_policy.day_intervals("2026-12-01", blocks) == [(0, 24 * 60), (0, 9 * 60)]
