import logging
import re
import traceback
import uuid
from pathlib import Path
from typing import Annotated

logger = logging.getLogger(__name__)

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from auth import decode_token
from logic.excel_exporter import export
from logic.pdf_exporter import export_pdf
from logic.file_identifier import identify_file
from logic.gefen_processor import load_gefen, normalize_amount
from logic.kesafim_processor import load_kesafim
from logic.payscool_processor import load_payscool
from logic.schoolcash_processor import load_schoolcash
from logic.reconciler import BEINAYIM_ONLY, TIKKON_ONLY, reconcile

RUNS_DIR = Path(__file__).parent.parent / "runs"
RUNS_DIR.mkdir(exist_ok=True)

router = APIRouter()
security = HTTPBearer()
runs: dict = {}

# Unified JSON column names — same for both finance types and gefen side
_DISPLAY_COLS = ["קוד דיווח", "שם ספק", "מספר אסמכתה", "תאריך", "סכום", "תיאור"]

# Column maps: list of (source_col, display_col, transform_fn | None)
_PAYSCOOL_COL_MAP = [
    ("קוד דיווח",      "קוד דיווח",   None),
    ("שם ספק",         "שם ספק",       None),
    ("מספר חשבונית",   "מספר אסמכתה", normalize_amount),
    ("תאריך חשבונית",  "תאריך",        _norm_date := None),  # assigned below
    ('סה"כ לסעיף',     "סכום",         None),
    ("תיאור",           "תיאור",        None),
]

_SCHOOLCASH_COL_MAP = [
    ("קוד דיווח",              "קוד דיווח",   None),
    ("שם ספק",                 "שם ספק",       None),
    ("מספר חשבונית",           "מספר אסמכתה", normalize_amount),
    ("תאריך חשבונית",          "תאריך",        None),  # patched below
    ("סכום",                   "סכום",         None),  # patched below
    ("תאור שורה בחשבונית",    "תיאור",        None),
]

_KESAFIM_COL_MAP = [
    ("קוד דיווח",      "קוד דיווח",   None),
    ("שם ספק",         "שם ספק",       None),
    ("מספר חשבונית",   "מספר אסמכתה", None),
    ("תאריך חשבונית",  "תאריך",        None),  # patched below
    ("סכום",            "סכום",         None),
    ("תיאור",           "תיאור",        None),
]

_GEFEN_COL_MAP = [
    ("report_code",    "קוד דיווח",   None),
    ("קוד ושם ספק",    "שם ספק",       None),
    ("מספר חשבונית",   "מספר אסמכתה", normalize_amount),
    ("תאריך חשבונית",  "תאריך",        None),  # patched below
    ("סכום פריט",      "סכום",         normalize_amount),
    ("מהות ההוצאה",    "תיאור",        None),
]

# Same as _GEFEN_COL_MAP but last column is "סיבת הדחייה" (extracted from col M)
_GEFEN_REJECTED_COL_MAP = [
    ("report_code",    "קוד דיווח",     None),
    ("קוד ושם ספק",    "שם ספק",         None),
    ("מספר חשבונית",   "מספר אסמכתה",  normalize_amount),
    ("תאריך חשבונית",  "תאריך",          None),  # patched below
    ("סכום פריט",      "סכום",           None),   # patched below
    ("סיבת הדחייה",   "סיבת הדחייה",   None),
]

# Columns to strip before writing Excel (internal/computed)
_STRIP_COLS = {"ichud", "supplier_number", "amount", "report_code"}

# Hebrew display names for kesafim2000 English column names
_KESAFIM_RENAME = {
    "report_code":    "קוד דיווח",
    "supplier":       "ספק",
    "supplier_name":  "שם ספק",
    "invoice_date":   "תאריך חשבונית",
    "invoice_number": "מספר חשבונית",
    "voucher":        "שובר",
    "item_number":    "מספר פריט",
    "item_name":      "שם פריט",
    "description":    "תיאור",
    "amount_raw":     "סכום",
    "total":          'סה"כ',
    "status":         "סטטוס",
}


# ---------------------------------------------------------------------------
# Value normalizers
# ---------------------------------------------------------------------------

def _normalize_date(val: str) -> str:
    """Normalize any date format to DD/MM/YYYY."""
    s = str(val).strip()
    if not s or s == "nan":
        return ""
    # DD/MM/YYYY — already correct
    if re.match(r"^\d{1,2}/\d{1,2}/\d{4}$", s):
        d, m, y = s.split("/")
        return f"{int(d):02d}/{int(m):02d}/{y}"
    # DD-MM-YYYY
    if re.match(r"^\d{1,2}-\d{1,2}-\d{4}$", s):
        d, m, y = s.split("-")
        return f"{int(d):02d}/{int(m):02d}/{y}"
    # DD.MM.YY or DD.MM.YYYY
    if re.match(r"^\d{1,2}\.\d{1,2}\.\d{2,4}$", s):
        parts = s.split(".")
        d, m, y = parts[0], parts[1], parts[2]
        if len(y) == 2:
            y = "20" + y
        return f"{int(d):02d}/{int(m):02d}/{y}"
    # YYYY-MM-DD ... (ISO or pandas Timestamp with time component)
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        y, m, d = s[:10].split("-")
        return f"{int(d):02d}/{int(m):02d}/{y}"
    return s


def _format_display_amount(val: str) -> str:
    """Format a numeric string with thousands comma separator for display (e.g. 2500 → 2,500)."""
    s = str(val).strip().replace(",", "")
    if not s or s == "nan":
        return ""
    try:
        f = float(s)
        if f == int(f):
            return f"{int(f):,}"
        return f"{f:,.2f}".rstrip("0").rstrip(".")
    except ValueError:
        return val


# Patch date normalizer and amount formatter into all maps
_PAYSCOOL_COL_MAP[3]    = ("תאריך חשבונית", "תאריך", _normalize_date)
_PAYSCOOL_COL_MAP[4]    = ('סה"כ לסעיף',    "סכום",   _format_display_amount)
_SCHOOLCASH_COL_MAP[3]  = ("תאריך חשבונית", "תאריך", _normalize_date)
_SCHOOLCASH_COL_MAP[4]  = ("סכום",          "סכום",   _format_display_amount)
_KESAFIM_COL_MAP[3]     = ("תאריך חשבונית", "תאריך", _normalize_date)
_GEFEN_COL_MAP[3]       = ("תאריך חשבונית", "תאריך", _normalize_date)
_GEFEN_COL_MAP[4]       = ("סכום פריט",     "סכום",   _format_display_amount)
_GEFEN_REJECTED_COL_MAP[3] = ("תאריך חשבונית", "תאריך", _normalize_date)
_GEFEN_REJECTED_COL_MAP[4] = ("סכום פריט",     "סכום",   _format_display_amount)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

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
        filename="hashvaa-gefen-ksafim.xlsx",
    )


@router.get("/pdf/{run_id}")
def download_pdf(run_id: str, _user: str = Depends(get_current_user)):
    from fastapi.responses import Response
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run not complete")
    pdf_bytes = export_pdf(run)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="hashvaa-gefen-kesafim.pdf"'},
    )


# ---------------------------------------------------------------------------
# Background processing pipeline
# ---------------------------------------------------------------------------

def _process(run_id: str, paths: list[Path]) -> None:
    try:
        gefen_paths, finance_path, finance_type = _classify_files(paths)
        df_gefen, gefen_file_stats, gefen_merge_note = _load_gefen_files(gefen_paths)

        in_gefen_rejected, in_gefen_no_pdf = _extract_gefen_only_results(df_gefen)
        excel_path = str(RUNS_DIR / run_id / "hashvaa-gefen-ksafim.xlsx")

        # Gefen-only run — skip finance loading and reconciliation
        if finance_path is None:
            export(
                _for_excel(df_gefen),
                None,
                None,
                None,
                excel_path,
                finance_label=None,
                in_gefen_rejected=_for_excel(in_gefen_rejected),
                in_gefen_no_pdf=_for_excel(in_gefen_no_pdf),
                gefen_only=True,
            )
            runs[run_id] = {
                "status": "done",
                "gefen_only": True,
                "finance_type": None,
                "summary": {
                    "gefen_rows": len(df_gefen),
                    "in_gefen_rejected": len(in_gefen_rejected),
                    "in_gefen_no_pdf": len(in_gefen_no_pdf),
                    "division": _detect_gefen_division(df_gefen),
                    "gefen_files": gefen_file_stats,
                    "gefen_merge_note": gefen_merge_note,
                },
                "rows_gefen_rejected": _build_display_records(in_gefen_rejected, _GEFEN_REJECTED_COL_MAP),
                "rows_gefen_no_pdf": _build_display_records(in_gefen_no_pdf, _GEFEN_COL_MAP),
                "file_path": excel_path,
            }
            return

        # Load raw finance df — kesafim2000 still has English column names here
        # so that reconciler._filter_by_division can access "report_code"
        df_finance_raw, finance_label, finance_file_stats = _load_finance_raw(finance_path, finance_type)
        in_finance_not_gefen, in_gefen_not_finance, division, finance_rows_checked = reconcile(df_gefen, df_finance_raw)

        # Rename report_code → קוד דיווח for all finance types after reconciliation.
        # Kesafim also renames its other English columns to Hebrew display names.
        if finance_type == "kesafim2000":
            df_finance = df_finance_raw.rename(columns=_KESAFIM_RENAME)
            in_finance_not_gefen = in_finance_not_gefen.rename(columns=_KESAFIM_RENAME)
        else:
            _payscool_rename = {"report_code": "קוד דיווח"}
            df_finance = df_finance_raw.rename(columns=_payscool_rename)
            in_finance_not_gefen = in_finance_not_gefen.rename(columns=_payscool_rename)

        export(
            _for_excel(df_gefen),
            _for_excel(df_finance),
            _for_excel(in_finance_not_gefen),
            _for_excel(in_gefen_not_finance),
            excel_path,
            finance_label=finance_label,
            in_gefen_rejected=_for_excel(in_gefen_rejected),
            in_gefen_no_pdf=_for_excel(in_gefen_no_pdf),
        )

        if finance_type == "kesafim2000":
            finance_col_map = _KESAFIM_COL_MAP
        elif finance_type == "schoolcash":
            finance_col_map = _SCHOOLCASH_COL_MAP
        else:
            finance_col_map = _PAYSCOOL_COL_MAP

        runs[run_id] = {
            "status": "done",
            "gefen_only": False,
            "finance_type": finance_type,
            "summary": {
                "gefen_rows": len(df_gefen),
                "finance_rows_total": len(df_finance_raw),
                "finance_rows_checked": finance_rows_checked,
                "in_finance_not_gefen": len(in_finance_not_gefen),
                "in_gefen_not_finance": len(in_gefen_not_finance),
                "in_gefen_rejected": len(in_gefen_rejected),
                "in_gefen_no_pdf": len(in_gefen_no_pdf),
                "division": division,
                "gefen_files": gefen_file_stats,
                "gefen_merge_note": gefen_merge_note,
                "finance_file": {
                    **finance_file_stats,
                    "rows_total": len(df_finance_raw),
                    "rows_checked": finance_rows_checked,
                },
            },
            "rows_finance_not_gefen": _build_display_records(in_finance_not_gefen, finance_col_map),
            "rows_gefen_not_finance": _build_display_records(in_gefen_not_finance, _GEFEN_COL_MAP),
            "rows_gefen_rejected": _build_display_records(in_gefen_rejected, _GEFEN_REJECTED_COL_MAP),
            "rows_gefen_no_pdf": _build_display_records(in_gefen_no_pdf, _GEFEN_COL_MAP),
            "file_path": excel_path,
        }

    except ValueError as exc:
        logger.error("Run %s validation error: %s", run_id, exc)
        runs[run_id] = {"status": "error", "error": str(exc)}
    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("Run %s unexpected error:\n%s", run_id, tb)
        runs[run_id] = {"status": "error", "error": f"שגיאה פנימית: {exc}", "traceback": tb}


def _extract_gefen_only_results(df_gefen: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Extract rejected and no-PDF rows from a Gefen dataframe."""
    col_m = df_gefen.columns[12] if len(df_gefen.columns) > 12 else None
    if col_m is not None:
        in_gefen_rejected = df_gefen[df_gefen[col_m].astype(str).str.startswith("נדחה:")].copy()
        in_gefen_rejected["סיבת הדחייה"] = (
            in_gefen_rejected[col_m].astype(str).str.replace(r"^נדחה:\s*", "", regex=True)
        )
    else:
        in_gefen_rejected = df_gefen.iloc[0:0].copy()
        in_gefen_rejected["סיבת הדחייה"] = pd.Series([], dtype=str)

    if len(df_gefen.columns) > 13:
        cols_e_to_l = df_gefen.columns[4:12]
        col_n = df_gefen.columns[13]
        has_data = (
            df_gefen[cols_e_to_l].notna().all(axis=1) &
            df_gefen[cols_e_to_l].apply(lambda col: col.astype(str).str.strip() != "").all(axis=1)
        )
        no_pdf = df_gefen[col_n].astype(str).str.strip() == "לא"
        in_gefen_no_pdf = df_gefen[has_data & no_pdf]
    else:
        in_gefen_no_pdf = df_gefen.iloc[0:0]

    return in_gefen_rejected, in_gefen_no_pdf


def _classify_files(paths: list[Path]) -> tuple[list[Path], Path | None, str | None]:
    gefen: list[Path] = []
    finance_path: Path | None = None
    finance_type: str | None = None

    for p in paths:
        ftype = identify_file(str(p))
        if ftype == "gefen":
            gefen.append(p)
        elif ftype in ("kesafim2000", "payscool", "schoolcash"):
            if finance_path is not None:
                raise ValueError("התקבלו שני קבצי כספים. אנא העלה קובץ כספים אחד בלבד.")
            finance_path = p
            finance_type = ftype
        else:
            raise ValueError(
                f"הקובץ '{p.name}' אינו בצורתו הגולמית כפי שהורד מהמערכת. "
                "אנא העלה את הקבצים בצורתם הגולמית כפי שהורדו מהמערכות השונות, ללא שינויים."
            )

    if not gefen and finance_path is not None:
        raise ValueError("לא ניתן לבצע את הבדיקה עם קובץ מתוכנת הכספים בלבד.")
    if not gefen:
        raise ValueError("לא קיבלתי קבצים מזוהים.")
    if len(gefen) > 2:
        raise ValueError("התקבלו יותר משני קבצי גפן. אנא העלה עד שני קבצי גפן.")

    return gefen, finance_path, finance_type


def _detect_gefen_division(df: pd.DataFrame) -> str:
    codes = set(df["report_code"].dropna().astype(int).tolist())
    has_tikkon   = bool(codes & set(TIKKON_ONLY))
    has_beinayim = bool(codes & set(BEINAYIM_ONLY))
    if has_tikkon and not has_beinayim:
        return "tikkon"
    if has_beinayim and not has_tikkon:
        return "beinayim"
    return "both"


def _load_gefen_files(paths: list[Path]) -> tuple[pd.DataFrame, list[dict], dict | None]:
    loaded    = [load_gefen(str(p)) for p in paths]
    dfs       = [df for df, _ in loaded]
    dedup_flags = [was_dedup for _, was_dedup in loaded]

    per_file_stats = [
        {
            "filename": p.name,
            "division": _detect_gefen_division(df),
            "rows": len(df),
            "was_deduplicated": was_dedup,
        }
        for p, df, was_dedup in zip(paths, dfs, dedup_flags)
    ]

    if len(dfs) == 1:
        return dfs[0], per_file_stats, None

    # Two gefen files — compute overlap, merge with dedup
    set0    = set(dfs[0]["ichud"])
    set1    = set(dfs[1]["ichud"])
    overlap = len(set0 & set1)

    if set0 >= set1:
        merged = dfs[0]
    elif set1 >= set0:
        merged = dfs[1]
    else:
        merged = (
            pd.concat([dfs[0], dfs[1]], ignore_index=True)
            .drop_duplicates(subset=["ichud"])
            .reset_index(drop=True)
        )

    merge_note = {
        "overlap": overlap,
        "unique": len(set0 | set1),
        "file0_rows": len(dfs[0]),
        "file1_rows": len(dfs[1]),
    }
    return merged, per_file_stats, merge_note


def _load_finance_raw(path: Path, ftype: str) -> tuple[pd.DataFrame, str, dict]:
    """Load finance file without renaming columns — reconciler needs 'report_code' intact."""
    if ftype == "kesafim2000":
        df = load_kesafim(str(path))
        stats = {"filename": path.name, "software": "כספים2000", "cancelled_rows": None}
        return df, "כספים", stats
    if ftype == "schoolcash":
        df = load_schoolcash(str(path))
        stats = {"filename": path.name, "software": "סקולקאש", "cancelled_rows": None}
        return df, "סקולקאש", stats
    df, cancelled = load_payscool(str(path))
    stats = {"filename": path.name, "software": "פייסקול", "cancelled_rows": cancelled}
    return df, "פייסקול", stats


def _for_excel(df: pd.DataFrame) -> pd.DataFrame:
    """Return df with internal/computed columns removed.

    Only strip the raw internal names (report_code, ichud, etc.) — NOT their
    Hebrew renamed equivalents like קוד דיווח, which are display columns that
    belong in the Excel output.
    """
    keep = [c for c in df.columns if c not in _STRIP_COLS]
    return df[keep]


def _build_display_records(
    df: pd.DataFrame,
    col_map: list[tuple],
) -> list[dict]:
    """Build JSON records with unified display column names and value transforms."""
    result: dict[str, list] = {}
    for src_col, display_col, transform in col_map:
        if src_col in df.columns:
            series = df[src_col].fillna("").astype(str).replace("nan", "")
            if transform:
                series = series.apply(lambda v: transform(v) if v else "")
        else:
            series = pd.Series([""] * len(df))
        result[display_col] = series.tolist()

    # Transpose to list of dicts
    keys = [display_col for _, display_col, _ in col_map]
    return [
        {k: result[k][i] for k in keys}
        for i in range(len(df))
    ]
