# Dev Log

## 2026-09-08 — חוסן: זרימת הזמנה/הרשמה + שגיאות שרת
> רקע: תקרית שבה משתמשת נתקעה ב"ממתין לאישור" ולא הצליחה לטעון בתי ספר.
> הסיבה בפועל התבררה כרשת המשרד שלה שהסירה כותרות CORS מתשובות ה-API (לא באג בקוד;
> deploy לא רלוונטי). התיקונים למטה הם שיפורי חוסן שנכתבו במהלך האבחון ונשארים.
- `backend/auth.py`: מילון ברירת-המחדל של `_get_profile` (כשל כפול בקריאת `profiles` ללא cache) קיבל `"status": "active"` שהיה חסר; `get_current_user` עבר ל-`profile.get("status", "active")` — מסיר `KeyError` שהפיל כל קריאה מאומתת.
- `backend/main.py`: `global_exception_handler` מצרף כעת כותרות CORS ל-`Origin` מורשה. קודם ה-503 יצא בלי CORS (רץ מחוץ ל-`CORSMiddleware`), הדפדפן חסם, ו-axios הציג "לא ניתן להתחבר לשרת" במקום שגיאת שרת קריאה.
- `frontend/src/pages/SetPasswordPage.jsx`: בדיקת הסטטוס בזרימת `PASSWORD_RECOVERY` עטופה ב-retry (2 ניסיונות) כדי לא להוריד הזמנה חוזרת למסלול "שכחתי סיסמה"; `handleSubmit` קורא `setup-complete` (אידמפוטנטי, עם retry) בשני הענפים — כך `pending→active` נסגר תמיד.
- תיקון נתונים חד-פעמי בפרודקשן: `profiles.status` של תמר ליאון (`9a0f5ab4-…`) עודכן מ-`pending` ל-`active`.
- `.claude/settings.local.json`: כלל הרשאה מקומי ל-Supabase Management API (curl).
- `frontend/src/lib/connectionError.js` (חדש): `describeConnectionError` / `diagnoseConnectionError` — מסווגים כשל בקשה ל: אין אינטרנט / timeout / חסימת רשת (ISP/אנטי-וירוס/פרוקסי) / תקלת שרת 5xx. למקרה "חסום" יש probe שקט ל-`/health` (mode:no-cors) שמבחין בין "השרת מגיב אך הרשת חוסמת CORS" לבין "השרת לא זמין".
- `frontend/src/pages/DashboardPage.jsx`: הודעת הכשל של טעינת בתי הספר עברה ל-`diagnoseConnectionError` במקום "ודא שהשרת פועל" הגנרי.
- `frontend/src/pages/LoginPage.jsx`: הודעת כשל התחברות עברה ל-`describeConnectionError`.
- `docs/network-block-troubleshooting.md` (חדש): מדריך מלא לצוות ולמשתמשים — זיהוי, בדיקות, פתרונות מדורגים, רשימת דומיינים ל-whitelist, ותבניות הודעה למשתמש ולספק האינטרנט.

## 2026-09-08 — עדכון אוטומטי של "עמידה ביעד" בטאב "יעדים" לפי ממצאי בדיקות
- מיגרציות Supabase: `school_goals` קיבלה `notes JSONB` (יומן append-only), `auto_last_met BOOLEAN`, `auto_last_check_at TIMESTAMPTZ`; `organizations` קיבלה `goal_auto_update_enabled BOOLEAN DEFAULT true`.
- `backend/goals_logic.py` (חדש): לוגיקת האוטומציה. משווה `pct_plan` (יעדי תכנון) / `pct_tanuz` (יעדי דיווח) מהבדיקה מול `goal_number` (אחוזים). מעדכן מתג כן/לא רק כשיש שינוי מהותי מהערך הנוכחי, ורק כל עוד לא עבר תאריך היעד (שעון ירושלים). כל שינוי מוסיף שורה ל-`notes`. `reset_auto_goals_for_combo` מנקה שורות auto כשלא נותרה בדיקה. `normalize_metric_rows` ממפה `"כללי"` → `"גפן"` כדי להתאים למה שהטאב קורא.
- `backend/routers/analyze_router.py`: `_maybe_auto_update_goals` נקרא בסוף `_save_check_log` (אחרי `_save_check_metrics`). מפעיל את האוטומציה לפי דגל הארגון, ושולח התראת toast מסכמת אחת למריץ הבדיקה (type `goal_auto_updated`).
- `backend/routers/schools_router.py`:
  - `set_goal_status` (PATCH ידני) מוסיף כעת שורת "עודכן על ידי [שם] ל׳כן/לא׳ בתאריך DD/MM/YY" ל-`notes`. עריכה ידנית זמינה תמיד.
  - `list_goals` מחזיר `notes`, `automation_active` לכל יעד, ו-`goal_automation_enabled` ברמת התשובה.
  - `delete_log` מריץ `_recompute_goals_after_log_delete` — מחשב מחדש כל שילוב חטיבה+תקציב מהבדיקה האחרונה שנותרה, או מאתחל אם לא נותרה.
  - endpoints חדשים `GET/PUT /schools/goals/automations` + הרשאה `can_edit_goal_automations` (owner תמיד; manager לפי הרשאה).
- `frontend/src/components/GoalAutomationsModal.jsx` (חדש): מודל אוטומציות בסגנון הפגישות.
- `frontend/src/components/GoalsTab.jsx`: כפתור "⚙️ אוטומציות" בקצה השמאלי של כותרת "יעדים"; עמודת "הערות" חדשה משמאל ל"עמידה ביעד" (מציגה את יומן ה-`notes`, אייקון נעילה כשעבר תאריך היעד); refetch אחרי עדכון ידני כדי למשוך את שורת ההערה מהשרת.
- `frontend/src/pages/SchoolPage.jsx`: מעביר `canEditAutomations` ל-`GoalsTab`.
- `frontend/src/components/NotificationToast.jsx`: אייקון 🎯 ל-`goal_auto_updated`.

### תיקון: ההתראה על עדכון יעדים כפופ-אפ ייעודי (לא בפעמון)
- ההתראה על "X יעדים עודכנו אוטומטית" מוצגת כעת כפופ-אפ מצד שמאל למטה בסגנון תזכורת פגישה (מתקפל לכותרת כשנערמים), ולא כרשומה באזור ההתראות/פעמון.
- `frontend/src/components/GoalUpdatePopup.jsx` (חדש): כותרת + "הצג פירוט" (רשימת היעדים שהשתנו: כן/לא · תיאור היעד — חטיבה / תקציב) + כפתורי "אישור" (מסמן את ההתראה כנקראת וסוגר) ו-"מעבר ליעדים".
- `frontend/src/context/MeetingRemindersContext.jsx`: `addGoalUpdateReminder` (סוג `goal-update`, keyed לפי מזהה ההתראה).
- `frontend/src/components/MeetingRemindersOverlay.jsx`: HEADER_META + רינדור `GoalUpdatePopup` לסוג `goal-update`.
- `frontend/src/components/Sidebar.jsx`: ה-polling של `/schools/notifications` קורא כעת גם `res.data.goal_auto_updates` ומפעיל את הפופ-אפ (ללא gating של first-load).
- `backend/routers/schools_router.py` `get_notifications`: `goal_auto_updated` מוחרג מ-`items` ומהספירה, ומוחזר בשדה נפרד `goal_auto_updates` (רק שלא-נקראו) — כך אין לו נוכחות בפעמון.
- `backend/routers/analyze_router.py` `_maybe_auto_update_goals`: ה-`data` של ההתראה מועשר ב-`school_name`, `check_dt`, ורשימת `goals` (label/division_type/budget_name/met) עבור הפירוט בפופ-אפ; ה-deeplink כולל `&year=`.
