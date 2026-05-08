# Dev Log

## 2026-05-08 — הוספת דף צור קשר ושליחת מייל
- נוצר `backend/routers/contact_router.py` — endpoint `POST /contact/send` שולח מייל עם Gmail SMTP (כולל קבצים מצורפים)
- עודכן `backend/main.py` — רישום contact_router
- עודכן `.env` — נוספו GMAIL_USER, GMAIL_APP_PASSWORD, SUPPORT_EMAIL
- נוצר `frontend/src/pages/ContactPage.jsx` — טופס פנייה עם נושא, תיאור, מייל, טלפון, העלאת קבצים, מצב הצלחה
- עודכן `App.jsx` — נוסף route `/contact`
- כל דפי ה-nav עודכנו עם כפתור "צור קשר" (קצה שמאל)
- עודכן `MainPage.jsx` — כפתור צף "זיהיתם שגיאה? ספרו לנו" מתחת לתוצאות, פותח `/contact` בטאב חדש

## 2026-05-08 — תיקון מסך אפור לאחר התחברות
- תוקן `LoginPage.jsx` — החלפת `window.location.replace("/")` ב-`navigate("/")` למניעת paint-holding של Chrome שגרם למסך אפור ובלתי-לחיץ לאחר כניסה

## 2026-05-08 — הוספת דפי מדיניות פרטיות והדרכה
- נוצר `PrivacyPage.jsx` — דף מדיניות פרטיות עם 8 סעיפים מלאים (עיצוב זהה לתנאי שימוש)
- נוצר `GuidePage.jsx` — דף הדרכה עם טבלת "קבצים להעלאה לפי תוצאה רצויה" (7 לשוניות)
- עודכן `App.jsx` — נוספו routes `/privacy` ו-`/guide`
- עודכן `MainPage.jsx` — נוספו כפתורי ניווט "מדיניות פרטיות" ו-"הדרכה" ליד "תנאי שימוש"
- עודכן `TermsPage.jsx` — נוספו כפתורי ניווט זהים

## 2026-05-08 — הצהרת נגישות + כפתור נגישות ב-Navbar
- נוצר `frontend/src/pages/AccessibilityStatementPage.jsx` — דף הצהרת נגישות (עיצוב זהה ל-TermsPage) עם 4 סעיפים: כללי (ת"י 5568 / WCAG 2.1 AA), ההתאמות שבוצעו, מגבלות ידועות, פרטי רכז נגישות (תומר אלון, geffen360@gmail.com + קישור לטופס צור קשר)
- עודכן `App.jsx` — נוסף route `/accessibility`
- עודכנו 5 navbars (MainPage, TermsPage, GuidePage, PrivacyPage, ContactPage) — נוסף כפתור "נגישות" כפריט אחרון (שמאלי ביותר) בתפריט
- `AccessibilityStatementPage` — "נגישות" ב-navbar מוצג כ-`<span aria-current="page">` בהתאם לדפוס שאומץ בשאר האתר

## 2026-05-08 — סריקת נגישות מלאה (Accessibility Audit) — כל הסעיפים יושמו
- `ResultsView.jsx` — הוסף `scope="col"` לכל כותרות הטבלה; אוחדו צבעי כותרות כל הלשוניות לכחול כהה (#0c237d→#091a60); SVGים דקורטיביים קיבלו `aria-hidden="true"`
- `ResultsView.jsx`, `ContactPage.jsx` — כפתורי אייקון-בלבד קיבלו `aria-label` מתאים
- `ContactPage.jsx` — checkbox הסכמה הוחלף לאמיתי (`<input type="checkbox" className="sr-only peer">`) עם focus ring גלוי למקלדת בלבד (`peer-focus-visible:ring-2`)
- `TermsPage.jsx`, `GuidePage.jsx`, `ContactPage.jsx` — `<button disabled>` בניווט הוחלף ל-`<span aria-current="page">`
- `LoginPage.jsx` — הוסרו `tabIndex={-1}` מכפתור הצגת סיסמה; הוסף `aria-label`; SVGים קיבלו `aria-hidden="true"`
- `LoginPage.jsx`, `ContactPage.jsx` — כל label/input קיבלו `htmlFor`/`id` תואמים; רכיב `Label` ב-ContactPage עוד עם prop `htmlFor`
- נוצר `frontend/src/hooks/useFocusTrap.js` — Hook מרכזי לניהול focus trap במודאלים
- `MainPage.jsx` — `SingleFileWarningModal` ו-`ConfirmModal` קיבלו `role="dialog" aria-modal="true" aria-labelledby` + focus trap
- `ResultsView.jsx` — `DownloadSelectModal`, `YozmaDialog`, `YozmaDualDialog` קיבלו `role="dialog" aria-modal="true" aria-labelledby` + focus trap
- `LoginPage.jsx`, `ContactPage.jsx`, `MainPage.jsx` — הודעות שגיאה קיבלו `role="alert"`
- `LoadingScreen.jsx` — קונטיינר קיבל `role="status" aria-label="הבדיקה מתבצעת, אנא המתן"`; ספינר ונקודות קיבלו `aria-hidden="true"`

## 2026-05-08 — שיפורי UI: הדרכה + העברת "פרטי הבדיקה" לסקירה
- עודכן `GuidePage.jsx` — עיצוב ממורכז, אייקוני ✓/✗, נוסף כרטיס "כלל הבדיקות" ראשון ברשימה
- עודכן `ResultsView.jsx` — הוסר "פרטי הבדיקה" מלשונית "השוואה גפן-כספים"
- עודכן `ResultsView.jsx` — נוסף בלוק "קבצי תכנון" (שם קובץ + שלב) בלשונית "סקירה"
- עודכן `ResultsView.jsx` — הועבר "פרטי הבדיקה" (3 בלוקים: קבצי גפן, קבצי כספים, מסקנה) ללשונית "סקירה", מתחת לפרטי בית הספר
- עודכן `tikhnun_processor.py` ו-`analyze_router.py` — הוסף שדה `filename` לכל אובייקט תכנון
