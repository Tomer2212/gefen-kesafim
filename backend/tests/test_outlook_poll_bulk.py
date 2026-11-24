"""Regression tests for the bulk Outlook reconciliation poll: the per-advisor calendarView
listing must reach exactly the same decisions as the old per-meeting get_event loop, and
must never cancel a meeting on inconclusive evidence (a failed or partial listing, or an
event merely absent from a listing).

Fully offline: Graph and the Supabase client are faked; nothing real is read or written.
"""
import sys
from pathlib import Path

from contextlib import contextmanager

import httpx
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import graph_client  # noqa: E402
from routers import schools_router  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402

ORG = "org-1"
EV_A, EV_B = "event-a", "event-b"
OUTLOOK_SAME = {"start": "2026-11-05T09:00:00.0000000", "end": "2026-11-05T10:00:00.0000000", "subject": "s"}
OUTLOOK_MOVED = {"start": "2026-11-06T11:30:00.0000000", "end": "2026-11-06T12:30:00.0000000", "subject": "s"}


class _FakeDB(FakeDb):
    """Records the meeting updates made by the reconciliation itself."""

    def __init__(self, meeting=None):
        meeting = meeting or _meeting({"adv1": {"external_event_id": EV_A}})
        super().__init__({"meetings": [meeting], "profiles": [
            {"id": a, "org_id": ORG, "full_name": a} for a in ("adv1", "adv2", "adv3")]})

    @property
    def updates(self):
        row = self.tables["meetings"][0]
        base = _meeting(None)
        return {k: row[k] for k in ("status", "meeting_date", "start_time", "end_time") if row[k] != base[k]}


def _meeting(sync):
    return {"id": "m1", "school_id": "s1", "meeting_date": "2026-11-05",
            "start_time": "09:00", "end_time": "10:00", "status": "scheduled", "calendar_sync": sync,
            "advisor_ids": list(sync or {})}


class _Calls(list):
    """The event ids get_event was called with; .answers maps event id -> canned result
    (default: EVENT_CHECK_SKIPPED, i.e. an inconclusive check)."""

    def __init__(self):
        super().__init__()
        self.answers = {}


@pytest.fixture
def get_event_calls(monkeypatch):
    calls = _Calls()

    def fake_get_event(db, org_id, advisor_id, event_id):
        calls.append(event_id)
        return calls.answers.get(event_id, graph_client.EVENT_CHECK_SKIPPED)

    monkeypatch.setattr(graph_client, "get_event", fake_get_event)
    monkeypatch.setattr(graph_client, "persist_calendar_sync",
                        lambda db, mid, sync: db.table("meetings").update({"calendar_sync": sync}).eq("id", mid).execute())

    @contextmanager
    def fake_lock(db, meeting_id):
        yield True

    monkeypatch.setattr(graph_client, "calendar_sync_lock", fake_lock)
    monkeypatch.setattr(graph_client, "mailbox_changed", lambda *a: False)
    monkeypatch.setattr(schools_router.meeting_activity, "log_meeting_activity", lambda *a, **k: None)
    return calls


def test_found_unchanged_is_noop_without_extra_graph_call(get_event_calls):
    db = _FakeDB()
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}), prefetched={"adv1": {EV_A: OUTLOOK_SAME}})
    assert r["action"] == "none" and not db.updates and get_event_calls == []


def test_found_moved_updates_meeting(get_event_calls):
    db = _FakeDB()
    get_event_calls.answers[EV_A] = OUTLOOK_MOVED  # read again under the lock
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}), prefetched={"adv1": {EV_A: OUTLOOK_MOVED}})
    assert r["action"] == "updated"
    assert db.updates == {"meeting_date": "2026-11-06", "start_time": "11:30", "end_time": "12:30"}
    assert db.tables["meetings"][0]["auto_complete_blocked"] is False


def test_failed_listing_is_skipped_never_cancelled(get_event_calls):
    db = _FakeDB()
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}), prefetched={"adv1": None})
    assert r["action"] == "skipped" and not db.updates and get_event_calls == []


def test_absent_from_listing_is_confirmed_individually_before_cancel(get_event_calls):
    db = _FakeDB()
    get_event_calls.answers[EV_A] = None  # get_event confirms it's gone
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}), prefetched={"adv1": {}})
    assert get_event_calls == [EV_A, EV_A]
    assert r["action"] == "cancelled" and db.updates == {"status": "cancelled"}


def test_absent_from_listing_but_still_exists_elsewhere_updates_not_cancels(get_event_calls):
    """Event moved outside the listing window: absent from the listing, but get_event finds it."""
    db = _FakeDB()
    get_event_calls.answers[EV_A] = OUTLOOK_MOVED
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}), prefetched={"adv1": {}})
    assert r["action"] == "updated"


def test_absent_and_get_event_inconclusive_is_skipped(get_event_calls):
    db = _FakeDB()
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}), prefetched={"adv1": {}})
    assert r["action"] == "skipped" and not db.updates


def test_multi_advisor_deleting_removes_only_that_advisor(get_event_calls):
    m = _meeting({"adv1": {"external_event_id": EV_A}, "adv2": {"external_event_id": EV_B}})
    db = _FakeDB(m)
    get_event_calls.answers.update({EV_A: None, EV_B: OUTLOOK_SAME})
    r = schools_router._reconcile_meeting_from_outlook(
        db, ORG, m, prefetched={"adv1": {}, "adv2": {EV_B: OUTLOOK_SAME}})
    assert r["action"] == "advisor_removed" and not db.updates
    row = db.tables["meetings"][0]
    assert row["advisor_ids"] == ["adv2"] and list(row["calendar_sync"]) == ["adv2"]


def test_multi_advisor_confirmed_deletion_not_held_back_by_a_failed_listing(get_event_calls):
    m = _meeting({"adv1": {"external_event_id": EV_A}, "adv2": {"external_event_id": EV_B}})
    db = _FakeDB(m)
    get_event_calls.answers[EV_A] = None
    r = schools_router._reconcile_meeting_from_outlook(db, ORG, m, prefetched={"adv1": {}, "adv2": None})
    assert r["action"] == "advisor_removed" and db.tables["meetings"][0]["advisor_ids"] == ["adv2"]


def test_webhook_path_without_prefetch_is_unchanged(get_event_calls):
    db = _FakeDB()
    get_event_calls.answers[EV_A] = OUTLOOK_SAME
    r = schools_router._reconcile_meeting_from_outlook(db, ORG, _meeting({"adv1": {"external_event_id": EV_A}}))
    assert r["action"] == "none" and get_event_calls == [EV_A]


# ---------------------------------------------------------------------------
# graph_client.list_events_in_range
# ---------------------------------------------------------------------------

def _graph_event(eid, cancelled=False):
    return {"id": eid, "subject": "s", "isCancelled": cancelled,
            "start": {"dateTime": OUTLOOK_SAME["start"]}, "end": {"dateTime": OUTLOOK_SAME["end"]}}


@pytest.fixture
def graph_pages(monkeypatch):
    monkeypatch.setattr(graph_client, "_get_app_only_token", lambda db, org: "tok")
    monkeypatch.setattr(graph_client, "_resolve_advisor_email", lambda db, org, adv: "a@example.com")
    pages = []

    def fake_request(method, url, **kwargs):
        page = pages.pop(0)
        if isinstance(page, Exception):
            raise page
        return httpx.Response(200, json=page, request=httpx.Request(method, url))

    monkeypatch.setattr(graph_client, "_request_with_retry", fake_request)
    return pages


def test_listing_follows_pages_and_maps_cancelled_to_none(graph_pages):
    graph_pages += [
        {"value": [_graph_event(EV_A)], "@odata.nextLink": "https://next"},
        {"value": [_graph_event(EV_B, cancelled=True)]},
    ]
    res = graph_client.list_events_in_range(None, ORG, "adv1", "x", "y")
    assert res == {EV_A: {**OUTLOOK_SAME, "modified": None}, EV_B: None}


def test_listing_error_mid_pagination_returns_none(graph_pages):
    graph_pages += [{"value": [_graph_event(EV_A)], "@odata.nextLink": "https://next"}, httpx.ConnectError("boom")]
    assert graph_client.list_events_in_range(None, ORG, "adv1", "x", "y") is None


def test_listing_page_cap_returns_none(graph_pages):
    graph_pages += [{"value": [], "@odata.nextLink": "https://next"}] * 40
    assert graph_client.list_events_in_range(None, ORG, "adv1", "x", "y") is None


def test_listing_without_connection_returns_none(monkeypatch):
    def no_conn(db, org):
        raise RuntimeError("no active org-level Microsoft calendar connection")
    monkeypatch.setattr(graph_client, "_get_app_only_token", no_conn)
    assert graph_client.list_events_in_range(None, ORG, "adv1", "x", "y") is None
