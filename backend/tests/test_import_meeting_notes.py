"""The meeting import's "הערות" column lands in the notes window (meeting_notes), not only in the
legacy meetings.notes column that no screen shows (schools_router._import_meeting_notes).

Fully offline: an in-memory stand-in for the Supabase client.
"""
import sys
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers.schools_router import _import_meeting_notes  # noqa: E402

USER = {"id": "u-1", "org_id": "org-1"}


class _Insert:
    def __init__(self, db, rows):
        self.db, self.rows = db, rows

    def execute(self):
        if self.db.fail:
            raise RuntimeError("insert failed")
        out = [{"id": str(uuid.uuid4()), **r} for r in self.rows]
        self.db.inserted.extend(out)
        return type("R", (), {"data": out})()


class FakeDB:
    def __init__(self, fail=False):
        self.fail, self.inserted, self.tables = fail, [], []

    def table(self, name):
        self.tables.append(name)
        return type("T", (), {"insert": lambda _self, rows: _Insert(self, rows)})()


def test_notes_are_added_without_author_and_logged():
    db = FakeDB()
    events = _import_meeting_notes(db, [
        {"meeting_id": "m-1", "school_id": "s-1", "content": "להביא תיקיית תכנון"},
        {"meeting_id": "m-2", "school_id": "s-1", "content": "מנהלת חדשה"},
    ], USER, "batch-1")
    assert set(db.tables) == {"meeting_notes"}
    assert [(n["meeting_id"], n["content"], n["author_id"]) for n in db.inserted] == [
        ("m-1", "להביא תיקיית תכנון", None), ("m-2", "מנהלת חדשה", None)]
    assert len({n["group_id"] for n in db.inserted}) == 2  # each its own note
    assert [(e["meeting_id"], e["action"], e["source"], e["actor_id"]) for e in events] == [
        ("m-1", "note_added", "import", "u-1"), ("m-2", "note_added", "import", "u-1")]
    assert events[0]["meta"]["import_batch_id"] == "batch-1"


def test_no_notes_no_insert():
    db = FakeDB()
    assert _import_meeting_notes(db, [], USER, "batch-1") == []
    assert db.tables == []


def test_failed_insert_does_not_break_the_import():
    db = FakeDB(fail=True)
    assert _import_meeting_notes(db, [{"meeting_id": "m-1", "school_id": "s-1", "content": "x"}], USER, "b") == []


def test_large_imports_are_chunked():
    db = FakeDB()
    notes = [{"meeting_id": f"m-{i}", "school_id": "s-1", "content": "x"} for i in range(1201)]
    assert len(_import_meeting_notes(db, notes, USER, "b")) == 1201
    assert db.tables.count("meeting_notes") == 3
