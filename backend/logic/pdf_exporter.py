"""PDF export for Gefen-Kesafim reconciliation results using ReportLab."""
from io import BytesIO
from pathlib import Path

from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------------------------------------------------------------------------
# Font registration — bundled Noto Sans Hebrew (works on Linux + Windows)
# ---------------------------------------------------------------------------

_FONTS_DIR = Path(__file__).parent / "fonts"
_FONT_NAME = "NotoHeb"
_FONT_BOLD = "NotoHebBold"
_FONT_REGISTERED = False


def _ensure_fonts():
    global _FONT_REGISTERED, _FONT_NAME, _FONT_BOLD
    if _FONT_REGISTERED:
        return
    try:
        pdfmetrics.registerFont(TTFont(_FONT_NAME, str(_FONTS_DIR / "NotoSansHebrew-Regular.ttf")))
        pdfmetrics.registerFont(TTFont(_FONT_BOLD, str(_FONTS_DIR / "NotoSansHebrew-Bold.ttf")))
    except Exception:
        _FONT_NAME = "Helvetica"
        _FONT_BOLD = "Helvetica-Bold"
    _FONT_REGISTERED = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rtl(text: str) -> str:
    """Apply BiDi only to strings that contain Hebrew characters."""
    if not text:
        return ""
    s = str(text)
    if any("֐" <= c <= "׿" for c in s):
        return get_display(s)
    return s


_STAGE_LABELS = {
    "tikkon":   "תיכון",
    "beinayim": "יסודי/חטיבה",
    "both":     "תיכון + יסודי/חטיבה",
}

_DIVISION_LABELS = {
    "tikkon":   "חטיבה עליונה בלבד",
    "beinayim": "יסודי/חטיבה בלבד",
    "both":     "יסודי/חטיבה + חטיבה עליונה",
}

# Display columns — logical RTL order (rightmost first)
_DISPLAY_COLS_LOGICAL = ["קוד דיווח", "שם ספק", "מספר אסמכתה", "תאריך", "סכום", "תיאור"]

# For ReportLab (LTR rendering), reverse so the rightmost column appears on the right.
# Visual left→right in PDF:  תיאור | סכום | תאריך | מספר אסמכתה | שם ספק | קוד דיווח
_DISPLAY_COLS_VISUAL = list(reversed(_DISPLAY_COLS_LOGICAL))

# Column widths matching the reversed visual order
# Logical widths: קוד(2) שם(4.5) אסמכתה(3) תאריך(2.5) סכום(2) תיאור(3)
# Reversed:       תיאור(3) סכום(2) תאריך(2.5) אסמכתה(3) שם(4.5) קוד(2)
_COL_WIDTHS = [3.0*cm, 2.0*cm, 2.5*cm, 3.0*cm, 4.5*cm, 2.0*cm]

PAGE_WIDTH = A4[0] - 4*cm  # usable width (2cm margins each side)


def _make_result_table(rows: list[dict]) -> Table:
    header = [_rtl(c) for c in _DISPLAY_COLS_VISUAL]
    data   = [header]
    for row in rows:
        data.append([_rtl(str(row.get(c, "") or "")) for c in _DISPLAY_COLS_VISUAL])

    tbl = Table(data, colWidths=_COL_WIDTHS, repeatRows=1)
    tbl.setStyle(TableStyle([
        # Header row
        ("BACKGROUND",    (0, 0), (-1, 0),  colors.HexColor("#dc2626")),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",      (0, 0), (-1, 0),  _FONT_BOLD),
        ("FONTSIZE",      (0, 0), (-1, 0),  8),
        ("ALIGN",         (0, 0), (-1, 0),  "RIGHT"),
        # Body
        ("FONTNAME",      (0, 1), (-1, -1), _FONT_NAME),
        ("FONTSIZE",      (0, 1), (-1, -1), 7),
        ("ALIGN",         (0, 1), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("GRID",          (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
    ]))
    return tbl


def _make_summary_table(pairs: list[tuple[str, str]]) -> Table:
    # Columns: [value (wide, left), label (narrow, right)] → reads RTL as label | value
    data = [[_rtl(v), _rtl(k)] for k, v in pairs]
    col_value = PAGE_WIDTH - 4.5*cm
    tbl = Table(data, colWidths=[col_value, 4.5*cm])
    tbl.setStyle(TableStyle([
        ("FONTNAME",      (0, 0), (0, -1), _FONT_NAME),   # value col
        ("FONTNAME",      (1, 0), (1, -1), _FONT_BOLD),   # label col
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("ALIGN",         (0, 0), (-1, -1), "RIGHT"),
        ("TEXTCOLOR",     (0, 0), (0, -1), colors.HexColor("#334155")),
        ("TEXTCOLOR",     (1, 0), (1, -1), colors.HexColor("#64748b")),
        ("TOPPADDING",    (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("LINEBELOW",     (0, -1), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
    ]))
    return tbl


# ---------------------------------------------------------------------------
# Main export
# ---------------------------------------------------------------------------

def export_pdf(run_data: dict) -> bytes:
    _ensure_fonts()

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm,
        title="דוח פערי גפן-כספים",
    )

    h1  = ParagraphStyle("h1",  fontName=_FONT_BOLD, fontSize=18, textColor=colors.HexColor("#0f172a"), alignment=2, spaceAfter=10)
    h2  = ParagraphStyle("h2",  fontName=_FONT_BOLD, fontSize=12, textColor=colors.HexColor("#0f172a"), alignment=2, spaceAfter=8)
    h3  = ParagraphStyle("h3",  fontName=_FONT_BOLD, fontSize=9,  textColor=colors.HexColor("#334155"), alignment=2, spaceAfter=4)
    sub = ParagraphStyle("sub", fontName=_FONT_NAME,  fontSize=8,  textColor=colors.HexColor("#64748b"), alignment=2, spaceAfter=8)
    ok  = ParagraphStyle("ok",  fontName=_FONT_BOLD,  fontSize=9,  textColor=colors.HexColor("#15803d"), alignment=1, spaceBefore=4, spaceAfter=4)

    summary      = run_data.get("summary", {})
    rows_finance = run_data.get("rows_finance_not_gefen", [])
    rows_gefen   = run_data.get("rows_gefen_not_finance", [])
    finance_sw   = summary.get("finance_file", {}).get("software", "תוכנת הכספים")
    division     = summary.get("division", "")
    division_lbl = _DIVISION_LABELS.get(division, division)

    story = []

    # Title (no date line)
    story.append(Paragraph(_rtl("דוח פערי גפן–כספים"), h1))
    story.append(Spacer(1, 0.4*cm))
    story.append(Paragraph(_rtl(f"הבדיקה בוצעה עבור {division_lbl}"), sub))

    # Table 1
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(_rtl(f"קיים ב{finance_sw}, לא משויך בגפן"), h2))
    if rows_finance:
        story.append(_make_result_table(rows_finance))
    else:
        story.append(Paragraph(_rtl("✓ לא נמצאו ליקויים"), ok))

    # Table 2
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph(_rtl(f"משויך בגפן, לא קיים ב{finance_sw}"), h2))
    if rows_gefen:
        story.append(_make_result_table(rows_gefen))
    else:
        story.append(Paragraph(_rtl("✓ לא נמצאו ליקויים"), ok))

    # Summary section
    story.append(Spacer(1, 0.8*cm))
    story.append(Paragraph(_rtl("תהליך הבדיקה וממצאים"), h2))

    # Gefen files block
    story.append(Paragraph(_rtl("קבצי גפן"), h3))
    gefen_files = summary.get("gefen_files", [])
    gefen_pairs: list[tuple[str, str]] = []
    for f in gefen_files:
        gefen_pairs.append(("שם קובץ:", f.get("filename", "")))
        gefen_pairs.append(("שלב:", _STAGE_LABELS.get(f.get("division", ""), f.get("division", ""))))
        gefen_pairs.append(("אסמכתאות שזוהו:", str(f.get("rows", ""))))
        if f.get("was_deduplicated"):
            gefen_pairs.append(("הערה:", "כפילות שורות זוהתה ונוטרלה אוטומטית"))
    gefen_pairs.append(('סה"כ ייחודיות:', str(summary.get("gefen_rows", ""))))
    story.append(_make_summary_table(gefen_pairs))

    # Finance file block
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(_rtl("קבצים מתוכנת הכספים"), h3))
    ff = summary.get("finance_file", {})
    cancelled  = ff.get("cancelled_rows")
    total_disp = summary.get("finance_rows_total", 0) + (cancelled or 0)
    rows_total   = summary.get("finance_rows_total", 0)
    rows_checked = summary.get("finance_rows_checked", 0)
    finance_pairs: list[tuple[str, str]] = [
        ("שם קובץ:",           ff.get("filename", "")),
        ("סוג תוכנה:",         ff.get("software", "")),
        ("שלב:",               _STAGE_LABELS.get(division, division)),
        ("אסמכתאות שזוהו:",   str(total_disp)),
    ]
    if cancelled is not None:
        finance_pairs.append(("אסמכתאות מבוטלות:", str(cancelled)))
    finance_pairs.append(('סה"כ ייחודיות:', str(rows_checked)))
    if rows_total != rows_checked:
        finance_pairs.append(("הערה:", f"מתוך {rows_total} שורות, {rows_checked} שייכות לשלב שנבדק"))
    story.append(_make_summary_table(finance_pairs))

    # Conclusion block
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(_rtl("מסקנה ותהליך הבדיקה"), h3))
    gefen_label  = _STAGE_LABELS.get(division, division)
    filtered     = rows_total != rows_checked
    n_files      = len(gefen_files)
    gefen_word   = "הועלו" if n_files > 1 else "הועלה"
    gefen_desc   = f"{gefen_word} קובצי דיווח ביצוע עבור {gefen_label}"
    both_label   = _STAGE_LABELS.get("both", "")
    finance_desc = f"הועלה קובץ {finance_sw} עבור {both_label if filtered else gefen_label}"
    conclusion   = f"לכן הבדיקה בוצעה עבור {gefen_label} בלבד." if filtered else f"לכן הבדיקה בוצעה עבור {gefen_label}."
    story.append(_make_summary_table([
        ("גפן:",           gefen_desc),
        ("תוכנת כספים:",   finance_desc),
        ("מסקנה:",         conclusion),
    ]))

    doc.build(story)
    return buf.getvalue()
