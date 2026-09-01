# Dev Log

## 2026-09-01 — 6 שדות חדשים ב"פרטי מוסד" בכרטיס בית ספר
- מיגרציה ל-Supabase: הוספת עמודות ל-`public.schools` — `education_authority TEXT`, `sector TEXT`, `supervision TEXT`, `grade_levels TEXT[]`, `study_days TEXT[]`, `student_count INTEGER`
- Backend: הוספת 6 השדות ל-`SchoolIn` ב-`schools_router.py` (create/update כבר גנריים)
- `SchoolPage.jsx`: קבועים חדשים (`STUDY_DAY_OPTIONS` כולל ש, `SECTOR_OPTIONS`, `SUPERVISION_OPTIONS`, `GRADE_LEVEL_OPTIONS`); הוספת 6 השדות ל-`editForm` ול-`startEdit()`; 2 שורות תגיות חדשות בתצוגה ובעריכה של "פרטי מוסד"; עטיפת ה-grid ב-`max-h-[252px] overflow-y-auto` כך שהתיבה נראית זהה וגלילה פנימית חושפת את השורות החדשות; המרת `student_count` למספר/‏null בשמירה
- `AdminPage.jsx`: אותם קבועים; הוספת השדות ל-`EMPTY_FORM`, `startEdit()`, ולמודל ההוספה/עריכה; המרת `student_count` ב-POST/PUT
- `AddSchoolPage.jsx`: אותם קבועים; הוספת השדות ל-`EMPTY_FORM` ולטופס; המרת `student_count` ב-POST
- ייבוא אקסל (`IMPORT_FIELD_CONFIG` + `confirmImport` ב-`AdminPage.jsx`): הוספת 6 השדות בתחתית כשדות אופציונליים; פונקציות `normalizeSector`/`normalizeSupervision`; פירוק `grade_levels`/`study_days` לרשימות מסוננות; המרת `student_count` למספר
- `npx vite build` עבר ללא שגיאות

## 2026-09-01 — תיקוני שכבות/ימי לימוד
- `MultiSelectChips.jsx`: תוקן באג שגלילה בתוך רשימת האפשרויות של הדרופדאון סגרה אותו (מאזין ה-scroll בשלב ה-capture התעלם כעת מגלילה שמקורה בתוך הדרופדאון) — כעת ניתן לגלול ולבחור את כל 12 שכבות הלימוד
- `SchoolPage.jsx`: פונקציית `formatOrderedSelection` — תצוגת "שכבות לימוד"/"ימי לימוד" מקצרת רצפים רציפים למקף (א-ד) ומפרידה פערים בפסיק (א-ד, ו)

## 2026-09-01 — ההרשאה "צפייה בכרטיס בית ספר" גוברת על שיוך/גישה
- הבעיה: יועץ ששויך כ"יועץ מלווה" / קיבל גישה הצליח לפתוח את הכרטיס למרות שההרשאה כבויה — כי `list_schools` ו-endpoints של הטאבים לא בדקו את ההרשאה, והפרונט רינדר את הכרטיס מ-snapshot ישן והתעלם מ-403
- Backend `schools_router.py`: helper מרכזי `_ensure_can_view_school_card(db, user)` (מחזיר 403). מחובר ל-`get_school` וגם ל-GET של הטאבים הבלעדיים לכרטיס: `logs`, `logs/{id}`, `notes`, `files`, `calls` (עם `except HTTPException: raise` היכן שנדרש)
- לא חובר ל-`year-admin-data` / `control-letters` / `goals` / `accounts` — משותפים עם זרימות מחוץ לכרטיס (פגישות אישיות, משימות אישיות, טבלת ניהול); ה-403 על `get_school` + חסימת הרינדור בפרונט מספיקים
- `SchoolPage.jsx`: `canViewSchoolCard` מאותחל ל-`null` → ספינר עד שברור (אין flash). `false` (מ-`/users/me` או מ-403 של `get_school`) → מסך "אין לך הרשאה לצפייה בכרטיס בית ספר"
- `DashboardPage.jsx`: שורת בית ספר עם אייקון מנעול + לא לחיצה כשההרשאה כבויה (הרשימה עצמה לא מסוננת — "מוצג אך נעול")
- `npx vite build` עבר ללא שגיאות
