# Dev Log

## 2026-05-11 — תיקון: מסך אפור לאחר התחברות
- הוחלף `navigate("/")` ב-`window.location.replace("/")` בדף ההתחברות לאחר login מוצלח
- הוחלף `navigate("/login")` ב-`window.location.replace("/login")` בפונקציית logout בדף הראשי
- הסיבה: SPA navigation של React Router לא מאתחל מחדש את ה-compositing של Chrome לאנימציות CSS עם `backdrop-filter`, גורם לאלמנטים להיתקע ב-`opacity:0` שחוסם קליקים
- עקבי עם ה-axios interceptor הקיים שכבר משתמש ב-`window.location.href` עבור שגיאות 401

## 2026-05-11 — שינוי שם המערכת ל-"גפן AI" + לוגו קליקבילי
- שונה שם המערכת מ-"מערכת גפן–כספים" ל-"גפן AI" בכל הממשק
- עודכן: כותרת הדפדפן (index.html), דף התחברות, כל דפי הניווט (הדרכה, פרטיות, תנאים, נגישות, צור קשר, ראשי)
- עודכן: תבניות אימייל בשרת (contact_router.py) ותיאור PDF (pdf_exporter.py)
- לוגו בראש כל עמוד הפך לכפתור קליקבילי שמחזיר לעמוד הראשי (/)
