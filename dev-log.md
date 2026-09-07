# Dev Log

## 2026-09-08 — fix: שדה תאריך לידה באזור אישי ננעל בהקלדה
- frontend/ProfilePage.jsx: ה-`<input type="date">` היה controlled עם שמירה בכל הקלדה — ננעל על שנה חלקית כמו "0019". שונה ל-uncontrolled (`defaultValue` + `key`), שמירה ב-blur/Enter בלבד, `min="1900-01-01"`.
- frontend/AdminPage.jsx + backend/schools_router.py: הגנה נוספת — דחיית תאריך לידה עם שנה < 1900 (`_validate_birth_date`).
- נוקה ערך birth_date לא חוקי אחד שנשמר.
