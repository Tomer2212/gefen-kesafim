"""
Tikhnun (budget planning) processor.
Reads a 2-sheet budget planning file ("הכל" + "פירוט המענים") and optionally
cross-references with a Gefen doch (execution report) to produce analysis data.
"""

import openpyxl
from collections import defaultdict


STAGE_MAP = {"עליונה בלבד": "תיכון", 'חט"ב בלבד': "חטיבת ביניים"}

SAL_ORDER = [
    "מענים פדגוגיים ורגשיים",
    "חינוך חברתי - קהילתי והעשרה",
    "אוכלוסיות במיקוד",
    "קידום רווחת התלמיד",
    "תשתיות בית ספריות",
]

# Yozma codes by stage keyword
YOZMA_CODES = {
    "תיכון": {"106": "נלוות", "107": "רכוש קבוע", "105": "כיבוד", "108": "תיקונים קלים"},
    "חטיבת ביניים": {"69": "נלוות", "70": "רכוש קבוע", "68": "כיבוד", "71": "תיקונים קלים"},
}


def _to_num(v):
    if v is None or str(v).strip() == "":
        return 0
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return 0


def _fmt_pct(v):
    try:
        s = str(v).replace("%", "").strip()
        f = float(s)
        return f / 100 if f > 1 else f
    except Exception:
        return 0


def _sal_order_key(s):
    for i, k in enumerate(SAL_ORDER):
        if k in s:
            return i
    return 99


def _extract_plan_num(name):
    if not name:
        return ""
    s = str(name).strip()
    left = s.split("-")[0].strip()
    if left.isdigit():
        return left
    return ""


def _plan_key_perut(r):
    j = str(r[9]).strip() if r[9] else ""
    if j and j != " ":
        return j
    rcode = str(r[17]).strip() if r[17] else ""
    iname = str(r[8]).strip() if r[8] else ""
    return f"{rcode}-{iname}"


def _plan_key_doch(r):
    d = str(r[3]).strip() if r[3] else ""
    b = str(r[1]).strip() if r[1] else ""
    pnum = _extract_plan_num(d)
    if pnum:
        return pnum
    return f"{b}-{d}"


def load_tikhnun(filepath):
    """
    Load and parse a tikhnun budget planning file.
    Returns a dict with all parsed data, or raises ValueError if file is invalid.
    """
    try:
        wb = openpyxl.load_workbook(filepath, read_only=True)
        sheets = wb.sheetnames
        if len(sheets) != 2:
            wb.close()
            raise ValueError(f"Expected 2 sheets, got {len(sheets)}")

        hakol_ws = None
        perut_ws = None
        for sh in sheets:
            ws = wb[sh]
            rows_peek = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))
            if not rows_peek:
                continue
            header = rows_peek[0]
            if len(header) > 14 and header[10] == "השתתפות רשות/ בעלות" and header[14] == "תאריך אחרון לאישור רשות":
                hakol_ws = sh
            if len(header) > 15 and header[14] == "עלות מענה כוללת" and header[15] == "עלות מתקציב":
                perut_ws = sh

        if not hakol_ws or not perut_ws:
            wb.close()
            raise ValueError("Could not identify הכל / פירוט המענים sheets")

        hakol_rows = [list(r) for r in wb[hakol_ws].iter_rows(values_only=True)]
        perut_rows = [list(r) for r in wb[perut_ws].iter_rows(values_only=True)]
        wb.close()
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Failed to read tikhnun file: {e}")

    return _process_tikhnun(hakol_rows, perut_rows)


def _process_tikhnun(hakol_rows, perut_rows):
    hakol_data = hakol_rows[1:]  # skip header

    # School info from first data row
    school_name = str(hakol_data[0][3]).strip() if hakol_data[0][3] else ""
    school_code = hakol_data[0][2]
    school_stage_raw = str(hakol_data[0][4]).strip() if hakol_data[0][4] else ""
    school_stage = STAGE_MAP.get(school_stage_raw, school_stage_raw)

    # Control row: budget type contains גפ"ן AND F = תקציב כללי
    ctrl = None
    machozi_I = 0
    for r in hakol_data:
        aval = str(r[0]).strip().replace("״", '"').replace("“", '"').replace("”", '"') if r[0] else ""
        fval = str(r[5]).strip() if r[5] else ""
        if ('גפ"ן' in aval or "גפן" in aval.replace('"', "")):
            if "כללי" in fval and ctrl is None:
                ctrl = r
            if "מחוזי" in fval and "דיפרנציאלי" in fval:
                machozi_I = _to_num(r[8])

    if ctrl is None:
        raise ValueError("Could not find control row (תקציב גפ\"ן + תקציב כללי)")

    H = _to_num(ctrl[7])   # total budget
    L = _to_num(ctrl[11])  # planned
    S = _to_num(ctrl[18])  # reported
    T = _fmt_pct(ctrl[19]) # % reported

    # Fixed budget rows (kvua)
    kvua_rows = []
    for r in hakol_data:
        fval = str(r[5]).strip() if r[5] else ""
        gval = str(r[6]).strip() if r[6] else ""
        i_val = _to_num(r[8])
        l_val = _to_num(r[11])
        budget_type = str(r[0]).strip().replace("״", '"') if r[0] else ""

        cond1 = "קידום רווחת התלמיד" in fval and i_val > 0
        cond2 = bool(gval) and i_val > 0

        if cond1 or cond2:
            stage = STAGE_MAP.get(str(r[4]).strip(), str(r[4]).strip()) if r[4] else ""
            sal = fval.replace("סל ", "")
            if sal == "קידום רווחת התלמיד":
                sal = "רווחת התלמיד"
            tatsub = gval
            if "STEM" in tatsub:
                tatsub = "STEM"
            plan = min(l_val, i_val)
            diff = plan - i_val
            kvua_rows.append({
                "budget_type": budget_type,
                "stage": stage,
                "sal": sal,
                "tatsub": tatsub,
                "kvua": i_val,
                "tikhnun": plan,
                "hefresh": diff,
            })

    kvua_rows.sort(key=lambda x: (x["stage"] != "תיכון", _sal_order_key(x["sal"])))
    hefresh_kvua_total = sum(r["hefresh"] for r in kvua_rows)
    abs_hefresh_kvua = abs(hefresh_kvua_total)
    budget_types_in_kvua = set(r["budget_type"] for r in kvua_rows)
    has_multiple_budget_types = len(budget_types_in_kvua) > 1

    gamish_notar = H - L - abs_hefresh_kvua
    max_yozma_03 = (H + machozi_I) * 0.3
    max_yozma_04 = (H + machozi_I) * 0.4

    # Unique plans from פירוט המענים
    seen_keys = {}
    for r in perut_rows[1:]:
        key = tuple(str(x).strip() if x else "" for x in r[:10])
        if key not in seen_keys:
            seen_keys[key] = r

    unique_plans = list(seen_keys.values())

    # Plans that require reporting (have report code)
    plans_with_R = [r for r in unique_plans if r[17] and str(r[17]).strip()]
    sum_chayav = sum(_to_num(r[15]) for r in plans_with_R)

    # Yozma codes for this stage
    yozma_codes = YOZMA_CODES.get(school_stage, YOZMA_CODES["תיכון"])
    yozma_by_code = defaultdict(float)
    for r in unique_plans:
        rcode = str(r[17]).strip() if r[17] else ""
        if rcode in yozma_codes:
            yozma_by_code[rcode] += _to_num(r[15])

    total_yozma_betikhnun = sum(yozma_by_code.values())

    def _build_yozma_detail(max_yozma):
        caps = {
            list(yozma_codes.keys())[0]: max_yozma,          # נלוות
            list(yozma_codes.keys())[1]: max_yozma * 0.5,    # רכוש קבוע
            list(yozma_codes.keys())[2]: max_yozma * 0.15,   # כיבוד
            list(yozma_codes.keys())[3]: max_yozma * 0.1,    # תיקונים קלים
        }
        detail = []
        for code, label in yozma_codes.items():
            betikhnun = yozma_by_code.get(code, 0)
            cap = caps[code]
            diff = cap - betikhnun
            hefresh_shanim = min(diff, gamish_notar) if diff >= 0 else diff
            detail.append({
                "label": label,
                "code": code,
                "cap": round(cap),
                "betikhnun": round(betikhnun),
                "hefresh": round(hefresh_shanim),
            })
        hefresh_total = round(max_yozma) - round(total_yozma_betikhnun)
        return {
            "max": round(max_yozma),
            "betikhnun": round(total_yozma_betikhnun),
            "hefresh": hefresh_total,
            "is_negative": hefresh_total < 0,
            "detail": detail,
        }

    yozma_03 = _build_yozma_detail(max_yozma_03)
    yozma_04 = _build_yozma_detail(max_yozma_04)

    return {
        "school_name": school_name,
        "school_code": int(school_code) if school_code else school_code,
        "school_stage": school_stage,
        "H": H,
        "L": L,
        "S": S,
        "T": T,
        "machozi_I": machozi_I,
        "abs_hefresh_kvua": abs_hefresh_kvua,
        "gamish_notar": gamish_notar,
        "sum_chayav": sum_chayav,
        "kvua_rows": kvua_rows,
        "has_multiple_budget_types": has_multiple_budget_types,
        "plans_with_R": plans_with_R,
        "yozma_codes": yozma_codes,
        "yozma_by_code": dict(yozma_by_code),
        "total_yozma_betikhnun": total_yozma_betikhnun,
        "yozma_03": yozma_03,
        "yozma_04": yozma_04,
    }


def cross_reference_doch(tikhnun_data, doch_filepath):
    """
    Cross-reference tikhnun plans with a Gefen doch execution file.
    Loads the raw doch file (not via gefen_processor, which filters rows).
    Adds execution sums, tanuz calculation, and partial rows to tikhnun_data.
    Returns updated tikhnun_data dict.
    """
    try:
        wb = openpyxl.load_workbook(doch_filepath, read_only=True)
        doch_rows = [list(r) for r in wb.active.iter_rows(values_only=True)]
        wb.close()
    except Exception as e:
        raise ValueError(f"Failed to read doch file: {e}")

    exec_sums = defaultdict(float)
    nadche_sum = 0.0
    lelo_koved_sum = 0.0
    overlap_sum = 0.0

    for r in doch_rows[1:]:
        a_val = str(r[0]).strip() if r[0] else ""
        if "מענה משרדי" in a_val:
            continue

        l_val = _to_num(r[11])
        l_not_empty = bool(r[11]) and l_val != 0
        m_val = str(r[12]).strip() if r[12] else ""
        n_val = str(r[13]).strip() if r[13] else ""

        key = _plan_key_doch(r)
        exec_sums[key] += l_val

        is_nadche = m_val.startswith("נדחה:") and l_not_empty
        is_lelo = (n_val == "לא") and l_not_empty

        if is_nadche:
            nadche_sum += l_val
        if is_lelo:
            lelo_koved_sum += l_val
        if is_nadche and is_lelo:
            overlap_sum += l_val

    nikuy = nadche_sum + lelo_koved_sum - overlap_sum
    S = tikhnun_data["S"]
    sum_chayav = tikhnun_data["sum_chayav"]
    pct_tanuz = (S - nikuy) / sum_chayav if sum_chayav > 0 else 0

    # Cross-reference each plan with report code
    comparison_rows = []
    for r in tikhnun_data["plans_with_R"]:
        pkey = _plan_key_perut(r)
        tikhnun_val = _to_num(r[15])
        divuach = exec_sums.get(pkey, 0)
        hefresh = tikhnun_val - divuach
        pct = divuach / tikhnun_val if tikhnun_val > 0 else 0
        rcode = str(r[17]).strip() if r[17] else ""
        name = str(r[8]).strip() if r[8] else ""
        j_val = str(r[9]).strip() if r[9] else ""
        mispnum = j_val if (j_val and j_val != " ") else "אין"
        comparison_rows.append({
            "key": pkey,
            "rcode": rcode,
            "name": name,
            "mispnum": mispnum,
            "tikhnun": tikhnun_val,
            "divuach": divuach,
            "hefresh": hefresh,
            "pct": pct,
        })

    # Filter: only hefresh >= 1 (as specified)
    partial_rows = [x for x in comparison_rows if x["hefresh"] >= 1]
    partial_rows.sort(key=lambda x: (round(x["pct"], 4), -x["tikhnun"]))
    sum_hefresh_partial = sum(x["hefresh"] for x in partial_rows)

    tikhnun_data.update({
        "has_doch": True,
        "pct_tanuz": pct_tanuz,
        "nikuy": nikuy,
        "partial_rows": partial_rows,
        "sum_hefresh_partial": sum_hefresh_partial,
    })
    return tikhnun_data


def build_tikhnun_result(tikhnun_data):
    """
    Build the serializable result dict for the API response.
    tikhnun_data may or may not have doch cross-reference.
    """
    kvua_has_issues = any(r["hefresh"] < 0 for r in tikhnun_data["kvua_rows"])
    partial_has_issues = bool(tikhnun_data.get("partial_rows"))

    overview = {
        "budget": tikhnun_data["H"],
        "planned": tikhnun_data["L"],
        "fixed_gap_abs": tikhnun_data["abs_hefresh_kvua"],
        "flexible_remaining": tikhnun_data["gamish_notar"],
        "sum_chayav": tikhnun_data["sum_chayav"],
        "sum_divuach": tikhnun_data["S"],
        "pct_divuach": tikhnun_data["T"],
        "pct_tanuz": tikhnun_data.get("pct_tanuz"),
    }

    return {
        "school_name": tikhnun_data["school_name"],
        "school_code": tikhnun_data["school_code"],
        "school_stage": tikhnun_data["school_stage"],
        "filename": tikhnun_data.get("filename"),
        "has_doch": tikhnun_data.get("has_doch", False),
        "overview": overview,
        "kvua_rows": tikhnun_data["kvua_rows"],
        "kvua_has_issues": kvua_has_issues,
        "has_multiple_budget_types": tikhnun_data["has_multiple_budget_types"],
        "partial_rows": tikhnun_data.get("partial_rows", []),
        "partial_has_issues": partial_has_issues,
        "sum_hefresh_partial": tikhnun_data.get("sum_hefresh_partial", 0),
        "yozma_03": tikhnun_data["yozma_03"],
        "yozma_04": tikhnun_data["yozma_04"],
    }
