"""Reminders to update meetings still "נקבעה" after their date (overdue_status_alerts.py):
recipients (advisors → creator → owners/managers), which meetings count, the chosen days/hours,
one alert per user per window (overlapping cron runs), the bell holding only the latest alert,
clearing once a user's list is empty, the optional manager summary, settings cleaning.

Fully offline: an in-memory stand-in for the Supabase client; nothing real is read or written.
"""
import sys
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import overdue_status_alerts as osa  # noqa: E402
from academic_years import DEFAULT_ACADEMIC_YEAR  # noqa: E402

IL = ZoneInfo("Asia/Jerusalem")
ORG, OTHER_ORG = "org-1", "org-2"
OWNER, MANAGER, ADV1, ADV2, CREATOR, STRANGER = "u-owner", "u-manager", "u-adv1", "u-adv2", "u-creator", "u-x"
# Sunday 2026-11-22, 08:10 Israel time — inside the default window (Sun–Thu, 08:00–09:00).
SUNDAY_8 = datetime(2026, 11, 22, 8, 10, tzinfo=IL)


def _get(row, col):
    v = row
    for part in col.split("."):
        v = v.get(part) if isinstance(v, dict) else None
    return v


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload, self.opts = db, table, [], "select", None, {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: _get(r, col) == val)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: _get(r, col) is not None and _get(r, col) < val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: _get(r, col) is not None and _get(r, col) >= val)
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filters.append(lambda r: _get(r, col) in vals)
        return self

    def is_(self, col, val):
        assert val == "null"
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict="", ignore_duplicates=False):
        self.op, self.payload, self.opts = "upsert", payload, {"keys": on_conflict.split(","), "ignore": ignore_duplicates}
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op in ("insert", "upsert"):
            if self.table == "notifications" and self.db.fail_notification_insert:
                raise RuntimeError("insert failed")
            out = []
            for r in (self.payload if isinstance(self.payload, list) else [self.payload]):
                if self.op == "upsert":
                    key = tuple(r.get(k) for k in self.opts["keys"])
                    if any(tuple(x.get(k) for k in self.opts["keys"]) == key for x in rows):
                        continue
                new = {"id": str(uuid.uuid4()), "read_at": None, "popup_shown_at": None, **r}
                rows.append(new)
                out.append(new)
            return type("R", (), {"data": out})()
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        elif self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in matched]
        return type("R", (), {"data": matched})()


class FakeDB:
    def __init__(self):
        self.fail_notification_insert = False
        self.tables = {
            "profiles": [
                {"id": OWNER, "org_id": ORG, "role": "owner", "full_name": "בעלים"},
                {"id": MANAGER, "org_id": ORG, "role": "manager", "full_name": "מנהלת"},
                {"id": ADV1, "org_id": ORG, "role": "advisor", "full_name": "יועצת א"},
                {"id": ADV2, "org_id": ORG, "role": "advisor", "full_name": "יועץ ב"},
                {"id": CREATOR, "org_id": ORG, "role": "manager", "full_name": "יוצרת"},
                {"id": STRANGER, "org_id": OTHER_ORG, "role": "advisor", "full_name": "זר"},
            ],
            "organizations": [{"id": ORG, "overdue_status_alerts_enabled": True,
                               "overdue_status_alert_days": [0, 1, 2, 3, 4], "overdue_status_alert_hours": [8],
                               "overdue_summary_enabled": False, "overdue_summary_recipient_ids": [],
                               "overdue_summary_frequency": "weekly", "overdue_summary_weekday": 0,
                               "overdue_summary_hour": 8}],
            "meetings": [],
            "notifications": [],
            osa.ALERTS_TABLE: [],
        }

    def table(self, name):
        return _Query(self, name)

    def add_meeting(self, **kw):
        m = {"id": str(uuid.uuid4()), "school_id": "s-1", "status": "scheduled", "meeting_date": "2026-11-18",
             "academic_year": DEFAULT_ACADEMIC_YEAR, "advisor_ids": [ADV1], "advisor_id": None, "created_by": CREATOR,
             "schools": {"org_id": ORG, "name": "בית ספר", "status": "active", "client_type": "school"}}
        m.update(kw)
        self.tables["meetings"].append(m)
        return m

    @property
    def org(self):
        return self.tables["organizations"][0]

    def notes(self, ntype=osa.NOTIFICATION_TYPE, unread=True):
        return [n for n in self.tables["notifications"] if n["type"] == ntype and (n["read_at"] is None or not unread)]


def _profiles(db):
    return osa.fetch_org_profiles(db, ORG)


# ── recipients ────────────────────────────────────────────────────────────────

def test_recipients_are_the_meetings_advisors():
    db = FakeDB()
    m = db.add_meeting(advisor_ids=[ADV1, ADV2])
    assert osa.recipients_for(m, _profiles(db)) == [ADV1, ADV2]


def test_legacy_single_advisor_field_is_used():
    db = FakeDB()
    m = db.add_meeting(advisor_ids=[], advisor_id=ADV2)
    assert osa.recipients_for(m, _profiles(db)) == [ADV2]


def test_no_advisor_goes_to_the_creator():
    db = FakeDB()
    m = db.add_meeting(advisor_ids=[])
    assert osa.recipients_for(m, _profiles(db)) == [CREATOR]


def test_no_advisor_and_unknown_creator_goes_to_owners_and_managers():
    db = FakeDB()
    m = db.add_meeting(advisor_ids=[], created_by=None)
    assert set(osa.recipients_for(m, _profiles(db))) == {OWNER, MANAGER, CREATOR}


def test_advisor_from_another_org_is_ignored():
    db = FakeDB()
    m = db.add_meeting(advisor_ids=[STRANGER], created_by=STRANGER)
    assert STRANGER not in osa.recipients_for(m, _profiles(db))


# ── which meetings ────────────────────────────────────────────────────────────

def test_only_past_scheduled_meetings_of_the_current_year():
    db = FakeDB()
    due = db.add_meeting()
    db.add_meeting(meeting_date="2026-11-22")  # today — left to auto-completion
    db.add_meeting(status="completed")
    db.add_meeting(academic_year="תשפ\"ו")
    db.add_meeting(schools={"org_id": ORG, "name": "x", "status": "deleted", "client_type": "school"})
    db.add_meeting(schools={"org_id": OTHER_ORG, "name": "x", "status": "active", "client_type": "school"})
    ids = [m["id"] for m in osa.fetch_overdue_meetings(db, ORG, SUNDAY_8.date())]
    assert ids == [due["id"]]


def test_entity_and_directory_meetings_count():
    db = FakeDB()
    db.add_meeting(schools={"org_id": ORG, "name": "מחוז דרום", "status": "entity", "client_type": "district"})
    db.add_meeting(schools={"org_id": ORG, "name": "x", "status": "directory", "client_type": "school"})
    assert len(osa.fetch_overdue_meetings(db, ORG, SUNDAY_8.date())) == 2


# ── schedule ──────────────────────────────────────────────────────────────────

def test_weekday_mapping_is_sunday_zero():
    assert osa.il_weekday(SUNDAY_8.date()) == 0
    assert osa.il_weekday(datetime(2026, 11, 28).date()) == 6  # Saturday


def test_window_follows_the_chosen_days_and_hours():
    org = {"overdue_status_alert_days": [5, 6], "overdue_status_alert_hours": [14]}
    friday_14 = datetime(2026, 11, 27, 14, 30, tzinfo=IL)
    assert osa.personal_window_due(org, friday_14)
    assert not osa.personal_window_due(org, SUNDAY_8)
    assert not osa.personal_window_due(org, friday_14.replace(hour=15))


def test_nothing_sent_outside_the_window():
    db = FakeDB()
    db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8.replace(hour=10))
    assert db.notes() == []


# ── personal alerts ───────────────────────────────────────────────────────────

def test_one_alert_per_user_per_window_even_with_two_runs():
    db = FakeDB()
    db.add_meeting()
    db.add_meeting()
    db.add_meeting(advisor_ids=[ADV2])
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    osa.run_overdue_status_alerts(db, now=SUNDAY_8.replace(minute=15))
    notes = db.notes()
    assert sorted(n["recipient_id"] for n in notes) == [ADV1, ADV2]
    assert next(n for n in notes if n["recipient_id"] == ADV1)["data"]["count"] == 2


def test_new_window_replaces_the_bell_alert():
    db = FakeDB()
    db.org["overdue_status_alert_hours"] = [8, 13]
    db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    osa.run_overdue_status_alerts(db, now=SUNDAY_8.replace(hour=13))
    assert len(db.notes()) == 1
    assert len(db.notes(unread=False)) == 2


def test_popup_due_until_shown():
    db = FakeDB()
    db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    assert osa.popup_due(db, ORG, ADV1, osa.KIND_PERSONAL, SUNDAY_8)
    osa.mark_popup_shown(db, ORG, ADV1, osa.KIND_PERSONAL)
    assert not osa.popup_due(db, ORG, ADV1, osa.KIND_PERSONAL, SUNDAY_8)


def test_cleared_when_the_list_empties():
    db = FakeDB()
    m = db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    m["status"] = "completed"
    osa.run_overdue_status_alerts(db, now=SUNDAY_8.replace(hour=10))
    assert db.notes() == []
    assert not osa.popup_due(db, ORG, ADV1, osa.KIND_PERSONAL, SUNDAY_8)


def test_failed_insert_releases_the_claim():
    db = FakeDB()
    db.add_meeting()
    db.fail_notification_insert = True
    res = osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    assert res["failed_orgs"] == 1
    assert db.tables[osa.ALERTS_TABLE] == []
    db.fail_notification_insert = False
    osa.run_overdue_status_alerts(db, now=SUNDAY_8.replace(minute=15))
    assert len(db.notes()) == 1


def test_org_with_feature_off_gets_nothing():
    db = FakeDB()
    db.org["overdue_status_alerts_enabled"] = False
    db.add_meeting()
    assert osa.run_overdue_status_alerts(db, now=SUNDAY_8)["orgs"] == 0
    assert db.notes() == []


# ── manager summary ───────────────────────────────────────────────────────────

def test_summary_goes_only_to_chosen_owners_and_managers():
    db = FakeDB()
    db.org.update(overdue_summary_enabled=True, overdue_summary_frequency="daily",
                  overdue_summary_recipient_ids=[MANAGER, ADV1, STRANGER])
    db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    assert [n["recipient_id"] for n in db.notes(osa.SUMMARY_NOTIFICATION_TYPE)] == [MANAGER]


def test_weekly_summary_only_on_its_day():
    db = FakeDB()
    db.org.update(overdue_summary_enabled=True, overdue_summary_frequency="weekly", overdue_summary_weekday=1,
                  overdue_summary_recipient_ids=[OWNER])
    db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    assert db.notes(osa.SUMMARY_NOTIFICATION_TYPE) == []
    osa.run_overdue_status_alerts(db, now=datetime(2026, 11, 23, 8, 5, tzinfo=IL))  # Monday
    assert len(db.notes(osa.SUMMARY_NOTIFICATION_TYPE)) == 1


def test_no_summary_without_overdue_meetings():
    db = FakeDB()
    db.org.update(overdue_summary_enabled=True, overdue_summary_frequency="daily", overdue_summary_recipient_ids=[OWNER])
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    assert db.notes(osa.SUMMARY_NOTIFICATION_TYPE) == []


def test_summary_rows_group_per_user():
    db = FakeDB()
    db.add_meeting(meeting_date="2026-11-10")
    db.add_meeting(meeting_date="2026-11-12")
    db.add_meeting(advisor_ids=[ADV2])
    p = _profiles(db)
    rows = osa.summary_rows(osa.group_by_user(osa.fetch_overdue_meetings(db, ORG, SUNDAY_8.date()), p), p)
    assert [(r["user_id"], r["count"], r["oldest_date"]) for r in rows] == [
        (ADV1, 2, "2026-11-10"), (ADV2, 1, "2026-11-18")]


# ── settings cleaning ─────────────────────────────────────────────────────────

def test_clean_days_and_hours():
    assert osa.clean_days([4, 0, 0, 7, -1, "3"]) == [0, 3, 4]
    assert osa.clean_hours([6, 7, 19, 20, 8, 8]) == [7, 8, 19]


def test_popups_due_lists_both_kinds():
    db = FakeDB()
    db.org.update(overdue_summary_enabled=True, overdue_summary_frequency="daily", overdue_summary_recipient_ids=[OWNER])
    db.add_meeting(advisor_ids=[OWNER])
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    assert osa.popups_due(db, ORG, OWNER, SUNDAY_8) == {osa.KIND_PERSONAL, osa.KIND_SUMMARY}


def test_turning_off_closes_pending_popups_and_alerts():
    db = FakeDB()
    db.org.update(overdue_summary_enabled=True, overdue_summary_frequency="daily", overdue_summary_recipient_ids=[OWNER])
    db.add_meeting()
    osa.run_overdue_status_alerts(db, now=SUNDAY_8)
    osa.close_pending(db, ORG, (osa.KIND_SUMMARY,))
    assert osa.popups_due(db, ORG, OWNER, SUNDAY_8) == set()
    assert db.notes(osa.SUMMARY_NOTIFICATION_TYPE) == []
    assert osa.popups_due(db, ORG, ADV1, SUNDAY_8) == {osa.KIND_PERSONAL}
    osa.close_pending(db, ORG, (osa.KIND_PERSONAL, osa.KIND_SUMMARY))
    assert osa.popups_due(db, ORG, ADV1, SUNDAY_8) == set()
    assert db.notes() == []
