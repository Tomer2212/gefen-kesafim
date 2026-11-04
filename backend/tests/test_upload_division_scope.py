"""Six-year schools: each file-request recipient gets their own divisions' files, and files are a
shared pool, so a combined file isn't requested again. Fully offline: Supabase and Resend are faked.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import meeting_upload_logic as logic  # noqa: E402
import task_logic  # noqa: E402
from routers import analyze_router, schools_router  # noqa: E402

TIKKON = ["tikkon"]
CHATIVA = ["beinayim", "yesodi"]
SCHOOL = {"id": "s1", "name": "לדוגמא", "stage": "sheshshnati", "finance_software": "kesafim2000"}
TIKHON_CONTACT = "tichon@example.com"
CHATIVA_CONTACT = "chativa@example.com"


class _Result:
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class _Query:
    def __init__(self, db, table):
        self.db, self.table_name, self.is_insert = db, table, False

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def insert(self, row):
        self.is_insert = True
        self.db.inserted.append((self.table_name, row))
        return self

    def execute(self):
        return _Result([] if self.is_insert else self.db.rows.get(self.table_name, []))


class _FakeDB:
    def __init__(self, rows=None):
        self.rows, self.inserted = rows or {}, []

    def table(self, name):
        return _Query(self, name)


def _six_year_db(with_metrics=True):
    return _FakeDB({
        "gefen_accounts": [
            {"division_type": "tikkon", "finance_software": "kesafim2000"},
            {"division_type": "beinayim", "finance_software": "kesafim2000"},
        ],
        "check_metrics": [
            {"division_type": "tikkon", "budget_name": "גפן"},
            {"division_type": "beinayim", "budget_name": "גפן"},
            {"division_type": "beinayim", "budget_name": "תנופה"},
        ] if with_metrics else [],
    })


def _missing(checklist, files):
    comparison = logic.compute_upload_comparison(checklist, files)
    return [i["kind"] for i in comparison["items"] if not i["received"]]


def _finance_file(division, **extra):
    return {"identified_type": "kesafim2000", "division_type": division, **extra}


# ---------------------------------------------------------------------------
# Who answers for what
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("slots,expected", [
    (["tichon"], TIKKON),
    (["beinayim"], CHATIVA),
    (["tichon", "beinayim"], None),  # one person responsible for both
    (["default"], None),  # no division split at this school
])
def test_recipient_division_scope(slots, expected):
    assert logic.recipient_division_scope(slots) == expected


# ---------------------------------------------------------------------------
# Checklists
# ---------------------------------------------------------------------------

def test_scoped_checklist_holds_only_that_division():
    checklist = logic.build_upload_checklist(_six_year_db(), SCHOOL, 'תשפ"ז', TIKKON)
    assert [i["label"] for i in checklist["items"] if i["kind"] != "finance"] == ["תכנון", "דיווח ביצוע גפן"]
    assert all(i["division_type"] == "tikkon" for i in checklist["items"])
    assert checklist["multi_division"] is True


def test_whole_school_checklist_is_unchanged_without_a_scope():
    checklist = logic.build_upload_checklist(_six_year_db(), SCHOOL, 'תשפ"ז')
    labels = [i["label"] for i in checklist["items"]]
    assert "תכנון - חטיבה עליונה" in labels and "תכנון - חטיבת ביניים" in labels
    assert next(i for i in checklist["items"] if i["kind"] == "finance")["division_type"] is None


def test_scoped_generic_checklist_when_there_is_no_history():
    checklist = logic.build_upload_checklist(_six_year_db(with_metrics=False), SCHOOL, 'תשפ"ז', TIKKON)
    assert checklist["no_baseline_this_year"] is True
    assert all(i["division_type"] == "tikkon" for i in checklist["items"])
    assert "חטיבה עליונה" in checklist["items"][0]["label"]


def test_history_for_one_division_still_separates_the_other_divisions_files():
    db = _six_year_db()
    db.rows["check_metrics"] = [{"division_type": "tikkon", "budget_name": "גפן"}]
    checklist = logic.build_upload_checklist(db, SCHOOL, 'תשפ"ז', CHATIVA)
    assert checklist["no_baseline_this_year"] is True and checklist["multi_division"] is True
    files = [{"identified_type": "gefen", "division_type": "tikkon", "budgets": ["גפן"]}, _finance_file("tikkon")]
    assert _missing(checklist, files) == ["tikhnun", "gefen", "finance"]


def test_whole_school_list_with_one_division_of_history_stays_single_division():
    db = _six_year_db()
    db.rows["check_metrics"] = [{"division_type": "tikkon", "budget_name": "גפן"}]
    assert logic.build_upload_checklist(db, SCHOOL, 'תשפ"ז')["multi_division"] is False


# ---------------------------------------------------------------------------
# The shared pool
# ---------------------------------------------------------------------------

@pytest.fixture
def chativa_checklist():
    return logic.build_upload_checklist(_six_year_db(), SCHOOL, 'תשפ"ז', CHATIVA)


def test_combined_finance_file_serves_the_other_recipient(chativa_checklist):
    assert "finance" not in _missing(chativa_checklist, [_finance_file("both")])


def test_other_divisions_finance_file_does_not_count(chativa_checklist):
    assert "finance" in _missing(chativa_checklist, [_finance_file("tikkon")])


def test_advisor_confirmation_makes_a_file_count(chativa_checklist):
    assert "finance" not in _missing(chativa_checklist, [_finance_file("tikkon", covers_divisions=["beinayim"])])


def test_unclassified_old_finance_file_still_counts(chativa_checklist):
    assert "finance" not in _missing(chativa_checklist, [_finance_file(None)])


def test_other_divisions_gefen_file_does_not_count(chativa_checklist):
    # A one-division list must not make a tikkon report look like this division's report.
    files = [{"identified_type": "gefen", "division_type": "tikkon", "budgets": ["גפן"]}]
    assert _missing(chativa_checklist, files).count("gefen") == 2


def test_combined_gefen_file_counts_for_the_division(chativa_checklist):
    files = [{"identified_type": "gefen", "division_type": "both", "budgets": ["גפן", "תנופה"]}]
    assert "gefen" not in _missing(chativa_checklist, files)


def test_planning_file_counts_only_for_its_division(chativa_checklist):
    other = [{"identified_type": "tikhnun", "division_type": "tikkon"}]
    own = [{"identified_type": "tikhnun", "division_type": "beinayim"}]
    assert "tikhnun" in _missing(chativa_checklist, other)
    assert "tikhnun" not in _missing(chativa_checklist, own)


def test_unclassified_old_planning_files_keep_the_count_rule():
    checklist = logic.build_upload_checklist(_six_year_db(), SCHOOL, 'תשפ"ז')
    one = [{"identified_type": "tikhnun", "division_type": None}]
    assert _missing(checklist, one).count("tikhnun") == 2
    assert _missing(checklist, one * 2).count("tikhnun") == 0


def test_generic_gefen_item_is_received_once_budgets_are_confirmed():
    checklist = logic.build_upload_checklist(_six_year_db(with_metrics=False), SCHOOL, 'תשפ"ז')
    files = [{"identified_type": "gefen", "division_type": "both", "budgets": ["גפן"]}]
    assert "gefen" not in _missing(checklist, files)


@pytest.mark.parametrize("file_row,scope,expected", [
    (_finance_file("both"), TIKKON, True),
    (_finance_file("tikkon"), CHATIVA, False),
    (_finance_file("tikkon", covers_divisions=["beinayim"]), CHATIVA, True),
    (_finance_file(None), CHATIVA, True),
    (_finance_file("tikkon"), None, True),
])
def test_file_matches_scope(file_row, scope, expected):
    assert logic.file_matches_scope(file_row, scope) is expected


def test_only_a_missing_scoped_finance_item_offers_a_reusable_file():
    uploaded = _finance_file("tikkon", id="f1")
    assert logic.reusable_finance_file({"kind": "finance", "division_type": "beinayim", "finance_software": "kesafim2000"}, [uploaded]) == uploaded
    assert logic.reusable_finance_file({"kind": "finance", "division_type": "beinayim", "finance_software": "payscool"}, [uploaded]) is None
    assert logic.reusable_finance_file({"kind": "finance", "division_type": None, "finance_software": "kesafim2000"}, [uploaded]) is None
    assert logic.reusable_finance_file({"kind": "gefen", "division_type": "beinayim"}, [uploaded]) is None


def test_file_labels_name_the_divisions_only_at_a_six_year_school():
    assert logic.file_type_label("kesafim2000", "both", None, True) == "קובץ פירוט הוצאות מכספים2000 - שתי החטיבות"
    assert logic.file_type_label("kesafim2000", "tikkon", None, True) == "קובץ פירוט הוצאות מכספים2000 - חטיבה עליונה"
    assert logic.file_type_label("kesafim2000", "both", None) == "קובץ פירוט הוצאות מכספים2000"
    assert logic.file_type_label("gefen", "both", ["גפן"], True) == "דיווח ביצוע גפן - שתי החטיבות"
    assert logic.file_type_label("tikhnun", "beinayim", None, True) == "תכנון - חטיבת ביניים"


# ---------------------------------------------------------------------------
# Upload links
# ---------------------------------------------------------------------------

def _token_row(token, email, scope, days=5):
    expires = datetime.now(timezone.utc) + timedelta(days=days)
    return {"token": token, "expires_at": expires.isoformat(), "recipient_email": email, "division_scope": scope}


def test_each_recipient_reuses_only_their_own_link():
    db = _FakeDB({"meeting_upload_tokens": [_token_row("b", "b@example.com", CHATIVA), _token_row("a", "a@example.com", TIKKON)]})
    assert logic.get_or_create_upload_token(db, "m", "2030-01-01", recipient_email="A@example.com", division_scope=TIKKON) == "a"
    assert db.inserted == []


def test_new_recipient_gets_a_new_scoped_link():
    db = _FakeDB({"meeting_upload_tokens": [_token_row("old", None, None)]})
    token = logic.get_or_create_upload_token(db, "m", "2030-01-01", recipient_email="A@example.com", recipient_name="א", division_scope=TIKKON)
    assert token != "old"
    row = db.inserted[0][1]
    assert row["recipient_email"] == "a@example.com" and row["recipient_name"] == "א" and row["division_scope"] == TIKKON


def test_expired_own_link_is_replaced():
    db = _FakeDB({"meeting_upload_tokens": [_token_row("a", "a@example.com", TIKKON, days=-1)]})
    assert logic.get_or_create_upload_token(db, "m", "2030-01-01", recipient_email="a@example.com", division_scope=TIKKON) != "a"


# ---------------------------------------------------------------------------
# The day-before send
# ---------------------------------------------------------------------------

class _FakeRequest:
    headers = {"X-Cron-Secret": "test-secret"}


@pytest.fixture
def send_harness(monkeypatch):
    from datetime import date

    due = date(2026, 11, 1)

    def run(stage_scope, responsible_by_slot):
        db = _FakeDB({
            "meetings": [{
                "id": "m1", "school_id": "s1", "meeting_date": due.isoformat(), "start_time": "10:00",
                "status": "scheduled", "participants": [], "advisor_ids": [], "meeting_service_type": "gefen",
                "reminder_enabled": False, "stage_scope": stage_scope,
            }],
            "schools": [{**SCHOOL, "org_id": "o1"}],
            "organizations": [{"id": "o1", "secretary_upload_request_enabled": True}],
        })
        sent, tokens, scopes = [], [], []
        monkeypatch.setattr(schools_router, "CRON_SECRET", "test-secret")
        monkeypatch.setattr(schools_router, "get_admin_client", lambda: db)
        monkeypatch.setattr(schools_router, "send_resend_email", lambda to, *_a, **_k: sent.append(to))
        monkeypatch.setattr(schools_router, "_due_meeting_dates", lambda _t: [due])
        monkeypatch.setattr(schools_router, "_resolve_gefen_files_responsible_for_slot", lambda _s, slot: responsible_by_slot.get(slot))
        monkeypatch.setattr(schools_router, "resolve_inherited_year_admin", lambda *_a: {"s1": {"client_status": "active"}})
        monkeypatch.setattr(schools_router, "resolve_requested_upload_years", lambda _m: ['תשפ"ז'])
        monkeypatch.setattr(task_logic, "fetch_opted_out_emails", lambda *_a: set())

        def fake_token(_db, _mid, _date, recipient_email=None, recipient_name=None, division_scope=None):
            tokens.append((recipient_email, division_scope))
            return f"tok-{recipient_email}"

        def fake_checklist(_db, _school, _year, scope=None):
            scopes.append(scope)
            return {"items": [{"label": f"קובץ של {scope}"}], "no_baseline_this_year": False}

        monkeypatch.setattr(schools_router, "get_or_create_upload_token", fake_token)
        monkeypatch.setattr(schools_router, "build_upload_checklist", fake_checklist)
        schools_router.send_due_reminders(_FakeRequest())
        return sent, dict(tokens)

    return run


TWO_PEOPLE = {
    "tichon": {"name": "ת", "email": TIKHON_CONTACT, "role_label": "מנהלנ/ית"},
    "beinayim": {"name": "ח", "email": CHATIVA_CONTACT, "role_label": 'מנהלנ/ית חט"ב'},
}
ONE_PERSON = {"tichon": TWO_PEOPLE["tichon"], "beinayim": TWO_PEOPLE["tichon"]}


def test_tichon_meeting_goes_only_to_the_tichon_responsible(send_harness):
    sent, tokens = send_harness("tichon", TWO_PEOPLE)
    assert sent == [TIKHON_CONTACT] and tokens == {TIKHON_CONTACT: TIKKON}


def test_chativa_meeting_goes_only_to_the_chativa_responsible(send_harness):
    sent, tokens = send_harness("chativa", TWO_PEOPLE)
    assert sent == [CHATIVA_CONTACT] and tokens == {CHATIVA_CONTACT: CHATIVA}


@pytest.mark.parametrize("stage_scope", ["both", None])
def test_both_divisions_go_to_each_responsible_with_their_own_scope(send_harness, stage_scope):
    sent, tokens = send_harness(stage_scope, TWO_PEOPLE)
    assert sorted(sent) == sorted([TIKHON_CONTACT, CHATIVA_CONTACT])
    assert tokens == {TIKHON_CONTACT: TIKKON, CHATIVA_CONTACT: CHATIVA}


def test_one_person_on_both_divisions_gets_one_email_with_everything(send_harness):
    sent, tokens = send_harness("both", ONE_PERSON)
    assert sent == [TIKHON_CONTACT] and tokens == {TIKHON_CONTACT: None}


def test_one_person_on_a_one_division_meeting_gets_only_that_division(send_harness):
    sent, tokens = send_harness("tichon", ONE_PERSON)
    assert sent == [TIKHON_CONTACT] and tokens == {TIKHON_CONTACT: TIKKON}


# ---------------------------------------------------------------------------
# The check itself
# ---------------------------------------------------------------------------

def test_two_payscool_files_are_merged(monkeypatch, tmp_path):
    one = pd.DataFrame({"ichud": ["a", "b"], "report_code": ["48", "43"]})
    two = pd.DataFrame({"ichud": ["b", "c"], "report_code": ["43", "44"]})
    frames = {"one.xlsx": (one, 1), "two.xlsx": (two, 2)}
    monkeypatch.setattr(analyze_router, "load_payscool", lambda p: frames[Path(p).name])

    df, _label, stats = analyze_router._load_finance_raw([tmp_path / "one.xlsx", tmp_path / "two.xlsx"], "payscool")

    assert sorted(df["ichud"]) == ["a", "b", "c"]
    assert stats["cancelled_rows"] == 3 and stats["filename"] == "one.xlsx, two.xlsx"


def test_two_payscool_files_pass_classification(monkeypatch, tmp_path):
    monkeypatch.setattr(analyze_router, "identify_file", lambda p: "gefen" if "doch" in p else "payscool")
    paths = [tmp_path / "doch.xlsx", tmp_path / "a.xlsx", tmp_path / "b.xlsx"]
    _gefen, finance, finance_type, _tikhnun = analyze_router._classify_files(paths)
    assert len(finance) == 2 and finance_type == "payscool"


def test_mixed_finance_software_is_still_rejected(monkeypatch, tmp_path):
    kinds = {"a.xlsx": "payscool", "b.xls": "kesafim2000"}
    monkeypatch.setattr(analyze_router, "identify_file", lambda p: kinds[Path(p).name])
    with pytest.raises(ValueError):
        analyze_router._classify_files([tmp_path / "a.xlsx", tmp_path / "b.xls"])


@pytest.mark.parametrize("codes,expected", [
    (["48", "54"], "tikkon"),
    (["43"], "beinayim"),
    (["48", "43"], "both"),
    ([48.0, 43.0], "both"),  # numeric column
    (["48", None], "tikkon"),
    ([], None),
])
def test_detect_finance_division_reads_report_codes(monkeypatch, tmp_path, codes, expected):
    monkeypatch.setattr(analyze_router, "_load_finance_raw", lambda *_a: (pd.DataFrame({"report_code": codes}), "", {}))
    assert analyze_router._detect_finance_division(tmp_path / "f.xls", "kesafim2000") == expected


def test_detect_finance_division_fails_open(monkeypatch, tmp_path):
    def boom(*_a):
        raise RuntimeError("broken file")

    monkeypatch.setattr(analyze_router, "_load_finance_raw", boom)
    assert analyze_router._detect_finance_division(tmp_path / "f.xls", "kesafim2000") is None


# ---------------------------------------------------------------------------
# The advisor's view (notifications, school card) and re-requesting
# ---------------------------------------------------------------------------

def _advisor_db(tokens, files=()):
    db = _six_year_db()
    db.rows["meeting_upload_tokens"] = tokens
    db.rows["meeting_upload_files"] = list(files)
    return db


def _comparison(tokens, files=()):
    from routers import meeting_upload_router as router
    return router._meeting_upload_comparison(_advisor_db(tokens, files), "m1", SCHOOL, 'תשפ"ז')


def test_one_division_meeting_shows_only_what_was_requested():
    result = _comparison([{"recipient_email": TIKHON_CONTACT, "division_scope": TIKKON}])
    labels = [i["label"] for i in result["items"]]
    assert labels and not any("ביניים" in label or "תנופה" in label for label in labels)


def test_two_people_get_a_labelled_item_per_division_and_a_single_file_does_not_finish_both():
    tokens = [
        {"recipient_email": TIKHON_CONTACT, "division_scope": TIKKON},
        {"recipient_email": CHATIVA_CONTACT, "division_scope": CHATIVA},
    ]
    result = _comparison(tokens, [_finance_file("tikkon")])
    finance = {i["label"]: i["received"] for i in result["items"] if i["kind"] == "finance"}
    assert sorted(finance.values()) == [False, True]
    assert any("חטיבה עליונה" in label for label in finance) and any("חטיבת ביניים" in label for label in finance)
    assert result["all_received"] is False


def test_one_person_or_an_old_link_keeps_the_whole_school_view():
    whole = [i["label"] for i in logic.build_upload_checklist(_six_year_db(), SCHOOL, 'תשפ"ז')["items"]]
    assert [i["label"] for i in _comparison([{"recipient_email": TIKHON_CONTACT, "division_scope": None}])["items"]] == whole
    assert [i["label"] for i in _comparison([{"recipient_email": None, "division_scope": None}])["items"]] == whole


def test_recipient_is_asked_only_for_their_own_missing_files_and_one_failure_spares_the_other(monkeypatch):
    from routers import meeting_upload_router as router

    future = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    db = _advisor_db([
        {"recipient_email": TIKHON_CONTACT, "division_scope": TIKKON},
        {"recipient_email": CHATIVA_CONTACT, "division_scope": CHATIVA},
    ])
    db.rows["schools"] = [SCHOOL]
    db.rows["meeting_reminders"] = [
        {"recipient_email": TIKHON_CONTACT, "recipient_name": "ת", "recipient_role": None, "status": "sent"},
        {"recipient_email": CHATIVA_CONTACT, "recipient_name": "ח", "recipient_role": None, "status": "sent"},
    ]
    meeting = {"id": "m1", "school_id": "s1", "meeting_date": future, "advisor_ids": [], "participants": []}
    sent = {}

    def fake_token(_db, _mid, _date, recipient_email=None, recipient_name=None, division_scope=None):
        if recipient_email == TIKHON_CONTACT:
            raise RuntimeError("link failed")
        return "tok-chativa"

    monkeypatch.setattr(router, "get_admin_client", lambda: db)
    monkeypatch.setattr(router, "_require_meeting_access", lambda *_a: meeting)
    monkeypatch.setattr(router, "resolve_requested_upload_years", lambda _m: ['תשפ"ז'])
    monkeypatch.setattr(router, "_opted_out_recipients", lambda *_a: set())
    monkeypatch.setattr(router, "get_or_create_upload_token", fake_token)
    monkeypatch.setattr(router, "send_resend_email", lambda to, _subject, html, reply_to=None: sent.update({to: html}))

    result = router.request_missing_files("m1", {"id": "u1", "email": ""})

    assert result["sent"] == 1 and result["failed"] == 1
    assert list(sent) == [CHATIVA_CONTACT]
    assert "תנופה" in sent[CHATIVA_CONTACT] and "tok-chativa" in sent[CHATIVA_CONTACT]
