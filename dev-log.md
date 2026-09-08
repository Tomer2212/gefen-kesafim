# Dev Log

## 2026-09-08 — ביצועים: תיקון קיפאון הדפדפן ב"ניהול → בתי ספר" ובלוח הבקרה

הבעיה: אצל ארגון עם 550+ בתי ספר, המעבר לטאב "ניהול → בתי ספר" הקפיא את הדפדפן ("הדף אינו מגיב").
סיבה: רינדור צד־לקוח של כל השורות בבת אחת ( ~25 אלף תאים + אלפי רכיבי קלט) + צינור סינון/מיון לא ממומואז שרץ מחדש בכל הקלדה.

### שלב 1 — סידור החישוב (ללא שינוי ויזואלי)
- hook חדש `frontend/src/hooks/useDebouncedValue.js` (`useDebouncedValue` + `useDebouncedCallback`).
- `AdminPage.jsx`: כל צינור הנגזרות של טבלת בתי הספר (`activeAdminSchools`, `filteredAdminSchools`, `getAdminSortValue`, `columnFilteredAdminSchools`, `sortedAdminSchools`, `visibleAdminColOrder`, `adminColumnCategories`, `adminAdvisorFilterOptions`) עבר ל‑`useMemo`/`useCallback`.
- מיון: decorate-sort — ערך המיון לכל בית ספר מחושב פעם אחת (Map לפי id) במקום פעמיים לכל השוואה.
- חיפוש בתי ספר: debounce של 250ms (`debouncedAdminSearch`).
- `AdminColumnFilterPopover`: שדות טקסט/מספר עם state מקומי + debounce לפני עדכון הפילטר הראשי.
- `DashboardPage.jsx`: `filteredSchools` ו‑`baseDisplayRows` עברו ל‑`useMemo`.

### שלב 2 — וירטואליזציה
- תלות חדשה: `@tanstack/react-virtual`.
- `AdminPage.jsx`: חילוץ `SchoolRow` (memo) + `rowHandlers` יציב; טבלת בתי הספר מרונדרת עם `useVirtualizer` (spacer‑rows במבנה `<tbody>` מרובה, מדידת גובה דינמית) — רק ~40 שורות ב‑DOM בכל רגע. שורת ה"חטיבות" המורחבת נשמרת בתוך אותו `<tbody>` ממודד.
- `AdminPage.jsx`: 9 שדות המספר + "מחיר כולל מע"מ" הומרו ל‑`AdminAutosaveInput` (controlled + שמירה עם debounce + flush ב‑blur וב‑unmount, רק אם המשתמש שינה בפועל); תאי ההערות הומרו ל‑`AdminNotesTextarea` (commit ב‑blur + flush ב‑unmount).
- `DashboardPage.jsx`: חילוץ `DashboardSchoolRow` (memo) + `useVirtualizer` באותה תבנית.

### לא בוצע (נדחה)
- שלב 3 (עימוד בצד השרת ל‑`GET /schools/`) — רק בקנה מידה של אלפים רבים.

בנייה: `npx vite build` עובר עם 0 שגיאות.
