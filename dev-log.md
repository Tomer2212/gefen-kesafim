# Dev Log

## 2026-10-30 — העברת פגישה בין שנות לימודים + תיקון אבטחה במחיקת פגישה
- New action "העבר לשנת לימודים אחרת" in the meeting row ⋮ menu (above "מחק") — all three surfaces (SchoolPage, PersonalMeetingsTab, AdminMeetingsTab) via shared MeetingsTable/MeetingRow; new MoveMeetingYearModal.jsx (single-select year row, yellow warning when meeting_date belongs to a different year, success toast).
- New endpoint PATCH /schools/{school_id}/meetings/{meeting_id}/academic-year — changes only academic_year; deliberately no Outlook sync / no emails. Turns reminder ON (never off) for a still-off future scheduled meeting that's eligible under automation 1. Same permission check as PATCH meeting (org + assigned advisor).
- Security fix: DELETE /schools/{school_id}/meetings/{meeting_id} now verifies the school belongs to the caller's org and the meeting belongs to the school (before the Outlook cancel sync). Added cross-org test; security suite 112/112 passed.
- Fix: ⋮ menu in meeting rows crashed the page ("Maximum update depth exceeded") — ActionsMenu's left-edge clamp effect re-derived its position from a width that itself changed with `right`, looping once menu items were wider than min-w (triggered by the new long "העבר לשנת לימודים אחרת" item, esp. alongside "שלח תזכורת לעדכון סטטוס"). Now `w-max` + a single measured shift.

## 2026-10-30 — שעון נוכחות: עמודת ק״מ להחזר נסיעות
- DB: עמודה חדשה `attendance_entries.km NUMERIC(7,1)` (ריק = לא דווח)
- Backend (`attendance_router.py`): שדה `km` ב-`AttendanceDayIn`, ולידציה 0–9999 ועיגול לספרה עשרונית אחת, נכלל ב-audit diff וב-`total_km` בסיכום
- Frontend: עמודה מספרית "ק״מ" בקצה השמאלי של הטבלה (משותפת לאזור אישי ולניהול), "סה״כ ק״מ" בכרטיס הסיכום, עמודת ק״מ + סה״כ בייצוא לאקסל (אישי + כל העובדים); שמירת הערות לא מאפסת את הק״מ; רוחב אחיד לעמודות קבצים/הערות/ק״מ
