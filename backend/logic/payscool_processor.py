import re

import pandas as pd

from logic.gefen_processor import normalize_amount


def load_payscool(filepath: str) -> pd.DataFrame:
    df = pd.read_excel(filepath, sheet_name="Data", header=None)
    df.columns = df.iloc[3]
    df = df.iloc[4:].reset_index(drop=True)

    df["report_code"] = df["סעיף"].apply(_extract_report_code)
    df = df[df["report_code"].notna()].copy()
    df = df[df["סטטוס חשבונית"] != "מבוטלת"].copy()

    df["amount"] = df['סה"כ לסעיף'].apply(normalize_amount)
    df["ichud"] = (
        df["ח.פ"].apply(normalize_amount)
        + "-"
        + df["מספר חשבונית"].apply(normalize_amount)
        + "-"
        + df["report_code"].astype(str)
        + "-"
        + df["amount"]
    )
    return df


def _extract_report_code(value) -> str | None:
    match = re.search(r"\((\d+)\)", str(value))
    return match.group(1) if match else None
