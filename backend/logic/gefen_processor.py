import pandas as pd


def load_gefen(filepath: str) -> pd.DataFrame:
    df = pd.read_excel(filepath, sheet_name="דיווח ביצוע")
    df = _deduplicate(df)
    # Drop rows missing essential reconciliation fields
    df = df.dropna(subset=["קוד ושם ספק", "מספר חשבונית", "סכום פריט"]).reset_index(drop=True)
    df["supplier_number"] = df["קוד ושם ספק"].apply(_extract_supplier_number)
    df["report_code"] = df["קוד דווח"].apply(lambda x: int(float(x)) if pd.notna(x) else None)
    df["ichud"] = _build_ichud(df)
    return df


def _deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    mid = len(df) // 2
    if (
        len(df) % 2 == 0
        and df.iloc[:mid].reset_index(drop=True).equals(df.iloc[mid:].reset_index(drop=True))
    ):
        return df.iloc[:mid].reset_index(drop=True)
    return df


def _extract_supplier_number(value: str) -> str:
    if pd.isna(value):
        return ""
    return str(value).split("-")[0].strip()


def _build_ichud(df: pd.DataFrame) -> pd.Series:
    # ichud = supplier_number + "-" + invoice_number + "-" + report_code + "-" + amount
    return (
        df["supplier_number"].astype(str)
        + "-"
        + df["מספר חשבונית"].apply(normalize_amount)
        + "-"
        + df["report_code"].astype(str)
        + "-"
        + df["סכום פריט"].apply(normalize_amount)
    )


def normalize_amount(val) -> str:
    if pd.isna(val) or str(val).strip() == "":
        return ""
    s = str(val).replace(",", "").strip()
    try:
        f = float(s)
        return str(int(f)) if f == int(f) else f"{f:.2f}".rstrip("0").rstrip(".")
    except Exception:
        return s
