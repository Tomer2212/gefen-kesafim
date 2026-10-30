"""Regression test for the auto-pagination patch in supabase_client.py.

Read-only, against the live Supabase project. PostgREST silently caps every response at
1,000 rows (db-max-rows); the patch re-fetches in stable, primary-key-ordered pages when a
GET hits that cap. `meetings` already holds several thousand rows, so it exercises the real
cap. If a postgrest-py upgrade silently disables the patch, these tests fail.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR.parent / ".env")

from supabase_client import POSTGREST_MAX_ROWS, TABLE_PRIMARY_KEYS, get_admin_client  # noqa: E402


def _meetings_total(db) -> int:
    return db.table("meetings").select("id", count="exact").limit(1).execute().count


def test_unlimited_select_returns_every_row():
    db = get_admin_client()
    total = _meetings_total(db)
    assert total > POSTGREST_MAX_ROWS, "fixture assumption: meetings must exceed the row cap"
    rows = db.table("meetings").select("id").execute().data
    ids = [r["id"] for r in rows]
    assert len(ids) == total
    assert len(set(ids)) == total  # no row repeated across pages


def test_non_unique_order_has_no_gaps_or_duplicates():
    db = get_admin_client()
    total = _meetings_total(db)
    rows = db.table("meetings").select("id, meeting_date").order("meeting_date", desc=True).execute().data
    assert len(rows) == total
    assert len({r["id"] for r in rows}) == total
    dates = [r["meeting_date"] for r in rows if r["meeting_date"] is not None]
    assert dates == sorted(dates, reverse=True)


def test_explicit_limit_above_cap_is_honoured():
    db = get_admin_client()
    want = POSTGREST_MAX_ROWS * 2 + 345
    rows = db.table("meetings").select("id").order("id").limit(want).execute().data
    assert len(rows) == want
    ids = [r["id"] for r in rows]
    assert ids == sorted(ids)


def test_small_and_explicit_page_queries_unchanged():
    db = get_admin_client()
    assert len(db.table("meetings").select("id").limit(10).execute().data) == 10
    ref = db.table("meetings").select("id").order("id").limit(30).execute().data
    page = db.table("meetings").select("id").order("id").range(10, 19).execute().data
    assert page == ref[10:20]


def test_chunked_in_filter_combined_with_paging():
    """A big in_() list whose chunks each exceed the row cap (both patches at once)."""
    db = get_admin_client()
    school_ids = [r["id"] for r in db.table("schools").select("id").execute().data]
    expected = db.table("meetings").select("id", count="exact").limit(1).execute().count
    rows = db.table("meetings").select("id, school_id").in_("school_id", school_ids).execute().data
    assert len({r["id"] for r in rows}) == len(rows)
    # every meeting belongs to some school, so the in_() over all schools must return them all
    assert len(rows) == expected


def test_primary_key_map_matches_database():
    """TABLE_PRIMARY_KEYS must list every table whose PK isn't a single `id` column — the
    paging tie-breaker would otherwise reference a column that doesn't exist (query error)."""
    pat = os.getenv("SUPABASE_PAT", "").strip().strip('"')
    url = os.getenv("SUPABASE_URL", "").strip().strip('"')
    if not pat or not url:
        pytest.skip("SUPABASE_PAT / SUPABASE_URL not set")
    ref = re.match(r"https://([^.]+)\.", url).group(1)
    sql = (
        "select tc.table_name, string_agg(kcu.column_name, ',' order by kcu.ordinal_position) pk "
        "from information_schema.table_constraints tc join information_schema.key_column_usage kcu "
        "on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema "
        "where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' group by 1"
    )
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json", "User-Agent": "tests"},
    )
    db_pks = {r["table_name"]: tuple(r["pk"].split(",")) for r in json.loads(urllib.request.urlopen(req).read())}
    non_id = {t: pk for t, pk in db_pks.items() if pk != ("id",)}
    assert non_id == TABLE_PRIMARY_KEYS
