from pathlib import Path

import openpyxl


def identify_file(filename: str) -> str:
    """Return 'gefen', 'kesafim2000', 'payscool', or 'unknown'."""
    ext = Path(filename).suffix.lower()

    if ext == ".xls":
        return "kesafim2000"

    if ext == ".xlsx":
        # Peek at sheet names without loading data
        try:
            wb = openpyxl.load_workbook(filename, read_only=True)
            sheets = wb.sheetnames
            wb.close()
        except Exception:
            return "unknown"

        if "דיווח ביצוע" in sheets:
            return "gefen"
        if "Data" in sheets:
            return "payscool"

    return "unknown"
