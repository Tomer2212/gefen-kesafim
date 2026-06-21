# Dev Log

## 2026-06-21 — תיקון שליחה מחדש של הזמנת יועץ
- **שורש הבעיה:** כשיועץ לוחץ על לינק ההזמנה המקורי, Supabase מסמן את האימייל כ-confirmed. קריאה חוזרת ל-`invite_user_by_email` על משתמש עם אימייל מאושר → exception → 503
- **תיקון backend:** החלפת `invite_user_by_email` ב-`generate_link(type=recovery)` שעובד ללא קשר לסטטוס אישור האימייל; המייל נשלח ידנית דרך Gmail SMTP עם תבנית HTML מותאמת
- **תיקון frontend:** `SetPasswordPage` מזהה כעת שמשתמש pending הגיע דרך `PASSWORD_RECOVERY` (לינק שנשלח מחדש) ומטפל בו כ-flow הזמנה: מציג "ברוכים הבאים!", קורא ל-setup-complete, ומציג מסך הצלחה
