# Dev Log

## 2026-09-07 — שדה "מגדר" באזור אישי + תווית תפקיד נשית ב-Sidebar
- Supabase: הוספת עמודה `profiles.gender TEXT` (ערכים: `male` / `female` / `NULL`).
- backend/auth.py: `gender` נשלף בפרופיל ומוחזר ב-`get_current_user` (fallback = `None`).
- backend/routers/schools_router.py: `MyProfileIn` תומך כעת ב-`full_name` ו/או `gender`; `PATCH /users/me/profile` מעדכן רק שדות שנשלחו בפועל (`model_fields_set`); ולידציה `gender ∈ {male, female, null}`.
- frontend/ProfilePage.jsx: שדה בחירה "מגדר" בטאב "פרטים אישיים" מימין ל"שם מלא" (בחר/י · זכר · נקבה), שמירה מיידית ב-onChange עם חיווי "נשמר ✓".
- frontend/Sidebar.jsx: תווית התפקיד מתחת לשם מוצגת כ"יועצת"/"מנהלת" כאשר `gender === "female"` עבור advisor/manager בלבד; אחרת ללא שינוי.
- frontend/ProfilePage.jsx: טאב "פרטים אישיים" — שורת השדות (שם/מגדר/אימייל/סיסמה) בשורה אחת בדסקטופ (`lg:flex-nowrap`, `gap-4` + min-widths מצומצמים) בתוך `max-w-4xl`; סרגל הטאבים חזר לרוחב קבוע (`max-w-4xl`) זהה לכל שאר הטאבים — אין יותר קפיצת מיקום במעבר ל"פרטים אישיים".
- frontend/ProfilePage.jsx: תיקון הבהוב הטאב "שעון נוכחות" — התפקיד נטען מיידית מ-`session.user_metadata.role` כדי שהטאב יוצג נכון כבר ב-render הראשון; תוצאת `/users/me` עדיין דורסת כמקור אמת.

## 2026-09-07 — "טלפון עבודה" ו"תחומי ידע" באזור אישי + זרימת אישור לעריכה עצמית
- Supabase: טבלה חדשה `profile_update_requests` (GRANT ל-service_role, RLS מופעל, ללא גישת authenticated — רק דרך FastAPI).
- backend/schools_router.py: שתי הרשאות חדשות `can_edit_own_work_phone` / `can_edit_own_knowledge_areas` ("לערוך ישירות מספר טלפון עבודה" / "לערוך ישירות תחומי ידע"), ברירת מחדל ON, רלוונטיות ליועץ בלבד (מנהל/בעלים תמיד ישירות); נחשפות ב-`get_me`.
- backend: `PATCH /schools/users/me/profile` תומך כעת ב-`work_phone` + `control_domains`; ליועץ ללא הרשאה — השדה נכנס ל-`profile_update_requests` (status pending) + התראה `profile_update_request_submitted` למאשרים (בעלים + מנהלים עם `can_approve_update_requests`), אחרת נכתב ישירות. מחזיר `pending_fields`.
- backend: `GET /schools/profile-update-requests` (בקשות המשתמש עצמו) + `PATCH /schools/profile-update-requests/{id}` (אישור/דחייה — מקביל אחד-לאחד ל-`review_update_request`, כולל `approved_fields` לאישור חלקי, `invalidate_profile_cache`, והתראת `update_request_approved/rejected` למגיש). enrichment של `request_status` בהתראות הורחב לסוג החדש.
- frontend/NotificationsPage.jsx: `profile_update_request_submitted` הוא actionable (אותו UI diff/approve/reject כמו בקשת בית ספר); בחירת endpoint לפי סוג; תוויות שדה `work_phone`/`control_domains` + פורמט מערך לתחומי ידע.
- frontend/AdminPage.jsx: קבוצת הרשאות חדשה "פרטים אישיים" עם שני המפתחות; `MANAGER_NA_PERMS` — עמודת "מנהל" מציגה "לא רלוונטי" (בטבלת ברירות המחדל וב-`UserPermissionsModal`).
- frontend/ProfilePage.jsx: טאב "פרטים אישיים" עבר ל-grid 3×2 מיושר (שורה 1: שם מלא · אימייל · סיסמה; שורה 2: מגדר · טלפון עבודה · תחומי ידע). "טלפון עבודה" (ולידציית 05+8) ו"תחומי ידע" (`MultiSelectChips`) עם טיוטה + "שמור"; חיווי "נשמר ✓" / "נשלח לאישור ✓" / "ממתין לאישור" ונעילת שדה כל עוד קיימת בקשה פתוחה (`GET /schools/profile-update-requests`).
- frontend/ProfilePage.jsx (נראות): "טלפון עבודה" + "תחומי ידע" — הוסר אייקון העריכה החיצוני; השדה תופס את מלוא הרוחב ובמצב ריק מציג כפתור "+" בתוכו שנכנס לעריכה/בקשה. "סיסמה" → כותרת "איפוס סיסמה", הוסרה שורת העזר, הכפתור מיושר עם שאר השדות בשורה, וטקסט הכפתור → "שלח קישור למייל לאיפוס סיסמה".

## 2026-09-07 — תמונת פרופיל (avatar) לכל משתמש
- Supabase: עמודות `profiles.avatar_storage_key` + `avatar_updated_at`; bucket ציבורי חדש `avatars` (מגבלת 6MB, MIME jpeg/png/webp) + מדיניות קריאה ציבורית על `storage.objects`.
- backend/auth.py: `avatar_storage_key` נשלף בפרופיל ומוחזר ב-`get_current_user`.
- backend/schools_router.py: `get_me` מחזיר `avatar_url` (URL ציבורי). endpoints חדשים: `POST /schools/users/me/avatar` (multipart; בדיקת magic-bytes ל-JPG/PNG/WebP, תקרת 2MB אחרי הקטנה בצד לקוח, מחיקת התמונה הקודמת מ-Storage, `invalidate_profile_cache`) ו-`DELETE /schools/users/me/avatar`. אין הרשאה נדרשת (תמונה של המשתמש עצמו).
- frontend: רכיב `Avatar.jsx` (תמונה עגולה או ראשי-תיבות על עיגול צבעוני) + `AvatarCropModal.jsx` (חיתוך אינטראקטיבי — גרירה + זום במסגרת עגולה, ייצוא ל-canvas 512×512, JPEG q0.85, ~40-80KB). ללא ספריות חדשות.
- frontend/ProfilePage.jsx: בלוק "תמונת פרופיל" מתחת לשורת השדות — תצוגה מקדימה 96px, "העלה/החלף תמונה" + "הסר תמונה", אימות סוג/גודל בצד לקוח (עד 5MB), חיווי "נשמר ✓".
- frontend/Sidebar.jsx: עיגול תמונה בכרטיס המשתמש בקצה השמאלי (ליד שורת התפקיד/ארגון) גם במצב פתוח וגם במצב מצומצם; טעינה מיידית מ-`localStorage["avatar_url"]` וריענון מ-`/users/me`; מאזין ל-event `avatar-updated` לעדכון ללא ניווט; ניקוי המפתח ב-logout.
- fix: מפתח האחסון של האבטאר כלל בטעות תחילית `avatars/` (שם ה-bucket), מה שגרם ל-URL ציבורי כפול ("object not found"). המפתח עכשיו `{user_id}/{hex}.{ext}` וה-URL נבנה כ-`/public/avatars/{key}` (עם סובלנות למפתח הישן). נוקה אובייקט יתום אחד + אופס `avatar_storage_key` לפרופיל שהושפע.
