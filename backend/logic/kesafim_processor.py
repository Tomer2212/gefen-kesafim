import pandas as pd

from logic.gefen_processor import normalize_amount


def load_kesafim(filepath: str) -> pd.DataFrame:
    rows = _parse_tsv(filepath)
    if not rows:
        return pd.DataFrame(columns=[
            "report_code", "supplier", "supplier_name",
            "invoice_date", "invoice_number", "voucher",
            "item_number", "item_name", "description",
            "amount_raw", "total", "status", "amount", "ichud",
        ])
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


# Legacy fixed column layout (old 13-column Kesafim2000 export). Used as a
# fallback for any field whose header text is not found in a block's header row.
_LEGACY_IDX = {
    "supplier": 0,
    "supplier_name": 1,
    "invoice_date": 2,
    "invoice_number": 3,
    "voucher": 4,
    "item_number": 5,
    "item_name": 6,
    "description": 7,
    "amount_raw": 10,
    "total": 11,
    "status": 12,
}

# Internal field name -> Hebrew column header as it appears in the row directly
# under each "קוד גפן" block header. The header text is identical between the old
# 13-column layout and the new 16-column layout (Kesafim2000 added 3 columns and
# reordered the rest) — only the position changed. Mapping by header name keeps
# both layouts working.
_HEADER_TO_FIELD = {
    "ספק": "supplier",
    "שם": "supplier_name",
    "תאריך חשבונית": "invoice_date",
    "מס.חשבונית": "invoice_number",
    "שובר הוצאה": "voucher",
    "מס פריט": "item_number",
    "שם פריט": "item_name",
    "מהות החשבונית": "description",
    "סכום פריט": "amount_raw",
    'סה"כ לחשבונית': "total",
    "סטטוס חשבונית": "status",
}


def _parse_tsv(filepath: str) -> list[dict]:
    with open(filepath, "r", encoding="iso-8859-8") as f:
        content = f.read()

    rows = []
    current_code = None
    header_next = False
    col_idx = dict(_LEGACY_IDX)  # field -> column index for the current block

    for line in content.strip().split("\n"):
        line = line.rstrip("\r")
        parts = line.split("\t")

        if parts[0] == "קוד גפן":
            current_code = int(parts[1]) if parts[1].strip().isdigit() else None
            header_next = True
            continue
        if header_next:
            header_next = False
            # Rebuild the field -> index map from this block's header row.
            # Any field whose header is missing keeps its legacy fixed index.
            mapping = dict(_LEGACY_IDX)
            for i, cell in enumerate(parts):
                field = _HEADER_TO_FIELD.get(cell.strip())
                if field is not None:
                    mapping[field] = i
            col_idx = mapping
            continue
        if not parts[0].strip() or parts[0].strip() == " ":
            continue
        if current_code is None:
            continue

        def _cell(field: str) -> str:
            i = col_idx.get(field)
            return parts[i].strip() if i is not None and i < len(parts) else ""

        # A valid data row must at least reach the amount column.
        if col_idx["amount_raw"] >= len(parts):
            continue

        rows.append({
            "report_code": current_code,
            "supplier": _cell("supplier"),
            "supplier_name": _cell("supplier_name"),
            "invoice_date": _cell("invoice_date"),
            "invoice_number": _cell("invoice_number"),
            "voucher": _cell("voucher"),
            "item_number": _cell("item_number"),
            "item_name": _cell("item_name"),
            "description": _cell("description"),
            "amount_raw": _cell("amount_raw"),
            "total": _cell("total"),
            "status": _cell("status"),
        })

    return rows
