# Dev Log

## 2026-09-10 — תיקון 503 בטעינת פגישות לארגון עם מאות בתי ספר
- שורש: `list_all_meetings` / `list_my_meetings` / `get_meetings_stats` שלפו את כל מזהי בתי הספר של הארגון ושלחו `school_id=in.(...)` — לארגון עם 600+ בתי ספר זו כתובת URL של ~25KB שהשרת דוחה ב-400 ("JSON could not be generated"), והמשתמש רואה 503. לא קשור לכמות השורות או ל-timeout.
- תוקן: סינון הארגון עובר עכשיו דרך PostgREST embedded inner-join על `schools.org_id` (`select("*, schools!inner(...)").eq("schools.org_id", ...)`) — בלי רשימת IN ענקית. סינון `school_id`/`search` עברו גם הם ל-embedded filters. שדות בית הספר נשלפים מה-join (אין שאילתת `schools` נפרדת).
- נבדק מול הנתונים החיים: טעינת ~6,656 פגישות תשפ"ו לגפני שלו — ~2.6 שניות מקצה לקצה (במקום 503).
- הערה: הקובץ של ~4,538 פגישות עבר שיובא אכן נשמר במלואו (batch אחד, 4,538 שורות) — הבעיה הייתה רק בטעינה, לא בייבוא.
- `python -c "import routers.schools_router"` — 0 שגיאות. אין שינוי בפרונט (מבנה התשובה זהה).
