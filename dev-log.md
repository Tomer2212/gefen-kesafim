# Dev Log

## 2026-06-30 — Feat: פופאפ תזכורת פגישה קבועה + תיקון date parsing
- **Frontend `MeetingReminderPopup.jsx` (חדש):** פופאפ קבוע בפינה שמאלית-תחתונה עם 4 כפתורים — "סגור", "מעבר לכרטיס ביה"ס", "עדכון סטטוס פגישה" (5 אפשרויות + API call), "הזכר בהמשך" (5/10/15/30 דקות לפני + אישור).
- **Frontend `Sidebar.jsx`:** תיקון באג date parsing — `new Date(m.meeting_date)` (UTC midnight) הוחלף ב-`new Date(\`${m.meeting_date}T${m.start_time}:00\`)` (שעון מקומי). הוספת state `meetingReminders` (נפרד מ-`toasts`). לוגיקת snooze: sessionStorage key `snooze:{timestamp}` מאפשר יקיצה מחדש בזמן שנקבע. אפשרות גם `dismissed` (ערך "1") שחוסמת סופית. הפופאפ מרונדר ב-`z-[52]` מעל ה-toasts.
- **Fix: sessionStorage key כולל גם תאריך ושעה** (`reminder-{id}-{date}-{time}`) — כך שינוי שעה בפגישה קיימת יוצר מפתח חדש ולא ייחסם על ידי dismiss קודם.
- **Cleanup: הסרת debug logs + החזרת interval ל-60 שניות** — ניקוי קוד debug זמני; interval 60s מבטיח 5 הזדמנויות לתפוס חלון של 5 דקות.

## 2026-07-02 — Feat: toast אישור אחרי עדכון סטטוס פגישה
- **NotificationToast.jsx:** הוספת type `meeting_status_updated` (אייקון ✅) + תמיכה ב-`duration` דינמי לכל toast (ברירת מחדל 6s).
- **Sidebar.jsx:** הוספת `showSuccessToast(message)` — יוצר toast ✅ למשך 3 שניות; מועבר לשני פופאפי הפגישות.
- **MeetingStatusUpdatePopup.jsx:** כל 3 נתיבי העדכון (כן / לא / זמן שונה) מציגים toast מותאם אחרי הצלחה.
- **MeetingReminderPopup.jsx:** כפתור "עדכון סטטוס פגישה" מציג toast מותאם אחרי הצלחה; "הזכר בהמשך" כבר היה עם אישור מובנה.

## 2026-07-02 — Fix: end_time נשמר ללא נקודותיים ומונע התראת סיום
- **`SchoolPage.jsx`:** הוספת `normalizeTime()` שמנרמלת ערך זמן לפני שליחה ל-API — מטפלת ב-race condition בין blur של שדה הזמן לבין blur של השורה, שגרם ל-"1504" להישמר במקום "15:04", מה שגרם לתאריך לא חוקי ב-`new Date(...)` ולהתראת הסיום לא לקפוץ.

## 2026-07-02 — Feat: חלוניות תזכורת צפות בין עמודים + ערימת כרטיסים
- **`src/context/MeetingRemindersContext.jsx` (חדש):** Context ברמת App — שומר state של חלוניות (`reminders[]`, `activeKey`, `userName`) כך שהן שורדות ניווט בין עמודים.
- **`src/components/MeetingRemindersOverlay.jsx` (חדש):** רינדור החלוניות הצפות — לוגיקת ערימת כרטיסים: הראשונה מוצגת במלואה, הבאות מציגות רק כותרת; לחיצה על כותרת מרחיבה אותה וקומטת את הקודמת. סדר החלוניות תמיד נשמר.
- **`App.jsx`:** הוספת `AppLayout` (layout route) המרנדר Outlet + Overlay, ועטיפה ב-`MeetingRemindersProvider`.
- **`Sidebar.jsx`:** הסרת state מקומי של חלוניות; שימוש ב-context (`addMeetingReminder`, `addStatusReminder`); הסרת רינדור החלוניות מה-Sidebar.
- **`MeetingStatusUpdatePopup.jsx`:** שינוי צבע כותרת מירוק לתכלת (`sky`) למניעת בלבול עם כפתור "כן".

## 2026-07-02 — Fix: לוגיקת סינון פופאפ עדכון סטטוס
- **Frontend `Sidebar.jsx`:** הסרת `created_by` מה-fallback של `meetingAdvisors` — כשאין יועץ מבצע, ההתראה עוברת ליועצי בית הספר בלבד (מובטח שתמיד יש לפחות אחד, כי יצירת ביה"ס ללא יועץ חסומה בפרונטאנד).
- **Backend `schools_router.py`:** הסרת `created_by` מה-SELECT ב-`get_upcoming_meetings` (שדה לא נדרש יותר).

## 2026-06-30 — Feat: פופאפ עדכון סטטוס פגישה בסיום
- **Backend `schools_router.py`:** הוספת `PATCH /{school_id}/meetings/{meeting_id}` — partial update שמעדכן רק שדות שנשלחו (לא נוגע ב-advisor_ids/participants); הרחבת SELECT ב-`get_upcoming_meetings` לכלול `end_time, status, notes`.
- **Frontend `MeetingStatusUpdatePopup.jsx` (חדש):** פופאפ ירוק בפינה שמאלית-תחתונה עם כותרת "עדכון סטטוס פגישה" + שאלה "האם הפגישה עם X בוצעה מ-HH:MM עד HH:MM?". כפתורים: "כן" (עדכון מיידי ל-completed), "לא" (בחירת סטטוס + הערה חובה + "עדכן סטטוס"), "זמן שונה" (עדכון start/end time + "עדכן סטטוס פגישה לבוצעה"). הערה מצורפת עם חותמת תאריך+שעה+שם יועץ; אם קיימת הערה — מצטרפת עם 3 שורות ריקות ביניהן.
- **Frontend `Sidebar.jsx`:** הוספת `statusReminders` state + `dismissStatusReminder`; בלולאת `checkMeetingReminders` — בדיקה לפגישות שסיימו (`end_time` עבר, status='scheduled') בתוך חלון של 2 שעות; sessionStorage key נפרד `status-reminder-{id}-{date}-{end_time}`. לוגיקת הצגה: אם הפגישה עם יועצים מבצעים (`advisor_ids`) — רק הם רואים; אם ללא — מוצג ליועצים המשויכים לבית הספר (`school_advisor_ids`).
- **Fix: `get_upcoming_meetings` מוסיף `school_advisor_ids`** — שאילתה נוספת ל-`advisor_schools` לכל בית ספר בתוצאות, למיפוי fallback.

## 2026-06-30 — Fix: בחירת יועץ מבצע בפגישות לא הציגה בעלים ומנהלים
- **Frontend `SchoolPage.jsx`:** שורות 3978–3979 — הפילטר `u.role !== "owner"` סינן בעלים לחלוטין; מנהלים עברו דרך `advisorHasAccess` שמחזיר false אם אינם ב-`schoolAdvisors`. תוקן כך שבעלים ומנהלים תמיד מופיעים ב-`usersWithAccess`; רק יועצים (advisor) ממשיכים לעבור דרך `advisorHasAccess`.

## 2026-06-29 — Fix: קריסת SchoolPage בגלל canDelete לא מוגדר
- **Frontend `SchoolPage.jsx`:** `canDelete` היה מוגדר רק בתוך `ChecksTab` אך נקרא ב-`SchoolPage`. נוסף state `canDeleteMeetings` ב-`SchoolPage` ומולא מ-`meRes.data?.can_delete_own_meetings`; תוקן הפאס ל-`MeetingsTable`.

## 2026-06-29 — Fix: הסתרת קבוצת "חיובים" מטאב הרשאות בחשבון מנהל
- **Frontend:** `PERM_GROUPS` — נוסף `ownerOnly: true` לקבוצת "חיובים"; טאב הרשאות מסנן קבוצות עם `ownerOnly` כאשר `myRole === "manager"`

## 2026-06-29 — Fix: כפתורי הרשאות מושבתים (grey-out) כשלמנהל אין `can_manage_user_permissions`
- **Backend:** `get_me` מחזיר כעת גם `can_manage_user_permissions`
- **Frontend:** `AdminPage` — state חדש `canManagePermissions` (מאותחל `false`); מוגדר מ-`/users/me`; ב-`PermToggle` נוסף `noPermEdit = myRole === "manager" && !canManagePermissions`; מצורף ל-`disabled` — כשמנהל ללא הרשאה, כל כפתורי כן/לא מופיעים מואפלים ובלתי לחיצים

## 2026-06-29 — Fix: הסתרת כפתור "מחק" ברשימת משתמשים כשאין הרשאת `can_delete_users`
- **Backend:** `get_me` מחזיר כעת גם `can_delete_users`
- **Frontend:** `AdminPage` — state חדש `canDeleteUsers` (מאותחל `false`); מוגדר מ-`/users/me`; כפתור "מחק" ליד כל משתמש מוצג רק כאשר `myRole === "owner" || canDeleteUsers`

## 2026-06-29 — Feat: חלונית אישור שחזור בית ספר
- **`frontend/src/pages/AdminPage.jsx`** — נוסף `RestoreSuccessModal` שמוצג לאחר שחזור מוצלח של בית ספר מסל המחזור, עם שם בית הספר וכפתור אישור ירוק

## 2026-06-29 — Fix: כיסוי נתיב מחיקה bulk ב-DashboardPage
- **`frontend/src/pages/DashboardPage.jsx`** — נוסף `RecycleBinInfoModal` שמוצג לאחר מחיקת בתי ספר מרובה (bulk delete) דרך מצב הסימון; מציג ספירת בתי הספר שנמחקו

## 2026-06-29 — Feat: מודל "הועבר לסל המחזור" לאחר אישור/ביצוע מחיקת בית ספר
- **`frontend/src/pages/SchoolPage.jsx`** — `handleSchoolDelete` מציג עכשיו `RecycleBinInfoModal` לאחר מחיקה מוצלחת (במקום לנווט הביתה מיד); ניווט מתרחש רק לאחר לחיצת "אישור" בחלונית
- **`frontend/src/pages/AdminPage.jsx`** — נוסף `RecycleBinInfoModal` שמוצג לאחר כל מחיקת בית ספר (ישירה מהרשימה, ישירה מטופס עריכה) עם שם בית הספר, הסבר על 30 יום, וכפתור אישור ירוק
- **`frontend/src/pages/NotificationsPage.jsx`** — `RecycleBinInfoModal` מוצג גם לאחר אישור בקשת מחיקה של יועץ; נוסף prop `onDeleteApproved` ל-`NotificationRow`

## 2026-06-29 — Fix: מחיקת בית ספר → סל מחזור + כותרת "בתי ספר פעילים"
- **`backend/routers/schools_router.py`** — `delete_school` endpoint: שונה מ-hard delete לsoft-delete (מעדכן `status: "pending_deletion"` ו-`deleted_at`) כדי שכל מחיקה תעבור לסל מחזור ולא רק מחיקות דרך בקשת יועץ
- **`frontend/src/pages/AdminPage.jsx`** — נוספת כותרת "בתי ספר פעילים" מעל רשימת בתי הספר הפעילים — מוצגת רק כאשר קיימים בתי ספר בסל מחזור

## 2026-06-29 — Fix: leeway=60 בבקאנד + לוגינג JWT + same-token guard (שלב 13)
- **`backend/auth.py`** — הוספת `leeway=timedelta(seconds=60)` ל-`jwt.decode`: מאפשר 60 שניות גמישות ל-clock skew בין הבקאנד לשרתי Supabase; הוספת `logger.warning` מפורט שמדפיס בטרמינל של uvicorn את סוג השגיאה המדויק ("expired" / "invalid + ClassName")
- **`frontend/src/main.jsx`** — `console.warn('[Auth 401]', url, detail)` לאבחון; same-token guard: אם `refreshSession()` מחזיר אותו טוקן שנדחה → logout מיידי במקום retry חסר תועלת

## 2026-06-29 — Fix: החלפת getSession() אסינכרוני ב-_currentToken סינכרוני (שלב 12)
- **`main.jsx`** — Request Interceptor שונה מ-`async` (עם `await getSession()`) לסינכרוני עם `_currentToken` מודול-לבל
- `_currentToken` מאותחל מ-`getSession()` בטעינה ומתעדכן דרך `onAuthStateChange` (אירוע סינכרוני) — מבטיח שהטוקן תמיד עדכני ללא race condition
- נתיבי ה-retry ממשיכים להשתמש ב-`data.session.access_token` ישירות + `_retried: true` — אינם תלויים ב-`_currentToken` כלל

## 2026-06-29 — Fix: headers סטריליים לחלוטין ב-retry — רק Authorization טרי (שלב 11)
- **`main.jsx`** — שני נתיבי retry: הוסרה כל לוגיקת cleanHeaders/toJSON; headers ה-retry הם עכשיו `{ 'Authorization': \`Bearer \${token}\` }` בלבד — אובייקט חדש וסטרילי ללא כל שאריות state מ-original.headers

## 2026-06-29 — Fix: שימוש ב-_retried flag ב-Request Interceptor במקום בדיקת headers (שלב 10)
- **`main.jsx`** — Request Interceptor: הוחלף `if (config.headers?.Authorization || config.headers?.authorization)` ב-`if (config._retried)` — flag שורשי ב-plain config object, תמיד נגיש ב-Axios v1.x, מבטיח bypass מוחלט של getSession() לכל retry request

## 2026-06-29 — Fix: שימוש ב-toJSON() לחילוץ headers אמיתי מ-AxiosHeaders ב-retry (שלב 9)
- **`main.jsx`** — שני נתיבי retry: `{ ...original.headers }` הוחלף ב-`original.headers.toJSON()` — חילוץ plain object אמיתי מ-AxiosHeaders instance, מניעת spread שבור שייצר אובייקט ריק ובלתי שמיש

## 2026-06-29 — Fix: ניקוי מלא של Authorization לפני זריקת טוקן טרי ב-retry (שלב 8)
- **`main.jsx`** — שני נתיבי retry (queue `.then()` + direct refresh): הוחלף `{ ...original.headers, Authorization: token }` ב-`cleanHeaders` — spread + מחיקה מפורשת של `'Authorization'` ו-`'authorization'` לפני הזרקת הטוקן הטרי, מונע duplicate key שגורם לטוקן הפגום לנצח

## 2026-06-29 — Fix: Authorization Header Injection ידני לretry + bypass מדויק (שלב 7)
- **`main.jsx`** — Request Interceptor: נוסף guard `if (config.headers?.Authorization || config.headers?.authorization) return config;` — bypass `getSession()` אם header כבר קיים, מונע דריסת טוקן טרי שהוזרק ידנית ע"י retry path
- **`main.jsx`** — Response Interceptor (queue): `p.resolve()` → `p.resolve(token)` — token מועבר מפורשות לכל בקשה ממתינה בqueue
- **`main.jsx`** — שני נתיבי retry: הוספת `headers: { ...original.headers, Authorization: \`Bearer \${token}\` }` לbuild של בקשת axios החדשה — מבטיח שה-Request Interceptor יראה את ה-header ויבצע bypass ללא קריאה ל-getSession

## 2026-06-29 — Fix: Fresh Axios Request במקום axios(original) לפתרון AxiosHeaders double-dispatch (שלב 6)
- **`main.jsx`** — Request Interceptor: הוסרה שורת `if (config._freshToken) return config;` — כבר לא נדרש כי הretry יוצר config חדש
- **`main.jsx`** — Response Interceptor (queue `.then()`): `axios(original)` הוחלף ב-`axios({ method, url, baseURL, data, params, timeout, _retried: true })` — config נקי ללא AxiosHeaders מזוהמים
- **`main.jsx`** — Response Interceptor (direct refresh): אותה החלפה — בקשת axios חדשה עם config מינימלי
- **`main.jsx`** — Queue: `p.resolve(token)` → `p.resolve()` — token כבר לא עובר בqueue, Request Interceptor מוסיף אותו אוטומטית דרך `getSession()`

## 2026-06-29 — Fix: AxiosHeaders Case-Sensitivity Mutation Bug ב-Retry Requests (שלב 5)
- **`main.jsx`** שורה 43 (queue `.then()`): הוחלף `original.headers.Authorization = ...` ב-`original.headers.set('Authorization', ...)` — מונע יצירת duplicate key ב-AxiosHeaders internal map (`"authorization"` ישן vs `"Authorization"` חדש), מבטיח שהטוקן הטרי מחליף את הישן ב-case-insensitive upsert
- **`main.jsx`** שורה 60 (direct refresh path): אותה החלפה — `headers.set()` במקום direct assignment

## 2026-06-29 — Fix: מניעת דריסת Authorization Header ב-Retry Requests (שלב 4)
- **`main.jsx`** — Request Interceptor: נוסף guard `if (config._freshToken) return config;` בתחילת ה-interceptor — מונע קריאה ל-`getSession()` ודריסת ה-header על retry requests שכבר נושאים טוקן טרי
- **`main.jsx`** — Response Interceptor מיקום A (queue `.then()`): נוסף `original._freshToken = true` לפני `return axios(original)` — מסמן retry שיעקוף את ה-Request Interceptor
- **`main.jsx`** — Response Interceptor מיקום B (direct refresh path): נוסף `original._freshToken = true` לפני `return axios(original)` — אותו סימון לנתיב הישיר

## 2026-06-29 — Fix: INITIAL_SESSION Race Condition — חסימת רינדור דפים עם Expired Token (שלב 3)
- **`App.jsx`** — נוספה `sessionIsValid(session)` ברמת המודול: בודקת `session.expires_at` מול UTC נוכחי עם מרווח 60 שניות
- **`App.jsx`** — `PrivateRoute`: כעת מציג ספינר גם כאשר `session !== null` אבל `!sessionIsValid(session)` — מונע רינדור דפים כאשר `onAuthStateChange` מפעיל `INITIAL_SESSION` עם `access_token` פגום לפני שה-auto-refresh הסתיים
- **`App.jsx`** — `AdminRoute`: אותה בדיקה — מחזיר `null` כאשר session קיים אך הטוקן פגום

## 2026-06-29 — Fix: ביצור Response Interceptor ו-Session Guard (שלב 2)
- **`main.jsx`** — שכתוב response interceptor: (א) הוספת טיפול ב-retry-after-refresh שגם הוא 401 — signOut + redirect מיידי (באג A); (ב) עטיפת `refreshSession()` ב-try/catch כדי ש-`_refreshing` תמיד מתאפס גם אם refresh זורק כשל רשת (באג B); (ג) הוספת `return Promise.reject(err)` מפורש בכל נקודת redirect למניעת fall-through לקומפוננטות (באג C+D)
- **`Sidebar.jsx`** — נוספה `sessionIsValid(session)` ברמת המודול: בודקת `session.expires_at` מול UTC נוכחי עם מרווח 60 שניות — מחזירה `false` לטוקן פגום (לא רק null)
- **`Sidebar.jsx`** — `fetchCount()` ו-`checkMeetingReminders()`: הוחלף `if (!session)` ב-`if (!sessionIsValid(session))` — חוסם בקשות עם expired access_token
- **`Sidebar.jsx`** — visibilitychange handler: הוחלף `getSession()` ב-`refreshSession()` — ביקיצה מ-Snooze מתבצע רענון טוקן אקטיבי לפני פתיחת ה-gate לפולינג

## 2026-06-29 — Fix: Race Conditions ב-Auth — תיקון 401 רגעיים ביקיצה מ-Snooze
- **`App.jsx`** — `PrivateRoute`: החלפת `return null` בספינר טעינה (`role="status"`) בזמן שה-session עדיין `undefined` — מונע flash של מסך ריק ומבטיח שאף Sidebar לא מורנדר לפני שהסשן ידוע (RC-2)
- **`Sidebar.jsx`** — נוסף `wakeRefreshRef = useRef(null)` לניהול Promise של רענון טוקן ביקיצה
- **`Sidebar.jsx`** — `fetchCount()`: נוסף wake guard (`await wakeRefreshRef.current`) ו-session guard (`getSession()` + `if (!session) return`) לפני כל בקשת axios (RC-1, RC-3)
- **`Sidebar.jsx`** — `checkMeetingReminders()`: אותם guards כנ"ל (RC-1, RC-3)
- **`Sidebar.jsx`** — נוסף `useEffect` עם `visibilitychange` listener: ביקיצה מ-Snooze, מגדיר `wakeRefreshRef.current` ל-Promise של `getSession()` שמרענן טוקן; הפולינג ממתין לסיום הרענון לפני שמוציא בקשות API (RC-3, RC-4)

## 2026-06-28 — Fix: כל הרשאות משתמשים וחיובים מסומנות "לא רלוונטי" בעמודת יועץ
- **Frontend:** `PERM_GROUPS` — `advisorNA` בקבוצת "משתמשים" הורחב לכלול גם `can_invite_users`; נוסף `ADVISOR_NA_PERMS` (Set מאוחד מכל `advisorNA` בכל הקבוצות); `PermToggle` משתמש ב-`ADVISOR_NA_PERMS` — כל הרשאה מקבוצת "משתמשים" ו"חיובים" מציגה "לא רלוונטי" בעמודת יועץ

## 2026-06-28 — Fix: הרשאות ניהול משתמשים לא רלוונטיות ליועץ בטבלת ההרשאות
- **Frontend:** `PermToggle` — הוספת `USER_MGMT_PERMS` (can_invite_users, can_delete_users, can_change_user_role, can_manage_user_permissions); כאשר `role === "advisor"` ו-perm שייך לקבוצה זו מוצג "לא רלוונטי" במקום כפתורי כן/לא
- **Backend:** כל 4 ההרשאות כבר חסומות ברמת תפקיד (role-level) — לא נדרש שינוי

## 2026-06-28 — Fix: הסתרת טופס הזמנת משתמש וייבוא אקסל כשאין הרשאת `can_invite_users`
- **Backend:** `get_me` מחזיר כעת גם `can_invite_users`
- **Frontend:** `AdminPage` — state חדש `canInviteUsers` (מאותחל `false` למניעת flash); מוגדר מ-`/users/me`; כפתור "ייבוא מאקסל" + טופס "הזמן משתמש חדש" מוצגים רק כאשר `myRole === "owner" || canInviteUsers`

## 2026-06-28 — Fix: חלונית "שינויים שלא נשמרו" — כפתורים בשורה אחת
- **AdminPage + SchoolPage:** הרחבת החלונית מ-`max-w-sm`/`max-w-md` ל-`max-w-lg`; הוספת `whitespace-nowrap` לכל הכפתורים — כפתורי "שמור שינויים", "אל תשמור", "ביטול" כעת בשורה אחת סימטרית

## 2026-06-28 — Fix: מנהל לא יכול להזמין משתמש עם תפקיד בעלים
- **Frontend:** בטופס "הזמן משתמש חדש" ב-AdminPage, האפשרות "בעלים" בדרופדאון תפקיד מוצגת עכשיו רק כאשר המשתמש המחובר הוא בעלים (`myRole === "owner"`)

## 2026-06-28 — Fix: כפתור מחיקה בטאב בדיקות ופגישות לפי הרשאת `can_delete_own_meetings`
- **Backend:** `_can_delete_check_log` עודכן להשתמש ב-`_check_permission(db, user, "can_delete_own_meetings")` — אחיד עם נקודת הקצה של מחיקת פגישה; `get_me` מחזיר כעת גם `can_delete_own_meetings`
- **Frontend:** `canDelete` בSchoolPage עודכן ל-`meUser.can_delete_own_meetings` (הוסרה הישנה `managers_can_delete` שלא הייתה קיימת בbackend); טאב הפגישות מעביר `canDeleteMeetings={canDelete}` ל-`MeetingsTable`; `MeetingRow` מציג את עמודת הפעולות (⋮) רק כאשר `onRequestDelete` מסופק

## 2026-06-28 — Feat: חלונית אישור לאחר הגשת בקשת עדכון (SchoolPage)
- לאחר הגשת בקשה מוצלחת (`submitFullRequest`) נפתחת `UpdateRequestSuccessModal`
- מציגה: ✅ "הבקשה נשלחה בהצלחה" + טבלת diff (שדה | לפני | אחרי) עם תרגום ערכי enum לעברית
- `FIELD_LABELS` + `formatFieldValue` הוגדרו כ-constants מחוץ לקומפוננטה לשימוש חוזר

## 2026-06-28 — Feat: diff תוצאה גם בהתראת הבעלים על אישור חלקי
- **Backend:** הודעה לבעלים (`update_request_result`) כוללת כעת `proposed_changes`, `approved_fields`, `is_partial`; כותרת משתנה ל"אישר באופן חלקי" כשרלוונטי
- **Frontend:** `isResultExpandable` כולל גם `update_request_result`; `RequestResultDiff` מקבל `status` מ-`data.status` להתראות מסוג זה

## 2026-06-28 — Feat: diff תוצאה ביועץ לאחר אישור/דחייה חלקיים
- **Backend:** Phase 4 (הודעה ליועץ): מחשב `is_partial`, `approved_fields_list`; מעדכן כותרת ל"אושרה באופן חלקי" במקרה מתאים; שומר `proposed_changes`, `approved_fields`, `is_partial` בנתוני ההתראה
- **Frontend:** `RequestResultDiff` — קומפוננטה read-only עם שורות ירוקות (✓ אושר) / אדומות (✕ נדחה); `update_request_approved` / `update_request_rejected` הופכות ל-expandable כשיש `proposed_changes`; ה-chevron ›  מופיע גם להן; הערת סוקר מוצגת בפתיחה

## 2026-06-28 — Feat: אישור/דחייה נקודתיים לשדות בבקשת עריכה
- **Backend:** `ReviewRequestIn` מקבל `approved_fields: list[str] | None`; Phase 2 מסנן את `changes` לשדות המאושרים בלבד אם סופק הפרמטר
- **Frontend (`NotificationsPage.jsx`):** `ProposedChangesDiff` מקבל `fieldDecisions` + `onDecide`; כשיש 2+ שדות מוצגים כפתורי ✓/✗ עגולים בכל שורה עם visual feedback (שורה ירוקה=מאושרת, אדומה+קו=דחויה); כפתור גלובלי "אשר שינויים" שולח רק שדות לא-דחויים ומשנה כיתוב ל-"אשר שדות נבחרים" כשיש דחויים; "דחה" → "דחה הכל"

## 2026-06-28 — Feat: התראה ליועץ כשמשנים restrict_access_to
- `update_school` (`PUT /schools/{id}`): לפני ה-UPDATE שולף את `restrict_access_to` הנוכחי; לאחר ה-UPDATE מחשב diff; שולח `advisor_assigned` ("קיבלת גישה לבית הספר X") ליועצים שנוספו ו-`advisor_removed` ("הגישה שלך הוסרה") לאלה שהוסרו; non-fatal, pref_key=`notify_advisor_assignment`

## 2026-06-28 — Feat: התראה ליועצים בשחזור בית ספר
- `restore_school`: לאחר UPDATE מוצלח — שולף שם בית הספר + רשימת יועצים משויכים, שולח לכל יועץ `advisor_assigned` notification עם כותרת "בית הספר X שוחזר על ידי הבעלים והוחזר לטיפולך"; non-fatal

## 2026-06-28 — Feat: Soft Delete / Recycle Bin לבתי ספר

**DB:**
- `schools`: הוספת `status TEXT NOT NULL DEFAULT 'active'` ו-`deleted_at TIMESTAMPTZ`

**Backend (`schools_router.py`):**
- `review_update_request` Phase 2: מחיקה פיזית → soft UPDATE (`status='pending_deletion'`, `deleted_at=now()`); הודעת שגיאה חזרה לעברית נקייה
- `review_update_request` Phase 4: כותרת התראה לבעלים כוללת "הנתונים יימחקו סופית תוך 30 יום"
- `list_schools`: פרמטר `include_deleted: bool = False`; ברירת מחדל מחזיר רק `status=active`; advisor מקבל תמיד `False`
- Endpoint חדש: `POST /schools/{id}/restore` — בעלים בלבד; מחזיר status='active', deleted_at=null

**Frontend (`AdminPage.jsx`):**
- `loadSchools` קורא `?include_deleted=true`
- פיצול הרשימה: בתי ספר פעילים למעלה, סל מחזור למטה (opacity-50 + grayscale + badge "מיועד למחיקה" + טיימר "X ימים נותרו")
- כפתור "שחזר" מוצג לבעלים בלבד

## 2026-06-28 — תיקון: 500 + אטומיות ב-review_update_request (Round 3)

**שני כשלים שתוקנו:**

1. **500 בגלל FK שבורה בשרשרת CASCADE:**
   - `check_logs.gefen_account_id → gefen_accounts(id)` היה `ON DELETE NO ACTION`
   - כשמוחקים בית ספר: PostgreSQL CASCADE → מחיקת `gefen_accounts` → FK violation מ-`check_logs.gefen_account_id` → 500
   - **תיקון DB:** `check_logs.gefen_account_id` FK: `NO ACTION → SET NULL` (via Management API)

2. **אטומיות שבורה — status="approved" לפני שהמחיקה הצליחה:**
   - Phase 1 עדכן `status="approved"` → Phase 2 נכשל ב-500 → status תקוע → לחיצה שנייה → 400 "כבר טופלה" → קוע לצמיתות
   - **תיקון קוד:** הסרת עדכון הסטטוס מ-Phase 1; Phase 3 חדש (retry, non-fatal) מעדכן סטטוס רק אחרי שהפעולה הפיזית הצליחה

## 2026-06-28 — Feat: התראה כאשר יועץ/מנהל מוסיף בית ספר חדש
- **Backend:** `create_school` שולח התראת `school_created` לבעלים ולמנהלים (כשיועץ מוסיף) או לבעלים בלבד (כשמנהל מוסיף); pref_key: `notify_school_created`; נוסף ל-`NotificationPreferencesIn`
- **Frontend:** `TYPE_ICON` מוסיף `school_created: "➕"`; SettingsModal מוסיף toggle לבעלים ("בית ספר חדש נוסף על ידי יועץ או מנהל") ולמנהל ("יועץ הוסיף בית ספר חדש")

## 2026-06-28 — תיקון: בית ספר לא נמחק + ניסוח התראה לבעלים

**שורש הבעיה — מחיקה שנכשלת בשקט:**
- `check_logs.school_id` FK היה `ON DELETE NO ACTION` — כל בית ספר עם היסטוריית בדיקות לא ניתן למחיקה
- לולאת ה-retry ב-Phase 2 (delete) בלעה את שגיאת ה-FK בשקט וסימנה `school_deleted = True` ממילא → התראות נשלחו, בית הספר לא נמחק

**תיקון DB:** `check_logs.school_id` FK: `NO ACTION → CASCADE`

**תיקון קוד:**
- מחיקת `school_deleted = True` מחוץ ללולאת ה-try — עכשיו מוגדר רק בתוך ה-`try` (אחרי הצלחה)
- כשלון בשתי הניסיונות: `raise HTTPException(500)` (לא בליעה שקטה)

**תיקון ניסוח:**
- התראה לבעלים: "מנהל X אישר את בקשת המחיקה של בית הספר Y שהוגשה על ידי Z" (במקום "מנהל X מחק את Y")

## 2026-06-28 — תיקון: 503 + התראות לא נשלחות כשמנהל מאשר בקשת מחיקה (Round 2)

**שלוש בעיות שזוהו בטסט:**
1. **503 על PATCH:** `review_update_request` לא עקב אחרי Invariant #5 — `db = get_admin_client()` היה מחוץ לכל retry loop. חיבור מתנוון גרם לקריסה לפני ביצוע כל פעולה
2. **מחיקת בית ספר — timeout:** CASCADE DELETE על טבלאות רבות עלול לחרוג מ-3 שניות של httpx. הביצוע קורס לפני קוד ההתראות, אך Postgres מסיים את המחיקה ברקע
3. **"✓ בית הספר נמחק" לבעלים שלא אישר:** `reviewed` state אותחל מ-`data.request_status` גם למי שלא ביצע הפעולה — הבעלים ראה הודעת הצלחה כאילו הוא אישר

**תיקון Backend:**
- Retry loop (2 attempts) לשלב 1 (validate + status update) — `db = get_admin_client()` inside try
- מחיקת בית ספר בלולאת retry משלה + `school_deleted = True` תמיד (גם אם httpx timeout — Postgres מסיים)
- כל בלוק התראות בנפרד (advisor + owner) — try/except עצמאי לכל אחד, כשלון באחד לא חוסם את השני

**תיקון Frontend:**
- `reviewedByViewer` boolean — `true` רק כשהצופה עצמו לחץ "אשר"/"דחה"
- כשמנהל אישר ובעלים פותח את ההתראה: מציג "ℹ בקשה זו כבר טופלה" (neutral) ולא "✓ בית הספר נמחק"

## 2026-06-28 — תיקון: התראות נעלמות + לא נשלחות כשמנהל מאשר בקשת מחיקה

**שורש הבעיה (3 כשלים בשרשרת):**
1. `notifications.school_id` ו-`school_update_requests.school_id` היו מוגדרים `ON DELETE CASCADE` — מחיקת בית הספר גוררת מחיקת ההתראה הקיימת (ה"בעלים" ראה את ההתראה נעלמת) ומחיקת שורת הבקשה עצמה
2. עדכון סטטוס הבקשה לאחר מחיקת בית הספר לא מצא שורה לעדכן (כבר cascade-נמחקה)
3. INSERT של התראות חדשות עם `school_id` של בית ספר שנמחק → FK violation → `_create_notifications` בלע את השגיאה בשקט

**תיקון DB (Management API):**
- `notifications.school_id` FK: `CASCADE` → `SET NULL`
- `school_update_requests.school_id` FK: `CASCADE` → `SET NULL`

**תיקון קוד (`review_update_request`):**
- סדר הפעולות שונה: שמירת שם בית הספר + עדכון סטטוס הבקשה **לפני** מחיקת בית הספר
- כשבית הספר נמחק: `school_id=None` בהתראות החדשות (FK מאפשר NULL)
- deeplink ליועץ בבקשת מחיקה: `/notifications` (לא `/school/<deleted-id>`)

**תיקון frontend:** כפתורי "אשר" ו"דחה" — `flex-1` לגודל שווה

## 2026-06-26 — שיפורי מערכת ההתראות — 5 בעיות מ-UX testing

### Backend (`schools_router.py`)
- **בקשת מחיקה — כותרת נכונה:** `submit_update_request` מזהה `_action: "delete_school"` ומגדיר כותרת "X הגיש בקשה למחיקת בית הספר Y" (במקום "X ביקש לערוך"); מוסיף `is_delete_request: True` לנתוני ההתראה
- **current_values בבקשת עריכה:** מצרף ערכים נוכחיים מ-DB לנתוני ההתראה (`current_values: {field: current_val}`) כדי שהמאשר יראה ממה למה
- **נוטיפיקציה לבעלים כשמנהל מאשר/דוחה:** `review_update_request` שולח התראה מסוג `update_request_result` לכל הבעלים כשמנהל (לא בעלים) מאשר/דוחה בקשה
- **`notify_update_request_result`** נוסף ל-`NotificationPreferencesIn`

### Frontend (`NotificationsPage.jsx`)
- **TYPE_ICON:** `update_request_result: "📋"` נוסף
- **SettingsModal (owner):** נוסף toggle "מנהל אישר או דחה בקשת עדכון" → `notify_update_request_result`
- **ProposedChangesDiff:** הורחב ל-3 עמודות (שדה | ערך נוכחי | ערך חדש); `VALUE_LABEL` ממיר ערכי enum לעברית (yesodi→יסודי, kesafim2000→כספים 2000 וכו'); דילוג על שדה `_action`
- **כפתורי אשר/דחה:** ירוק לייט (`btn-green-light`) + אדום מלא (`bg-red-500`), מיושרים למרכז
- **בקשת מחיקה:** כשיש `is_delete_request=true` — ללא diff, ללא שדה הערה, כפתורים בלבד ("✓ אשר מחיקה" / "✕ דחה"); הודעת אישור: "✓ בית הספר נמחק בהצלחה"

## 2026-06-26 — הרשאה חדשה: can_request_school_update
- **Backend:** הוסף ל-`PERMISSION_DEFAULTS` (`advisor: true`, `manager: true`), ל-`PERMISSION_LABELS`, ול-`get_me`; בדיקה בתוך `submit_update_request` — אם לא `can_edit_school_directly` ולא `can_request_school_update` → 403
- **AdminPage:** RowPermission `can_request_school_update` מופיע בטבלה תחת `can_edit_school_directly`; מתג מושבת (grayed + tooltip) כאשר `can_edit_school_directly=true` לאותו role (כי אז הגשת בקשה אינה רלוונטית)
- **SchoolPage:** כפתור "בקש עדכון פרטים" מותנה ב-`!canEditDirectly && canRequestUpdate`; שדה `canRequestUpdate` נטען מ-`/users/me`

## 2026-06-26 — תיקון: יועץ עם can_edit_school_directly מקבל 403 בעת עריכה
- **Backend `update_school`:** הוסרה `_require_manager`; יועץ עם הרשאת `can_edit_school_directly` שמוקצה לבית הספר יכול לעדכן ישירות
- **Frontend `startEdit()`:** קריאות ל-`/advisors` ו-`/users/all` (שדורשות מנהל) נעשות כעת רק עבור בעלים/מנהל
- **פורמת עריכה:** סקציית "ליווי" (יועץ מלווה + הגדרות גישה) מוסתרת ליועצים

## 2026-06-26 — עיצוב מחדש של חווית עריכה/בקשה ליועץ בדף בית הספר
- **יועץ ללא עריכה ישירה:** כפתור "בקש עדכון פרטים" פותח את אותה פורמת עריכה מלאה כמו בעלים/מנהל; כפתור השליחה מציג "הגש בקשה" במקום "שמור שינויים"; `submitFullRequest()` שולח את השינויים לטבלת `school_update_requests`
- **יועץ עם עריכה ישירה:** מציג "ערוך פרטים" — עריכה ישירה זהה למנהל
- **כפתור ⋮ במצב בקשה:** גלוי כאשר `isRequestMode || canDeleteSchool`; לחיצה על "מחק בית ספר" פותח `SchoolDeleteRequestConfirmModal` (שולח בקשת מחיקה עם `_action: "delete_school"`)
- **הסרת הפורמה החלקית הישנה:** בלוק `isRequesting` עם שדות חלקיים הוסר לחלוטין
- **Backend:** `review_update_request` תומך ב-`_action: "delete_school"` — מחיקת בית הספר בפועל בעת אישור; `get_me` מחזיר `can_edit_school_directly`

## 2026-06-26 — תיקון: מנהל עם can_manage_user_permissions לא יכול לערוך הרשאות יועץ
- **שורש הבעיה 1:** `PUT /permissions/defaults` קרא ל-`_require_owner` — חסם מנהלים לחלוטין
- **שורש הבעיה 2:** מנהל שמר `owner_id: user["id"]` (ID של עצמו), אך GET מחפש לפי `_get_owner_id` → שורה שנשמרה לא נמצאה
- **תיקון:** הרחבת הגישה ל-`set_permission_default` — מנהל עם `can_manage_user_permissions` יכול לשנות הרשאות role-level של יועצים בלבד; השמירה נעשית תחת `owner_id` של הבעלים (לא המנהל)

## 2026-06-26 — הרשאת מחיקת בתי ספר — תמיכה ביועצים
- **Backend**: הסרת `_require_manager` מ-`delete_school`; יועץ עם `can_delete_schools=true` יכול למחוק — אך רק בתי ספר שהוא מוקצה אליהם (בדיקת `advisor_schools`)
- **Frontend**: `editBlocked` ב-`PermToggle` חל כעת רק על מנהלים (לא על יועצים) — מתג מחיקה ליועץ ניתן לעריכה ללא תלות ב-`can_edit_school_directly`

## 2026-06-24 — הרשאת מחיקת בתי ספר — עדכון UI לכל 3 הנתיבים
- **Dashboard**: כפתור "סמן בית ספר" בתפריט ⋮ מופיע כעת לכולם (כדי לאפשר Excel/PDF); כפתור "מחק" בסרגל הפעולות מוצג רק למי ש-`canDelete=true`
- **AdminPage (עריכה)**: כפתור ⋮ בראש טופס עריכת בית ספר מוצג רק אם `canDeleteSchool=true` (נקרא מ-/users/me)
- **הרשאות**: כיבוי `can_edit_school_directly` מכבה אוטומטית גם את `can_delete_schools` (cascade); מתג המחיקה disabled+tooltip כשעריכה ישירה מכובה

## 2026-06-24 — Fix: הסרת כפתור מחק מרשימת בתי ספר (AdminPage)
- כפתור "מחק" הוסר מכל שורה ברשימת בתי הספר בפאנל ניהול — מחיקה עדיין זמינה דרך תפריט ⋮ בתוך טופס העריכה

## 2026-06-24 — Fix: שדה יועצים משולב + כפתור שמור ירוק (AdminPage)
- שדה "יועצים אחראיים" בעריכת בית ספר: chips ושדה חיפוש מאוחדים בקופסה אחת (כמו שדה "גישה"), כולל כפתור × להסרה ישירה
- כפתור "שמור שינויים" שונה לצבע ירוק לייט (`btn-green-light`, #22c55e)

## 2026-06-24 — Feat: מחיקת בית ספר דרך 3 נקודות בטופס עריכה (AdminPage + SchoolPage)
- כפתור "מחק בית ספר" הוסר מתחתית הטופס בשני המסכים
- נוסף כפתור ⋮ בפינה השמאלית העליונה של כותרת הטופס — לחיצה מציגה "מחק בית ספר" עם חלונית אישור
- ב-SchoolPage: ⋮ מופיע רק אם `can_delete_schools=true` (מ-/users/me); לחיצה על מחק מנווטת חזרה לדשבורד לאחר מחיקה
- ב-AdminPage: ⋮ מופיע רק כש-`editingSchool !== null`
- כפתורי "שמור שינויים" + "ביטול" הועברו לתחתית הטופס ומיושרים למרכז בשני המסכים

## 2026-06-24 — Feat: ייצוא Excel ו-PDF לבתי ספר מסומנים בדשבורד
- כפתור "הורד EXCEL" (ירוק) מייצא את בתי הספר הנבחרים עם העמודות הגלויות כקובץ xlsx
- כפתור "הורד PDF" (חום) שולח headers+rows לבאקאנד, מקבל PDF עם גופן NotoSansHebrew ומוריד אותו
- בבאקאנד: endpoint חדש `POST /schools/export-pdf` מייצר טבלה RTL עם reportlab

## 2026-06-24 — Feat: כפתורי פעולה במצב סימון בתי ספר בדשבורד
- בסימון לפחות בית ספר אחד מופיעים שני כפתורים: "ביטול סימון" ו-"מחק"
- "ביטול סימון" מנקה את כל הסימונים תוך שמירת מצב הסימון (המשבצות נשארות גלויות)
- "מחק" פותח חלונית אישור עם מספר בתי הספר המסומנים; אחרי אישור — מוחק את כולם ויוצא ממצב סימון

## 2026-06-24 — Fix: כפתור "סמן בית ספר" בדשבורד לא הופיע לאף אחד
- בבאקאנד: `GET /users/me` מחזיר עכשיו `can_delete_schools` (מחושב דרך `_check_permission` הקיים)
- בפרונטאנד: `canDelete` מסתמך על `can_delete_schools` במקום `managers_can_delete` שלא קיים
- הגיון: owner תמיד רואה; manager רואה רק אם הבעלים הפעיל הרשאה בניהול; advisor לא רואה

## 2026-06-24 — הרשאות: מנהל רואה רק עמודת יועץ בטאב הרשאות
- בטאב "הרשאות" בפאנל הניהול: כשמחובר חשבון מנהל — עמודת "מנהל" מוסתרת, המנהל רואה ויכול לערוך רק הרשאות של יועצים
- רק בעלים רואה ויכול לערוך את שתי העמודות ("מנהל" ו"יועץ")
- ה-`colSpan` של כותרות הקבוצות מתאים עצמו דינמית לפי מספר העמודות הגלויות

## 2026-06-24 — אבטחה: הפרדת "הוסף בית ספר" מאזור הניהול
- **הבעיה:** יועץ עם הרשאת `can_add_school` נשלח ל-`/admin` שם ראה טאבי "משתמשים" ו"הרשאות"
- **פתרון:**
  - נוצר דף חדש `AddSchoolPage.jsx` בנתיב `/school/new` — מכיל את פורמת הוספת בית הספר בלי טאבי ניהול
  - `DashboardPage`: כפתור "הוסף בית ספר" מנווט כעת ל-`/school/new` (במקום `/admin`)
  - `AdminPage`: useEffect חדש מבצע redirect ליועצים (`myRole === "advisor"`) ל-`/` — יועץ שינסה לגשת ל-`/admin` ישירות יופנה מיד
  - `App.jsx`: נוסף route חדש `/school/new`
  - `backend/schools_router.py`: הרחבת `create_school` ו-`create_account` לאפשר ליועצים עם הרשאת `can_add_school` — עם auto-assignment לאחר יצירה

## 2026-06-24 — גישה אוטומטית לפי יועצים בהוספת בית ספר
- שדה "גישה" מתחיל ריק (לא "כולם") כל עוד לא נבחר יועץ מלווה — תקף הן ב-AdminPage והן ב-AddSchoolPage
- בחירת יועץ ראשון → גישה מקושרת אוטומטית ל"היועצים המלווים שנבחרו"
- הסרת כל היועצים → גישה חוזרת לריק
- כפתור "↺ כולם" מופיע רק כשיש chips פעילים (לא כשהשדה ריק)
- תיקון: AccessSelector נפתח ונסגר מיד בלחיצה ראשונה — הוסר `onFocus` מה-container שגרם לפתיחה כפולה

## 2026-06-24 — שיפורי UnsavedChangesModal ב-AdminPage
- תיקון לוגיקת `isDirty`: כשטופס הוספת בית ספר פתוח אך ריק — החלונית כבר לא קופצת; מתבצעת בדיקה שהוזן תוכן בפועל (name/symbol/stage/advisors)
- עיצוב כפתורים: "אל תשמור" (אדום) ו"ביטול" (ירוק) הופכים לשורה אופקית מתחת ל"שמור שינויים" — תואם עיצוב `NavigationBlockerModal` ב-AddSchoolPage

## 2026-06-24 — שיפורי UI ב-AddSchoolPage
- `Sidebar` הוחלף ל-`<Sidebar dark />` בשני מצבי הרינדור (loading + main) — תואם עיצוב שאר הדפים
- נוסף `NavigationBlockerModal`: כשטופס הוספת בית ספר מלוכלך (`isDirty`) ולוחצים על ניווט אחר — קופצת חלונית עם "המשך לערוך" (ירוק) ו"עבור לעמוד המבוקש" (אדום)
- מממש `useBlocker` מ-react-router-dom עם `useFocusTrap` ו-WCAG role="dialog"

## 2026-06-24 — תיקון: טולטיפ צהוב לא הופיע על כפתור 'הוסף בית ספר' ב-AdminPage
- **שורש הבעיה:** `myRole` ב-AdminPage נקבע אך ורק מ-`user_metadata.role` בתוך ה-JWT (session cache). אחרי שינוי תפקיד (advisor→manager), ה-JWT עדיין הכיל `role:"advisor"`, ולכן `canAddSchool = null` (לא `false`) → הכפתור היה disabled אבל תנאי הטולטיפ `canAddSchool === false` לא התקיים
- **תיקון:** הוספת קריאה ל-`/schools/users/me` מיד לאחר `getSession()` ב-AdminPage useEffect לאישור ה-role מהשרת, בדיוק כמו ב-Sidebar ו-DashboardPage

## 2026-06-23 — שיפור: retry sleep מ-100ms ל-300ms בכל endpoints
- ניווטים מהירים בין עמודים גורמים ל-AbortController לבטל בקשות באמצע — מה שמשאיר את ה-httpx.Client בסינגלטון עם חיבור לא יציב. 100ms לא תמיד מספיק לאוסף החיבורים להתאושש לפני הניסיון השני → 503
- הוגדל ל-300ms בכל לולאות ה-retry ב-schools_router.py

## 2026-06-23 — תיקון: כפתור 'הוסף בית ספר' הופיע ליועץ לאחר שינוי תפקיד
- **שורש הבעיה:** `canAddSchool` חושב מ-`user_metadata.role` מה-JWT (מיד בהתחלה) — אחרי שינוי תפקיד מ"מנהל" ל"יועץ", ה-JWT עדיין הכיל `role:"manager"` → key="manager" → `can_add_school.manager=true` → כפתור הופיע
- **תיקון:** הסרת חישוב `canAddSchool` המוקדם מה-JWT; הלוגיקה הועברה לאחר `/users/me` → `confirmedRole` → key נכון → הרשאה נכונה

## 2026-06-23 — UX הרשאה can_add_school: כפתור מוסתר במסך הבית
- **DashboardPage:** כפתור "הוסף בית ספר" (header + empty state) מוצג **רק** כש-`canAddSchool === true`; נסתר לגמרי כשאין הרשאה או בזמן טעינה
- **AdminPage:** ההתנהגות הקיימת נשמרת — כפתור disabled + tooltip צהוב

## 2026-06-23 — תיקון: מנהל שינה את תפקיד עצמו (שגיאה מוטעית הסוותה הצלחה)
- **שורש הבעיה:** PATCH הצליח (backend לא חסם self-modification); ה-403 שהוצג נבע מ-`loadUsers()` שנכשל לאחר שינוי התפקיד — המשתמש חשב שהשינוי נחסם אך בפועל הוא בוצע
- **Backend:** נוספה בדיקה ראשונה בתוך retry: `if user["role"] == "manager" and user_id == user["id"] → 403`
- **Frontend:** dropdown ה-select של השורה של המשתמש המחובר עצמו disabled + tooltip כשמדובר במנהל; נוסף `myUserId` state

## 2026-06-23 — תיקון: Sidebar מציג "ניהול" לחשבון שהורד לדרגת יועץ
- **שורש הבעיה:** Sidebar קרא `role` מ-JWT (`user_metadata`) לפני קבלת `/users/me` — JWT מכיל תפקיד ישן ולא מתעדכן אוטומטית
- **תיקון Sidebar:** `useState(null)` במקום `"advisor"`; הסרת `setRole(metaRole)` הראשוני — תפקיד מוגדר רק אחרי `/users/me` חוזר (fallback לmeta רק אם /users/me נכשל). כך "ניהול" לא מוצג בזמן הטעינה
- **תיקון Backend:** `update_role()` מעדכן כעת גם `user_metadata.role` ב-Auth — JWT הבא יכיל את התפקיד המעודכן
- **הסרת גרשיים מהתראות:** "מ'מנהל' ל'יועץ'" → "ממנהל ליועץ"

## 2026-06-23 — אישור שינוי תפקיד + התראות
- **Frontend:** שינוי תפקיד פותח `RoleChangeConfirmModal` עם "האם אתה בטוח שאתה רוצה לשנות את התפקיד של X מ'Y' ל'Z'?" ושני כפתורים אופקיים "כן" / "לא"
- **Frontend:** ה-select עכשיו קורא ל-`requestRoleChange()` במקום `changeRole()` ישירות; ה-API נקרא רק לאחר אישור
- **Backend:** לאחר שינוי תפקיד מוצלח — נשלחות התראות (non-fatal):
  - לחשבון שתפקידו שונה: "התפקיד שלך שונה מ'X' ל'Y'"
  - לכל הבעלים והמנהלים בארגון (מלבד מבצע השינוי ומלבד היעד): "התפקיד של [שם] שונה מ'X' ל'Y'"

## 2026-06-23 — הרשאה חדשה: can_change_user_role
- **Backend:** נוספה `can_change_user_role` ל-`PERMISSION_DEFAULTS` (מנהל=לא, יועץ=לא) ול-`PERMISSION_LABELS`
- **Backend:** `update_role()` — הורחב מ-owner-only: מנהל עם `can_change_user_role=true` יכול לשנות תפקידים, אך:
  - לא יכול לשנות את התפקיד של חשבון בעלים
  - לא יכול להעניק תפקיד "בעלים" לאף אחד
- **Frontend (`PERM_GROUPS`):** `can_change_user_role` נוסף לקבוצת "משתמשים" לפני "לערוך הרשאות של יועצים"; עמודת יועץ מציגה "—"
- **Frontend (users tab):** dropdown התפקיד:
  - disabled + title tooltip כשאין הרשאה לשינוי תפקידים
  - disabled גם כשמנהל מנסה לערוך חשבון בעלים
  - option "בעלים" מוצג רק לבעלים (לא למנהל)

## 2026-06-23 — תיקון: מנהל רואה 'יועץ' לחשבון בעלים
- **Frontend:** option של "בעלים" ב-select תפקידים היה מרונדר בתנאי `myRole === "owner"` — כשמנהל צפה ברשימה, ה-option לא היה קיים ב-DOM ולכן הדפדפן הציג את ה-option הראשון ("יועץ"). תוקן: ה-option תמיד מרונדר (ה-select כבר disabled למנהלים המסתכלים על בעלים)

## 2026-06-23 — הגנה: לא ניתן לשנות תפקיד הבעלים האחרון
- **Backend:** `update_role()` — נוספה בדיקה: אם המשתמש הנערך הוא `owner` ויש רק בעלים אחד בארגון, הבקשה נחסמת עם 400 ועם הסבר ברור
- **Frontend:** `changeRole()` — עטוף ב-try/catch, שגיאה מוצגת בהודעה ויזואלית מעל טבלת המשתמשים
- **DB Fix:** שוחזר תפקיד `owner` לחשבון geffen360@gmail.com דרך Management API (profiles + auth.users metadata)

## 2026-06-23 — הרשאה חדשה: can_delete_users
- **Backend:** נוספה `can_delete_users` ל-`PERMISSION_DEFAULTS` (מנהל=לא, יועץ=לא) ול-`PERMISSION_LABELS`
- **Backend:** `delete_user()` — הורחב מ-owner-only: מנהל יכול למחוק אם `can_delete_users=true`; בדיקת הרשאה בתוך retry loop לפי Invariant #5
- **Frontend:** `can_delete_users` נוסף לקבוצת "משתמשים" ב-`PERM_GROUPS` בין "להוסיף משתמש חדש" ל-"לערוך הרשאות של יועצים"; עמודת יועץ מציגה "—"

## 2026-06-23 — הרשאות: עדכוני UX נוספים + תיקוני bugs

### תיקון `_get_owner_id` — שורש הבעיה במערכת ההרשאות
- `_get_owner_id()` החזירה `user["org_id"]` (UUID של טבלת organizations) במקום profile UUID של בעלים — הרשאות לא נמצאו אף פעם עבור חשבונות מנהל/יועץ
- **תיקון:** קריאה ל-`profiles WHERE role='owner' AND org_id=user['org_id']` להחזרת ה-profile UUID הנכון

### כפתור "הוסף בית ספר" — UX שיפורים
- **AdminPage + DashboardPage:** הכפתור מוצג כ-disabled+tooltip צהוב כשאין הרשאה
- **שלוש מצבי state (`null`/`true`/`false`):** null = טוען (disabled ללא tooltip), false = אסור (disabled + tooltip), true = מותר
- **DashboardPage:** ממשה גם לחשבון יועץ (לא רק owner/manager)

### מבנה טאב הרשאות — שינויים נוספים
- **הוחזרה שורת `can_invite_users`** ("להוסיף משתמש חדש") שנמחקה בטעות
- **הוסרה `can_download_excel`** לחלוטין (backend + DB + frontend)
- **קבוצות:** ה-tbody מרונדר כעת עם `PERM_GROUPS` + `Fragment` (תיקון warning של React key prop)
- **כותרות קבוצות** בצבע navy, עם underline עדין

## 2026-06-23 — מערכת הרשאות: איחוד מלא + עיצוב UX חדש

### Backend
- **הסרת מנגנון delegate_approvals_to_managers לחלוטין:**
  - הוסר `DelegationSettingIn` model
  - הוסרה `update_my_settings()` endpoint (`PATCH /users/me/settings`)
  - הוסר `managers_can_delete` מ-`get_me()`
  - הוסרו כל ה-SELECT של `delegate_approvals_to_managers`
- **`_get_approver_ids()`** מחושב כעת דרך `_check_permission(db, mgr, "can_approve_update_requests")` לכל מנהל בארגון (במקום boolean גלובלי)
- **`_can_delete_check_log()`** קורא ל-`_check_permission` במקום `delegate_approvals_to_managers`
- **הוספת 2 הרשאות חדשות:** `can_view_billing` ו-`can_manage_billing` (ברירת מחדל: מנהל=לא, יועץ=לא)

### Frontend — טאב הרשאות
- **עיצוב חדש:** טבלה אחת עם עמודות (הרשאה | מנהל | יועץ) במקום שני כרטיסים נפרדים
- **קבוצות:** "ניהול בתי ספר" / "ניהול משתמשים" / "חיובים" / "הגדרות מתקדמות" (accordion מכווץ ברירת מחדל)
- **עמודת יועץ:** הרשאות שאינן רלוונטיות ליועץ מציגות "—" (לאשר בקשות, חיובים, ניהול הרשאות)
- **`can_manage_billing`** מדליק אוטומטית `can_view_billing` אם כבוי בעת הפעלה

### Frontend — טאב חיובים
- הטאב "חיובים" מוסתר מ**מנהל** אלא אם `can_view_billing = true` עבור תפקיד מנהל
- **בעלים** תמיד רואה את הטאב
- יועץ אינו ניגש לדף ניהול בכלל
- `permDefaults` נטענות מייד בעת כניסה לדף (לא רק בביקור בטאב הרשאות) כדי שהנראות של הטאב תהיה מיידית

## 2026-06-26 — מודל הגדרות התראות מורחב
- **Frontend:** `SettingsPanel` (popover קטן) הוחלף ב-`SettingsModal` (מודל מלא) עם useFocusTrap, `role="dialog"`, סגירה ב-Escape + לחיצה מחוץ
- **Frontend:** נוסף חלק "שלח לי התראה כאשר:" עם toggles לפי תפקיד — בעלים (4 אפשרויות), מנהל (3), יועץ (3)
- **Backend:** `_create_notifications` קיבל פרמטר `pref_key` אופציונלי — לפני insert מסנן מקבלים שהגדירו `false` עבור אותו key (ברירת מחדל `true`)
- **Backend:** `NotificationPreferencesIn` הורחב עם 6 מפתחות חדשים: `notify_update_request_submitted/reviewed`, `notify_school_deleted`, `notify_advisor_assignment`, `notify_role_changed`, `notify_mention`
- כל 8 קריאות ל-`_create_notifications` בקוד עודכנו עם `pref_key` המתאים

## 2026-06-23 — הסרת "האצלת סמכות" מפאנל ההתראות
- הוסר סקשן "האצלת סמכות" מ-`SettingsPanel` בדף ההתראות (יועבר לטאב הרשאות)
- נוקו: `delegated` state, `toggleDelegation` פונקציה, `role` state מ-`SettingsPanel`

## 2026-06-23 — תיקון: שדה גישה טוען מיידית ומציג שמות נכונים
- **שורש הבעיה (1):** תצוגת "גישה" בview-mode השתמשה ב-`users/all` — קריאת API נפרדת שמתחילה רק אחרי טעינת בית הספר, גרמה לעיכוב של ~5 שניות
- **שורש הבעיה (2):** פילטר שגוי `!u || u.role !== "owner"` הציג UUID כ-fallback כשמשתמש לא נמצא
- **תיקון backend:** `get_school` מאחד את שתי קריאות ה-profiles (advisor + restrict_access) לקריאה **אחת** ל-DB — מחזיר `restrict_access_profiles` בתוך response בית הספר
- **תיקון frontend:** תצוגת קריאה משתמשת ב-`school.restrict_access_profiles` (זמין מיד) + fallback ל-`users` אם שדה חסר

## 2026-06-23 — תיקון: שדה גישה מציג UUID במקום שם משתמש
- **שורש הבעיה:** בתצוגת קריאה-בלבד של שדה גישה ב-SchoolPage, הפילטר כלל `!u || u.role !== "owner"` — כשמשתמש לא נמצא ב-`users` (טרם נטען), `!u` העביר אותו את הפילטר, והמשתמש ראה `id.slice(0,8) + "..."` (חלק מ-UUID)
- **תיקון:** שינוי הלוגיקה ל-`if (!u || u.role === "owner") return null` — רק משתמשים שנמצאו ואינם owner יוצגו; שאר המזהים מוחזרים כ-null בשקט

## 2026-06-23 — תיקון: כפתורי אשר/דחה מופיעים מחדש לאחר ניווט חוזר להתראות
- **שורש הבעיה:** `reviewed` הוא state מקומי ב-`NotificationRow` — כשהמשתמש יוצא ונכנס מחדש לדף, הקומפוננט עובר remount ו-`reviewed` מתאפס ל-`null`, גם אם הבקשה כבר טופלה ב-DB
- **תיקון backend:** `GET /notifications` מעשיר כל notification מסוג `update_request_submitted` עם `request_status` מטבלת `school_update_requests` (non-fatal enrichment)
- **תיקון frontend:** `reviewed` state מאותחל מ-`data.request_status` שמגיע מה-backend — כך שבמשתמשים שחוזרים לדף הכפתורים לא יופיעו שוב עבור בקשות שכבר טופלו

## 2026-06-22 — תיקון: אין פידבק ויזואלי לאחר לחיצה על "אשר"/"דחה" בהתראות
- **שורש הבעיה:** `catch {}` ריק בלי binding בלע את כל השגיאות בשקט. אם ה-PATCH החזיר 400 (בקשה שכבר טופלה) — לא הוצג שום banner, המשתמש לא ידע מה קרה
- **תיקון:** `catch (err)` עם טיפול ספציפי: 400 → banner אפור "ℹ בקשה זו כבר טופלה"; שגיאות אחרות → `console.error` לדיאגנוסטיקה
- **שיפור UX:** פסק זמן לסגירה הוגדל מ-1400ms ל-2500ms כדי שהמשתמש יספיק לקרוא את ה-banner
- מצב `reviewed` הורחב: `null | "approved" | "rejected" | "already_done"`

## 2026-06-22 — תיקון: כרטיס בית ספר ריק בניווט מהתראות (deeplink)
- **שורש הבעיה:** `SchoolPage` מאתחל `school` מ-`location.state.school` שמועבר בניווט מהדשבורד. כשמגיעים מהתראה (deeplink `/school/{id}`) — אין state → `school = null` → כל שדות "פרטי בית הספר" ריקים
- **Backend:** נוסף `GET /schools/{school_id}` — endpoint חדש עם retry loop, בדיקת גישה ליועצים (restrict_access_to + advisor_schools), והעשרת פרופילים. ממוקם אחרי כל הroutes הסטטיים (מניעת conflict עם `/notifications` ו-`/update-requests`)
- **Frontend (SchoolPage):** ב-`useEffect` הראשי — כשאין `location.state.school` (ניווט ישיר/deeplink) מושכת את נתוני בית הספר מ-`GET /schools/{id}` ומעדכנת `school`, `accounts`, `schoolAdvisors`

## 2026-06-22 — תיקון: 503 ב-list_schools עבור יועץ + הפרת Invariant #5
- **שורש הבעיה:** הפילטר `restrict_access_to.cs.["uuid"]` בתוך `or_()` גרם ל-PostgREST לפרש את הסוגריים המרובעים כגורם grouping syntax, מחזיר APIError — שני הניסיונות הפנימיים נכשלו → 503 (ספציפי לנתיב יועץ)
- **תיקון backend:** שאילתת היועץ פוצלה לשתי שאילתות: Q1 (restrict_access_to IS NULL + id.in.) ו-Q2 עם `.filter("restrict_access_to", "cs", json.dumps([uuid]))` ישיר (לא בתוך or_()) — מיזוג ב-Python עם dedup
- **תיקון Invariant #5:** הוסרה שורת `db = get_admin_client()` שעמדה מחוץ לבלוק ה-retry (אחרי ה-loop) — `db` מהלולאה עדיין תקף
- **הוספת `import json`** לתחילת schools_router.py

## 2026-06-22 — תיקון: שגיאת 503 מ-DashboardPage מופיעה בקונסול בזמן ניווט
- **שורש הבעיה:** כאשר `loadSchools` קיבל 503 מהשרת, ה-frontend המתין 400ms לפני ה-retry. אם המשתמש ניווט לדף אחר בזמן ה-400ms, ה-retry ירה מ-DashboardPage שכבר unmounted ורשם שגיאה נוספת בקונסול
- **תיקון:** נוסף `AbortController` ל-`loadSchools` — בעת unmount מבוטל ה-controller; נוסף בדיקת `controller.signal.aborted` אחרי ה-400ms wait לפני attempt 1; נוסף cleanup `useEffect` שמבצע abort בעת unmount

## 2026-06-22 — טאב חיובים בפאנל ניהול

- **AdminPage:** נוסף טאב "חיובים" משמאל לטאב "הרשאות"
- תת-טאבים חודשיים דינמיים: מציגים את 6 החודשים האחרונים (או פחות, בהתאם לתאריך הצטרפות הארגון — נגזר מ-`created_at` של המשתמש הוותיק ביותר)
- ברירת מחדל: הטאב החודשי העדכני ביותר נבחר אוטומטית
- כל טאב מציג שורת חיוב עם עמודות: תקופת חיוב, מספר בתי ספר, חיוב, אמצעי תשלום
- המבנה מוכן לחיבור דינמי לבסיס נתונים (`billingData[monthKey]`) — כרגע מציג "—" כ-placeholder

## 2026-06-22 — תיקון: כפל התראות + אין פידבק לאחר אישור בקשה
- **Backend:** `review_update_request` מחזיר כעת HTTP 400 אם הבקשה כבר טופלה (`status != "pending"`) — מונע יצירת התראה כפולה בלחיצה חוזרת
- **Frontend:** אחרי לחיצה על "אשר" / "דחה" — מוצג banner ירוק/אדום עם "השינויים אושרו ויושמו בהצלחה" / "הבקשה נדחתה" למשך 1.4 שניות, לאחר מכן השורה נסגרת והרשימה מתרענת
- **Frontend:** כפתורי אשר/דחה מוסתרים לאחר שההתראה סומנה כנקראת — מניעת לחיצה כפולה

## 2026-06-22 — מערכת התראות מלאה

- **DB:** טבלת `notifications` מאוחדת (מחליפה `mention_notifications`); עמודת `notification_preferences` JSONB ב-`profiles` (ברירת מחדל: תזכורות פגישות מופעלות, 10 דק')
- **Backend:** helper `_create_notifications()` לא-fatal; הזרקת התראות ב-6 endpoints: עריכת פרטים, אישור/דחייה, שיוך/הסרת יועץ, מחיקת בית ספר, תיוג בהערה
- **Backend:** `/schools/notifications` משתמש כעת בטבלה החדשה (unread count); נוספו `PATCH notifications/read-all`, `PATCH notifications/{id}/read`, `GET upcoming-meetings`, `PATCH users/me/notification-preferences`
- **Auth:** `_get_profile()` מחזיר כעת `notification_preferences`
- **Frontend — NotificationsPage:** עיצוב מחדש כ-inbox — רשימה מאוחדת, read/unread (bold+רקע כחלחל), לחיצה מרחיבה diff inline לבקשות עריכה עם כפתורי אשר/דחה, כפתור "כבר קראתי הכל", פאנל "התאמה אישית" עם toggle תזכורות ובחירת דקות, האצלת סמכות לבעלים
- **Frontend — NotificationToast:** component חדש, bottom-left, slide-in, auto-dismiss 5 שניות, מקסימום 3 בו-זמנית
- **Frontend — Sidebar:** polling מזהה עלייה ב-count ומוצג toast לכל התראה חדשה; תזכורות פגישות כל 60s מ-`/upcoming-meetings`

## 2026-06-22 — עיצוב כפתורי כן/לא בטאב הרשאות
- המתגים הוחלפו בזוג כפתורים צמודים "כן / לא" — הפעיל כחול/כהה, הלא-פעיל אפור
- סדר ההרשאות עודכן: "הוספת בית ספר חדש" מופיע מעל "עריכת פרטי בית ספר ישירות"

## 2026-06-22 — אכיפת הרשאות בbackend + can_manage_user_permissions
- נוספה `_check_permission(db, user, permission)` — פותרת override → role_default → system_default
- נוספה הרשאה `can_manage_user_permissions` (ברירת מחדל: OFF למנהל ולדמשל — מנהל יכול לערוך הרשאות יועצים בלבד)
- אכיפה ב-5 endpoints: `POST /schools/`, `DELETE /schools/{id}`, `PATCH /update-requests/{id}`, `POST /users/invite`, `DELETE /meetings/{id}`
- `PUT /permissions/overrides/{user_id}` נפתח גם למנהלים עם can_manage_user_permissions (מוגבל ליועצים בלבד)

## 2026-06-22 — מערכת הרשאות דו-שכבתית בדף ניהול
- **DB:** נוצרו טבלאות `permission_settings` (ברירות מחדל לתפקיד) ו-`user_permission_overrides` (החרגות אישיות) עם RLS + service_role grants
- **Backend:** נוספו 4 endpoints — `GET/PUT /schools/permissions/defaults` ו-`GET/PUT /schools/permissions/overrides/{user_id}`; לוגיקת resolution: override ?? role_default
- **Frontend — טאב "הרשאות":** מציג שני כרטיסים (מנהל / יועץ) עם toggle switches לכל הרשאה; auto-save לכל שינוי
- **Frontend — פאנל אישי:** כפתור "הרשאות" בכל שורת משתמש (חוץ מבעלים) → modal עם 3-state selector (ברירת מחדל / מורשה תמיד / חסום תמיד) לכל הרשאה

## 2026-06-22 — תיקון: setup_complete לא נקרא בflow שליחה מחדש
- **שורש הבעיה:** `_get_profile()` ב-auth.py לא שלף את שדה `status`, ולכן `/users/me` החזיר `undefined` לפרונטאנד. SetPasswordPage בדק `status === "pending"` וקיבל `undefined`, אז `isPending` נשאר false ו-`setup_complete` מעולם לא נקרא בflow recovery
- **תיקון auth.py:** הוסף `status` ל-SELECT של `_get_profile()` ולreturn של `get_current_user`
- **תיקון setup_complete:** הוסף retry loop + `invalidate_profile_cache` כדי שהקאש לא ישמור `pending` אחרי העדכון
- **תיקון ידני ב-DB:** עדכון `funnyfootballstories@gmail.com` לstatus=active (כבר השלים הרשמה)

## 2026-06-21 — תיקון קריטי: import שבור גרם לכשל כל ה-schools router
- הסרת `from gotrue.types import GenerateLinkParams, GenerateLinkType` שגרם לכשל טעינת המודול כולו (כל endpoints ב-schools_router החזירו שגיאה)
- החלפה ב-REST API ישיר דרך httpx ל-generate_link
- תיקון fallback של APP_URL מ-localhost לכתובת הייצור
- הוספת retry loop ל-`invite_user` endpoint שחסר לו לחלוטין (Invariant #5)

## 2026-06-21 — תיקון שליחה מחדש של הזמנת יועץ
- **שורש הבעיה:** כשיועץ לוחץ על לינק ההזמנה המקורי, Supabase מסמן את האימייל כ-confirmed. קריאה חוזרת ל-`invite_user_by_email` על משתמש עם אימייל מאושר → exception → 503
- **תיקון backend:** החלפת `invite_user_by_email` ב-`generate_link(type=recovery)` שעובד ללא קשר לסטטוס אישור האימייל; המייל נשלח ידנית דרך Gmail SMTP עם תבנית HTML מותאמת
- **תיקון frontend:** `SetPasswordPage` מזהה כעת שמשתמש pending הגיע דרך `PASSWORD_RECOVERY` (לינק שנשלח מחדש) ומטפל בו כ-flow הזמנה: מציג "ברוכים הבאים!", קורא ל-setup-complete, ומציג מסך הצלחה
