"""The scheduled refresh of tasks' status and cached progress. Fully offline: Supabase is faked."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import task_logic  # noqa: E402
from main import app  # noqa: E402
from routers import tasks_router  # noqa: E402

SCHOOL = {"id": "s1", "name": "א", "stage": "yesodi"}
COND = {"type": "meeting", "meeting_service_type": "gefen"}


def meeting(token=None):
    return {"id": "m", "school_id": "s1", "meeting_date": "2026-12-10", "meeting_service_type": "gefen",
            "status": "scheduled", "stage_scope": None, "meeting_type": "remote", "booking_token_id": token}


def task(task_id="t1", year="תשפ\"ז", status="active", pct=0.0, completed=0, cond=COND):
    return {"id": task_id, "org_id": "org", "status": status, "academic_year": year, "track_success": True,
            "matched_school_ids": ["s1"], "success_criteria": {"groups": [{"conditions": [cond]}]},
            "cached_total_schools": 1, "cached_actions_needed": 1, "cached_actions_completed": completed, "cached_progress_pct": pct}


class _Db:
    def __init__(self, tokens=(), fail_tokens=False):
        self.tokens, self.fail_tokens, self.updates, self._patch, self._table = list(tokens), fail_tokens, [], None, None

    def table(self, name):
        self._table = name
        return self

    def select(self, *a):
        return self

    def in_(self, *a):
        return self

    def update(self, patch):
        self._patch = patch
        return self

    def eq(self, _column, value):
        self.updates.append((value, self._patch))
        return self

    def execute(self):
        if self._table == "meeting_booking_tokens" and self.fail_tokens:
            raise RuntimeError("down")
        return type("R", (), {"data": self.tokens if self._table == "meeting_booking_tokens" else []})()


@pytest.fixture
def fetches(monkeypatch):
    calls = []

    def fake(org_id, year, only_school_ids=None):
        assert only_school_ids == ["s1"]  # only the schools the tasks cover
        calls.append(year)
        return [SCHOOL], fake.meetings, {}, {}, {}

    fake.meetings = []
    calls_holder = type("H", (), {"calls": calls, "fake": fake})
    monkeypatch.setattr(task_logic, "_fetch_schools_and_meetings", fake)
    monkeypatch.setattr(task_logic, "get_admin_client", lambda: (_ for _ in ()).throw(AssertionError("no per-task query expected")))
    return calls_holder


def test_a_new_meeting_updates_the_cache_and_closes_the_task(fetches):
    fetches.fake.meetings = [meeting()]
    db = _Db()
    assert task_logic.refresh_task_progress_for_org(db, "org", [task()]) == 1
    (task_id, patch), = db.updates
    assert task_id == "t1"
    assert patch["cached_progress_pct"] == 100.0 and patch["cached_actions_completed"] == 1 and patch["status"] == "archived"


def test_a_cancelled_meeting_reopens_a_closed_task(fetches):
    db = _Db()
    assert task_logic.refresh_task_progress_for_org(db, "org", [task(status="archived", pct=100.0, completed=1)]) == 1
    assert db.updates[0][1]["status"] == "active" and db.updates[0][1]["cached_progress_pct"] == 0.0


def test_nothing_changed_writes_nothing(fetches):
    fetches.fake.meetings = [meeting()]
    db = _Db()
    assert task_logic.refresh_task_progress_for_org(db, "org", [task(status="archived", pct=100, completed=1)]) == 0
    assert db.updates == []


def test_one_data_fetch_per_year_however_many_tasks(fetches):
    tasks = [task("a"), task("b"), task("c", year="תשפ\"ו")]
    task_logic.refresh_task_progress_for_org(_Db(), "org", tasks)
    assert sorted(fetches.calls) == sorted(["תשפ\"ז", "תשפ\"ו"])


def test_token_lookup_failure_never_reopens_a_closed_task(fetches):
    additional = {**COND, "require_additional_meeting": True}
    db = _Db(fail_tokens=True)
    fetches.fake.meetings = [meeting("tok")]
    with pytest.raises(RuntimeError):
        task_logic.refresh_task_progress_for_org(db, "org", [task(status="archived", pct=100, completed=1, cond=additional)])
    assert db.updates == []


def test_booking_through_the_tasks_own_token_counts(fetches):
    additional = {**COND, "require_additional_meeting": True}
    fetches.fake.meetings = [meeting("tok")]
    db = _Db(tokens=[{"id": "tok", "task_id": "t1"}])
    assert task_logic.refresh_task_progress_for_org(db, "org", [task(cond=additional)]) == 1
    assert db.updates[0][1]["cached_progress_pct"] == 100.0


class _EndpointDb(_Db):
    def __init__(self, tasks):
        super().__init__()
        self.tasks = tasks

    def neq(self, *a):
        return self

    def execute(self):
        return type("R", (), {"data": self.tasks if self._table == "org_tasks" else []})()


def test_endpoint_requires_the_cron_secret(monkeypatch):
    monkeypatch.setattr(tasks_router, "CRON_SECRET", "right")
    client = TestClient(app)
    assert client.post("/tasks/recompute-progress").status_code == 403
    assert client.post("/tasks/recompute-progress", headers={"X-Cron-Secret": "wrong"}).status_code == 403


def test_endpoint_one_failing_org_does_not_stop_the_others(monkeypatch):
    monkeypatch.setattr(tasks_router, "CRON_SECRET", "right")
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: _EndpointDb([{**task("a"), "org_id": "bad"}, {**task("b"), "org_id": "good"}]))
    seen = []

    def refresh(db, org_id, tasks):
        seen.append(org_id)
        if org_id == "bad":
            raise RuntimeError("down")
        return 1

    monkeypatch.setattr(tasks_router.task_logic, "refresh_task_progress_for_org", refresh)
    resp = TestClient(app).post("/tasks/recompute-progress", headers={"X-Cron-Secret": "right"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "orgs": 2, "tasks": 2, "changed": 1, "failed_orgs": 1, "links_reconciled": 0, "rounds_changed": 0}
    assert seen == ["bad", "good"]
