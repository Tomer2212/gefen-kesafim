"""A task name is unique within its round: create_task / patch_task refuse a name another task of the
same round has (409 task_name_taken). Fully offline; created tasks are scheduled, so nothing is sent."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fake_supabase import FakeDb  # noqa: E402
from routers import tasks_router  # noqa: E402

USER = {"role": "owner", "org_id": "o1", "id": "u1"}
RID = "2b1f6b0e-6a8e-4a4f-9a52-1f4d1b7d1a11"


@pytest.fixture
def db(monkeypatch):
    db = FakeDb({"org_tasks": [
        {"id": "t1", "org_id": "o1", "round_id": "r1", "name": "סבב דצמבר", "status": "archived"},
        {"id": "t2", "org_id": "o1", "round_id": "r1", "name": "אחר", "status": "active"},
        {"id": "t3", "org_id": "o1", "round_id": None, "name": "ללא סבב", "status": "active"},
    ]})
    monkeypatch.setattr(tasks_router, "get_admin_client", lambda: db)
    monkeypatch.setattr(tasks_router.booking_lock, "get_admin_client", lambda: db)
    monkeypatch.setattr(tasks_router, "_round_member_ids", lambda *_a: {"s1"})
    for name in ("_stamp_round_plan", "_merge_round_advisor_choices"):
        monkeypatch.setattr(tasks_router, name, lambda *_a, **_k: None)
    monkeypatch.setattr(tasks_router, "_clean_override_advisor_choices", lambda *_a: {})
    monkeypatch.setattr(tasks_router, "_org_advisor_exclusions", lambda *_a: {})
    return db


def _create(name, round_id="r1", **extra):
    return tasks_router.create_task(tasks_router.TaskCreateIn(
        name=name, criteria={"groups": []}, manual_school_ids=["s1"], round_id=round_id,
        message_config={"recipient_role": "principal", "channel": "email_resend"},
        scheduled_for="2099-12-01T00:00:00+00:00", **extra,
    ), USER)


def _rename(task_id, name):
    return tasks_router.patch_task(task_id, tasks_router.TaskPatchIn(name=name), USER)


@pytest.mark.parametrize("name", ["סבב דצמבר", "  סבב דצמבר ", "אחר"])  # t1 is a completed task
def test_create_with_a_taken_name_is_refused(db, name):
    with pytest.raises(HTTPException) as exc:
        _create(name)
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "task_name_taken"
    assert len(db.tables["org_tasks"]) == 3


@pytest.mark.parametrize("name,round_id", [("סבב דצמבר 2", "r1"), ("סבב דצמבר", "r2"), ("סבב דצמבר", None), ("ללא סבב", "r1")])
def test_create_with_a_free_name_works(db, name, round_id):
    assert _create(f" {name} ", round_id)["name"] == name
    assert len(db.tables["org_tasks"]) == 4


def test_repeated_create_of_the_same_wizard_returns_its_task(db, monkeypatch):
    first = _create("חדשה", client_request_id=RID)
    # The first create was saved only after the check at the top of the second one.
    monkeypatch.setattr(tasks_router, "_task_by_client_request_id", lambda *_a: None)
    assert _create("חדשה", client_request_id=RID)["id"] == first["id"]
    assert len(db.tables["org_tasks"]) == 4


def test_rename(db):
    with pytest.raises(HTTPException) as exc:
        _rename("t2", " סבב דצמבר ")
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "task_name_taken"
    assert db.tables["org_tasks"][1]["name"] == "אחר"
    assert _rename("t2", "אחר")["name"] == "אחר"  # its own name
    assert _rename("t2", "שם פנוי")["name"] == "שם פנוי"
    assert _rename("t3", "סבב דצמבר")["name"] == "סבב דצמבר"  # not in a round


def test_simultaneous_creates_of_one_name_keep_one(db, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    real, gate = tasks_router._repeated_round_create, Barrier(2)
    passed_first = set()

    def both_pass_the_first_check(*args):
        out = real(*args)
        if args[3] not in passed_first:
            passed_first.add(args[3])
            gate.wait(timeout=10)
        return out
    monkeypatch.setattr(tasks_router, "_repeated_round_create", both_pass_the_first_check)

    def attempt(rid):
        try:
            return _create("במקביל", client_request_id=rid)["id"]
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(attempt, [RID, RID.replace("2b", "3b")]))
    assert results.count(409) == 1
    assert [t["name"] for t in db.tables["org_tasks"]].count("במקביל") == 1
    assert not db.tables.get("booking_slot_locks")
