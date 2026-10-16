import pandas as pd

from logic.gefen_processor import build_relaxed_key as _gefen_relaxed_key
from logic.payscool_processor import hp_failed_numeric_parse, payscool_relaxed_key as _payscool_relaxed_key

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

    in_finance_not_gefen, in_gefen_not_finance = _resolve_payscool_hp_mismatches(
        df_finance_filtered, in_finance_not_gefen, in_gefen_not_finance,
    )

    return in_finance_not_gefen, in_gefen_not_finance, division, len(df_finance_filtered)


def _resolve_payscool_hp_mismatches(
    df_finance_filtered: pd.DataFrame,
    in_finance_not_gefen: pd.DataFrame,
    in_gefen_not_finance: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Second-pass, additive-only fix for PaySchool rows whose "ח.פ" column
    holds literal text (e.g. "עמלות בנק") instead of a supplier number, while
    the matching Gefen row carries a numeric placeholder (e.g. "201") in the
    same position. Gated so it is a no-op for every other caller/case:
      1. Only runs when df_finance_filtered has a "ח.פ" column (PaySchool only).
      2. Only runs when at least one "ח.פ" value fails numeric parsing.
      3. Only runs when both leftover frames are non-empty.
    When triggered, restricted ONLY to the leftover frames: builds a relaxed
    key (invoice + report_code + amount, no supplier number) per side and
    drops any leftover row from BOTH sides whose relaxed key appears on the
    other side (treated as a resolved true match). Remaining leftovers stay
    genuine mismatches.
    """
    if "ח.פ" not in df_finance_filtered.columns:
        return in_finance_not_gefen, in_gefen_not_finance
    if in_finance_not_gefen.empty or in_gefen_not_finance.empty:
        return in_finance_not_gefen, in_gefen_not_finance
    if not df_finance_filtered["ח.פ"].apply(hp_failed_numeric_parse).any():
        return in_finance_not_gefen, in_gefen_not_finance

    finance_relaxed = _payscool_relaxed_key(in_finance_not_gefen)
    gefen_relaxed = _gefen_relaxed_key(in_gefen_not_finance)

    finance_resolved = finance_relaxed.isin(set(gefen_relaxed))
    gefen_resolved = gefen_relaxed.isin(set(finance_relaxed))

    return (
        in_finance_not_gefen[~finance_resolved].copy(),
        in_gefen_not_finance[~gefen_resolved].copy(),
    )


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
