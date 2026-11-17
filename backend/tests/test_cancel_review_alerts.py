"""Daily "בוטלה — טרם נבדקה" alerts (cancel_review_alerts.py): send window, one alert per
meeting per day, first vs. reminder wording, resolution (alerts marked read), only cancellations
after enabling, imports excluded, a new cancellation starts over, orgs with the feature off.

Fully offline: an in-memory stand-in for the Supabase client; nothing real is read or written.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import cancel_review_alerts as cra  # noqa: E402

IL = ZoneInfo("Asia/Jerusalem")
ORG, OTHER_ORG = "org-1", "org-2"
OWNER, MANAGER, STRANGER = "u-owner", "u-manager", "u-other-org"
SCHOOL, MEETING = "s-1", "m-1"


def _get(row, col):
    if "->" not in col:
        return row.get(col)
    parts = col.replace("->>", "->").split("->")
    v = row.get(parts[0])
    for p in parts[1:]:
        v = (v or {}).get(p) if isinstance(v, dict) else None
    return v


def _ts(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: _get(r, col) == val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and _ts(r[col]) >= _ts(val))
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def is_(self, col, val):
        assert val == "null"
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def or_(self, expr):
        # Only the shape the module uses: "<col>.is.null,<col>.neq.<value>"
        conds = []
        for part in expr.split(","):
            col, op, val = part.split(".", 2)
            conds.append((col, op, val))

        def match(r):
            for col, op, val in conds:
                if op == "is" and val == "null" and r.get(col) is None:
                    return True
                if op == "neq" and r.get(col) is not None and str(r.get(col)) != val:
                    return True
            return False
        self.filters.append(match)
        return self

    def single(self):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            for r in new:
                rows.append({"id": str(uuid.uuid4()), "alerts_sent": 0, "last_alerted_on": None,
                             "resolved_at": None, "read_at": None, **r})
            return type("R", (), {"data": new})()
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        return type("R", (), {"data": [dict(r) for r in hit]})()


class FakeDB:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        return _Query(self, name)


def _il(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=IL).astimezone(timezone.utc)


# Sunday 2026-11-15 10:00 Israel
SUN_10 = _il(2026, 11, 15, 10)
ENABLED_AT = _il(2026, 11, 15, 9)


def _db(enabled=True, status="cancelled"):
    db = FakeDB()
    db.tables["organizations"] = [
        {"id": ORG, "cancel_review_alerts_enabled": enabled,
         "cancel_review_alert_recipient_ids": [OWNER, MANAGER, STRANGER],
         "cancel_review_scan_after": ENABLED_AT.isoformat()},
    ]
    db.tables["profiles"] = [
        {"id": OWNER, "org_id": ORG}, {"id": MANAGER, "org_id": ORG}, {"id": STRANGER, "org_id": OTHER_ORG},
    ]
    db.tables["schools"] = [{"id": SCHOOL, "name": "אורט"}]
    db.tables["meetings"] = [{"id": MEETING, "status": status, "school_id": SCHOOL,
                              "meeting_date": "2026-11-20", "academic_year": 'תשפ"ז'}]
    db.tables["meeting_activity"] = []
    db.tables["notifications"] = []
    db.tables[cra.ALERTS_TABLE] = []
    return db


def _cancel_event(db, at, source="school_card", action="updated", meeting=MEETING):
    ev = {"id": str(uuid.uuid4()), "org_id": ORG, "meeting_id": meeting, "school_id": SCHOOL,
          "source": source, "action": action, "created_at": at.isoformat()}
    if action == "created":
        ev["snapshot"] = {"status": "cancelled"}
        ev["changes"] = {}
    else:
        ev["changes"] = {"status": {"from": "scheduled", "to": "cancelled"}}
    db.tables["meeting_activity"].append(ev)


def _notifs(db):
    return db.tables["notifications"]


@pytest.mark.parametrize("dt, expected", [
    (datetime(2026, 11, 15, 7, 59, tzinfo=IL), False),   # Sunday before 08:00
    (datetime(2026, 11, 15, 8, 0, tzinfo=IL), True),
    (datetime(2026, 11, 19, 19, 59, tzinfo=IL), True),   # Thursday
    (datetime(2026, 11, 19, 20, 0, tzinfo=IL), False),
    (datetime(2026, 11, 20, 14, 59, tzinfo=IL), True),   # Friday
    (datetime(2026, 11, 20, 15, 0, tzinfo=IL), False),
    (datetime(2026, 11, 21, 10, 0, tzinfo=IL), False),   # Saturday
])
def test_send_window(dt, expected):
    assert cra.in_send_window(dt) is expected


def test_first_alert_then_once_a_day_then_reminder_wording():
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    cra.run_cancel_review_alerts(db, now=SUN_10)
    first = _notifs(db)
    assert {n["recipient_id"] for n in first} == {OWNER, MANAGER}  # other-org user never alerted
    assert all(n["type"] == cra.NOTIFICATION_TYPE and n["ref_id"] == MEETING for n in first)
    assert first[0]["data"]["title"].startswith("הפגישה עם אורט מ-20/11/2026 בוטלה.")
    assert first[0]["data"]["deeplink"].startswith(f"/school/{SCHOOL}?tab=meetings&year=")

    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(minutes=5))
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(hours=6))
    assert len(_notifs(db)) == 2  # nothing more the same day

    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(days=1))
    assert len(_notifs(db)) == 4
    assert _notifs(db)[-1]["data"]["title"].startswith("תזכורת: הפגישה עם אורט מ-20/11/2026 בוטלה אתמול")


def test_outside_window_waits_for_next_window():
    db = _db()
    sat_night = _il(2026, 11, 21, 22)
    _cancel_event(db, sat_night - timedelta(minutes=10))
    db.tables["organizations"][0]["cancel_review_scan_after"] = (sat_night - timedelta(hours=1)).isoformat()
    cra.run_cancel_review_alerts(db, now=sat_night)
    assert _notifs(db) == []
    cra.run_cancel_review_alerts(db, now=_il(2026, 11, 22, 8, 0))
    assert len(_notifs(db)) == 2


def test_reviewed_meeting_resolves_and_marks_alerts_read():
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    cra.run_cancel_review_alerts(db, now=SUN_10)
    db.tables["meetings"][0]["status"] = "cancelled_reviewed"
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(minutes=5))
    assert all(n["read_at"] for n in _notifs(db))
    assert db.tables[cra.ALERTS_TABLE][0]["resolved_at"]
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(days=1))
    assert len(_notifs(db)) == 2  # no more alerts


def test_deleted_meeting_resolves_too():
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    cra.run_cancel_review_alerts(db, now=SUN_10)
    db.tables["meetings"] = []
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(minutes=5))
    assert all(n["read_at"] for n in _notifs(db))


def test_cancellation_before_enabling_and_imports_are_ignored():
    db = _db()
    _cancel_event(db, ENABLED_AT - timedelta(minutes=1))
    _cancel_event(db, SUN_10 - timedelta(minutes=5), source="import", action="created")
    cra.run_cancel_review_alerts(db, now=SUN_10)
    assert _notifs(db) == []
    assert db.tables[cra.ALERTS_TABLE] == []


def test_created_as_cancelled_from_a_screen_counts():
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=5), action="created")
    cra.run_cancel_review_alerts(db, now=SUN_10)
    assert len(_notifs(db)) == 2


def test_cancelled_again_starts_over():
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    cra.run_cancel_review_alerts(db, now=SUN_10)
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(days=1))  # reminder sent
    db.tables["meetings"][0]["status"] = "scheduled"
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(days=1, minutes=5))  # resolved
    db.tables["meetings"][0]["status"] = "cancelled"
    _cancel_event(db, SUN_10 + timedelta(days=1, minutes=8))
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(days=1, minutes=10))
    last = _notifs(db)[-1]["data"]["title"]
    assert last.startswith("הפגישה עם אורט")  # first-alert wording again
    assert len(_notifs(db)) == 6


def test_feature_off_sends_nothing():
    db = _db(enabled=False)
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    cra.run_cancel_review_alerts(db, now=SUN_10)
    assert _notifs(db) == []


def test_failed_insert_is_retried_not_marked_sent(monkeypatch):
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    real_table = db.table

    def flaky_table(name):
        q = real_table(name)
        if name == "notifications":
            orig = q.execute

            def boom():
                if q.op == "insert":
                    raise RuntimeError("insert failed")
                return orig()
            q.execute = boom
        return q
    db.table = flaky_table
    summary = cra.run_cancel_review_alerts(db, now=SUN_10)
    assert summary["failed_orgs"] == 1
    row = db.tables[cra.ALERTS_TABLE][0]
    assert row["alerts_sent"] == 0 and row["last_alerted_on"] is None
    db.table = real_table
    cra.run_cancel_review_alerts(db, now=SUN_10 + timedelta(minutes=5))
    assert len(_notifs(db)) == 2


def test_overlapping_runs_alert_only_once():
    """pg_cron and the GitHub backup can run at the same minute: both may read the row as not
    alerted today, but only the one whose claim succeeds sends."""
    db = _db()
    _cancel_event(db, SUN_10 - timedelta(minutes=30))
    org = db.tables["organizations"][0]
    cra._record_new_cancellations(db, org, SUN_10)
    _, pending_a = cra._resolve_and_collect_pending(db, ORG, SUN_10)
    _, pending_b = cra._resolve_and_collect_pending(db, ORG, SUN_10)  # same stale snapshot
    now_il = SUN_10.astimezone(IL)
    assert cra._send_alerts(db, org, pending_a, now_il) == 1
    assert cra._send_alerts(db, org, pending_b, now_il) == 0
    assert len(_notifs(db)) == 2
