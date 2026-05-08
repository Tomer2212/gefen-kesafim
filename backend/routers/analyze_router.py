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
from logic.tikhnun_processor import load_tikhnun, cross_reference_doch, build_tikhnun_result
from logic.tikhnun_exporter import export_tikhnun_excel, export_tikhnun_pdf

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

# Known data columns in a "דיווח ביצוע" sheet (used for no-PDF completeness check)
_GEFEN_DATA_COLS = [
    "מספר חשבונית", "תאריך חשבונית", "קוד ושם ספק",
    "מהות ההוצאה", "מספר פריט בחשבונית", "כמות",
    "תיאור פריט", "סכום פריט",
]
# Status/PDF column names as they appear in the gefen sheet
_GEFEN_STATUS_COL = "סטטוס חשבונית"
_GEFEN_PDF_COL    = "האם קיים קובץ"

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
def download_pdf(run_id: str, section: str = "hashva", _user: str = Depends(get_current_user)):
    from fastapi.responses import Response
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run not complete")
    pdf_bytes = export_pdf(run, section=section)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="hashvaa-gefen-kesafim.pdf"'},
    )


@router.get("/download-tikhnun/{run_id}")
def download_tikhnun_excel(
    run_id: str,
    section: str = "sikar",
    multiplier: str = "03",
    _user: str = Depends(get_current_user),
):
    from fastapi.responses import Response
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run not complete")
    tikhnun = run.get("tikhnun")
    if not tikhnun:
        raise HTTPException(status_code=400, detail="No tikhnun data for this run")
    xlsx_bytes = export_tikhnun_excel(tikhnun, section, multiplier)
    filename = f"tikhnun-{section}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pdf-tikhnun/{run_id}")
def download_tikhnun_pdf(
    run_id: str,
    section: str = "sikar",
    multiplier: str = "03",
    _user: str = Depends(get_current_user),
):
    from fastapi.responses import Response
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run not complete")
    tikhnun = run.get("tikhnun")
    if not tikhnun:
        raise HTTPException(status_code=400, detail="No tikhnun data for this run")
    pdf_bytes = export_tikhnun_pdf(tikhnun, section, multiplier)
    filename = f"tikhnun-{section}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pdf-combined/{run_id}")
def download_combined_pdf(
    run_id: str,
    sections: str = "hashva",
    multiplier: str = "03",
    _user: str = Depends(get_current_user),
):
    from fastapi.responses import Response
    from logic.combined_exporter import export_combined_pdf
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run not complete")
    section_list = [s.strip() for s in sections.split(",") if s.strip()]
    pdf_bytes = export_combined_pdf(run, section_list, multiplier)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="gefen-combined.pdf"'},
    )


@router.get("/excel-combined/{run_id}")
def download_combined_excel(
    run_id: str,
    sections: str = "hashva",
    multiplier: str = "03",
    _user: str = Depends(get_current_user),
):
    from fastapi.responses import Response
    from logic.combined_exporter import export_combined_excel
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run not complete")
    section_list = [s.strip() for s in sections.split(",") if s.strip()]
    xlsx_bytes = export_combined_excel(run, section_list, multiplier)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="gefen-combined.xlsx"'},
    )


# ---------------------------------------------------------------------------
# Background processing pipeline
# ---------------------------------------------------------------------------

def _process(run_id: str, paths: list[Path]) -> None:
    try:
        gefen_paths, finance_path, finance_type, tikhnun_paths = _classify_files(paths)

        # ── Tikhnun-only run (no gefen doch) ─────────────────────────────────
        if not gefen_paths and tikhnun_paths:
            if len(tikhnun_paths) == 2:
                td0 = load_tikhnun(str(tikhnun_paths[0]))
                td1 = load_tikhnun(str(tikhnun_paths[1]))
                td0["filename"] = tikhnun_paths[0].name
                td1["filename"] = tikhnun_paths[1].name
                tikkon_data, beinayim_data = _assign_tikhnun_pair(td0, td1)
                tikkon_result   = build_tikhnun_result(tikkon_data)   if tikkon_data   else None
                beinayim_result = build_tikhnun_result(beinayim_data) if beinayim_data else None
                runs[run_id] = {
                    "status": "done",
                    "tikhnun_only": True,
                    "tikhnun": tikkon_result or beinayim_result,
                    "tikhnun_tikkon": tikkon_result,
                    "tikhnun_beinayim": beinayim_result,
                }
            else:
                tikhnun_data = load_tikhnun(str(tikhnun_paths[0]))
                tikhnun_data["filename"] = tikhnun_paths[0].name
                runs[run_id] = {
                    "status": "done",
                    "tikhnun_only": True,
                    "tikhnun": build_tikhnun_result(tikhnun_data),
                }
            return

        # ── Normal run: gefen files present ──────────────────────────────────
        df_gefen, gefen_file_stats, gefen_merge_note = _load_gefen_files(gefen_paths)
        in_gefen_rejected, in_gefen_no_pdf = _extract_gefen_only_results(df_gefen)
        excel_path = str(RUNS_DIR / run_id / "hashvaa-gefen-ksafim.xlsx")

        # Process tikhnun if present (cross-reference with matching-division gefen doch)
        tikhnun_result        = None
        tikhnun_tikkon_result  = None
        tikhnun_beinayim_result = None

        if len(tikhnun_paths) == 1:
            try:
                tikhnun_data = load_tikhnun(str(tikhnun_paths[0]))
                tikhnun_data["filename"] = tikhnun_paths[0].name
                tikhnun_data = cross_reference_doch(tikhnun_data, str(gefen_paths[0]))
                tikhnun_result = build_tikhnun_result(tikhnun_data)
            except Exception as exc:
                logger.error("Tikhnun processing error for run %s: %s", run_id, exc)
                tikhnun_result = {"error": str(exc)}
        elif len(tikhnun_paths) == 2:
            try:
                td0 = load_tikhnun(str(tikhnun_paths[0]))
                td1 = load_tikhnun(str(tikhnun_paths[1]))
                td0["filename"] = tikhnun_paths[0].name
                td1["filename"] = tikhnun_paths[1].name
                tikkon_data, beinayim_data = _assign_tikhnun_pair(td0, td1)
                if tikkon_data:
                    gpath = _find_gefen_path_for_division(gefen_paths, gefen_file_stats, "tikkon")
                    if gpath:
                        tikkon_data = cross_reference_doch(tikkon_data, str(gpath))
                    tikhnun_tikkon_result = build_tikhnun_result(tikkon_data)
                if beinayim_data:
                    gpath = _find_gefen_path_for_division(gefen_paths, gefen_file_stats, "beinayim")
                    if gpath:
                        beinayim_data = cross_reference_doch(beinayim_data, str(gpath))
                    tikhnun_beinayim_result = build_tikhnun_result(beinayim_data)
                tikhnun_result = tikhnun_tikkon_result or tikhnun_beinayim_result
            except Exception as exc:
                logger.error("Tikhnun processing error for run %s: %s", run_id, exc)
                tikhnun_result = {"error": str(exc)}

        # Gefen-only run (no finance) — skip reconciliation
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
                "tikhnun": tikhnun_result,
                "tikhnun_tikkon": tikhnun_tikkon_result,
                "tikhnun_beinayim": tikhnun_beinayim_result,
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
            "tikhnun": tikhnun_result,
            "tikhnun_tikkon": tikhnun_tikkon_result,
            "tikhnun_beinayim": tikhnun_beinayim_result,
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

    except UnicodeDecodeError as exc:
        tb = traceback.format_exc()
        logger.error("Run %s encoding error:\n%s", run_id, tb)
        runs[run_id] = {
            "status": "error",
            "user_message": (
                "המערכת לא הצליחה לעבד את קובץ כספים2000. "
                "במידה והקובץ אינו הקובץ הגולמי כפי שהורד מהמערכת, יש לנסות מחדש עם הקובץ הגולמי."
            ),
            "error": str(exc),
        }
    except ValueError as exc:
        logger.error("Run %s validation error: %s", run_id, exc)
        runs[run_id] = {"status": "error", "error": str(exc)}
    except Exception as exc:
        tb = traceback.format_exc()
        logger.error("Run %s unexpected error:\n%s", run_id, tb)
        runs[run_id] = {"status": "error", "error": f"שגיאה פנימית: {exc}", "traceback": tb}


def _extract_gefen_only_results(df_gefen: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Extract rejected and no-PDF rows from a Gefen dataframe.

    Looks up columns by name (not by positional index) so the function is
    robust against files that have extra/blank columns or a different column
    count than the standard export.
    """
    # ── Rejected rows ────────────────────────────────────────────────────────
    if _GEFEN_STATUS_COL in df_gefen.columns:
        in_gefen_rejected = df_gefen[
            df_gefen[_GEFEN_STATUS_COL].astype(str).str.startswith("נדחה:")
        ].copy()
        in_gefen_rejected["סיבת הדחייה"] = (
            in_gefen_rejected[_GEFEN_STATUS_COL]
            .astype(str)
            .str.replace(r"^נדחה:\s*", "", regex=True)
        )
    else:
        in_gefen_rejected = df_gefen.iloc[0:0].copy()
        in_gefen_rejected["סיבת הדחייה"] = pd.Series([], dtype=str)

    # ── No-PDF rows ──────────────────────────────────────────────────────────
    if _GEFEN_PDF_COL in df_gefen.columns:
        data_cols = [c for c in _GEFEN_DATA_COLS if c in df_gefen.columns]
        if data_cols:
            has_data = (
                df_gefen[data_cols].notna().all(axis=1)
                & df_gefen[data_cols]
                .apply(lambda col: col.astype(str).str.strip() != "")
                .all(axis=1)
            )
        else:
            has_data = pd.Series(True, index=df_gefen.index)
        no_pdf = df_gefen[_GEFEN_PDF_COL].astype(str).str.strip() == "לא"
        in_gefen_no_pdf = df_gefen[has_data & no_pdf]
    else:
        in_gefen_no_pdf = df_gefen.iloc[0:0]

    return in_gefen_rejected, in_gefen_no_pdf


def _classify_files(paths: list[Path]) -> tuple[list[Path], Path | None, str | None, list[Path]]:
    gefen: list[Path] = []
    finance_path: Path | None = None
    finance_type: str | None = None
    tikhnun_paths: list[Path] = []

    for p in paths:
        ftype = identify_file(str(p))
        if ftype == "gefen":
            gefen.append(p)
        elif ftype in ("kesafim2000", "payscool", "schoolcash"):
            if finance_path is not None:
                raise ValueError("התקבלו שני קבצי כספים. אנא העלה קובץ כספים אחד בלבד.")
            finance_path = p
            finance_type = ftype
        elif ftype == "tikhnun":
            tikhnun_paths.append(p)
            if len(tikhnun_paths) > 2:
                raise ValueError("התקבלו יותר משני קבצי תכנון. אנא העלה עד שני קבצי תכנון.")
        else:
            raise ValueError(
                f"הקובץ '{p.name}' אינו בצורתו הגולמית כפי שהורד מהמערכת. "
                "אנא העלה את הקבצים בצורתם הגולמית כפי שהורדו מהמערכות השונות, ללא שינויים."
            )

    # tikhnun only (with or without finance) — treat as tikhnun-only
    if tikhnun_paths and not gefen:
        return [], None, None, tikhnun_paths

    if not gefen and finance_path is not None:
        raise ValueError("לא ניתן לבצע את הבדיקה עם קובץ מתוכנת הכספים בלבד.")
    if not gefen:
        raise ValueError("לא קיבלתי קבצים מזוהים.")
    if len(gefen) > 2:
        raise ValueError("התקבלו יותר משני קבצי גפן. אנא העלה עד שני קבצי גפן.")

    return gefen, finance_path, finance_type, tikhnun_paths


def _assign_tikhnun_pair(td0: dict, td1: dict) -> tuple[dict | None, dict | None]:
    """Assign two loaded tikhnun dicts to (tikkon, beinayim) based on school_stage."""
    tikkon, beinayim = None, None
    for td in (td0, td1):
        if td.get("school_stage") == "תיכון":
            tikkon = td
        else:
            beinayim = td
    return tikkon, beinayim


def _find_gefen_path_for_division(
    gefen_paths: list[Path], stats: list[dict], division: str
) -> Path | None:
    """Return the gefen path whose division matches the requested division, or None."""
    for i, stat in enumerate(stats):
        if stat["division"] == division or stat["division"] == "both":
            return gefen_paths[i]
    return None


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
