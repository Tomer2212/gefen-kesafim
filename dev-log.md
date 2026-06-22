# Dev Log

## 2026-06-22 — תיקון: setup_complete לא נקרא בflow שליחה מחדש
- **שורש הבעיה:** `_get_profile()` ב-auth.py לא שלף את שדה `status`, ולכן `/users/me` החזיר `undefined` לפרונטאנד. SetPasswordPage בדק `status === "pending"` וקיבל `undefined`, אז `isPending` נשאר false ו-`setup_complete` מעולם לא נקרא בflow recovery
- **תיקון auth.py:** הוסף `status` ל-SELECT של `_get_profile()` ולreturn של `get_current_user`
- **תיקון setup_complete:** הוסף retry loop + `invalidate_profile_cache` כדי שהקאש לא ישמור `pending` אחרי העדכון
- **תיקון ידני ב-DB:** עדכון `funnyfootballstories@gmail.com` לstatus=active (כבר השלים הרשמה)

## 2026-06-21 — תיקון קריטי: import שבור גרם לכשל כל ה-schools router
- הסרת `from gotrue.types import GenerateLinkParams, GenerateLinkType` שגרם לכשל טעינת המודול כולו (כל endpoints ב-schools_router החזירו שגיאה)
- החלפה ב-REST API ישיר דרך httpx ל-generate_link
- תיקון fallback של APP_URL מ-localhost לכתובת הייצור
- הוספת retry loop ל-`invite_user` endpoint שחסר לו לחלוטין (Invariant #5)

## 2026-06-21 — תיקון שליחה מחדש של הזמנת יועץ
- **שורש הבעיה:** כשיועץ לוחץ על לינק ההזמנה המקורי, Supabase מסמן את האימייל כ-confirmed. קריאה חוזרת ל-`invite_user_by_email` על משתמש עם אימייל מאושר → exception → 503
- **תיקון backend:** החלפת `invite_user_by_email` ב-`generate_link(type=recovery)` שעובד ללא קשר לסטטוס אישור האימייל; המייל נשלח ידנית דרך Gmail SMTP עם תבנית HTML מותאמת
- **תיקון frontend:** `SetPasswordPage` מזהה כעת שמשתמש pending הגיע דרך `PASSWORD_RECOVERY` (לינק שנשלח מחדש) ומטפל בו כ-flow הזמנה: מציג "ברוכים הבאים!", קורא ל-setup-complete, ומציג מסך הצלחה
