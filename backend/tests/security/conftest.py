"""Shared fixtures for the IDOR / cross-org regression suite.

Strategy: import the real FastAPI `app` and override the `get_current_user`
dependency so tests can simulate "a manager in org A" or "an owner in org B"
calling any endpoint, with no real Supabase login. Only the AUTHENTICATION
layer is bypassed — the authorization logic under test (the org_id checks
added by this security audit) runs for real against the real Supabase data
via the already-configured service_role client.
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure `backend/` is importable the same way main.py expects (bare
# `from routers.x import router`-style imports), regardless of how pytest
# was invoked.
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import app  # noqa: E402
from auth import get_current_user  # noqa: E402
from supabase_client import get_admin_client  # noqa: E402


@pytest.fixture
def admin_db():
    """Direct service_role Supabase client, for test-side cleanup of side effects a real
    endpoint call causes beyond the row it directly returns/creates (e.g. a notification
    row inserted as a side effect of POST /schools/{id}/advisors) — NOT for use in
    assertions (those must always go through the HTTP client, to exercise the real
    authorization checks under test)."""
    return get_admin_client()


# ---------------------------------------------------------------------------
# Real fixture data (read-only, fetched from the live Supabase project).
# ---------------------------------------------------------------------------

# Org A — "ssprotect", a real customer org. READ-ONLY in every test that
# touches it — never perform a write/mutate test against this org.
ORG_A_ID = "4e0221ff-3596-452f-a6f7-462520d69ee6"
ORG_A_MANAGER_ID = "690c3918-2b1c-4b3a-9e2f-62794cd9862a"
ORG_A_SCHOOL_ID = "4c467548-9b64-4633-8547-9f3ecd7d25f3"
# The actual school_id these two child-resource ids belong to (confirmed via
# a direct read-only Supabase query — NOT the same as ORG_A_SCHOOL_ID above,
# but still verified to be an org-A school):
ORG_A_LOG_ID = "890032a1-ee41-474c-bd05-223cb0f48b2e"
ORG_A_LOG_SCHOOL_ID = "00b2148c-d45b-41d3-9b6b-5067a938f35d"
ORG_A_MEETING_ID = "046df489-54ae-4b11-ad0f-41f158324b45"
ORG_A_MEETING_SCHOOL_ID = "73ade713-718b-4f78-a177-4e5c170f2db8"
# A real, completed (status="done") run_states row whose _school_ctx.school_id resolves to
# an org-A school — confirmed via a direct read-only Supabase query against run_states JOIN
# schools. Used by the analyze_router run_id-keyed download endpoints (all GET, read-only).
ORG_A_RUN_ID = "8b519b4e-2ec4-4fd0-a583-78ae348439e2"

# Org B — the developer's own non-customer sandbox org. Safe for read AND
# write/mutate tests.
ORG_B_ID = "b716cf8c-7b35-44f8-98ff-e0a1cc584d72"
ORG_B_OWNER_ID = "616b3e32-b981-4cf9-a448-ef18cf7e475f"
ORG_B_MANAGER_ID = "c2de1a78-c807-41c2-90d3-0f6f191f7171"
ORG_B_SCHOOL_ID = "07dd3331-0197-4ce0-8aae-ed1f3590c302"


def _user(user_id: str, org_id: str, role: str) -> dict:
    return {"id": user_id, "org_id": org_id, "role": role}


ORG_A_MANAGER_USER = _user(ORG_A_MANAGER_ID, ORG_A_ID, "manager")
ORG_B_OWNER_USER = _user(ORG_B_OWNER_ID, ORG_B_ID, "owner")
ORG_B_MANAGER_USER = _user(ORG_B_MANAGER_ID, ORG_B_ID, "manager")


class _UserScopedClient:
    """Thin wrapper around TestClient that re-binds the `get_current_user`
    override to THIS client's user immediately before every request.

    Why this is needed: `app.dependency_overrides` is a single global dict on
    the shared `app` object. If a test holds two TestClient instances (e.g.
    org_a_client and org_b_client, to compare cross-org behavior in one
    test), creating the second client overwrites the override that the first
    client's calls would resolve against — FastAPI reads the override at
    REQUEST time, not at TestClient-construction time. Without this
    re-binding, a request made on "org_b_client" after "org_a_client" was
    constructed would silently run authenticated as org A's user instead of
    org B's, producing confusing false results. Re-binding right before each
    request keeps each client's identity correct regardless of creation/call
    order, as long as calls themselves are sequential (they are, in sync
    pytest tests).
    """

    def __init__(self, user: dict):
        self._user = user
        self._client = TestClient(app)

    def _bind(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: self._user

    def get(self, *args, **kwargs):
        self._bind()
        return self._client.get(*args, **kwargs)

    def post(self, *args, **kwargs):
        self._bind()
        return self._client.post(*args, **kwargs)

    def put(self, *args, **kwargs):
        self._bind()
        return self._client.put(*args, **kwargs)

    def patch(self, *args, **kwargs):
        self._bind()
        return self._client.patch(*args, **kwargs)

    def delete(self, *args, **kwargs):
        self._bind()
        return self._client.delete(*args, **kwargs)


@pytest.fixture
def make_client():
    """Factory fixture: make_client(user_dict) -> a client authenticated as that user.
    Clears the dependency override after the test so state never leaks between tests."""

    def _make(user: dict) -> _UserScopedClient:
        return _UserScopedClient(user)

    yield _make

    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def org_a_client(make_client):
    """A manager in Org A ('ssprotect', real customer data) — READ-ONLY use only."""
    return make_client(ORG_A_MANAGER_USER)


@pytest.fixture
def org_b_client(make_client):
    """An owner in Org B (developer sandbox) — safe for read + write tests."""
    return make_client(ORG_B_OWNER_USER)


@pytest.fixture
def org_b_manager_client(make_client):
    """A manager in Org B (developer sandbox) — safe for read + write tests."""
    return make_client(ORG_B_MANAGER_USER)
