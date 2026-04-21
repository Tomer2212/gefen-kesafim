# Project Brain: Gefen Budget Reconciliation Tool

## Context & Purpose
A web-based SaaS tool for educational budget accounting firms. The app compares school budget execution reports from the "Gefen" system (Israeli Ministry of Education) with internal finance software records (Kesafim2000, PaySchool). The goal is to identify discrepancies between invoices that appear in the finance software but are not linked in Gefen, and vice versa.

---

## Tech Stack
- **Backend:** Python 3.11+ with FastAPI
- **Frontend:** React (Vite) + Tailwind CSS + ShadcnUI
- **AI Core:** Claude API (`claude-sonnet-4-20250514`) for file processing and reconciliation
- **Data Handling:** Pandas & Openpyxl for Excel/XLS processing
- **Auth:** JWT-based simple authentication (users stored in a local JSON file for MVP)

---

## Project Structure
```
/
├── backend/
│   ├── main.py                  # FastAPI app entrypoint
│   ├── auth.py                  # JWT login logic
│   ├── users.json               # Hashed user credentials (MVP)
│   ├── routers/
│   │   ├── auth_router.py
│   │   └── analyze_router.py    # File upload + Claude API call
│   └── logic/
│       ├── file_identifier.py   # Detect file type (Gefen / Kesafim2000 / PaySchool)
│       ├── gefen_processor.py   # Parse and clean Gefen files
│       ├── kesafim_processor.py # Parse and clean Kesafim2000 files
│       ├── payscool_processor.py# Parse and clean PaySchool files
│       ├── reconciler.py        # Core comparison logic
│       └── excel_exporter.py    # Generate output Excel file
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   └── MainPage.jsx
│   │   ├── components/
│   │   │   ├── FileUpload.jsx
│   │   │   ├── LoadingScreen.jsx
│   │   │   ├── ResultsView.jsx
│   │   │   └── DownloadButton.jsx
│   │   └── App.jsx
└── .env                         # JWT_SECRET, CLAUDE_API_KEY
```

---

## Core Business Logic (READ THIS CAREFULLY)

### File Types
The system receives 2-3 files per run:

**Gefen files** (one or two):
- Format: XLSX with a sheet named `דיווח ביצוע`
- Contains: invoices already linked ("מושייך") in the Gefen system
- One file = one school division (תיכון / חטיבת ביניים)
- Sometimes one file contains both divisions (mixed)

**Finance files** (one):
- **Kesafim2000:** XLS file that is actually Hebrew TSV (encoding: iso-8859-8). Grouped by report code blocks.
- **PaySchool:** XLSX with sheet named `Data`, 10 columns, 3 header rows to skip.

### File Identification Logic
```
if file.extension == '.xls' → try reading as iso-8859-8 TSV → Kesafim2000
if file.extension == '.xlsx':
    sheets = get_sheet_names(file)
    if 'דיווח ביצוע' in sheets → Gefen file
    if 'Data' in sheets → PaySchool file
```

### Division Classification by Report Codes
```python
TIKKON_ONLY = [48,54,55,58,59,61,62,66,76,87,91,92,94,95,96,97,98,99,100,
               101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,
               116,117,118,119,120,121,122,123,124,125,127,136,137,138,139,
               140,141,142,148,150,152,154,156,158,160,162,164,165,167,169]

BEINAYIM_ONLY = [43,44,45,46,47,49,50,51,52,53,56,57,60,63,64,65,67,68,69,
                 70,71,72,73,74,75,77,78,80,81,83,84,85,88,89,90,126,128,
                 129,130,131,132,133,134,135,147,151,153,155,161,166,168]

SHARED = [157, 159, 163]  # appear in both divisions
```

### Duplicate Detection (Gefen files)
```python
mid = len(df) // 2
if len(df) % 2 == 0 and df.iloc[:mid].reset_index(drop=True).equals(df.iloc[mid:].reset_index(drop=True)):
    df = df.iloc[:mid].reset_index(drop=True)  # keep only first half
```

### Multi-file Gefen Merging
If two Gefen files are provided:
1. Check if one file contains all rows of the other (by comparing ichud sets)
2. If yes → use only the larger file
3. If no → concatenate both files

### The Reconciliation Key (CRITICAL)
Every invoice row gets a unique key called `ichud` (איחוד):
```
ichud = supplier_number + "-" + invoice_number + "-" + report_code + "-" + amount
```

**For Gefen:** supplier_number is extracted from column `קוד ושם ספק` (format: `"123456789- Supplier Name"`) by taking everything before the first `-`.

**For Kesafim2000:** supplier_number is already in its own column (`ספק`).

**For PaySchool:** supplier_number is the `ח.פ` column.

### Amount Normalization (apply to BOTH sides before comparing)
```python
def normalize_amount(val):
    if pd.isna(val) or str(val).strip() == '': return ''
    s = str(val).replace(',', '').strip()
    try:
        f = float(s)
        return str(int(f)) if f == int(f) else f'{f:.2f}'.rstrip('0').rstrip('.')
    except:
        return s
```

### Kesafim2000 Parsing
```python
with open(filepath, 'r', encoding='iso-8859-8') as f:
    content = f.read()

rows = []
current_code = None
header_next = False

for line in content.strip().split('\n'):
    line = line.rstrip('\r')
    parts = line.split('\t')
    if parts[0] == 'קוד גפן':
        current_code = int(parts[1]) if parts[1].strip().isdigit() else None
        header_next = True
        continue
    if header_next:
        header_next = False
        continue
    if not parts[0].strip() or parts[0].strip() == ' ':
        continue
    if current_code and len(parts) >= 11:
        rows.append({
            'report_code': current_code,
            'supplier': parts[0].strip(),
            'supplier_name': parts[1].strip(),
            'invoice_date': parts[2].strip(),
            'invoice_number': parts[3].strip(),
            'voucher': parts[4].strip(),
            'item_number': parts[5].strip(),
            'item_name': parts[6].strip(),
            'description': parts[7].strip(),
            'amount_raw': parts[10].strip(),
            'total': parts[11].strip() if len(parts) > 11 else '',
            'status': parts[12].strip() if len(parts) > 12 else '',
        })
```

### PaySchool Parsing
```python
df = pd.read_excel(filepath, sheet_name='Data', header=None)
df.columns = df.iloc[3]
df = df.iloc[4:].reset_index(drop=True)

# Extract report code from "סעיף" column: "(126)הו קופה קטנה" → "126"
import re
df['report_code'] = df['סעיף'].apply(lambda x: re.search(r'\((\d+)\)', str(x)).group(1) if re.search(r'\((\d+)\)', str(x)) else None)

# Remove summary rows (no report code) and cancelled invoices
df = df[df['report_code'].notna()].copy()
df = df[df['סטטוס חשבונית'] != 'מבוטלת'].copy()
```

### Division Filtering Logic
- If Gefen file contains only TIKKON codes → keep only TIKKON codes from finance file
- If Gefen file contains only BEINAYIM codes → keep only BEINAYIM codes from finance file
- If Gefen file contains both → keep all codes from finance file
- Unknown codes (not in any list) → always include + report them

### Comparison
```python
gefen_set = set(df_gefen['ichud'])
finance_set = set(df_finance['ichud'])

in_finance_not_gefen = df_finance[~df_finance['ichud'].isin(gefen_set)]   # PROBLEM: not linked in Gefen
in_gefen_not_finance = df_gefen[~df_gefen['ichud'].isin(finance_set)]     # PROBLEM: linked in Gefen but missing from finance
```

---

## API Endpoints

```
POST /auth/login          → { email, password } → { token }
POST /analyze/upload      → multipart files → { run_id }
GET  /analyze/result/{id} → { status, summary, rows_finance_not_gefen, rows_gefen_not_finance, download_url }
GET  /analyze/download/{id} → Excel file download
```

---

## Output Excel Structure
6 sheets, all RTL (`ws.sheet_view.rightToLeft = True`):
1. **גפן 1** (orange header) – all Gefen rows with invoice data
2. **גפן 2** (orange) – same as גפן 1
3. **כספים 1 / פייסקול 1** (blue header) – all finance rows
4. **כספים 2 / פייסקול 2** (blue) – same
5. **קיים בכספים אך לא בגפן** (red header, or green ✓ message if empty)
6. **משויך בגפן אך לא בכספים** (red header, or green ✓ message if empty)

Colors:
```python
orange_fill = PatternFill("solid", fgColor="FFA500")
blue_fill   = PatternFill("solid", fgColor="4472C4")
red_fill    = PatternFill("solid", fgColor="FF0000")
header_font = Font(bold=True, color="FFFFFF", name="Arial")
```

---

## UI Requirements

### General
- **RTL layout** throughout the entire app (Hebrew)
- All user-facing text in Hebrew
- All code, variables, comments in English

### Pages
1. **Login page** – email + password, Enter to submit
2. **Main page** – file upload area, run button, results display

### Hebrew UI Strings
```
upload_area:     "העלה / גרור את הקבצים לכאן"
loading_title:   "הבדיקה מתבצעת..."
loading_sub:     "זה יכול לקחת כ-2 דקות. אנא אל תסגור את החלון ואל תרענן."
results_title_1: "קיים בתוכנת הכספים, לא משויך בגפן"
results_title_2: "משויך בגפן, לא מופיע בתוכנת הכספים"
download_btn:    "הורד קובץ Excel"
new_run_btn:     "התחל בדיקה חדשה"
warning:         "לתוצאות מדויקות, יש להעלות קבצים של תקציב גפן בלבד."
```

### Results Display Columns
For finance-not-gefen rows: קוד דיווח, שם ספק, מספר חשבונית, תאריך, סכום, תיאור
For gefen-not-finance rows: קוד דווח, קוד ושם ספק, מספר חשבונית, תאריך חשבונית, סכום פריט, מהות ההוצאה

---

## Error Handling

| Situation | Response |
|-----------|----------|
| Only one file uploaded | "קיבלתי רק קובץ X. כדי לבצע את הבדיקה אני צריך גם קובץ Y." |
| Unrecognized file format | "לא הצלחתי לזהות את סוג הקובץ. אנא ודא שהעלית קובץ גפן וקובץ תוכנת כספים." |
| File contains non-Gefen budget codes | Report in summary but continue |
| Unknown report codes | Include in analysis, mention in summary |
| API timeout | "הבדיקה נכשלה. אנא נסה שוב." |

---

## Development Rules (Token Efficiency)

1. **Always use plan mode** before implementing any new feature
2. **Break work into micro-tasks** – never implement more than one logical unit per prompt
3. **Run `slash compact`** every ~100k tokens
4. Build and test backend logic BEFORE building frontend
5. Test each processor (Gefen, Kesafim2000, PaySchool) independently before integration
6. Never hardcode API keys – always use `.env`

---

## MVP Scope (Build This First)
- [ ] Auth (login/logout with JWT)
- [ ] File upload (2-3 files)
- [ ] File identification logic
- [ ] Gefen processor
- [ ] Kesafim2000 processor
- [ ] PaySchool processor
- [ ] Reconciler (comparison + ichud key)
- [ ] Excel export
- [ ] Results display page
- [ ] Download button

## Out of Scope for MVP
- Password reset via email
- User management dashboard
- Usage history
- Multi-tenant org management
- API key management per org
