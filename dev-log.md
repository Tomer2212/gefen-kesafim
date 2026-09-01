# Dev Log

## 2026-09-01 — הרשאה חדשה: "צפייה בכרטיס בית ספר"
- נוספה הרשאה `can_view_school_card` למנגנון ההרשאות (ברירת מחדל ON למנהל וליועץ; owner תמיד מורשה)
- backend `schools_router.py`: הוספה ל-`PERMISSION_DEFAULTS` + `PERMISSION_LABELS`; אכיפה ב-`GET /schools/{id}` (403 כשכבוי); חשיפה ב-`GET /schools/users/me` (כולל fail-open ב-except)
- frontend `AdminPage.jsx`: השורה מופיעה ראשונה תחת קבוצת "בתי ספר" בטאב "הרשאות" (וגם במודאל "הרשאות אישיות")
- frontend `SchoolPage.jsx`: כשההרשאה כבויה — מסך "אין לך הרשאה לצפות בכרטיס בית ספר" במקום תוכן הכרטיס
- frontend `DashboardPage.jsx`: לחיצה על שורת בית ספר לא מנווטת לכרטיס כשההרשאה כבויה (גם ה-cursor/aria מותאמים)
