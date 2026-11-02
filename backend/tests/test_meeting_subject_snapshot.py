"""Regression test: the Outlook event subject must name the participant frozen on the
meeting, never whoever currently holds that role on the school card — a past meeting
with a principal who has since left must keep showing that principal.

Fully offline: the Supabase client is faked.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routers import schools_router  # noqa: E402


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, row):
        self.row = row

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return _Result([self.row])


class _FakeDb:
    def __init__(self, school):
        self.school = school

    def table(self, _name):
        return _Query(self.school)


SCHOOL = {
    "name": "בית ספר", "city": "עיר",
    "principal_name": "מנהל חדש", "principal_phone": "050-2222222",
    "secretary_name": "מנהלנית", "secretary_phone": "050-3333333",
    "extra_contacts": [],
}


def _subject(participants, school=SCHOOL, key=None):
    return schools_router._build_meeting_subject(_FakeDb(school), "s1", participants, key, None)


def test_replaced_principal_keeps_snapshot_name_without_new_phone():
    subject = _subject([{"key": "principal", "name": "מנהל ותיק", "email": "old@x.com"}])
    assert "מנהל ותיק" in subject
    assert "מנהל חדש" not in subject
    assert "050-2222222" not in subject


def test_snapshot_phone_wins():
    subject = _subject([{"key": "principal", "name": "מנהל ותיק", "phone": "050-1111111"}])
    assert subject == "בית ספר, עיר - מנהל ותיק - 050-1111111"


def test_same_person_uses_current_phone():
    subject = _subject([{"key": "secretary", "name": " מנהלנית "}])
    assert subject == "בית ספר, עיר - מנהלנית - 050-3333333"


def test_no_participants_is_school_and_city():
    assert _subject([]) == "בית ספר, עיר"


def test_duplicate_role_key_uses_first_saved_participant():
    # The "who to call" dialog moves the chosen person to the front of the list.
    subject = _subject(
        [{"key": "principal", "name": "מנהל חדש"}, {"key": "principal", "name": "מנהל ותיק"}],
        key="principal",
    )
    assert subject == "בית ספר, עיר - מנהל חדש - 050-2222222"


def test_tasks_domain_key_resolves_phone_when_same_person():
    school = {**SCHOOL, "finance_contact_name": "רו\"ח", "finance_contact_phone": "050-4444444"}
    subject = _subject([{"key": "finance_contact", "name": "רו\"ח"}], school=school)
    assert subject == "בית ספר, עיר - רו\"ח - 050-4444444"
