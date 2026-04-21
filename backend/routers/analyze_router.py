import uuid
from pathlib import Path
from typing import Annotated

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from auth import decode_token
from logic.excel_exporter import export
from logic.file_identifier import identify_file
from logic.gefen_processor import load_gefen
from logic.kesafim_processor import load_kesafim
from logic.payscool_processor import load_payscool
from logic.reconciler import merge_gefen_files, reconcile

RUNS_DIR = Path(__file__).parent.parent / "runs"
RUNS_DIR.mkdir(exist_ok=True)

router = APIRouter()
security = HTTPBearer()
runs: dict = {}

# Columns shown in JSON results
_GEFEN_RESULT_COLS = [
    "report_code", "קוד ושם ספק", "מספר חשבונית",
    "תאריך חשבונית", "סכום פריט", "מהות ההוצאה",
]
_KESAFIM_RESULT_COLS = [
    "קוד דיווח", "שם ספק", "מספר חשבונית",
    "תאריך חשבונית", "סכום", "תיאור",
]
_PAYSCOOL_RESULT_COLS = [
    "report_code", "שם ספק", "מספר חשבונית",
    "תאריך חשבונית", 'סה"כ לסעיף', "תיאור",
]

# Columns to strip before writing Excel (internal/computed)
_STRIP_COLS = {"ichud", "supplier_number", "amount", "report_code"}

# Hebrew display names for kesafim2000 English column names
_KESAFIM_RENAME = {
    "report_code": "קוד דיווח",
    "supplier": "ספק",
    "supplier_name": "שם ספק",
    "invoice_date": "תאריך חשבונית",
    "invoice_number": "מספר חשבונית",
    "voucher": "שובר",
    "item_number": "מספר פריט",
    "item_name": "שם פריט",
    "description": "תיאור",
    "amount_raw": "סכום",
    "total": "סה\"כ",
    "status": "סטטוס",
}


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> str:
    email = decode_token(credentials.credentials)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")
    return email


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    _user: str = Depends(get_current_user),
):
    run_id = str(uuid.uuid4())
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir()

    # Save all uploaded files to disk so processors can read them
    saved: list[Path] = []
    for uf in files:
        dest = run_dir / uf.filename
        dest.write_bytes(await uf.read())
        saved.append(dest)

    runs[run_id] = {"status": "processing"}
    background_tasks.add_task(_process, run_id, saved)
    return {"run_id": run_id}


@router.get("/result/{run_id}")
def get_result(run_id: str, _user: str = Depends(get_current_user)):
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/download/{run_id}")
def download(run_id: str, _user: str = Depends(get_current_user)):
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done" or "file_path" not in run:
        raise HTTPException(status_code=400, detail="File not ready")
    return FileResponse(
        run["file_path"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="reconciliation.xlsx",
    )


# ---------------------------------------------------------------------------
# Background processing pipeline
# ---------------------------------------------------------------------------

def _process(run_id: str, paths: list[Path]) -> None:
    try:
        gefen_paths, finance_path, finance_type = _classify_files(paths)
        df_gefen = _load_gefen_files(gefen_paths)
        df_finance, finance_label = _load_finance(finance_path, finance_type)
        in_finance_not_gefen, in_gefen_not_finance = reconcile(df_gefen, df_finance)

        excel_path = str(RUNS_DIR / run_id / "reconciliation.xlsx")
        export(
            _for_excel(df_gefen),
            _for_excel(df_finance),
            _for_excel(in_finance_not_gefen),
            _for_excel(in_gefen_not_finance),
            excel_path,
            finance_label=finance_label,
        )

        finance_result_cols = (
            _KESAFIM_RESULT_COLS if finance_type == "kesafim2000" else _PAYSCOOL_RESULT_COLS
        )

        runs[run_id] = {
            "status": "done",
            "finance_type": finance_type,
            "summary": {
                "gefen_rows": len(df_gefen),
                "finance_rows": len(df_finance),
                "in_finance_not_gefen": len(in_finance_not_gefen),
                "in_gefen_not_finance": len(in_gefen_not_finance),
            },
            "rows_finance_not_gefen": _to_records(in_finance_not_gefen, finance_result_cols),
            "rows_gefen_not_finance": _to_records(in_gefen_not_finance, _GEFEN_RESULT_COLS),
            "file_path": excel_path,
        }

    except ValueError as exc:
        runs[run_id] = {"status": "error", "error": str(exc)}
    except Exception as exc:
        runs[run_id] = {"status": "error", "error": f"שגיאה פנימית: {exc}"}


def _classify_files(paths: list[Path]) -> tuple[list[Path], Path, str]:
    gefen: list[Path] = []
    finance_path: Path | None = None
    finance_type: str | None = None

    for p in paths:
        ftype = identify_file(str(p))
        if ftype == "gefen":
            gefen.append(p)
        elif ftype in ("kesafim2000", "payscool"):
            if finance_path is not None:
                raise ValueError("התקבלו שני קבצי כספים. אנא העלה קובץ כספים אחד בלבד.")
            finance_path = p
            finance_type = ftype
        else:
            raise ValueError(
                f"לא הצלחתי לזהות את הקובץ '{p.name}'. "
                "אנא ודא שהעלית קובץ גפן וקובץ תוכנת כספים."
            )

    if not gefen:
        raise ValueError("לא קיבלתי קובץ גפן. אנא העלה לפחות קובץ גפן אחד.")
    if finance_path is None:
        raise ValueError("לא קיבלתי קובץ תוכנת כספים. אנא העלה קובץ כספים2000 או פייסקול.")
    if len(gefen) > 2:
        raise ValueError("התקבלו יותר משני קבצי גפן. אנא העלה עד שני קבצי גפן.")

    return gefen, finance_path, finance_type


def _load_gefen_files(paths: list[Path]) -> pd.DataFrame:
    if len(paths) == 1:
        return load_gefen(str(paths[0]))
    df1 = load_gefen(str(paths[0]))
    df2 = load_gefen(str(paths[1]))
    return merge_gefen_files(df1, df2)


def _load_finance(path: Path, ftype: str) -> tuple[pd.DataFrame, str]:
    if ftype == "kesafim2000":
        df = load_kesafim(str(path))
        df = df.rename(columns=_KESAFIM_RENAME)
        return df, "כספים"
    return load_payscool(str(path)), "פייסקול"


def _for_excel(df: pd.DataFrame) -> pd.DataFrame:
    """Return df with internal/computed columns removed."""
    # Strip both English originals and renamed Hebrew versions of internal cols
    strip = _STRIP_COLS | {_KESAFIM_RENAME.get(c, c) for c in _STRIP_COLS}
    keep = [c for c in df.columns if c not in strip]
    return df[keep]


def _to_records(df: pd.DataFrame, cols: list[str]) -> list[dict]:
    """Serialize selected columns to JSON-safe records."""
    available = [c for c in cols if c in df.columns]
    return (
        df[available]
        .fillna("")
        .astype(str)
        .to_dict(orient="records")
    )
