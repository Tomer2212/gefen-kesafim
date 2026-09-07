# Dev Log

## 2026-09-08 — תאריך לידה + כפתור עמודות ומיון/סינון בכותרות ב"ניהול > משתמשים"
- Supabase: עמודה `profiles.birth_date date`.
- backend/auth.py: `birth_date` נשלף ומוחזר ב-`get_current_user`.
- backend/schools_router.py: `_validate_birth_date` (פורמט YYYY-MM-DD, לא עתידי). `MyProfileIn` + `update_my_profile` תומכים ב-`birth_date` — עריכה ישירה ללא הרשאה (כמו `gender`). `UserProfileUpdateIn` + `update_user_profile` תומכים ב-`birth_date` כולל ניקוי (null). `list_users` (`select("*")`) מחזיר אוטומטית.
- frontend/ProfilePage.jsx: שדה "תאריך לידה" (אייקון עוגה צבעוני 30px + `<input type="date">`) בשורת "תמונת פרופיל", ממורכז בין מרכז השורה לקצה השמאלי (`mx-auto`); שמירה מיידית ב-onChange.
- frontend/components/users/userColumns.js (חדש): קטלוג עמודות טבלת המשתמשים + `matchesUserColumnFilter` (טקסט/רשימה/תאריך; `control_domains` = מכיל לפחות אחד מהנבחרים).
- frontend/AdminPage.jsx: עמודת "תאריך לידה" (עריכה מוטבעת, `DD/MM/YYYY`, "+" כשריק) מיד אחרי "תחומי ידע". כפתור "עמודות להצגה" ליד "הוסף משתמש" (שימוש חוזר ב-`ColumnPickerButton`, שמירה ב-localStorage `admin_users_col_visible`, "שם" תמיד מוצג). משפך מיון+סינון בכל כותרת (`ColumnFilterButton`), מותאם לסוג השדה; כשאין מיון פעיל — מיון לפי תפקיד כברירת מחדל.
