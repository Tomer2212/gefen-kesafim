# Dev Log

## 2026-10-01 — תמיכה בקובץ כספים2000 שנשמר כאקסל (xlsx)
- `backend/logic/kesafim_processor.py`: פוצל `_parse_tsv` ל-`_read_rows` (קריאת שורות — מבחין בין `.xls` גולמי ל-`.xlsx`) ו-`_parse_blocks` (לוגיקת פענוח הבלוקים, ללא שינוי). קובץ כספים2000 שנשמר כ-xlsx אמיתי נקרא עכשיו נכון, בדיוק כמו הקובץ הגולמי.
- `backend/routers/analyze_router.py`: עודכנו 4 מקומות שעשו פענוח raw iso-8859-8 ישירות (ולכן היו דוחים/מפספסים בשקט קובץ כספים2000 מסוג xlsx) — `_kesafim_is_unreadable_binary`, `_kesafim_budget_scoped`, `_split_finance_kesafim`, `_build_finance_ichud_budget_map` — כולם עברו להשתמש ב-`_read_kesafim_rows` המשותף.
- אומת: קובץ `.xls` גולמי קיים (`MCFR1367_60831105405.xls`) מניב תוצאה זהה ביט-לביט לפני/אחרי השינוי (205 שורות). קובץ `.xlsx` דוגמה (`חוברת1.xlsx`) נבדק בהצלחה בכל 4 הנקודות (81 שורות, ichud תקין, לא נתפס כ"קובץ לא קריא").
