# Dev Log

## 2026-06-16 — UI: החלפת לוגו במסך ההתחברות ובסיידבר
- `frontend/src/assets/logo.png`: לוגו חדש עם רקע שקוף — מסך התחברות
- `frontend/src/assets/logo-sidebar.png`: גרסת לוגו לסיידבר כהה עם רקע שקוף
- `frontend/src/pages/LoginPage.jsx`: לוגו חדש במקום אייקון SVG; הוסר כיתוב "גפן AI"; טקסט "מערכת חכמה לניהול תקציב הגפן" בשחור; הוסר טקסט תחתון
- `frontend/src/components/Sidebar.jsx`: לוגו "Gefen AI" חדש עם תמונה מותאמת לרקע כהה
- `frontend/index.html`: נוסף גופן Outfit
- `.gitignore`: נוסף חריג `!frontend/src/assets/*.png`

## 2026-06-11 — Fix: list_advisors retry + InfoGrid key prop
- `backend/routers/schools_router.py`: `list_advisors` — נוספה לולאת retry מלאה עם `get_admin_client()` בתוך ה-try; תיקון 503 על cold start כשמשתמש פותח דיאלוג עריכה
- `frontend/src/components/ResultsView.jsx`: `InfoGrid` — `Fragment` נוסף לimport; `key` הועבר מ-`<dt>`/`<dd>` ל-`<Fragment key={label}>` (האלמנט החיצוני ב-map)

## 2026-06-11 — Fix: ניהול ותפעול — pill style + PDF/Excel export
- `frontend/src/components/ResultsView.jsx`: moved `PILL_STYLE` to module level; `NihulTab` now uses it (was using Tailwind classes → different look)
- `backend/logic/tikhnun_exporter.py`: generalized `_get_supplier_breakdown` → `_get_breakdown(key)`; added `_get_nihul_breakdown`; added `_write_nihul` for Excel; added "nihul" case to `build_tikhnun_section_story` (PDF) and `export_tikhnun_excel`; added "nihul" to PageBreak condition in `export_tikhnun_pdf`
- `backend/logic/combined_exporter.py`: added "nihul" to `TIKHNUN_TABS`, `_SHEET_NAMES`; import `_write_nihul`; handle "nihul" in Excel combined export loop

## 2026-06-11 — Feature: new "ניהול ותפעול" tab in check results
- `backend/routers/analyze_router.py`: added `_build_and_attach_nihul_breakdown()` — filters doch rows by nihul code (104 for תיכון, 67 for יסודי/ביניים), groups by supplier, attaches `nihul_breakdown` to each budget dict as a list with one item (same structure as yozma_breakdown)
- Called at all 3 sites after `_build_and_attach_yozma_breakdown` (classify, classify2, main analysis)
- `frontend/src/components/ResultsView.jsx`: added `"nihul"` tab to TAB_IDS/TAB_LABELS_MAP/TIKHNUN_ONLY_TABS
- Added `NihulTab` component — budget pills + `YozmaSupplierBreakdown` with title "פירוט ספקים - ניהול ותפעול"
- Updated `YozmaSupplierBreakdown` to accept `title` prop, conditionally hide empty plan_number, single-column grid when only 1 item
- Added nihul tab rendering for both single and dual-tikhnun modes

## 2026-06-11 — Feature: add supplier breakdown to yozma Excel/PDF exports
- `backend/logic/tikhnun_exporter.py`: added `_get_supplier_breakdown()` helper — returns one entry per plan/initiative from `yozma_breakdown`, mirroring the website's per-plan card view
- `_write_yozma()` (Excel): appended "פירוט ספקים לפי יוזמה" section — gray header row per initiative (קוד + שם + מענה + סכום), then one supplier row per supplier (שם + מספר + סכום), no individual transactions
- `build_tikhnun_section_story()` (PDF): same section — single continuous table, initiative header rows in gray, supplier rows below each, 3 columns (יוזמה/שם ספק | מספר ספק/מענה | סכום)

## 2026-06-11 — Fix: yozma "משויך" column shows "–" for single-budget schools
- `backend/routers/analyze_router.py`: added `_propagate_meshuyakh_to_root(tikhnun_result)` helper
- The helper copies `meshuyakh` from `tikhnun["budgets"][i]["yozma_03/04"].detail` to the root `tikhnun["yozma_03/04"].detail` by matching report codes
- Called at all 4 call sites after `_compute_per_budget_yozma`
- Root cause: `_build_yozma_detail` in `tikhnun_processor.py` never wrote `meshuyakh`; `_compute_per_budget_yozma` did write it on the per-budget objects but the frontend reads the root for single-budget schools (no pills)

## 2026-06-11 — Fix: STAGE_MAP missing yesodi entries in tikhnun_processor
- `backend/logic/tikhnun_processor.py`: added "יסודי בלבד", "יסודי וחט"ב", "יסודי" to `STAGE_MAP`, all mapped to "חטיבת ביניים"
- Before fix: יסודי schools fell back to tikkon codes (105-108) → `yozma_by_code` returned empty → total yozma = 0
- After fix: יסודי schools correctly use beinayim codes (68-71) → correct totals (e.g. עין הים: 231,506 ₪)
