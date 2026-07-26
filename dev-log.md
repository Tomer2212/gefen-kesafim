# Dev Log

## 2026-07-26 — תיקוני UX בזרימת "תיאום ישיר"
- שדות תאריך בחלונית `DirectCoordinationModal.jsx` (מתאריך/עד תאריך) הוחלפו משדה `type="date"` (פורמט תלוי דפדפן/מערכת) לשדה טקסט עם מסכה קבועה `DD/MM/YY` — שנה דו-ספרתית מתפרשת אוטומטית כ-20YY.
- בדף הציבורי (`MeetingBookingPage.jsx`), בחירת שעה (גם ב"מצב חודשים" הישן וגם ב"מצב טווחים" החדש) כבר לא קובעת פגישה מיידית בלחיצה — לחיצה על שעה רק מסמנת אותה (תכלת לייט), וכפתור "אישור" חדש בתחתית הוא זה שבפועל שולח את הבקשה לשרת. לאחר אישור מוצגת חלונית סיכום עם כל פרטי הפגישה שנקבעה (תאריך, שעה, ומשתתפים במצב טווחים).
- `npx vite build` עבר בהצלחה (0 שגיאות).

## 2026-07-26 — כפתור "תיאום ישיר" בטאב פגישות (ניהול)
- כפתור חדש ליד "הוסף פגישה" ב-`AdminMeetingsTab.jsx`: בחירת בית ספר → חלונית `DirectCoordinationModal.jsx` חדשה — בחירת כמה יועצים מבצעים, וכמה "פגישות" (טווח תאריכים + סוג גפן/שוטף + משך + משתתפים מוגדרים מראש מתוך אנשי הקשר של בית הספר, נבחר ע"י המנהל).
- שליחה יוצרת endpoint חדש `POST /schools/{id}/meetings/direct-coordination` (`schools_router.py`) ששולח מייל למתאם/ת הפגישות של בית הספר (שדה `meeting_coordinator_contact` הקיים — בשימוש בפועל לראשונה) עם קישור דינמי לבחירת מועד.
- Supabase: `meeting_booking_tokens` קיבלה 3 עמודות חדשות (`advisor_ids`, `date_ranges`, `booked_ranges`) — תומכות ב"מצב טווחים" חדש לצד "מצב חודשים" הקיים של הסוכן (ללא נגיעה בהתנהגות הקיימת).
- `backend/booking_token_logic.py` — `create_direct_booking_token` (טוקן חדש תמיד, בלי לוגיקת שימוש-חוזר).
- `backend/booking_logic.py` — `build_direct_coordination_email_html` (מציג כל טווח/פגישה כפריט נפרד).
- `backend/routers/meeting_booking_router.py` — הורחב לתמוך ב"מצב טווחים": זמינות נבדקת כחיתוך בין כל היועצים שנבחרו (מספר יועצים על אותה פגישה), ו-`sync_meeting_create` הקיים כבר תומך בכך.
- `frontend/src/pages/MeetingBookingPage.jsx` — מציג לפי `data.mode`: "months" (התנהגות קיימת) או "ranges" (כרטיס לכל פגישה עם משתתפים לקריאה בלבד ובחירת מועד).
- `npx vite build` עבר בהצלחה (0 שגיאות).

## 2026-07-25 — "סוכן ניהול" שלב 3: חיבור לכל המערכת דרך מנוע "משימות" הקיים
- Backend: `agent_router.py` — הוסרו 4 הכלים הישנים הספציפיים ל"פגישה חסרה" (`find_schools_missing_meetings`/`update_draft_school`/`set_booking_defaults`/`confirm_send_booking_emails`), הוחלפו ב-8 כלים כלליים שמתחברים למנוע ה"משימות" הקיים (`task_logic.py`/`tasks_router.py`) במקום לשכפל את הלוגיקה שלו: `find_schools_by_criteria` (קריטריונים AND/OR על שדות/פגישות — שימוש חוזר ב-`task_logic.find_matching_schools`), `find_schools_by_contact_name` (חדש — חיפוש הפוך לפי שם מנהלנית/מנהל), `start_task_for_schools`, `set_task_message`, `resolve_task_advisor`, `set_task_scheduling_window`, `create_and_send_task` (יוצר `org_tasks` אמיתי + שולח דרך `tasks_router._queue_messages_for_schools` הקיים — או ישירות מול `booking_token_logic` כשההודעה מכילה `{booking_link}`, כדי לשמר את שאלות ההבהרה החכמות סביב יועץ/חלון זמנים שהמנוע הרגיל לא שואל), `get_task_status` (שימוש חוזר ב-`task_logic.compute_task_progress`)
- Backend: `task_logic.py` — פונקציה חדשה `find_schools_by_contact_name` (ILIKE על principal_name/secretary_name/finance_contact_name, לא כולל extra_contacts)
- Backend: `org_task_draft_state.py` חדש — טיוטת אצווה רב-תורית כללית (לא רק "פגישה חסרה"), אותה תבנית כמו `booking_draft_state.py` הקודם
- Supabase: טבלה חדשה `org_task_drafts` (GRANT/RLS/policy מלאים ל-service_role)
- **איסור מוחלט על מחיקה**: אין אף כלי חדש עם יכולת מחיקה (בית ספר/פגישה/משימה/משתמש) — נבדק במפורש שהסוכן מסרב לבקשת מחיקה
- `meeting_booking_drafts`/`meeting_booking_tokens`/`meeting_booking_email_queue` (מהשלב הקודם) **לא נמחקו** — פשוט לא נכתב אליהן עוד קוד חדש; `booking_logic.py`/`booking_token_logic.py`/`meeting_booking_router.py` (עמוד השריון הציבורי) נשארו ללא שינוי ומשמשים גם את הזרימה החדשה
- נבדק קצה-לקצה: חיפוש לפי שם איש קשר, חיפוש לפי קריטריון (עם ניתוב נכון לכלי הסינון הקל כשמדובר בסינון תצוגה בלבד ולא במשימה), זרימה מלאה של פתיחת משימה → הרכבת הודעה → אישור מפורש → יצירת `org_tasks`/`org_task_messages` אמיתיים
- **הערה על מהימנות**: כמו בשלב הקודם, זיהוי "אישור שליחה" מבוסס על הבנת המשמעות ע"י המודל ולא על מילות מפתח — לעיתים נדירות ייתכן שהמודל ישאל שוב במקום לשלוח (בטוח — לא שולח כלום בטעות), ואז צריך לומר לו במפורש "כן, שלח עכשיו". חוזק ניכר לאחר הוספת דוגמה מפורשת בפרומפט (3/3 הצלחות בבדיקה חוזרת, לעומת 1/2 קודם לכן)

## 2026-07-24 — מנוע "משימות" תפעוליות בטאב בתי ספר (ניהול)
- טבלאות חדשות ב-Supabase: `org_tasks`, `org_task_messages`, `twilio_connections` (GRANT/RLS/policies מלאים).
- `backend/task_logic.py` — מנוע קריטריונים אחיד (AND/OR) לתנאי "פגישה" ו"שדה בית ספר".
- `backend/routers/tasks_router.py` — יצירת/ניהול/שליחת משימות, כולל תור שליחה + קרון (`.github/workflows/task-message-queue.yml`).
- `backend/whatsapp_twilio.py` — תשתית בלבד לוואטסאפ (Twilio), ללא חיבור API בפועל.
- הרחבת `email_resend.py` ו-`graph_client.py` לתמיכה בצירופי קבצים.
- Frontend: `TaskListBar` / `TaskCreateWizard` / `TaskPanel` (חלונית צפה, גרירה/שינוי גודל/מזעור) / `TaskMissingContactModal` — שולבו בטאב "בתי ספר" ב-AdminPage.
- כרטיס "Twilio (וואטסאפ)" חדש באזור אינטגרציות, באותה תבנית כמו כרטיס Voicenter.
- `npx vite build` עבר בהצלחה (0 שגיאות); ייבוא מלא של `main.py` נבדק ועבר.

## 2026-07-24 — תיקון קריסה + תזמון משימות ותזמון שליחה
- תוקנה קריסת `TaskCreateWizard` (מעבר משלב 1 ל-2) שנגרמה מ-state לא מוגן מול תשובת שרת בלתי צפויה.
- עמודות חדשות: `org_tasks.scheduled_for`, `org_tasks.academic_year`, `org_task_messages.scheduled_at`.
- אפשרות ליצור משימה עם תאריך עתידי לבדיקת הקריטריונים (סטטוס "מתוזמן") — נבדקת אוטומטית בתאריך שנבחר דרך `POST /tasks/process-scheduled-tasks` (`.github/workflows/task-scheduled-tasks.yml`, שעתי).
- אפשרות לתזמן את מועד השליחה בפועל של הודעה גורפת מחלונית המשימה (לא רק שליחה מיידית).

## 2026-07-24 — עמודת "סוג" חדשה בטבלת פגישות (גפן/שוטף/גפן+שוטף)
- עמודה חדשה "סוג" נוספה משמאל לעמודת "מיקום" הקיימת בטבלת הפגישות — בחירה יחידה (כמו "מיקום"), אפשרויות: גפן/שוטף/גפן+שוטף (`MEETING_SERVICE_TYPE_OPTIONS` חדש ב-`constants.js`, רכיב חדש `MeetingServiceTypeSelect.jsx`, כמעט זהה ל-`MeetingTypeSelect.jsx` הקיים)
- עמודת DB חדשה `meeting_service_type` (TEXT) בטבלת `meetings`; `MeetingIn` וה-endpoints (`create_meeting`/`update_meeting`) עודכנו — בדיקת `is not None` (לא truthy) כדי שניקוי ידני לריק יישמר בפועל
- ברירת מחדל ביצירת פגישה חדשה: אם ל`סוג שירות` של בית הספר (`school_year_admin_data.service_type`) יש ערך חד-משמעי (גפן/שוטף) — השדה מתמלא אוטומטית באותו ערך (ניתן לשינוי); אם הבית ספר "גפן+שוטף" או ללא הגדרה — נשאר ריק. מומש בשלושת משטחי הפגישות (SchoolPage.jsx, PersonalMeetingsTab.jsx, AdminMeetingsTab.jsx — בשני האחרונים נוסף fetch נוסף ל-`GET /schools/{id}/year-admin-data` לפני יצירת הפגישה)
- כאשר השדה ריק (בין אם חסרה ברירת מחדל חד-משמעית ובין אם נוקה ידנית) — מוצגת מסגרת אדומה, באותו סגנון ויזואלי בדיוק כמו התנגשות זמן התחלה/סיום קיימת (`TimeInput.jsx`) — אינדיקציה בלבד, לא חוסמת שמירה
- עודכנו כותרות/שורות ייצוא Excel/PDF בשני קבצי טאבי הפגישות (AdminMeetingsTab.jsx, PersonalMeetingsTab.jsx) לכלול את העמודה החדשה

## 2026-07-24 — תיקוני UX ו"תבניות" באשף יצירת משימה
- תיקון שורש: תהליך uvicorn מקומי ישן (ללא הקוד החדש) המשיך לענות על localhost:8000 במקביל לתהליך העדכני — זו הסיבה לכל שגיאות ה-404 שראית. הופעל מחדש תהליך אחד נקי.
- תנאי "סוג פגישה" בבניית משימה משתמש עכשיו בשדה `meeting_service_type` (גפן/שוטף/גפן+שוטף — אותו שדה כמו עמודת "סוג" בטבלת הפגישות), במקום `meeting_type` (פיזי/מרחוק) שהיה שגוי.
- נוסף נמען "אחראי/ת לתיאום פגישות" (לפי הגדרת בית הספר) לבחירת נמען — עם resolve שרתי דרך `PUT /tasks/{id}/schools/{id}/contact-info` שיודע לפתור את התפקיד בפועל לכל בית ספר.
- נוספה מערכת תבניות הודעה: טבלה `org_task_message_templates`, endpoints לשמירה/שליפה, תבנית מובנית "ברירת מחדל — קביעת פגישות" שמוצעת אוטומטית כשמזוהה תבנית משימה של "אין פגישה", ואפשרות לשמור תבנית מותאמת לשימוש עתידי.
- כפתור "קבצים מצורפים" הוחלף באייקון צירוף (כמו ב-Gmail) במקום קלט קובץ גולמי.
