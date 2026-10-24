# Dev Log

## 2026-10-23 — מנהל לא יכול לראות/לערוך הרשאות בהתאמה אישית של עצמו; הרשאה חדשה "עריכת הרשאות מנהלים אחרים"
- `backend/routers/schools_router.py`: הרשאה חדשה `can_manage_manager_permissions` (ברירת מחדל: כבוי) — נשלטת רק ע"י הבעלים בטאב "הרשאות" (עמודת "מנהל", מוצגת לבעלים בלבד)
- `GET /permissions/overrides/{user_id}` ו-`PUT /permissions/overrides/{user_id}`: מנהל חסום לגמרי מצפייה/עריכה של ההרשאות בהתאמה אישית **של עצמו** (403); צפייה/עריכה של הרשאות **מנהל אחר** דורשות עכשיו את ההרשאה החדשה (לא עוד hardcoded "יועצים בלבד")
- `GET /permissions/overrides/counts`: המספר (badge) שעל כפתור ה-"+" מוסתר מהמנהל עבור השורה של עצמו
- `GET /users/me`: נוסף `can_manage_manager_permissions` לתוצאה האפקטיבית
- `frontend/src/pages/AdminPage.jsx`: כפתור ה-"+" בעמודת "הרשאות בהתאמה אישית" מוסתר לגמרי עבור מנהל על השורה של עצמו, ומוסתר על שורות של מנהלים אחרים כל עוד אין לו את ההרשאה החדשה; ההרשאה נוספה לקבוצת "משתמשים" בטאב "הרשאות"
- `npx vite build` עבר בהצלחה (0 שגיאות)

## 2026-10-23 — אימות דו-שלבי (TOTP) אופציונלי
- מיגרציה: עמודה `profiles.mfa_enabled`; טבלה חדשה `trusted_devices` (service_role בלבד, RLS מופעל, deny-all ל-anon/authenticated)
- `backend/auth.py`: אכיפת AAL2 (או טוקן "מכשיר מהימן" תקף) ב-`get_current_user` עבור משתמשים עם `mfa_enabled=true`; fail-closed
- `backend/routers/schools_router.py`: endpoints חדשים — `POST /users/me/mfa/confirm`, `POST /users/me/mfa/disable`, `POST /users/me/mfa/trust-device`, `POST /users/{id}/mfa/reset` (owner בלבד, לאיפוס לאחר איבוד טלפון)
- `frontend`: טאב "אבטחה" חדש באזור אישי (`PersonalSecurityTab.jsx`) עם הפעלה/כיבוי + מודאל הרשמה (QR, הדרכה שלב-אחר-שלב); מסך אתגר MFA ב-`LoginPage.jsx` עם "זכור מכשיר ל-30 יום"; כפתור "אפס אימות דו-שלבי" בתפריט הפעולות של כל משתמש ב-`AdminPage.jsx` (owner בלבד)
- ביקורת עצמית ותיקונים: מניעת מצב נעילה אם מחיקת ה-factors ב-Supabase נכשלת חלקית (סדר פעולות הפוך — כיבוי הדגל ב-DB קודם, מחיקת factors אחר כך); תיקון דליפת factor לא-מאומת כש-Escape סוגר את מודאל ההרשמה; תיקון מרוץ טוקן ב"זכור מכשיר זה" בכניסה (היה עלול לגרום ללופ של בקשת קוד חוזרת)

## 2026-10-23 — תיקון: קישור "יצירת קשר" שגוי בעמוד העלאת קבצים שפג תוקפו
- `frontend/src/pages/MeetingUploadPage.jsx`: הוסר קישור "יצירת קשר" שהופיע כשלינק העלאת קבצים לא תקין/פג תוקף — הוא הפנה לעמוד "צור קשר" הכללי (מיועד לתקלות טכניות) במקום ליועץ/ת המטפל/ת בבית הספר

## 2026-10-23 — תיקוני אבטחה (5 תיקונים עצמאיים)
- `backend/auth.py`: הוספת בדיקת `issuer` לאימות ה-JWT (`{SUPABASE_URL}/auth/v1`) — **דורש בדיקת התחברות חיה לפני אישור**, שגיאה בפורמט ה-issuer עלולה לחסום את כל המשתמשים
- `backend/auth.py`: הוסרה דליפת תחילית הטוקן ללוג (`JWT rejected — expired`) — נבדק שאין עוד מקומות שחולצים חלק מהטוקן ללוג
- `backend/main.py`: רמת לוג ברירת מחדל שונתה מ-DEBUG ל-INFO, קריאה מ-`LOG_LEVEL` (ללא שינוי קונפיגורציה נדרש בפריסות קיימות)
- `backend/routers/contact_router.py` ו-`backend/routers/signup_router.py`: הגנה מפני הזרקת כותרות מייל — אימות פורמט מייל (`EmailStr`/validator) + הסרת `\r`/`\n` מכל שדה שמוכנס לכותרת מייל (`To`/`Subject`) או לקישור `mailto:`; נוסף `email-validator` ל-`requirements.txt`
- `backend/users.json`: הוסר ממעקב git (`git rm --cached`, הקובץ נשאר בדיסק); נוספו `backend/users.json`, `backend/consents.json`, `backend/tickets.json` ל-`.gitignore` (לא בוצע commit/push — ממתין לאישור המשתמש)

## 2026-10-23 — תיקון באג + שיפור הדרכת אימות דו-שלבי
- `frontend/src/App.jsx`: תוקן לופ רענון אינסופי — `registerDeviceSession()` (רץ על כל טעינה, כולל `/login`) היה נורה לפני השלמת שלב ה-MFA ונכשל ב-401, מה שגרם לרענון מלא שחוזר על עצמו; עכשיו נבדק מול ה-AAL בפועל לפני הקריאה
- `frontend/src/main.jsx`: הגנת-משנה נוספת — לא מבצעים רענון דף חוזר אם כבר נמצאים ב-`/login`
- `frontend/src/pages/LoginPage.jsx`: "זכור מכשיר זה ל-30 יום" כברירת מחדל **לא מסומן** (דרוש סימון ידני ומודע)
- `frontend/src/components/PersonalSecurityTab.jsx`: שודרגה ההדרכה להגדרת אימות דו-שלבי עם 4 צילומי מסך אמיתיים (התקנה, פתיחה, הוספת קוד, סריקת QR), לפי שם האפליקציה בפועל ("מאמת החשבונות של Google")

## 2026-10-23 — תיקוני אבטחה: חסימת גישה חוצת-ארגון (cross-org) לפגישות ושיחות
- `backend/routers/meeting_summary_router.py`: נוספה פונקציית עזר `_require_meeting_access` (עוטפת את `schools_router._require_school_access_for_meeting_activity`) ושימוש בה ב-`get_summary_status`, `upload_summary_recording` ו-`retry_summary` — קודם לא נבדק ששייך לארגון/לליווי של המשתמש; ב-`retry_summary` הבדיקה מתבצעת לפני הורדת ההקלטה השמורה מה-Storage
- `backend/routers/meeting_upload_router.py`: אותה פונקציית עזר (`_require_meeting_access`) ושימוש בה ב-`get_upload_comparison`, `get_uploaded_files`, `download_uploaded_file` (לפני הורדת הקובץ) ו-`request_missing_files` (לפני שליחת המייל) — קודם לא נבדק שהפגישה שייכת לארגון/לליווי של המשתמש
- `backend/routers/calls_router.py`: `link_call_school` — נוספה בדיקה ש-`school_id` שייך לארגון המשתמש, וגם הגנה מפני "חטיפת" שיחה שכבר מקושרת לבית ספר של ארגון אחר; `exclude_call_from_school` — תוקן פער שבו ענף owner/manager לא בדק כלל ש-`school_id` שייך לארגון המשתמש (רק ענף היועץ בדק)
- כל שלושת הקבצים עברו `py_compile` בהצלחה

## 2026-10-23/24 — ביקורת אבטחה מקיפה (OWASP Top 10:2025) — חסימת IDOR חוצה-ארגון בכל המערכת
רקע: ביקורת מלאה העלתה שהבקאנד (service_role, מדלג על RLS) מכיל ~65 נקודות קצה שבדקו תפקיד משתמש אך לא שהמשאב הספציפי שייך לארגון שלו — מאפשר קריאה/כתיבה חוצת-ארגון בידיעת/ניחוש UUID. תוקנו כולן, בשלושה סבבים:

**`backend/routers/schools_router.py`** — נוסף `_require_school_in_org` (עוזר מרכזי חדש) ו-`_user_in_org`-style בדיקות; יושם ב-~45 נקודות קצה: `list/create/update/delete_account`, `get/upsert/bulk_upsert_year_admin_data`, `upload/download_contract_file`, `set_goal_status`, `list/set_gefen_closures`, `get/set_incentive_model`, `list/assign/unassign_advisors` (כולל typed/bulk/temp-access/advisor-access-matrix — נוסף גם role-check שחסר כליל), `batch_get/create/edit/delete_partial_updates`, `get/create/edit/delete_school_notes` (+quarterly summary), `get/upload/edit/delete/download_school_files`, `preview_meeting_subject`, `check_blocked_date`, `gefen_organized_check`, `send_status_reminder`, `get_meeting_reminder_status`, `create/update/patch_meeting`, `join_meeting_as_advisor`, `reassign_meeting_school`, `get/create_meeting_notes`, קבוצת `/users/{user_id}/...` (future-meetings/transfer/cancel/sole-schools), `get/set_user_overrides`, `get_override_counts`, `list/get/delete_logs`, `update_log_name/pin`. בנוסף: **`list_goals` ו-`list_meetings` תוקנו בנפרד** (לא נתפסו בסבב הראשון — התגלו רק ע"י חבילת הבדיקות האוטומטית, ראו למטה) + תוקן באג נלווה: `except HTTPException: raise` חסר שגרם לכך ש-404/403 "נבלעו" והוצגו כ-503 מטעה.
- `backend/routers/analyze_router.py` — נוספו `_check_school_access`/`_require_run_access`; יושם ב-`result/download/pdf/add-file/run-check-from-uploads/compare-plans/classify/retry-finance/download-tikhnun(-pdf)/download-combined(-pdf/excel)/source-file`. בנוסף: **path traversal** בשם קובץ מועלה תוקן (`Path(...).name` בכל אתר העלאה), **הגבלת גודל קובץ 50MB** נוספה, והדלפת טקסט חריגה פנימי ללקוח (`str(exc)`) הוחלפה בהודעה כללית + לוג שרת.
- `backend/routers/calendar_router.py` / `backend/graph_client.py` — `advisor_ids` בפגישות (owner/manager branch) לא סונן לפי org; `_resolve_advisor_email` לא סינן org_id בכלל — שניהם תוקנו. **נוסף חסם מבני**: לא ניתן עוד לחבר שני ארגונים לאותו Microsoft 365 tenant (`calendar_router.py` callback) — מונע תרחיש אפשרי של "דליפת" אירועי יומן בין ארגונים דרך תיבת דואר משותפת; נוספה הודעת שגיאה בעברית ב-`AdminIntegrationsTab.jsx`.
- Supabase: הוספת `GRANT` ל-`authenticated` על `schools`/`gefen_accounts`/`check_logs` — תואם פוליסות RLS קיימות ונכונות שלא היה להן GRANT (הגנת-עומק, ללא שינוי התנהגות — הבקאנד עדיין service_role).
- `frontend/package.json`: שדרוג `xlsx` (SheetJS) מ-0.18.5 הפגיע ל-0.20.3 (מ-CDN הרשמי) — ללא שינוי קוד נדרש.
- **חבילת בדיקות אוטומטית חדשה**: `backend/tests/security/` (`conftest.py` + `test_idor_cross_org.py` + `test_idor_cross_org_extended.py`) — 102 בדיקות IDOR/רגרסיה מול שני ארגונים אמיתיים, ללא צורך בהתחברות אמיתית (dependency override על `get_current_user`). תפסה בפועל 2 פרצות נוספות (`list_goals`, `list_meetings`) ובאג פונקציונלי (`link_call_school` שבור לכל ארגון בגלל constraint חסר ב-DB — נוסף `calls_call_school_links_org_call_school_key UNIQUE(org_id, call_id, school_id)`).
- `CLAUDE.md`: נוסף סעיף "Cross-Org Security Test Suite (MANDATORY)" + "Recurring security cadence" — חובה להריץ את הבדיקות בכל שינוי רלוונטי ולפני כל פריסה, ולוח זמנים קבוע לבדיקות תלויות/ביקורת מלאה.

## 2026-10-24 — Supply Chain (A03:2025) ו-Security Headers (A02:2025)
- `backend/requirements.txt`: שדרוג `python-multipart` (0.0.9→0.0.31+, מספר CVE כולל ReDoS), `python-dotenv` (1.0.1→1.2.2+), ו-**FastAPI 0.111.0→0.133.0** (מעלה את starlette 0.37.2→1.10.0, מתקן ~15 CVE מצטברים) — נבדק לעומק (release notes, pydantic ללא שינוי, אין breaking changes ב-dependency_overrides/HTTPException/middleware), `pip-audit` מציג **0 פגיעויות ידועות**.
- `frontend/package.json`/`package-lock.json`: `npm audit fix` פתר את כל 10 הפגיעויות (כולל 1 קריטית — `dompurify`) ללא שינוי קוד; `npm audit` מציג **0 פגיעויות**.
- `backend/main.py`: נוסף middleware עם headers אבטחה פסיביים לכל תשובה (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`) — גם ב-exception handler הגלובלי (שרץ מחוץ ל-middleware stack הרגיל).
- Render Static Site (frontend, `gefen-ksafim`) — נוספו אותם 4 headers דרך ממשק ה-Headers של Render ישירות (לא קובץ בקוד).

## 2026-10-24 — Mishandling of Exceptional Conditions (A10:2025)
- סריקה שיטתית מלאה של כל לולאות ה-retry בכל הראוטרים לאיתור מופעים נוספים של באג ה-`except HTTPException` החסר — **לא נמצאו מופעים נוספים** (הסריקה הראשונית כבר הייתה ממצה).
- `backend/routers/schools_router.py` (`get_me`): תוקן fail-open לא-עקבי — `can_view_school_card`/`can_request_school_update` חזרו `True` ללא-תנאי בכשל, במקום ליפול לאותה שכבת ברירת-מחדל (`PERMISSION_DEFAULTS`) שמשמשת בכל שאר הדגלים.
- **6 מופעי `.single()` מסוכנים תוקנו** (גורמים לשגיאת `PGRST116`→503 מטעה במקום 404/403 כש-0 שורות תואמות — מצב לגיטימי בבדיקת גישה חוצת-ארגון, לא שגיאה): `update_meeting`, `patch_meeting`, `join_meeting_as_advisor` (schools_router.py), `add_file_to_check`, `compare_plans`, `download_log_source_file` (analyze_router.py) — וכן `check_blocked_date` שתוקן מוקדם יותר באותו יום.
- **באג אמיתי שהתגלה בבדיקה ידנית בדפדפן (לא IDOR):** `_get_run`/`_update_run` ב-`analyze_router.py` — (1) `_get_run` לא עקב אחר דפוס ה-retry הסטנדרטי של הפרויקט, כל תקלה חולפת בחיבור ל-Supabase הוצגה כ"הריצה לא נמצאה" (404 מטעה); (2) `_update_run` מחליף את כל עמודת `result` בכל קריאה (לא ממזג) — כ-15 נקודות קריאה בתוך `_process()` (ענפי שגיאה, ה-exception handler הכללי) לא כללו `_school_ctx`, ומחקו אותו באמצע עיבוד, מה שגרם לבדיקת ההרשאה בסקירה הבאה להיכשל עם 404. תוקן בשורש: `_update_run` משמר אוטומטית `_school_ctx` קיים אלא אם נדרס במפורש — מתקן את כל נקודות הקריאה בבת אחת.
- חבילת הבדיקות הורחבה במקביל ל-102 בדיקות (מ-23), מכסה כמעט את כל ~65 נקודות הקצה שתוקנו.
