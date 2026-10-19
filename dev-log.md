# Dev Log

## 2026-10-19 — טאב "שיחות" חדש באזור האישי (צפייה בלבד, שיחות המשתמש בלבד)
- backend/routers/calls_router.py: שני אנדפוינטים חדשים — `GET /calls/integration-status` (בדיקה קלה אם לארגון יש אינטגרציית שיחות, זמין לכל role, בלי קריאה לספק) ו-`GET /calls/my-calls` (זמין לכל role, מחזיר רק שיחות שבהן `advisor_id` תואם למשתמש המחובר, עם `calls_enabled: false` חלק כשאין אינטגרציה — באותה תבנית של `list_school_calls`).
- frontend/src/components/calls/CallsTable.jsx + CallRow.jsx: prop חדש `hideAdvisorColumn` שמדלג על עמודת "יועץ".
- frontend/src/pages/PersonalCallsTab.jsx (חדש): גרסה מצומצמת של AdminCallsTab.jsx ללא בורר יועץ, עם `canManage={false}` (אין מחיקה/שיוך — טבלת צפייה בלבד) ו-`hideAdvisorColumn`.
- frontend/src/pages/ProfilePage.jsx: טאב "שיחות" חדש בין "משימות" ל"שעון נוכחות" — מופיע רק כשל-`/calls/integration-status` יש `enabled: true` (אחרת נעלם לחלוטין מרשימת הטאבים, לא רק מציג מסך ריק).

## 2026-10-19 — הוספת "מערכת גפן" הדינמית לטאב "סגירת שנה" + חסימת כפתורים לפי טווח תאריכים
- טבלה חדשה ב-Supabase: `gefen_year_closures` (school_id+division_type+budget_name+academic_year → status/notes), עם GRANT ל-service_role בלבד, RLS, ומדיניות זהה ל-`school_goals`.
- backend/academic_years.py: `get_closure_window(academic_year)` — טווח 1.6–31.12 של שנת הסיום הגרגוריאנית.
- backend/routers/schools_router.py: endpoints חדשים `GET`/`PATCH` `/{school_id}/gefen-closures` — שולפים שילובי (חטיבה, תקציב) דינמית מ-`check_metrics` וממזגים עם סטטוס/הערות השמורים.
- frontend/src/constants/academicYears.js: `getClosureWindow` / `isClosureWindowOpen`.
- frontend/src/components/SchoolYearClosureTab.jsx: נוסף אזור "מערכת גפן" דינמי (גריד מאוזן אוטומטית) מתחת לאזור "תוכנת הכספים" (הורים/רשות), עם כותרות קבוצה; כפתורי "סטטוס סגירה" (בכל האזורים) חסומים מחוץ לטווח התאריכים עם tooltip הסבר; שדה ההערות נשאר תמיד פעיל.
- frontend/src/pages/SchoolPage.jsx: state+fetch+save חדשים (`gefenClosures`/`saveGefenClosure`), מרועננים בכל פתיחת הטאב.
- שיפורי עיצוב נוספים לטאב "סגירת שנה": פיצול ל-2 כרטיסים נפרדים ("תוכנת הכספים"/"מערכת גפן") עם רקע הדף הרגיל ביניהם, גבולות מודגשים לכרטיסים, וריווח של כ-3 שורות בין הכותרות.

## 2026-10-19 — עמודות "סגירת שנה [תקציב]" דינמיות בדף הבית
- backend/routers/schools_router.py: `list_schools` מעשיר כעת גם `gefen_year_closures` (Q9) ומצרף `school["gefen_closures"]`.
- frontend/src/pages/DashboardPage.jsx: עמודה דינמית לכל סוג תקציב אמיתי שראינו ב-check_metrics ("סגירת שנה גפן" וכו'), שורה אחת לכל חטיבה (מ-`gefen_accounts`) תמיד — גם יחד עם עמודות מדדים/יעד. תא: "סגור"/"לא סגור"/"לא רלוונטי". כל עמודות הסגירה (ישנות וחדשות) אוחדו לקטגוריה אחת "סגירת שנה" בתחתית תפריט "עמודות להצגה".
