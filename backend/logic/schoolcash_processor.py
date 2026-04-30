import pandas as pd

from logic.gefen_processor import normalize_amount


def load_schoolcash(filepath: str) -> pd.DataFrame:
    df = pd.read_excel(filepath, header=0)

    df = df.dropna(subset=["עוסק מורשה", "מספר חשבונית", "סכום"]).reset_index(drop=True)

    report_col = 'סעיף תקציב גפ"ן'
    df["report_code"] = df[report_col].apply(
        lambda x: int(float(x)) if pd.notna(x) and str(x).strip() not in ("", "nan") else None
    )
    df = df[df["report_code"].notna()].copy()

    df["ichud"] = (
        df["עוסק מורשה"].apply(normalize_amount)
        + "-"
        + df["מספר חשבונית"].apply(normalize_amount)
        + "-"
        + df["report_code"].astype(str)
        + "-"
        + df["סכום"].apply(normalize_amount)
    )

    return df
