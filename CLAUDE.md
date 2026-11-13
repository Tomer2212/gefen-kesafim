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
finance_software TEXT    -- 'kesafim2000' | 'payscool' | 'schoolcash' | 'other'
finance_software_other_text TEXT -- free-text software name, only meaningful when finance_software = 'other'
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
activity JSONB  -- [{run_id, user_id, at, kind: 'created'|'updated', files: {tikhnun[], gefen[], finance}}] — written by _record_check_activity (non-fatal); one event per run_id; shown in the "מבצע הבדיקה" column
```

### `year_closure_notes` — signed notes in the school card's "סגירת שנה" tab
```sql
id UUID PRIMARY KEY
school_id UUID (FK → schools, ON DELETE CASCADE)
academic_year TEXT
scope TEXT          -- 'parents' | 'authority' | 'gefen'
division_type TEXT  -- only for scope='gefen'
budget_name TEXT    -- only for scope='gefen'
author_id UUID      -- FK → profiles; NULL = legacy note migrated with no known author
is_legacy BOOLEAN
content TEXT
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```
Every user (owner/manager included) may edit/delete only their own notes; a NULL-author note is deletable by the owner only. The old free-text columns `school_year_admin_data.closure_parents_notes` / `closure_authority_notes` and `gefen_year_closures.notes` are a **server-maintained summary** (newest first, `dd/mm/yy HH:MM · name: content` per line) rewritten by `_sync_closure_notes_summary` — never write them directly; the dashboard/admin columns and task field-conditions read them.

**"מערכת גפן" sections (`GET /schools/{id}/gefen-closures`):** check-derived (division, budget) combos from `check_metrics`, PLUS a default "גפן" section per division of the school's `stage` (`_default_gefen_divisions`: sheshshnati → beinayim + tikkon; empty/other stage → one `division_type='general'` section titled just "גפן"), so a school can be closed before any check. The stage wins for "גפן": a check-derived "גפן" combo outside the stage's divisions is hidden unless it already has a status/notes (a saved "גפן" section never disappears). A school whose checks show פל"ג instead of גפן (in that division, or anywhere when no check of the year has גפן) gets no default "גפן" section. Default sections are virtual — no row until a status/note is saved. `DashboardPage.jsx`'s `defaultGefenDivisions` mirrors the backend helper — keep them in sync. The dashboard's "סגירת שנה גפן" rows (`gefenClosureRowDivisions`) also include every saved "גפן" section with a status (the card's `saved_gefen`), and under a goal filter a school with no check gets those same rows (never `school.stage`, which matches no section).

### `meeting_activity` — per-meeting activity log ("תיעוד פעילות")
```sql
id UUID PRIMARY KEY
meeting_id UUID      -- NO FK on purpose: the log outlives a deleted meeting
school_id UUID, org_id UUID
actor_id UUID        -- NULL for school (public booking link) / system / Outlook
actor_type TEXT      -- 'user' | 'school' | 'system' | 'outlook'
source TEXT          -- school_card | personal | admin | status_popup | import | import_remap | booking_link | task_booking_link | outlook | auto_complete | calls_sync | user_transfer | NULL
action TEXT          -- created | updated | deleted | moved_year | reassigned_school | advisor_joined | note_added/edited/deleted | offline_added/edited/deleted | summary_uploaded | request_resolved | request_reopened
changes JSONB        -- {field: {from, to}} — only tracked fields that really changed
snapshot JSONB       -- tracked fields after the action
meta JSONB           -- note content, offline entry, task_id, Outlook calendar owners, …
created_at TIMESTAMPTZ
```
service_role only (no `authenticated` grant; RLS on with a deny-all policy). Written exclusively via `backend/meeting_activity.py` → `log_meeting_activity` / `log_meeting_activity_bulk` (always non-fatal). Read via `GET /schools/{id}/meetings/{mid}/activity`, which merges consecutive same-actor/same-source `updated` events within 10 min and synthesizes a `legacy` "created" row (from `meetings.created_by/created_at/created_via/booking_token_id`) for meetings that predate the log. **Any new code path that writes `meetings` (or meeting notes / offline work / summary) MUST call `log_meeting_activity` after its write** — read the before-state with `meeting_activity.fetch_tracked` first. An `updated` with no real change is dropped automatically, so calling it on every autosave is fine. Frontend meeting create/PUT/PATCH calls send an `X-Client-Surface` header (`school_card` / `personal` / `admin` / `status_popup`) so the log can say where a change came from — keep sending it from any new meetings surface (`MeetingsTable` takes a `clientSurface` prop).

### Calls scan — `POST /calls/process-new-calls` (ambiguous / unknown-number call prompts)
Triggered **every 5 min by Supabase pg_cron + pg_net** (job `calls-process-new-calls`, `CRON_SECRET` read from Supabase Vault secret `cron_secret`); `.github/workflows/voicenter-poll-calls.yml` is only a backup (GitHub's schedule lagged 3-7 h — the cause of day-late "which school?" prompts). Change frequency with `cron.alter_job` — no deploy needed. Overlap-safe: per-org lease `calls_integrations.scan_lock_until`, and `calls_scan_processed (org_id, call_id)` (service_role only, deny-all RLS, rows pruned after 3 days) records calls already handled, because each scan re-pulls a 3 h lookback (providers filter by call START, but a call only appears once it ENDS) and keeps calls that ended after `last_call_scan_at − 30 min`. `calls_call_contact_resolutions` is unique on `(org_id, call_id)`. The caller advisor sees an `AmbiguousCallPopup` (feed: `GET /calls/calls/ambiguous/my-prompts`, calls from the last 48 h) in addition to the bell notification.

### Outlook webhook subscriptions — renewed by pg_cron twice a day
pg_cron job `calendar-renew-subscriptions` (jobid 5, created 2026-11-13; `0 4,16 * * *` UTC = 06:00/18:00 Israel in winter) calls `POST /calendar/renew-subscriptions` (same `net.http_post` + Vault `cron_secret` shape as the other jobs). It renews only subscriptions expiring within 24 h, so extra runs are harmless; a subscription Graph no longer has is recreated. `.github/workflows/renew-calendar-subscriptions.yml` stays as a backup, and it is the only one that emails on failure (pg_cron fails silently — `net._http_response` keeps responses for ~6 h only). Graph sometimes takes 15-30 s to renew one mailbox, hence `timeout=30` in `graph_client.renew_subscription`; renewals run one by one, so the workflow's `curl --max-time` is 300 s — keep it well above (subscriptions due × 30 s) or the backup emails false failures.

### Meeting "בפועל" + auto-completion — how it stays near-real-time (target: ≤5 min from call end)
- **New calls:** the scan above attributes them to same-day meetings (`_attribute_new_calls_to_meetings`, no extra provider request; a failure is retried next scan) and runs `_sweep_auto_complete_meetings` (DB-only, today + yesterday).
- **Safety net:** `.github/workflows/meeting-call-activity-recompute.yml` (measured at every 4-8 h) calls `POST /schools/meetings/recompute-call-activity`, which catches e.g. a meeting logged after its call, for today + yesterday only. There is deliberately no pg_cron job for it (decided 2026-11-06): opening the row's "בפועל" panel updates such a meeting at once, and of 136 meetings logged after their start time since 2026-10-01, none stayed `scheduled`.
- **Rule (`_maybe_auto_complete_meeting`):** org automation on + status `scheduled` + scheduled **start_time** passed + calls + offline ≥ 5 min + not `meetings.auto_complete_blocked`.
- **`meetings.auto_complete_blocked`:** set when a user moves a meeting from `completed` back to `scheduled` (PUT/PATCH, `_apply_auto_complete_block`), so automation never re-closes it; cleared when the meeting's date changes (including from Outlook). Manually marking it completed always works.
- **`status` is written by `PUT /meetings/{id}` only when the client sent it** (`model_fields_set`), and `MeetingRow.performSave` sends it, with `status_changed: true`, only when the user changed it. Do not restore a `"scheduled"` default or send the row's status on every autosave: a row that hasn't yet seen a server-side auto-completion would silently reopen the meeting. A PUT with `completed` → `scheduled` and no `status_changed` comes from a tab loaded before this rule, and that status is dropped.
- `actual-detail` returns `meeting_patch` so opening a row updates its columns and status at once. Under a status filter, silent polls (admin/personal) add a second unfiltered request for today + yesterday only (`recentDateBounds`), so a just-closed row keeps refreshing. Do not drop the status filter from the main poll: that returned ~1,900 rows instead of ~26, every 20 s per tab.

### `meeting_reminders` + `meeting_upload_followups` — what was emailed for a meeting (the "נשלח ל..." popover)
Both tables also hold `message_type` ('reminder' | 'upload_request' | 'upload_followup'), `recipient_role`, `subject`, `body_html`, `open_token`, `opened_at` (followups also `recipient_name`). Rows from before 2026-11-04 have these empty; `GET /schools/meetings/{id}/messages` (`MeetingMessagesPopover.jsx`, via `MeetingRow`) infers their type/role and shows "לא תועד" for the rest.
- **Follow-ups must stay out of `meeting_reminders`:** `send_due_reminders` skips any meeting with a row there, so a logged follow-up would cancel the day-before send.
- **Open tracking (`backend/email_tracking.py`):** `add_open_pixel` returns the html to send + token; store the ORIGINAL html in `body_html`, so previewing never counts as an open. `GET /public/email-open/{token}.gif` records the first open, ignoring hits under 15 s after sending (mail scanners). Requires `BACKEND_PUBLIC_URL`; without it `open_token` is null and no opens are recorded. The UI says "נשלחה" until an open is detected, never "not opened", since a missing open proves nothing. Any new meeting email should follow the same pattern.
- **`request-missing-files` recipients** come only from `_upload_request_recipients` (logged file-request recipients, then legacy fallbacks); the optional `recipient_email` is validated against that set, so a client can never direct mail to an arbitrary address.

### Meeting file requests per division (six-year schools)
- **`meeting_upload_tokens`** has `recipient_email`, `recipient_name`, `division_scope` (JSONB; null = whole meeting). Each file-request recipient has their own link; `get_or_create_upload_token` reuses by meeting + recipient + scope. Older links have no recipient and show the whole meeting.
- **`send_due_reminders`** derives the responsibles from `stage_scope` (`_gefen_files_slots_for_meeting`), and each one's scope from the slots they hold (`recipient_division_scope`): one person on both divisions = null, one email, full list.
- **`build_upload_checklist(..., division_scope)`** narrows the list; **always pass the token's scope** on recipient-facing paths. Its `multi_division` flag is what keeps a one-division list from accepting another division's files, so don't derive that from the scoped `divisions`.
- **Files are one shared pool per meeting + year:** `compute_upload_comparison` counts a file for every division it serves (`file_divisions`: detected `division_type`, now also set for finance and planning files, plus `meeting_upload_files.covers_divisions`). That's how a combined file isn't requested twice. This works because `reconcile()` already filters a finance file by the report codes of the division being checked.
- **`covers_divisions`** is set only by an advisor (`PATCH .../uploaded-files/{fid}/coverage`, "השתמש בקובץ הקיים" in the popover) and only on finance files: a combined export looks single-division when the other division had no expenses. Gefen and planning files are excluded because marking them would leave that division with no data in the check. Files from earlier checks are deliberately never reused, since they'd be out of date.
- **`GET .../upload-comparison`** (notifications, school card) goes through `_meeting_upload_comparison`: once recipients have scopes it shows the union of what they were asked, not the whole-school list, which would ask a one-division meeting for the other division's files.
- A combined gefen file is still checked as one run, not split per division; combined + single-division gefen files in one check still return `gefen_division_ambiguous`.

### Meeting tasks — a division choice per six-year school ("התאמה אישית")
- **Stored on the meeting condition** in `org_tasks.success_criteria`: `stage_scope` is the default and stays mandatory (also for schools that join a scheduled task later); `stage_scope_by_school` = `{school_id: scope}` holds exceptions only. There is no `custom` value.
- **Never read `c["stage_scope"]` of a task condition directly:** use `task_logic.effective_stage_scope(cond, school)`. It is what makes sending, contact checks and progress follow each school's own choice.
- **Coverage rule — `task_logic.stage_scope_is_covered`, shared by progress and the booking page:** a meeting counts only for the division it is marked with, `both` covers both, an unmarked (NULL) meeting counts for nothing. `both`/`separate` need both divisions covered.
- **The rule applies only where stamped:** `create_task` (`_prepare_meeting_conditions`) sets `explicit_stage_scope_only` on each new meeting condition, and `_build_meeting_ranges` copies it to each range. Tasks and links created earlier, and direct-coordination links, keep the older behavior, so a closed task can't reopen because of it. Don't remove the checks on this flag: on live data, applying the rule to everything changed the results of 7 of 41 tasks.
- **Don't add `principal_same_person` to `_fetch_schools_and_meetings`' select:** it would activate the guard in `compute_task_progress` and drop the two-row display of one-principal schools (44 of 46 today). `/tasks/preview` fetches it separately for the modal's tag.
- **`separate` always means two ranges**, even for one principal; `_coordinator_problem` checks both, since sending needs both. A six-year school's range label always names its division, because the participants alone don't tell.
- **The wizard asks the question when the audience has a six-year school or the task is scheduled** (a school can join by send time). If the school list fails to load, "הבא" is blocked: the question would otherwise vanish and six-year schools would silently get one merged meeting.

### Meeting tasks — "לפי סוג שירות בכרטיס בית ספר" (`meeting_service_type = "by_service"`)
- **One task, each school its own meeting:** the condition is expanded per school by `task_logic.expand_meeting_condition` from the school's card `service_type` for the task's year (inherited from earlier years): גפן/שוטף/מחוז/תקומה → that meeting; גפן+שוטף → one `gefen_current` when the גפן and שוטף advisor lists are equal (`advisor_gefen_current_same`), otherwise per the condition's required `gefen_current_split` (`separate` = a גפן + a שוטף meeting, `combined` = one `gefen_current` with all advisors). A שוטף meeting gets no division choice.
- **`by_service` never reaches a range, a token or a meeting:** `_queue_messages_for_schools` and `_check_meeting_problems` expand first (`tasks_router._school_meeting_conditions` / `_school_meeting_requirements`), and progress expands inside `_resolve_condition` / `_meeting_condition_result` (one results column; counts summed; `resolved_types` names what the school was asked). Advisor and length always come from the card (`_prepare_meeting_conditions` forces `default`); "קבע אחר לפגישה זו בלבד" overrides still work per expanded type.
- **No service type** → blocking `missing_service_type` in the pre-check (the modal saves one to the card via `PUT year-admin-data`, then re-checks); at send such a school is skipped as `incomplete_meeting_config`. Resolution is live, so a scheduled task uses the card as it is at send time.
- **Direct coordination** has the same button, but resolves in the browser (`DirectCoordinationModal.applyCardServiceType`): it fills the range from the card, and for גפן+שוטף with different advisors asks the same question ("נפרדות" splits the range in two). No backend change there.

### "יועצים שקובעים לעצמם" — `advisor_exclusions` (`{advisor_id: ["all"] | ["gefen","current","district","takuma"]}`)
- **Where:** `organizations.advisor_exclusions` = the org default (`GET/PUT /tasks/advisor-exclusions-default`); `meeting_rounds.advisor_exclusions` and `org_tasks.advisor_exclusions` = per round / task (`AdvisorExclusionsEditor.jsx` in the round's schools step and the meeting-task wizard; a new one starts from the default, a round's task from the round). Always cleaned to the caller's org advisors (`_org_advisor_exclusions` / `rounds_router._clean_exclusions`).
- **One rule — `task_logic.apply_advisor_exclusions`:** a meeting is split into parts (גפן+שוטף = a גפן part + a שוטף part; takuma uses the גפן list); each part loses its excluded advisors; a part left with nobody is dropped (a part with nobody on the card stays, for the pre-check); what's left decides the type (one part → that type, its own card length, `also_matches_types: ["gefen_current"]` so a combined meeting still counts). Other advisors of a kept part stay (`exclude_advisor_ids`, dropped in `_build_meeting_ranges`). It runs after the "לפי סוג שירות" expansion everywhere: `_school_meeting_conditions` (send + pre-check), `task_logic.expand_for_school_detail` (progress), `meeting_rounds.school_status`.
- **Stamped, never trusted:** `_prepare_meeting_conditions` writes the task's cleaned list on every meeting condition and drops `exclude_advisor_ids`/`also_matches_types` from the body. Empty → exactly the old behavior.
- **Nothing left for a school** (`_is_self_scheduled`): it leaves the task's audience at creation/activation (`_self_scheduled_school_ids`), is listed as `self_scheduled` by the pre-check (informational), skipped at send, and is status `self_scheduled` in a round (not counted as required). `DirectCoordinationModal` is deliberately not affected.

### "יותר מיועץ מלווה אחד מאותו סוג" — which advisor a school-booked meeting is for
- **Rule (`task_logic.chosen_default_advisors`, aliased in tasks_router; mirrored by `DirectCoordinationModal.advisorChoiceParts`):** a "default"-advisor range's card parts (גפן+שוטף = גפן + שוטף, or one `gefen_current` part when both lists are the same people; takuma = גפן), minus `exclude_advisor_ids`. A part with 2+ advisors uses the manager's choice; with none it keeps all (the old behavior). Manual advisor / "קבע יועץ לפגישה זו בלבד" are never asked.
- **Key** = part + `@tichon`/`@chativa` for a one-division range (`advisor_choice_key`), so a six-year "separate" school is asked per division and each range gets its own advisors (`_build_meeting_ranges` resolves advisors per split scope).
- **Stored:** `org_tasks.meeting_overrides[sid]["advisor_choices"]` (cleaned to the school's card at create — `_clean_override_advisor_choices`; `PATCH .../meeting-overrides/{sid}` with `advisor_choice_key`+`advisor_ids`) and `meeting_rounds.advisor_choices[sid]` (merged on task create / PATCH, `_merge_round_advisor_choices`). The task's own wins over the round's (`_effective_advisor_choices`).
- **Pre-check `advisor_choice` (blocking while `chosen` is null):** asked for every requirement in the wizard (`ask_all_advisor_choices`), and for stored tasks only on conditions stamped `ask_advisor_choice` by `_prepare_meeting_conditions` — older tasks are never held back by it.
- **Rounds:** `meeting_rounds.school_status` builds each school's `advisor_ids` with the same rule and the round's remembered choices, and lists not-yet-chosen ones in `advisor_choice_open_ids`; `RoundDashboard.physicalReadiness` doesn't demand their field days (the task pre-check checks the chosen advisor's after the choice).

### "סבבי פגישות" — a folder with a goal for meeting tasks (`backend/meeting_rounds.py`, `routers/rounds_router.py`, `/rounds`)
- **`meeting_rounds`** (service_role only, deny-all RLS): name, `academic_year`, `start_date`/`end_date`, `criteria` (null = manual list), `school_ids` (snapshot — "עדכון רשימת בתי הספר" = `audience-preview` + `audience-apply`, never automatic), `excluded_school_ids`, `requirement` `{meeting_service_type (incl. by_service), gefen_current_split, count_per_school, stage_scope}`, `physical_school_ids`, `cached_*` (refreshed by the `tasks-recompute-progress` cron via `refresh_round_caches`, and on each dashboard read). Owners/managers only; every endpoint checks the round's org.
- **`org_tasks.round_id`** (FK, ON DELETE SET NULL): a task in a round is an ordinary meeting task; `create_task` and `_try_activate_scheduled_task` narrow its audience to the round's schools (`_round_member_ids`, 404 for another org's round).
- **A school's status** (`compute_round` → `school_status`): its need is one condition built from the requirement and the round's dates (`round_condition`), evaluated with the task-progress code (`task_logic._meeting_condition_result` / `_expand_for_school`), so a meeting booked any way counts. The rest comes from the round's tasks: latest message + its token (`opened`/`requested`, `request.open` = live link), skip notes (`problem`). Statuses in funnel order: done, booked, partial, opened, requested, problem, untouched (+ excluded).
- **No double requests, whatever the task's filter:** a task of the round may use any filter or selection; `_round_member_ids` narrows it to the round's schools minus those holding a live request from another of its tasks (`meeting_rounds.open_request_school_ids`), unless `include_open_requests` (stored as `org_tasks.round_include_open_requests`, so a scheduled task keeps the choice). `TaskCreateWizard` (roundContext) shows the split (will get a request / already booked / outside the round / open request + "שלח גם להם"), excludes the booked ones, and runs the pre-send check on the real recipients only; reminders go through each task's own `POST /tasks/{id}/send {only_school_ids}`. A count > 1 per school is tracked by the round; each task still asks one meeting per school ("צור משימה לפגישות שחסרות" uses `require_additional_meeting`).
- **Task sends reach only the task's own schools:** `send_task_bulk` filters `only_school_ids` by `matched_school_ids`, `send_task_single` 404s otherwise — `_queue_messages_for_schools` reads any id it gets.
- **ימי שטח — `advisor_field_days`** (`advisor_id`, `day`, unique per advisor+day; `round_id` only records where it was set; service_role only, deny-all RLS): per advisor, global. (1) A condition with `use_field_days` (set by the wizard for a round's physical task; forces `meeting_type = physical`) offers each school only the field days all its advisors share inside the windows (`tasks_router._field_day_segments` in `_build_meeting_ranges`); none → blocking `missing_field_days` in the pre-check. (2) On a field day the advisor is busy all day for every **remote** range on any link (`meeting_booking_router._field_day_blocks` via `_local_meeting_busy_blocks` / `_local_meeting_busy_by_advisor` with `remote=_is_remote(range_row)` — the same function for showing and booking). The capacity hint (`FIELD_DAY_MEETING_MINUTES`) is an estimate only. **`meeting_rounds.field_exempt_advisor_ids`** — advisors removed from field days in the round (they don't visit, e.g. the שוטף advisor of a גפן+שוטף school): `_field_day_segments(..., exempt)` uses only the visiting advisors' days (the exempt ones still attend and must be free); a meeting whose advisors are all exempt keeps its normal windows. `_check_meeting_problems` gets the task's `round_id` for this. **`meeting_rounds.physical_visitors`** `{school_id: [advisor_id]}` — who goes to each physical גפן+שוטף school with different גפן/שוטף advisors, asked at creation (`POST /rounds/physical-check` → `PhysicalVisitorsModal`); `_visiting_advisors(advisor_ids, exempt, visitors)` is the single rule: only visiting advisors' field days count, and a physical meeting with no visiting advisor is built as a **remote** range on the regular dates (`_build_meeting_ranges`, `held_remotely`). `get_round_field_days` lists each advisor only under the schools they visit.

### Task messages with formatting — `message_config.body_html`
- **Editor:** `TemplateBodyEditor.jsx` = `RichNoteEditor` (the meeting notes' editor, with `enableMentions={false}`, resizable from its bottom grip) + placeholder tags (`tasks/templateTag.js`). The last copy of a critical tag (`booking_link`/`meetings_list`) is protected by a ProseMirror `filterTransaction` (an extra copy can be deleted); loading content must set the `ALLOW_TAG_REMOVAL` meta.
- **Two fields, always both:** `body_template` (plain, `{key}` tokens — WhatsApp, `needs_booking_link`, the agent, old tasks) and optional `body_html` (same body with formatting, tokens as literal `{key}` text). Also on `org_task_message_templates.body_html`. Sanitized on input by a pydantic validator → `rich_html.sanitize_rich_html` (shared with meeting notes).
- **Send:** email channels with `body_html` go through `_rich_body_to_email_html` + `_email_shell` (inline styles from `_RICH_EMAIL_STYLES` — email clients ignore stylesheets; task lists → ☐/☑); without it, the old `_wrap_email_html` path byte for byte. If `body_html` lacks a link/list token that `body_template` has, the plain body is used. The editor's look (`.rich-note-email` in `index.css`) mirrors `_RICH_EMAIL_STYLES` — change both together.

### Task sends — large sends run in the background (2026-11-12 incident)
A 472-school create sent every email inside the request (~2 min) → the browser's 45 s timeout showed "failed" and the manager created the task twice; Resend's free plan (100/day) then failed the rest.
- **More than `INLINE_SEND_MAX_SCHOOLS` (20) schools** (create, `POST /{id}/send`, scheduled activation): `_send_in_background` builds the rows as `pending` (`_queue_messages_for_schools(send_now=False)`) on a thread, then `_drain_task_messages` sends them one by one (claimed, ≥0.55 s apart). `process_message_queue` is the backstop for anything left (worker killed, stale `sending`). Small sends stay inline as before.
- **Resend quota:** `email_resend.ResendQuotaExceeded` (429 `*_quota_exceeded`) → the row stays `pending` with `QUOTA_PENDING_NOTE` and the run stops sending email; a rate-limit 429 is retried. Never mark a quota refusal `failed`.
- **One send path per row:** `_send_queued_row` (shared by the queue and the drain).
- **"שלח שוב לנכשלים"** (`POST /tasks/{id}/retry-failed`): re-sends the failed rows themselves (same recipient + link), latest per recipient, never to a recipient another message of the task reached, never to a school already done.
- **No second bulk send while one runs:** `send_task_bulk` returns 409 `send_in_progress` while the task has due `pending`/`sending` rows created in the last 15 min (`_send_in_running`); rows are inserted in chunks of 25 as built, so this shows within seconds.
- **`org_tasks.client_request_id`** (unique per org): the wizard sends one per opening; a repeated create returns the existing task.

### Task status and progress — refreshed every 5 minutes, nobody has to open anything
`GET /tasks/` only reads stored columns (`status`, `cached_*`). They are kept current by pg_cron job `tasks-recompute-progress` (every 5 minutes, `POST /tasks/recompute-progress`, `CRON_SECRET` from Vault; `.github/workflows/task-progress-recompute.yml` is only a backup), and `AdminSchoolTasksTab` re-reads the list every 60 s while visible, so a change shows within about 6 minutes.
- **Why every 5 minutes:** each run transfers data from Supabase, about 30 KB today and about 750 KB once a task covers all 598 schools of a large org. This frequency keeps that far below the Pro plan's 250 GB egress, so raise it only after re-checking the usage page.
- **Why a schedule, not hooks:** about 30 code paths write `meetings`, plus schools, goals and control letters. New paths need nothing added.
- **`refresh_task_progress_for_org`:** one data fetch per org + year, narrowed to the schools its tasks cover (a full fetch took 6 s for a 598-school org), and writes only what changed. A failed token lookup skips the org instead of treating tokens as none, which would reopen closed "פגישה נוספת" tasks.
- **The pg_cron job was created by hand** (2026-11-07, jobid 2) with `cron.schedule('tasks-recompute-progress', '*/5 * * * *', ...)`, same `net.http_post` shape as `calls-process-new-calls`. Check `cron.job` before relying on it.
- **Runs are sequential and have no overlap guard:** about 3 s today. If a run nears 5 minutes as orgs grow, add a lease like `calls_integrations.scan_lock_until`.

### Public booking links — no overlapping bookings, even at the same instant (`backend/booking_lock.py`)
`_book_range_slot` and `book_meeting_slot` used to be check-then-insert with no lock and `meetings` has no DB constraint, so two schools confirming the same advisor's time on different workers could both succeed (reproduced in `tests/test_booking_concurrency.py` with the protection off). Two layers now:
- **`booking_locks(keys)`** — table `booking_slot_locks` (`lock_key` PK; service_role only, deny-all RLS; same mechanism as `graph_client.calendar_sync_lock`), keys `adv:{advisor_id}:{date}` per advisor + `range:{token_id}:{range_key}` (double clicks), taken in sorted order, stale after 30 s, 503 after 15 s of waiting. Outlook is read **before** the lock; inside it everything another booking may have changed is re-read (token's `booked_ranges`/`booked_months`, `meetings` of the day, existing-meeting check, slot_policy) and then insert + `booked_*` update. Activity log + Outlook sync run after release.
- **`keep_or_discard_booking`** right after the insert: an overlapping scheduled meeting of the same advisor created earlier (`created_at`, then `id`) wins and the new row is deleted (409). Holds even if a lock was stolen.
- Any new public (school-side) booking path MUST use both. Staff-created meetings are deliberately not locked (an advisor may double-book on purpose), but an earlier staff meeting always beats a link booking.

### Booking requests and the meetings that fill them (`backend/booking_requests.py`)
A "request" = one range of a live booking link (a task's or a direct-coordination one).
- **`meeting_request_resolutions`** (service_role only, deny-all RLS; `UNIQUE(meeting_id, token_id, range_key)`, cascades with the meeting): the staff's answer to "מחליפה או נוספת?". `create_meeting`/`update_meeting` return `open_booking_requests` (open requests of the school whose dates include a staff-made, dated, live meeting, not yet answered for it); `MeetingRow` opens `BookingRequestResolutionModal` on every surface → `POST /schools/{sid}/meetings/{mid}/booking-request-resolutions`, logged as `request_resolved`. "replaces" closes the request (`booked_ranges`) and counts the meeting for that task's condition of the request's type (any meeting type, also under "בקש לקבוע פגישה נוספת", in the request's division — `task_logic._matching_meetings` via `request_resolutions` attached in `_fetch_schools_and_meetings`); "additional" keeps it open and the meeting never counts for it (nor blocks the link — `_range_existing_meeting`). No answer = the automatic rule exactly as before.
- **`meetings.booking_range_key`**: which request a link booking filled. **`reconcile_booked_ranges`** runs in the `tasks-recompute-progress` cron (every 5 min, every org with live links): a request whose KNOWN filler (link booking / "replaces") is no longer scheduled/completed reopens while its dates aren't over (`request_reopened` logged); a request with no known filler (links booked before this existed) is never reopened by guess. Deleting a meeting reopens its requests in `delete_meeting` (`requests_filled_by_meeting` before the delete → `reopen_for_deleted_meeting`), as does changing an answer from "replaces" to "additional".
- **"אוטומטי" in יומן יעיל** (`min_free_window_minutes = -1`): per advisor and day, X = the longest still-open request of that advisor covering the day (SQL `pending_booking_demand`, EXECUTE service_role only; active tasks + direct coordination; filled requests dropped via `requests_already_filled`; the school's own request excluded), else the meeting's own length.

### "יומן יעיל" — which times a public booking link offers (`backend/slot_policy.py`)
A range created with the two required questions (`min_free_window_minutes` X, 0 = no limit; `start_grid_minutes` 30/60) goes through `slot_policy`; a range without `min_free_window_minutes` keeps the original earliest-slot code path (`meeting_booking_router._uses_slot_policy`), so links already sent never change.
- **Rule:** per advisor and day (working-day edges count as events), a free gap of G minutes is worth ⌊G/X⌋ windows; only the times of minimal cost that day are allowed — first fewest windows lost, then fewest minutes of "locked" gaps shorter than X. Each advisor's calendar is checked separately (`_busy_by_advisor`), never their union.
- **Every range booking (any link) is checked to be on a date of the range, of the range's exact length and inside the working hours** before the lock; slot_policy ranges are additionally checked against the rule.
- **The same function decides what is shown and what is accepted:** `_book_range_slot` re-runs `slot_policy.is_allowed` on the live calendars (plus duration and date), since the endpoint is public. Any new booking path for such ranges must do the same.
- `requested_days` (the school's "אפשרויות נוספות" hours) is added next to the regular `days`, never replacing them.
- **Past days/hours are never offered or accepted** (all booking paths, old links included): `_upcoming_dates` drops past days, and on today's date the elapsed time (rounded up to the start grid) counts as busy (`_with_elapsed_time`); the booking endpoints reject a start time already gone.

### `school_update_requests` — advisors request changes, owners approve
```sql
id UUID PRIMARY KEY
school_id UUID (FK → schools)
requester_id UUID (FK → profiles)
proposed_changes JSONB
status TEXT  -- 'pending' | 'approved' | 'rejected'
reviewer_id UUID
reviewer_note TEXT
original_values JSONB  -- {field: value at submit time} — shown as "before" in the school activity log
field_decisions JSONB  -- {field: 'approved'|'rejected'} — written on review (partial approvals)
created_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ
```
Submit and review both verify the school belongs to the caller's org.

### `school_activity` — "תיעוד פעולות" of the school card's "פרטי בית הספר" tab
```sql
id UUID PRIMARY KEY
school_id UUID, org_id UUID
academic_year TEXT  -- only for year-scoped ("פרטי ליווי" / allocation / duration) changes
actor_id UUID, actor_type TEXT  -- 'user' | 'system' | 'unknown'
source TEXT         -- X-Client-Surface value (school_card | add_school | admin_modal | admin_grid | admin_bulk | admin_undo | import | dashboard | task_resolution | collection) or tasks_contacts_import | calls | update_request
action TEXT         -- created | updated | deleted | restored
changes JSONB       -- {field: {from, to}} — tracked fields that really changed (incl. virtual advisors_<type> id lists)
request_id UUID     -- set when the change came from approving an update request (folded into that request's card)
created_at TIMESTAMPTZ
```
service_role only (RLS on, deny-all policy). Written exclusively via `backend/school_activity.py` → `log_school_activity` / `log_school_activity_bulk` (always non-fatal; an `updated` with no real change is dropped). Tracked: the tab's `schools` columns (`TRACKED_SCHOOL_FIELDS`), its `school_year_admin_data` fields (`TRACKED_YEAR_FIELDS`) and the typed advisor lists. Read via `GET /schools/{id}/activity`, which merges consecutive same-actor/source/year changes within 10 min and interleaves update requests (per-field before/after + decision). **Any new code path that writes the tab's data MUST read the before-state and call `log_school_activity` after its write**, and frontend callers send `X-Client-Surface` (see the list above). Labels/formatting for these fields live in `frontend/src/components/schoolFieldLabels.js` (shared with NotificationsPage).

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
- **Cold-load race guard:** `main.jsx`'s request interceptor `await`s the initial `supabase.auth.getSession()` call if it hasn't resolved yet before attaching the token. Without this, a request fired from a component's `useEffect` on a hard/direct page load (e.g. navigating straight to a deep link) can go out before the token is ready, with no `Authorization` header — `HTTPBearer()` in `auth.py` then returns **403** (not 401), which bypasses the token-refresh-and-retry logic in the response interceptor (that logic only triggers on 401). Don't reintroduce a component that fires its own request before this resolves.

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

GET    /schools/{id}/meetings/{mid}/activity → meeting activity log ("תיעוד פעילות", ⋯ menu in every meetings table)
GET    /schools/{id}/activity            → school-card change log ("תיעוד פעולות" button in the "פרטי בית הספר" tab)
GET    /schools/meetings/{mid}/messages  → emails sent for a meeting + uploaded/missing files per year ("נשלח ל..." popover)
POST   /schools/meetings/{mid}/request-missing-files → re-request missing files, each recipient only their own; optional body {recipient_email}
PATCH  /schools/meetings/{mid}/uploaded-files/{fid}/coverage → advisor confirms a finance file also serves a division; body {division} (null clears)

GET    /schools/{id}/year-closure-notes?academic_year=   → signed "סגירת שנה" notes
POST   /schools/{id}/year-closure-notes                  → add note (author = caller)
PATCH  /schools/{id}/year-closure-notes/{note_id}        → edit own note only
DELETE /schools/{id}/year-closure-notes/{note_id}        → delete own note (legacy no-author: owner only)

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

**Large id lists in `.in_()` are auto-chunked.** Supabase's gateway rejects a request URL with ~650+ UUIDs in one `in.(...)` filter (bare 400 Bad Request — and most enrichment call sites swallow it as non-fatal, so data silently disappears). `supabase_client.py` patches postgrest's `execute()` to split any `.in_()` over 200 values into several requests and merge them (rows, `count`, `order`, `limit`/`offset`). So: always pass id lists via `.in_()` — **never** embed an id list inside an `.or_()` string (`id.in.(...)`) or any other hand-built filter string, since those can't be split. `postgrest` is pinned in `requirements.txt` because of this patch; `backend/tests/test_in_filter_chunking.py` guards it — re-run it after any supabase/postgrest upgrade.

**The 1,000-row cap is auto-paginated too.** PostgREST silently truncates every response at 1,000 rows (db-max-rows) — no error. The same `supabase_client.py` patch re-fetches any GET that returns exactly 1,000 rows (or asked for `.limit()` > 1,000) in pages ordered by the caller's `order` + the table's primary key (tie-breaker), so a plain `.execute()` now returns every matching row. Consequences: (1) no manual `.range()` paging loops are needed (`_fetch_all_rows` is now a single `execute()`; a manual loop over an auto-chunked `.in_()` query is quadratic — don't write one); (2) **when creating a table whose primary key is not a single `id` column, add it to `TABLE_PRIMARY_KEYS` in `supabase_client.py`** — `backend/tests/test_row_cap_pagination.py` compares the map to the live DB and fails otherwise; (3) `.single()`/`.maybe_single()` and `.rpc()` are not covered — an RPC returning a set > 1,000 rows is still capped.

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

Report-code classification is **school-year-scoped** (see "Academic Year System" below). `backend/logic/reconciler.py` and `backend/zihuy_core.py` each hold two parallel sets — תשפ"ו (default/legacy) and תשפ"ז — selected automatically per check via the existing `academic_year` mechanism (`backend/academic_years.py`). `reconciler.reconcile()` / `_filter_by_division()` and `zihuy_core.resolve_stage()` / `get_stage_from_json()` / `get_stage_junior_ambiguous()` / `identify()` all take an optional `academic_year` parameter that defaults to the תשפ"ו lists when `None`/unrecognized, so any caller that omits it reproduces today's exact תשפ"ו behavior. `analyze_router.py` passes the live `academic_year`/`expected_year` value at every call site.

```python
# תשפ"ו (default — used when academic_year is None/unrecognized)
TIKKON_ONLY  = [48,54,55,58,59,61,62,66,76,87,91,92,94,95,96,97,98,99,100,
                101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,
                116,117,118,119,120,121,122,123,124,125,127,136,137,138,139,
                140,141,142,148,150,152,154,156,158,160,162,164,165,167,169]

BEINAYIM_ONLY = [43,44,45,46,47,49,50,51,52,53,56,57,60,63,64,65,67,68,69,
                 70,71,72,73,74,75,77,78,80,81,83,84,85,88,89,90,126,128,
                 129,130,131,132,133,134,135,147,151,153,155,161,166,168]

SHARED = [157, 159, 163]

# תשפ"ז — code 149 is new, and codes 157/159/163 move from SHARED (all stages) to
# being beinayim-only (יסודי + חטיבת ביניים, NOT תיכון) — confirmed against נספח ט"ז.
# TIKKON_ONLY_TASHPAZ = TIKKON_ONLY (unchanged)
BEINAYIM_ONLY_TASHPAZ = BEINAYIM_ONLY + [149, 157, 159, 163]
SHARED_TASHPAZ = []  # no codes are shared across all stages in תשפ"ז
```

**157/159/163 in תשפ"ז — confirmed, not a ministry-file error:** in תשפ"ו these three codes are shared across all three stages (`SHARED`, including תיכון). For תשפ"ז, נספח ט"ז was re-verified directly against the ministry guide and confirmed: these codes belong **only** to יסודי/חטיבת ביניים, not to תיכון. This is reflected by moving them into `BEINAYIM_ONLY_TASHPAZ` and leaving `SHARED_TASHPAZ` empty — תיכון no longer recognizes these codes at all in תשפ"ז. (An earlier version of this doc kept them shared with תיכון as a safety margin, before the ministry guide was re-checked — that is no longer the case; do not revert to the old "keep them shared" behavior.) `backend/zihuy_core.py`'s `CODES_JSON_TASHPAZ['תיכון']` is accordingly its own explicit 64-code list (not a reuse of `CODES_JSON['תיכון']`, which still has 67 for תשפ"ו).

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

### Old browsers — `frontend/src/legacy-colors.css` (do not remove)
Tailwind 4 writes every color as `oklch()`, which Chrome < 111 (Chrome 109 is the last on Windows 7 — common on school computers) ignores: a white-on-blue button becomes white-on-white (2026-11-12, "בחר מועד" invisible on a school's booking page). `legacy-colors.css` (imported right after `tailwindcss` in `index.css`) redefines the whole `--color-*` palette in hex inside `@supports not (color: oklch(0% 0 0))`, so only such browsers use it. It is generated — after upgrading `tailwindcss`, re-run `node scripts/gen-legacy-colors.mjs` in `frontend/`. Custom colors in our own CSS should be hex/rgb, not oklch.

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

**Blur only saves real edits:** `handleRowBlur` compares `BLUR_SAVED_FIELDS` (user-editable fields, `MeetingRow.jsx`) with the last saved values — not the whole `meeting`, whose server-maintained fields change constantly through polling and would make an untouched row re-send its stale draft and re-sync Outlook. A new row field that relies on blur to save MUST be added to `BLUR_SAVED_FIELDS`.

### Meetings Feature — Changes Apply Across All Three Scheduling Surfaces (MANDATORY)

Meetings can be scheduled/edited from **three separate places** in the app, all built on the shared `MeetingsTable.jsx` / `MeetingRow.jsx` components:
1. **כרטיס בית ספר** — `SchoolPage.jsx` (meetings tab; school is implicit, advisor defaults to first linked advisor but is still editable)
2. **אזור אישי** — `PersonalMeetingsTab.jsx` (rendered inside `ProfilePage.jsx`; advisor is implicit — always the current user; school is picked via `SchoolPickerModal`)
3. **ניהול** — `AdminMeetingsTab.jsx` (rendered inside `AdminPage.jsx`; neither school nor advisor is implicit)

**Rule:** whenever the user requests *any* change related to meetings (בקשה שקשורה לפגישות) — a bug fix, a new field, new validation, a new button/action, a UI tweak — treat it as applying to **all three surfaces above**, not just the one mentioned or the one currently open, unless the user explicitly says otherwise.

**Exception — field/context mismatches:** some fields or behaviors are only relevant/visible in some of the three surfaces (e.g. the advisor picker doesn't exist in אזור אישי since the advisor is always the current user; the school column doesn't exist on כרטיס בית ספר since the school is implicit). If a requested change doesn't map cleanly onto one or more of the three surfaces because of a mismatch like this, **stop and ask the user** what to do there instead of guessing or silently skipping it.

### Meeting Reminders — automations vs. the per-meeting toggle (HARD RULE)

There are two org-level meeting automations (`organizations.meeting_reminders_enabled`, `organizations.secretary_upload_request_enabled`) and one per-meeting flag (`meetings.reminder_enabled`, the "תזכורת" ON/OFF toggle in `MeetingRow`). Their roles are **not symmetric**:

- **`meeting_reminders_enabled` (automation 1) — creation-time default ONLY.** It is read solely by `create_meeting` / `update_meeting` (via `_org_reminders_default_on` + `_reminder_eligible`) to decide the initial state of a new meeting's `reminder_enabled` toggle: ON only when the org flag is on AND the meeting has ≥1 participant AND its date is strictly in the future (Asia/Jerusalem). `update_meeting` flips a still-off toggle ON the first time a meeting becomes eligible (gains its first participant or a future date), unless the user already turned it off. **It is NOT consulted in `send_due_reminders`** — do not re-add a send-time check on it.
- **`meetings.reminder_enabled` (per-meeting toggle) — the single source of truth at send time** for whether regular participants get the day-before reminder.
- **`secretary_upload_request_enabled` (automation 2) — an independent live send-time switch.** In `send_due_reminders` it sends the secretary/finance file-upload-request email for a גפן/מחוז meeting **even when `reminder_enabled` is off**. When it is off but the toggle is on, that contact falls back to the plain reminder.
- The cron query in `send_due_reminders` intentionally does **not** filter on `reminder_enabled` (automation 2 must reach meetings whose toggle is off). It is still bounded to `status = 'scheduled'` + the one/three due dates — not a full-table scan.
- Creation paths must send **no** `reminder_enabled` in the POST body (let the backend compute it). The Excel import path (`commit_meeting_import`, future-mode rows) computes it the same way (`_org_reminders_default_on` + `_reminder_eligible`), but **scoped exclusively to role-matched participants** — `data_ctx["resolved_participants"]`, resolved from the school's own verified contact fields via the "תפקיד/י משתתפים" import column (see `meeting_labels.resolve_participant_role_token`) — **never** to the free-text `participant_name`/`participant_phone`/`participant_email` import columns. A typo in a spreadsheet email column must never be able to silently email a reminder to the wrong address, with no one reviewing each of potentially hundreds of imported rows the way a single manual creation is naturally reviewed — this is why free-text-only participants still force `reminder_enabled=false`, even when the org automation is on. Past-mode import rows always stay `reminder_enabled=false` (a documentation record of something already past never needs a day-before reminder). Do not widen this to free-text participants without the user explicitly re-accepting that risk.
- **`reminder_enabled` is never written from the `PUT /meetings/{id}` body** (only turned ON via the auto-enable transition, or an explicit `body.reminder_enabled is True`). Every field autosave carries the row's current toggle value, so a PUT that races the server-side auto-enable would wipe it. The `MeetingRow` toggle (and the "last participant removed" auto-clear) write through **`PATCH /schools/{sid}/meetings/{mid}` with `{reminder_enabled}`** — that PATCH is the only path that can turn a reminder off. Do not "simplify" this back into the PUT.

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
2. **Check whether this deployment needs the cross-org security test suite — see "Cross-Org Security Test Suite (MANDATORY)" below. If yes, run it now and report the result before continuing.**
2a. **Classify the deployment as "safe during work hours" or "evening only"** (see "Deploying During Work Hours" below) and tell the user which, with the reason.
3. Present pending changes to user as Hebrew bullet-point summary
4. Ask: **"האם להעלות את כל העדכונים הללו לאתר?"**
5. **Wait for explicit approval**
6. Only after approval: run Deployment Steps
7. After successful push to `main`: clear `dev-log.md` (leave only `# Dev Log`)

### Deploying During Work Hours
A deploy swaps the backend instance and the frontend build while advisors are working. What keeps that invisible — don't remove any of it:
- **Backend shutdown:** the live service `gefen-kesafim-api` is **not Blueprint-managed — `render.yaml` is NOT applied**; its settings live in the Render dashboard (checked 2026-11-13). Start command there: `uvicorn main:app --host 0.0.0.0 --port $PORT` (single process; on SIGTERM uvicorn waits for in-flight requests and their BackgroundTasks until Render's shutdown delay, default 30 s, kills it — that delay isn't editable in the dashboard). Health Check Path is set to `/health` in the dashboard (traffic moves only to a ready instance). Nothing slow may run on startup — the old startup cleanups now run from `POST /maintenance/daily-cleanup` (`.github/workflows/daily-cleanup.yml`).
- **Interrupted checks:** `/analyze/upload` and `/add-file` store the source files in Storage *before* starting `_process`, and record `_rerun` (preserved by `_update_run`, like `_school_ctx`). Every `_update_run` stamps `run_states.updated_at`; a run still `processing`/`saving` after 10 minutes is settled by `_interrupt_if_stale` (`done` if it has `saved_log_id`, else `interrupted`) — on the next poll, or by `POST /analyze/sweep-interrupted-runs` (pg_cron `analyze-sweep-interrupted-runs`, every 10 min), which also retries a background meeting check once and then notifies the advisor. `POST /analyze/rerun/{run_id}` re-runs an interrupted run ("הרץ שוב" in `SchoolPage.jsx`).
- **Frontend:** `main.jsx` retries (1s/2s/4s) reads on any 502/503/504/no response, and PUT/PATCH/DELETE only when the request never reached the app (no response, or a non-JSON gateway page) — our own JSON 503 on a write means the handler ran part-way, so re-sending could repeat side effects. A POST is retried only with `config.retryable = true`. `vite.config.js` writes `dist/version.json`; `NewVersionBanner` only *offers* a reload — **never auto-reload** (the floating windows survive navigation and may hold unsaved text). Run polling (`pollRun` in `SchoolPage.jsx`) survives ~2 minutes of failed polls. Measured on 661 real checks: p99 28 s, max 110 s — hence the 10-minute stale threshold and the 110 s graceful timeout.
- **No input lost on a failed save:** composers restore the typed text when a save fails. `MeetingRow.performSave` forgets a failed send so the next blur re-sends it, and `saveFailedRef` stops the date/time/status sync effects from copying the parent's post-failure reload over the unsaved edit. Any new save-on-blur field must do the same — never clear the text before the save succeeds.
- **Queues:** `meeting_booking_email_queue` and `org_task_messages` rows are claimed `pending → sending` (`schools_router.claim_queue_row`) before sending; a row left `sending` for 10 minutes goes back to `pending`. Any new queue must claim the same way.

**Evening only** (or split into two deploys) when a change:
- drops or renames a column, table or API field that the currently-deployed code or open browser tabs still use (**expand/contract:** add the new thing → deploy → remove the old thing in a later deploy, at least a day after);
- makes a new request field *required* (a tab loaded before the deploy won't send it — make it optional with the old behavior as default, like `status_changed`);
- changes the meaning of an existing stored value.
Everything else (UI, fixes, new optional fields/endpoints, additive migrations run **before** the push) is safe during work hours. Before pushing, optionally check that no check is running right now: `SELECT count(*) FROM run_states WHERE status IN ('processing','saving') AND updated_at > now() - interval '3 minutes';`

**pg_cron job for the sweep** (create once, after the deploy that added the endpoint; check `cron.job` first):
```sql
select cron.schedule('analyze-sweep-interrupted-runs', '*/10 * * * *', $$select net.http_post(url := 'https://gefen-kesafim-api.onrender.com/analyze/sweep-interrupted-runs', headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 120000);$$);
```

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

## School Card Structural Sync Rule (MANDATORY)

The "school card" — a school's fields, contact table, and related sections (ליווי, etc.) — is rendered/edited in **multiple separate places** in the codebase, each with its own independent JSX and state, not a single shared component:

1. **`SchoolPage.jsx`** — the school detail page. Has both a **display mode** (read-only 3-column grid + contact table + ליווי section) and an **edit mode** (same layout, editable), for an *existing* school.
2. **`AdminPage.jsx`** — inline modal in the "ניהול" schools tab, shared by both "הוספת בית ספר חדש" (add) and "עריכת פרטי בית הספר" (edit) via one code path (`editingSchool` null vs set).
3. **`AddSchoolPage.jsx`** — dedicated full-page route (`/school/new`) for adding a single new school.

**MANDATORY:** Whenever a field or section is added/removed/changed in **any one** of these three surfaces — including structural/layout changes to the contact table, or sections like "ליווי" (client status, service type, funding method, order amount, access, per-service-type advisor/allocation/duration) — you MUST ask the user whether to apply the same change to the other surfaces, before implementing. Do not assume; do not silently skip. Since `AddSchoolPage.jsx` in particular has drifted out of sync with `SchoolPage.jsx`'s current structure before, treat "does this belong in the new-school flow too" as a real open question each time (e.g. year-scoped admin data like ליווי may need the school to exist first — the school ID from `POST /schools/` — before it can be saved, which may call for a different flow shape, not just copy-pasted fields).

**Also mandatory:** whenever asked to research or audit "the school card," actively search for *any other* place in the codebase that renders school fields/contacts in a card-like way (e.g. exports, previews, other admin tabs) beyond the three known surfaces above, and report any newly found ones to the user rather than assuming the list above is exhaustive.

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

### 10. A Background `_process()` Run Must Handle `pending_identification`

`status == "done"` does **not** mean a check was saved. `_process()` deliberately skips `_save_check_log` while rows await manual classification (`_any_tikhnun_pending`), and only `POST /analyze/classify/{run_id}` (or `/retry-finance`) saves it afterward; `_save_check_log` also swallows its own failures. `SchoolPage.jsx` handles this by opening `ClassifyModal`, but any path that runs `_process()` with no such UI must handle it itself, or the check silently never appears.

**Rule:** treat a check as saved only when `saved_log_id` is set (on each per-division sub-run for a six-year split). Follow `_run_meeting_check_and_notify` / `_summarize_meeting_check`: tell the user the check awaits classification and link to `/school/{id}?tab=checks&resume_run={run_id}`, which reopens `ClassifyModal`. Files in `_zihuy_ctx` are gone by classification time (`_process()` deletes its temp dir) — `_restore_zihuy_paths` re-downloads them from `stored_file_paths`. Rows that merely list a planned response with nothing reported against it (no code, invoice, supplier or amount) never reach classification: `_without_placeholder_doch_rows` drops them, since no answer about them changes any number.

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

## Local Dev Troubleshooting — `vite.config.js` Proxy Changes Need a Full Restart

Adding a new entry to the `server.proxy` map in `frontend/vite.config.js` (e.g. a new backend router prefix) is **not hot-reloadable**. Vite's dev server proxy is configured once at server startup. If the frontend dev server (`npm run dev`) was already running when the entry was added, requests to that new prefix will silently fall through to the SPA's `index.html` (the React Router fallback) instead of reaching the backend — the browser gets HTML back where JSON was expected, which typically surfaces as a confusing frontend crash (e.g. `"X.map is not a function"`) rather than an obvious network error.

**Fix:** Stop and restart `npm run dev` (frontend only — the backend's `--reload` is unaffected) any time `vite.config.js` itself changes, then hard-refresh the browser.

---

## Manual Testing — Secretary/Finance File-Upload Request Email

Whenever the user wants to test the "request files from school before a Gefen/מחוז meeting" flow (the automated email sent to the secretary/finance contact asking them to upload files ahead of a meeting), use this exact workflow — do not re-derive it from scratch, and always remind the user of these steps when they ask to test this flow.

**Test school (fixed):** "לדוגמא" — `school_id = e044d506-0152-49f9-a737-e83c0d4e397c`

**Why this is safe:** `POST /schools/meetings/send-due-reminders` ([schools_router.py](backend/routers/schools_router.py)) is the cron-triggered endpoint (GitHub Actions, daily) that emails every participant of every school's meeting due "tomorrow" (or Sat/Sun on a Thursday run). It takes an optional `school_id` query param — **not used by the real cron trigger** — that, when set, limits it to only that school's due meetings. This makes it safe to run manually against real production data without emailing any other real school.

**Steps, every time:**
1. In the school card for "לדוגמא", delete any existing test meeting and create a new one (new meeting each time — this sidesteps the "already sent" per-`meeting_id` dedupe in the `meeting_reminders` table, so no DB cleanup step is needed):
   - `meeting_date` = tomorrow (or Sat/Sun if today is Thursday — the cron absorbs those on its Thursday run)
   - type = גפן or מחוז (NOT שוטף — the upload-request email only fires for these)
   - secretary or finance contact's email = the user's own test inbox
2. Make sure the local backend (`uvicorn`, port 8000) has picked up any recent code changes — watch for the orphaned `--reload` worker issue (separate section above).
3. Run this exact command in PowerShell (always against `localhost:8000`, never the live site — the live site hasn't necessarily deployed the `school_id` filter):
   ```powershell
   Invoke-WebRequest -Method POST `
     -Uri "http://localhost:8000/schools/meetings/send-due-reminders?school_id=e044d506-0152-49f9-a737-e83c0d4e397c" `
     -Headers @{ "X-Cron-Secret" = "<CRON_SECRET from .env>" }
   ```
4. Check the JSON response (`sent`/`failed`/`skipped_meetings`/`total_due` — `total_due` should be `1`) and the test inbox.

---

## External File Storage — Cloudflare R2 (large files served outside Supabase)

For large binary assets that shouldn't live in Supabase Storage or on Render's ephemeral disk (e.g. training videos), this project uses a private **Cloudflare R2** bucket (`gefenai-tutorial`), accessed server-side via the S3-compatible API (`boto3`), with short-lived **presigned URLs** handed to the authenticated frontend. See `backend/routers/training_videos_router.py` and the `training_videos` table for the reference implementation (nullable `org_id` column — `null` = visible to all orgs, otherwise scoped to one org, filtered server-side using the requesting user's `org_id`).

**R2 env vars:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (local `.env` + must also be set separately in Render's Environment tab for the backend service — they are **not** deployed via git).

**Lessons learned (apply these before spending time debugging what looks like a CORS/ORB issue):**

1. **Always `.strip()` env vars read for R2/external API config.** Pasting a value into Render's Environment UI can silently include a trailing newline. A malformed bucket name like `"gefenai-tutorial\n"` produces a broken request path, R2 returns an `application/xml` error body instead of the video, and the browser reports this as `net::ERR_BLOCKED_BY_ORB` — which looks exactly like a missing-CORS-header problem but isn't. `training_videos_router.py`'s `_env()` helper does this; follow the same pattern for any new external-storage env var. If ORB/CORS errors show up despite correct-looking config, inspect the actual **Request URL** in the Network tab first for stray `%0A`/whitespace before touching CORS settings.
2. **R2 buckets need an explicit CORS policy for browser access**, configured once via the Cloudflare dashboard (R2 → bucket → **Settings** → **CORS Policy**) — not settable via a bucket-scoped "Object Read & Write" API token (`PutBucketCors` requires Admin-level permissions, so a least-privilege token gets `AccessDenied`). Required whenever the frontend origin(s) change or a new bucket is created:
   ```json
   [
     {
       "AllowedOrigins": ["https://gefenai.co.il", "http://localhost:5173"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. **Before uploading a new video, check its codec and remux if needed** — don't re-encode unless necessary:
   ```bash
   ffprobe -v error -show_entries stream=codec_type,codec_name -of default=noprint_wrappers=1 input.mkv
   # If video=h264 and audio=aac, a lossless, near-instant remux is enough:
   ffmpeg -y -i input.mkv -c copy -movflags +faststart output.mp4
   ```
   `-movflags +faststart` moves the `moov` atom to the front of the file so the browser can start playback/seeking without waiting on a request for the end of a multi-GB file — check with a quick MP4 box scan (`mdat` appearing before `moov` means it's missing) before assuming a file already has it.
4. **A cross-org access requirement (e.g. "only org X can see this video") belongs in the `training_videos.org_id` filter, server-side** — never rely on the presigned URL's obscurity alone for that. The presigned URL's short TTL (15 min) is about limiting link-sharing/caching exposure, not about enforcing who gets a URL in the first place.

---

## Cross-Org Security Test Suite (MANDATORY)

**Background:** a security audit found ~65 endpoints across the backend that checked a caller's *role* (owner/manager/advisor) but not that the specific resource (school_id, meeting_id, user_id, run_id, log_id, advisor_id, etc.) actually belongs to the caller's own `org_id` — letting a user from one org read/write another org's data via a known/guessed UUID. All known instances were fixed. An automated regression+IDOR suite now lives at `backend/tests/security/` (`conftest.py` + `test_idor_cross_org.py`), using FastAPI `TestClient` with a `get_current_user` dependency override (no real login/password needed) against two real orgs already in the live Supabase project. Run it with:
```
cd backend && python -m pytest tests/security/ -v
```
A passing run means, for every covered endpoint, both (a) a different org is rejected (403/404) and (b) the caller's own org still works (200) — catching both a missed access check AND an over-aggressive fix that broke legitimate access. This suite already caught 2 real vulnerabilities (`list_goals`, `list_meetings`) that an earlier manual-only fix pass missed — treat it as the authoritative check, not a formality.

**MANDATORY, without being asked:**
1. **Whenever you build or modify a backend endpoint that takes a `school_id`, `meeting_id`, `user_id`/`advisor_id`, `run_id`, or `log_id`** (or any other org-scoped resource identifier) as a path/query/body parameter: run `python -m pytest backend/tests/security/ -v` after the change, as part of that work — do not wait to be asked. If the new endpoint represents a new resource group not yet covered by the suite, add a pair of tests for it (cross-org-rejected + same-org-still-works) following the existing pattern in `test_idor_cross_org.py`, using the real org/resource ids already documented in `conftest.py`.
2. **Before every deployment (Pre-Deployment Flow below)**: check whether any pending change (per `dev-log.md`) touches such an endpoint. If yes, run the suite and report the pass/fail result to the user as part of the pre-deployment summary — do not proceed to ask for deployment approval without having run it first.
3. **Always report the result** (pass count, and the full detail of any failure) to the user in Hebrew — never silently run it and only mention it if something failed.
4. If a failure appears: treat a cross-org test that unexpectedly passes as a real, reportable vulnerability (not a flaky test) — fix the underlying endpoint, re-run, and only then proceed. Never weaken/delete a failing test to make the suite green.
5. This is app-level enforcement, not CI — it depends on this rule being followed each session. It does not replace the suite; it replaces relying on anyone's memory to run it.

As of the most recent full audit (2026-10-24), the suite covers 128 tests across all endpoint groups fixed in that audit plus later additions (`test_idor_cross_org.py` + `test_idor_cross_org_extended.py`). **Note:** list endpoints with NO resource-id parameter (e.g. `GET /schools/year-admin-data`) are also a leak vector — a query filtered only by year/status on a school-scoped table (no `org_id` column) returns every org's rows; scope them with `schools!inner(org_id)` + `.eq("schools.org_id", ...)`. Keep this number roughly current when adding more coverage.

### Recurring security cadence (MANDATORY — do not wait for the user to ask)

| Check | Frequency | What to do |
|---|---|---|
| Cross-org test suite (`pytest backend/tests/security/`) | Every relevant code change + before every deployment | Covered by the rules above — already automatic. |
| Dependency vulnerability scan (`pip-audit -r backend/requirements.txt`, `npm audit` in `frontend/`) | **At least once a month**, or whenever the user says anything like "תבדוק את מצב האבטחה" / "בדיקת אבטחה" / "סריקת אבטחה" | Run both, report any new findings in Hebrew, fix low-risk ones (patch-level bumps) directly; flag anything requiring a major-version bump or architecture change before touching it. |
| Full security posture review (OWASP-style, like the 2026-10-23/24 audit) | **Once a quarter**, OR before any significant new feature/integration, OR before onboarding a meaningful batch of new customer orgs | Re-run the full methodology: check for new missing org-ownership checks (grep for `school_id`/`meeting_id`/`user_id`/`run_id`/`log_id` path params without a `_require_*`/`_check_*` call), re-audit exceptional-condition handling (`.single()` usage, swallowed `HTTPException`), re-check security headers are still in place (backend `main.py` + the Render static site Headers page), and re-verify the Microsoft-tenant-conflict guard (`calendar_router.py`) is intact. |
| Ad-hoc check after anything suspicious | **Immediately**, same session, never deferred | If the user reports anything that smells like cross-org data leakage, duplicate/unexpected notifications, or unexplained access — treat it exactly like the 2026-10-24 Outlook-leak investigation: check the live DB data (read-only first), form a concrete theory, verify or rule it out before claiming anything, and report findings honestly including what couldn't be confirmed. |

**Do not rely on the user remembering to ask for any of the above on schedule.** If the project has a scheduled/cron reminder set up for this (see any `schedule`/cron entry referencing "בדיקת אבטחה" or "security check"), that is the primary trigger — treat a wake-up from it as an explicit instruction to run the monthly dependency scan (or the quarterly full review, if due) and report back, without needing further confirmation to start.

---

## Development Rules

1. **Always use plan mode** before implementing any new feature
2. All explanations to the user must be in **Hebrew**
3. Never hardcode API keys — always use `.env` / `.env.local`
4. **Do NOT touch** any file in `backend/logic/` (see Architecture Invariants §2)
5. After every change: append to `dev-log.md`
6. Run `npx vite build` after every frontend change to verify 0 errors
7. When adding a field to `schools`: run the DB migration via Management API (see above), update `SchoolIn` in `schools_router.py`, update frontend state in both `AdminPage.jsx` and `SchoolPage.jsx`
8. **See "Cross-Org Security Test Suite (MANDATORY)" above** — applies to any endpoint touching an org-scoped resource id
