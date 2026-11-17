"""/platform (superadmin "שימוש ומכסות"): it shows every org's email counts, so only a superadmin
may read it, an owner/manager of any org is rejected, and the cron/Claude endpoints refuse calls
without X-Cron-Secret. Read-only against the live project (no settings are changed)."""
from conftest import ORG_A_MANAGER_USER, ORG_B_OWNER_USER


def test_usage_rejects_org_owner_and_manager(make_client):
    for user in (ORG_B_OWNER_USER, ORG_A_MANAGER_USER):
        res = make_client({**user, "is_superadmin": False}).get("/platform/usage")
        assert res.status_code == 403, res.text


def test_usage_allows_superadmin(make_client):
    res = make_client({**ORG_B_OWNER_USER, "is_superadmin": True}).get("/platform/usage")
    assert res.status_code == 200, res.text
    body = res.json()
    assert {"resend", "supabase", "render", "manual_checks"} <= set(body)


def test_settings_rejects_non_superadmin(make_client):
    res = make_client({**ORG_B_OWNER_USER, "is_superadmin": False}).put("/platform/settings", json={"resend_cycle_day": 12})
    assert res.status_code == 403, res.text


def test_cron_endpoints_require_secret(make_client):
    client = make_client({**ORG_B_OWNER_USER, "is_superadmin": True})
    for path in ("/platform/hourly-tick", "/platform/daily-check", "/platform/manual-check-reminder"):
        assert client.post(path).status_code == 401, path
    res = client.post("/platform/manual-check", json={"status": "ok", "values": {}, "verdict": "x"},
                      headers={"X-Cron-Secret": "wrong"})
    assert res.status_code == 401
