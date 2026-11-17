"""Superadmin capacity monitoring: every Resend send is counted per org with Resend's own monthly
quota header, the daily check alerts once per level, and the weekly manual check reminds at
09/12/15 on work days until Claude records it. Fully offline."""
import sys
from datetime import datetime
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import email_resend  # noqa: E402
import supabase_client  # noqa: E402
from fake_supabase import FakeDb  # noqa: E402
from routers import platform_usage_router as pu  # noqa: E402


class _Resp:
    def __init__(self, status=200, headers=None):
        self.status_code, self.headers = status, headers or {}

    def json(self):
        return {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=httpx.Request("POST", "https://x"), response=None)


@pytest.fixture
def resend_ok(monkeypatch):
    monkeypatch.setattr(email_resend, "RESEND_API_KEY", "k")

    def install(resp):
        monkeypatch.setattr(email_resend.httpx, "post", lambda *a, **k: resp)
    return install


@pytest.mark.real_record_send
def test_send_is_logged_with_org_kind_and_resend_quota(resend_ok, monkeypatch):
    db = FakeDb({"email_send_log": []})
    monkeypatch.setattr(supabase_client, "get_admin_client", lambda: db)
    resend_ok(_Resp(200, {"x-resend-monthly-quota": "1234"}))
    email_resend.send_resend_email("a@x.com", "s", "h", org_id="o1", kind="reminder")
    rows = db.tables["email_send_log"]
    assert len(rows) == 1
    assert (rows[0]["org_id"], rows[0]["kind"], rows[0]["resend_monthly_used"]) == ("o1", "reminder", 1234)


@pytest.mark.real_record_send
def test_log_failure_never_fails_the_send(resend_ok, monkeypatch):
    def boom():
        raise RuntimeError("db down")
    monkeypatch.setattr(supabase_client, "get_admin_client", boom)
    resend_ok(_Resp(200))
    email_resend.send_resend_email("a@x.com", "s", "h", org_id="o1", kind="task")  # must not raise


@pytest.mark.real_record_send
def test_failed_send_is_not_logged(resend_ok, monkeypatch):
    db = FakeDb({"email_send_log": []})
    monkeypatch.setattr(supabase_client, "get_admin_client", lambda: db)
    resend_ok(_Resp(500))
    with pytest.raises(httpx.HTTPStatusError):
        email_resend.send_resend_email("a@x.com", "s", "h", org_id="o1", kind="task")
    assert db.tables["email_send_log"] == []


def _il(y, m, d, h=10):
    return datetime(y, m, d, h, tzinfo=pu.IL_TZ)


@pytest.mark.parametrize("now,start,end", [
    (_il(2026, 11, 16), "2026-11-12", "2026-12-12"),
    (_il(2026, 11, 12, 0), "2026-11-12", "2026-12-12"),
    (_il(2026, 11, 11), "2026-10-12", "2026-11-12"),
    (_il(2027, 1, 5), "2026-12-12", "2027-01-12"),
])
def test_cycle_bounds_follow_the_billing_day(now, start, end):
    s, e = pu._cycle_bounds(12, now)
    assert (s.date().isoformat(), e.date().isoformat()) == (start, end)


def _resend(pct, projected=0, limit=50000):
    return {"pct": pct, "used": int(limit * pct / 100), "limit": limit, "cycle_start": "2026-11-12",
            "renews_on": "2026-12-12", "projected": projected, "daily_rate": 1}


def test_evaluate_resend_levels_and_projection():
    assert pu._evaluate(_resend(10), {}, {}) == []
    assert pu._evaluate(_resend(72), {}, {})[0]["level"] == 70
    assert pu._evaluate(_resend(96), {}, {})[0]["level"] == 95
    proj = pu._evaluate(_resend(20, projected=60000), {}, {})
    assert proj[0]["key"].startswith("resend-projection")


def test_evaluate_memory_severe_matches_supabase_rule():
    total = 428_351_488
    severe_at = 0.9 * total + 1024 ** 3
    mem = {"committed_bytes": severe_at + 1, "severe_at_bytes": severe_at, "commit_pct_of_severe": 101}
    issues = pu._evaluate({}, {"memory": mem}, {})
    assert issues and issues[0]["key"] == "supabase-memory" and issues[0]["level"] == 100


def test_daily_check_alerts_each_level_once(monkeypatch):
    db = FakeDb({"platform_settings": [{"id": 1, "alert_state": {}}], "profiles": [], "notifications": []})
    emails = []
    monkeypatch.setattr(pu, "_send_simple_email", lambda to, subj, html, **_k: emails.append(to))
    monkeypatch.setattr(pu, "_resend_section", lambda *_a: _resend(72))
    monkeypatch.setattr(pu, "_supabase_section", lambda *_a: {})
    monkeypatch.setattr(pu, "_render_section", lambda *_a: {})
    pu._run_daily_check(db)
    pu._run_daily_check(db)
    assert emails == [pu.ALERT_EMAIL]
    monkeypatch.setattr(pu, "_resend_section", lambda *_a: _resend(90))
    pu._run_daily_check(db)
    assert len(emails) == 2


def test_manual_reminder_only_at_set_hours_on_workdays_until_done(monkeypatch):
    db = FakeDb({"platform_manual_checks": []})
    sent = []
    monkeypatch.setattr(pu, "_send_simple_email", lambda to, subj, html, **_k: sent.append(to))
    sunday_9, sunday_10, friday_9 = _il(2026, 11, 15, 9), _il(2026, 11, 15, 10), _il(2026, 11, 20, 9)
    assert pu._run_manual_reminder(db, sunday_10)["reason"] == "not_due"
    assert pu._run_manual_reminder(db, friday_9)["reason"] == "not_due"
    assert pu._run_manual_reminder(db, sunday_9)["sent"] is True
    assert pu._run_manual_reminder(db, sunday_9)["reason"] == "already_sent"
    assert sent == [pu.MANUAL_REMINDER_EMAIL]
    db.tables["platform_manual_checks"][0]["status"] = "ok"
    assert pu._run_manual_reminder(db, _il(2026, 11, 15, 12))["reason"] == "done"


def test_week_start_is_sunday():
    assert pu._week_start(_il(2026, 11, 19)).isoformat() == "2026-11-15"   # Thursday
    assert pu._week_start(_il(2026, 11, 15)).isoformat() == "2026-11-15"   # Sunday
    assert pu._week_start(_il(2026, 11, 21)).isoformat() == "2026-11-15"   # Saturday


def test_failed_alert_email_is_retried_not_marked_sent(monkeypatch):
    db = FakeDb({"platform_settings": [{"id": 1, "alert_state": {}}], "profiles": [], "notifications": []})
    monkeypatch.setattr(pu, "_resend_section", lambda *_a: _resend(72))
    monkeypatch.setattr(pu, "_supabase_section", lambda *_a: {})
    monkeypatch.setattr(pu, "_render_section", lambda *_a: {})

    def smtp_down(*_a, **_k):
        raise OSError("smtp down")
    monkeypatch.setattr(pu, "_send_simple_email", smtp_down)
    with pytest.raises(OSError):
        pu._run_daily_check(db)
    assert db.tables["platform_settings"][0]["alert_state"] == {}
    assert not db.tables["platform_settings"][0].get("last_daily_check_at")
    sent = []
    monkeypatch.setattr(pu, "_send_simple_email", lambda to, *_a, **_k: sent.append(to))
    pu._run_daily_check(db)
    assert sent == [pu.ALERT_EMAIL]


def test_render_timestamps_use_z_suffix():
    # Render's metrics API answers 400 to "+00:00" offsets.
    assert pu._render_ts(_il(2026, 11, 1, 0)) == "2026-10-31T22:00:00Z"
