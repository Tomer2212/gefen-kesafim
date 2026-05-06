# Dev Log

## 2026-05-06 — ריפקטור PDF ויצוא משולב
- `pdf_exporter.py` — פוצל לפונקציות story builders (`build_hashva_section_story`, `build_school_info_story`) לתמיכה ביצוא PDF משולב
- `tikhnun_exporter.py` — נוסף `build_tikhnun_section_story()` לתמיכה ביצוא PDF משולב

## 2026-05-06 — תיקוני באגים ושיפורי UI
- `gefen_processor.py` — תיקון באג: `normalize_amount` מטפל כעת במינוס בסוף מספר (פורמט ישראלי: `9600-` → `-9600`); פתר התאמות שגויות בין כספים2000 לגפן
- `analyze_router.py` — שגיאת `UnicodeDecodeError` (קובץ כספים2000 ששמור כ-Excel) מציגה כעת הודעה ידידותית בעברית מעל השגיאה הטכנית
- `MainPage.jsx` — נוסף state `userMsg` להצגת הודעת שגיאה ידידותית
- `ResultsView.jsx` — עמודת תאריך לא גולשת יותר לשורה שנייה (`whitespace: nowrap`)
- `ResultsView.jsx` — לשונית "ביצוע חסר" שונה ל-"דיווח חסר"
- `ResultsView.jsx` — כותרת לשונית "דיווח חסר" עוצבה מחדש להתאמה לסגנון שאר הלשוניות
- `ResultsView.jsx` — עמודת "קוד דיווח" שונה ל-"קוד", ממורכזת ומצומצמת ל-48px בכל הלשוניות
- `ResultsView.jsx` — לשונית "יוזמות וצרכים": כותרת עמודה עודכנה ל-"סכום זמין לתכנון בשקלול תקציב גמיש פנוי"
- `ResultsView.jsx` — לשונית "יוזמות וצרכים": נוספה שורת "תקציב גמיש פנוי" בלוח הסיכום
- `ResultsView.jsx` — לשונית "דיווח חסר" מושבתת כשהועלה קובץ תכנון בלבד (ללא דיווח ביצוע)
