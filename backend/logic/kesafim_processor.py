import pandas as pd

from logic.gefen_processor import normalize_amount


def load_kesafim(filepath: str) -> pd.DataFrame:
    rows = _parse_tsv(filepath)
    df = pd.DataFrame(rows)
    df["amount"] = df["amount_raw"].apply(normalize_amount)
    df["ichud"] = (
        df["supplier"].astype(str)
        + "-"
        + df["invoice_number"].astype(str)
        + "-"
        + df["report_code"].astype(str)
        + "-"
        + df["amount"]
    )
    return df


def _parse_tsv(filepath: str) -> list[dict]:
    with open(filepath, "r", encoding="iso-8859-8") as f:
        content = f.read()

    rows = []
    current_code = None
    header_next = False

    for line in content.strip().split("\n"):
        line = line.rstrip("\r")
        parts = line.split("\t")

        if parts[0] == "קוד גפן":
            current_code = int(parts[1]) if parts[1].strip().isdigit() else None
            header_next = True
            continue
        if header_next:
            header_next = False
            continue
        if not parts[0].strip() or parts[0].strip() == " ":
            continue
        if current_code and len(parts) >= 11:
            rows.append({
                "report_code": current_code,
                "supplier": parts[0].strip(),
                "supplier_name": parts[1].strip(),
                "invoice_date": parts[2].strip(),
                "invoice_number": parts[3].strip(),
                "voucher": parts[4].strip(),
                "item_number": parts[5].strip(),
                "item_name": parts[6].strip(),
                "description": parts[7].strip(),
                "amount_raw": parts[10].strip(),
                "total": parts[11].strip() if len(parts) > 11 else "",
                "status": parts[12].strip() if len(parts) > 12 else "",
            })

    return rows
