# Dev Log

## 2026-06-21 — תיקון קריטי: import שבור גרם לכשל כל ה-schools router
- הסרת `from gotrue.types import GenerateLinkParams, GenerateLinkType` שגרם לכשל טעינת המודול כולו (כל endpoints ב-schools_router החזירו שגיאה)
- החלפה ב-REST API ישיר דרך httpx ל-generate_link
- תיקון fallback של APP_URL מ-localhost לכתובת הייצור
- הוספת retry loop ל-`invite_user` endpoint שחסר לו לחלוטין (Invariant #5)

## 2026-06-21 — תיקון שליחה מחדש של הזמנת יועץ
- **שורש הבעיה:** כשיועץ לוחץ על לינק ההזמנה המקורי, Supabase מסמן את האימייל כ-confirmed. קריאה חוזרת ל-`invite_user_by_email` על משתמש עם אימייל מאושר → exception → 503
- **תיקון backend:** החלפת `invite_user_by_email` ב-`generate_link(type=recovery)` שעובד ללא קשר לסטטוס אישור האימייל; המייל נשלח ידנית דרך Gmail SMTP עם תבנית HTML מותאמת
- **תיקון frontend:** `SetPasswordPage` מזהה כעת שמשתמש pending הגיע דרך `PASSWORD_RECOVERY` (לינק שנשלח מחדש) ומטפל בו כ-flow הזמנה: מציג "ברוכים הבאים!", קורא ל-setup-complete, ומציג מסך הצלחה
