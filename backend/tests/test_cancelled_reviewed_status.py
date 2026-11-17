""""בוטלה ונבדקה" (cancelled_reviewed) must behave exactly like "בוטלה" — above all in the
calendar sync (event stays free, attendees cleared, subject "[בוטלה]") — while "בוטלה",
"נדחתה" and "נקבעה" keep their existing behavior.

Fully offline: Graph and the Supabase client are faked; nothing real is read or written.
"""
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import graph_client  # noqa: E402
import meeting_activity  # noqa: E402
from meeting_labels import calendar_status_label, is_cancelled_like, normalize_meeting_status  # noqa: E402
from routers import schools_router  # noqa: E402


@pytest.mark.parametrize("raw, expected", [
    ("בוטלה ונבדקה", "cancelled_reviewed"),
    ("בוטל ונבדק", "cancelled_reviewed"),
    ("cancelled_reviewed", "cancelled_reviewed"),
    ("בוטלה - לא נבדקה", "cancelled"),
    ("בוטלה, טרם נבדקה", "cancelled"),
    ("בוטלה", "cancelled"),
    ("ביטול", "cancelled"),
    ("נדחתה", "postponed"),
    ("נקבעה", "scheduled"),
    ("בוצעה", "completed"),
])
def test_import_status_normalization(raw, expected):
    assert normalize_meeting_status(raw) == expected


def test_cancelled_like_and_calendar_label():
    assert is_cancelled_like("cancelled")
    assert is_cancelled_like("cancelled_reviewed")
    assert is_cancelled_like("postponed")
    assert not is_cancelled_like("scheduled")
    assert not is_cancelled_like("completed")
    assert not is_cancelled_like("other")
    assert calendar_status_label("cancelled_reviewed") == "בוטלה"
    assert calendar_status_label("cancelled") == "בוטלה"
    assert calendar_status_label("postponed") == "נדחתה"


class _FakeDB:
    """Returns one meeting row for any select; ignores writes."""

    def __init__(self, row):
        self.row = row

    def table(self, name):
        db = self

        class _Q:
            def __getattr__(self, _):
                return lambda *a, **k: self

            def execute(self):
                return type("R", (), {"data": [dict(db.row)]})()

        return _Q()


@pytest.fixture
def sync_calls(monkeypatch):
    calls = []

    @contextmanager
    def fake_lock(db, meeting_id):
        yield True

    def fake_update(db, org_id, meeting, previous_sync, subject, show_as=None, clear_attendees=False):
        calls.append({"subject": subject, "show_as": show_as, "clear_attendees": clear_attendees})
        return {}

    monkeypatch.setattr(graph_client, "calendar_sync_lock", fake_lock)
    monkeypatch.setattr(graph_client, "sync_meeting_update", fake_update)
    monkeypatch.setattr(graph_client, "persist_calendar_sync", lambda *a, **k: None)
    monkeypatch.setattr(meeting_activity, "fetch_tracked", lambda *a, **k: None)
    monkeypatch.setattr(meeting_activity, "log_meeting_activity", lambda *a, **k: None)
    monkeypatch.setattr(schools_router, "_build_meeting_subject", lambda *a, **k: "S")
    return calls


@pytest.mark.parametrize("status, subject, show_as, cleared", [
    ("cancelled_reviewed", "[בוטלה] S", "free", True),
    ("cancelled", "[בוטלה] S", "free", True),
    ("postponed", "[נדחתה] S", "free", True),
    ("scheduled", "S", "busy", False),
    ("completed", "S", "busy", False),
])
def test_calendar_sync_on_status_patch(sync_calls, status, subject, show_as, cleared):
    db = _FakeDB({"id": "m1", "school_id": "s1", "status": status, "calendar_sync": {"a1": {}}})
    schools_router._apply_meeting_patch(db, "org-1", "s1", "m1", {"status": status})
    assert sync_calls == [{"subject": subject, "show_as": show_as, "clear_attendees": cleared}]
