# Dev Log

## 2026-06-10 — Fix: list_meetings — retry + non-fatal profile enrichment
- `list_meetings`: אותו ליקוי כמו list_logs — `db = get_admin_client()` מחוץ ל-try, אין retry
- נוסף `for attempt in range(2)` עם `get_admin_client()` בתוך ה-try
- profile enrichment (advisor names) עטוף ב-try/except non-fatal

## 2026-06-10 — Fix: retry loop — stale client reference + list_users unprotected
- `list_accounts` + `list_logs`: `db = get_admin_client()` הועבר לתוך ה-`try` — קודם נלכד מחוץ ללולאה, כך שאחרי `reset_admin_client()` ה-retry המשיך להשתמש ב-stale client → שני הניסיונות נכשלו → 503
- `list_logs`: profile enrichment עטוף ב-try/except non-fatal (כמו Q3/Q4 ב-list_schools)
- `list_users`: נוספה לולאת retry מלאה עם `get_admin_client()` בתוך ה-try

## 2026-06-10 — Fix: _get_profile — retry על cold start timeout
- `backend/auth.py` → `_get_profile`: הוחלף try/except בודד ב-`for attempt in range(2)` — בניסיון ראשון שנכשל: `reset_admin_client()` + 50ms sleep + בדיקת cache (thread מקביל אולי הצליח); רק אם שני הניסיונות נכשלו מחזיר "advisor" כ-last resort
- תיקון: על cold start, timeout ב-3s גרם ל-`list_schools` לראות role=advisor ולהחזיר 6 בתי ספר במקום 9

## 2026-06-10 — Fix: חזרה לסדרה ב-list_schools + retry ב-notifications
- `list_schools`: הוחזרו Q3+Q4 (profiles, meetings stats) לריצה **סדרתית** — http/2 negotiation overhead גרם לachievement timeout ב-3s בריצה מקבילה
- `get_notifications`: נוסף retry loop + reset_admin_client() + silent fallback (`count:0`) במקום HTTPException — מונע 503 על notification polling

## 2026-06-10 — Perf: אופטימיזציה מלאה של list_schools (Cold Start + סקלביליות)
- `backend/supabase_client.py`: timeout 10s → **3s** — cold start penalty ירד מ-10s ל-3s
- `backend/routers/schools_router.py`: לadvisors — Q_pre מביא רק את ה-IDs שלהם, Q1 מסנן ב-DB (לא בpython) → סקלביליות ל-1,000 בתי ספר
- `backend/routers/schools_router.py`: Q3 (profiles) + Q4 (meetings stats) עכשיו רצות **במקביל** עם ThreadPoolExecutor(max_workers=2) → חסכון ~300ms לכל קריאה

## 2026-06-10 — Fix: הסרת StrictMode — מניעת כפילות בקשות ב-dev
- הוסר `<StrictMode>` מ-`frontend/src/main.jsx`
- StrictMode הפעיל כל useEffect פעמיים בdev → 5 בקשות × 2 = 10 בקשות מקביל לworker בודד → 503
- בproduction StrictMode לא פועל כלל, אז שינוי זה אינו משפיע על משתמשי קצה

## 2026-06-10 — Fix: SchoolPage — סריאליזציה של loadUsers אחרי setLoading
- `loadUsers()` הוזז מ-לפני `Promise.allSettled(accounts+logs)` ל-**אחרי** `setLoading(false)`
- תוצאה: בקשות mount עכשיו: me+accounts+logs+notifications (4 מקביל), ורק אחרי רינדור הדף — users/all לבד
- ירידה מ-5 בקשות מקביל ל-4, עם users/all ללא תחרות

## 2026-06-10 — Fix: SchoolPage מפסיק לקרוא /schools/users/all ללא בדיקת Role
- שורה 2722: `loadUsers()` מופעל רק אם `userRole === "owner" || "manager"` (השתמש במשתנה המקומי לפני state update)
- שורה 2763: `loadUsers()` בטאב פגישות מוגן גם הוא — `role` state + הוסף `role` ל-dependency array
- תוצאה: יועצים לא שולחים בקשה ל-`/schools/users/all` בכלל; מנהלים שולחים בקשה בודדת בלבד — בלי כפילות מ-StrictMode

## 2026-06-10 — תמיכה בריבוי קבצי סקולקאש
- תוקנה ולידציה ב-`_classify_files`: כעת מאפשר העלאת שני קבצי סקולקאש (ולא רק כספים2000)
- תוקנה טעינה ב-`_load_finance_raw`: כעת מאחד את כל קבצי הסקולקאש עם concat+drop_duplicates (כמו כספים2000)
