"""Regression test: year-admin-data WRITE responses must carry the same carry-forward
(inherited) client_status / service_type as the GET does.

Bug: a school whose תשפ"ז row had no service_type/client_status (shown via inheritance
from תשפ"ו) lost both from the school card the moment any other ליווי field (order
method, meeting allocation, meeting duration...) was saved — the PUT returned the raw
row (nulls) and the frontend replaced its state with it.

Runs against the live Supabase project, on the developer's sandbox org (ORG_B) school
only. Every field the test touches is snapshotted first and restored in `finally`.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import app  # noqa: E402
from auth import get_current_user  # noqa: E402
from supabase_client import get_admin_client  # noqa: E402

# Sandbox org (safe for writes) — same ids as tests/security/conftest.py.
ORG_B_ID = "b716cf8c-7b35-44f8-98ff-e0a1cc584d72"
ORG_B_OWNER_ID = "616b3e32-b981-4cf9-a448-ef18cf7e475f"
SCHOOL_ID = "07dd3331-0197-4ce0-8aae-ed1f3590c302"

PREV_YEAR = "תשפ\"ו"
CUR_YEAR = "תשפ\"ז"
TOUCHED = ("service_type", "client_status", "meeting_allocation_gefen", "order_method")


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: {
        "id": ORG_B_OWNER_ID, "org_id": ORG_B_ID, "role": "owner",
    }
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def _row(db, year):
    res = (
        db.table("school_year_admin_data").select("*")
        .eq("school_id", SCHOOL_ID).eq("academic_year", year).execute()
    )
    return res.data[0] if res.data else None


@pytest.fixture
def inherited_state():
    """Prev year: service_type/client_status set. Current year: row exists, both empty."""
    db = get_admin_client()
    snapshot = {y: _row(db, y) for y in (PREV_YEAR, CUR_YEAR)}
    try:
        db.table("school_year_admin_data").upsert(
            {"school_id": SCHOOL_ID, "academic_year": PREV_YEAR,
             "service_type": "gefen_current", "client_status": "active"},
            on_conflict="school_id,academic_year",
        ).execute()
        db.table("school_year_admin_data").upsert(
            {"school_id": SCHOOL_ID, "academic_year": CUR_YEAR,
             "service_type": None, "client_status": None},
            on_conflict="school_id,academic_year",
        ).execute()
        yield db
    finally:
        for year, original in snapshot.items():
            if original is None:
                db.table("school_year_admin_data").delete() \
                    .eq("school_id", SCHOOL_ID).eq("academic_year", year).execute()
            else:
                db.table("school_year_admin_data").update(
                    {f: original.get(f) for f in TOUCHED}
                ).eq("id", original["id"]).execute()


def test_get_shows_inherited_values(client, inherited_state):
    data = client.get(f"/schools/{SCHOOL_ID}/year-admin-data", params={"academic_year": CUR_YEAR}).json()
    assert data["service_type"] == "gefen_current"
    assert data["client_status"] == "active"


def test_put_other_field_keeps_inherited_values(client, inherited_state):
    resp = client.put(
        f"/schools/{SCHOOL_ID}/year-admin-data",
        json={"meeting_allocation_gefen": 7},
        params={"academic_year": CUR_YEAR},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["meeting_allocation_gefen"] == 7
    assert data["service_type"] == "gefen_current", "PUT response dropped inherited service_type"
    assert data["client_status"] == "active", "PUT response dropped inherited client_status"
    # The DB row itself must stay un-materialized (inheritance semantics unchanged).
    raw = _row(inherited_state, CUR_YEAR)
    assert raw["service_type"] is None and raw["client_status"] is None


def test_put_explicit_value_wins_over_inheritance(client, inherited_state):
    resp = client.put(
        f"/schools/{SCHOOL_ID}/year-admin-data",
        json={"service_type": "current"},
        params={"academic_year": CUR_YEAR},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["service_type"] == "current"
    assert data["client_status"] == "active"


def test_bulk_put_keeps_inherited_values(client, inherited_state):
    resp = client.put(
        "/schools/year-admin-data/bulk",
        json={"field": "order_method", "academic_year": CUR_YEAR,
              "items": [{"school_id": SCHOOL_ID, "value": ["private"]}]},
    )
    assert resp.status_code == 200, resp.text
    updated = {u["school_id"]: u["data"] for u in resp.json()["updated"]}
    assert updated[SCHOOL_ID]["order_method"] == ["private"]
    assert updated[SCHOOL_ID]["service_type"] == "gefen_current"
    assert updated[SCHOOL_ID]["client_status"] == "active"
