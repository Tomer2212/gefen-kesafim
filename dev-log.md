# Dev Log

## 2026-07-19 — Feat: סנכרון הפוך מ-Outlook בזמן אמת (Webhooks) במקום polling כל 15 דקות
- גילינו שה-cron הקיים (GitHub Actions, כל 15 דקות בתאוריה) רץ בפועל כל 1-2.5 שעות בלבד — בדקנו 30 הרצות אחרונות. הלוגיקה עצמה תקינה (אומת בבדיקה חיה: זיהתה נכון עריכת שעה שבוצעה ישירות ב-Outlook).
- הוספנו סנכרון הפוך בזמן אמת מבוסס Microsoft Graph Webhooks (Change Notifications) — עדכון תוך שניות במקום להמתין לסבב polling.
- טבלאות חדשות ב-Supabase: `calendar_subscriptions` (subscription per advisor, כולל חידוש אוטומטי לפני שפג תוקף אחרי ~3 ימים), `calendar_event_index` (מיפוי הפוך event_id → meeting_id לניתוב מהיר של התראות נכנסות).
- `backend/graph_client.py`: `persist_calendar_sync` (נקודה מרכזית אחת לכתיבת calendar_sync + עדכון האינדקס), `_ensure_subscription`/`renew_subscription`/`renew_all_subscriptions_expiring_soon`, `verify_client_state` (הגנה מפני התראות מזויפות).
- `backend/routers/schools_router.py`: חילוץ `_reconcile_meeting_from_outlook` — לוגיקה משותפת ל-poll הישן (שנשאר כרשת ביטחון) ול-webhook החדש.
- `backend/routers/calendar_router.py`: `POST /webhook/microsoft` (ציבורי, מאומת דרך clientState — מקבל גם את ה-validation handshake של מיקרוסופט וגם התראות אמיתיות), `POST /renew-subscriptions` (cron יומי).
- `.github/workflows/renew-calendar-subscriptions.yml` חדש — חידוש יומי, סובל בקלות עיכובים של GitHub Actions כי יש שוליים של ימים לפני שה-subscription פג.
- **נדרש לפרודקשן:** `BACKEND_PUBLIC_URL` חדש ב-Render (בנוסף ל-`MS_CLIENT_ID`/`MS_CLIENT_SECRET`/`MS_REDIRECT_URI`/`CALENDAR_TOKEN_ENCRYPTION_KEY` שכבר דגלנו) — חובה כדי לבנות את notificationUrl. הבדיקה החיה של ה-webhook עצמו חייבת לקרות מול פרודקשן (לא localhost, כי מיקרוסופט לא יכולה להגיע ל-localhost).
