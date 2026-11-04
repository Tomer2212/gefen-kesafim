"""The secretary upload portal and the background check run from its files. No live DB: both
routers run against a small in-memory stand-in for the Supabase client."""
import asyncio
import io
import shutil
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import openpyxl
import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient
from openpyxl.chart import BarChart

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers import analyze_router as ar  # noqa: E402
from routers import meeting_upload_router as mur  # noqa: E402

YEAR = 'תשפ"ז'
OLD_YEAR = 'תשפ"ו'


class FakeQuery:
    def __init__(self, data):
        self._data = data

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return SimpleNamespace(data=self._data)


class FakeStorage:
    def __init__(self, blobs=None):
        self.blobs = blobs or {}
        self.uploaded = []

    def from_(self, _bucket):
        return self

    def upload(self, key, content):
        self.uploaded.append((key, content))

    def download(self, key):
        return self.blobs[key]


class FakeDb:
    def __init__(self, tables=None, blobs=None):
        self.tables = tables or {}
        self.storage = FakeStorage(blobs)
        self.inserted = []

    def table(self, name):
        db = self

        class Query(FakeQuery):
            def insert(self, row):
                db.inserted.append((name, row))
                return self

        return Query(self.tables.get(name, []))


@pytest.fixture
def portal(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(mur, "get_admin_client", lambda: db)
    monkeypatch.setattr(mur, "_load_upload_context", lambda _t: (
        {"id": "tok", "meeting_id": "m1"},
        {"id": "m1", "school_id": "s1", "meeting_date": "2026-11-05", "academic_year": YEAR, "requested_upload_years": [YEAR]},
        {"id": "s1", "name": "x", "symbol": None},
    ))
    monkeypatch.setattr(mur, "_notify_advisors_files_arrived", lambda *a, **k: None)
    monkeypatch.setattr(mur, "_reclassify_gefen_budgets", lambda *a, **k: None)
    monkeypatch.setattr(mur, "build_upload_checklist", lambda *a, **k: {"items": []})
    monkeypatch.setattr(mur, "compute_upload_comparison", lambda *a, **k: {"items": [], "all_received": False})
    app = FastAPI()
    app.include_router(mur.router)
    return SimpleNamespace(client=TestClient(app), db=db)


def _post(portal, files, commit=False):
    return portal.client.post(
        "/public/meeting-upload/t/files",
        data={"academic_year": YEAR, "commit": "true" if commit else "false"},
        files=[("files", (name, content, "application/octet-stream")) for name, content in files],
    )


def _workbook_with_chartsheet():
    wb = openpyxl.Workbook()
    wb.active.append([1, 2])
    wb.create_chartsheet("graph").add_chart(BarChart())
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _treat_as_gefen(monkeypatch, invoice_date):
    monkeypatch.setattr(mur, "identify_file", lambda _p: "gefen")
    monkeypatch.setattr(mur, "load_gefen", lambda _p: (_ for _ in ()).throw(ValueError("no division needed")))
    monkeypatch.setattr(mur, "_read_gefen_invoice_dates", lambda _paths: [invoice_date])


def test_wrong_year_names_both_years(portal, monkeypatch):
    _treat_as_gefen(monkeypatch, date(2026, 1, 15))
    result = _post(portal, [("doch.xlsx", b"x")]).json()["files"][0]
    assert result["valid"] is False
    assert result["detected_academic_year"] == OLD_YEAR
    assert OLD_YEAR in result["reason"] and YEAR in result["reason"]


def test_unidentified_files_are_blocked_individually(portal):
    resp = _post(portal, [("a.pdf", b"%PDF-1.4"), ("b.xlsx", b"not a workbook")])
    assert resp.status_code == 200
    assert [f["valid"] for f in resp.json()["files"]] == [False, False]
    assert all(f["status"] == "unidentified" for f in resp.json()["files"])


def test_file_that_crashes_the_parser_only_fails_itself(portal, monkeypatch):
    # A chartsheet really does crash logic/file_identifier.py — this is the path that used to
    # turn into a 503 for the whole batch, shown as a generic "error in sending".
    real_identify = mur.identify_file
    monkeypatch.setattr(mur, "identify_file", lambda p: "gefen" if p.endswith("good.xlsx") else real_identify(p))
    monkeypatch.setattr(mur, "load_gefen", lambda _p: (_ for _ in ()).throw(ValueError("skip")))
    monkeypatch.setattr(mur, "_read_gefen_invoice_dates", lambda _paths: [date(2026, 10, 1)])
    resp = _post(portal, [("graph.xlsx", _workbook_with_chartsheet()), ("good.xlsx", b"x")])
    assert resp.status_code == 200
    bad, good = resp.json()["files"]
    assert bad["valid"] is False and bad["status"] == "unreadable" and bad["reason"]
    assert good["valid"] is True


def test_oversized_file_only_fails_itself(portal, monkeypatch):
    _treat_as_gefen(monkeypatch, date(2026, 10, 1))
    monkeypatch.setattr(mur, "MAX_UPLOAD_SIZE_BYTES", 5)
    resp = _post(portal, [("big.xlsx", b"x" * 6), ("ok.xlsx", b"x")])
    assert [f["valid"] for f in resp.json()["files"]] == [False, True]
    assert resp.json()["files"][0]["status"] == "too_large"


@pytest.mark.parametrize("raw,expected", [
    ("../../evil.xlsx", "evil.xlsx"),
    ("a/b/c.xlsx", "c.xlsx"),
    ("..", "upload"),
    ("a/..", "upload"),
    ("", "upload"),
    (None, "upload"),
    ("doch.xlsx (18).xlsx", "doch.xlsx (18).xlsx"),
])
def test_safe_upload_name(raw, expected):
    assert mur._safe_upload_name(raw) == expected


def test_same_named_files_are_both_saved(portal, monkeypatch):
    _treat_as_gefen(monkeypatch, date(2026, 10, 1))
    resp = _post(portal, [("doch.xlsx", b"first"), ("doch.xlsx", b"second")], commit=True)
    assert resp.json()["received"] == 2
    assert [content for _key, content in portal.db.storage.uploaded] == [b"first", b"second"]


def test_review_step_saves_nothing(portal, monkeypatch):
    _treat_as_gefen(monkeypatch, date(2026, 10, 1))
    _post(portal, [("doch.xlsx", b"x")], commit=False)
    assert portal.db.storage.uploaded == [] and portal.db.inserted == []


def test_date_range_label():
    assert mur._year_date_range_label(YEAR) == "ספטמבר 2026 – אוגוסט 2027"


def _pending_tikhnun(*keys):
    return {"pending_identification": True, "unidentified_rows": [{"union_key": k} for k in keys]}


def _doch_row(budget=None, code="", invoice=None, supplier=None, amount=None):
    return {"budget": budget, "orig": ("מענה משרדי", code, "t", "n", invoice, None, supplier, None, None, None, None, amount, None, "לא")}


def test_placeholder_doch_rows_are_dropped_and_nothing_else():
    # The 616805 rows: a planned response listed with nothing reported against it.
    placeholder = _doch_row()
    real = [
        _doch_row(budget="גפן"),                # identified, even if sparse
        _doch_row(code="69"),                   # unidentified but real, the advisor must decide
        _doch_row(invoice="909"),
        _doch_row(supplier="123- ספק"),
        _doch_row(amount=0),
    ]
    assert ar._without_placeholder_doch_rows([placeholder, *real, placeholder]) == real


def test_saved_check_is_a_success():
    assert ar._summarize_meeting_check({"status": "done", "saved_log_id": "l1"}, []) == {"outcome": "success"}


def test_pending_check_is_not_reported_as_success():
    # The exact 616805 incident: status=done, nothing saved, rows waiting for classification.
    pending = _pending_tikhnun("a", "b")
    summary = ar._summarize_meeting_check({"status": "done", "tikhnun": pending, "tikhnun_beinayim": pending}, [])
    assert summary == {"outcome": "needs_classification", "pending_rows": 2}


def test_done_but_not_saved_is_a_failure():
    summary = ar._summarize_meeting_check({"status": "done"}, [])
    assert summary["outcome"] == "failure" and summary["reason"]


def test_split_run_is_judged_by_its_divisions():
    parent = {"status": "done", "split_divisions": True}
    saved = {"status": "done", "saved_log_id": "l1"}
    pending = {"status": "done", "tikhnun_tikkon": _pending_tikhnun("a")}
    assert ar._summarize_meeting_check(parent, [saved, saved])["outcome"] == "success"
    assert ar._summarize_meeting_check(parent, [saved, pending]) == {"outcome": "needs_classification", "pending_rows": 1}
    assert ar._summarize_meeting_check(parent, [saved, {"status": "done"}])["outcome"] == "failure"


def test_file_issues_failure_spells_out_each_file():
    run = {
        "status": "error", "error_code": "file_issues", "error": "ראה למטה", "expected_academic_year": YEAR,
        "file_issues": [
            {"file_role": "gefen", "filenames": ["doch.xlsx"], "status": "recognized", "detected_academic_year": OLD_YEAR, "severity": "block"},
            {"file_role": "tikhnun", "filenames": [], "status": "missing", "severity": "block"},
            {"file_role": "schoolcash", "filenames": ["ok.xlsx"], "status": "empty", "severity": "warn"},
        ],
    }
    summary = ar._summarize_meeting_check(run, [])
    assert summary["outcome"] == "failure"
    assert "doch.xlsx" in summary["reason"] and OLD_YEAR in summary["reason"]
    assert "תכנון" in summary["reason"]
    assert "ok.xlsx" not in summary["reason"]
    assert "למטה" not in summary["reason"]


def test_background_check_acknowledges_warnings_only():
    # Without this a "warn" file the portal accepted could never be checked; "block" entries
    # don't consult acknowledged roles at all.
    entries = ar._collect_file_issues([], [], [], [], None, YEAR, None, ar._MEETING_CHECK_ACKNOWLEDGED_ROLES)
    assert any(e["status"] == "missing" and e["severity"] == "block" for e in entries)
    assert {"tikhnun", "gefen", "kesafim2000", "payscool", "schoolcash"} == ar._MEETING_CHECK_ACKNOWLEDGED_ROLES


def _run_check(monkeypatch, db):
    monkeypatch.setattr(ar, "get_admin_client", lambda: db)
    monkeypatch.setattr(ar, "_check_school_access", lambda *a, **k: None)
    monkeypatch.setattr(ar, "_update_run", lambda *a, **k: None)
    tasks = BackgroundTasks()
    asyncio.run(ar.run_check_from_uploads("m1", tasks, {"id": "u1"}, YEAR))
    return tasks.tasks[0]


def _meeting_db(files, blobs):
    return FakeDb(
        tables={"meetings": [{"id": "m1", "school_id": "s1", "meeting_date": "2026-11-05", "academic_year": YEAR, "requested_upload_years": [YEAR]}],
                "meeting_upload_files": files},
        blobs=blobs,
    )


def test_run_check_keeps_same_named_files_apart(monkeypatch):
    db = _meeting_db(
        [{"storage_key": "k1", "original_filename": "doch.xlsx", "identified_type": "gefen"},
         {"storage_key": "k2", "original_filename": "doch.xlsx", "identified_type": "gefen"}],
        {"k1": b"first", "k2": b"second"},
    )
    task = _run_check(monkeypatch, db)
    paths, run_dir = task.args[1], task.args[2]
    try:
        assert [p.read_bytes() for p in paths] == [b"first", b"second"]
        assert all(p.name == "doch.xlsx" for p in paths)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def test_run_check_leaves_out_unknown_files_and_names_them(monkeypatch):
    db = _meeting_db(
        [{"storage_key": "k1", "original_filename": "doch.xlsx", "identified_type": "gefen"},
         {"storage_key": "k2", "original_filename": "a.pdf", "identified_type": "unknown"}],
        {"k1": b"first", "k2": b"pdf"},
    )
    task = _run_check(monkeypatch, db)
    paths, run_dir = task.args[1], task.args[2]
    try:
        assert [p.name for p in paths] == ["doch.xlsx"]
        assert task.args[6] == ["a.pdf"]
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def test_run_check_with_only_unknown_files_is_a_clear_400(monkeypatch):
    db = _meeting_db([{"storage_key": "k2", "original_filename": "a.pdf", "identified_type": "unknown"}], {})
    with pytest.raises(ar.HTTPException) as exc:
        _run_check(monkeypatch, db)
    assert exc.value.status_code == 400


def test_restore_paths_downloads_what_the_finished_run_deleted(monkeypatch, tmp_path):
    db = FakeDb(blobs={"r/file_00.xlsx": b"gefen", "r/file_01.xlsx": b"finance"})
    monkeypatch.setattr(ar, "get_admin_client", lambda: db)
    run = {"stored_file_paths": [{"path": "r/file_00.xlsx", "name": "doch.xlsx"}, {"path": "r/file_01.xlsx", "name": "fin.xlsx"}]}
    gone = tmp_path / "deleted"
    gefen, finance = ar._restore_zihuy_paths(run, [gone / "doch.xlsx"], [gone / "fin.xlsx"], tmp_path / "restore")
    assert gefen[0].read_bytes() == b"gefen" and gefen[0].name == "doch.xlsx"
    assert finance[0].read_bytes() == b"finance" and finance[0].name == "fin.xlsx"


def test_restore_paths_keeps_original_path_when_it_cannot_restore(monkeypatch, tmp_path):
    monkeypatch.setattr(ar, "get_admin_client", lambda: FakeDb())
    missing = tmp_path / "deleted" / "doch.xlsx"
    gefen, finance = ar._restore_zihuy_paths({"stored_file_paths": [{"path": "nope", "name": "doch.xlsx"}]}, [missing], [], tmp_path / "restore")
    assert gefen == [missing] and finance == []


def test_classify_computes_per_budget_results_after_temp_dir_is_gone(monkeypatch, tmp_path):
    db = FakeDb(blobs={"r/0.xlsx": b"gefen", "r/1.xlsx": b"finance"})
    gone = tmp_path / "deleted"
    run = {
        "stored_file_paths": [{"path": "r/0.xlsx", "name": "doch.xlsx"}, {"path": "r/1.xlsx", "name": "fin.xlsx"}],
        "finance_type": "schoolcash",
        "tikhnun": {
            "pending_identification": True,
            "_zihuy_ctx": {
                "results_clean": [], "budgets_raw": [], "perut_rows": [],
                "gefen_paths": [str(gone / "doch.xlsx")], "finance_paths": [str(gone / "fin.xlsx")], "finance_type": "schoolcash",
            },
        },
        "_school_ctx": {"school_id": "s1", "user_id": "u1", "academic_year": YEAR},
    }
    seen = {}

    def load_gefen_files(paths, _year):
        seen["gefen_exists"] = all(p.exists() for p in paths)
        return "df", None, None

    def per_combo(_df, finance_paths, *_a, **_k):
        seen["finance_exists"] = all(p.exists() for p in finance_paths)
        return {"combo": {}}

    saved = {}
    monkeypatch.setattr(ar, "get_admin_client", lambda: db)
    monkeypatch.setattr(ar, "_require_run_access", lambda *_a: run)
    monkeypatch.setattr(ar, "_finalize_tikhnun_metrics", lambda *a, **k: None)
    monkeypatch.setattr(ar, "_get_school_stage", lambda *_a: None)
    monkeypatch.setattr(ar, "_load_gefen_files", load_gefen_files)
    monkeypatch.setattr(ar, "_run_per_combo_reconciliation", per_combo)
    monkeypatch.setattr(ar, "_save_check_log", lambda *a, **k: saved.update(k))
    monkeypatch.setattr(ar, "_update_run", lambda *a, **k: None)

    req = ar.ClassifyRequest(classifications=[], skipped=[], division="main")
    result = asyncio.run(ar.classify_rows("r", req, {"id": "u1"}))

    assert seen == {"gefen_exists": True, "finance_exists": True}
    assert result["per_combo_results"] == {"combo": {}}
    assert saved["run_data"]["per_combo_results"] == {"combo": {}}


def test_classifying_second_division_keeps_first_divisions_results(monkeypatch, tmp_path):
    db = FakeDb(blobs={"r/0.xlsx": b"g", "r/1.xlsx": b"f"})
    gone = tmp_path / "deleted"
    run = {
        "stored_file_paths": [{"path": "r/0.xlsx", "name": "doch.xlsx"}, {"path": "r/1.xlsx", "name": "fin.xlsx"}],
        "finance_type": "schoolcash",
        "per_combo_results": {"גפן-תיכון": {"first": True}},
        "tikhnun_beinayim": {
            "pending_identification": True,
            "_zihuy_ctx": {
                "results_clean": [], "budgets_raw": [], "perut_rows": [],
                "gefen_paths": [str(gone / "doch.xlsx")], "finance_paths": [str(gone / "fin.xlsx")], "finance_type": "schoolcash",
            },
        },
        "_school_ctx": {"school_id": "s1", "user_id": "u1", "academic_year": YEAR},
    }
    monkeypatch.setattr(ar, "get_admin_client", lambda: db)
    monkeypatch.setattr(ar, "_require_run_access", lambda *_a: run)
    monkeypatch.setattr(ar, "_finalize_tikhnun_metrics", lambda *a, **k: None)
    monkeypatch.setattr(ar, "_get_school_stage", lambda *_a: None)
    monkeypatch.setattr(ar, "_load_gefen_files", lambda *_a: ("df", None, None))
    monkeypatch.setattr(ar, "_run_per_combo_reconciliation", lambda *a, **k: {"גפן-חטיבת ביניים": {"second": True}})
    monkeypatch.setattr(ar, "_save_check_log", lambda *a, **k: None)
    monkeypatch.setattr(ar, "_update_run", lambda *a, **k: None)

    req = ar.ClassifyRequest(classifications=[], skipped=[], division="beinayim")
    result = asyncio.run(ar.classify_rows("r", req, {"id": "u1"}))
    assert set(result["per_combo_results"]) == {"גפן-תיכון", "גפן-חטיבת ביניים"}


def _retry_finance_run(gone, ctx_finance_type="schoolcash"):
    return {
        "stored_file_paths": [{"path": "r/0.xlsx", "name": "doch.xlsx"}, {"path": "r/1.xlsx", "name": "orig.xlsx"}],
        "finance_type": ctx_finance_type,
        "tikhnun": {
            "pending_identification": True,
            "covered_budgets": [],
            "_zihuy_ctx": {
                "results_clean": [{"budget": "גפן", "union_key": "a"}], "budgets_raw": [], "perut_rows": [],
                "gefen_paths": [str(gone / "doch.xlsx")], "finance_paths": [str(gone / "orig.xlsx")], "finance_type": ctx_finance_type,
            },
        },
        "_school_ctx": {"school_id": "s1", "user_id": "u1", "academic_year": YEAR},
    }


def _call_retry_finance(monkeypatch, run, uploaded_type):
    seen = {"finance_names": None}

    def per_combo(_df, finance_paths, *_a, **_k):
        seen["finance_names"] = [p.name for p in finance_paths]
        seen["contents"] = [p.read_bytes() for p in finance_paths]
        return {"combo": {}}

    db = FakeDb(blobs={"r/0.xlsx": b"g", "r/1.xlsx": b"orig"})
    monkeypatch.setattr(ar, "get_admin_client", lambda: db)
    monkeypatch.setattr(ar, "_require_run_access", lambda *_a: run)
    monkeypatch.setattr(ar, "identify_file", lambda _p: uploaded_type)
    monkeypatch.setattr(ar, "_build_finance_ichud_budget_map", lambda *a, **k: ({}, [], ["תקומה"], None))
    monkeypatch.setattr(ar, "_finalize_tikhnun_metrics", lambda *a, **k: None)
    monkeypatch.setattr(ar, "_get_school_stage", lambda *_a: None)
    monkeypatch.setattr(ar, "_load_gefen_files", lambda *_a: ("df", None, None))
    monkeypatch.setattr(ar, "_run_per_combo_reconciliation", per_combo)
    monkeypatch.setattr(ar, "_save_check_log", lambda *a, **k: None)
    monkeypatch.setattr(ar, "_update_run", lambda *a, **k: None)

    upload = SimpleNamespace(filename="new.xlsx", file=io.BytesIO(b"new"))
    result = asyncio.run(ar.retry_finance("r", "main", [upload], {"id": "u1"}))
    return result, seen


def test_retry_finance_counts_the_newly_uploaded_file(monkeypatch, tmp_path):
    # Leaving it out would report the budget it covers as missing from finance.
    result, seen = _call_retry_finance(monkeypatch, _retry_finance_run(tmp_path / "deleted"), "schoolcash")
    assert result["pending"] is False
    assert seen["contents"] == [b"orig", b"new"]


def test_retry_finance_with_another_software_gives_no_per_budget_results(monkeypatch, tmp_path):
    result, seen = _call_retry_finance(monkeypatch, _retry_finance_run(tmp_path / "deleted"), "payscool")
    assert result["pending"] is False
    assert seen["finance_names"] is None
    assert result["per_combo_results"] is None
