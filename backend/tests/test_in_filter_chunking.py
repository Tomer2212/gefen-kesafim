"""Regression test for the `.in_()` auto-chunking patch in supabase_client.py.

Read-only, against the live Supabase project. Supabase's gateway rejects a request URL
carrying ~650+ UUIDs in one `in.(...)` filter (400 Bad Request); the patch splits such
filters into several requests and merges the results. If a postgrest-py upgrade changes
its internals and the patch silently stops applying, the first test fails.
"""
import sys
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR.parent / ".env")

from supabase_client import get_admin_client  # noqa: E402

OVERSIZED = 1500  # well past the ~650-UUID gateway limit


def _all_school_ids(db):
    return [r["id"] for r in db.table("schools").select("id").order("id").range(0, 999).execute().data]


def test_oversized_in_filter_returns_every_match():
    db = get_admin_client()
    ids = _all_school_ids(db)
    big = ids + [str(uuid.uuid4()) for _ in range(OVERSIZED)]
    rows = db.table("schools").select("id").in_("id", big).execute().data
    assert sorted(r["id"] for r in rows) == sorted(ids)


def test_oversized_in_filter_respects_order_range_and_count():
    db = get_admin_client()
    ids = _all_school_ids(db)
    big = ids + [str(uuid.uuid4()) for _ in range(OVERSIZED)]
    page = db.table("schools").select("id").in_("id", big).order("id").range(10, 29).execute().data
    assert [r["id"] for r in page] == ids[10:30]
    top = db.table("schools").select("id").in_("id", big).order("id", desc=True).limit(5).execute().data
    assert [r["id"] for r in top] == list(reversed(ids))[:5]
    res = db.table("schools").select("id", count="exact").in_("id", big).limit(1).execute()
    assert res.count == len(ids)


def test_small_and_negated_in_filters_unchanged():
    db = get_admin_client()
    ids = _all_school_ids(db)
    assert len(db.table("schools").select("id").in_("id", ids[:20]).execute().data) == 20
    excluded = db.table("schools").select("id").not_.in_("id", ids[:10]).order("id").limit(5).execute().data
    assert not {r["id"] for r in excluded} & set(ids[:10])
