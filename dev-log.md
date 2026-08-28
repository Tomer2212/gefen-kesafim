# Dev Log

## 2026-08-28 — פיצ'ר חדש: "שעון נוכחות" (אזור אישי + ניהול)

### מיגרציות DB (Management API, אומתו — grants/RLS/policies/columns)
- **3 טבלאות חדשות**:
  - `attendance_entries` — שורה אחת ליום לעובד: `org_id`, `user_id`, `entry_date`, `day_type`
    (`work_home`/`field`/`vacation`/`sick`/`reserve`/`other`, ברירת מחדל `work_home`),
    `start_time`/`end_time` (טקסט `HH:MM`), `work_minutes` (INT מחושב, תומך חציית חצות),
    `notes`, `files` JSONB, `created_by`/`updated_by`/`created_at`/`updated_at`.
    `UNIQUE(user_id, entry_date)` + אינדקס `(org_id, user_id, entry_date)`.
  - `attendance_month_locks` — קיום שורה `(user_id, month='YYYY-MM')` = החודש נעול לעריכה.
  - `attendance_audit_log` — עקבות שינויים (תיקון 24): `create`/`update`/`delete`/`lock`/
    `unlock`/`file_add`/`file_remove` עם `actor_id`, `target_user_id`, `diff` JSONB.
- כולן: `GRANT ... TO service_role` + `ENABLE RLS` + policy הגנתית `FOR ALL TO authenticated USING (auth.uid() IS NOT NULL)`.
  **ללא** `GRANT TO authenticated` — כל הגישה דרך ה-backend (service_role); הפרונט לא ניגש ישירות.

### Backend — `routers/attendance_router.py` (חדש, prefix `/attendance`)
- נרשם ב-`main.py` (import + `include_router`).
- דפוס CLAUDE.md §5/§6: כל GET עם `for attempt in range(2)` + `get_admin_client()` בתוך ה-`try`
  + `reset_admin_client()` + `HTTPException(503)`. הרשאה דרך `Depends(get_current_user)`, org תמיד `user["org_id"]`.
- **עובד** (`/my`): `GET /my?month=` (entries + מצב נעילה), `PUT /my/{date}` (upsert יום —
  מחשב `work_minutes`, 403 אם החודש נעול, כותב audit), `DELETE /my/{date}`,
  `POST|DELETE|GET /my/{date}/files[/{file_id}]` (העלאה: PDF/JPG/PNG בלבד, עד 10MB,
  `tempfile.mkdtemp`→Storage `check-files` תחת `attendance/{user_id}/{date}/...`, ניקוי ב-`finally`;
  הורדה = proxy bytes עם `Content-Disposition` RFC5987).
- **ניהול** (`/admin`, `_require_manager`): `GET /admin?user_id=&month=`, `GET /admin/all?month=`
  (כל העובדים advisor+manager + סיכום לכל אחד — משמש גם לייצוא), `PUT|DELETE /admin/{user_id}/{date}`
  + נתיבי קבצים מקבילים (כולם 403 אם החודש נעול — יש לשחרר קודם), `POST|DELETE /admin/lock`
  (נעילה/שחרור חודש + audit).
- קבצי נוכחות **אינם** נכללים בניקוי האוטומטי ב-`main.py` (שמירה לצמיתות — חובה משפטית).
- החלטות מוצר: מנהל = צפייה+עריכה+נעילה; כל ימי החודש מוצגים (שישי/שבת מודגשים); ממלאים =
  advisor+manager בלבד (לא owner); חישוב שעות תומך משמרת חוצת חצות; סיכום = סה"כ שעות +
  ימי מחלה/מילואים/חופש + ימי עבודה בפועל + ממוצע שעות ליום.

### Frontend — רכיבים חדשים תחת `components/attendance/`
- `attendanceConstants.js` — `DAY_TYPES`/`DAY_TYPE_LABEL`, `WEEKDAY_HE`, `buildMonthDays`,
  `computeWorkMinutes` (חציית חצות), `formatMinutes`, `monthSummary` (מקביל ל-`_summary` ב-backend),
  עוזרי מפתח-חודש. `HEBREW_MONTHS` מיוצא מחדש מ-`components/meetings/constants`.
- `AttendanceTable.jsx` + `AttendanceRow.jsx` — שורה לכל יום קלנדרי; שמירה אוטומטית: "סוג"
  (`<select>`) נשמר מיד, שעות נשמרות ב-blur מהשורה (דפוס `MeetingRow`). שימוש חוזר ב-`TimeInput` +
  `normalizeTimeValue` מ-`components/meetings/TimeInput`. שישי/שבת → `bg-slate-100`.
- `AttendanceNotesModal.jsx` / `AttendanceFilesModal.jsx` — `useFocusTrap` + `role="dialog"`;
  מודאל הקבצים בודק סוג/גודל בצד לקוח, מציג רשימה + הורדה + מחיקה.
- `AttendanceSummary.jsx` — כרטיס סיכום חודשי (6 מדדים).
- `AttendanceCalendar.jsx` — גוף משותף: בורר חודש + סינון סוג + באנר נעילה + טבלה + סיכום +
  מודאלים; מקבל את כל פעולות ה-mutation מההורה + `headerExtra` לתוספות של הניהול.
- `pages/PersonalAttendanceTab.jsx` (חדש) — טאב באזור האישי (מצב UI ב-`sessionStorage`).
- `pages/AdminAttendanceTab.jsx` (חדש) — בורר עובד + נעל/שחרר חודש + "ייצוא לאקסל — כל העובדים,
  חודש זה" (SheetJS בצד לקוח, גיליון RTL אחד, בלוק שורות + שורת סיכום לכל עובד).

### חיווט
- `ProfilePage.jsx`: טאב "שעון נוכחות" מימין ל"פרטים אישיים" — רק ל-`advisor`/`manager`
  (`BASE_TABS` + `canSeeAttendance`; `TAB_IDS` כולל אותו לשחזור מ-`?tab=`).
- `AdminPage.jsx`: `showAttendanceTab` (owner/manager), טאב "שעון נוכחות" אחרי "פגישות",
  נוסף לרשימת רוחב `max-w-[100rem]`.

### תיקוני המשך (אחרי בדיקת המשתמש בדפדפן)
- **באג שמירה — שורש**: `frontend/vite.config.js` מפנה (proxy) רק קידומות נתיב מפורשות ל-backend,
  ו-`/attendance` לא היה ברשימה → כל קריאת `/attendance/*` מהדפדפן נפלה ל-SPA fallback של Vite
  (`index.html`, סטטוס 200) במקום להגיע ל-backend. אין שגיאה, שום דבר לא נשמר, הטבלה מוצגת ריקה.
  **תוקן**: נוסף `"/attendance": { target: "http://127.0.0.1:8000", changeOrigin: true }`. Vite
  הופעל מחדש אוטומטית; אומת ש-`GET /attendance/my` דרך :5173 מחזיר `403 application/json` (backend).
- **עמודת "סוג"** (`AttendanceRow.jsx`): ה-`<select>` הפך לטקסט בלבד — מסגרת/רקע מופיעים רק
  ב-hover/focus (שינוי נדיר, לא רוצים מסגרת בולטת קבועה).
- **אזור השעות** (`AttendanceRow.jsx` + `AttendanceTable.jsx`): שלוש עמודות "שעת התחלה/סיום/שעות
  עבודה" קובצו ויזואלית — כותרות ותאים ברקע תכלת (`bg-sky-*`) עם מסגרות צד, שדות שעה בתוך
  קופסאות לבנות ממוסגרות (`focus-within` כחול), ושעות העבודה כגלולה מודגשת. הטבלה קיבלה מסגרת
  חיצונית מעוגלת.
- **סבב שני של כוונון UI**: שדות שעת התחלה/סיום ממורכזים (`[&_input]:text-center` + `mx-auto`);
  ה-`<select>` של "סוג" קיבל `appearance-none` — חץ הנפתח הוסר, מוצג רק המלל הנבחר; שישי/שבת
  צבועים באדום עדין מאוד (`bg-red-50/70`, כולל תאי השעות ב-`TIME_CELL_WEEKEND`) במקום אפור,
  ותווית היום בסופ"ש ב-`text-red-400`.
- **סבב שלישי**:
  - מיקום טאבים: ניהול — "שעון נוכחות" הועבר לבין "ביצועים" ל"גבייה" (`AdminPage.jsx` מערך `tabs`).
    אזור אישי — הועבר לבין "משימות" ל"פרטים אישיים" (`BASE_TABS` ב-`ProfilePage.jsx`), כלומר
    משמאל ל"משימות" ב-RTL.
  - כותרות + סיכום קפואים: `AttendanceCalendar` הפך ל-flex column בגובה `calc(100dvh - topOffset)`;
    סרגל הסינון + באנרים `shrink-0` למעלה, `AttendanceTable` ב-`flex-1 min-h-0` עם גלילה פנימית
    (`h-full overflow-auto`) ו-`<th>` דביקים (`sticky top-0 z-20` + רקע אטום), `AttendanceSummary`
    ב-`shrink-0` תמיד גלוי למטה. `topOffset`: 190 אזור אישי, 250 ניהול.
  - החצים בבורר החודש הוחלפו ויזואלית בלבד (‹ ⇄ ›) — ה-onClick וה-aria-label לא נגעו.
  - הסרה: `AttendanceFilesModal` — כפתור "הסר" מפורש לכל קובץ (במקום ✕); `AttendanceNotesModal` —
    כפתור "הסר הערה" (מופיע כשיש הערה שמורה) שקורא `onSave("")` ומנקה אותה.
- **סבב רביעי**:
  - גריד אחיד: הרקע התכלת + קווי ההפרדה חלים כעת על **כל** העמודות (תאריך/סוג/קבצים/הערות),
    לא רק על עמודות השעות. `AttendanceTable` עבר ל-`border-separate border-spacing-0` עם
    `border-b border-l` לכל תא, רקע שורה `bg-sky-50/60` (סופ"ש `bg-red-50/70`), כותרות `bg-sky-100`.
  - ייצוא אקסל גם באזור האישי: `PersonalAttendanceTab` מקבל `userName` ומציג כפתור "ייצוא לאקסל —
    החודש הזה" (רק המשתמש הנוכחי + החודש הנבחר). לוגיקת הייצוא חולצה ל-`components/attendance/
    attendanceExport.js` (`exportAttendanceXlsx`) — משותפת עם `AdminAttendanceTab` (שם נשלף
    `/attendance/admin/all` וממופה ל-`{name, entries}`).
  - גובה נעול נמדד: `AttendanceCalendar` מודד את `getBoundingClientRect().top` ונועל גובה ל-
    `innerHeight - top - 56` (`useLayoutEffect` + resize), במקום `calc(100dvh - topOffset)` מנוחש.
    הרוט `overflow-hidden` — אין יותר אזור לבן לגלול אליו מתחת לטבלה. הוסר ה-prop `topOffset`.
- **סבב חמישי**:
  - צבעים: הרקע התכלת הוסר לגמרי. הטבלה חזרה ללבן עם טקסט אפור (כמו קודם) — כותרות `bg-white
    text-slate-500`, שורות `bg-white` (סופ"ש `bg-red-50/70`), קווי גריד `border-slate-200`.
  - מדידת הגובה חוסנה: `docTop = rect.top + window.scrollY` (חסין למצב גלילה), guard ל-`docTop<50`,
    מדידה חוזרת ב-`requestAnimationFrame`, `bottomGap` הוקטן ל-40 (תואם ל-`pb-10` של העמוד) —
    כדי שהעמוד לא יגלול כלל לאזור הלבן.
  - יותר שורות באזור הגלילה: סרגל הסינון קומפקטי (`p-3`), ו-`AttendanceSummary` הפך לשורה אחת
    צפופה (כותרת אינליין, אריחים `py-1.5 text-base`) במקום כרטיס גבוה — משחרר גובה לשורות.
- **סבב שישי**:
  - גלילת עמוד ננעלת לגמרי כל עוד הטאב פתוח: `AttendanceCalendar` עושה `window.scrollTo(0,0)` +
    `document.body.style.overflow = "hidden"` ב-`useLayoutEffect` ומשחזר בניקוי. אין יותר שום
    אפשרות לגלול לאזור הלבן. `bottomGap` הוקטן ל-16 (מקסימום שורות).
  - פס הגלילה של הטבלה: הועבר לצד ימין (`dir="ltr"` על מיכל הגלילה, `dir="rtl"` על ה-`<table>`)
    ועובה ל-24px עם ידית מעוגלת (`[&::-webkit-scrollbar]:w-[24px]` וכו').
  - הידית לא בלטה — עודכנה לאפור מלא ובולט: מסילה `bg-slate-200`, ידית `bg-slate-500`
    (`slate-600` ב-hover), רוחב 22px, `scrollbarColor` ל-Firefox.
  - ריכוך: מסילה `slate-100`, ידית `slate-300` (`slate-400` hover) — רק גוון אחד כהה מהמסילה.
  - שדות שעת התחלה/סיום: המסגרת מופיעה **רק ב-focus** (כחולה). גם כשיש ערך מוזן — הטקסט מוצג
    ללא קופסה עד שלוחצים על השדה. הרוחב קבוע (`border-transparent`) כך שאין קפיצה. ב-readOnly
    מוצג הטקסט/"—" בלבד.
  - שישי/שבת: "סוג" ריק כברירת מחדל (`draftFromEntry(entry, isWeekend)` → `""` בסופ"ש ללא
    רשומה; אופציה ריקה נוספת ל-`<select>` כל עוד לא נבחר סוג). משתמש שבוחר סוג / מזין שעות —
    נשמר כרגיל (השרת מקבע `""`→`work_home`).

### וידוא
- `npx vite build` עבר ב-0 שגיאות (גם אחרי תיקוני ה-UI).
- `python -c "import main"` עבר; כל 15 נתיבי `/attendance/*` רשומים; round-trip SQL אימת
  שמבנה הטבלה (`files` jsonb, `work_minutes` int, upsert `ON CONFLICT (user_id, entry_date)`
  שומר על `files` קיים).
- חוסלו תהליכי `uvicorn --reload` ישנים והופעל מופע רענן — `/attendance/my` מחזיר 403 (auth),
  `/attendance/admin/lock` מחזיר 405 ל-GET (POST/DELETE בלבד).
- **טרם נבדק בדפדפן מול משתמש אמיתי** (נדרש JWT) — יש להריץ את תרחישי הבדיקה שבתוכנית.

## 2026-08-28 — הדגשת סינון פעיל בפסיפת הפגישות (ניהול + אזור אישי)
- **הבעיה**: כמה משדות הסינון בטאב "פגישות" נושאים ברירות מחדל "נסתרות" שקל לפספס — לדוגמה
  ב"ניהול" הסטטוס מוגדר כברירת מחדל ל"נקבעה" (לא "הכל") ו"עד תאריך" לברירת מחדל של היום
  (לא ריק) — כך שמשתמש יכול להישאר עם סינון פעיל בלי לשים לב, ולא להבין למה פגישה מסוימת
  לא מופיעה ברשימה (בדיוק מה שקרה בטסט האחרון של המשתמש)
- **התיקון**: `AdminMeetingsTab.jsx` ו-`PersonalMeetingsTab.jsx` — כל שדה בפס הסינון (בסיסי
  ומתקדם) מקבל כעת סימון עדין כשהוא חורג מברירת המחדל שלו: תווית בצבע כחול + נקודה קטנה
  ליד התווית + מסגרת/רקע כחולים עדינים על השדה עצמו. רכיב חדש משותף `FilterLabel` (מוגדר
  זהה בשני הקבצים, כמו שאר הדפוסים המשותפים בין המשטחים). כפתור "נקה סינון" מקבל תג מספר
  (כמו שכבר קיים בכפתור "סינון מתקדם") ומשתנה לכחול כשיש סינון פעיל כלשהו
- `SchoolPage.jsx` לא נגע — אין שם פסיפת סינון מקבילה (לפי בדיקה מפורשת מול המשתמש)
- שינוי עיצובי/UX בלבד — לא שונתה לוגיקת הסינון עצמה
- `npx vite build` עבר ב-0 שגיאות

## 2026-08-28 — מתג "תזכורת": כתיבה ייעודית ב-PATCH (מונע דריסה במרוץ autosave)
- **הבעיה שהתגלתה בבדיקה**: אחרי שהמתג נדלק אוטומטית (create/flip), autosave של שדה אחר בשורה
  שולח ב-PUT את הערך הנוכחי של `reminder_enabled` — ואם הוא מרוץ מול ההדלקה מהשרת, הוא דרס
  אותה בחזרה ל-false. `update_meeting` כתב את `reminder_enabled` מגוף הבקשה ללא תנאי בכל PUT.
- `schools_router.py`:
  - `update_meeting`: **הוסרה** הכתיבה הלא-מותנית של `reminder_enabled` מ-`data`. PUT יכול רק
    להדליק במפורש (`body.reminder_enabled is True`) — לעולם לא לכבות. לוגיקת ה-flip (הדלקה
    אוטומטית במעבר לא-כשיר→כשיר) נשמרה.
  - `MeetingStatusPatchIn` + `patch_meeting` (`PATCH /schools/{sid}/meetings/{mid}`): נוסף
    `reminder_enabled` — זהו כעת הנתיב היחיד שמכבה תזכורת (וגם מדליק ידנית).
- `MeetingRow.jsx`: המתג (וניקוי אוטומטי כשמסירים את המשתתף האחרון) קוראים ל-`patchReminder`
  שעושה `axios.patch` ייעודי + `onMeetingPatched` לעדכון ה-state בהורה. הוסרה ההסתמכות על blur
  לשדה הזה.
- `MeetingsTable.jsx` + שלושת ההורים: נוסף prop `onMeetingPatched`; `updateMeeting` בשלושתם
  כבר לא שולח `reminder_enabled` ב-PUT.
- **וידוא**: סקריפט מול ה-DB האמיתי איפס את פגישת הבדיקה של המשתמש (משתתפים=[], מתג=false)
  והריץ את לוגיקת ה-flip → org_on=True, was=False, now=True → נדלק ל-True. הלוגיקה תקינה;
  הכשל הקודם היה קוד backend ישן שרץ ב-`uvicorn --reload` שלא נטען מחדש.
- `npx vite build` עבר ב-0 שגיאות; backend עבר `py_compile`.

## 2026-08-28 — תיקון סטטוס פגישה שסותר את הסיווג האמיתי (מצב עבר/עתיד) בייבוא
- **הבאג שאותר**: כשמשתמש בוחר "תיעוד פגישות עבר" אבל שורה בקובץ מתוארכת בפועל לעתיד (ומאשר
  את ה"בעיה" mode_date_mismatch שקופצת בצדק) — הסיווג האמיתי (`effective_mode`) הופך ל-
  "future" (דורש יועץ, עובר בנתיב סנכרון Outlook), אבל עמודת ה"סטטוס" בקובץ עצמו נשארה
  "בוצעה" (כי הארגון מילא אותה מתוך הנחה שזו פגישת עבר) — והשורה נשמרה בפועל עם `status:
  "completed"` על פגישה עתידית, מה שסותר לוגית (פגישה בעתיד לא יכולה להיות "כבר בוצעה")
- **וידאתי ב-Supabase**: 2 שורות מהטסט האחרון של המשתמש נכנסו בדיוק כך — `meeting_date:
  2026-10-02`/`2026-10-01` (עתידי), `status: "completed"`, `academic_year: "תשפ\"ז"` — הן
  *כן* נכנסו בהצלחה ל-DB, אבל תויגו לשנת הלימודים תשפ"ז (נכון, לפי התאריך האמיתי שלהן) בעוד
  שהחיפוש של המשתמש כנראה סונן על תשפ"ו — זו הסיבה הסבירה ביותר לכך שהן "לא הופיעו"
- **התיקון**: ב-`commit_meeting_import`, לפני כתיבת השורה — אם `effective_mode == "future"`
  והסטטוס שהתקבל הוא "completed", נכפה ל-"scheduled"; ואם `effective_mode == "past"` והסטטוס
  "scheduled", נכפה ל-"completed". סטטוסים ניטרליים (בוטלה/נדחתה/אחר) לא נוגעים בהם — נשארים
  כפי שהוגדרו בקובץ ללא קשר לתזמון
- לא תוקנו בפועל 2 השורות שכבר נכנסו ל-DB מהטסט (נתוני בדיקה של המשתמש) — נדרש אישור מפורש
  לפני שינוי/מחיקה שלהן
- ה-backend נבדק ב-import מלא ללא שגיאות

## 2026-08-27 — מתג "תזכורת" בפגישות: ברירת מחדל אוטומטית + הפרדת האוטומציות מהשליחה
- **המשמעות של אוטומציה "שליחת תזכורת למשתתפים" (`meeting_reminders_enabled`) השתנתה** — היא כעת
  **רק קובעת ברירת מחדל בזמן יצירת פגישה**, ולא נבדקת יותר בזמן השליחה. עד היום היא שימשה
  כ"מפסק" ב-`send_due_reminders` וחסמה שליחה גם כשהמתג בשורה היה דלוק.
- `schools_router.py` — פונקציות עזר חדשות `_org_reminders_default_on(db, school_id)` ו-
  `_reminder_eligible(meeting_date, participants, org_on)` (משתתף ≥1 + תאריך עתידי לפי Asia/Jerusalem).
- `create_meeting`: אם הלקוח לא שולח `reminder_enabled` — השרת מחשב אותו: ON רק כשהאוטומציה דלוקה
  ולפגישה יש משתתף ותאריך עתידי. ערך מפורש מהלקוח (למשל `meeting_booking_router` ששולח True) מכובד.
- `update_meeting`: מדליק אוטומטית מתג שעדיין כבוי ברגע שהפגישה "הופכת כשירה" (נוסף משתתף ראשון
  או נקבע תאריך עתידי), אלא אם המשתמש כיבה אותו בעצמו קודם.
- `send_due_reminders`:
  - השאילתה כבר לא מסננת `reminder_enabled = True` (עדיין מוגבלת ל-`status=scheduled` + תאריך היעד).
  - האוטומציה הראשונה הוסרה לחלוטין מלוגיקת השליחה. המתג בשורה = מקור האמת למשתתפים הרגילים.
  - האוטומציה השנייה (`secretary_upload_request_enabled`) נשארת מפסק חי ועצמאי — המנהלנית/כספים
    מקבלים בקשת קבצים בפגישת גפן/מחוז גם כשהמתג כבוי; כשהיא כבויה והמתג דלוק — נופלים לתזכורת רגילה.
  - פגישה בלי כלום לשלוח → מדולגת לפני כתיבה ל-`meeting_reminders`.
- Frontend: הוסר `reminder_enabled: false` מ-payload היצירה ב-`SchoolPage.jsx`, `AdminMeetingsTab.jsx`
  (2 נתיבים), `PersonalMeetingsTab.jsx` (השרת מחשב). נתיב הייבוא לא נגע — נשאר `false`.
- `MeetingRow.jsx`: effect שמסנכרן `reminder_enabled` מה-prop (הדלקה מהשרת נראית מיד בלי רענון);
  תג "נשלח ל-X/Y" נשלף/מוצג גם כשהמתג כבוי אם הפגישה גפן/מחוז ויש בה מנהלנית/כספים.
- `MeetingAutomationsModal.jsx`: נוספו תת-כותרות הסבר לשתי האוטומציות.
- `CLAUDE.md`: נוסף כלל קשיח שמתעד את הסמנטיקה (אוטומציה 1 = ברירת מחדל ליצירה בלבד).
- אין שינוי סכימה. פגישות קיימות לא משתנות. `npx vite build` עבר ב-0 שגיאות; ה-backend נבדק ב-`ast.parse`.

## 2026-08-27 — תיקון שורש נוסף: תאריכים/שעות מתאי Date/Time אמיתיים בייבוא פגישות
- **שורש שונה לגמרי מהתיקון הקודם**: הפעם התא בקובץ היה תא Date/Time **אמיתי** של Excel
  (לא טקסט חופשי כמו "20.04.26") — המספר הסידורי הגולמי בקובץ היה מדויק לחלוטין (46027=
  5.1.2026, 0.5=12:00, 0.5472222222222223=13:08 — וידאתי עם openpyxl + עם ספריית ה-`xlsx`
  הפרונטית עצמה, על התא הגולמי, מול הקובץ האמיתי שהמשתמש סיפק)
- **הבאג האמיתי**: הקריאה עם `cellDates: true` (שנוספה בסבב הקודם כדי לפתור בעיה אחרת —
  מספר סידורי גולמי שנשלח כטקסט) ממירה את הסריאל לאובייקט `Date` של JS — והמרה הזו של
  ספריית ה-xlsx הוכחה **פגומה בפועל**: וידאתי ישירות (Node, אותה ספרייה, אותו קובץ) שהיא
  מחזירה סטייה של 2+ שעות מהערך האמיתי (12:00 → 09:39 וכו') גם על תאים מדויקים לחלוטין.
  זו לא הייתה בעיית timezone/getter (UTC מול local) — נבדקו שניהם, שניהם שגויים, כי הבעיה
  היא בהמרה הפנימית של הסריאל ל-Date עצמה, לפני שמגיעים לשליפת רכיבים ממנה
- **התיקון**: `cellDates` הוסר לגמרי. `ImportMeetingsModal.jsx` קורא כעת את המספר הסידורי
  הגולמי (`number`, ללא המרה של הספרייה) ומבצע בעצמו את חישוב סריאל→תאריך/שעה, באריתמטיקה
  זהה ל-`_parse_import_date` שכבר קיים ב-backend (אותו epoch `1899-12-30`) — פונקציות חדשות
  `excelSerialToDateISO`/`excelSerialToTimeHHMM` (עיגול לדקה הקרובה, חסין לרעש floating-point)
- **וידוא**: הרצתי סקריפט Node המדמה בדיוק את הקוד המתוקן מול הקובץ האמיתי (`אקסל ניסיון -
  ייבוא פגישות.xlsx`) — שתי השורות (אור יהודה, עין ים) יצאו מדויקות לחלוטין: 5.1.2026
  12:00-13:08 ו-20.1.2026 08:30-09:25 בהתאמה
- **עין ים שלא יובאה בכלל**: וידאתי ב-Supabase שסמל המוסד (310698) קיים במערכת — אינה בעיית
  זיהוי בית ספר (השם השגוי שנכתב בכוונה בקובץ לא משמש להתאמה, רק הסמל — כמתוכנן). קרוב
  לוודאי נפגעה מאותה תקלת תאריך/שעה; דורש בדיקה חוזרת בפועל אחרי התיקון כדי לוודא
- npx vite build עבר ב-0 שגיאות; ה-backend נבדק ב-import מלא (ללא שינוי נדרש שם הפעם)

## 2026-08-27 — שיוך שיחות VOICENTER ממספרים לא-מוכרים

### מיגרציות DB (Management API, אומתו)
- `voicenter_call_contact_resolutions`: נוספו `kind TEXT DEFAULT 'ambiguous'`, `dismissed_at`,
  `dismissed_by`, `call_direction`, `call_duration_seconds`, `counterpart_phone`,
  `missed_calls_since_prompt INT DEFAULT 0`.
- `voicenter_known_reps`: נוסף `unmapped_alert_sent_at TIMESTAMPTZ`.
- **טבלה חדשה** `voicenter_unknown_number_state` (org_id, advisor_id, phone_suffix, muted,
  calls_since_prompt, last_prompt_at, last_dismissed_at; UNIQUE(org_id,advisor_id,phone_suffix)).
  GRANT ל-service_role בלבד + RLS + policy `vuns_service_all`. אין גישה ישירה מ-frontend.

### פער 1 — זיהוי "טלפון בית הספר"
- `voicenter_router.py` `_build_contact_map`: `school_phone` נוסף ל-`select` ולמפת אנשי הקשר
  כרשומה סינתטית (role="טלפון בית הספר"). guard נגד כפילות מול מספר קיים באותו בי"ס; שני
  בתי ספר עם אותו מספר → נופל למסלול "עמום" הקיים.

### פער 2 — מספר לא מוכר
- `voicenter_router.py` `process_new_calls` (cron 15 דק'), שני מסלולים חדשים:
  - **מסלול A**: rep code שנראה בשיחות ואין לו מיפוי ב-`voicenter_rep_mappings` →
    התראה `voicenter_rep_unmapped` לבעלים+מנהלים (pref `notify_voicenter_rep_unmapped`),
    דדופ ב-`unmapped_alert_sent_at`.
  - **מסלול B**: שיחה עם `advisor_id`, בלי `school_id`, לא "עמומה", לא מקושרת ידנית,
    לא פנימית, משך ≥ `UNKNOWN_CALL_MIN_SECONDS` (10) → רשומת `kind='unknown'` +
    התראה `voicenter_unknown_call` ליועץ. שער השתקה פר-יועץ ב-`voicenter_unknown_number_state`
    ("שאל שוב אחרי 3 שיחות"). הגנת פרומפט-פתוח-יחיד לכל (יועץ+מספר).
  - ניקוי: פרומפטי `unknown` בני 14+ יום שלא טופלו → `dismissed_at`.
- `voicenter_router.py`: endpoints חדשים
  - `GET /voicenter/calls/unknown/my-prompts` — פרומפטים פתוחים ליועץ הנוכחי (מזין את פולינג ה-Sidebar).
  - `POST /voicenter/calls/{id}/dismiss-unknown` — "לא שייך"; משתיק פר-יועץ, מאפס מונה.
  - `PATCH /voicenter/calls/{id}/resolve-contact-school` — הורחב ל-`kind='unknown'`: מקבל כל
    בי"ס בארגון, כותב `voicenter_call_school_links` (linked), ומריץ אינליין
    `_recompute_meeting_call_activity` + `_maybe_auto_complete_meeting` לתאריך השיחה.
  - `POST /voicenter/calls/{id}/save-contact` — שמירת המספר כאיש קשר: מיידי אם
    `can_edit_school_directly` + משויך לבי"ס (או manager/owner), אחרת `school_update_requests`
    לאישור בעלים/מנהל (pref `notify_update_request_submitted`). דדופ לפי סיומת טלפון.
- `voicenter_router.py` `upsert_mapping`: יצירת מיפוי מנקה `unmapped_alert_sent_at` וסוגרת
  התראות `voicenter_rep_unmapped` פתוחות לאותו rep code.
- `schools_router.py`: `NotificationPreferencesIn` + `update_notification_preferences` —
  נוספו `notify_voicenter_unknown_call`, `notify_voicenter_rep_unmapped`.

### Frontend
- **חדש** `components/UnknownCallPopup.jsx` — כרטיס קטן בפינה (כמו פופ-אפ עדכון סטטוס פגישה)
  עם "כן, לשייך" / "לא, לא שייך"; "כן" פותח מודל מרכזי (`useFocusTrap`) רב-שלבי:
  בחירת בי"ס (`SchoolResultsList`) → מסך "✓ השיחה שויכה" → הצעת שמירת איש קשר (רק אם יש הרשאה)
  → טופס איש קשר → תוצאה. השיוך גמור כבר בשלב בחירת בי"ס; שמירת איש הקשר אופציונלית.
- `context/MeetingRemindersContext.jsx`: `addCallAttribReminder` (‎`_type: "call-attrib"`, key לפי call_id).
- `components/MeetingRemindersOverlay.jsx`: ענף + `HEADER_META` ל-`call-attrib`.
- `components/Sidebar.jsx`: `checkUnknownCallPrompts` — פולינג `GET /voicenter/calls/unknown/my-prompts`
  כל 60 שנ' + פעם ראשונית, דדופ ב-sessionStorage, קורא `addCallAttribReminder`.
- `components/meetings/SchoolPickerCell.jsx`: `SchoolResultsList` יוצא (export) + סינון לפי `district`
  (וגם עדכון placeholder).
- `pages/NotificationsPage.jsx`: אייקונים לשני הסוגים החדשים; שורות טוגל בהעדפות (owner/manager/advisor);
  לחיצה על התראת `voicenter_unknown_call` פותחת מחדש את הפופ-אפ דרך הקונטקסט;
  `voicenter_rep_unmapped` מנווטת ל-`/admin?tab=users` (deeplink קיים).
- `npx vite build` עבר ב-0 שגיאות; ה-backend נבדק ב-import מלא + רישום הראוטים החדשים.

## 2026-08-27 — השהיית פופ-אפ "עדכון סטטוס פגישה" כשאוטומציית ההשלמה מופעלת
- **הבעיה**: הפופ-אפ "עדכון סטטוס פגישה" (חלונית קטנה משמאל-למטה) קפץ ליועץ מיד בשעת הסיום
  המתוכננת (חלון 0–2 שעות), במקביל לאוטומציה `auto_complete_meetings_from_activity_enabled`
  שממתינה ל-5 דקות פעילות מסונכרנת — מירוץ תנאים, הפופ-אפ הפריע לפני שהאוטומציה הספיקה לפעול.
- `schools_router.py` (`get_me`): נוסף `auto_complete_meetings_from_activity_enabled` ל-`select`
  של שאילתת `organizations`, כדי שגם יועץ (שלא רשאי לקרוא `/meetings/automations`) יקבל את הדגל
  דרך `result["org"]`. כשל שליפת org → הדגל חסר → נתפס כ-false = התנהגות נוכחית (בטוח).
- `Sidebar.jsx`: נוספו קבועים `STATUS_POPUP_AUTO_DELAY_MS` (שעה) ו-`STATUS_POPUP_AUTO_WINDOW_END_MS`
  (3 שעות), ו-`autoCompleteRef` שנטען מ-`/schools/users/me` בתוך `load()`. בבלוק
  "End-of-meeting status update reminder": כשהאוטומציה מופעלת, חלון קפיצת הפופ-אפ הוזז ל-1–3
  שעות אחרי הסיום (במקום 0–2); בדיקת `m.status === "scheduled"` הקיימת נשמרה. אוטומציה כבויה →
  ללא שינוי.
- לא נגעו: `_maybe_auto_complete_meeting`, תזכורות סטטוס ידניות (`pending-status-reminders`),
  רכיבי הפופ-אפ/overlay/context, `/schools/upcoming-meetings` (פגישות לילה שעוברות יום UTC
  לפני שחלפה שעה — הוחלט להשאיר; עדכון ידני בטבלה זמין).
- `npx vite build` עבר ב-0 שגיאות.

## 2026-08-27 — סינון + מיון בסגנון אקסל לעמודות טבלת הפגישות
- **חדש** `frontend/src/components/meetings/meetingColumnMenu.jsx` — מודול משותף עם helpers
  (`computeMeetingFilterValues`, `meetingFilterValueLabel`, `passesMeetingColumnFilters`,
  `buildMeetingRowComparator`) ורכיב `MeetingColumnMenu`: כפתור אייקון-משפך בכותרת + תפריט
  מרחף (portal ל-`document.body`, `position:fixed`, נסגר בלחיצה בחוץ / בגלילה) עם מיון ↑/↓,
  "בטל מיון/סינון", רשימת ערכים ייחודיים לסימון (בחר הכל + חיפוש), ותג מספר למיון מרובה-עמודות.
  מבוסס על `ColumnHeaderFilter` מ-`DashboardPage.jsx`, מותאם לעמודות קטגוריות/טקסט/תאריך/שעה.
- `components/meetings/MeetingsTable.jsx`: הוסר המיון הישן (`sortField`/`sortDir`/`SortableHeader`
  + ייבוא `STATUS_SORT_ORDER`). נוסף state מקומי `columnFilters` + `sortSpecs` + `openMenuKey`.
  השורות ממופות ל-`{ m, filterValues }`, מסוננות וממוינות לפי מצב העמודות. תפריט סינון+מיון
  נוסף ל-9 כותרות: תאריך, סטטוס, התחלה, סיום, יועץ מבצע, מיקום, סוג, תזכורת, שם מוסד.
- הרכיב משותף → הפיצ'ר מופיע אוטומטית בשלושת מסכי הפגישות (כרטיס בית ספר / אזור אישי / ניהול).
  "יועץ מבצע" נעדר ב"אזור אישי" (אין שם עמודה כזו); "שם מוסד" מופיע רק ב"אזור אישי" + "ניהול".
- עמודת "תאריך" כוללת גם מסנני "לפני / אחרי / בין תאריכים".
- שורת הסיכום התחתונה ("סה\"כ פגישות/שעות שבוצעו") נשארת מחושבת על כל הפגישות, ללא קשר לסינון.
- המצב לא נשמר — מתאפס ברענון / מעבר טאב (state מקומי בלבד, ללא localStorage).
- `npx vite build` עבר ב-0 שגיאות.

## 2026-08-27 — סידור מחדש של "עמודות לתצוגה" (מסך הבית + ניהול)
- `components/meetings/constants.js`: נוסף `MEETING_SERVICE_TYPE_BREAKDOWN_COL_ORDER` — אותם דליים כמו
  `MEETING_SERVICE_TYPE_BREAKDOWN` אך בסדר גפן→שוטף→מחוז→גפן+שוטף→ללא סוג. הקבוע הישן לא נגעו בו
  (הוא שולט בסדר שורת הסיכום של טבלת הפגישות).
- `DashboardPage.jsx` — בורר "עמודות לתצוגה" חולק מחדש ל-3 קבוצות:
  - **כללי**: סמל מוסד, עיר, בעלות, שלב מוסד, **מחוז** (עמודה חדשה), **תוכנת כספים** (עמודה חדשה),
    יועץ מלווה [גפן/שוטף/מחוז].
  - **הקצאות** (חדש): הקצאת פגישות [גפן/שוטף/מחוז], הקצאת זמן פגישה [גפן/שוטף/מחוז] — התווית
    שונתה מ-"זמן לפגישה" ל-"הקצאת זמן פגישה" (גם בתפריט הסינון/מיון של העמודה).
  - **פגישות שבוצעו** (חדש): סה"כ פגישות/שעות שבוצעו, ואז זוג (פגישות+שעות) לכל סוג לפי הסדר
    גפן, שוטף, מחוז, גפן+שוטף, ללא סוג.
  - הקבוצות "בדיקות"/"יעדים"/"מכתב בקרה" נשארו כפי שהיו, אחרי השלוש.
  - נוסף רינדור לתאים `district` + `finance_software` (טבלה + ייצוא אקסל), ו-back-fill למשתמשים
    עם העדפות עמודות שמורות (מוסתרות כברירת מחדל). סדר ברירת המחדל של העמודות עודכן להתאמה.
- `AdminPage.jsx` — אותה חלוקה (כללי / הקצאות / פגישות שבוצעו / ניהולי). `advisor_*` +
  `meeting_allocation_*` + `meeting_duration_*` הועברו מ-"ניהולי" לקבוצות החדשות; נוספו
  `מחוז` + `תוכנת כספים` ל-"כללי" (קריאה בלבד בטבלה, נערכים במודל). אותו שינוי תווית ל-"הקצאת זמן פגישה".
- לא נגעו: תוויות "זמן לפגישה" במקטע "ליווי" (SchoolPage / AddSchoolPage / מודל AdminPage) — מחוץ להיקף.
- `DashboardPage.jsx`: בבורר "עמודות לתצוגה" נוסף ריווח אנכי (`mt-5`) לפני כל כותרת קבוצה חוץ מהראשונה.
- `npx vite build` עבר ב-0 שגיאות.

## 2026-08-27 — פירוט "פגישות שבוצעו" לפי סוג פגישה (גפן/שוטף/גפן+שוטף/מחוז/ללא סוג)
- **מיגרציה (Management API)**: `DROP` + יצירה מחדש של הפונקציה `get_meetings_stats(uuid[])` —
  מחזירה כעת שורה לכל צירוף `(school_id, service_type)` (`COALESCE(NULLIF(meeting_service_type,''),'none')`),
  עם `completed` ו-`total_minutes` לכל סוג. GRANT EXECUTE הוענק מחדש. אומת מול נתונים אמיתיים.
- `schools_router.py` (`list_schools`): לוגיקת הצבירה של תוצאות ה-RPC נכתבה מחדש — כל בית ספר מקבל
  `meetings_stats = {completed, total_minutes, by_type: {<svc>: {completed, total_minutes}}}`.
  שדות הרמה העליונה נשמרו תואמי-לאחור.
- `schools_router.py` (`GET /schools/meetings-stats`, לא בשימוש פרונט כרגע): נוסף `meeting_service_type`
  ל-`select` + בניית אותו מבנה `by_type` בלולאת הצבירה.
- `components/meetings/constants.js`: נוספו `MEETING_SERVICE_TYPE_BREAKDOWN` (סדר+תוויות, כולל
  `none`→"ללא סוג") ו-`formatMeetingMinutes` (נוסח זהה לשורת הסיכום הכללית).
- `components/meetings/MeetingsTable.jsx`: מעל שורת הסיכום הכללית מוצגות שורות פירוט —
  `סה"כ פגישות {סוג} שבוצעו` + `סה"כ שעות {סוג} שבוצעו` — **רק** לסוגים עם פגישה מבוצעת אחת לפחות.
  הפילוח נגזר בכל render מ-`meetings` החי, כך שכל שינוי "סוג" בשורה מעדכן מיידית (כולל שורה שנעלמת/מופיעה).
  הרכיב משותף → הפירוט מופיע אוטומטית גם ב"אזור אישי" וגם ב"ניהול → פגישות".
  שורת הסיכום כולה הוסבה ל-grid בן 4 עמודות (תווית/ערך/תווית/ערך, כולן `max-content`) כך
  שגם התוויות "סה\"כ שעות ... שבוצעו" וגם הערכים המספריים מתחילים כל אחד מקו אנכי משלו —
  מיושר דינמית לפי התא הרחב ביותר בכל עמודה.
- `DashboardPage.jsx` + `AdminPage.jsx`: נוספו 10 עמודות אופציונליות (כמות + שעות לכל אחד מ-5 הסוגים)
  צמוד ל"סה"כ פגישות/שעות שבוצעו", **כבויות כברירת מחדל** וזמינות דרך "עמודות לתצוגה". כולל
  מיון + סינון מספרי בכותרת, ו-back-fill למשתמשים עם העדפות עמודות שמורות. ב-AdminPage נוסף
  חריג ב-`ADMIN_DEFAULT_COL_VISIBLE` כדי שהעמודות החדשות יהיו כבויות (בניגוד לשאר עמודות הניהול).
- `npx vite build` עבר ב-0 שגיאות.

## 2026-08-27 — תיקון שורש: תאריכים לא מזוהים בייבוא פגישות
- **הבאג האמיתי** (`_parse_import_date`, `commit_meeting_import`): כשתא בקובץ נכתב כתאריך
  עם שנה דו-ספרתית (למשל "20.04.26") או הגיע כמספר סידורי גולמי של אקסל (למשל "46027" —
  קורה כשהתא מעוצב כ-Date בפועל בקובץ), הפרסר לא זיהה זאת → הבעיה "תאריך מחוץ לשנות הלימודים"
  קפצה, אבל לחיצה על "לכלול ולשייך לתשפ״ו" רק כפתה שנת לימודים בלי לתקן את התאריך עצמו —
  ה-commit המשיך להשתמש במחרוזת הגולמית הלא-תקינה (`row.meeting_date` כ-fallback), וזו נשלחה
  ישירות ל-Postgres וקרסה עם שגיאת DB גולמית ("date/time field value out of range"/
  "invalid input syntax for type date"), בעוד המסך הציג "יובאו בהצלחה" באותה נשימה (0 בפועל)
- **פרסר תאריכים חוסן משמעותית**: נוספו כל צורות הכתיבה הסבירות — מפריד `.`/`/`/`-`, שנה בת
  2 או 4 ספרות (עם pivot תקני 00-68→20xx / 69-99→19xx), וגם זיהוי מספר סידורי גולמי של אקסל
  (fallback הגנתי — התיקון העיקרי לזה הוא בקריאת הקובץ בפרונט, ראה למטה)
- **בעיה נפרדת חדשה `invalid_date`**: הופרדה לגמרי מ"תאריך מחוץ לשנות הלימודים המוכרות" —
  זו קודם הייתה אותה בעיה ("שכתוב תאריך תקין אך ישן מדי" ו"לא ניתן לפענח בכלל" נשפכו לאותו
  קוד), מה שאיפשר את הבאג המקורי. עכשיו: תאריך שלא ניתן לפענח בכלל דורש הזנת תאריך מתוקן
  (שדה `<input type="date">` חדש בחלונית הבעיות) ולא ניתן "לעקוף" עם שיוך שנת לימודים בכפייה
- **התיקון הקריטי ב-commit**: הוסרה לגמרי הנפילה חזרה ל-`row.meeting_date` הגולמי; אם אין
  תאריך תקין אחרי הבדיקה החוזרת, השורה נכשלת בבירור (מתווספת ל-errors) במקום להתנסות בהכנסה
  ל-DB עם ערך לא תקין
- **שורש הבעיה בפרונט**: `ImportMeetingsModal.jsx` קרא את הקובץ בלי `cellDates: true` — תא
  שאקסל שמר בפועל כ-Date (אחרי שינוי עיצוב התא) הוחזר כמספר סידורי גולמי ("46027") ולא
  כתאריך מפוענח. תוקן: קריאת הקובץ מבקשת `cellDates: true`, ותאים מסוג Date מזוהים ומומרים
  ל-ISO (`YYYY-MM-DD`) או `HH:MM` (לפי אם יש להם רק שעה) — כולל בתצוגת המקדימה של מיפוי
  העמודות, לא רק בשליחה בפועל
- שיפור נלווה: מסך "הייבוא הושלם" כבר לא תמיד ירוק חיובי — כשיש שורות שנכשלו הכותרת/הבאנר
  משתנים ל"הושלם חלקית"/"נכשל" בהתאם, כדי לא להטעות כמו שקרה כאן
- npx vite build עבר ב-0 שגיאות; ה-backend נבדק ב-import מלא + בדיקת parser ידנית מול הערכים
  המדויקים מהבאג ("20.04.26"→2026-04-20, "46027"→2026-01-05 וכו') — כולם עברו נכון

## 2026-08-26 — שיפור חוויית סינון בתי ספר בתוך משימה
- `TaskDetailContent.jsx`: לאחר לחיצה על "החל סינון" חלונית הסינון נסגרת (ממוזערת) אוטומטית, ללא צורך ללחוץ שוב על "סנן בתי ספר". ניתן לפתוח שוב בכל עת דרך הכפתור. חל על שני המארחים של הרכיב (חלון צף מהתראות + שורת משימה מורחבת).
- `TaskRowExpandedDetail.jsx`: גובה התצוגה המורחבת של משימת בתי ספר הוגדל מ-65vh ל-88vh — כמות בתי הספר הנראית לאחר סינון גדלה משמעותית, תוך השארת שורת המשימה הבאה גלויה.
- `TaskDetailContent.jsx`: חלונית "סנן בתי ספר" בתוך משימה הוגבלה למחצית הימנית של המסך בלבד (max-w 50%, מעוגנת לימין) במקום להתפרס על כל הרוחב.
- `TasksTable.jsx`: תיבת הגלילה של טבלת המשימות מכפילה את גובהה (max-h 70vh → 140vh) כשמורחבת שורת משימה, כדי לתת מקום אמיתי לטבלת בתי הספר הפנימית.
- `TaskDetailContent.jsx` + `ConditionGroupsEditor.jsx`: רק תיבת השדות של הסינון המתקדם (קבוצת התנאים) מקבלת רקע אפור (slate-100) דרך prop חדש `groupToneClassName`; המלבן החיצוני של החלונית חזר ל-slate-50/70 המקורי.
- `TaskDetailContent.jsx`: בשורת הסיכום של המשימה המורחבת — "X% התקדמות" כבר לא נדחף לקצה השמאלי (הוסר mr-auto) אלא צמוד ליתר הכותרות; המספר והאחוז בלבד הודגשו בשחור (text-slate-900 font-bold), המילה "התקדמות" נשארה כחולה.
- `TaskDetailContent.jsx`: הכפתור "סנן בתי ספר" שונה ל"סינון מתקדם"; רקע הכפתור במצב לא-פעיל שונה ל-slate-200 כדי לא להיטמע ברקע החדש.
- `TaskDetailContent.jsx`: שורת החיפוש החופשי בטבלת בתי הספר קוצרה מ-flex-1 ל-w-1/4 (רבע ימני של המסך), והוסר mr-auto מכפתור "ייצוא לאקסל" כך שהכפתורים נשארים צמודים משמאל לשורת החיפוש.

## 2026-08-26 — סינון מהיר, זברה, וכפתור הערה בטבלת בתי הספר של משימה
- `TaskDetailContent.jsx`: נוסף כפתור "ביטול" בחלונית הסינון המתקדם — סוגר את החלונית מבלי לאפס תוצאות.
- `TaskDetailContent.jsx`: בשורת הסיכום — ערכי "הושלמו"/"טרם הושלמו" עברו לצבע אחיד (text-slate-700, ללא ירוק/כתום); "X% התקדמות" כולו (מספר + אחוז + המילה) שחור מודגש (font-bold text-slate-900).
- `TaskDetailContent.jsx`: נוספו 6 כפתורי סינון מהיר משמאל לשורת החיפוש (בעלות/שלב מוסד/עיר/מחוז/סטטוס לקוח/סוג שירות) — פופ-אובר עם צ'קבוקסים לבחירה מרובה. הערכים לשדות select מגיעים מ-`field-options`, ולשדות טקסט (בעלות/עיר) נמשכים פעם אחת מ-`GET /schools/`. כל הבחירות + הסינון המתקדם מצטרפים לקריטריון אחד (AND, עם הרחבת DNF) ונשלחים ל-`POST /tasks/{id}/schools/filter` הקיים. "נקה סינון"/"ביטול" מאפסים גם את הסינון המהיר. (נוסף גם סינון תנאים ריקים מהבילדר המתקדם לפני שליחה.)
- `TaskDetailContent.jsx`: פסי זברה עדינים (bg-slate-50/70 לסירוגין) בשורות בתי הספר, לפי קבוצת בית ספר; שורה שהושלמה נשארת ירוקה.
- `TaskDetailContent.jsx`: בעמודת "הערות" — כשאין הערה מוצג כפתור "+" שפותח את תיבת הטקסט (דפוס זהה ל`PersonTaskDetailContent.jsx` באזור אישי); הערה קיימת נפתחת ישירות.

## 2026-08-26 — החרגת בתי ספר מתזכורת גורפת (broadcast skip)
- **מיגרציה**: נוספו ל-`org_task_school_notes` שתי עמודות — `broadcast_skip_mode` (`once`/`until`/`forever`) ו-`broadcast_skip_until` (DATE). הורצה דרך Management API ואומתה.
- `tasks_router.py`: עמודת "החרגות" בטבלת בתי הספר של משימה משנה משמעות — במקום החרגת כתובת מייל, מחריגים **בית ספר שלם** משליחת תזכורת גורפת, ב-3 מצבים: חד-פעמי / עד תאריך / לצמיתות. אין לזה שום השפעה על התקדמות/סגירת המשימה (הקוד ב-`recompute_task_status_and_cache` לא נגעו בו).
  - פונקציית עזר `_broadcast_skip_active(note_row, today)` — מקור אמת יחיד; `until` נבדק חי מול התאריך של היום.
  - `_queue_messages_for_schools`: מדלג על בי"ס עם החרגה פעילה (לפני בדיקות איש-קשר, בלי לסמן כבעיה), מחזיר `(missing, broadcast_skipped)`, ו"צורך" `once` אחרי שליחה גורפת.
  - endpoint חדש `PUT /tasks/{id}/schools/{school_id}/broadcast-skip` (mode + until, mode=null מנקה).
  - `POST /tasks/{id}/send` מחזיר `broadcast_skipped_schools`; `POST .../schools/{id}/send` הידני מחזיר 409 אם הבי"ס מוחרג (מכבד את ההחרגה, לא צורך `once`).
  - `process_message_queue`: re-check לפני שליחה בפועל (עבור שורות שתוזמנו לפני שההחרגה נוספה / לפני שהתאריך נכנס לתוקף).
  - `process_scheduled_tasks` (cron כל 15 דק'): ניקוי שורות `until` שתאריכן עבר.
- `TaskDetailContent.jsx`:
  - תא "החרגות": כפתור "+" כשאין החרגה, צ'יפ ענבר ("חד פעמי" / "עד DD/MM/YY" / "גורף") כשיש; פופ-אובר בן שלב אחד לבחירה/עריכה/ביטול. הוסר לגמרי ממשק החרגת המייל הישן.
  - עמודת "שליחה": לבי"ס מוחרג מוצג "מוחרג מתזכורות" במקום הכפתור.
  - אחרי שליחה גורפת: באנר ירוק "התזכורת נשלחה בהצלחה" + שורת ענבר עם מספר ושמות בתי הספר שהוחרגו.
  - כותרת "החרגות": tooltip צהוב-בננה בעת ריחוף; שורת הכותרות של הטבלה קיבלה קווים אופקיים חזקים יותר (border-t-2/b-2 slate-300) להדגשתה.
- **תיקוני המשך**:
  - ה-tooltip של כותרת "החרגות": הוסרה תכונת `title` (שיצרה tooltip לבן כפול של הדפדפן); הצבע רוכך ל-`bg-yellow-200`; `z-50` + `thead z-20` כדי שיופיע מעל כפתורי השורות ולא מתחתיהם.
  - פופ-אובר ההחרגה: הורחב ל-`w-80` (יותר מפי 2), כותרת "החרגה מתזכורת - [שם בי"ס]" + טקסט הסבר זהה ל-tooltip; כפתורי הבחירה עוצבו כגלולות (`rounded-full border`).
  - בחירת "עד תאריך": רכיב `DmyDateInput` חדש — שדה טקסט יחיד `DD/MM/YY` בשורה אחת (שנה דו-ספרתית → 20XX), במקום 3 שדות נפרדים שגלשו.
  - שגיאות 404 על `/broadcast-skip` נבעו מ-6 תהליכי `uvicorn --reload` יתומים שנערמו (ראה CLAUDE.md); כולם חוסלו והופעל מופע רענן יחיד — הראוט מגיב כעת (403 auth, לא 404).
  - כותרת העמודה שונתה מ-"החרגות" ל-"החרגה מתזכורות".
  - הפופ-אובר עוגן ל-`left-0` (נפתח לכיוון גוף הטבלה במקום החוצה שמאלה) ו-`z-[70]` כדי שלא ייבלע מתחת לכותרת הדביקה ולשורות; ה-tooltip עבר ל-`left-1/2` ו-`z-[60]`.
  - הפופ-אובר הורחב ל-`w-96` ונוסף `whitespace-normal break-words` (ה-`<td>` הוא `whitespace-nowrap` וגרם לטקסט ההסבר לגלוש מחוץ לקופסה).
  - `DmyDateInput`: מוסיף `/` אוטומטית תוך כדי הקלדה (`formatDmy`), ונוסף כפתור "אישור" — ההחרגה חלה **רק** בלחיצה עליו (הוסר commit ב-blur, שגרם לחלונית להיסגר בלי שקרה כלום).
  - בי"ס שהשלים את המשימה במלואה (`r.done`) — התא מציג "—" בלבד; אין כפתור "+" ואין אפשרות להגדיר החרגה (הוא ממילא כבר לא יעד לתזכורת).

## 2026-08-26 — "עמודות להצגה" בטבלת בתי הספר של משימה
- `task_logic.py`: `compute_task_progress` מוסיף `district` ו-`city` לכל שורת בית ספר (בשני הענפים — track_success ו-לא).
- `TaskDetailContent.jsx`: נוסף כפתור "עמודות להצגה" (רכיב `ColumnPickerButton` הקיים, גנרי) משמאל ל-"ייצוא לאקסל". העמודות שניתן להציג/להסתיר ולגרור לסידור מחדש: סמל מוסד / שלב לימוד / בעלות / מחוז / עיר. "בית ספר" קבועה ראשונה; "הערות" והלאה קבועות.
  - סדר + נראות נשמרים ב-localStorage לכל דפדפן (`taskDetailColOrder_v1` / `taskDetailColVisible_v1`).
  - ברירת מחדל: סמל מוסד + שלב לימוד + בעלות מוצגות (כמו קודם); מחוז + עיר מוסתרות.
  - גרירת כותרת עמודה משנה את סדר העמודות (רק ביניהן), עם אינדיקטור drop כחול — כמו במסך הבית.
  - כל עמודה מיטלטלת ניתנת גם למיון (כפתור מיון בכותרת).
  - `exportToExcel` מייצא את אותן עמודות מיטלטלות שמוצגות, באותו סדר.
- `TaskDetailContent.jsx`: סינון הסטטוס הוסב מ-`<select>` לכפתור+פופ-אובר בסגנון כפתורי הסינון המהיר — הכפתור מציג תמיד "סטטוס" (או "סטטוס: הושלמו" / "סטטוס: טרם הושלמו" כשמסונן), והאפשרויות בפתיחה נשארות הכל / הושלמו / טרם הושלמו כאשר "הכל" היא ברירת המחדל.

## 2026-08-26 — עיצוב מחדש לפירוט משימה ב"ניהול → משימות → יועצים"
- `PersonTaskAdminDetailContent.jsx` (רק החלק הפנימי של השורה הנפתחת, לא שורת המשימה):
  - כרטיס עליון: הסבר משימה + מדד הצלחה (תוויות `text-xs text-slate-500`, ערכים `text-sm font-medium text-slate-800`) בצד ימין; בלוק התקדמות מאוחד בצד שמאל — פרוגרס-בר `w-44 h-2` עם מילוי אינדיגו, ומתחתיו `{pct}% · {done}/{total} פעולות`.
  - רשימת האחראים הוסבה מטבלה לכרטיסי Accordion: כל אחראי = `bg-white border rounded-xl p-3 mb-2` עם חץ מסתובב + אייקון משתמש + שם `font-semibold`, ו-badge סטטוס `X/Y` (אפור כשאפס, אינדיגו כשיש התקדמות).
  - טבלת בתי הספר הפנימית: מעטפת `bg-slate-50/80 border border-slate-200 rounded-xl p-3 mr-4 my-2`, כותרות `bg-white text-slate-700 font-bold text-xs`, שורות `border-b border-slate-200/60 text-slate-900`.
  - badge הסטטוס `X/Y` הוצמד לצד שם היועץ (משמאל לשם) במקום לקצה השמאלי; הוחזרה כותרת "אחראי לביצוע / סטטוס ביצוע" מעל הרשימה.
  - שורת יועץ פתוחה: רקע `bg-blue-50/70` + `border-blue-200`.
  - צבע הפרוגרס-בר לפי קצב: ≤50% אדום, 51-99% כתום, 100% ירוק.
  - כרטיסי היועצים והכותרת עברו ל-grid זהה (`grid-cols-[1fr_7rem]`) — הכותרות "אחראי לביצוע"/"סטטוס ביצוע" יושבות בדיוק מעל עמודת השם ועמודת ה-badge, וה-badge תמיד באותו מיקום בכל השורות ובאותו עיצוב (`bg-slate-100 text-slate-600`, ללא אינדיגו).
  - הוסר אייקון המשתמש שליד שם היועץ.
  - טבלת בתי הספר הפנימית עוטפה במסגרת (`rounded-lg border border-slate-200 bg-white`) עם קווי הפרדה בין עמודות (`divide-x`), אותם מיקומי עמודות/נתונים.
  - grid כרטיסי היועצים שונה ל-`grid-cols-[1fr_3fr]` — עמודת "סטטוס ביצוע" (וה-badge והמספרים מתחתיה) מיושרת לקו הרבע הימני של המסך.
  - טבלת בתי הספר: המעטפת הלבנה (`border`+`bg-white`) הפכה ל-`inline-block max-w-full` כך שהיא מתכווצת בדיוק לרוחב הטבלה — הרקע האפור של הפאנל מוצג משמאל לה, אין עוד רקע לבן מיותר עד קצה המסך. הטבלה עצמה `width:1px` + `whitespace-nowrap`; עמודות שלב לימוד/סטטוס/מדד הצלחה = `w-24` אחיד.
- `PersonTasksTable.jsx`: תיבת הגלילה של טבלת המשימות ב"יועצים" מכפילה גובה (`max-h` 70vh → 140vh) כשמורחבת שורת משימה — כמו שנעשה ב"בתי ספר".

## 2026-08-27 — סינון/מיון/חיפוש בטבלת בתי הספר של פירוט משימת יועצים
- `person_tasks_router.py` (`get_person_task`): שורות ה-targets מועשרות ב-`city`, `district`, `school_stage` (מ-`schools`) ו-`client_status`, `service_type` (מ-`school_year_admin_data` לשנת המשימה).
- **חדש** `frontend/src/components/personTasks/personTaskSchoolFilter.js` — `SCHOOL_FILTER_FIELDS` (7 שדות לסינון מתקדם), `makeSchoolColumns` (קונפיג ל-`ColumnFilterButton`), `distinctFor`, `applyPersonTaskFilters` (חיפוש חופשי → סינון מתקדם → סינוני עמודות → מיון).
- **חדש** `frontend/src/components/personTasks/PersonTaskTableToolbar.jsx` — שדה חיפוש חופשי (שם/עיר/בעלות/סמל) + פופ-אובר "סינון מתקדם" (בחירת שדה אחד + ערך; select לשדות select, טקסט-contains לשאר).
- `PersonTaskAdminDetailContent.jsx` (ניהול→יועצים): בטבלת ה-drill-in של כל יועץ נוספו עמודות **עיר / סמל מוסד / בעלות** בין "בית ספר" ל"שלב לימוד" ("בית ספר" = שם בלבד); כל כותרת עם `ColumnFilterButton` (מיון + סינון enum/text/number כמו במסך הבית); הסרגל מעל הטבלה. מצב הסינון משותף ומתאפס במעבר יועץ. הסינון לא משפיע על ה-badge X/Y ולא על סרגל ההתקדמות.
- `PersonTaskDetailContent.jsx` (אזור אישי): אותו דבר על הרשימה השטוחה, רק במצב `assignment_mode==="schools"` ו-`!hideSchoolColumn`. בכרטיס בית ספר (`scopeSchoolId`) — הפיצ'ר כבוי (כל השורות אותו בי"ס).
- אין endpoint שרת חדש, אין מיגרציה. שימוש חוזר: `ColumnFilterButton` + `matchesColumnFilter` מ-`components/tasks/`.
- לא נגעו: שורת המשימה, `PersonTaskRow.jsx`, `PersonTaskRowExpandedDetail.jsx`, `PersonTaskDetailContent.jsx`, הבקאנד.
