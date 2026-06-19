# Dev Log

## 2026-06-19 — Security: תיקון Tenant Isolation Breach ב-schools_router.py

**שורש הבעיה:** כל קוד ה-multi-tenant קיים רק כשינויים מקומיים לא-מחוייבים. פרודקשן (main) רץ עם קוד ישן ללא סינון org_id. תיקון: תיקון כל חורי האבטחה + deploy.

### תיקונים ב-`backend/routers/schools_router.py`:
- `update_role` (PATCH /users/{id}/role): הוספת אימות org_id על המשתמש המטרה לפני UPDATE; הוספת retry loop (חוק ברזל #5)
- `update_user_profile` (PATCH /users/{id}): אותו תיקון
- `delete_user` (DELETE /users/{id}): אותו תיקון — מאמת שהמשתמש שייך לאותו ארגון לפני מחיקה
- `list_update_requests` (GET /update-requests): מנהל/בעלים מסננים בקשות דרך `school_ids` של הארגון בלבד; הוספת retry loop (חוק ברזל #5)
- `get_notifications`: סינון pending update requests לפי `school_ids` של הארגון בלבד
- `delete_log`: שאילתת ה-summary משתמשת ב-`.eq("school_id", school_id)` — לא ניתן לקרוא לוג של ארגון אחר לפי id

## 2026-06-19 — Fix: get_me endpoint — retry loop for org and managers_can_delete queries

- `schools_router.py`: תיקון `get_me` — הוספת retry loop (חוק ברזל #5) לכל שתי שאילתות ה-DB: `managers_can_delete` (למנהל) ו-`org` (שם הארגון לסיידבר); קודם `db = get_admin_client()` היה מחוץ ל-loop וכשל בשקט


## 2026-06-19 — SuperAdmin: עדכון ימי ניסיון לארגון

- `signup_router.py`: endpoint חדש `PATCH /signup/orgs/{org_id}/trial` — מקבל `trial_days`, מחשב `trial_ends_at = now + N days`, מעדכן בטבלת `organizations` ומחזיר את התאריך החדש
- `signup_router.py`: `list_requests` מועשר עם `org_subscription_status` ו-`org_trial_ends_at` מטבלת `organizations` (non-fatal)
- `SuperAdminPage.jsx`: הוספת `EditTrialModal` — מציג תוקף נוכחי + כמה ימים נותרו, שדה להזנת ימים חדשים מהיום
- `SuperAdminPage.jsx`: כפתור "עדכן ימי ניסיון" לכרטיסי ארגונים אושרו עם `org_id`
- `SuperAdminPage.jsx`: הצגת תאריך תפוגת ניסיון ומספר ימים שנותרו (או "מנוי פעיל ✓") בכרטיס

## 2026-06-19 — Sidebar: הצגת שם הארגון מתחת לשם המשתמש

- `Sidebar.jsx`: הוספת state `orgName`, קריאת `res.data.org?.name` מה-API, הצגת `[תפקיד], [שם הארגון]` בתיבת המשתמש


## 2026-06-19 — הוספת אנשי קשר נוספים בטופס יצירת בית ספר

- `AdminPage.jsx`: הוספת `extra_contacts: []` ל-`EMPTY_FORM` ול-`startEdit` — מוצג ונשמר גם בטופס יצירה חדשה
- `AdminPage.jsx`: שורות extra contacts בטבלת אנשי קשר — שדות תפקיד|שם|טלפון|מייל + כפתור הסרה (×)
- `AdminPage.jsx`: כפתור "+ הוסף איש קשר" מתחת לטבלה (עד 3 שורות נוספות), זהה להתנהגות בעריכת בית ספר

## 2026-06-19 — מיון רשימות משתמשים לפי תפקיד

- `AdminPage.jsx` + `SchoolPage.jsx`: הוספת `ROLE_SORT_ORDER` ו-`sortByRole()` — כל הרשימות הנפתחות (AdvisorSearch, AccessSelector, בוחר יועצים) מוצגות לפי סדר: בעלים → מנהל → יועץ

## 2026-06-19 — תיקון פריסת טופס, קישור דינמי גישה↔יועצים

- `AdminPage.jsx`: טופס "פרטי בית הספר" עבר מ-3 שורות אופקיות ל-3 עמודות אנכיות label:field — זהה למבנה עריכה ב-SchoolPage.jsx
- `AdminPage.jsx` + `SchoolPage.jsx`: גישה "היועצים המלווים שנבחרו" הפכה דינמית — `accessLinkedToAdvisors` state מסנכרן restrict_access_to עם רשימת היועצים הנוכחית בזמן אמת, גם בהוספה וגם בעריכה

## 2026-06-19 — חלונית אזהרה על שינויים שלא נשמרו בעמוד הניהול

- `AdminPage.jsx`: הוספת `useBlocker` מ-react-router-dom — מיירט ניווט לעמוד אחר כשיש שינויים פתוחים
- `AdminPage.jsx`: הוספת `UnsavedChangesModal` — חלונית עם 3 כפתורים: שמור שינויים / אל תשמור / ביטול
- מופעל כאשר: טופס בית ספר פתוח (`showSchoolForm`), עריכת שם משתמש (`editingUser`), או טופס הזמנה עם נתונים (`inviteForm`)

## 2026-06-19 — תיקוני בוחר יועצים וסדר שדות בטופס יצירת בית ספר

- `AdminPage.jsx`: תיקון סדר שדות בטופס — שורה 2: עיר|בעלות|מחוז|תוכנת כספים; שורה 3: טלפון|כתובת (בהתאמה לטופס עריכה)
- `AdminPage.jsx`: בוחר יועצים — ניפים מוצגים בתוך השדה (לא מתחתיו); קליק על שם היועץ מסמן/מבטל בחירה (onMouseDown + e.preventDefault במקום label+checkbox)
- `AdminPage.jsx`: AccessSelector — הוספת prop `schoolAdvisors` + אפשרות "היועצים המלווים שנבחרו" בתפריט; מועברת אוטומטית בסקציית ליווי (יועצים שנבחרו לבית ספר חדש / יועצים קיימים בעריכה)

## 2026-06-19 — תיקוני טופס יצירת בית ספר וגישה

- `AdminPage.jsx`: שורה 3 בטופס בית ספר אוחדה ל-תוכנת כספים | כתובת (במקום גריד 3 עמודות עם יועצים)
- `AdminPage.jsx`: סקציית "ליווי" עכשיו מוצגת גם בטופס יצירה חדשה — כוללת בוחר יועצים ושדה גישה
- `SchoolPage.jsx`: תיקון באג ב-AccessSelector — "היועצים המלווים שנבחרו" הפעילה onChange(null) כי הפילטר `nonOwnerUsers` הוציא יועצים עם תפקיד owner; הוסר הפילטר


## 2026-06-19 — תיקון פקיעת תוקף קישורי הזמנה

- Supabase: הגדלת OTP expiry מ-3600 ל-86400 שניות (24 שעות) דרך Management API
- `SetPasswordPage.jsx`: זיהוי שגיאה ב-URL hash בעת טעינה — אם `#error=...` קיים (קישור פג/בשימוש), מוצגת כרטיסית "קישור לא תקין" במקום הפניה שקטה לדף ההתחברות
- `AdminPage.jsx`: כפתור "שלח מחדש" בטבלת משתמשים לשורות עם `status === "pending"` — קורא ל-`POST /schools/users/invite` מחדש

## 2026-06-19 — ייבוא משתמשים מאקסל בפאנל ניהול

- `AdminPage.jsx`: הוספת כפתור "ייבוא מאקסל" בטאב משתמשים
- חלונית מיפוי עמודות (`ImportMappingModal`) הפכה גנרית — מקבלת `fieldConfig` ו-`confirmLabel` כ-props
- `USER_IMPORT_FIELD_CONFIG`: מייל + שם מלא (חובה), תפקיד (אופציונלי, ברירת מחדל: יועץ)
- `normalizeRole`: מנרמל ערכי תפקיד עברית/אנגלית ממחרוזת חופשית
- לולאת הייבוא קוראת ל-`POST /schools/users/invite` לכל שורה; שגיאות מוצגות שורה-שורה


## 2026-06-19 — IP tracking, ניקוי נתוני טסט, הבהרת unsubscribe

- `org_signup_requests`: הוספת `applicant_ip TEXT` ו-`applicant_user_agent TEXT`
- `signup_router.py / apply_signup`: מחלץ IP מ-`X-Forwarded-For` (ראשון ברשימה; fallback: `request.client.host`) ומ-`User-Agent`; שומר שניהם ב-DB
- `_superadmin_notification_html`: מציג IP ו-User-Agent גם במייל הנוטיפיקציה לסופר-אדמין
- `PATCH /signup/unsubscribe`: מעדכן `consent_marketing = false` בלבד — לא מוחק שורה מה-DB
- ניקוי: נמחקה שורת org_signup_requests עבור futeydeshe@gmail.com לצורך E2E טסט נקי

## 2026-06-19 — consent, אישור מייל, footer, הסרה מתפוצה

### Supabase DB
- `org_signup_requests`: הוספת 4 עמודות — `consent_contact BOOLEAN`, `consent_contact_at TIMESTAMPTZ`, `consent_marketing BOOLEAN`, `consent_marketing_at TIMESTAMPTZ`

### Backend (`signup_router.py`)
- `_make_unsub_token(email)`: HMAC-SHA256 עם SUPABASE_SERVICE_ROLE_KEY — token ייחודי ובלתי ניתן לזיוף לכל מייל
- `_email_footer_html(email)`: footer משותף לכל המיילים — שם החברה, כתובת, קישור הסרה
- `_confirmation_email_html`: מייל אישור לרישום נשלח למגיש מיד לאחר `/signup/apply`
- `_welcome_email_html`, `_rejection_email_html`, `_superadmin_notification_html`: עודכנו עם footer
- `apply_signup`: שומר `consent_contact` + `consent_marketing` + timestamps בשורת הבקשה; שולח מייל אישור לפונה
- `PATCH /signup/unsubscribe`: endpoint ציבורי — מאמת token ומעדכן `consent_marketing = false`
- `UnsubscribeIn`: מודל Pydantic חדש

### Frontend
- `RegisterPage.jsx`: שני checkbox לפני כפתור השליחה — "אני מאשר/ת לפנות אליי" (חובה), "אני מאשר לקבל הצעות שיווקיות" (ברירת מחדל מסומן); כפתור שליחה מושבת כל עוד הראשון לא מסומן; timestamps מוקלטים ברגע סימון/ביטול
- `UnsubscribePage.jsx` (חדש): דף `/unsubscribe` — מאמת token ומציג אישור הסרה
- `App.jsx`: הוספת route `/unsubscribe`

## 2026-06-19 — תיקוני E2E: generate_link, trigger, retry, duplicate-email

- `backend/routers/signup_router.py`:
  - תיקון קריטי: `generate_link` — `data` ו-`redirect_to` עברו לתוך `"options": {...}` (קוד ברמה העליונה גרם ל-redirect לאתר הפרודקשן במקום localhost/set-password)
  - הוספת `APP_URL` משתנה סביבה (ב-`.env` ובהסמכה ל-Render) — URL הכניסה בקישורי מייל
  - החלפת `invite_user_by_email` ב-`generate_link` (type=invite) — מניעת שליחת שני מיילים במקביל (Supabase auto-email + מייל מעוצב שלנו)
  - הוספת בדיקת idempotency ליצירת ארגון: אם הארגון כבר קיים (מניסיון קודם שנכשל) — משתמשים ב-id הקיים ולא יוצרים שוב
  - כל 6 ה-endpoints עטופים ב-retry loop (חוק ברזל מס' 5)
- Supabase: הסרת trigger `on_auth_user_created` → `handle_new_user()` שגרם ל-NOT NULL violation על `org_id` בעת יצירת משתמש חדש דרך `generate_link`

## 2026-06-18 — תיקוני signup_router + vite proxy

- `frontend/vite.config.js`: הוספת חוק proxy חסר עבור `/signup` (גרם ל-404 בדף ההרשמה)
- `backend/routers/signup_router.py`: החלת חוק ברזל מס' 5 על כל 6 ה-endpoints — עטיפה ב-retry loop של 2 attempts עם `db = get_admin_client()` בתוך ה-try, הוספת `reset_admin_client` ו-`import time`
- `frontend/src/pages/RegisterPage.jsx`: תיקוני UI — כותרת שדה הארגון ל-"שם הארגון", placeholder ל-"שם הארגון", צבע גופן כל הכותרות לשחור

## 2026-06-18 — Multi-tenant registration & onboarding flow

### Supabase DB
- Added `org_id`, `is_superadmin`, `onboarding_dismissed` columns to `profiles`
- Created `organizations` table with subscription/trial fields + RLS policies
- Created `org_signup_requests` table + RLS policies
- Created `get_my_org_id()` SQL function (SECURITY DEFINER)
- Added `org_id` to `schools` table with FK to `organizations`
- Migrated all existing profiles and schools to first org (`b716cf8c-7b35-44f8-98ff-e0a1cc584d72`, "גפן AI")
- Set `is_superadmin = true` for geffen360@gmail.com
- Updated RLS policies on `schools` and `profiles` to enforce org isolation

### Backend
- `backend/auth.py`: `_get_profile()` now fetches and caches `org_id`, `is_superadmin`, `onboarding_dismissed`
- `backend/routers/schools_router.py`: all school/user queries now filter by `org_id`; added `PATCH /users/me/onboarding` endpoint; `get_me` returns org subscription data
- `backend/routers/signup_router.py` (new): public apply endpoint, superadmin review/approve/reject endpoints, org activation endpoint, email notifications
- `backend/main.py`: registered `signup_router` with prefix `/signup`

### Frontend
- `frontend/src/pages/RegisterPage.jsx` (new): public registration form with 5 fields
- `frontend/src/pages/SuperAdminPage.jsx` (new): superadmin dashboard — review/approve/reject applications, upgrade to active subscription
- `frontend/src/components/OnboardingToast.jsx` (new): two independent onboarding popups for new org owners (add first school / add first user), each dismissible with "אל תציג שוב"
- `frontend/src/App.jsx`: added `/register` and `/super-admin` routes
- `frontend/src/components/Sidebar.jsx`: shows "ניהול מערכת" nav item for superadmin users
- `frontend/src/pages/LoginPage.jsx`: added link to `/register`
- `frontend/src/pages/DashboardPage.jsx`: trial countdown banner for owners (amber → red at ≤3 days), wired up OnboardingToast
- `frontend/src/pages/SchoolPage.jsx`: expired subscription block — shows non-dismissible modal with "צור קשר לשדרוג" when trial expired
