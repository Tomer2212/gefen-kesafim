# Dev Log

## 2026-09-03 — שנת ברירת מחדל תשפ"ז + ירושת סטטוס/סוג שירות בין שנים + תיקוני ייבוא

### שנת ברירת מחדל
- `DEFAULT_ACADEMIC_YEAR` שונה מ־תשפ"ו ל־תשפ"ז (בקאנד `backend/academic_years.py` + פרונט `frontend/src/constants/academicYears.js`). כל המסכים והבוררים נפתחים מעכשיו על תשפ"ז; תשפ"ו נשארת זמינה בבורר לצפייה.
- נוסף קבוע נפרד `GOAL_TEMPLATE_BASE_YEAR = "תשפ\"ו"` — שנת הבסיס לחישוב תאריכי היעדים ותוויותיהם. `_shift_goal_date` ותווית התאריך ב־`list_goals` משתמשים בו במקום ב־`DEFAULT_ACADEMIC_YEAR`, כך שהזזת שנת ברירת המחדל לא מזיזה את כל תאריכי היעד בשנה.

### ירושת נתוני שנה (carry-forward)
- `client_status` ו־`service_type` (טבלת `school_year_admin_data`) ממשיכים אוטומטית משנה לשנה: כשאין ערך מפורש לשנה מסוימת — נלקח הערך מהשנה הקודמת האחרונה שבה יש ערך (per-field). אין העתקת נתונים; שמירת ערך מפורש לשנה גוברת מאותו רגע.
- מנגנון: `resolve_inherited_year_admin` / `merge_inherited_year_admin` + הקבוע `INHERITED_YEAR_ADMIN_FIELDS` ב־`backend/academic_years.py`.
- חובר לכל מקום שקורא את השדות האלה לפי שנה:
  - `schools_router.py`: `get_year_admin_data`, `list_year_admin_data`, תזכורות פגישה (2), אוטומציית תיאום מזכירה
  - `task_logic.py`: `opted_out_recipients`, `_fetch_schools_and_meetings` (year_map לקריטריוני קהל)
  - `person_tasks_router.py`: audience advisor-resolution, טבלת בתי ספר לפי נמען
  - `tasks_router.py`: מפת client_status לחסימת שליחה
- לא צריך תיקון חד־פעמי לתשפ"ז — הירושה מכסה את כל 236 בתי הספר שיובאו בטעות לתשפ"ו.

### ייבוא אישי של בתי ספר (`AdminPage.jsx`)
- **גישה**: כל בית ספר מיובא נוצר עם `restrict_access_to` = איחוד מזהי היועצים המלווים של השורה (גפן+שוטף+מחוז), במקום `null` (=פתוח לכל היועצים). רשימה ריקה עדיין "מוגבל". בעלים/מנהלים רואים הכול תמיד.
- **טלפונים**: `normalizeImportedPhone` — מספר ללא 0 מוביל מקבל 0 (`544201796`→`0544201796`, `25334461`→`025334461`); קידומת בינ"ל `972`/`00972` מוחלפת ב־0; מספר תקין עם 0 לא משתנה. חל על כל שדות הטלפון בייבוא בלבד.

### תיקון נתונים חד־פעמי (Supabase Management API)
- ארגון "גפני שלו" (`4e0221ff-3596-452f-a6f7-462520d69ee6`): 236 בתי ספר פעילים עם `restrict_access_to IS NULL` עודכנו ל־`jsonb_agg` של מזהי היועצים מ־`advisor_schools` (1–3 לכל בית ספר, 0 רשימות ריקות). נותרו 0 בתי ספר פעילים עם גישה `null` בארגון.
