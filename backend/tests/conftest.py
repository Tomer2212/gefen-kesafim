"""Shared test setup. Keeps tests from counting fake sends in the live email_send_log (a test
that runs the real send_resend_email with a mocked Resend would otherwise insert a row whenever
the environment has real Supabase credentials, e.g. next to tests/security)."""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(autouse=True)
def _no_live_email_send_log(request, monkeypatch):
    if request.node.get_closest_marker("real_record_send"):
        return
    import email_resend
    monkeypatch.setattr(email_resend, "_record_send", lambda *_a, **_k: None)


def pytest_configure(config):
    config.addinivalue_line("markers", "real_record_send: run email_resend._record_send itself (with a fake db)")
