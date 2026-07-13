# Project Brain: Gefen AI — Budget Reconciliation SaaS

## Context & Purpose
A multi-user SaaS tool for educational budget accounting firms in Israel. The app:
1. Compares school budget execution reports from the "Gefen" system (Israeli Ministry of Education) with internal finance software records (Kesafim2000, PaySchool, SchoolCash) to find discrepancies.
2. Manages a CRM of schools: contact details, divisions (gefen accounts), assigned advisors, check history.

---

## Tech Stack
- **Backend:** Python 3.11+ with FastAPI
- **Frontend:** React (Vite) + Tailwind CSS
- **Auth + Database:** Supabase (PostgreSQL) — ALL persistent data lives here, no exceptions
- **AI Core:** Claude API (`claude-sonnet-4-20250514`) for file processing and reconciliation
- **Data Handling:** Pandas & Openpyxl for Excel/XLS processing

---

## CRITICAL RULE: Supabase is the Single Source of Truth

**Every piece of persistent data — users, schools, contacts, history — lives in Supabase.**

### Adding a field to an existing table → THREE things must happen in sync:
1. **Supabase DB:** `ALTER TABLE public.<table> ADD COLUMN <field> <type>;` — run via Management API (see below)
2. **Backend Pydantic model** (`SchoolIn` etc. in `schools_router.py`): add the field
3. **Frontend state** (`editForm`, `EMPTY_FORM`, `startEdit()`, `IMPORT_FIELD_CONFIG`): add the field

Missing any of these three steps will cause data to be silently dropped.

### Creating a new table → follow the full checklist in "Creating New Tables in Supabase" below.
A new table requires: CREATE TABLE + GRANT (service_role always; authenticated only if frontend accesses it directly) + ENABLE RLS + CREATE POLICY + verify all three layers. Skipping any step causes silent failures or security holes.

---

## Running DB Migrations (Supabase Management API)

You have direct API access to the Supabase project. Use this to run SQL migrations without needing the user to do it manually.

**Credentials (read from `.env` at project root):**
- `SUPABASE_URL` → extract the project ref from it (e.g., `https://nlfzdpzxvkvjojbdzxdr.supabase.co` → ref = `nlfzdpzxvkvjojbdzxdr`)
- `SUPABASE_PAT` → Personal Access Token for the Management API

**How to run a migration:**
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer {SUPABASE_PAT}" \
  -H "Content-Type: application/json" \
  -d '{"query": "ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS my_field TEXT;"}'
```

**How to verify the schema:**
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer {SUPABASE_PAT}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '\''public'\'' AND table_name = '\''schools'\'' ORDER BY ordinal_position;"}'
```

**Always run a verification query after a migration to confirm the column was added.**

---

## Creating New Tables in Supabase (MANDATORY)

> **⚠️ CRITICAL:** Creating a table alone is not enough. Without explicit `GRANT` statements, the table is inaccessible via supabase-js / PostgREST — even if RLS policies exist. **GRANTs and RLS are two independent layers, both required.**
>
> This is especially important from **October 30, 2026**, when Supabase stops granting default access to new tables in existing projects.

### How access works in this project

| Access path | Role | RLS enforced? | Needs explicit GRANT? |
|-------------|------|---------------|-----------------------|
| Backend (FastAPI) via `supabase_client.py` | `service_role` | **No** (bypassed entirely) | **No** — full access by default |
| Frontend via `supabase-js` (direct Data API) | `authenticated` | **Yes** | **Yes** — must GRANT explicitly |
| Unauthenticated users | `anon` | Yes | Only if public access is needed (not applicable here) |

**Tables currently accessed directly from frontend (`authenticated` role):**
- `profiles` — `DashboardPage.jsx` reads/writes `col_order` and `col_visible` via `supabase.from("profiles")`

All other tables are accessed **only via FastAPI** (service_role) and do not require frontend grants.

### Mandatory checklist for every new table

Run all steps via the Management API (curl pattern above). Never skip a step.

**Step 1 — Create the table:**
```sql
CREATE TABLE public.my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now()
  -- ... other columns
);
```

**Step 2 — Grant to `service_role` (defensive; include always):**
`service_role` has `bypassrls=true` and currently gets automatic grants via default ACL, but include this explicitly for future-proofing (the default ACL will change after October 30, 2026):
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.my_table TO service_role;
```

**Step 3 — Grant to `authenticated` (CRITICAL — only if frontend accesses this table directly):**
If all access goes through FastAPI, **skip this step**. Without this grant, `supabase.from("my_table")` calls from the frontend will fail with a 42501 error. Only include the operations the frontend actually needs.
```sql
-- Read-only from frontend:
GRANT SELECT ON public.my_table TO authenticated;

-- Read + write from frontend:
GRANT SELECT, INSERT, UPDATE, DELETE ON public.my_table TO authenticated;
```

**Step 4 — Enable RLS:**
```sql
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;
```
RLS must always be enabled. Without it, any authenticated user who has a GRANT can read all rows.

**Step 5 — Create RLS policies:**
Policies control *which rows* are accessible. They are evaluated only after the GRANT passes — so both layers must be correct.
```sql
-- Example: users see only their own rows
CREATE POLICY "my_table_select" ON public.my_table
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "my_table_write" ON public.my_table
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```
Adapt the policies to the actual business rules (role-based, school-based, etc.).

**Step 6 — Verify all three layers:**
```bash
# 1. Check grants
curl -s -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer {SUPABASE_PAT}" -H "Content-Type: application/json" \
  -d '{"query": "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = '\''public'\'' AND table_name = '\''my_table'\'' AND grantee IN ('\''anon'\'', '\''authenticated'\'', '\''service_role'\'') ORDER BY grantee, privilege_type;"}'

# 2. Check RLS is enabled
curl -s -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer {SUPABASE_PAT}" -H "Content-Type: application/json" \
  -d '{"query": "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = '\''public'\'' AND tablename = '\''my_table'\'';"}'

# 3. Check policies exist
curl -s -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer {SUPABASE_PAT}" -H "Content-Type: application/json" \
  -d '{"query": "SELECT policyname, cmd, roles, qual FROM pg_policies WHERE schemaname = '\''public'\'' AND tablename = '\''my_table'\'';"}'
```

Expected results:
- `service_role` → SELECT, INSERT, UPDATE, DELETE ✓
- `authenticated` → whichever privileges were granted ✓
- `rowsecurity` → `true` ✓
- At least one policy per operation type (SELECT / INSERT / UPDATE / DELETE) ✓

---

## Database Schema (Supabase / PostgreSQL)

### `profiles` — users (extends auth.users)
```sql
id UUID PRIMARY KEY (references auth.users)
email TEXT
full_name TEXT
role TEXT  -- 'owner' | 'manager' | 'advisor'
delegate_approvals_to_managers BOOLEAN
created_at TIMESTAMPTZ
```

### `schools` — one row per school
```sql
id UUID PRIMARY KEY
name TEXT
symbol TEXT              -- סמל מוסד (5-6 digits)
city TEXT
authority TEXT           -- בעלות (e.g. עירייה, ממלכתי)
district TEXT            -- מחוז (e.g. תל אביב, ירושלים)
stage TEXT               -- 'yesodi' | 'beinayim' | 'tikkon' | 'sheshshnati' | 'other'
finance_software TEXT    -- 'kesafim2000' | 'payscool' | 'schoolcash'
address TEXT
school_phone TEXT
notes TEXT
restrict_access_to JSONB -- null = all advisors; array of profile UUIDs = restricted
extra_contacts JSONB     -- additional contacts beyond the 3 standard roles
org_id UUID              -- tenant identifier (FK → organisations or similar)
status TEXT              -- 'active' | 'deleted' (soft-delete)
deleted_at TIMESTAMPTZ   -- set when status = 'deleted'
-- Contact: principal
principal_name TEXT
principal_phone TEXT
principal_email TEXT
-- Contact: secretary
secretary_name TEXT
secretary_phone TEXT
secretary_email TEXT
-- Contact: finance contact
finance_contact_name TEXT
finance_contact_phone TEXT
finance_contact_email TEXT
created_at TIMESTAMPTZ
```

### `gefen_accounts` — divisions within a school
```sql
id UUID PRIMARY KEY
school_id UUID (FK → schools)
division_type TEXT  -- 'tikkon' | 'beinayim' | 'yesodi' | 'other'
custom_label TEXT
finance_software TEXT
tmura_model BOOLEAN
created_at TIMESTAMPTZ
UNIQUE(school_id, division_type)
```

### `advisor_schools` — junction: which advisors see which schools
```sql
advisor_id UUID (FK → profiles)
school_id UUID (FK → schools)
PRIMARY KEY (advisor_id, school_id)
```

### `check_logs` — history of reconciliation runs
```sql
id UUID PRIMARY KEY
school_id UUID (FK → schools)
gefen_account_id UUID (FK → gefen_accounts)
run_by UUID (FK → profiles)
run_at TIMESTAMPTZ
period TEXT
finance_file_name TEXT
gefen_file_names TEXT[]
in_finance_not_gefen_count INT
in_gefen_not_finance_count INT
summary JSONB
rows_finance_not_gefen JSONB
rows_gefen_not_finance JSONB
```

### `school_update_requests` — advisors request changes, owners approve
```sql
id UUID PRIMARY KEY
school_id UUID (FK → schools)
requester_id UUID (FK → profiles)
proposed_changes JSONB
status TEXT  -- 'pending' | 'approved' | 'rejected'
reviewer_id UUID
reviewer_note TEXT
created_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ
```

---

## Project Structure (current)
```
/
├── .env                          # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PAT, CLAUDE_API_KEY
├── backend/
│   ├── main.py                   # FastAPI entrypoint; loads .env from project root; registers routers; prefetches JWKS on startup
│   ├── auth.py                   # JWT verification via Supabase JWKS (ES256); profile cache (5 min)
│   ├── supabase_client.py        # Supabase admin client (service role key)
│   ├── requirements.txt
│   ├── routers/
│   │   ├── schools_router.py     # All school/user/notification endpoints
│   │   ├── analyze_router.py     # File upload + reconciliation + saves to check_logs
│   │   └── contact_router.py     # Contact form → sends email via Gmail SMTP
│   └── logic/                    # ⚠️ DO NOT TOUCH these files
│       ├── file_identifier.py
│       ├── gefen_processor.py
│       ├── kesafim_processor.py
│       ├── payscool_processor.py
│       ├── schoolcash_processor.py
│       ├── reconciler.py
│       ├── excel_exporter.py
│       ├── pdf_exporter.py
│       ├── tikhnun_processor.py
│       ├── tikhnun_exporter.py
│       └── combined_exporter.py
├── frontend/
│   ├── src/
│   │   ├── lib/supabase.js       # Supabase client (anon key)
│   │   ├── main.jsx              # axios interceptor (adds Supabase session token to every request)
│   │   ├── App.jsx               # React Router routes
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx     # supabase.auth.signInWithPassword
│   │   │   ├── DashboardPage.jsx # school list table with search + advanced filters
│   │   │   ├── SchoolPage.jsx    # school detail: 4 tabs (info / meetings / check / history)
│   │   │   ├── MainPage.jsx      # file upload + reconciliation UI
│   │   │   ├── AdminPage.jsx     # owner/manager: manage schools + users
│   │   │   ├── NotificationsPage.jsx
│   │   │   ├── GuidePage.jsx
│   │   │   ├── ContactPage.jsx
│   │   │   ├── AccessibilityStatementPage.jsx
│   │   │   ├── TermsPage.jsx
│   │   │   └── PrivacyPage.jsx
│   │   ├── components/
│   │   │   ├── Sidebar.jsx       # navigation sidebar (dark prop for Dashboard)
│   │   │   ├── ResultsView.jsx
│   │   │   └── ...
│   │   └── hooks/
│   │       └── useFocusTrap.js   # required for all modal dialogs
│   ├── .env.local                # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   └── vite.config.js
├── CLAUDE.md
└── dev-log.md
```

> **Important:** `.env` is at the **project root**, not inside `backend/`. `main.py` loads it with:
> `load_dotenv(Path(__file__).parent.parent / ".env")`

---

## Auth Flow
- **Login:** frontend calls `supabase.auth.signInWithPassword({ email, password })`
- **Session:** Supabase issues a JWT (ES256). Frontend stores it automatically.
- **API calls:** `main.jsx` axios interceptor reads `supabase.auth.getSession()` and adds `Authorization: Bearer <token>` to every request.
- **Backend verification:** `auth.py` verifies the JWT using Supabase's public JWKS key (fetched once on startup, cached 1 hour). No network call per request. Fetches `role` from the `profiles` table (cached 5 min per user).
- **Cache invalidation:** `invalidate_profile_cache(user_id)` is called immediately after any role change so it takes effect without waiting for the cache TTL.

---

## Role System
| Role | Can do |
|------|--------|
| `owner` | Everything: create/delete schools, manage users, change roles, approve requests |
| `manager` | Create/edit schools, manage advisors, approve requests (if owner delegates) |
| `advisor` | View assigned schools, submit update requests |

Role is stored in `profiles.role`. Also mirrored in `user_metadata.role` in Supabase auth for fast frontend checks.

**Approval delegation:** An owner can set `delegate_approvals_to_managers = true` in their profile. When set, managers are also included in the approver list and receive notifications for pending update requests.

---

## Advisor Assignment Rules

- Any advisor can be assigned to an **unlimited number of schools**. There is no restriction on how many schools a single advisor manages.
- Assignments live in the `advisor_schools` junction table. The backend uses `upsert` so assigning the same advisor twice is safe (no duplicate error).
- An advisor sees a school if: (a) `restrict_access_to` is null (open to all), OR (b) the advisor's UUID is in `restrict_access_to`, OR (c) there is a row in `advisor_schools` for that advisor+school pair.
- The `AdvisorSearch` dropdown in frontend must **never filter out** users based on existing assignments — show all users always. Duplicate prevention is handled by the backend upsert.

---

## API Endpoints

### Schools & Data
```
GET    /schools/                          → list schools (filtered by role + restrict_access_to)
POST   /schools/                          → create school (manager+)
PUT    /schools/{id}                      → update school (manager+)
DELETE /schools/{id}                      → delete school (manager+)

GET    /schools/{id}/accounts             → list gefen accounts (divisions)
POST   /schools/{id}/accounts             → add division (manager+)
PUT    /schools/{id}/accounts/{acc_id}    → edit division (manager+)
DELETE /schools/{id}/accounts/{acc_id}    → remove division (manager+)

GET    /schools/{id}/advisors             → list assigned advisors (manager+)
POST   /schools/{id}/advisors             → assign advisor (manager+) — uses upsert, safe to call twice
DELETE /schools/{id}/advisors/{uid}       → unassign advisor (manager+)

GET    /schools/{id}/logs                 → check history for school

POST   /schools/{id}/update-requests     → advisor submits change request
GET    /schools/update-requests           → list requests (manager+ sees all; advisor sees own)
PATCH  /schools/update-requests/{req_id} → approve/reject (manager+); approved changes are applied immediately

GET    /schools/notifications             → pending count + items for current user

POST   /schools/import                   → bulk import schools from Excel file (manager+)
```

### Users
```
GET    /schools/users/me                  → current user profile
PATCH  /schools/users/me/settings         → delegation setting (owner only)
GET    /schools/users/all                 → all users (manager+)
POST   /schools/users/invite              → invite new user by email (manager+) — sends Supabase magic link
PATCH  /schools/users/{id}/role           → change role (owner only); invalidates profile cache immediately
PATCH  /schools/users/{id}               → update full_name (manager+)
DELETE /schools/users/{id}               → delete user (owner only); cannot delete yourself
```

### Reconciliation
```
POST   /analyze/upload                   → upload files → { run_id }
GET    /analyze/result/{id}              → { status, summary, rows_..., download_url }
GET    /analyze/download/{id}            → Excel file download
```

### Contact
```
POST   /contact/send                     → send contact form email via Gmail SMTP
```

---

## PostgREST Query Rules (IMPORTANT — prevent data bugs)

**Never use nested PostgREST joins to fetch profile data.** The pattern `.select("*, advisor_schools(advisor_id, profiles(...))")` is unreliable in the Supabase Python client — it sometimes silently returns empty profile objects.

**Always use the two-step pattern:**
```python
# Step 1: fetch the primary table with foreign key IDs only
rows = db.table("schools").select("*, advisor_schools(advisor_id)").execute().data

# Step 2: collect all referenced IDs, then fetch profiles in one query
all_ids = list({row["advisor_id"] for s in rows for row in s.get("advisor_schools", []) if row.get("advisor_id")})
if all_ids:
    profiles_map = {p["id"]: p for p in db.table("profiles").select("id, full_name, email").in_("id", all_ids).execute().data}
    for school in rows:
        for row in school.get("advisor_schools", []):
            row["profiles"] = profiles_map.get(row["advisor_id"])
```

This pattern is used in `list_schools()` and `list_logs()` and must be followed for any new endpoint that needs to join `profiles`.

---

## Core Business Logic (DO NOT MODIFY)

### File Types
The system receives 2-3 files per run:

**Gefen files** (one or two):
- Format: XLSX with a sheet named `דיווח ביצוע`
- One file = one school division (תיכון / חטיבת ביניים)

**Finance files** (one):
- **Kesafim2000:** XLS that is actually Hebrew TSV (encoding: iso-8859-8)
- **PaySchool:** XLSX with sheet named `Data`
- **SchoolCash:** XLSX

### File Identification
```
if extension == '.xls' → Kesafim2000
if extension == '.xlsx':
    if 'דיווח ביצוע' in sheets → Gefen
    if 'Data' in sheets → PaySchool
```

### Planning File (תכנון תקציבי)
Optional file, XLSX format, 2 sheets: `הכל` and `פירוט המענים`.
- **Required on first check** for a division; optional on subsequent checks.
- A single planning file can contain **multiple budgets** (e.g., גפן + דוקאטי + תנופה).

**Multi-budget detection** (from `הכל` sheet):
- Scan col A from row 2 (after header); each new unseen name where col H > 0 = one budget.
- Stop when col A repeats a seen name.
- Column indices (0-based): H=7 (גובה תקציב), L=11 (סכום שתוכנן), S=18 (סכום שדווח), T=19 (אחוז דיווח).

**Budget tab name** = `normalize_budget_name(raw_name)` from `backend/zihuy_core.py`:
- "תקציב גפ\"ן" → "גפן", "תקציב סל דוקאטי" → "דוקאטי", etc.

**Per-budget metrics:**
- `sum_chayav`: filter `פירוט המענים` rows where col A = budget name AND col R (index 17) has value → sum col P (index 15). Deduplicate by first 10 columns.
- `nikuy`: run `zihuy_core.identify()` on doch files → filter rows by normalized budget name → sum `nadche` (col_stat starts with "נדחה:") + `lelo_koved` (col_file == "לא") − `overlap`.
- `pct_tanuz` = (S − nikuy) / sum_chayav

**Multi-budget result structure** added to `tikhnun` dict:
```python
tikhnun["budgets"] = [
    {
        "name": "גפן",          # normalized (tab display)
        "raw_name": "תקציב גפ\"ן הכללי",
        "overview": {
            "budget": H,        # גובה תקציב
            "planned": L,       # סכום שתוכנן
            "pct_plan": L/H,    # אחוז תכנון
            "sum_divuach": S,   # סכום שדווח
            "pct_divuach": T,   # אחוז דיווח כללי (fraction)
            "sum_chayav": ...,  # סכום חייב בדיווח
            "pct_tanuz": ...,   # אחוז דיווח למודל תמרוץ (None if no doch)
        },
    },
    ...
]
```
Present only when 2+ budgets detected. Frontend checks `tikhnun.budgets?.length > 1` to show budget selector pills in the סקירה tab.

### Zihuy Core (`backend/zihuy_core.py`) — Row Budget/Stage Identification
Identifies which budget+stage each doch row belongs to. Called from `analyze_router._compute_multi_budget_tikhnun`.

```python
results_clean, warnings, missing_budgets, all_budgets = identify(doch_paths, plan_fpaths)
```

Each row in `results_clean` has:
- `r['budget']`: raw budget name from `פירוט המענים`
- `r['stage']`: 'תיכון' | 'חטיבת ביניים' | 'יסודי'
- `r['orig']`: tuple of raw values — orig[11]=amount, orig[12]=status, orig[13]=file_exists

3-step identification per row:
1. Plan number (col J in doch → match `פירוט המענים` col J)
2. Unique type name (`UNIQUE_TYPE` dict)
3. Report code (col B in doch → match `פירוט המענים` col R)

Rules: חוק הרצף (group completion), Microsoft rule (מענה משרדי groups), last-open-combo rule at file edges.

`normalize_budget_name(raw)` maps raw budget names to display names:
- "גפ\"ן" / "גפן" → "גפן"
- "תנופה לצפון" / "תנופה" → "תנופה"
- "חירום מחוזי" / "גפן חירום" → "גפן חירום"
- "דוקאטי" / "סל דוקאטי" → "דוקאטי"
- "פל\"ג" / "פלג" → "פל\"ג"

### The Reconciliation Key (CRITICAL)
```
ichud = supplier_number + "-" + invoice_number + "-" + report_code + "-" + amount
```

### Division Report Codes
```python
TIKKON_ONLY  = [48,54,55,58,59,61,62,66,76,87,91,92,94,95,96,97,98,99,100,
                101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,
                116,117,118,119,120,121,122,123,124,125,127,136,137,138,139,
                140,141,142,148,150,152,154,156,158,160,162,164,165,167,169]

BEINAYIM_ONLY = [43,44,45,46,47,49,50,51,52,53,56,57,60,63,64,65,67,68,69,
                 70,71,72,73,74,75,77,78,80,81,83,84,85,88,89,90,126,128,
                 129,130,131,132,133,134,135,147,151,153,155,161,166,168]

SHARED = [157, 159, 163]
```

### Amount Normalization
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

---

## Output Excel Structure
6 sheets, all RTL (`ws.sheet_view.rightToLeft = True`):
1. **גפן 1** (orange header)
2. **גפן 2** (orange)
3. **כספים 1 / פייסקול 1** (blue header)
4. **כספים 2 / פייסקול 2** (blue)
5. **קיים בכספים אך לא בגפן** (red, or green ✓ if empty)
6. **משויך בגפן אך לא בכספים** (red, or green ✓ if empty)

---

## UI Requirements
- **RTL layout** throughout — `dir="rtl"` on all page roots
- All user-facing text in **Hebrew**
- All code, variables, comments in **English**
- All explanations to the user in **Hebrew**
- Sidebar: dark mode (`<Sidebar dark />`) on DashboardPage only; white on all other pages

### MeetingRow Auto-Save Pattern (IMPORTANT)
`MeetingRow` saves via `handleRowBlur` — fires when focus leaves the `<tr>`.

**Critical exception:** any field using `onMouseDown` + `e.preventDefault()` (dropdowns, modals, popovers) prevents focus movement, which means `handleRowBlur` **never fires** for that interaction. The draft is updated locally but never sent to Supabase.

**Rule:** these fields MUST call `saveDraft(nd)` immediately on change — do NOT rely on blur.

Fields currently requiring this pattern (all fixed):
- `ParticipantsSelector` → `onChange` ✓
- Notes button → callback passed to `onOpenNotes` ✓
- `AdvisorCell` → `onChange` ✓
- `MeetingTypeSelect` → `onChange` ✓
- `DatePickerPopover` → `onChange` ✓ (was already correct)
- `StatusPicker` → `onMouseDown` ✓ (was already correct)

If you add a new interactive element to `MeetingRow` that uses `onMouseDown` + `e.preventDefault()`, always call `saveDraft(nd)` directly — never assume blur will handle it.

---

## Deployment

### Default Behavior
All changes apply **locally only**. Do NOT push to GitHub or Render unless the user says: "עדכן באתר", "deploy", "תפרוס", "תדחוף ל-Render".

### dev-log.md — Change Tracking
After every set of changes, append an entry to `dev-log.md`:
```
## YYYY-MM-DD — <short title>
- bullet describing change 1
```
This file is the single source of truth for what will be deployed next.

### Pre-Deployment Flow (MUST follow every time)
1. Read `dev-log.md`
2. Present pending changes to user as Hebrew bullet-point summary
3. Ask: **"האם להעלות את כל העדכונים הללו לאתר?"**
4. **Wait for explicit approval**
5. Only after approval: run Deployment Steps
6. After successful push to `main`: clear `dev-log.md` (leave only `# Dev Log`)

### Render Setup
- Platform: Render.com — watches `main` branch (auto-deploy on push)
- Remote: `https://github.com/Tomer2212/gefen-kesafim.git`

### Deployment Steps
```
1. git add <changed files>
2. git commit -m "descriptive message"
3. git push origin dev
4. git checkout main
5. git merge dev -m "Merge dev: <same message>"
6. git push origin main
7. git checkout dev
```

---

## Accessibility Standards (WCAG 2.1 AA / ת"י 5568)

Every new component or page must comply from the start.

| Area | Requirement |
|------|-------------|
| **Forms** | Every `<input>`, `<textarea>`, `<select>` must have a `<label>` with matching `htmlFor`/`id` |
| **Buttons** | Icon-only buttons must have `aria-label` |
| **SVGs** | Decorative → `aria-hidden="true"`. Meaningful → `aria-label` or `<title>` |
| **Tables** | All `<th>` must have `scope="col"` or `scope="row"` |
| **Modals** | `role="dialog" aria-modal="true" aria-labelledby` + `useFocusTrap` hook |
| **Errors** | Wrapping element must have `role="alert"` |
| **Loading** | `role="status"` + `aria-label`; spinner gets `aria-hidden="true"` |

### useFocusTrap usage
```jsx
import { useFocusTrap } from "../hooks/useFocusTrap";
function MyModal({ onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  return (
    <div className="fixed inset-0 z-50 ...">
      <div ref={ref} role="dialog" aria-modal="true"
           aria-labelledby="modal-title" onKeyDown={handleKeyDown}>
        <h2 id="modal-title">...</h2>
      </div>
    </div>
  );
}
```

### Mandatory before every build/PR
- [ ] All form fields have `htmlFor`/`id` pairs
- [ ] All icon-only buttons have `aria-label`
- [ ] All decorative SVGs have `aria-hidden="true"`
- [ ] Any new modal uses `useFocusTrap` + `role="dialog" aria-modal="true"`
- [ ] Error states use `role="alert"`
- [ ] Loading states use `role="status"` + `aria-label`
- [ ] `npx vite build` passes with 0 errors

---

## AdminPage Form Sync Rule

**MANDATORY:** Whenever a field is added/removed/changed in the "new school" form OR the "edit school" form in `AdminPage.jsx`, you MUST ask the user: "האם להחיל את השינוי גם על טופס עריכת בית ספר קיים?" before implementing. The two forms must stay in sync unless the user explicitly says otherwise.

---

## Architecture Invariants (HARD RULES — never break without explicit user approval)

### 1. No In-Memory Run State
**Absolute prohibition** on using global dicts or any server-local memory for run state management.

All run state **must** be persistent and pass exclusively through `_get_run()` and `_update_run()` against the `run_states` table in Supabase. This is what enables multi-worker deployment (4 workers on Render) — if any endpoint reads from a local dict, a request routed to a different worker will return 404.

**Forbidden pattern:**
```python
runs: dict = {}            # ← NEVER add this
runs[run_id] = {...}       # ← NEVER write to local dict
run = runs.get(run_id)     # ← NEVER read from local dict
```

**Required pattern:**
```python
_update_run(run_id, run_data)   # write
run = _get_run(run_id)          # read (always hits Supabase)
```

Both helpers live at the top of `backend/routers/analyze_router.py`.

---

### 2. Immutable Core Logic
**Do NOT touch, modify, or edit any file inside `backend/logic/`** without explicit written approval from the user.

This directory contains the entire mathematical and parsing core:
`file_identifier.py`, `gefen_processor.py`, `kesafim_processor.py`, `payscool_processor.py`, `schoolcash_processor.py`, `reconciler.py`, `excel_exporter.py`, `pdf_exporter.py`, `tikhnun_processor.py`, `tikhnun_exporter.py`, `combined_exporter.py`

Any bug fix or enhancement to parsing/reconciliation logic requires the user to explicitly say: *"you may edit `backend/logic/`"*.

---

### 3. No Ephemeral Disk Usage for Persistent Files
Files uploaded for processing or generated outputs must not rely on Render's ephemeral local disk.

**Rule:**
- **Uploaded source files** → save to `tempfile.mkdtemp()`, upload to Supabase Storage immediately, then clean up in `finally` via `shutil.rmtree()`
- **Generated Excel output** → write to the temp dir, upload to Storage (`excel/{run_id}/...`), serve downloads from Storage via `_get_run(run_id)["excel_storage_key"]`
- **Local disk** is permitted **only** inside `tempfile.mkdtemp()` blocks that are always cleaned up in `finally`

**Required pattern for any new file-processing code:**
```python
run_dir = Path(tempfile.mkdtemp(prefix=f"gefen_{run_id}_"))
try:
    # ... write files to run_dir, process them ...
finally:
    shutil.rmtree(run_dir, ignore_errors=True)
```

---

### 4. Database Changes — Mandatory Checklist
Every new Supabase table requires **all** of the following steps (never skip):

1. `CREATE TABLE public.my_table (...)`
2. `GRANT SELECT, INSERT, UPDATE, DELETE ON public.my_table TO service_role;`
3. If frontend accesses the table directly: `GRANT SELECT [, INSERT, UPDATE, DELETE] ON public.my_table TO authenticated;`
4. `ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;`
5. `CREATE POLICY ...` — at minimum one policy per operation type used
6. Verify all three layers: grants, RLS enabled, policies exist (see "Creating New Tables in Supabase" section above)

Skipping step 2 will cause silent 42501 errors from Supabase after October 30, 2026, when default ACL changes take effect.

---

### 5. `get_admin_client()` Must Be Fetched Inside the Retry `try` Block

**Absolute rule:** `db = get_admin_client()` must appear as the first line **inside** the `try` block of every retry loop — never before the loop.

When `reset_admin_client()` is called in the `except` branch of attempt 0, it sets the singleton to `None`. A `db` reference captured *before the loop* still points to the old stale httpx client. Attempt 1 will use the stale client again and fail → both attempts fail → 503.

**Forbidden pattern:**
```python
db = get_admin_client()       # ← captured before the loop
for attempt in range(2):
    try:
        rows = db.table(...)  # attempt 1 fails → reset_admin_client()
                              # attempt 2: SAME stale db reference!
    except Exception as exc:
        if attempt == 0:
            reset_admin_client()  # resets singleton, but `db` is still stale
```

**Required pattern (matches `list_schools`):**
```python
for attempt in range(2):
    try:
        db = get_admin_client()   # ← fresh reference on every attempt
        rows = db.table(...).execute()
        break
    except Exception as exc:
        if attempt == 0:
            logger.warning("... attempt 1 failed: %s — resetting and retrying", exc)
            reset_admin_client()
            time.sleep(0.1)
        else:
            logger.error("... failed after 2 attempts: %s", exc, exc_info=True)
            raise HTTPException(status_code=503, detail="שגיאה זמנית בשרת — נסה שוב בעוד מספר שניות")
```

This rule applies to **every** `GET` endpoint in `schools_router.py` and `analyze_router.py`.

---

### 6. Secondary Enrichment Queries Must Be Non-Fatal

**Rule:** Any query that enriches primary data with secondary information (profile names, advisor details, meeting stats, etc.) must be wrapped in its own independent `try/except` block. A transient failure in enrichment must never crash the primary endpoint.

**Forbidden pattern:**
```python
# Main query succeeded and returned logs. Now enriching:
user_ids = [r["run_by"] for r in logs]
p_rows = db.table("profiles").select(...).in_("id", user_ids).execute()  # ← unprotected
```

**Required pattern:**
```python
try:
    db = get_admin_client()
    p_rows = db.table("profiles").select(...).in_("id", user_ids).execute()
    profiles_map = {p["id"]: p for p in (p_rows.data or [])}
    for row in logs:
        row["profiles"] = profiles_map.get(row.get("run_by"))
except Exception as exc:
    logger.warning("profile enrichment failed (non-fatal): %s", exc)
    # Primary data (logs) still returned without profile names
```

Endpoints that follow this pattern: `list_logs`, `list_meetings`, `list_schools` (Q3/Q4).

---

### 7. DB-Level Filtering — No Python-Side Table Scans

**Absolute prohibition:** Never fetch a full table into Python and filter in a loop. This breaks at scale and wastes worker memory.

For advisors (restricted access), the required two-step pattern:

```python
# Step 1: lightweight pre-fetch of the advisor's assigned IDs
assigned = db.table("advisor_schools").select("school_id").eq("advisor_id", user["id"]).execute()
assigned_ids = [r["school_id"] for r in (assigned.data or [])]

# Step 2: DB-side filter via .or_() / .in_()
filters = [
    "restrict_access_to.is.null",
    f'restrict_access_to.cs.["{user["id"]}"]',
]
if assigned_ids:
    filters.append(f"id.in.({','.join(assigned_ids)})")

rows = db.table("schools").select("*").or_(",".join(filters)).execute()
```

This scales to 10,000 schools. Python-side filtering does not.

---

### 8. No `ThreadPoolExecutor` on the Shared Supabase Singleton

**Rule:** Do NOT use `ThreadPoolExecutor` to parallelize Supabase queries inside sync FastAPI endpoints (`def`, not `async def`) that share the singleton `httpx.Client`.

**Why:** The singleton uses http/2 multiplexing. In local dev (single uvicorn worker) and on Render under load, launching a second concurrent connection from `ThreadPoolExecutor` forces a new http/2 handshake. The combined overhead (handshake + query) regularly exceeds the 3s timeout, causing one future to return empty results or fail silently.

**Forbidden pattern:**
```python
with ThreadPoolExecutor(max_workers=2) as pool:
    f1 = pool.submit(lambda: db.table("profiles").select(...).execute())
    f2 = pool.submit(lambda: db.rpc("get_meetings_stats", {...}).execute())
    profiles = f1.result()   # may time out — second http/2 connection
    stats = f2.result()
```

**Required pattern:** run sequentially, each with its own non-fatal try/except:
```python
try:
    p_rows = db.table("profiles").select(...).execute()
except Exception as exc:
    logger.warning("profiles enrichment failed (non-fatal): %s", exc)

try:
    stats_res = db.rpc("get_meetings_stats", {...}).execute()
except Exception as exc:
    logger.warning("meetings stats enrichment failed (non-fatal): %s", exc)
```

---

### 9. Silent Fallback for Non-Critical Polling Endpoints

**Rule:** Endpoints that are polled periodically by the UI for non-critical data (notification counts, sidebar badges, stats) must **never** raise `HTTPException`. On failure they must return a safe empty default.

**Why:** These endpoints fire on every page load and on a timer. A 503 from a notification badge polling request triggers the frontend error handler, potentially disrupting the active user session.

**Forbidden pattern:**
```python
@router.get("/notifications")
def get_notifications(user):
    ...
    raise HTTPException(status_code=503, ...)  # ← breaks the UI on transient failure
```

**Required pattern:**
```python
@router.get("/notifications")
def get_notifications(user):
    for attempt in range(2):
        try:
            db = get_admin_client()
            ...
            break
        except Exception as exc:
            if attempt == 0:
                reset_admin_client()
                time.sleep(0.1)
            else:
                logger.warning("get_notifications failed after 2 attempts: %s", exc)
                return {"count": 0, "items": []}   # ← silent safe default
```

Endpoints that require this pattern: `get_notifications`, any future stats/badge endpoint.

---

## Plan Presentation Rule (MANDATORY)

Whenever a plan is presented to the user (plan mode, `ExitPlanMode`, or any "here's what I'm going to do" summary), it must be written **entirely in Hebrew** — no English.

In addition, alongside the professional/technical explanation, include a **simplified version** of the plan written as if explaining it to a 5-year-old (שפה פשוטה כמו לילד בן 5) — short sentences, everyday words, no technical terms. Present both: the professional plan first, then a short "בפשטות:" section underneath.

---

## Local Dev Troubleshooting (Windows) — Orphaned `uvicorn --reload` Worker

**Symptom:** Backend code changes (new endpoints, edited logic) don't take effect in the browser even after the user closes and reopens the terminal running `uvicorn main:app --reload`. Requests to genuinely new routes return `404 Not Found` instead of hitting the route (e.g. instead of `403 Not authenticated`, which is what a real auth-protected route returns when hit without a token).

**Cause:** `uvicorn --reload` on Windows spawns a separate child worker process (via `multiprocessing`) that actually holds the listening socket and serves requests. Force-closing the parent/terminal (or `Stop-Process` on the parent PID) does **not** kill this child — it becomes orphaned, keeps the port bound, and keeps serving whatever code was loaded into its memory at the time it forked (i.e. stale code, from before the edit). A new `uvicorn` instance started afterward on the same port may appear to start successfully, but the old orphaned worker can still be the one actually answering requests. This can stack up silently across multiple restarts over days.

**How to detect it:** `Get-CimInstance Win32_Process -Filter "Name='python.exe'"` (PowerShell) and look for **more than one** python process, especially ones with `-c "from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=...)"` in the command line whose `parent_pid` no longer corresponds to a running process.

**Fix:** Kill *all* `python.exe` processes related to the backend (both the reloader and any orphaned `--multiprocessing-fork` children), confirm the port is free (`Get-NetTCPConnection -LocalPort 8000 -State Listen`), then start a single fresh `uvicorn` instance. Verify with a direct `curl` to a known new route — a `403`/expected-auth response confirms the route is registered; a `404` means you're still hitting a stale process.

---

## Development Rules

1. **Always use plan mode** before implementing any new feature
2. All explanations to the user must be in **Hebrew**
3. Never hardcode API keys — always use `.env` / `.env.local`
4. **Do NOT touch** any file in `backend/logic/` (see Architecture Invariants §2)
5. After every change: append to `dev-log.md`
6. Run `npx vite build` after every frontend change to verify 0 errors
7. When adding a field to `schools`: run the DB migration via Management API (see above), update `SchoolIn` in `schools_router.py`, update frontend state in both `AdminPage.jsx` and `SchoolPage.jsx`
