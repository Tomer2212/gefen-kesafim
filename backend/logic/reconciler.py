import pandas as pd

TIKKON_ONLY = [
    48,54,55,58,59,61,62,66,76,87,91,92,94,95,96,97,98,99,100,
    101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,
    116,117,118,119,120,121,122,123,124,125,127,136,137,138,139,
    140,141,142,148,150,152,154,156,158,160,162,164,165,167,169,
]

BEINAYIM_ONLY = [
    43,44,45,46,47,49,50,51,52,53,56,57,60,63,64,65,67,68,69,
    70,71,72,73,74,75,77,78,80,81,83,84,85,88,89,90,126,128,
    129,130,131,132,133,134,135,147,151,153,155,161,166,168,
]

SHARED = [157, 159, 163]

# תשפ"ז: לפי נספח ט"ז, הקודים 157/159/163 שייכים אך ורק ליסודי/חטיבת ביניים (לא לתיכון) —
# בשונה מתשפ"ו, שם הם משותפים לכל השלבים כולל תיכון. בנוסף נוסף קוד 149 חדש (גם הוא
# יסודי/חטיבת ביניים בלבד). ראו CLAUDE.md "Division Report Codes".
TIKKON_ONLY_TASHPAZ = TIKKON_ONLY
BEINAYIM_ONLY_TASHPAZ = BEINAYIM_ONLY + [149, 157, 159, 163]
SHARED_TASHPAZ: list = []

_YEAR_CODE_LISTS = {
    "תשפ\"ו": (TIKKON_ONLY, BEINAYIM_ONLY, SHARED),
    "תשפ\"ז": (TIKKON_ONLY_TASHPAZ, BEINAYIM_ONLY_TASHPAZ, SHARED_TASHPAZ),
}


def _lists_for_year(academic_year: str | None) -> tuple[list, list, list]:
    """Defaults to the תשפ"ו lists (today's behavior) for None/unrecognized years."""
    return _YEAR_CODE_LISTS.get(academic_year, (TIKKON_ONLY, BEINAYIM_ONLY, SHARED))


def reconcile(
    df_gefen: pd.DataFrame,
    df_finance: pd.DataFrame,
    academic_year: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, str, int]:
    """Returns (in_finance_not_gefen, in_gefen_not_finance, division, finance_rows_checked).

    division is one of: "tikkon", "beinayim", "both"
    finance_rows_checked is the count after division filtering.
    """
    df_finance_filtered, division = _filter_by_division(df_gefen, df_finance, academic_year)

    gefen_set = set(df_gefen["ichud"])
    finance_set = set(df_finance_filtered["ichud"])

    in_finance_not_gefen = df_finance_filtered[~df_finance_filtered["ichud"].isin(gefen_set)].copy()
    in_gefen_not_finance = df_gefen[~df_gefen["ichud"].isin(finance_set)].copy()

    return in_finance_not_gefen, in_gefen_not_finance, division, len(df_finance_filtered)


def _filter_by_division(
    df_gefen: pd.DataFrame,
    df_finance: pd.DataFrame,
    academic_year: str | None = None,
) -> tuple[pd.DataFrame, str]:
    tikkon_only, beinayim_only, shared = _lists_for_year(academic_year)
    gefen_codes = set(df_gefen["report_code"].dropna().astype(int).tolist())

    has_tikkon = bool(gefen_codes & set(tikkon_only))
    has_beinayim = bool(gefen_codes & set(beinayim_only))

    if has_tikkon and not has_beinayim:
        keep = set(tikkon_only) | set(shared)
        division = "tikkon"
    elif has_beinayim and not has_tikkon:
        keep = set(beinayim_only) | set(shared)
        division = "beinayim"
    else:
        return df_finance, "both"

    finance_codes = df_finance["report_code"].astype(str).apply(
        lambda x: int(x) if x.isdigit() else None
    )
    return df_finance[finance_codes.isin(keep) | finance_codes.isna()].copy(), division


def merge_gefen_files(df1: pd.DataFrame, df2: pd.DataFrame) -> pd.DataFrame:
    set1 = set(df1["ichud"])
    set2 = set(df2["ichud"])

    if set1 >= set2:
        return df1
    if set2 >= set1:
        return df2

    return pd.concat([df1, df2], ignore_index=True)
