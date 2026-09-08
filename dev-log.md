# Dev Log

## 2026-09-08 — ביצועים: טאב "ניהול → גבייה"

איטיות בטעינת בתי הספר בטאב "גבייה". שתי סיבות: (1) הטאב קרא בעצמו את `GET /schools/`
המלא (~12 שאילתות enrichment) בשביל id+name בלבד; (2) אותה בעיית רינדור כמו בטאבים
האחרים — צינור סינון/מיון לא ממומואז + אין וירטואליזציה + כל 550 השורות בבת אחת.

### בקאנד
- `GET /schools/` קיבל פרמטר `lite=true` — מחזיר רק `id, name, symbol, city, status`
  עם אותו סינון לפי תפקיד, ומדלג על כל שלבי ה‑enrichment. `backend/routers/schools_router.py`.

### פרונטאנד — `AdminCollectionTab.jsx`
- הטעינה עברה ל‑`GET /schools/?lite=true` (במקום התשובה הכבדה).
- `visibleColumns` + כל צינור הסינון/מיון עברו ל‑`useMemo`; decorate-sort (ערך מיון פעם אחת לכל שורה).
- `CollectionColumnFilterPopover`: שדות טקסט/מספר עם state מקומי + debounce.
- חילוץ `CollectionRow` (memo) + וירטואליזציה עם `@tanstack/react-virtual` (tbody מרובה).
- שדה "סכום ששולם" הומר ל‑`CollectionAmountInput` (controlled + debounce + flush ב‑blur/unmount).
- `InvoiceNumbersCell` / `DepositDatesCell`: flush של עריכה פתוחה ב‑unmount (בטיחות וירטואליזציה).

בנייה: `npx vite build` עובר עם 0 שגיאות. הבקאנד מייבא תקין.
