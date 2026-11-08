"""Regression tests for "דיווח חסר" (partial_rows) and its integrity checks.

Offline — synthetic plan/doch data only. Covers the two field cases of 2026-11-08:
- 210971: a plan planned under codes 68 + 69 credited each code with the whole
  plan's reports, hiding a 531 ₪ shortfall in code 69.
- 616805: a plan number planned in both גפן and תקומה (different response types);
  rows at the boundary between the doch's budget blocks were assigned to גפן.
"""
import sys
from pathlib import Path

import openpyxl

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR.parent / ".env")

from routers.analyze_router import _finalize_tikhnun_metrics, _partial_integrity_warnings  # noqa: E402
from zihuy_core import identify, normalize_budget_name  # noqa: E402

GEFEN = 'תקציב גפ"ן'
TKUMA = "תקציב תקומה"
PERUT_HEADER = ["c%d" % i for i in range(20)]


def _perut(budget, plan_num, code, amount, type_name="סוג", name="תוכנית", total=None):
    row = [None] * 20
    row[0] = budget
    row[7] = type_name
    row[8] = name
    row[9] = plan_num
    row[13] = amount
    row[14] = total if total is not None else amount
    row[15] = total if total is not None else amount
    row[17] = str(code)
    return row


def _doch(budget, plan_num, code, amount, type_name="סוג", status="--", has_file="כן"):
    orig = ("מענה", str(code), type_name, f"{plan_num} - תוכנית", "1", "01-01-2026",
            "123- ספק", "", 1, 1, "", amount, status, has_file)
    return {"budget": budget, "stage": "חטיבת ביניים", "orig": orig}


def _budget(raw, S, sum_chayav):
    return {"raw_name": raw, "norm_name": normalize_budget_name(raw), "H": sum_chayav, "L": sum_chayav,
            "S": S, "T": 0.0, "sum_chayav": sum_chayav, "nikuy": None, "pct_tanuz": None, "machozi_i": 0.0}


def _run(results_clean, perut_rows, budgets_raw):
    tr = {"overview": {}, "partial_rows": [], "kvua_rows": []}
    _finalize_tikhnun_metrics(tr, results_clean, budgets_raw, [PERUT_HEADER] + perut_rows)
    return tr


def test_multi_code_plan_compares_each_code_with_its_own_reports():
    perut = [
        _perut(GEFEN, 715872, 68, 5000, total=32200),
        _perut(GEFEN, 715872, 69, 10000, total=32200, type_name="הוצאות"),
        _perut(GEFEN, 715872, 69, 17200, total=32200, type_name="הוצאות"),
    ]
    doch = [_doch(GEFEN, 715872, 68, 5000), _doch(GEFEN, 715872, 69, 26668.61, type_name="הוצאות")]
    tr = _run(doch, perut, [_budget(GEFEN, S=31668.61, sum_chayav=32200)])

    rows = {(r["key"], r["rcode"]): r for r in tr["partial_rows"]}
    assert set(rows) == {("715872", "69")}
    assert round(rows[("715872", "69")]["hefresh"], 2) == 531.39
    assert tr["budgets"][0]["overview"]["balance_warning"] is None


def test_multi_code_plan_counts_reports_filed_under_an_unplanned_code():
    # 715872 planned under 68 + 69; 600 of code 69's work was filed under code 70.
    perut = [
        _perut(GEFEN, 715872, 68, 5000, total=32200),
        _perut(GEFEN, 715872, 69, 27200, total=32200, type_name="הוצאות"),
    ]
    doch = [_doch(GEFEN, 715872, 68, 5000), _doch(GEFEN, 715872, 69, 26600, type_name="הוצאות"),
            _doch(GEFEN, 715872, 70, 600, type_name="הוצאות"), _doch(GEFEN, 715872, 70, 900, type_name="הוצאות")]
    tr = _run(doch, perut, [_budget(GEFEN, S=33100, sum_chayav=32200)])

    assert tr["partial_rows"] == []
    assert tr["budgets"][0]["overview"]["balance_warning"] is None


def test_single_code_plan_still_counts_reports_filed_under_another_code():
    perut = [_perut(GEFEN, 800100, 69, 10000)]
    doch = [_doch(GEFEN, 800100, 70, 10000)]
    tr = _run(doch, perut, [_budget(GEFEN, S=10000, sum_chayav=10000)])

    assert tr["partial_rows"] == []
    assert tr["budgets"][0]["overview"]["balance_warning"] is None


def test_split_plan_rows_without_number_are_compared_once():
    # Same plan without a plan number, planned in two rows (different total cost):
    # 7,000 reported against 7,530 planned must show a 530 gap, not be credited twice.
    perut = [
        _perut(GEFEN, None, 132, 2280, name="איי סקור", total=2280),
        _perut(GEFEN, None, 132, 5250, name="איי סקור", total=5250),
    ]
    doch_row = _doch(GEFEN, "", 132, 7000)
    doch_row["orig"] = doch_row["orig"][:3] + ("איי סקור",) + doch_row["orig"][4:]
    tr = _run([doch_row], perut, [_budget(GEFEN, S=7000, sum_chayav=7530)])

    assert [(r["rcode"], round(r["tikhnun"]), round(r["hefresh"])) for r in tr["partial_rows"]] == [("132", 7530, 530)]
    assert tr["budgets"][0]["overview"]["balance_warning"] is None


def test_integrity_flags_double_credit_and_misattribution():
    gefen, tkuma = _budget(GEFEN, S=84000, sum_chayav=84000), _budget(TKUMA, S=251100, sum_chayav=251100)
    norms = {gefen["norm_name"], tkuma["norm_name"]}

    # 616805 before the fix: תקומה's reports sat in גפן's doch total.
    exec_sums = {gefen["norm_name"]: {"10747": 335100.0}, tkuma["norm_name"]: {}}
    credited = {gefen["norm_name"]: 335100.0, tkuma["norm_name"]: 0.0}
    w = _partial_integrity_warnings([gefen, tkuma], norms, exec_sums, credited)
    assert w[gefen["norm_name"]]["misattributed"] == 251100.0
    assert w[tkuma["norm_name"]]["misattributed"] == -251100.0

    # 210971 before the fix: 31,668.61 credited to code 68 and again to code 69.
    exec_sums = {gefen["norm_name"]: {"715872": 31668.61}}
    w = _partial_integrity_warnings([_budget(GEFEN, S=31668.61, sum_chayav=32200)], {gefen["norm_name"]},
                                    exec_sums, {gefen["norm_name"]: 63337.22})
    assert w[gefen["norm_name"]] == {"double_credit": 31668.61}

    # A doch that holds more than the plan file's "סכום שדווח", in one budget only.
    w = _partial_integrity_warnings([_budget(GEFEN, S=100000, sum_chayav=120000)], {gefen["norm_name"]},
                                    {gefen["norm_name"]: {"1": 103300.0}}, {gefen["norm_name"]: 103300.0})
    assert w[gefen["norm_name"]] == {"files_out_of_sync": 3300.0}


def _write_plan(path, perut_rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "הכל"
    ws.append(["שם תקציב"] + [None] * 19)
    for b in (GEFEN, TKUMA):
        ws.append([b] + [None] * 19)
    ws2 = wb.create_sheet("פירוט המענים")
    ws2.append(PERUT_HEADER)
    for r in perut_rows:
        ws2.append(r)
    wb.save(path)


def _write_doch(path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "דיווח ביצוע"
    ws.append(["c%d" % i for i in range(14)])
    for i, (plan_num, type_name, amount) in enumerate(rows):
        ws.append(["מענה", "43", type_name, f"{plan_num}-תוכנית", str(1000 + i), "01-01-2026",
                   "123- ספק", "", 1, 1, "", amount, "--", "כן"])
    wb.save(path)


def test_shared_plan_number_resolved_by_response_type(tmp_path):
    perut = [
        _perut(GEFEN, 500, 43, 1000, type_name="סדנאות"),
        _perut(GEFEN, 10747, 43, 84000, type_name="הרצאות ממאגר התוכניות"),
        _perut(TKUMA, 10747, 43, 251100, type_name="תוכניות חינוכיות"),
        _perut(TKUMA, 600, 43, 2000, type_name="יוזמות חינוכיות בתחום הפדגוגי"),
    ]
    _write_plan(tmp_path / "plan.xlsx", perut)
    # Doch ordered by budget block; the תקומה rows of 10747 open the תקומה block.
    _write_doch(tmp_path / "doch.xlsx", [
        (500, "סדנאות", 1000),
        (10747, "הרצאות ממאגר התוכניות", 84000),
        (500, "סדנאות", 0.5),
        (10747, "תוכניות חינוכיות", 41850),
        (10747, "תוכניות חינוכיות", 209250),
        (600, "יוזמות חינוכיות בתחום הפדגוגי", 2000),
    ])
    results, *_ = identify([str(tmp_path / "doch.xlsx")], [str(tmp_path / "plan.xlsx")], 'תשפ"ו')

    by_amount = {r["orig"][11]: r["budget"] for r in results}
    assert by_amount[84000] == GEFEN
    assert by_amount[41850] == TKUMA
    assert by_amount[209250] == TKUMA
