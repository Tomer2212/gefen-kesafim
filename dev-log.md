# Dev Log

## 2026-09-02 — ייבוא בתי ספר מאקסל: זיהוי יועצים מלווים + חלונית בעיות אינטראקטיבית
- זיהוי יועץ מלווה (גפן/שוטף/מחוז) בייבוא כעת לפי התאמה מדויקת ל**שם מלא / אימייל / טלפון** של משתמש במערכת (עד כה רק אימייל). טלפון מנורמל לספרות + המרת קידומת 972/+972 ל-0.
- תמיכה בכמה יועצים בתא אחד: פיצול לפי `, ; ↵` בכל שילוב רווחים, ללא תלות בסדר; ובנוסף פיצול חכם ל**תא ללא מפריד** — שליפת אימיילים/טלפונים וחלוקה חמדנית של שמות מלאים מול רשימת המשתמשים. כל דבר לא ודאי נשלח לחלונית, אין ניחוש שקט.
- `confirmImport` פוצל ל: שלב טרום-ייבוא (parse + זיהוי, ללא כתיבה) ו-`commitSchoolImport` (שלב הכתיבה). אם אין אף בעיה — ייבוא ישיר; אחרת נפתחת חלונית.
- רכיב חדש `SchoolImportProblemsModal.jsx` (על בסיס `MeetingImportProblemsModal`): כרטיס לכל שורה בעייתית, פתרון במקום לכל בעיה — שם/סמל חסר, מתאם פגישות לא תקין (תפקיד + שם), יועץ לא זוהה / דו-משמעי (בחירה מרשימה / דילוג / **הזמנת משתמש חדש** ישירות מהחלונית), ויועץ חובה חסר לפי סוג השירות. אי אפשר לייבא עד שכל שורה נקייה או הוסרה.
- הוסר `ImportProblemsModal` הישן (רשימה פסיבית) והוחלף בזרימה האינטראקטיבית. עודכנו רמזי העמודות ב-`IMPORT_FIELD_CONFIG`.

## 2026-09-02 — ייבוא בתי ספר מאקסל: עמודת "הערות כלליות"
- DB: `school_notes.imported_from_excel BOOLEAN NOT NULL DEFAULT false`.
- שרת: `SchoolNoteCreateIn.imported_from_excel` (נכתב רק כש-`note_type == "general"`); ב-`_group_school_note_rows` הערה מיובאת מוצגת עם `author_name = "מיובא מאקסל"` (ה-`author_id`/`author_role` נשארים של המעלה כדי לאפשר עריכה/מחיקה).
- פרונט: עמודת מיפוי חדשה `general_notes` ("הערות כלליות"). בסיום יצירת בית הספר, אם התא לא ריק — `POST /schools/{id}/notes` עם `note_type: "general"`, `imported_from_excel: true` (כשל = שגיאה רכה). השדה לא מפעיל את חלונית הבעיות.

## 2026-09-02 — ייבוא בתי ספר מאקסל: זיהוי חכם של "תוכנת כספים"
- `matchFinanceSoftware(raw)` — מנרמל (אותיות קטנות + הסרת רווחים/מקפים/פיסוק) ואז בדיקת substring מול `FINANCE_SOFTWARE_ALIASES` (רשימת כינויים נדיבה לכל אחת מ-kesafim2000/payscool/schoolcash, עברית+אנגלית+שגיאות כתיב נפוצות). "כספים 2000"→kesafim2000, "סקול קאש"→schoolcash, "פיי סקול"→payscool.
- מחזיר `{ value, status }`: תא ריק או התאמה יחידה → `ok`; כתוב משהו שלא זוהה, או 2+ התאמות → `none`.
- `status: "none"` → בעיה `finance_software_issue` בחלונית `SchoolImportProblemsModal`: `<select>` עם 3 האפשרויות + "ללא תוכנת כספים (השאר ריק)". השורה נקייה רק אחרי בחירה.
- `normalizeFinanceSoftware` נשמר כ-wrapper דק מעל `matchFinanceSoftware` לתאימות.

## 2026-09-02 — ייבוא בתי ספר מאקסל: זיהוי חכם לכל עמודות אוצר-המילים + הקצאות + מתאם פגישות מדורג
- **תשתית זיהוי**: `isBlankOrError()` (תא ריק / שגיאת אקסל `#N/A` וכו' / מקף / `n/a` — נחשב "לא ממולא" בכל העמודות) + `matchClosed()` גנרי (כללים מדורגים, כלל ראשון מנצח). כל matcher מחזיר `{ value, status }` — `none` = כתוב משהו שלא זוהה → קופץ בחלונית.
- **עמודות חדשות עם זיהוי חכם**: `stage`, `district` (כולל "חינוך התיישבותי" / "חרדי"), `sector`, `supervision`, `service_type` (כולל צירוף גפן+שוטף), `client_status` (כולל שלילה "לא פעיל"), `grade_levels` (מספרים 1–12 → א–יב, טווחים "א-ו", "כיתה"), `study_days` ("ראשון"/מספרים/טווחים), `student_count`.
- **הקצאות (year-admin, לא חובה)**: 6 עמודות `meeting_allocation_[gefen/current/district]` (מספר) + `meeting_duration_[...]` (נשמר דקות; פענוח גמיש: "1:30", "90", "1.5", "שעה וחצי", "45 דק'", "שעתיים"; מספר בודד קטן כמו "2" → קופץ בחלונית).
- **מתאם פגישות — עד 3 עמודות מדורגות**: `IMPORT_FIELD_CONFIG` עם `ranked: 3`; `ImportMappingModal` מציג 3 בוררי עמודות ("עדיפות 1/2/3"), `mapping.meeting_coordinator` = מערך. בזמן ייבוא לוקחים את עדיפות 1, ונופלים לבאה **רק** כשהתא `isBlankOrError` או `0`. הזיהוי: מילת תפקיד → ואם לא, התאמה מלאה (שם/מייל/טלפון) מול אנשי הקשר של אותה שורה (`resolveCoordinator`). לא זוהה → `coordinator_issue` בחלונית.
- **חלונית**: בלוקי פתרון גנריים (select / chips / number / `HourMinuteInput`) לכל `fieldIssue`; חישוב חי של "יועץ חובה" לפי סוג-שירות/סטטוס שנבחרו בחלונית (`requiredTypesFor` prop).
- הוסרו `normalizeStage/District/Sector/Supervision/ServiceType/MeetingCoordinator/ClientStatus` (הוחלפו ב-`match*`).
