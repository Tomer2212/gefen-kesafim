# Dev Log

## 2026-06-09 — ביצועים: ייעול טעינה, קריאות מקביליות, gunicorn
- **`frontend/src/main.jsx`**: הוספת `axios.defaults.timeout = 20000` — בקשות תקועות נכשלות אחרי 20 שניות
- **`frontend/src/pages/DashboardPage.jsx`**: ה-`init()` שוכתב — `loadSchools()` מתחיל מיידית, תוך כדי שהקריאות `/users/me`, `/users/all`, `profiles` רצות במקביל (`Promise.allSettled`); העדפות localStorage נטענות סינכרונית עוד לפני
- **`frontend/src/pages/SchoolPage.jsx`**: קריאות `/accounts` ו-`/logs` מתבצעות ב-`Promise.allSettled` במקביל (במקום ברצף)
- **`frontend/src/App.jsx`**: הוספת keep-alive — כל 9 דקות נשלחת `GET /health` לשמירת ה-Render dyno חם
- **`backend/routers/schools_router.py` — `list_schools()`**: קריאת schools + advisor filter מקבילית עם `ThreadPoolExecutor` — במקום 2-3 קריאות Supabase ברצף
- **`backend/routers/schools_router.py` — `get_meetings_stats()`**: עבור owner/manager — קריאה אחת בלבד לmeetings (ללא שאילתת schools); עבור advisor — קריאות schools + advisor_schools מקבילית
- **`render.yaml` + `requirements.txt`**: החלפת `uvicorn --workers 4` ב-`gunicorn -w 4 -k uvicorn.workers.UvicornWorker` — gunicorn מאחזר workers שקרסו אוטומטית (uvicorn לא עושה זאת), מונע את שגיאות "cannot connect" שנגרמות כשworker מת לאחר עיבוד קובץ גדול

- **`frontend/src/components/Sidebar.jsx`**: אחרי שמירת שם ב-`profiles`, מוסיפים קריאה ל-`supabase.auth.updateUser({ data: { full_name } })` כדי לסנכרן את ה-`user_metadata` בסשן המקומי. בלי זה הסיידבר המשיך לקרוא את השם הישן מה-JWT.

## 2026-06-04 — פיצ'ר: אזור אישי בסיידבר
- **`frontend/src/components/Sidebar.jsx`**: הוספת כפתור "אזור אישי" מתחת ל"בית". לחיצה פותחת מודאל עם: שם מלא (עריכה + שמירה), מייל (קריאה בלבד), לחצן "עדכון סיסמה" שמפעיל `supabase.auth.resetPasswordForEmail` ומציג אישור. מודאל נגיש עם `useFocusTrap` + `role="dialog"`.
- **`backend/routers/schools_router.py`**: הוספת endpoint `PATCH /schools/users/me/profile` — מאפשר לכל משתמש מחובר לעדכן את השם שלו (`full_name`) ב-`profiles`.

## 2026-06-04 — פיצ'ר: שכחת סיסמה (password reset flow)
- **`frontend/src/pages/LoginPage.jsx`**: הוספת 3 views: `login` → `forgot` → `sent`. כשלוחצים "שכחת סיסמה?" עוברים לטופס הכנסת מייל; המערכת קוראת ל-`supabase.auth.resetPasswordForEmail` עם `redirectTo=/set-password`; אחרי שליחה מוצגת הודעת אישור.
- **`frontend/src/pages/SetPasswordPage.jsx`**: הוספת טיפול ב-`PASSWORD_RECOVERY` auth event. כשמגיעים מקישור איפוס — מציג הטופס ישירות ללא בדיקת status; אחרי עדכון סיסמה עובר ל-`/` ללא קריאה ל-`setup-complete` (רק ב-invite flow).

## 2026-06-04 — פילטרי checkbox בסינון מתקדם
- **`frontend/src/pages/DashboardPage.jsx`**: הוספת פילטר "גישה" (רשימה כלפי מעלה, משבצות, כפתור אישור + נקה). אפשרות "כולם" בראש — מסנן בתי ספר עם `restrict_access_to=null`. גישה לפי UUID ספציפי מסנן לפי שדה `restrict_access_to`. פילטרי "תוכנת כספים" ו-"יועץ מלווה" עברו לאותו רכיב `CheckboxFilterField`.

## 2026-06-04 — פיצ'ר: תהליך הזמנה מותאם אישית + סטטוס משתמש
- **Supabase config**: עדכון Site URL ל-`localhost:5173`; הוספת `gefenai.co.il` לרשימת redirect URLs המותרים.
- **DB migration**: הוספת עמודת `status TEXT NOT NULL DEFAULT 'active'` לטבלת `profiles`.
- **`.env`**: הוספת `APP_URL=http://localhost:5173` (לשינוי ל-`https://gefenai.co.il` לפני deploy).
- **`backend/routers/schools_router.py`**: `invite_user` שולח `redirect_to` לפי `APP_URL` ומעדכן `status='pending'`; endpoint חדש `POST /users/me/setup-complete` שמסמן משתמש כ-`active`.
- **`frontend/src/pages/SetPasswordPage.jsx`**: דף הגדרת סיסמה חדש — בודק session, מציג אימייל נעול, שתי שדות סיסמה, אחרי אישור → dashboard.
- **`frontend/src/App.jsx`**: הוספת route ציבורי `/set-password`.
- **`frontend/src/pages/AdminPage.jsx`**: עמודת סטטוס בטבלת משתמשים (🟠 ממתין לאישור / 🟢 רשום); רענון רשימה אחרי שליחת הזמנה.

## 2026-06-04 — Fix: מחיקת משתמש לא עובדת
- **DB migration**: שינוי 4 FK constraints מ-`NO ACTION` ל-`ON DELETE SET NULL`: `check_logs.run_by`, `meetings.advisor_id`, `meetings.created_by`, `school_update_requests.reviewer_id`. גם הפכנו `check_logs.run_by` ל-nullable.
- **`frontend/src/pages/AdminPage.jsx`**: הוספת error handling ב-`handleDeleteUser` — שגיאה מוצגת באדום בתוך המודל; ביטול מנקה את השגיאה.

## 2026-06-02 — Fix: קובץ כספים2000 ריק לא גורם לקריסה
- **`backend/logic/kesafim_processor.py`**: `load_kesafim` מחזיר עכשיו DataFrame ריק עם עמודות תקינות כשאין שורות אסמכתאות בקובץ (למשל תקציב ללא הוצאות). קודם לכן נזרק `KeyError: 'amount_raw'` והבדיקה כולה נכשלה.

## 2026-06-02 — תשתית: Persistent State, Storage, Indexes, Multi-Worker
- **Persistent Run State** (`analyze_router.py`): הוסרה ה-`runs: dict` הגלובלית; כל מצב ריצה נכתב ל-Supabase (`run_states` table) ונקרא ממנה ישירות בכל בקשה — ללא local cache. תומך ב-multi-worker ועמיד ב-restarts.
- **Temp Dirs** (`analyze_router.py`): קבצים שמועלים כעת נשמרים ב-`tempfile.mkdtemp()` במקום `RUNS_DIR` קבועה. התיקייה הזמנית נמחקת ב-`finally` בסוף הריצה.
- **Excel ל-Storage** (`analyze_router.py`): קובץ ה-Excel המופק נועלה ל-Supabase Storage (`excel/{run_id}/...`). endpoint `GET /analyze/download/{id}` מוריד ממנו ישירות במקום מהדיסק.
- **Supabase**: נוצרה טבלת `run_states` (id TEXT PK, status, result JSONB, created_at). נוספו 5 אינדקסים: `check_logs(school_id)`, `check_logs(run_by)`, `advisor_schools(school_id)`, `school_update_requests(school_id)`, `school_update_requests(requester_id)`.
- **Startup Cleanup** (`main.py`): ניקוי `run_states` + קבצי Excel ב-Storage ישנים מ-120 יום; קבצי מקור ב-Storage נשמרים 730 יום עם `check_logs`.
- **Multi-Worker** (`render.yaml`): נוסף קובץ `render.yaml` עם `--workers 4` לפרודקשן.

## 2026-06-02 — תיקון: עמודות "קבוע"/"גמיש" (נותר לתכנון) בטבלת היסטוריה — per-budget
- **Backend** (`analyze_router.py`, `_finalize_tikhnun_metrics`): אחרי בניית `budgets_list`, מחושב `fixed_gap_abs` ו-`flexible_remaining` לכל תקציב בנפרד מתוך `kvua_rows` (סכום `hefresh` per `budget_type` אחרי נרמול שם). קודם `flexible_remaining = max(H-L, 0)` ללא ניכוי הקבוע
- **Frontend** (`SchoolPage.jsx`, `renderCheckLogCellForBudget`): נוספו `case "fixed_gap"` ו-`case "flexible_remaining"` — קוראים מ-`ov.fixed_gap_abs` / `ov.flexible_remaining` על ה-budget הנבחר. קודם נפלו ל-`default:` שמחזיר ערך גלובלי

## 2026-06-01 — שיפור: עמודות משויך/טרם שויך + פריסת 2 עמודות בפירוט ספקים
- **עמודות חדשות בטבלת הסעיפים**: "משויך" (סכום ביצוע מקובץ דיווח לפי קוד+תקציב) ו-"טרם שויך" (בתכנון − משויך); backend: `code_exec` per yozma code ב-`_compute_per_budget_yozma`, מוסיף `meshuyakh` לכל item
- **פריסת 2 עמודות**: פירוט ספקים לפי יוזמה מוצג ב-CSS grid 2-עמודות; קו אנכי בין העמודות ו-border-bottom בין שורות

## 2026-06-01 — תוספת: פירוט ספקים לפי יוזמה בלשונית יוזמות וצרכים
- **backend** (`analyze_router.py`): פונקציה חדשה `_build_and_attach_yozma_breakdown` — לכל תקציב בונה רשימת יוזמות (שילוב קוד דיווח + מספר מענה) עם פירוט ספקים ואסמכתאות ממקובץ דיווח ביצוע; צמוד כ-`yozma_breakdown` לכל dict תקציב
- **תיקון צדדי**: הוספת קריאות `_compute_per_budget_yozma` ב-endpoints `classify_rows` ו-`retry_finance` — עד כה נתוני יוזמות נעדרו לאחר סיווג ידני
- **frontend** (`ResultsView.jsx`): component חדש `YozmaSupplierBreakdown` — אקורדיון לפי יוזמה, שורות ספק נפתחות לפירוט (תאריך/אסמכתא/תיאור/סכום)

## 2026-06-01 — UX: ישור כפתורים + שמירת תשובה בלשונית יוזמות
- **כפתורים**: שינוי `justify-end` → ללא justify ב-inline dialog של יוזמות; עם `dir="rtl"` על הcontainer הכפתורים מיושרים ימינה באופן טבעי
- **שמירת תשובה**: שינוי מ-conditional rendering לCSS `display:none` עבור `YozmaTab` — הcomponent נשאר mounted בעת מעבר ללשוניות אחרות, כך שמצב `pendingDialogBudget` ו-`budgetMultipliers` נשמר; המשתמש לא נדרש לענות מחדש בכל כניסה ללשונית יוזמות

## 2026-06-01 — תיקון dedup מרכיבים: מפתח (מענה+מרכיב+קוד) במקום (col[:10]+קוד)
- **גורם עמוק**: col[13] ("עלות למרכיב") הוא עלות ברוטו של המרכיב — זהה בכל הסלים. מענה יכול להכיל N מרכיבים (N שורות לאותו סל+קוד). מפתח dedup שכלל col[:10]+col[17] השאיר רק את המרכיב הראשון ודחה את השאר → סכומים חלקיים בלבד
- **גם**: col[15] ("עלות מתקציב") = עלות המענה הכוללת עבור הסל — זהה לכל שורות אותו מענה/סל גם אם יש מספר קודים → כפל ספירה בין קוד 68 לקוד 69
- **תיקון**: מפתח dedup חדש **(col[9], col[10], col[11], col[12], col[17])** = (מספר מענה, ספק, סוג מרכיב, שם מרכיב, קוד דיווח). זה:
  1. סופר כל מרכיב פעם אחת (גם כשחוזר בסלים שונים)
  2. מפריד בין קודים שונים של אותו מענה
  3. מאפשר סכימת כל col[13] של מרכיבים שונים תחת אותו קוד
- תיקון ב-3 מקומות: `_finalize_tikhnun_metrics` (_fseen), `_compute_per_budget_yozma` (component_seen), `_compute_multi_budget_tikhnun` (seen_plan_keys)

## 2026-05-31 — תיקון קריטי: stored_file_paths לא נשמר ב-DB (בדיקות חדשות)
- **גורם**: ב-`_process` (analyze_router.py), `stored_file_paths` הוגדר מוקדם ב-`runs[run_id]["stored_file_paths"]`, אך לאחר מכן כל נתיב (`gefen-only`, `normal`, `tikhnun-only`) החליף את `runs[run_id]` עם dict חדש שאינו כולל את המפתח — המידע נמחק לפני ש-`_save_check_log` הצליח לקרוא אותו
- **תיקון**: הוספת `"stored_file_paths": stored_file_paths or None` לכל 4 מיקומי ה-dict assignment (שורות 1684, 1697, 1779, 1848)
- תאימות לאחור: בדיקות ישנות (stored_file_paths=null) ממשיכות להשתמש בנתיב legacy (העלאה מלאה מחדש)

## 2026-05-31 — שיפור: טקסט ברור במודל הוספת קובץ כשאין stored_file_paths
- מודל "עדכון בדיקה": כשהקבצים המקוריים לא נשמרו ב-Storage, מוצגת הודעת אזהרה ⚠️ עם שמות כל הקבצים המקוריים + הנחיה להעלות את הכל יחד

## 2026-05-31 — תיקון: "הוסף קובץ" מעדכן שורה קיימת ולא פותח שורה חדשה
- `startUpdateCheck` poll handler: כש-`updateLogId` מוגדר (עדכון שורה קיימת) — `pendingRun` נמחק מיד בסיום, ו-`onReloadLogs()` מציג את השורה המעודכנת; שגיאות עדיין מוצגות בשורה נפרדת
- שורת `pendingRun` בטבלה: מוצגת רק כש-`!updateLogId` (בדיקה חדשה) או כשיש שגיאה — לא מוצגת בזמן loading/done של עדכון
- `isLoadingThis`: הורחב לכלול `pendingRun?.updateLogId === log.id && status === "loading"` — הספינר מופיע על השורה הקיימת עצמה

## 2026-05-31 — שיפור UX: האייקון עצמו הוא הכפתור להוספת קובץ
- `NotCheckedBadge`: ✕ הפך לכפתור לחיץ (כשיש `onAddFile`); tooltip מציג הסבר + הנחיה "לחץ על ה✕ להוספת קובץ"
- `FileCheckCell` (state="present"): ✓ הפך לכפתור לחיץ; tooltip מציג שמות קבצים + הנחיה "לחץ על ה✓ להוספת קובץ"
- הוסר כפתור "+ הוסף קובץ" הנפרד מתוך שני ה-popups — האייקון עצמו הוא הפעולה

## 2026-05-31 — שיפור NotCheckedBadge: כפתור "הוסף קובץ" בתוך tooltip
- `NotCheckedBadge` (SchoolPage.jsx): המרה מ-pure CSS group-hover ל-useState hover (כמו FileCheckCell) + הוספת prop `onAddFile`; כשה-onAddFile מועבר, מוצג כפתור "+ הוסף קובץ" מתחת להסבר בתוך ה-tooltip
- `renderCheckLogCellForBudget`: הוספת פרמטר `onAddFile` ועברתו ל-NotCheckedBadge
- call site בטבלת היסטוריה: מועבר `() => setAddFileModal({ log })` לכל תא fn/gn/sum
- `FileCheckCell`: מעביר `onAddFile` ל-NotCheckedBadge גם בעמודות קבצים עם state="not_checked"

## 2026-05-31 — תיקון: X אדום בטבלת היסטוריה — fn/gn count ועמודות קבצים פר-תקציב
- `renderCheckLogCellForBudget` (SchoolPage.jsx): תיקון תנאי `allNotChecked` — שינוי מ-`entries.length > 0 &&` ל-`entries.length === 0 ||`, כך שגם כשאין כלל entries לתקציב (שורות דוח לא זוהו) מוצג X אדום עם tooltip
- `FileCheckCell` (SchoolPage.jsx): החלפת prop `present` (boolean) ב-`state` ("present"|"not_checked"|"absent") + `notCheckedReason` — כעת מציג `NotCheckedBadge` במקום ✓ כשלא בוצעה בדיקה
- הוספת חישוב פר-תקציב בתוך `filteredLogs.map`: `budgetEntries` מסונן לפי `selectedHistBudget`; `fileState()` ו-`fileNotCheckedReason()` מחשבים state לכל תת-עמודת קובץ
- לוגיקה: תכנון תמיד גלובלי; דיווח — ✓ אם יש entries לתקציב, ✗ אם אין אבל הקובץ הועלה; כספים — ✓ אם entry עם not_checked:false, ✗ אם כולם not_checked:true, גלובלי אם אין entries

## 2026-05-31 — תיקון: נתונים גלובליים מוצגים בטאב תקציב ספציפי
- **בעיה**: כשבדיקה אין לה `per_combo_results` (לא הועלה קובץ תכנון) ומשתמש בוחר טאב תקציב ספציפי ("תנופה"), פונקציית `renderCheckLogCellForBudget` חזרה ל-fallback גלובלי — מה שהציג את סך כל הליקויים מכל התקציבים כאילו היו ספציפיים לתנופה
- **תיקון** (SchoolPage.jsx): שני fallback lines שינו מ-`renderCheckLogCell(log, key)` ל-`"—"`: (1) כשאין per_combo_results לבדיקה זו; (2) כשאין tikhnun_result.budgets לבדיקה זו. גם fallbacks פנימיים (no_pdf/rejected/no_pdf_sum/rejected_sum) שונו מ-renderCheckLogCell ל-"—"

## 2026-05-31 — תיקון "הוסף קובץ" לבדיקות ישנות (stored_file_paths=null)
- **בעיה שאובחנה**: לבדיקות ישנות (לפני Supabase Storage, sfp=null), מודל "הוספת קובץ" הציג שדה העלאה עם אזהרה — אך המשתמש העלה רק קובץ אחד. נתיב legacy קרא לאותה פונקציה `_save_check_log` עם `update_log_id`, ובכך **דרס** את `finance_file_name` ב-null ואיבד את נתוני הכספים הקיימים
- **תיקון frontend** (SchoolPage.jsx): כשה-log אין לו `stored_file_paths`, מוצג `LegacyAddFileModal` — מודל מידע בלבד ללא ממשק העלאה, שמסביר שצריך לבצע בדיקה חדשה עם כל הקבצים
- **תיקון backend** (analyze_router.py, `_save_check_log`): כשמתבצע update (`update_log_id` מוגדר) ורוץ gefen-only — שומר את `finance_file_name`, counts וסכומים מה-log המקורי (מניעת דריסה של נתוני כספים קיימים)

## 2026-05-31 — תיקון קריטי: Storage upload נכשל לקבצים עם שמות בעברית
- **גורם שורש**: `_upload_files_to_storage` השתמש בשם הקובץ המקורי (עברית) כ-key ב-Storage. supabase-py מעביר את ה-path ישירות ל-API ו-Supabase Storage דוחה Unicode characters ב-key → קבצי payscool וtikhnun נכשלו בשקט (non-fatal) → sfp הכיל רק קבצי doch
- **תוצאה שנראתה**: כשהמשתמש לחץ "הוסף קובץ", המערכת הורידה רק את קבצי doch מ-Storage (ללא kasafim/tikhnun) → הריצה יצאה gefen-only → per_combo_results=null → תקציבים ספציפיים הציגו —
- **תיקון** (`analyze_router.py`): `_upload_files_to_storage` עברה להשתמש ב-key מבוסס מיקום ASCII (`file_00.xlsx`, `file_01.xlsx`...) ולהחזיר רשימת dicts `{"path": storage_path, "name": original_name}`
- **תיקון** (`analyze_router.py`): `add_file_to_check` מטפל בשני הפורמטים — dict חדש (name+path נפרדים) וstring ישן (legacy checks)
- **תיקון** (`schools_router.py`, `main.py`): קוד מחיקה/cleanup מחלץ `.path` מ-dict לפני שמעביר ל-`storage.remove()`
- **תאימות לאחור**: sfp ישנות (string format) עדיין עובדות — טיפול בשני הפורמטים ב-add_file

## 2026-05-31 — תיקון: LegacyAddFileModal — כפתור "בדיקה חדשה" עובד
- SchoolPage.jsx: העברת prop `onNewCheck={() => { setAddFileModal(null); setShowNewCheckModal(true); }}` ל-`LegacyAddFileModal` — לחיצה על "בדיקה חדשה" סוגרת את המודל ופותחת את מודל הבדיקה הרגיל

## 2026-06-01 — תיקון: betikhnun שגוי ביוזמות, הסרת בפועל, שחזור גמיש פנוי
- **שורש הבעיה betikhnun**: קובץ `פירוט המענים` מכיל שורות כפולות לאותו מענה (אחת לכל סל מימון). `_finalize_tikhnun_metrics` מבצעת dedup לפי 10 עמודות ראשונות; `_compute_per_budget_yozma` לא עשתה זאת → 4 עותקים של 112,316 = 449,264 (במקום 112,316). תוקן: הוספת `_seen_plan_keys` עם `dedup_key = tuple(row[:10])` לפני הסיכום
- **שורש הבעיה hefresh**: שונה לחישוב `cap - betikhnun` ו-`mx - betikhnun_total` (לא meduvach) — עקבי עם ההתנהגות המקורית
- **הסרת "בפועל"**: הוצא `hasMeduvach` לוגיקה לחלוטין מ-YozmaTab; שוחזר עמודה אחת (`סכום זמין לתכנון בשקלול תקציב גמיש פנוי`) בדיוק כמו המקור
- **שחזור "תקציב גמיש פנוי"**: הסרת `!hasBudgetPills` condition — מוצג תמיד בסיכום יוזמות

## 2026-06-01 — תיקון רוחבי: dedup מפתח קוד דיווח בקובץ תכנון
- **שורש הבעיה**: מענה עם תת-סעיפים לקודי דיווח שונים (למשל 68=כיבוד + 69=נלוות) מייצר שורות בעלות `row[:10]` זהה אך col[17] שונה. dedup לפי `row[:10]` בלבד גרם לדחיית השורה השנייה — סכומה אבד
- **3 מקומות תוקנו** ב-`analyze_router.py`: (1) `sum_chayav` ב-`_compute_multi_budget_tikhnun`; (2) `budget_seen` ב-`_compute_per_budget_yozma`; (3) `_fseen` ב-`_finalize_tikhnun_metrics`
- **מפתח חדש**: `(tuple(row[:10]), str(row[17] or ""))` — שורות עם אותו מענה + אותו סל + קוד שונה מקבלות מפתחות שונים ושתיהן נספרות
- **השפעה**: `sum_chayav`, `yozma betikhnun` ו-`partial_rows` מחושבים נכון כעת לכל מענה מרובה-קודים

## 2026-06-01 — תיקון יוזמות פר-תקציב: dedup, סדר עמודות, גמיש פנוי
- **תיקון dedup betikhnun** (`analyze_router.py`): שינוי אלגוריתם ל-`_compute_per_budget_yozma` — במקום לבדוק dedup רק על שורות yozma (מה שגרם לדילוג על שורות עם קוד שאינו yozma שחסמו שורות yozma עם אותו key[:10]), עכשיו מבצעים תחילה dedup מלא לכל שורות התקציב (כולל שאינן yozma) ואז סוכמים רק שורות yozma — זהה בדיוק לאלגוריתם `tikhnun_processor.py`
- **תיקון סדר קודים**: `_YOZMA_CODES_TIKKON` ו-`_YOZMA_CODES_BEINAYIM` — שינוי סדר ל-נלוות → רכוש קבוע → כיבוד → תיקונים קלים (כמו `tikhnun_processor.py` המקורי)
- **תיקון "סכום זמין"** (`analyze_router.py`): הוספת `flexible_remaining` לכל budget overview ב-`_finalize_tikhnun_metrics` (ערך משוער: `H - L`; תיקון מלא לאחר חישוב kvua פר-תקציב בהמשך); שימוש בנוסחת `min(cap - betikhnun, flexible_remaining)` ב-`_compute_per_budget_yozma` — עקבי עם `tikhnun_processor.py`
- **תיקון frontend** (`ResultsView.jsx`): `YozmaTab` קורא `flexible_remaining` מה-budget הנבחר (כשיש pills) במקום מ-`tikhnun.overview` הגלובלי

## 2026-06-01 — פיצ'ר: יוזמות וצרכים פר-תקציב עם מודל תמרוץ נפרד לכל תקציב
- **Backend** (`analyze_router.py`): הוספת קבועים `_YOZMA_CODES_TIKKON` (105-108) ו-`_YOZMA_CODES_BEINAYIM` (68-71); פונקציית `_compute_per_budget_yozma` מחשבת yozma_03+yozma_04 לכל budget dict ב-`tikhnun["budgets"]` — betikhnun מקובץ התכנון, meduvach מ-results_clean כשזמין
- **Backend**: קריאה ל-`_compute_per_budget_yozma` ב-2 מקומות ב-`_compute_multi_budget_tikhnun`: לאחר זיהוי מלא (עם results_clean) ולאחר no-doch run (עם results_clean=None → meduvach=None)
- **Frontend** (`ResultsView.jsx`): `YozmaTab` — כשיש 2+ תקציבים עם yozma_03: מוצג שורת pills, לחיצה על תקציב שטרם ענה עליו פותחת dialog inline עם שאלת מודל תמרוץ לאותו תקציב ספציפי; כל תקציב שומר multiplier (03/04) עצמאי; תצוגה כוללת שורת "בפועל (מדיווח)" + עמודה "בפועל" בטבלה כשיש meduvach
- **Frontend** (`handleTabClick`): לשונית יוזמות עם ריבוי תקציבים — עוקפת את ה-dialog הגלובלי ועוברת ישירות לטאב

## 2026-06-01 — תיקון סופי: stage resolution יסודי/חטיבת ביניים לפי division_type מה-DB
- **גורם שורש**: זיהוי stage בזיהוי_core מחזיר "חטיבת ביניים" לכל קוד אמביגואלי (BEINAYIM_ONLY) שאין לו ערך "יסודי בלבד" בקובץ התכנון — כולל קודים שמדווחים בדיווח אך לא קיימים בתכנון כלל. בבית ספר יסודי יוצר per_combo נפרד `budget-חטיבת ביניים` לצד `budget-יסודי`
- **תיקון** (`analyze_router.py`): פונקציית עזר `_get_school_stage(gefen_account_id)` מבצעת lookup בטבלת `gefen_accounts` ומחזירה `division_type`
- **תיקון** (`_run_per_combo_reconciliation`): פרמטר `school_stage` חדש — כשהוא `"yesodi"`, כל `stage="חטיבת ביניים"` ב-results_clean מוחלף ב-`"יסודי"` לפני בניית combo_map; `combos` נבנה מחדש מ-results_clean המתוקן
- **העברת school_stage** ב-3 call sites: `_process` (DB lookup ישיר), `/classify` ו-`/retry-finance` endpoints (דרך `_school_ctx.gefen_account_id`)
- **הסרת workaround**: gefen_splits stage remap (שהוסף כ-workaround) הוסר — הפתרון הנכון מחליף אותו

## 2026-06-01 — תיקון: per_combo stage מיפוי לבתי ספר יסודיים
- **בעיה**: זיהוי stage ב-zihuy_core מחזיר גם "יסודי" וגם "חטיבת ביניים" לאותו תקציב בבית ספר יסודי (כי קודי BEINAYIM_ONLY חופפים לטווח יסודי). `gefen_splits` ו-`combos` כללו שני combos: `(תקומה, יסודי)` ו-`(תקומה, חטיבת ביניים)`. ה-finance (שמשתמש ב-fallback stage יחיד) כיסה רק אחד מהם → השני קיבל not_checked=true → בתוך הבדיקה הוצג "לא נמצאו נתוני כספים לתקציב תקומה" אף שהכספים כוסו
- **תיקון ראשוני (הוחלף)**: ניסיון לרמאפ finance → gefen לא עזר כי finance כבר כלל stage שקיים בgefen
- **תיקון סופי** (`analyze_router.py`): רמאפ של `gefen_splits` — כל stage של gefen שאינו קיים ב-finance (ויש בfinance בדיוק stage אחד לאותו תקציב) מאוחד ל-stage של finance; `combos` מחושב מחדש כ-union של gefen_splits + finance_splits keys
- תאימות לאחור: תיכון + חטיבת ביניים בבית ספר תיכון לא מושפעים (finance מכיל שני stages → len(f_stages)!=1 → אין רמאפ)

## 2026-05-31 — Supabase Storage, הוספת קובץ, ותקציבים לא נבדקים

### שמירת קבצים ב-Supabase Storage
- נוצר bucket פרטי `check-files` ב-Supabase
- `analyze_router.py` — `_upload_files_to_storage()`: פונקציה חדשה שמעלה קבצי בדיקה ל-Storage בתחילת `_process` (background task)
- `_save_check_log`: שמירת `stored_file_paths` ב-`summary` JSONB
- `schools_router.py` — `delete_log`: לפני מחיקת שורה מה-DB, מוחק את הקבצים המשויכים מ-Storage
- `main.py`: task ב-startup שמנקה קבצים ישנים מעל 24 חודשים מ-Storage (non-fatal)

### Endpoint חדש: `POST /analyze/add-file/{log_id}`
- מוריד קבצים מקוריים מ-Supabase Storage + מחבר עם קבצים חדשים שהועלו
- מריץ `_process` מחדש עם `update_log_id` לעדכון הבדיקה הקיימת
- תאימות לאחור: בדיקות ישנות (ללא `stored_file_paths`) ממשיכות להשתמש ב-`/analyze/upload` עם העלאה מלאה

### תקציבים לא נבדקים (not_checked)
- `_run_per_combo_reconciliation`: כשקובץ הכספים לא מכסה תקציב מסוים — מוסיף `not_checked: true` במקום להציג את שורות הדוח כ-"ליקויים" (מצג שווא)
- `HashvaTab` (ResultsView.jsx): pills נבנים מ-`tikhnun.budgets` (כלל תקציבי התכנון), עבור תקציב עם `not_checked` מוצגת הודעת הסבר צהובה
- `getTabIssues`: לא מסמן tab כ"יש בעיות" כשכל הentries הם `not_checked`
- טבלת היסטוריה — `renderCheckLogCellForBudget`: תקציב `not_checked` מציג X אדום עם tooltip צהוב (Tailwind group-hover)

### שיפור hover על עמודות קבצים בהיסטוריה
- `FileCheckCell` (SchoolPage.jsx): קומפוננטה חדשה — hover על ✓ ירוק מציג popup עם שמות הקבצים וכפתור "הוסף קובץ"
- `startUpdateCheck`: כשיש `stored_file_paths` — קורא ל-`/analyze/add-file/{id}` עם קובץ אחד בלבד; אחרת — `Legacy` עם העלאה מלאה
- טקסט מודל "עדכון בדיקה" מתאים לפי אם יש קבצים שמורים

## 2026-05-31 — תיקון: per_combo עם תקציב אחד — השוואה נגד כל קובץ הכספים
- **גורם**: כשבדוח יש שורות לתקציב אחד בלבד (כגון גפן), `_run_per_combo_reconciliation` החזיר `None` (תנאי `len(combos) <= 1`), ולכן ההשוואה הכוללת השוותה את כל קובץ הכספים (כולל שורות תנופה/תקומה) מול הדוח, וגרמה לפערים כוזבים מתקציבים שלא היו בדוח
- `_run_per_combo_reconciliation`: שינוי תנאי החזרה מ-`len(combos) <= 1` ל-`len(combos) == 0` — מחשב per_combo גם עבור תקציב אחד
- שינוי גם ב-`return per_combo if len(per_combo) > 1` ל-`>= 1`
- `HashvaTab` (ResultsView.jsx): תמיכה ב-single-combo — כשיש תקציב אחד בלבד, מציג את הטבלאות עם נתוני הקומבינציה המסוננים (ללא כפתורי תקציב), במקום לחזור לתצוגה הכוללת

## 2026-05-31 — תיקון: per_combo_results לא הוצג בתצוגת בדיקה ב-SchoolPage
- `SchoolPage.jsx` — `logToResult`: הוספת `per_combo_results: s.per_combo_results ?? null` — קריאת בדיקה מהיסטוריה לא העבירה per_combo לResultsView
- `SchoolPage.jsx` — `onComplete` של ClassifyModal: מקבל כעת `(division, tikhnun, perComboResults)` ומעדכן `pendingRun.result.per_combo_results` כשהזיהוי הושלם

## 2026-05-31 — תיקון באגים: per_combo_results — שלב ריק, היסטוריה, הפצה לפרונטאנד
- `_build_gefen_combo_map`: שורות עם שלב ריק (קודי דיווח SHARED 157/159/163) מקבלות fallback stage מהתקציב שלהן — לא מדולגות
- `_run_per_combo_reconciliation`: הוסר דרישת `r.get("stage")` מהבדיקה הקפדנית — רק `r.get("budget")` נדרש; הוספה לוגיקת `budget_stage_fallback` לחישוב `combos` נכון לשורות SHARED
- `classify_rows`: מחשב per_combo_results לאחר סיווג ידני (אם יש `gefen_paths`/`finance_paths` ב-`_zihuy_ctx`); תגובת ה-endpoint כוללת כעת `per_combo_results`
- `retry_finance`: תגובה כשזיהוי הושלם כוללת כעת `per_combo_results`
- `ClassifyModal.jsx`: מעביר `data.per_combo_results` דרך `onComplete(division, tikhnun, perComboResults)`
- `MainPage.jsx`: `handleTikhnunUpdate` מקבל ומעדכן `result.per_combo_results` בstate
- `SchoolPage.jsx` — `renderCheckLogCellForBudget`: כשקיים `per_combo_results` אך אין ערך לתקציב הנוכחי — מחזיר 0/"—" במקום נפילה ל-aggregate

## 2026-05-31 — השוואה כספים-גפן לפי שילוב (תקציב × שלב)
- `analyze_router.py`: נוספו 10 פונקציות עזר: `_build_gefen_combo_map`, `_split_gefen_by_combo`, `_stage_from_report_code`, `_get_fallback_stage`, `_split_finance_kesafim`, `_load_payscool_sheet_df`, `_split_finance_payscool`, `_split_finance_schoolcash`, `_get_finance_col_map`, `_run_per_combo_reconciliation`
- `_compute_multi_budget_tikhnun` שונה מ-`-> dict` ל-`-> tuple[dict, list | None]` — מחזיר `results_clean` רק כשכל השורות זוהו בוודאות; `_zihuy_ctx` הורחב לכלול `gefen_paths`, `finance_paths`, `finance_type`; כל 6 call-sites עודכנו
- `_process` ב-`analyze_router.py`: לאחר חישוב `finance_col_map`, מנסה `_run_per_combo_reconciliation` ושומר תוצאה ב-`runs[run_id]["per_combo_results"]`
- `retry_finance`: לאחר השלמת הזיהוי המלא, מנסה להריץ per-combo recon מקבצים שנשמרו ב-`_zihuy_ctx` ושומר ב-`run["per_combo_results"]`
- `_save_check_log`: שומר `per_combo_results` ב-`summary_to_save` (JSONB — אין שינוי סכמה)
- `ResultsView.jsx` — `HashvaTab`: כשיש `per_combo_results` עם 2+ שילובים, מציג כפתורי תקציב + שתי טבלאות לשילוב הנבחר; `getTabIssues` בודק `per_combo_results` כשקיים
- `SchoolPage.jsx` — `renderCheckLogCellForBudget`: הוספת cases `fn_count`, `fn_sum`, `gn_count`, `gn_sum` לפי `per_combo_results` — מסנן לפי `budget === budgetName` ומסכם כמה שילובים שייכים לאותו תקציב

## 2026-05-29 — דיווח חסר — תיקון קיבוץ תוכניות מרובות שורות ב-פירוט המענים
- `_finalize_tikhnun_metrics` ב-`analyze_router.py`: שורות 949–984 שונו — במקום לעבד כל שורה ב-`_filtered_plans` בנפרד, מקובצות עכשיו שורות לפי מפתח `(A,B,C,D,E,G,H,I,J,O,R)` וסכום עמודה P מחושב לכל קבוצה
- תיקון מכסה שני תסמינים: (1) סכום תכנון שגוי — תוכנית על 50,000 ₪ שהוצגה כ-49,928 בלבד (הסכום של שורה אחת בלבד), (2) שורה חסרה — תוכנית שנעלמה לגמרי כי כל שורה בנפרד נחשבה מדווחת במלואה למרות שסך שתיהן לא היה מכוסה
- הסיבה: תוכניות שמנצלות תקציב ממספר סלים מוצגות בשורות נפרדות בקובץ התכנון; העמודה היחידה השונה בין השורות היא F (תאור סל), לכן הן לא נחשבו כפולים; כעת מוכרות כאותה תוכנית בזכות עמודה O (עלות מענה כוללת) הזהה ביניהן

## 2026-05-29 — תיקון קריטי: דיווח חסר — exec_sums לפי תקציב
- `_finalize_tikhnun_metrics` ב-`analyze_router.py`: `exec_sums` שונה מ-`{plan_key: amount}` ל-`{budget_norm: {plan_key: amount}}` — מונע זיהום צולב בין תקציבים ששיתפו אותו מפתח תוכנית (קוד דיווח + שם מענה ללא מספר)
- הבאג גרם לשני תסמינים: (1) אותה תוכנית הופיעה בשני תקציבים עם אותם נתוני ביצוע, (2) שורות שנעלמו כי ביצוע מתקציב אחר ניפח את ה-divuach ומנע הופעת החסר

## 2026-05-29 — דיווח חסר — תיקון כפתורי תקציב ב-PartialTab
- `PartialTab` ב-`ResultsView.jsx`: restructure — כפתורי תקציב (`pillsEl`) מוגדרים עכשיו מחוץ לכל early-return ומוצגים תמיד בבחירה מרובת תקציבים
- תוקן סדר בדיקות: `!has_doch` נבדק לפני `rows.length === 0` — מכאן שבית ספר ללא קובץ דיווח ביצוע יציג "לא הועלה קובץ דיווח ביצוע" (ולא בטעות "כל התוכניות דווחו במלואן")
- הבאקאנד (`partial_rows` עם שדה `budget`) וההיסטוריה (`renderCheckLogCellForBudget`) כבר עבדו נכון ולא דרשו שינוי

## 2026-05-29 — ללא PDF — פירוט לפי תקציב אחרי זיהוי מלא
- `_build_no_pdf_from_results_clean()` חדשה ב-`analyze_router.py`: מחשבת per-budget no-PDF מ-`results_clean` לפי שני תנאים: `orig[13].strip() == "לא"` (האם קיים קובץ) **וגם** `normalize_amount(orig[11]) != ""` (סכום פריט לא ריק — כדי לא לספור שורות כותרת/ריקות); שומרת כ-`tikhnun["per_budget_no_pdf"]` — נקראת ב-3 call-sites זהים לאלה של per_budget_rejected
- `NoPdfTab` ב-`ResultsView.jsx`: אותה ארכיטקטורה כמו `RejectedTab` — כפתורי תקציב לכל התקציבים, "אין אסמכתאות ללא PDF" כשהתקציב ריק, fallback לרשימה גולמית כשאין זיהוי; call-sites dual-tikhnun מקבלים כעת prop `tikhnun`
- `renderCheckLogCellForBudget` ב-`SchoolPage.jsx`: הוספת cases `no_pdf` ו-`no_pdf_sum` — לוגיקה זהה ל-rejected

## 2026-05-29 — תיקון: כפתורי תקציב בלשונית אסמכתאות שנדחו + ספירה נכונה בהיסטוריה
- `RejectedTab` ב-`ResultsView.jsx`: כאשר יש מספר תקציבים — מציג כפתורי בחירה לכל התקציבים (כולל אלה ללא אסמכתאות שנדחו); לחיצה על תקציב מציגה את הטבלה שלו, ואם אין אסמכתאות — הודעת "אין אסמכתאות שנדחו" ירוקה
- `renderCheckLogCellForBudget` ב-`SchoolPage.jsx` cases `rejected`/`rejected_sum`: תוקן — כאשר `per_budget_rejected` קיים אך אין ל-budget הנוכחי ערך, מחזיר 0 / "—" במקום fallback לספירה הכוללת

## 2026-05-29 — אסמכתאות שנדחו — פירוט לפי תקציב אחרי זיהוי מלא
- `_build_rejected_from_results_clean()` חדשה ב-`analyze_router.py`: מחשבת per-budget rejected מ-`results_clean` של `zihuy_core` — עקבית עם החישוב של `nikuy` ו-`pct_tanuz`
- תיקון: הקריאה ל-`_build_rejected_from_results_clean` הוצאה מתוך `_finalize_tikhnun_metrics` ומבוצעת ישירות ב-`_compute_multi_budget_tikhnun` ובשני נתיבי `classify_rows`, כל אחד עם try/except נפרד — מונע בליעת שגיאה שקטה על ידי ה-try/except החיצוני
- תיקון עיקרי: `BUDGET_NAME_MAP` ב-`zihuy_core.py` — ה-entry של "גפן חירום" הועבר לפני ה-entry של "גפן"; "גפן" הוא substring של "גפן חירום" ולכן בסריקה לפי סדר הוא היה מתאים ראשון ומחזיר "גפן" בטעות לשמות כמו "גפן חירום"
- `RejectedTab` ב-`ResultsView.jsx`: אם `tikhnun.per_budget_rejected` קיים — מציג טבלה נפרדת לכל תקציב; אם יש תקציב אחד — ללא שינוי בתצוגה; fallback לרשימה הגולמית כשאין זיהוי
- `renderCheckLogCellForBudget` ב-`SchoolPage.jsx`: הוספת cases ל-`rejected` ו-`rejected_sum` — כשיש טאב תקציב פעיל בהיסטוריה, מציג את הספירה/סכום לאותו תקציב בלבד

## 2026-05-29 — תיקון: זיהוי SchoolCash ב-retry-finance
- `_build_finance_ichud_budget_map` עבור SchoolCash: תוקן `sif_col` — שני עמודות מכילות "סעיף גפ"ן" (קוד מספרי + תיאור); הלולאה דרסה לתיאור. הוסף `and "תיאור" not in h` כדי לבחור את עמודת הקוד הנכונה (col 0)
- תוקן `inv_col` — שגה מ-`מספר תעודה` ל-`מספר חשבונית` (ה-union_key מבוסס על מספר חשבונית, לא תעודה). עם שני התיקונים כל 5 השורות הבעייתיות מזוהות אוטומטית מקובץ SchoolCash

## 2026-05-29 — תיקון 3 באגים: dropdown חטיבה, StageMismatch יסודי, אפשרות 1 ב-ClassifyModal
- `getModalAccounts()` ב-`SchoolPage.jsx`: בתי ספר לא-שש-שנתיים מחזירים תמיד בדיוק חשבון אחד (מתאים לשלב, ואם אין — הראשון) → dropdown "בחר חטיבה" לעולם לא יופיע לבתי ספר שאינם שש-שנתיים
- בדיקת StageMismatch ב-`startCheck`: הוגבלה לשלבים tikkon ו-beinayim בלבד; יסודי הוסר כי קודי הדיווח שלו חופפים לטווח BEINAYIM_ONLY ומגרים false-positive
- `handleStageMismatchConfirm()`: לאחר אישור StageMismatch, בודק `pending_identification` ב-`result` ומאכלס `classifyQueue` — `ClassifyModal` מופיע גם בנתיב זה
- `ClassifyModal.jsx`: "אפשרות 1" (העלאת קובץ כספים) מוצגת תמיד כל עוד יש שורות לא מזוהות (לא רק כשסגנל `needs_finance_upload`); כותרת משתנה ל-"נסה עם קובץ כספים אחר" אחרי retry ראשון

## 2026-05-28 — תיקונים ב-ClassifyModal: runId, multi-file, ביטול
- **תיקון "הריצה לא נמצאה"**: `_process` לא שומר עוד ל-Supabase כשיש `pending_identification=True` (גורם היה: `onReloadLogs` מחזיר את הריצה → effect מאפס את `pendingRun` → `runId=null`)
- `runId` נשמר עכשיו בכל item ב-`classifyQueue` (לא תלוי עוד ב-`pendingRun.runId`)
- `retry-finance` endpoint מקבל כעת `files: list[UploadFile]` — תמיכה בהעלאת מספר קבצי כספים בבת-אחת
- `ClassifyModal`: כפתור ביטול (× בכותרת + "ביטול הבדיקה" בתחתית); טקסט "נסה זיהוי אוטומטי" שונה ל-"התחל בדיקה"; בחירת מספר קבצים; הסבר שמציג את כל שמות התקציבים (covered + missing)
- `SchoolPage`: ביטול מנקה `classifyQueue` + `pendingRun` (חוזר להיסטוריה)
- `MainPage`: ביטול קורא ל-`handleNewRun` (חוזר למסך הטעינה)

## 2026-05-28 — תיקון: ReferenceError classifyQueue לא מוגדר ב-SchoolPage
- `SchoolPage.jsx`: `ClassifyModal` הועבר מ-render של `SchoolPage` החיצוני לתוך render של `ChecksTab` — שם שוכנות state `classifyQueue`, `pendingRun` ופונקציות `startCheck`/`startUpdateCheck`
- הסרת ClassifyModal מ-`SchoolPage` החיצוני שגרם ל-`ReferenceError` כי `classifyQueue` לא היה נגיש בסקופ החיצוני

## 2026-05-28 — תיקון: ClassifyModal לא הופיע בבדיקה מ-SchoolPage
- `ClassifyModal` הועבר לקובץ משותף `frontend/src/components/ClassifyModal.jsx`
- `SchoolPage.jsx`: הוסף import + state `classifyQueue` + בדיקת `pending_identification` בסיום ה-polling ב-`startCheck` וב-`startUpdateCheck` + rendering של `ClassifyModal` בראש ה-render
- `MainPage.jsx`: הוסר הקוד הפנימי של `ClassifyModal` (מוחלף ב-import מהקובץ החדש)
- **הבאג:** `SchoolPage` מריץ בדיקות עם polling עצמאי שלא בדק `pending_identification` כלל — כעת מתוקן בשני הנתיבים (`startCheck` + `startUpdateCheck`)

## 2026-05-28 — ClassifyModal: העלאת קובץ כספים + retry endpoint
- `_build_finance_ichud_budget_map`: מחזירה כעת 4 ערכים: `(ichud_map, warnings, covered_budgets, invalid_reason)` — מכסה כספים2000/פייסקול/סקולקאש
- `_compute_multi_budget_tikhnun`: מחשבת `missing_budgets`, `needs_finance_upload` לפי covered vs. plan budgets; מוסיפה שדות חדשים ל-pending response
- `POST /analyze/retry-finance/{run_id}`: endpoint חדש — מקבל קובץ כספים נוסף, מנסה לזהות את השורות הלא-מזוהות שוב, מחזיר `{pending, tikhnun}`
- `classify_rows`: מנקה גם את השדות החדשים (`needs_finance_upload`, `missing_budgets`, `covered_budgets`, `finance_invalid_reason`) בסיום הסיווג
- `ClassifyModal` (`MainPage.jsx`) שוכתבה: כאשר `needs_finance_upload=True` מוצג בראש המודל סקשן כחול להעלאת קובץ כספים עם הסבר דינמי (לפי covered/missing/invalid); לחיצה על "נסה זיהוי אוטומטי" קוראת ל-retry endpoint; אם נותרו שורות — המודל מתעדכן; `currentTikhnun` state; "המשך ללא שורות אלו" — מדלג על הכל בבת אחת

## 2026-05-28 — זיהוי ודאי לכל שורות דיווח ביצוע — הצלבה עם כספים + UI ידני
- `_build_finance_ichud_budget_map`: פונקציה חדשה ב-`analyze_router.py` — בונה מיפוי ichud→תקציב מקבצי כספים2000/פייסקול/סקולקאש
- `_finalize_tikhnun_metrics`: פונקציה חדשה שמחשבת nikuy/pct_tanuz/partial_rows (הופרדה מ-`_compute_multi_budget_tikhnun`)
- `_compute_multi_budget_tikhnun` שוכתבה עם signature חדש (`finance_paths`, `finance_type`): מריצה זיהוי → הצלבה עם כספים → אם נותרות שורות לא-מזוהות: מחזירה `pending_identification=True` ושומרת `_zihuy_ctx` זמני
- `POST /analyze/classify/{run_id}`: endpoint חדש — מקבל סיווגים ידניים, מחיל אותם ומפעיל מחדש את חישוב המטריקות
- `_save_check_log` עודכנה לנקות `_zihuy_ctx` לפני שמירה ל-Supabase
- `_process` עודכנה: מעבירה `finance_paths`/`finance_type` לכל קריאות `_compute_multi_budget_tikhnun`, שומרת `_school_ctx` ב-run dict
- `MainPage.jsx`: `ClassifyModal` — חלונית חוסמת מלאה (blocking modal, z-50 overlay) שמופיעה ברגע שהבדיקה מסתיימת ויש שורות לא-מזוהות; לכל שורה: pills לבחירת תקציב + שלב + כפתור דילוג; "אשר סיווגים" מופעל רק כשכל השורות קיבלו תשובה; תמיכה ב-queue לאחסון מספר pending (tikkon + beinayim בנפרד)
- `ResultsView.jsx`: הוסרו ה-`PendingIdentificationPanel` וה-`useEffect` שהיו שגויים — לשונית סקירה מציגה `SikarTab` ללא תנאי (הסיווג מטופל ב-MainPage)

## 2026-05-28 — הרחבת טבלת ההיסטוריה בלשונית בדיקות
- הקונטיינר הראשי שינה מ-`max-w-4xl` ל-`max-w-6xl` (1152px) אך **רק** כאשר הלשונית "בדיקות" פעילה — הלשוניות, כפתורי כלים וטבלה תופסים ~256px נוספים (128px מכל צד), מצמצמים את השטח הריק בכ-63%

## 2026-05-28 — כפתורי חטיבה (תיכון/חטיבת ביניים) בשורת הלשוניות הראשית
- `activeSubTab` state הועלה מ-`ChecksTab` ל-`SchoolPage` — מועבר כ-props
- כפתורי "תיכון" / "חטיבת ביניים" מוצגים כעת בצד שמאל הקיצוני של שורת הלשוניות הראשית ('פרטי בית הספר', 'פגישות' וכו') כאשר הלשונית הפעילה היא "בדיקות" ובית הספר הוא שש-שנתי — spacer flex-1 מבדיל ביניהם
- הוסרה שורת ה-sub-tabs הנפרדת מתוך `ChecksTab`; `tableTopOffset` עודכן ל-260 קבוע (אין עוד שורה נוספת בשש-שנתי)

## 2026-05-28 — עיצוב שורת כלים בלשונית בדיקות
- כפתורי סוגי התקציב ('כולם' / 'גפן' / 'תנופה' וכו') עוצבו כלשוניות גלישה (border-b-2, -mb-px) — זהה לעיצוב הלשוניות הראשיות ('פרטי בית הספר', 'פגישות')
- כל השורה — לשוניות תקציב + כפתורי 'עמודות להצגה' ו'בדיקה חדשה' — אוחדה לשורה אחת עם border-b; כפתורי הפעולה ב-flex-shrink-0 בצד השמאלי הקיצוני (RTL)
- תפריט ה-dropdown של 'עמודות להצגה' שונה מ-right-0 ל-left-0 לפתיחה לכיוון ימין (שכן הכפתור כעת בקצה שמאל)

## 2026-05-28 — כפתורי תקציב בטבלת ההיסטוריה (SchoolPage)
- **backend**: שינוי guard ב-`_compute_multi_budget_tikhnun` מ-`<= 1` ל-`== 0` — כעת גם קבצי תכנון עם תקציב יחיד מאכלסים את רשימת `budgets` (חשוב לתצוגת ההיסטוריה)
- **frontend** `SchoolPage.jsx`: הוספת state `selectedHistBudget` ופונקציה `renderCheckLogCellForBudget` — כאשר תקציב נבחר, כל תא בטבלת ההיסטוריה קורא מ-`log.summary.tikhnun_result.budgets[selectedBudget].overview` (גובה תקציב, תכנון, אחוז דיווח, sum_chayav, pct_tanuz, partial_count, missing_report) — שאר העמודות (rejected, no_pdf, fn/gn) נשארות כלליות
- **frontend**: כפתורי "כולם / גפן / תנופה / ..." מוצגים מעל הטבלה כאשר קיימים 2+ תקציבים שונים בלוגים המסוננים הנוכחיים; לחיצה מעדכנת את כל הטבלה
- **frontend**: איפוס `selectedHistBudget` אוטומטי בעת מעבר בין לשוניות תיכון/חטיבת ביניים בבתי ספר שש-שנתיים

## 2026-05-27 — תיקון: Race condition בשמירת לוג + dropdown + sum_chayav
- **Race condition** ב-`analyze_router.py`: הפרונטאנד קיבל `status: "done"` לפני שהלוג נשמר ל-DB → `reloadLogs()` הביא רשימה ריקה/חלקית → שורות עם `—` בשדות. תוקן: status מוצב `"saving"` לפני השמירה ו-`"done"` רק לאחר שהשמירה ב-DB הסתיימה; `_save_check_log` מקבל גם status `"saving"`.
- **Dropdown 3 נקודות** ב-`SchoolPage.jsx`: שינוי מ-`top-full mt-1` ל-`bottom-0 left-full ml-1` → כפתור "מחק" מוצג **מימין** לכפתור 3-נקודות ולא מתחת, ולא מוסתר בשורה האחרונה.

## 2026-05-27 — סינון partial_rows + כפתורי תקציב ב-PartialTab
- **backend**: הוספת שדה `budget` לכל שורה ב-`partial_rows` — כעת כל תוכנית מסומנת עם שם תקציבה הנורמלי (גפן/תנופה/דוקאטי וכו')
- **frontend**: `activeBudgetIdx` הועבר לרמת האב (`ResultsView`) — state משותף בין `SikarTab` ו-`PartialTab`
- **frontend**: `SikarTab` מקבל כעת props `activeBudgetIdx` ו-`setActiveBudgetIdx` (fallback ל-local state אם לא הועברו — לשימוש בדואל)
- **frontend**: `PartialTab` מסנן שורות לפי תקציב נבחר ומציג כפתורי בחירת תקציב גם הוא, כך שהבחירה מסונכרנת בין הלשוניות

## 2026-05-27 — תיקון: partial_rows מסוננת נכון לפי תקציב (גישה נכונה)
- **בעיה**: הגישה הקודמת (key_to_bname) נכשלה כאשר אותו מפתח תכנית מופיע תחת מספר תקציבים (גפן + תנופה) — `key_to_bname` שמר רק את שם התקציב הראשון, כך שתוכניות מ-תנופה קיבלו שם גפן ולא סוננו.
- **תיקון**: במקום לסנן את `partial_rows` הקיים, בונים אותו מחדש מאפס: (1) טוענים את קבצי הדיווח לבניית `exec_sums`; (2) מסננים את `perut_rows` לפי שם תקציב (col A) **לפני** הכפלה; (3) בונים `partial_rows` רק מהתוכניות המסוננות. כך תוכנית זהה תחת שני תקציבים שונה שמרים כרשומות נפרדות, ורק גרסת התקציב הנכון שורדת.
- **שש-שנתי tab routing**: לוגים ללא `gefen_account_id` הוצגו בשתי הלשוניות. תוקן: כעת משתמשים ב-`summary.division` (tikkon/beinayim) שנשמר בבדיקה לקבוע לאיזה tab להציג. ברירת מחדל: tikkon.

## 2026-05-27 — תיקון: sum_chayav שגוי בעת תכנון מרובה תקציבים
- `_compute_multi_budget_tikhnun` זיהתה נכון את התקציבים אחרי תיקון `break→continue`, אבל לא עדכנה את `tikhnun_result["overview"]["sum_chayav"]` — זה נשאר עם הסכום הכולל של `build_tikhnun_result()` (590,886 במקום 260,030 לגפן)
- תוקן: לאחר חישוב nikuy לכל תקציב, מזוהים רק התקציבים שהופיעו בקבצי הדיווח שהועלו (doch_budget_norms), ומעדכן `overview.sum_chayav` ו-`overview.pct_tanuz` בהתאם

## 2026-05-27 — תיקון קריטי: זיהוי מרובה תקציבים בקובץ תכנון
- תוקן באג קריטי ב-`_compute_multi_budget_tikhnun` ב-`analyze_router.py`: לולאת הסריקה על גליון 'הכל' השתמשה ב-`break` כשנתקלה בשם חוזר → עצרה לאחר השורה השנייה של תקציב גפן לפני שהגיעה לדוקאטי/תנופה → `budgets_raw` קיבלה רק רשומה אחת → הפונקציה חזרה מוקדם ללא רשימת `budgets` → הצגת תצוגת תקציב-יחיד עם `sum_chayav` כולל (590,886 במקום 260,030)
- **תיקון:** שינוי `break` → `continue` בלולאה → כעת סורקת את כל הגיליון ומוצאת כל שמות תקציב ייחודיים
- תוקן באג נוסף ב-`filteredLogs` ב-`SchoolPage.jsx`: לוגים עם `gefen_account_id = null` סוננו החוצה משני הסאב-טאבים בבתי ספר שש-שנתיים → הוספת `if (!log.gefen_account_id) return true` כך שלוגים ללא חשבון גפן מוצגים בכל סאב-טאב

## 2026-05-27 — תיקון: זיהוי גליונות ב-_compute_multi_budget_tikhnun
- זיהוי גליונות 'הכל' ו'פירוט המענים' עבר לזיהוי לפי **שם גיליון** (ראשי), ולא לפי תוכן כותרת (גרם לבאג שבו שני if-ים לא-exclusive יכולים להצביע על אותו גיליון)
- זיהוי לפי תוכן כותרת נשאר כ-fallback אם הגיליונות לא נמצאים בשם

## 2026-05-27 — תיקון: תוצאת בדיקה נעלמת בבית ספר שש-שנתי
- ב-`SchoolPage.jsx`: `filteredLogs` הוזז לפני `useEffect` של auto-clear
- `useEffect` משתמש כעת ב-`filteredLogs` (מסוּנן לפי חשבון גפן) ולא ב-`logs` גולמי
- תוצאה: שורת הממתין מתנקה רק כש-הלוג **נראה** בטבלה של הסאב-טאב הנוכחי

## 2026-05-27 — תמיכה ביותר משני קבצי גפן
- הגבלת קבצי גפן הועלתה מ-2 ל-5 ב-`_classify_files`
- `_load_gefen_files` מטפלת כעת ב-3+ קבצים: מאחדת את כולם עם `pd.concat` ומסירה כפילויות לפי `ichud`

## 2026-05-27 — תמיכה בקבצי כספים2000 מרובים
- ניתן כעת להעלות מספר קבצי כספים2000 (XLS) במקביל — המערכת מאחדת ומסננת כפילויות אוטומטית
- `_classify_files` מאפשרת כעת מספר קבצי כספים2000; שגיאה מוצגת רק אם מועלים קבצים ממערכות שונות בו-זמנית
- `_load_finance_raw` מקבלת `list[Path]` — טוענת את כל הקבצים, מאחדת עם `pd.concat` ומסירה כפילויות

## 2026-05-27 — תמיכה בתקציבים מרובים (Multi-Budget) בלשונית סקירה
- נוסף `backend/zihuy_core.py` — מנוע זיהוי תקציב+שלב לשורות קובץ דיווח ביצוע (3 שלבי זיהוי: מספר מענה, סוג מענה, קוד דיווח + כללי רצף/מייקרוסופט/שילוב אחרון פתוח)
- נוסף `_compute_multi_budget_tikhnun()` ב-`analyze_router.py` — מזהה תקציבים מרובים מגיליון 'הכל' (עמודה A+H), מחשב per-budget: גובה תקציב (H), סכום שתוכנן (L), אחוז תכנון (L/H), סכום שדווח (S), אחוז דיווח כללי (T), סכום חייב בדיווח (מ'פירוט המענים' מסונן לפי שם תקציב + עמודה R), ניכוי (nikuy = נדחה + ללא קובץ - חפיפה מ-zihuy), אחוז דיווח למודל תמרוץ = (S−nikuy)/sum_chayav
- כשנמצאים 2+ תקציבים, נוסף שדה `budgets` לתוצאת tikhnun עם overview לכל תקציב
- עודכן `ResultsView.jsx` — לשונית 'סקירה' מציגה כפתורי בחירת תקציב (pills) כשיש תקציבים מרובים; בחירת תקציב מציגה את הנתונים הייחודיים שלו
- ריצה בודדת ודואלית (תיכון/ביניים) תומכות שתיהן בתקציבים מרובים
- עודכן CLAUDE.md עם תיעוד של המנגנון החדש

## 2026-05-15 — עמודות "קיים בכספים לא בגפן" ו"בגפן לא בכספים" בטבלת 'בדיקות'
- נוספו 2 קבוצות עמודות משמאל ל'דיווח חסר':
  1. "קיים בכספים, לא בגפן" — כמות (`fn_count`) + סכום (`fn_sum`)
  2. "בגפן, לא בכספים" — כמות (`gn_count`) + סכום (`gn_sum`)
- מיגרציית Supabase: הוספת עמודות `in_finance_not_gefen_sum NUMERIC` ו-`in_gefen_not_finance_sum NUMERIC` לטבלת `check_logs`
- backend: פונקציית `_sum_display_amounts` מחשבת סכום מ-`rows_finance_not_gefen` / `rows_gefen_not_finance` ושומרת ב-`log_fields` בכל שמירת בדיקה
- frontend: קריאה ישירה מהעמודה השמורה (`in_finance_not_gefen_sum`), עם fallback לחישוב מהשורות עבור לוגים ישנים ללא הסכום
- עמודות COUNT (`in_finance_not_gefen_count`, `in_gefen_not_finance_count`) כבר היו שמורות

## 2026-05-15 — תיקון צבע קווי גוף הטבלה (Tailwind v4)
- ב-Tailwind v4, border-color משתמש ב-CSS variables שנדרסים על ידי ה-cascade ב-border-collapse tables
- כל קווי הגוף (td) עברו מ-Tailwind classes (border-l border-black) לאינליין סטייל (borderLeft: "1px solid black")
- אינליין סטייל עוקף לחלוטין את ה-cascade ומבטיח שחור זהה לכותרות

## 2026-05-15 — תיקון קווים אנכיים — צבע, גבולות ומשך עד תחתית
- צבע אחיד: תא "תאריך" בשורות הגוף שונה מ-border-slate-100 ל-border-black (תואם לכותרות)
- קו מימין לקבצים שהועלו: אותו תיקון — border-l border-black על תא התאריך יוצר את הגבול הנכון
- קו משמאל לבגפן לא בכספים: unitBorderKeys משתנה — העמודה האחרונה עכשיו כוללת border-l (outer-left edge)
- קווים ממשיכים עד תחתית: נוסף h-full ל-table ושורת filler ריקה בסוף tbody שמתרחבת לגובה 100% (ממלאת את הקונטיינר)

## 2026-05-15 — גריד מלא בכותרות טבלת 'בדיקות'
- נוסף `border border-black` לכל תאי `<th>` — כותרת מקבלת מסגרת שלמה מכל הכיוונים (למעלה/למטה/ימין/שמאל)
- border-collapse על הטבלה מאחד קווים בין תאים סמוכים, כך שנוצר גריד נקי
- תוקן: לא היה קו בין "תאריך" ל"קבצים שהועלו"
- תוקן: לא היה קו משמאל לקבוצת "דיווח חסר" (שהיא העמודה הימנית ביותר בסדר הנוכחי)
- גוף הטבלה (td) נשאר עם קווים רק בגבולות קבוצות (לא גריד מלא)

## 2026-05-15 — תיקון קווים אנכיים בטבלת 'בדיקות'
- תוקנה לוגיקת `unitBorderKeys`: קודם הניח border-l על האיבר הראשון של כל יחידה (מה שיצר קו בתוך הקבוצה); עכשיו מניח border-l על האיבר האחרון (קו בין הקבוצה לבאה אחריה)
- נוסף `groupHeaderBorder` — helper לתא כותרת עם colSpan: מחזיר border-l שחור אם האיבר האחרון הנראה של הקבוצה הוא גבול יחידה
- כותרת אב "קבצים שהועלו": קו הפרדה שונה מ-slate-200 לשחור
- נוספו קווי הפרדה שחורים ל-kasafim בשורה שנייה של כותרת ובשורות גוף (מפריד בין קטע הקבצים לעמודות הניידות)
- קווים מוצגים נכון בכל שורות הטבלה: כותרות (שתי שורות) + גוף

## 2026-05-15 — כותרות קבוצה בטבלת 'בדיקות' (דומה ל'קבצים שהועלו')
- נוספו 5 קבוצות עמודות עם כותרת אב בשורה ראשונה ותת-כותרות בשורה שנייה: "נותר לתכנון" (קבוע/גמיש), "אחוז דיווח" (כללי/למודל תמרוץ), "אסמכתאות שנדחו" (כמות/סכום), "ללא PDF" (כמות/סכום), "דיווח חסר" (כמות תוכניות/סכום)
- קבוצה מוצגת רק כשעמודותיה סמוכות ב-colOrder הנוכחי (אחרת כל עמודה עצמאית עם rowSpan=2)
- מזהי ה-key נשארו ללא שינוי (rejected, rejected_sum, no_pdf, no_pdf_sum וכו') — רק ה-label מתקצר
- בוחר העמודות מציג "שם_קבוצה — תת_כותרת" לעמודות מקובצות (למניעת בלבול בין "כמות" של נדחו לבין "כמות" של ללא PDF)
- עמודות מקובצות אינן ניתנות לגרירה עצמאית

## 2026-05-15 — עמודות נוספות ושינויי שמות בטבלת 'בדיקות'
- שונו שמות עמודות: "אסמכתאות שנדחו" → "כמות אסמכתאות שנדחו", "ללא PDF" → "כמות אסמכתאות ללא PDF", "דיווח חסר" → "סכום דיווח חסר"
- נוספה עמודה "סכום אסמכתאות שנדחו" — סכום שדה "סכום" מתוך rows_gefen_rejected
- נוספה עמודה "סכום אסמכתאות ללא PDF" — סכום שדה "סכום" מתוך rows_gefen_no_pdf
- נוספה עמודה "כמות תוכניות עם דיווח חסר" — partial_rows.length מנתוני תכנון (מסוכם משני קבצי תכנון בשש-שנתי)
- סדר עמודות ב-DEFAULT: כמות שנדחו → סכום שנדחו → כמות ללא PDF → סכום ללא PDF → כמות דיווח חסר → סכום דיווח חסר

## 2026-05-15 — התראת חוסר התאמה בין קבצים לשלב המוסד
- לאחר העלאת קבצים, אם החטיבה שזוהתה בקבצים (תיכון/ביניים/יסודי) שונה משלב המוסד המוגדר בבית הספר — מוצגת חלונית אזהרה: "שים לב! הקבצים שהעלית שייכים לבית ספר X בזמן ששלב מוסד זה הינו Y. האם לבצע את הבדיקה בכל זאת?"
- "כן, בצע בדיקה" — הבדיקה מוצגת כרגיל ונשמרת בהיסטוריה
- "ביטול" — מחיקת הרשומה שנשמרה אוטומטית ב-Supabase, איפוס מצב הבדיקה
- לא פעיל בבתי ספר שש-שנתיים (שם קיים מנגנון נפרד לזיהוי חטיבה) ובמוסדות מסוג "אחר"
- backend: _save_check_log שומר כעת את ה-id של הרשומה שנוצרה ב-runs[run_id]["saved_log_id"] — מוחזר ב-result endpoint

## 2026-05-14 — תיקון: עמודת "דיווח חסר" בטבלת בדיקות
- תוקן: עמודת "דיווח חסר" הציגה in_gefen_not_finance_count (שגוי) — עכשיו מציגה את מספר השורות ב-partial_rows של הלשונית "דיווח חסר" מנתוני התכנון (tikhnun_result.partial_rows). בבית ספר שש-שנתי עם 2 קבצי תכנון — סוכם מ-tikhnun_tikkon_result ו-tikhnun_beinayim_result. ללא קובץ תכנון — מוצג "—"

## 2026-05-14 — תיקון: כפילות שורה + נתונים חסרים בטבלת בדיקות
- תוקן: לאחר סיום בדיקה, שורת ה-pendingRun לא נמחקה אוטומטית → הוצגו 2 שורות עם אותו תאריך (האמיתית + שורת הספינר שנשארה)
- פתרון: useEffect שמזהה ש-summary.run_id של הבדיקה המחזורית הופיע ב-logs, ומנקה את pendingRun אוטומטית
- תוקן: שורת pendingRun ב-status "done" הציגה "—" לכל העמודות — עכשיו מציגה נתונים אמיתיים מ-result.summary (סימוני ✓ בעמודות קבצים + נתוני תכנון/דיווח)

## 2026-05-14 — לשונית 'בדיקות': 5 שיפורים לטבלת הבדיקות
- **כפתור מחיקה (3 נקודות):** כל שורת בדיקה מקבלת תפריט 3 נקודות אופקיות בקצה השמאלי; לחיצה מציגה "מחק" → חלונית אישור → מחיקה מ-Supabase. הרשאה: בעלים בלבד (או מנהלים אם הבעלים האציל סמכות)
- **עמודות קבצים מפוצלות:** עמודת "קבצים שהועלו" מפוצלת לכותרת כפולה עם 3 תת-עמודות: תכנון / דיווח / כספים. מוצג ✓ ירוק אם הקובץ קיים, או + כחול אם חסר — לחיצה על + פותחת חלונית עדכון בדיקה (update_log_id)
- **שמירת נתונים מלאה:** backend שומר כעת גם rows_finance_not_gefen, rows_gefen_not_finance (לעמודות JSONB קיימות), tikhnun_result/tikhnun_tikkon_result/tikhnun_beinayim_result, rows_gefen_rejected, rows_gefen_no_pdf, gefen_only, finance_type, has_tikhnun, tikhnun_filenames, run_id — הכל ב-summary JSONB
- **לחיצה על תאריך בהיסטוריה:** כל תאריך בטבלה הוא קישור; לחיצה שולפת את הבדיקה המלאה מ-Supabase (GET /schools/{id}/logs/{log_id}) ומציגה ResultsView מלא — עובד גם לאחר הפעלה מחדש של השרת
- **זיהוי חטיבה בשש-שנתי:** לאחר בדיקה חדשה בבית ספר שש-שנתי, אם החטיבה שזוהתה בקבצים שונה מהלשונית הפעילה (תיכון/ביניים), מוצגת חלונית אזהרה עם שאלה האם לשמור גם עבור החטיבה האחרת (POST /analyze/save-for-account)
- backend: נוספו endpoint-ים GET /schools/{id}/logs/{log_id} ו-DELETE /schools/{id}/logs/{log_id} עם בדיקת הרשאות
- backend: upload מקבל עכשיו update_log_id (Form) — אם צוין, מעדכן שורה קיימת במקום להוסיף חדשה
- backend: נוסף endpoint POST /analyze/save-for-account לשמירת ריצה קיימת תחת חשבון גפן אחר

## 2026-05-14 — לשונית 'בדיקות': מיזוג היסטוריה ובדיקה חדשה
- שונה שם הלשונית "בדיקה חדשה" ל-"בדיקות"; הוסרה לשונית "היסטוריה" הנפרדת
- לבית ספר שש-שנתי: מוצגות תתי-לשוניות "תיכון" / "חטיבת ביניים" מתחת לשורת הלשוניות הראשית — כל אחת מציגה היסטוריית בדיקות של החטיבה הרלוונטית
- טבלת היסטוריה ממלאת את כל גובה החלון; עמודות דינמיות (ניתן לגרור לשינוי סדר + לבחור אילו מוצגות) ב-12 עמודות תוכן: תקציב, סכום שתוכנן, אחוז תכנון, קבוע שנותר לתכנון, גמיש שנותר לתכנון, סכום חייב בדיווח, סכום שדווח, אחוז דיווח כללי, אחוז דיווח למודל תמרוץ, אסמכתאות שנדחו, ללא PDF, דיווח חסר
- כפתור "בדיקה חדשה" פותח חלונית modal עם העלאת קבצים ובחירת חטיבה
- לאחר אישור: מופיעה שורה בטבלה עם spinner + תאריך; כשהבדיקה מסתיימת — התאריך הופך לקישור ולחיצה עליו פותחת את תצוגת הבדיקה המלאה עם כפתור "חזרה להיסטוריה"
- backend: _save_check_log שומר כעת tikhnun_overview בתוך עמודת summary של check_logs

## 2026-05-14 — הוספת אפשרויות מחוז: חינוך התיישבותי וחרדי
- נוספו שתי אפשרויות לרשימת המחוז בטפסי הוספה ועריכה של בית ספר: 'חינוך התיישבותי' ו'חרדי'
- עודכן ב-AdminPage.jsx וב-SchoolPage.jsx

## 2026-05-14 — לשונית 'בדיקה חדשה': אזור העלאת קבצים מוטמע
- במקום ניווט לעמוד נפרד, לשונית 'בדיקה חדשה' כעת מכילה את ממשק ה-upload ישירות
- רכיב CheckTab: בחירת חטיבה (dropdown כשיש יותר מאחת), FileUpload + "התחל בדיקה", מצב loading, תצוגת תוצאות, מצב שגיאה
- עובד גם כשאין חטיבות מוגדרות — school_id נשלח ללא gefen_account_id

## 2026-05-14 — תיקון הרשאות Supabase (profiles table)
- הוענקו הרשאות `SELECT` ו-`UPDATE` ל-`authenticated` role על טבלת `profiles`
- הכנה לשינוי מדיניות Supabase שייכנס לתוקף ב-30 אוקטובר 2026 (GRANTs מפורשים חובה)
- תוקן באופן מיידי גם תקלה שבה שמירת העדפות עמודות ב-Dashboard לא עבדה בשקט (אין SELECT/UPDATE → queries נכשלו)

## 2026-05-14 — כרטיס בית ספר: כפתור 3 נקודות + יישור 'התחלה'
- כפתור הפח הוחלף בכפתור 3 נקודות אופקיות (⋯) שמופיע בריחוף — לחיצה פותחת תפריט עם אפשרות 'מחק' שמוביל לחלונית האישור הקיימת
- רוחב עמודת 'התחלה' הוגדל ל-100px כדי לאזן מרחק מ-'סטטוס' ומ-'סיום'

## 2026-05-14 — כרטיס בית ספר: עמודות פגישות
- צמצום רוחב עמודות 'התחלה' ו'סיום' ל-52px (px-1 במקום px-2)
- יישור טקסט עמודת 'סוג' לאותו קו אנכי של הכותרת — הוסרה ריפוד px-1.5 מ-MeetingTypeSelect

## 2026-05-14 — דשבורד: עיצוב כותרות טבלה
- שורת הכותרות בטבלת בתי הספר קיבלה רקע `slate-100` (אפרפר עדין) במקום לבן, וגופן שחור (`slate-900`) — כדי שיהיה קל להבחין בין כותרת לשורה רגילה

## 2026-05-14 — דשבורד: עמודות סה"כ פגישות/שעות שבוצעו
- Backend: נוסף endpoint `GET /schools/meetings-stats` — מחזיר `{school_id: {completed, total_minutes}}` לכל בתי הספר הנגישים למשתמש
- Frontend: נוספו שני עמודות ל-`MOVABLE_COLUMNS`: `סה"כ פגישות שבוצעו` ו-`סה"כ שעות שבוצעו`
- הנתונים נטענים במקביל עם רשימת בתי הספר ב-`loadSchools()`, מוצגים בטבלה ובייצוא Excel

## 2026-05-14 — לשונית פגישות: תיקון tooltip, ולידציה תזכורת, ללא גלילה אופקית
- Tooltip ממוקם עם `left: 0` (מתרחב ימינה לתוך הטבלה) — לא נחתך עוד בשני המקומות (כותרת + כפתורים)
- Tooltip לא מוצג כשהכפתור כבר במצב ON
- לחיצה על ON ללא משתתפים: קופצת חלונית `NoParticipantsModal` עם הסבר, הערך לא משתנה
- הסרת `overflow-x-auto` + כל `minWidth` מתאי הטבלה — הטבלה מתכוונסת תמיד לרוחב הזמין, תוכן ארוך עובר לשורה נוספת

## 2026-05-14 — לשונית פגישות: תיקוני tooltip תזכורת
- tooltip כותרת "תזכורת": הוצג מעל (נחתך) → תוקן ל-`top: calc(100% + 6px)` (מתחת לכותרת)
- hover על כפתור OFF/ON: tooltip צהוב עם הסבר ("בהפעלת הכפתור תישלח...") מופיע מתחת לכפתור בכל שורה
- toast הירוק: הוארך מ-2 שניות ל-3 שניות (fade מתחיל ב-2.5s, נסגר ב-3s)

## 2026-05-14 — לשונית פגישות: tooltip תזכורת + toast הפעלה
- כותרת "תזכורת": hover מציג מלבן צהוב (#FEF08A) עם הסבר "בהפעלת הכפתור תישלח למשתתפים תזכורת יום לפני קיום הפגישה."
- הפעלת ON: חלונית toast צפה בפינה שמאל-תחתון (fixed), רקע ירוק בהיר, מתפוגגת אחרי 2 שניות (fade 0.5s), כפתור X לסגירה מוקדמת

## 2026-05-14 — לשונית פגישות: מיון עמודות, מודל מחיקה, סוג עם +
- **מיון עמודות**: כותרות תאריך, סטטוס, יועץ מבצע, סוג ניתנות ללחיצה — לחיצה ראשונה: עולה (↑), שנייה: יורד (↓), שלישית: ברירת מחדל. אייקון ⇅ מציין עמודה לא ממוינת
- **מודל מחיקה**: לחיצה על פח פותחת `DeleteMeetingModal` מרכזית עם כפתורי "מחק" + "ביטול", במקום confirm קטן בתוך השורה
- **עמודת סוג**: `MeetingTypeSelect` — כפתור dropdown מותאם; כשאין בחירה מוצג "+"; אפשרות ראשונה "בחר" מנקה לריק

## 2026-05-14 — לשונית פגישות: יועץ מבצע — בחירה מרובה
- `AdvisorCell` הוחלף לרכיב multi-select עם checkboxes (זהה ל-ParticipantsSelector)
- עמודת גישה: יועצים עם גישה לבית הספר מוצגים תחילה; יועצים ללא גישה — תחת "אחר" עם הסבר tooltip
- DB: נוספה עמודה `advisor_ids JSONB DEFAULT '[]'` לטבלת meetings; נהגרו נתונים קיימים מ-`advisor_id`
- Backend: `MeetingIn`, `list_meetings`, `create_meeting`, `update_meeting` — מעביר ומחזיר `advisor_ids` + `advisor_profiles`
- Frontend: `MeetingRow` מעביר `value={draft.advisor_profiles || []}` ו-`onChange` עדכני; `updateMeeting` שולח `advisor_ids`; `startNewMeeting` מאותחל עם `advisor_ids`

## 2026-05-14 — לשונית פגישות: ParticipantsSelector UX
- dropdown משתתפים: רוחב min-w-[210px] (ולא left-0 right-0) — ניתן לקרוא שמות ארוכים ללא גלילה
- כשאין משתתפים: מוצג + במקום — (זהה לעמודת הערות)
- אפשרות ראשונה ב-dropdown: "בחר" (מנקה את כל הבחירה)

## 2026-05-14 — לשונית פגישות: סיכום מיידי + @mention users
- שורת סיכום עדכון מיידי: שינוי סטטוס שומר IMMEDIATELY (לא מחכה ל-blur) — `saveDraft(nd)` קרוא ישירות מה-status dropdown onMouseDown
- דיוג כפל: הוסף `lastSentRef` ל-MeetingRow כדי שה-blur לא ישמור שוב אחרי save מיידי
- תיקון @mention: `loadUsers()` נקרא עכשיו בטעינת דף לכל התפקידים (קודם רק non-advisor) — כך שכל משתמש יכול לאזכר ב-notes

## 2026-05-14 — לשונית פגישות: תיקוני טעינה, סיכום מיידי, ניווט @mention
- תיקון טעינה: `meetingsLoading` מאותחל ל-`true` כך שהלשונית מציגה spinner מיידי (ולא "ריק") כשלוחצים עליה
- עדכון מיידי שורת סיכום: `updateMeeting` מבצע עדכון אופטימיסטי של `meetings` לפני קבלת תשובת השרת — הסיכום מתעדכן מיידית בשינוי סטטוס
- ניווט @mention: חצי מקלדת ↑↓ מדגישים פריט, Enter בוחר, Escape סוגר רק את הdropdown (לא את החלון)

## 2026-05-14 — לשונית פגישות: יישור עמודות, @mention כחול, שורת סיכום
- תיקון יישור תוכן עמודות: הוסף `text-right` ל-TimeInput ול-cellInput — כל ערכי הטבלה ממושרים כעת מול כותרת העמודה
- @mention בהערות: הוחלף textarea רגיל ב-overlay technique — הטקסט שקוף, מאחור div מציג `@שם` בצבע כחול (#2563eb bold)
- @mention — תיקון שמות עם רווחים: הלוגיקה של handleChange עברה מ-`/\s/.test(afterAt)` לבדיקת prefix עם שמות משתמשים — עובד גם כשמוחקים אות מהמילה השנייה של השם
- שורת סיכום בתחתית טבלת פגישות: "סה"כ פגישות שבוצעו" ו-"סה"כ שעות שבוצעו" (חישוב מ-start_time/end_time של פגישות בסטטוס 'בוצעה')

## 2026-05-14 — לשונית פגישות: תיוג משתמשים בהערות (@mention)
- NotesModal תומך עכשיו ב-@ לתיוג: כתיבת @ פותחת dropdown מסונן של כל משתמשי המערכת
- בחירת משתמש מהרשימה מכניס `@שם` בטקסט בנקודת הסמן
- בלחיצה על "שמור הערות" — אם יש תיוגים, נשלח POST ל-`/schools/{id}/meetings/{mid}/mentions`
- נוצרת טבלה `mention_notifications` ב-Supabase (recipient_id, sender_id, school_id, meeting_id, note_preview)
- endpoint `/schools/notifications` מחזיר גם mentions שלא נקראו
- תיקון: `onOpenNotes` מועברת עם meetingId נכון לשמירת ה-notesModal state

## 2026-05-14 — לשונית פגישות: UX שיפורים נוספים
- שדות שעת התחלה/סיום: הסרת מסגרת, הצגת ערך בלבד, ריק = ריק (ללא placeholder)
- עמודת משתתפים: שמות מופרדים בפסיק ללא מסגרת, hover מציג border עדין
- עמודת יועץ מבצע: רכיב AdvisorCell מותאם אישית (ללא מסגרת/חץ, hover = border)
- dropdown יועץ: שתי שכבות — יועצים עם גישה | "אחר" מרחיב יועצים ללא גישה (באפור עם tooltip)
- בחירת יועץ ללא גישה שולחת אוטומטית update-request לגורם המאשר
- backend: approve_request מטפל ב-add_advisor_to_school → מוסיף ל-advisor_schools
- תיקון תקלה: loadUsers נקרא בכניסה לטאב פגישות (פתר dropdown ריק)

## 2026-05-14 — לשונית פגישות: inline editing + עיצוב חדש
- כל שורת פגישה עכשיו תמיד עריכה מיידית — ללא כפתור "ערוך"
- שמירה אוטומטית כשעוזבים שורה (onBlur על ה-row)
- Status chips עם צבעים: נקבעה=כתום, בוצעה=ירוק, בוטלה=אדום, נדחתה=כחול, אחר=אפור
- נקודת צבע בתוך ה-chip (בסגנון screenshot שצוין), קליקבל לשינוי סטטוס
- תיקון dropdown יועץ מבצע: loadUsers נקרא כשנכנסים ל-tab פגישות
- ברירת מחדל לסוג פגישה שונתה מ"פיזי" ל"מרחוק"
- הסרת קומפוננטות MeetingRowEdit/MeetingRowDisplay, הוחלפו ב-MeetingRow אחד

## 2026-05-14 — תיקון לשונית פגישות: auto-save ו-reload
- תוקנה בעיה שבה חזרה ללשונית פגישות הציגה רשימה ריקה — `useEffect` עכשיו טוען תמיד בכל מעבר ל-tab פגישות (הוסר guard של `meetings.length === 0`)
- לחיצה על "הוסף פגישה" מייצרת פגישה במסד הנתונים מיידית (POST) — אין יותר state שאינו שמור
- שורה חדשה נשמרת אוטומטית כשעוזבים אותה (onBlur על ה-row)
- "ביטול" הוחלף בכפתור מחיקה עם אישור ("האם אתה בטוח שאתה רוצה למחוק לצמיתות את פרטי הפגישה?")
- תוקנה הרשאות DB: GRANT SELECT/INSERT/UPDATE/DELETE ON meetings TO service_role

## 2026-05-13 — Sidebar dark mode בכל העמודים
- הוחלף `<Sidebar />` ל-`<Sidebar dark />` בכל העמודים: NotificationsPage, TermsPage, MainPage, GuidePage, PrivacyPage, AdminPage, AccessibilityStatementPage, ContactPage, SchoolPage

## 2026-05-11 — SaaS Upgrade: Supabase Integration

### Supabase (DB + Auth)
- יצירת 5 טבלאות: `profiles`, `schools`, `gefen_accounts`, `advisor_schools`, `check_logs`
- הפעלת RLS על כל הטבלאות עם policies לפי תפקיד (owner / manager / advisor)
- Trigger לאוטומטית יצירת profile עם signup
- `backend/supabase_client.py` — Supabase admin client (lazy init)

### Backend
- `auth.py` — מוחלף לחלוטין: אימות ע"י `supabase.auth.get_user(token)` + שליפת role מ-`profiles`
- `requirements.txt` — הוסף `supabase==2.15.2`, הוסרו `python-jose` ו-`bcrypt`
- `routers/auth_router.py` — הוסר (Supabase מטפל ב-login מהפרונטאנד)
- `routers/schools_router.py` — חדש: CRUD לבתי ספר, חטיבות, שיוך יועצים, ניהול משתמשים
- `routers/analyze_router.py` — `upload` מקבל `school_id` + `gefen_account_id` אופציונליים; בסיום בדיקה שומר ל-`check_logs`

### Frontend
- `frontend/.env.local` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- `frontend/src/lib/supabase.js` — חדש: Supabase client
- `main.jsx` — axios interceptor משתמש ב-Supabase session token במקום localStorage
- `LoginPage.jsx` — מחליף ל-`supabase.auth.signInWithPassword` (email במקום username)
- `App.jsx` — routing חדש: Dashboard (`/`), SchoolPage (`/school/:id`), check (`/check`), admin (`/admin`)
- `DashboardPage.jsx` — חדש: רשימת בתי ספר עם כפתור בדיקה
- `SchoolPage.jsx` — חדש: בחירת חטיבה + היסטוריית בדיקות
- `AdminPage.jsx` — חדש: ניהול בתי ספר, חטיבות, משתמשים
- `MainPage.jsx` — מקבל context של בית ספר מ-navigation state, מציג שם בית ספר, לא תלוי ב-localStorage

## 2026-05-11 — Dashboard table, additional school fields, session fix

### DB
- Added columns to `schools`: `authority`, `principal_name`, `principal_phone`, `school_phone`
- Added columns to `gefen_accounts`: `finance_software`, `tmura_model` (boolean)

### Backend
- `schools_router.py` — updated `SchoolIn` and `GefenAccountIn` models with new fields
- `schools_router.py` — added `PUT /schools/{id}/accounts/{acc_id}` endpoint for editing division details

### Frontend
- `DashboardPage.jsx` — converted card list to sticky-header table (שם מוסד, סמל מוסד, עיר, רשות, חטיבות, + בדיקה button)
- `SchoolPage.jsx` — displays new school fields (principal name/phone, school phone) + per-account finance_software and tmura_model badges
- `AdminPage.jsx` — added new fields to school create/edit form; account rows now have inline edit for finance_software and tmura_model
- `main.jsx` — fixed session expiry: 401 responses now attempt `refreshSession()` before signing out, with request queue for concurrent failures
- `lib/supabase.js` — explicitly set `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: true`

## 2026-05-11 — Required advisor on new school

- `AdminPage.jsx` — הוספת dropdown "יועץ אחראי" (חובה) בטופס הוספת בית ספר חדש; לאחר יצירת בית הספר מתבצע אוטומטית `POST /schools/{id}/advisors`; בעת עריכה הדרופדאון לא מופיע (שיוך יועץ ממשיך להתנהל בחלק ה"חטיבות")

## 2026-05-11 — Fix: Garbled names in history table

- DB: ran `UPDATE public.profiles SET full_name = (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = profiles.id)` — synced correct Hebrew names from auth.users (was storing U+FFFD replacement chars)
- `schools_router.py` — made the `check_logs` → `profiles` join explicit: `profiles!run_by(full_name, email)` to avoid ambiguity

## 2026-05-11 — Fix: History Tab in SchoolPage

- `backend/routers/schools_router.py` — הוסף endpoint `GET /schools/{school_id}/logs` שמחזיר check_logs עם join ל-profiles
- `frontend/src/pages/SchoolPage.jsx` — useEffect מבצע fetch ל-`/schools/{schoolId}/logs` ומציג בטאב היסטוריה; שם מבצע הבדיקה לקוח מ-`log.profiles.full_name`

## 2026-05-11 — Multi-select advisors, notifications page, sidebar for info pages

### DB
- Added `school_update_requests` table (id, school_id, requester_id, proposed_changes JSONB, status, reviewer_id, reviewer_note, created_at, resolved_at)
- Added `delegate_approvals_to_managers` boolean to `profiles`

### Backend
- `schools_router.py` — added update-request endpoints: POST `/{id}/update-requests`, GET/PATCH `/update-requests`, `/update-requests/{id}`
- `schools_router.py` — added `GET /notifications` (pending count + items for approvers; resolved requests for advisors)
- `schools_router.py` — added `PATCH /users/me/settings` (delegation setting for owner)
- `schools_router.py` — `_get_approver_ids()` helper for delegation logic

### Frontend
- `App.jsx` — added `/notifications` route → NotificationsPage (protected)
- `NotificationsPage.jsx` — new: role-aware notifications; approvers see pending requests with approve/reject; advisors see request status; owner gets delegation toggle
- `AdminPage.jsx` — new school form: single advisor dropdown replaced with multi-select checkbox list (multiple advisors can be assigned at creation)
- `AdminPage.jsx` — expanded school panel: added "יועצים מוקצים" section showing assigned advisors as removable badges + add-advisor dropdown
- `Sidebar.jsx` — rewritten with notifications bell + badge count (polls every 60s), added nav items for all pages
- 5 info pages (GuidePage, ContactPage, AccessibilityStatementPage, TermsPage, PrivacyPage) — replaced standalone topbar with unified Sidebar component
- `SchoolPage.jsx` — advisors can submit "בקש עדכון פרטים" requests; shows request form with diff of changed fields

## 2026-05-11 — Fix: frequent session logout

- **Root cause:** backend called `supabase.auth.get_user(token)` on every request — a live network call to Supabase auth API that hit free-tier rate limits
- `backend/auth.py` — replaced with JWKS-based local JWT verification (ES256): fetches Supabase public key once via `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, caches it for 1 hour, verifies every JWT locally with zero network calls per request
- `backend/auth.py` — added 5-minute in-memory profile cache so DB is not hit on every request
- `backend/requirements.txt` — added `PyJWT>=2.8.0` and `cryptography>=41.0.0` for ES256 support

## 2026-05-12 — AdminPage: delete modal, edit-form parity, searchable advisor

- `AdminPage.jsx` — edit form now has "מחק בית ספר" button that opens `DeleteConfirmModal` (focus-trapped, Escape to cancel, red confirm button)
- `AdminPage.jsx` — edit form now shows assigned advisors as removable badges + `AdvisorSearch` input, matching the new-school form feature set
- `AdminPage.jsx` — advisor search (`AdvisorSearch` component) replaces the `<select>` dropdown in both the expanded panel and the edit form; type to filter, click to add immediately
- `AdminPage.jsx` — new-school advisor checkbox list also gained a search filter input above it

## 2026-05-12 — Admin: edit & delete users

- `schools_router.py` — added `PATCH /users/{id}` (update full_name, manager+) and `DELETE /users/{id}` (delete from auth + profiles cascade, owner only; cannot delete self)
- `AdminPage.jsx` — users table: "ערוך" button triggers inline name editing with Enter/Escape keyboard support; "מחק" button opens `DeleteConfirmModal`
- `AdminPage.jsx` — `DeleteConfirmModal` made generic with `title`/`subtitle`/`message` props (reused for both school and user deletion)

## 2026-05-12 — Fix: dashboard error & history not loading

- `backend/routers/schools_router.py` — `list_schools`: added try/except with fallback query (without nested profiles join) so PostgREST join errors don't crash the endpoint with 500
- `backend/routers/schools_router.py` — `list_logs`: added try/except with fallback query (without profiles join) so FK name resolution failures return logs without user name instead of 500
- `frontend/src/pages/DashboardPage.jsx` — error handling now distinguishes network errors vs server 5xx vs other; extracted `loadSchools()` function; added "רענן" retry button on error
- `frontend/src/pages/SchoolPage.jsx` — replaced `Promise.all` with `Promise.allSettled` so a failed logs request no longer silently swallows school/accounts data; added dedicated `logsError` state shown in history tab
- `frontend/src/pages/SchoolPage.jsx` — accounts now pre-populated from navigation state (`location.state?.school?.gefen_accounts`) so divisions show instantly even if the API call fails; removed redundant `/schools/` refetch from SchoolPage (already in navigation state); added "נסה שוב" retry button for history errors
- `backend/routers/schools_router.py` — `list_logs`: replaced intermittent PostgREST `profiles!run_by` join with two stable separate queries (logs + profile lookup by ID set); eliminates join resolution failures
- `frontend/src/pages/SchoolPage.jsx` — logs fetch now retries automatically once after 1.5s before showing error, to handle transient backend issues without user intervention
- `backend/auth.py` — added `threading.Lock` around JWKS fetch to prevent concurrent cold-start fetches; increased timeout from 5s to 10s
- `backend/main.py` — added `startup` event that pre-fetches JWKS key before the first user request, eliminating cold-start 500s
- `frontend/src/pages/DashboardPage.jsx` — `loadSchools` auto-retries once after 2s on 5xx before showing error (handles server cold-start transparently)

## 2026-05-12 — AdminPage: secretary fields, layout, label colors

- `backend/routers/schools_router.py` — added `secretary_name` and `secretary_phone` to `SchoolIn` model
- Supabase DB — `ALTER TABLE public.schools ADD COLUMN secretary_name TEXT; ADD COLUMN secretary_phone TEXT` (run via Management API)
- `frontend/src/pages/AdminPage.jsx` — `startEdit` now populates `secretary_name` and `secretary_phone` from school object
- `frontend/src/pages/AdminPage.jsx` — "שלב מוסד" and "יועצים אחראיים" are now side-by-side in a 2-column grid row (instead of separate full-width sections); advisor checkbox list made more compact
- `frontend/src/pages/AdminPage.jsx` — all form label colors changed from `text-slate-500` to `text-slate-800` (darker/near-black)
- `frontend/src/pages/SchoolPage.jsx` — all form label colors changed from `text-slate-500` to `text-slate-800`
- `CLAUDE.md` — added AdminPage Form Sync Rule: must ask user before changing one form without the other

## 2026-05-12 — New school form: address field, 3-col layout, stage default, advisor list on-demand

- Supabase DB — `ALTER TABLE public.schools ADD COLUMN address TEXT` (run via Management API)
- `backend/routers/schools_router.py` — added `address` field to `SchoolIn`
- `frontend/src/pages/AdminPage.jsx` — replaced "הערות" field with "כתובת" (address) in both new and edit forms
- `frontend/src/pages/AdminPage.jsx` — new school form rows 1-2 now use 3-column layout: שם בית ספר | סמל מוסד | שלב מוסד and עיר | רשות מקומית | טלפון בית הספר
- `frontend/src/pages/AdminPage.jsx` — "שלב מוסד" select moved into the main 3-col grid; default option is now "בחר שלב מוסד" (blank/required)
- `frontend/src/pages/AdminPage.jsx` — advisor list for new school now opens only on focus of the search input (not visible by default); selected advisors shown as removable badges below the input

## 2026-05-12 — AdminPage/SchoolPage edit form sync, autocomplete off, schools list hide, symbol uniqueness

- `frontend/src/pages/AdminPage.jsx` — school list hidden while new/edit form is open (no visual clutter below the form)
- `frontend/src/pages/AdminPage.jsx` — all form inputs now have `autoComplete="off"` to prevent browser autofill from a previous school
- `frontend/src/pages/AdminPage.jsx` — added symbol uniqueness validation: cannot save if symbol already exists in the org (shows inline error)
- `frontend/src/pages/SchoolPage.jsx` — edit form now includes all fields matching AdminPage: שם מנהלנית, טלפון מנהלנית (with 05 validation), כתובת; removed הערות; `autoComplete="off"` on all inputs
- `frontend/src/pages/SchoolPage.jsx` — `startEdit` populates all new fields from school object

## 2026-05-12 — Form redesign: centered title, אנשי קשר table, finance_software + address in row 3

- Supabase DB — `ALTER TABLE public.schools ADD COLUMN finance_contact_name TEXT; ADD COLUMN finance_contact_phone TEXT` (run via Management API)
- `backend/routers/schools_router.py` — `SchoolIn` model: added `finance_contact_name`, `finance_contact_phone`
- `frontend/src/pages/AdminPage.jsx` — complete form redesign (new + edit): centered title, right-aligned "פרטי בית הספר" subtitle, 3-col row 2 (עיר|רשות|טלפון), row 3 (יועץ|תוכנת כספים|כתובת for new; תוכנת|כתובת for edit), "אנשי קשר" centered heading + table (מנהל/ת, מנהלנ/ית, אחראי/ת כספים × שם/טלפון) replacing individual contact fields; advisor selector moved to row 3 column 1 in new-school form
- `frontend/src/pages/SchoolPage.jsx` — edit form redesigned to match AdminPage: centered title, "פרטי בית הספר" subtitle, row 1 (שם|סמל), row 2 (עיר|רשות|טלפון), row 3 (תוכנת כספים|כתובת), shared "אנשי קשר" table using CONTACT_ROWS; added `finance_software`, `finance_contact_name`, `finance_contact_phone` to `editForm` and `startEdit`
- `frontend/src/pages/SchoolPage.jsx` — display view updated: school details 3-col grid (טלפון|כתובת|תוכנת כספים), contact section replaced old InfoItem grid with compact 3-col layout showing name + phone per contact row

## 2026-05-12 — AdminPage + SchoolPage: שלב מוסד, גישה field, phone validation, form parity

### DB
- `ALTER TABLE public.schools ADD COLUMN stage TEXT` (run via Management API)
- `ALTER TABLE public.schools ADD COLUMN restrict_access_to JSONB DEFAULT NULL` (run via Management API)

### Backend
- `backend/routers/schools_router.py` — `SchoolIn` model: added `stage`, `restrict_access_to` (list[str] | None)
- `backend/routers/schools_router.py` — `list_schools`: refactored with `_filter_for_advisor()` — null = visible to all, array = only listed IDs + advisor_schools fallback
- `backend/routers/schools_router.py` — `update_school`: explicit null handling for `restrict_access_to` via `model_fields_set`

### Frontend — AdminPage.jsx
- Added `validateSchoolPhone` (9-10 digits only); school_phone field strips non-digits and validates
- Added `AccessSelector` component: "כולם" chip (null) or specific advisor chips; dropdown with search + "כולם" option + individual checkboxes; tooltip explaining the field
- Added `EMPTY_FORM` constant for clean state resets; `stage` and `restrict_access_to` included
- Edit form Row 1: now 3-col (שם | סמל | שלב מוסד) matching new-school form
- Edit school advisors section: 2-col grid — יועצים אחראיים | גישה (AccessSelector)
- Contact table spacing increased to `mt-16`

### Frontend — SchoolPage.jsx
- Added `SCHOOL_STAGE_OPTIONS` and `SCHOOL_STAGE_LABEL` constants
- Edit form Row 1: changed from 2-col to 3-col (שם | סמל | שלב מוסד)
- Added `validateSchoolPhone`; school_phone field: digit-only input, 9-10 digit validation with inline error
- Contact table spacing increased to `mt-16`
- `editForm` and `startEdit` now include `stage` and `restrict_access_to`
- Display view: stage shown as blue badge next to city/authority chips

## 2026-05-12 — SchoolPage/AdminPage: form parity (advisors+access), read-only display, phone validation

### Frontend — SchoolPage.jsx (full rewrite)
- Edit form: added "יועצים אחראיים" + "גישה" 2-col section at bottom (identical to AdminPage edit form); includes `AdvisorSearch` and `AccessSelector` components (copied from AdminPage); advisor add/remove via API; users loaded on mount for owner/manager, on startEdit for others
- Display view: completely redesigned to match edit form layout exactly — same 3-col row 1 (שם|סמל|שלב מוסד), 3-col row 2 (עיר|רשות|טלפון), 2-col row 3 (תוכנת כספים|כתובת), same contact table, same advisors+access section; uses `<input readOnly className="input-field bg-slate-50">` so fields look identical to edit mode
- Phone validation: all 3 contact phone fields (מנהל/ת, מנהלנ/ית, אחראי/ת כספים) now validate 10 digits starting with 05; digit-only onChange on all 3
- `validateContactPhone` function (renamed from `validateSecretaryPhone`)

### Frontend — AdminPage.jsx
- Contact table phone fields: extended digit-only onChange and `validateSecretaryPhone` validation to ALL 3 phone fields (was only `secretary_phone`); `saveSchool` now blocks on invalid `principal_phone` and `finance_contact_phone` as well

## 2026-05-12 — Dashboard: advanced filter panel + table grid lines

- `frontend/src/pages/DashboardPage.jsx` — added "סינון מתקדם" toggle button below search bar; opens a `glass-card` panel with 4 `FilterGroup` columns: שלב מוסד (division types), עיר, רשות מקומית, יועץ מלווה; each group auto-populates from unique values in the live schools data; selecting any checkbox immediately filters the table (combined with text search); badge on button shows active filter count; "נקה סינון" button clears all filters; empty-state button clears both search and filters
- `frontend/src/pages/DashboardPage.jsx` — added subtle grid lines to the table: `border-l border-slate-200` on `<th>` elements, `border-l border-slate-100` on `<td>` elements (last column has no border); `border-b border-slate-200` on thead row and `border-b border-slate-100` on tbody rows

## 2026-05-12 — Dashboard: advanced filter → autocomplete comboboxes, all school fields

- `frontend/src/pages/DashboardPage.jsx` — replaced checkbox filter groups with `FilterField` combobox components: each field is a free-text input that shows matching suggestions as a dropdown as you type; selecting a suggestion adds it as a removable chip; multiple values per field are combined with OR logic
- `frontend/src/pages/DashboardPage.jsx` — filter now covers ALL school detail fields: שם בית ספר, סמל מוסד, שלב מוסד, חטיבות, עיר, רשות מקומית, תוכנת כספים, כתובת, מנהל/ת, מנהלנ/ית, אחראי/ת כספים, יועץ מלווה (12 fields in 4-column grid)
- `frontend/src/pages/DashboardPage.jsx` — added `FILTER_CONFIG` array and `applyFilters` function to drive both UI and logic from a single config; `uniq()` helper auto-derives unique option values from live data with Hebrew label lookups for stage, division, finance_software

## 2026-05-12 — SchoolPage: empty-field borders, borderless display view, label/value typography

- `frontend/src/pages/SchoolPage.jsx` — edit form: all empty inputs/selects (including non-required) now show dashed light-red border; fields with format validation errors (phone, symbol) show solid red border; implemented via `emptyFieldStyle(value, hasError)` helper
- `frontend/src/pages/SchoolPage.jsx` — display view: removed all `<input readOnly className="input-field">` boxes; replaced with `DisplayField` component showing label (10px uppercase gray) + value (14px medium dark) with no border/background
- `frontend/src/pages/SchoolPage.jsx` — display view contact table: replaced readOnly inputs with plain `<span>` text; table row labels now use same uppercase tracking-wide style as DisplayField labels
- `frontend/src/pages/SchoolPage.jsx` — display view advisors/access section: labels now match DisplayField typography (uppercase tracking-wide slate-400); access wrapper div no longer uses `input-field` class

## 2026-05-12 — SchoolPage display view: InfoRow layout, advisors in header

- `frontend/src/pages/SchoolPage.jsx` — display view redesigned: "פרטי מוסד" section now uses a 3-column `InfoRow` grid (label: value inline style); right col: שם/סמל/שלב מוסד; middle col: עיר/בעלות/כתובת (label changed from "רשות מקומית" to "בעלות"); left col: תוכנת כספים/טלפון/גישה
- `frontend/src/pages/SchoolPage.jsx` — advisors badges moved from bottom section to header row, to the right of the edit button (removed separate advisors+access section)
- `frontend/src/pages/SchoolPage.jsx` — added `InfoRow` component for label:value inline display

## 2026-05-12 — AdminPage: Excel import with column mapping

- `frontend/package.json` — added `xlsx` (SheetJS) dependency for client-side Excel parsing
- `frontend/src/pages/AdminPage.jsx` — replaced backend `/schools/import` upload flow with client-side column-mapping wizard:
  1. User clicks "ייבוא מאקסל" and selects an Excel file
  2. SheetJS parses the file in the browser; extracts headers + first data row as preview
  3. `ImportMappingModal` opens: shows all school fields (required: שם/סמל; optional: 12 additional fields) — each has a `<select>` listing every column from the file with the first-row value shown in parentheses for identification
  4. On confirm, iterates all data rows, maps values per user's selection, POSTs to `/schools/` one by one
  5. Progress shown on the import button ("מייבא... X / Y"); final result shows import count + per-row errors
- `frontend/src/pages/AdminPage.jsx` — `normalizeStage` + `normalizeFinanceSoftware` helpers auto-map Hebrew free-text to enum values during import
- Removed old static format-hint text from AdminPage

## 2026-05-13 — SchoolPage: 4-tab layout (פרטי בית הספר, פגישות, בדיקה חדשה, היסטוריה)

- `frontend/src/pages/SchoolPage.jsx` — school details card moved into "פרטי בית הספר" tab; added "פגישות" placeholder tab; existing "בדיקה חדשה" and "היסטוריה" tabs kept
- `frontend/src/pages/SchoolPage.jsx` — school name now shown as `<h1>` page header (always visible above tabs); removed redundant `<h2>` from inside the details card display mode
- `frontend/src/pages/SchoolPage.jsx` — display mode header redesigned: "פרטי מוסד" title + advisors badges + edit button all in one row; default tab changed to "info"

## 2026-05-13 — Contact table: email column

### DB
- יש להוסיף ל-Supabase: `ALTER TABLE public.schools ADD COLUMN principal_email TEXT; ADD COLUMN secretary_email TEXT; ADD COLUMN finance_contact_email TEXT;`

### Backend
- `backend/routers/schools_router.py` — `SchoolIn` model: added `principal_email`, `secretary_email`, `finance_contact_email`

### Frontend
- `frontend/src/pages/SchoolPage.jsx` — `CONTACT_ROWS`: added `emailField` per row; `editForm` + `startEdit` include the 3 email fields; added `validateEmail` function; display table: new "מייל" column showing email or "—"; edit table: new "מייל" column with `<input type="email">` and inline format validation
- `frontend/src/pages/AdminPage.jsx` — `CONTACT_ROWS`: added `emailField` per row; `EMPTY_FORM` + `startEdit` include 3 email fields; school form contact table: added "מייל" column (shared between new and edit forms); `IMPORT_FIELD_CONFIG`: added `principal_email`, `secretary_email`, `finance_contact_email` as optional fields

## 2026-05-13 — Supabase migration + CLAUDE.md overhaul

### DB (executed via Management API)
- `ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS principal_email TEXT` ✓
- `ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS secretary_email TEXT` ✓
- `ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS finance_contact_email TEXT` ✓
- Verified: all 3 columns now confirmed present in Supabase

### Documentation
- `CLAUDE.md` — full overhaul: fixed `.env` path (root, not `backend/.env`); added "Running DB Migrations" section with Management API curl commands; added "PostgREST Query Rules" section documenting the mandatory two-step query pattern; added "Advisor Assignment Rules" section (unlimited assignments per advisor, no filter on dropdown); added `POST /schools/import` and `POST /contact/send` to API endpoint list; added `contact_router.py` to project structure; added Development Rule #7 (field sync checklist)
- `backend/routers/auth_router.py` — נמחק (קובץ מת מה-MVP, לא מיובא ב-main.py)

## 2026-05-13 — Dashboard: advanced filter fixes

- `frontend/src/pages/DashboardPage.jsx` — הוסר placeholder "הקלד לחיפוש..." מכל שדות הסינון המתקדם
- `frontend/src/pages/DashboardPage.jsx` — סינון חי: הקלדה בכל שדה מסננת את הטבלה מיידית גם ללא בחירה מהרשימה (partial match על הטקסט); עבור שדות enum (שלב מוסד, תוכנת כספים, חטיבות) — match גם מול תווית עברית
- `frontend/src/pages/DashboardPage.jsx` — `FilterField`: הרשימה נפתחת רק בעת הקלדה (לא בלחיצה) — למעט שדה "יועץ מלווה" שנפתח בלחיצה (`openOnFocus` prop)
- `frontend/src/pages/DashboardPage.jsx` — `queries` state חדש (מקביל ל-`filters`); `applyFilters` מקבל `queries`; `activeFilterCount` סופר גם queries פעילים; "נקה סינון" מנקה גם queries

## 2026-05-13 — SchoolPage: לשונית "יעדים"

- `frontend/src/pages/SchoolPage.jsx` — נוספה לשונית "יעדים" בין "פגישות" לבין "בדיקה חדשה"; placeholder עם אייקון 🎯 ו"תכונה זו תהיה זמינה בקרוב"

## 2026-05-13 — SchoolPage + AdminPage: שדה מחוז, עיצוב מחדש של אזורי "אנשי קשר" ו"ליווי"

### DB
- `ALTER TABLE public.schools ADD COLUMN district TEXT` (run via Management API)

### Backend
- `backend/routers/schools_router.py` — `SchoolIn` model: added `district: str | None = None`

### Frontend — SchoolPage.jsx
- **Display mode:**
  - עמודה אמצעית שורה 3: שונה מ"כתובת" ל"מחוז" (value=`school.district`)
  - עמודה שמאלית שורה 3: שונה מ"גישה" ל"כתובת" (value=`school.address`)
  - כותרת "אנשי קשר": שונתה מ-`text-center` ל-`text-right`
  - Badge של יועצים הוסרו מ-header (מופיעים כעת באזור "ליווי" בלבד)
  - נוסף אזור "ליווי" מתחת לטבלת אנשי קשר עם שני שדות: "יועץ מלווה" (badges יועצים) ו"גישה" (כולם / רשימה מוגבלת)
- **Edit mode:**
  - שורה 2 (3-col): שונה לעיר | רשות | מחוז (טלפון הועבר לשורה 3)
  - שורה 3 (3-col): תוכנת כספים | טלפון | כתובת
  - כותרת "אנשי קשר": הוסרה `text-center`
  - כותרת "ליווי" נוספה מעל אזור יועצים+גישה
- `editForm` + `startEdit` כוללים `district`

### Frontend — AdminPage.jsx
- `EMPTY_FORM`: נוסף `district: ""`
- `startEdit`: מאכלס `district: school.district || ""`
- `IMPORT_FIELD_CONFIG`: נוסף `{ key: "district", label: "מחוז", required: false }`
- שורה 2 בטופס: שונתה מ-3-col (עיר|רשות|טלפון) ל-4-col (עיר|רשות|מחוז|טלפון)
- כותרת "אנשי קשר": הוסרה `text-center`
- כותרת "ליווי" נוספה מעל אזור יועצים+גישה בעריכת בית ספר

## 2026-05-13 — SchoolPage edit form: תיקון סדר שדות מחוז/טלפון + dropdown מחוזות

- `SchoolPage.jsx` edit mode: שורה 2 שונתה ל-עיר|רשות|**טלפון** ושורה 3 ל-תוכנת|**מחוז**|כתובת — כעת תואם לתצוגה (בעלות+טלפון באותה שורה, מחוז+כתובת באותה שורה)
- `SchoolPage.jsx` + `AdminPage.jsx`: שדה מחוז שונה מ-`<input>` ל-`<select>` עם 6 מחוזות: צפון, דרום, מרכז, ירושלים, תל-אביב, חיפה
- נוסף קבוע `DISTRICT_OPTIONS` לשני הקבצים
- `IMPORT_FIELD_CONFIG`: נוסף `hint` לשדה מחוז עם רשימת המחוזות התקינים
- נוספה פונקציית `normalizeDistrict` שממפה טקסט חופשי מהאקסל (כולל וריאציות כמו "ת\"א") למחוז הקנוני
- `confirmImport`: מחוז מנורמל דרך `normalizeDistrict` (במקום לקחת raw text)

## 2026-05-13 — Dashboard: סדר עמודות ניתן לשינוי

- `DashboardPage.jsx` — עמודת "שם מוסד" קבועה תמיד ראשונה (מימין); שאר 5 העמודות ניתנות להזזה
- `DashboardPage.jsx` — `MOVABLE_COLUMNS` + `DEFAULT_COL_ORDER`: הגדרת העמודות הניתנות להזזה
- `DashboardPage.jsx` — `colOrder` state: מאותחל מ-localStorage; מתעדכן בכל החלפה ונשמר בין טעינות
- `DashboardPage.jsx` — `moveCol(index, dir)`: מחליף עמודה בעמודה השכנה; שומר ב-localStorage
- `DashboardPage.jsx` — גרירה: `draggable` על כל th ניתן להזזה; `onDragStart/Over/Drop/End` מטפלים בהחלפה; `dragIndex` + `dragOverIndex` state לפידבק ויזואלי (עמודה גרורה — opacity 30%; עמודת יעד — רקע כחול + קו תחתי כחול)
- `DashboardPage.jsx` — `renderCell(school, key)`: פונקציית render שמרנדרת תא לפי מפתח עמודה; הנתונים ב-Supabase לא מושפעים כלל
## 2026-05-13 — Dashboard: בחירת עמודות להצגה + localStorage per-user

- `DashboardPage.jsx` — כפתור 'עמודות להצגה' ליד 'סינון מתקדם': פותח dropdown עם משבצות לכל עמודה ניתנת לשינוי; סימון/ביטול מציג/מסתיר עמודה מיידית
- `DashboardPage.jsx` — `colVisible` state: מיפוי key→boolean לכל עמודה; `visibleColOrder` = colOrder מסונן לפי colVisible
- `DashboardPage.jsx` — localStorage per-user: מפתח `dashboard-col-order-{userId}` ו-`dashboard-col-visible-{userId}`; כל חשבון שומר הגדרות עצמאיות (גם על אותו דפדפן)
- `DashboardPage.jsx` — badge על הכפתור מציג כמה עמודות מוסתרות; click-outside סוגר את הdropdown

## 2026-05-13 — העדפות עמודות פר משתמש (Supabase)
- הוספת עמודות col_order ו-col_visible לטבלת profiles ב-Supabase
- הוספת RLS policy לעדכון עצמי של פרופיל (users_update_own_profile)
- עדכון DashboardPage: טעינת סדר עמודות מ-Supabase בהתחברות (cross-device), שמירה חוזרת ב-Supabase בכל שינוי
- localStorage נשמר כ-cache מהיר; Supabase הוא מקור האמת

## 2026-05-13 — ייצוא אקסל דינמי מרשימת בתי הספר
- הוספת כפתור 'הורד כאקסל' מתחת לטבלת בתי הספר ב-DashboardPage
- הקובץ מכיל רק את בתי הספר המסוננים ורק את העמודות המוצגות (לפי סדר הגרירה הנוכחי)
- כותרות ותאים בעברית; עמודת 'שם מוסד' תמיד ראשונה

## 2026-05-13 — תפריט 3 נקודות + מצב סימון ומחיקה ב-Dashboard
- הוספת תפריט 3 נקודות בצד שמאל של שורת הסינון (DashboardPage)
- כפתור 'הורד לאקסל' עבר לתפריט (הוסר מתחתית הטבלה)
- אפשרות 'סמן בית ספר' בתפריט — גלויה לבעלים בלבד (ומנהל שהבעלים האציל לו הרשאות)
- במצב סימון: checkbox לצד כל שורה, שורה נבחרת מוצגת בכחול בהיר, אייקון פח בשורות שנבחרו
- לחיצה על הפח פותחת DeleteConfirmModal זהה ל-AdminPage
- Backend: /users/me מחזיר managers_can_delete (true לבעלים; למנהל — אם יש בעלים שהציל הרשאות)

## 2026-05-13 — עריכת בית ספר ב-SchoolPage ללא שינוי תצוגה
- מצב עריכה ב-SchoolPage עוצב מחדש כך שנראה זהה לחלוטין למצב תצוגה
- הוספת EditInfoRow ו-editFieldCls: הערכים הופכים ל-input/select עם border רגיל במקום טקסט
- טבלת אנשי קשר: אותו מבנה, תאים הופכים ל-inputs
- חלק הליווי: אותו מבנה עם AdvisorSearch ו-AccessSelector
- כפתורי שמור/ביטול מוצגים ב-header במקום כפתור 'ערוך פרטים'

## 2026-05-13 — SchoolPage: 9-point UX improvements

### DB Migration
- `ALTER TABLE public.schools ADD COLUMN extra_contacts JSONB DEFAULT '[]'` — תמיכה בשורות איש קשר נוספות

### Backend
- `schools_router.py` — הוספת `extra_contacts: list[dict] | None = None` ל-`SchoolIn`

### Frontend (SchoolPage.jsx)
1. **יישור אנכי (display + edit)** — כל עמודה מוגדרת כ-CSS grid עם `gridTemplateColumns: max-content 1fr`, הערכים מיושרים באותו קו
2. **תיבות שוות (edit)** — אותה גישת grid בעריכה, כל תיבת קלט מתחילה באותו קו
3. **חלונית שינויים לא נשמרו** — `useBlocker` מ-react-router-dom, מופיע בניווט מהעמוד עם שינויים לא שמורים (שמור/אל תשמור/ביטול)
4. **סמל מוסד מיושר לימין** — הוסרת `dir="ltr"` מהתצוגה והעריכה של סמל מוסד
5. **כותרת "תפקיד"** — הוספה לעמודה הראשונה בטבלת אנשי קשר (display + edit)
6. **ללא placeholder** — הוסרו כל טקסטי placeholder מתיבות אנשי קשר בעריכה
7. **הוסף איש קשר** — כפתור מתחת לשורת אחראי/ת כספים, עד 3 שורות נוספות עם שדה תפקיד ידני + כפתור מחיקה לכל שורה; נשמר ב-`extra_contacts JSONB`
8. **tooltip גישה** — החלפת `title` native בקומפוננט `QuestionTooltip` עם רקע צהוב בננה (#FEF08A) ומסגרת זהב
9. **גבול אדום לשדות ריקים** — border אדום (#fca5a5) על כל ערך ריק בתצוגה (שדות מוסד + טבלת אנשי קשר)

## 2026-05-13 — Fix: useBlocker + migrate to createBrowserRouter

- `App.jsx` — הועבר מ-`BrowserRouter` ל-`createBrowserRouter` + `RouterProvider` כדי לתמוך ב-`useBlocker`
- נוסף `SessionContext` לניהול session בין הנתיבים (PrivateRoute/AdminRoute קוראים מ-context במקום props)

## 2026-05-13 — SchoolPage: תיקוני UX נוספים

- `SchoolPage.jsx` — `UnsavedChangesModal`: כפתורים אופקיים (שמור שינויים / ביטול / אל תשמור), כותרת "נא לשים לב!", ירוק לשמירה + ghost לאחרים
- `SchoolPage.jsx` — tooltip גישה: טקסט עודכן ל-"בחר למי תהיה גישה לנתוני בית הספר.", סמל ? הועבר לימין של כיתוב "גישה:" (RTL — מוצב לפני הטקסט ב-HTML)
- `SchoolPage.jsx` — `editFieldCls` מקבל פרמטר שני `isEmpty`: שדות ריקים בעריכה מקבלים `border-red-300` (לא נעלמים כשנמחק ערך)
- `SchoolPage.jsx` — טלפון בית הספר: `dir` מוגדר רק כאשר יש ערך (`dir={value ? "ltr" : undefined}`) — "—" מיושר לימין
- `SchoolPage.jsx` — טבלת אנשי קשר display mode: `table-fixed` + `w-1/4` לכל 4 עמודות — סימטריה זהה לעריכה
- `SchoolPage.jsx` — `saveEdit`: מציג שגיאת שרת ב-UI במקום לבלוע את הException; `setSaveError` + `console.error`
- `SchoolPage.jsx` — `AccessSelector`: מסנן בעלים מהרשימה (`nonOwnerUsers = users.filter(u => u.role !== "owner")`); גם pills בתצוגה מסננים IDs של בעלים

## 2026-05-13 — Fix: יועצים לא מתעדכנים מיידית אחרי שמירה

- `SchoolPage.jsx` — `saveEdit`: לאחר שמירה מוצלחת מעדכן גם `school.advisor_schools` מהמצב הנוכחי של `schoolAdvisors`; `displayAdvisors` (שמחושב מ-`school.advisor_schools`) מתעדכן מיידית ללא צורך בניווט חוזר

## 2026-05-13 — SchoolPage: שיפורי ליווי בעריכה

- `SchoolPage.jsx` — `AdvisorSearch` שונה ל-tag-input: הפיצולים (pills) של יועצים מוצגים בתוך קופסת ה-input-field (ולא מעליה), כולל כפתור × לכל יועץ; הקלט נמצא אינליין בתוך הקופסה — עיצוב סימטרי לחלוטין עם `AccessSelector`
- `SchoolPage.jsx` — `AccessSelector`: נוספה אפשרות "היועצים המלווים שנבחרו" בין "כולם" לבין הרשימה האישית; לחיצה עליה בוחרת אוטומטית את כל היועצים המשויכים לבית הספר

## 2026-05-13 — לשונית פגישות מלאה

### DB
- `CREATE TABLE public.meetings` — id, school_id (FK), meeting_date, status, start_time, end_time, advisor_id (FK→profiles), participants JSONB, meeting_type, actual_duration, notes, reminder_enabled, reminder_sent, created_by, created_at
- RLS policy: meetings_service_all (service role בקאנד)

### Backend
- `schools_router.py` — נוסף `MeetingIn` model
- `schools_router.py` — נוספו endpoints: `GET /schools/{id}/meetings`, `POST /schools/{id}/meetings`, `PUT /schools/{id}/meetings/{mid}`, `DELETE /schools/{id}/meetings/{mid}`

### Frontend (SchoolPage.jsx)
- לשונית "פגישות" — לוח פגישות מלא עם עריכה אינליין; שורה חדשה נפתחת ראשונה; כפתורי "הוסף פגישה" + "אוטומציות" מעל
- עמודות: תאריך (DatePickerPopover — לוח שנה לפי חודשים), סטטוס (נקבעה/בוצעה/בוטלה/נדחתה/אחר), שעת התחלה/סיום (TimeInput ספרות בלבד), יועץ מבצע (dropdown — ברירת מחדל יועץ ראשון של ביה"ס), משתתפים (ParticipantsSelector — רשימה מרשימת אנשי הקשר של ביה"ס), פיזי/מרחוק, זמן ביצוע, הערות (NotesModal), תזכורת (ON/OFF toggle — שמירה ב-DB, שליחה בשלב הבא)
- `AccessGrantModal` — כשיועץ מבצע שנבחר אין לו גישה: owner/manager יכולים לפתוח גישה מיד; advisor שולח בקשה דרך update-requests
- `MeetingRowEdit` / `MeetingRowDisplay` / `MeetingsTable` — קומפוננטות מובנות
- טעינה lazy: פגישות נטענות רק בלחיצה על לשונית "פגישות"

## 2026-05-13 — Fix: לוח פגישות — 4 תיקוני UX
- `SchoolPage.jsx` — `MeetingRowEdit`: הוסף try/catch ב-`handleSave` עם הצגת שגיאה ב-UI + `console.error`; כפתור "שמור" מציג "שומר..."
- `SchoolPage.jsx` — `TimeInput`: פורמט אוטומטי ב-onBlur — "5"→"05:00", "616"→"06:16", "1430"→"14:30"; Enter מפעיל blur; מאפשר הקלדת ":"
- `SchoolPage.jsx` — `MeetingsTable`: מסגרת מלאה (`border border-slate-200 min-h-[320px] flex flex-col`) — הגבול מוצג מהכותרת ועד הסוף
- `SchoolPage.jsx` — `MeetingsTable`: כותרות עמודות מלאות בעברית עם `minWidth` מפורש לכל עמודה; טבלה ב-`width: max-content` עם גלילה אופקית
