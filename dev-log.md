# Dev Log

## 2026-09-10 — וירטואליזציה לטבלאות כבדות (משימות / שיחות / היסטוריית בדיקות)
- מודול משותף חדש: `frontend/src/hooks/useRowVirtualizer.js` + `frontend/src/components/common/VirtualRows.jsx` — עוטפים את תבנית ה-`@tanstack/react-virtual` (multi-`<tbody>` + spacer rows + מדידת גובה דינמית) שכבר בשימוש בטבלאות בתי הספר. הטבלאות הקיימות (AdminPage/DashboardPage/MeetingsTable/AdminCollectionTab) לא נגעו בהן.
- וירטואליזציה (דפדפן בלבד, ללא שינוי חזותי — רק ~40 שורות ב-DOM בכל רגע):
  - `components/tasks/TasksTable.jsx` (ניהול → משימות → "בתי ספר") + `TaskRow` עטוף ב-`memo`.
  - `components/tasks/TaskDetailContent.jsx` — טבלת בתי הספר של משימה (חלון/הרחבת משימה). `displayRows` הועבר ל-`useMemo` מעל ה-early returns.
  - `components/personTasks/PersonTasksTable.jsx` (ניהול "אנשי הארגון" + אזור אישי) + `PersonTaskRow` עטוף ב-`memo`.
  - `components/personTasks/PersonTaskAdminDetailContent.jsx` — הטבלה המקוננת בהרחבת אדם חולצה ל-`AssigneeSchoolsTable` (וירטואליזציה + תיבת גלילה אנכית פנימית `max-h-[60vh]`).
  - `components/personTasks/PersonTaskDetailContent.jsx` — טבלת היעדים (אזור אישי / כרטיס בית ספר). `displayTargets` הועבר ל-`useMemo` מעל ה-early returns + תיבת גלילה פנימית `max-h-[60vh]`.
  - `components/calls/CallsTable.jsx` (שיחות Voicenter — ניהול + כרטיס בית ספר) + `CallRow` עטוף ב-`memo`; המיכל קיבל `overflow-y-auto` + `max-h`, וה-`<thead>` הפך ל-sticky.
  - `pages/SchoolPage.jsx` — טבלת היסטוריית הבדיקות. `filteredLogs` הועבר ל-`useMemo`; שורת "ריצה בהמתנה" ושורת ה-filler נשארו כ-`<tbody>` קבועים; מחובר ל-`historyScrollRef` הקיים (גלילה אופקית עם מקשי חצים ממשיכה לעבוד).
- שינוי חזותי מכוון (אושר ע"י המשתמש): 3 טבלאות שגללו עם גלילת העמוד קיבלו תיבת גלילה אנכית פנימית — `SchoolTasksTab`, `CallsTable`, והטבלה המקוננת ב-`PersonTaskAdminDetailContent`/`PersonTaskDetailContent`.
- הגבלת רשימות תצוגה-מקדימה של בתי ספר ביצירת משימה ל-200 שורות + שורת "…ועוד N": `TaskCreateWizard.jsx` (רכיב `SchoolPreviewList` מקומי, מחליף 2 בלוקים כפולים) ו-`PersonTaskCreateWizard.jsx` (טבלת `advisorCheck`). המספר המלא ("נמצאו X בתי ספר תואמים") לא הושפע — הוא מ-`preview.count` / `advisorCheck.total_schools`. אין שינוי חזותי כשיש ≤200 תואמים.
- `npx vite build` עובר ללא שגיאות.

## 2026-09-10 — סינון אמין לפגישות עבר שיובאו (ערכי status/סוג/מיקום חופשיים → קנוניים)
- מיגרציה: `meetings.import_raw JSONB` (שמירת הניסוח המקורי מהאקסל של 3 שדות התווית).
- מודול חדש `backend/meeting_labels.py` — טבלאות מילים-נרדפות + `normalize_meeting_status/type/service_type` (מראה של `normalizeImport*` בפרונט; תבנית `zihuy_core.normalize_budget_name`). מטפל בסיומיות עברית (ך/ם/ן/ף/ץ → כ/מ/נ/פ/צ).
- `frontend/src/constants/meetingImportFieldConfig.js` — הרחבת 3 ה-`normalizeImport*` (מ-`===` ל-`includes` בטוח, טיפול בסיומיות).
- `schools_router.py`:
  - `MeetingImportRowIn` + `status_override` / `meeting_type_override` / `meeting_service_type_override`.
  - `_run_meeting_import_validation` פולט בעיות `unrecognized_status/meeting_type/service_type` (עם `raw_value`) כשהערך לא ניתן למיפוי אוטומטי ואין override.
  - `commit_meeting_import` — הערך הסופי נקבע לפי `override → טבלת נרדפות → טקסט גולמי`; הניסוח המקורי נשמר תמיד ב-`import_raw`. סמן `"__keep__"` = המשתמש בחר לשמור טקסט חופשי.
  - endpoints חדשים: `GET /schools/meetings/import/unrecognized-values`, `POST /schools/meetings/import/remap-values`.
- `MeetingImportProblemsModal.jsx` — סקשן "מיפוי ערכים לא מזוהים" מצבר (ערך ייחודי אחד = בחירה אחת שחלה על כל השורות איתו), עם הצעת ברירת-מחדל מטבלת הנרדפות.
- `ImportValueMappingModal.jsx` (חדש) — מסך מיפוי לנתונים שכבר יובאו, נפתח מכפתור "מיפוי ערכים מיובאים" ב"ניהול פגישות" (מופיע רק כשיש ערכים לא-מזוהים).
- `AdminMeetingsTab.jsx` / `PersonalMeetingsTab.jsx` — תפריט הסטטוס בסרגל העליון קיבל `optgroup` דינמי עם ערכי טקסט-חופשי שנשמרו, כך שהם עדיין ניתנים לסינון.
- כללי נרדפות ל-`meeting_service_type`: "מכתב בקרה..." → גפן, "סגירת שנה..." → שוטף (לבקשת המשתמש).
- `backend/backfill_meeting_import_labels.py` (חדש) — הורץ מול הנתונים הקיימים: 2,134 שורות, כולן קיבלו `import_raw`; status ו-service_type 100% קנוניים; meeting_type — 20 נותרו ("עבודה עצמית", אין מקבילה — ניתן למפות ידנית או להשאיר כטקסט חופשי).
- `npx vite build` + `python -c "import routers.schools_router"` — 0 שגיאות.

## 2026-09-10 — הפרדת "בתי ספר לתיעוד פגישות עבר" מ"סל מחזור" + כיווץ ברירת מחדל
- מיגרציה: `schools.created_via TEXT`. `create_historical_schools_for_import` מסמן stubs ב-`'import_historical'`; `restore_school` מנקה את הסימון (הופך לבית ספר פעיל רגיל). Backfill ל-20 ה-stubs הקיימים של גפני שלו (זיהוי לפי `secretary_name` + `status`).
- `AdminPage.jsx` (ניהול ← בתי ספר) — אזור "סל מחזור" פוצל לשניים:
  - **🗑️ סל מחזור** — רק בתי ספר שהארגון באמת מחק (`created_via != 'import_historical'`), עם "מיועד למחיקה / N ימים נותרו".
  - **📎 בתי ספר לתיעוד פגישות עבר** — ה-stubs, בלי ספירת ימים/תווית מחיקה, עם הסבר קצר. תווית "רשומה היסטורית".
  - שני האזורים **מכווצים כברירת מחדל** ונפתחים בלחיצה (chevron).
- `npx vite build` — 0 שגיאות.
