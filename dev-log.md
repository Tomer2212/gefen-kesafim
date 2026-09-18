# Dev Log

## 2026-09-18 — הארכת תוקף מינימלי לקישורי תיאום ישיר ל-30 יום
- backend/booking_token_logic.py (`create_direct_booking_token`): תוקף מינימלי הועלה מ-7 ל-30 יום מרגע השליחה (ועדיין מוארך עד 3 ימים אחרי סוף טווח התאריכים המבוקש אם הוא ארוך יותר). חל אוטומטית על קישורי תיאום ישיר שנשלחים ממשימות, מכרטיס בית ספר, ומ-AdminMeetingsTab.

## 2026-09-18 — הוספת "סוג פגישה" לכותרת האירוע ביומן Outlook
- backend/routers/schools_router.py (`_build_meeting_subject`): כותרת האירוע ביומן היועץ מתחילה כעת ב-"<סוג פגישה> - " (גפן / שוטף / גפן+שוטף / מחוז) לפני שאר התבנית הקיימת. ללא סוג פגישה מוגדר — הכותרת נשארת כרגיל, ללא תחילית ריקה.
- עודכנו כל 10 נקודות הקריאה ל-`_build_meeting_subject` (יצירה/עדכון/PATCH/שחזור בית ספר/העברת פגישה בין בתי ספר/שיוך מחדש ליועץ, בשני הראוטרים schools_router.py ו-meeting_booking_router.py) כדי להעביר את meeting_service_type.
- frontend/src/components/meetings/MeetingRow.jsx: תצוגת התצוגה המקדימה של הכותרת (בדיאלוג התנגשות) שולחת גם meeting_service_type.
