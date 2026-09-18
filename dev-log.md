# Dev Log

## 2026-09-18 — שדה "מיקום הפגישה" (מרחוק/פיזי) בקביעת פגישות + הצגתו בהודעות
- DirectCoordinationModal.jsx + ConditionGroupsEditor.jsx (כרטיס יצירת פגישה במשימה): כפתור בחירת מיקום (מרחוק/פיזי, ברירת מחדל מרחוק) באותה שורה של יועץ מבצע/משך הפגישה
- backend: הבחירה עוברת דרך DirectCoordinationRangeIn / _build_meeting_ranges / _book_range_slot אל שדה meeting_type הקיים ב-meetings (במקום "remote" קשיח)
- booking_logic.py: שורת "מיקום הפגישה: מרחוק/פיזי" נוספה מעל "משתתפים" בהודעת בקשת קביעת פגישה (HTML + טקסט), עבור תיאום עצמי ומשימות
- schools_router.py: תזכורת יום לפני (_build_reminder_email_html) מציינת גם היא היכן הפגישה תתקיים

## 2026-09-18 — אפשרות "גפן+שוטף" בחלונית תיאום עצמי
- הוספת כפתור "גפן+שוטף" ב-DirectCoordinationModal.jsx, מוצג רק כשלגפן ולשוטף אותו יועץ ואותו/ה אחראי/ת תיאום
- ברירת מחדל למשך הפגישה בבחירת "גפן+שוטף" = סכום משך פגישה גפן + משך פגישה שוטף מכרטיס בית הספר
- backend: schools_router.py תומך ב-meeting_service_type="gefen_current" בבקשת תיאום ישיר, עם אימות שרתי שהאחראי/ת זהה

## 2026-09-18 — רמת ידע (מתחיל/מתקדם/מומחה) לכל תחום ידע
- DB: עמודה חדשה `profiles.control_domain_levels` (JSONB, מיפוי תחום→רמה)
- MultiSelectChips.jsx: הרחבה גנרית (opt-in) — עמודת "רמה" לצד כל תחום ידע מסומן, בחירה יחידנית מתחיל/מתקדם/מומחה, מסגרת אדומה לתחום בלי רמה
- ניהול משתמשים (AdminPage.jsx): רמה לכל תחום ידע נשמרת בטבלת המשתמשים ובטופס הזמנת משתמש חדש; תחום בלי רמה מוקף באדום עד שתוגדר
- איתור יועץ (AdvisorFinderModal.jsx + advisor_finder_router.py): אפשר לדרוש רמת מינימום לכל תחום ידע בחיפוש (ברירת מחדל "מתחיל"); ההתאמה מתחשבת ברמת היועץ ביחס לרמה המבוקשת (רמה גבוהה יותר גם עוברת)

## 2026-09-18 — ריבוי אחראי/ת תיאום + פיצול איש קשר לחט"ב (שש-שנתי)
- schools_router.py + task_logic.py: מעבר ממתאם/ת תיאום יחיד/ה לבית ספר למתאם/ת נפרד/ת לכל משבצת (תיכון / חטיבת ביניים / מחוז), עם resolve לפי משבצת בכל בקשת תיאום ישיר ובחלוקת משימות
- SchoolPage.jsx + AddSchoolPage.jsx: טבלת אנשי קשר עודכנה לתמוך בפיצול איש קשר נפרד לחט"ב (מנהל/ת, מזכיר/ה, איש כספים) עם toggle "אותו X לשתי החטיבות"
- AdminPage.jsx: עמודות ייבוא מאקסל + חלונית פתרון בעיות ייבוא (SchoolImportProblemsModal.jsx) עודכנו לתמיכה במתאמים לפי משבצת
- DirectCoordinationModal.jsx / DirectCoordinationResolutionModal.jsx / TaskContactResolutionModal.jsx / TaskMeetingResolutionModal.jsx: תמיכה בפתרון בעיות תיאום כשיש כמה משבצות/מתאמים
- קובץ עזר חדש (לא ב-git, backend/backfill_meeting_coordinators.py): מעביר בתי ספר ישנים מהשדה הבודד החדש לפורמט לפי-משבצת

## הוחרג מההעלאה הזו: "בתי ספר לא פעילים (מידע יבש)"
פיצ'ר להוספת/ייבוא בתי ספר כ"מידע יבש" (ללא אחראי/ת תיאום, לא מוצגים בדשבורד) היה שזור בתוך הפיצ'ר שלמעלה (בעיקר ב-AdminPage.jsx ו-schools_router.py) ולא תועד קודם ב-dev-log. הוסר כירורגית מהקוד שיילך לאתר בהעלאה הזו, לפי בקשה מפורשת. הגרסה המקורית (לפני ההסרה) נשמרת כקובצי patch בשורש הפרויקט: `WIP-inactive-schools-backend.patch`, `WIP-inactive-schools-frontend.patch` — לא ב-git, להשלמה/העלאה מחדש בעתיד.
