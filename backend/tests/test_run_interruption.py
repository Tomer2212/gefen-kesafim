"""A check killed mid-work by a deploy: it must not stay "processing" forever, it must be
re-runnable from its stored files, and a background meeting check (polled by no one) must be
retried once and then reported. Offline: tests/fake_supabase.py stands in for Supabase."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers import analyze_router as ar  # noqa: E402
from tests.fake_supabase import FakeDb  # noqa: E402

SCHOOL = "school-1"
CRON = "test-cron-secret"


class _FakeBucket:
    def __init__(self, files):
        self.files = files

    def download(self, key):
        return self.files[key]


class _FakeStorage:
    def __init__(self, files):
        self.files = files

    def from_(self, _bucket):
        return _FakeBucket(self.files)


def ago(minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def run_row(run_id, status="processing", minutes_ago=0, **result):
    return {"id": run_id, "status": status, "updated_at": ago(minutes_ago),
            "result": {"status": status, "_school_ctx": {"school_id": SCHOOL}, **result}}


STORED = [{"path": "old/file_00.xlsx", "name": "doch.xlsx"}, {"path": "old/file_01.xls", "name": "ksafim.xls"}]
UPLOAD_ARGS = {"kind": "upload", "file_count": 2, "gefen_account_id": "acc", "update_log_id": "log-1",
               "academic_year": "תשפ\"ז", "acknowledged_roles": ["gefen"]}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb({"run_states": [], "meetings": [{"id": "m1", "school_id": SCHOOL}]})
    fake.storage = _FakeStorage({"old/file_00.xlsx": b"gefen", "old/file_01.xls": b"finance"})
    monkeypatch.setattr(ar, "get_admin_client", lambda: fake)
    monkeypatch.setattr(ar, "CRON_SECRET", CRON)
    return fake


def state(db, run_id):
    return next(r for r in db.tables["run_states"] if r["id"] == run_id)


def test_update_run_stamps_updated_at_and_keeps_rerun_args(db):
    ar._update_run("r1", {"status": "processing", "_school_ctx": {"school_id": SCHOOL}, "_rerun": UPLOAD_ARGS})
    first = state(db, "r1")["updated_at"]
    ar._update_run("r1", {"status": "saving"})  # like _process's mid-run writes, which omit both
    row = state(db, "r1")
    assert row["result"]["_rerun"] == UPLOAD_ARGS
    assert row["result"]["_school_ctx"] == {"school_id": SCHOOL}
    assert row["updated_at"] >= first
    assert "_updated_at" not in row["result"]


def test_running_run_is_left_alone(db):
    db.tables["run_states"].append(run_row("r1", minutes_ago=2))
    run, claimed = ar._interrupt_if_stale("r1", ar._get_run("r1"))
    assert (run["status"], claimed) == ("processing", False)
    assert state(db, "r1")["status"] == "processing"


def test_stale_run_becomes_interrupted(db):
    db.tables["run_states"].append(run_row("r1", minutes_ago=30))
    run, claimed = ar._interrupt_if_stale("r1", ar._get_run("r1"))
    assert (run["status"], claimed) == ("interrupted", True)
    assert state(db, "r1")["status"] == "interrupted"


def test_stale_run_that_already_saved_its_check_becomes_done(db):
    db.tables["run_states"].append(run_row("r1", status="saving", minutes_ago=30, saved_log_id="log-9"))
    run, _ = ar._interrupt_if_stale("r1", ar._get_run("r1"))
    assert run["status"] == "done"


def test_only_one_of_two_concurrent_callers_settles_it(db):
    db.tables["run_states"].append(run_row("r1", minutes_ago=30))
    seen = ar._get_run("r1")
    _, first = ar._interrupt_if_stale("r1", seen)
    _, second = ar._interrupt_if_stale("r1", seen)  # read before the first settled it
    assert (first, second) == (True, False)


def test_rerun_starts_same_check_from_stored_files(db, tmp_path):
    db.tables["run_states"].append(run_row("r1", status="interrupted", stored_file_paths=STORED, _rerun=UPLOAD_ARGS))
    tasks = BackgroundTasks()
    new_id = ar._restart_run(ar._get_run("r1"), "user-1", tasks)
    task = tasks.tasks[0]
    assert task.func is ar._process
    run_id, paths, run_dir, user_id, school_id, account, update_log_id, year, roles = task.args
    try:
        assert (run_id, user_id, school_id, account, update_log_id, year, roles) == (
            new_id, "user-1", SCHOOL, "acc", "log-1", "תשפ\"ז", {"gefen"})
        assert [p.name for p in paths] == ["doch.xlsx", "ksafim.xls"]
        assert [p.read_bytes() for p in paths] == [b"gefen", b"finance"]
        assert task.kwargs["stored_file_paths"] == STORED
        assert state(db, new_id)["result"]["_rerun"] == UPLOAD_ARGS
    finally:
        import shutil
        shutil.rmtree(run_dir, ignore_errors=True)


def test_rerun_refuses_a_run_whose_files_were_only_partly_stored(db):
    db.tables["run_states"].append(run_row("r1", status="interrupted", stored_file_paths=STORED[:1], _rerun=UPLOAD_ARGS))
    with pytest.raises(HTTPException) as exc:
        ar._restart_run(ar._get_run("r1"), "user-1", BackgroundTasks())
    assert exc.value.status_code == 400


def test_rerun_endpoint_refuses_a_run_that_was_not_interrupted(db, monkeypatch):
    db.tables["run_states"].append(run_row("r1", minutes_ago=1, stored_file_paths=STORED, _rerun=UPLOAD_ARGS))
    monkeypatch.setattr(ar, "_check_school_access", lambda *_a: None)
    with pytest.raises(HTTPException) as exc:
        ar.rerun_interrupted("r1", BackgroundTasks(), {"id": "user-1"})
    assert exc.value.status_code == 409


class _Req:
    def __init__(self, secret):
        self.headers = {"X-Cron-Secret": secret}


MEETING_ARGS = {"kind": "meeting", "meeting_id": "m1", "academic_year": "תשפ\"ז", "user_id": "adv-1"}


def test_sweep_retries_an_interrupted_meeting_check_once(db, monkeypatch):
    db.tables["run_states"].append(run_row("r1", minutes_ago=30, _rerun={**MEETING_ARGS, "auto_retried": False}))
    started = []
    monkeypatch.setattr(ar, "_start_meeting_check", lambda _db, meeting, year, user_id, _bt, auto_retried=False: started.append((meeting["id"], year, user_id, auto_retried)) or "r2")
    monkeypatch.setattr(ar, "_notify_meeting_check", lambda *a, **k: pytest.fail("must retry before notifying"))
    out = ar.sweep_interrupted_runs(_Req(CRON), BackgroundTasks())
    assert out == {"settled": 1, "retried": 1, "notified": 0}
    assert started == [("m1", "תשפ\"ז", "adv-1", True)]


def test_sweep_notifies_when_the_retry_was_interrupted_too(db, monkeypatch):
    db.tables["run_states"].append(run_row("r1", minutes_ago=30, _rerun={**MEETING_ARGS, "auto_retried": True}))
    notified = []
    monkeypatch.setattr(ar, "_start_meeting_check", lambda *a, **k: pytest.fail("only one automatic retry"))
    monkeypatch.setattr(ar, "_notify_meeting_check", lambda run_id, user_id, school_id, year, summary=None: notified.append((run_id, user_id, school_id, summary["outcome"])))
    out = ar.sweep_interrupted_runs(_Req(CRON), BackgroundTasks())
    assert out["notified"] == 1
    assert notified == [("r1", "adv-1", SCHOOL, "failure")]


def test_sweep_leaves_running_and_old_runs_alone(db, monkeypatch):
    db.tables["run_states"] += [run_row("fresh", minutes_ago=1), run_row("ancient", minutes_ago=5 * 24 * 60)]
    out = ar.sweep_interrupted_runs(_Req(CRON), BackgroundTasks())
    assert out["settled"] == 0
    assert state(db, "fresh")["status"] == state(db, "ancient")["status"] == "processing"


def test_sweep_requires_the_cron_secret(db):
    with pytest.raises(HTTPException) as exc:
        ar.sweep_interrupted_runs(_Req("wrong"), BackgroundTasks())
    assert exc.value.status_code == 401
