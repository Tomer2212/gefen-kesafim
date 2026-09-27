# Dev Log

## 2026-09-27 — תשתית שיחות רב-ספקית (VOICENTER + EXM)
- הוספת תמיכה בספק שיחות חדש, EXM (מסלול "נתונים יבשים" בלי תמלול/סיכום AI), לצד VOICENTER הקיים — ספק אחד לכל ארגון.
- שינוי שם `backend/routers/voicenter_router.py` ל-`backend/routers/calls_router.py`, מורכב מ-2 adapters חדשים (`backend/integrations/calls/voicenter_adapter.py`, `exm_adapter.py`) ואורכיסטרציה גנרית משותפת. הפריפיקס ב-API השתנה מ-`/voicenter` ל-`/calls` (כל קריאות ה-frontend עודכנו).
- מיגרציית DB: טבלאות חדשות `calls_integrations`, `calls_agent_mappings`, `calls_known_agents`, `calls_call_school_links`, `calls_call_contact_resolutions`, `calls_unknown_number_state` (עם GRANT+RLS+policy מלאים), עם מיגרציית דאטה מהטבלאות הישנות של voicenter_*. הטבלאות הישנות עדיין קיימות (לא נמחקו) עד לאישור שהכול עובד בסביבת הבדיקה.
- שיוך שיחה ליועץ: אצל EXM לפי קו (מספר) במקום קוד נציג, כי ל-EXM אין שדה כזה בכל שיחה.
- `AdminIntegrationsTab.jsx`: כרטיס "שיחות טלפון" גנרי עם בורר ספק (VOICENTER/EXM) ומודל הגדרות נפרד לכל ספק. הוספת הדרכת חיבור ל-EXM ב-`guideContent.js`.
- עדכון `.github/workflows/voicenter-poll-calls.yml` לכתובת ה-endpoint החדשה.
- נבדק מול חשבון EXM אמיתי (מספר וירטואלי לבדיקות) ותוקנו מספר תקלות שהתגלו בבדיקה:
  - `frontend/vite.config.js`: הפרוקסי המקומי לא כלל את ה-prefix החדש `/calls` (היה `/voicenter` בלבד).
  - כפתור "ניתוק חיבור" בהגדרות (VOICENTER/EXM) לא הופיע כלל אם עדיין לא נשמרו פרטי התחברות — עכשיו מוצג תמיד.
  - `exm_adapter.py`: תרגום שגוי של סטטוס שיחה (EXM אין לו שדה סטטוס כמו Voicenter) — כל שיחה הוצגה כ"לא ידוע"; נוסף מיפוי (missed→לא נענתה, אחרת→נענתה).
  - `exm_adapter.py`: באג טווח תאריכים — EXM מפרש זמן ללא אזור-זמן כשעון ישראל, ופנייה עם זמן UTC גרם לפספוס שיחות טריות; תוקן עם תיוג מפורש ל-Asia/Jerusalem.
  - `exm_adapter.py`: שעת שיחה שחוזרת מ-EXM (`time.start`) היא כבר שעון ישראל, אך שאר המערכת (`_call_time_to_israel_hm` וכו') מניחה UTC ומבצעת המרה נוספת — גרם להצגת שעה שגויה (+3 שעות) בשדה "תחילת שיחה" בפגישות. תוקן עם נורמליזציה ל-UTC לפני החזרה מה-adapter.
  - `list_known_reps` (`calls_router.py`): רשימת הקווים/נציגים לשיוך ליועץ הייתה תלויה לגמרי ב-cron (כל 15 דק') ולא התעדכנה מיד אחרי חיבור קו חדש; נוספה משיכה חיה (7 ימים אחורה) בכל טעינה. גם תוקן ב-frontend (`AdminPage.jsx`) שהרשימה לא התרעננה בכלל בחזרה לטאב "משתמשים" אם המשתמשים כבר נטענו בעבר.
  - עדכון תוויות UI סטטיות שהזכירו "VOICENTER" בלבד (עמודת שיוך, placeholder) לניסוח כללי יותר.
