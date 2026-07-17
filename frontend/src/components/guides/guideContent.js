// Central registry of step-by-step connection guides, keyed by integration.
// Add a new entry here (and a "הדרכה" button next to its connect button) for
// every future integration — GuideWindow.jsx renders any key generically.
//
// Each step can carry an `image` (path under /public/guides/) showing exactly
// what the user should see at that point.
export const GUIDE_CONTENT = {
  outlook_org: {
    title: "הדרכה: חיבור יומן Outlook ארגוני (Microsoft 365)",
    intro: "החיבור מתבצע פעם אחת בלבד, על ידי אדם עם הרשאת \"מנהל-על\" (Global Administrator) בחשבון ה-Microsoft 365 הארגוני שלכם. לאחר החיבור, כל היועצים בארגון מסונכרנים אוטומטית — בלי שכל אחד יצטרך להתחבר בנפרד. התהליך כולו לוקח כ-2 דקות.",
    steps: [
      {
        title: "שלב 1 — ודאו מי מוסמך לבצע את החיבור",
        body: "נדרש אדם עם הרשאת \"Global Administrator\" בחשבון ה-Microsoft 365 הארגוני של החברה שלכם (לא באתר שלנו — בחשבון האאוטלוק הארגוני עצמו). לרוב זה איש ה-IT של הארגון, או מי שהקים לראשונה את חשבון ה-Microsoft 365. אם אינכם בטוחים מי זה, בררו מול מחלקת ה-IT שלכם ובקשו מהאדם הזה לבצע את השלבים הבאים (או לשבת לידכם לרגע).",
      },
      {
        title: "שלב 2 — היכנסו לטאב \"אינטגרציות\" ולחצו \"חבר יומן ארגוני\"",
        body: "בתפריט הצד, לחצו על \"ניהול\" (1), ואז על הכרטיסייה \"אינטגרציות\" (2, בשורת הכרטיסיות למעלה). זמין רק למשתמשים בתפקיד בעלים או מנהל. תראו כרטיס עם הכיתוב \"Outlook ארגוני (Microsoft 365)\" ותחתיו \"לא מחובר\" באפור — לחצו על הכפתור הכחול \"חבר יומן ארגוני\" (3).",
        image: "/guides/outlook_org/step1-disconnected.png",
      },
      {
        title: "שלב 3 — מסך הכניסה של מיקרוסופט",
        body: "ייפתח מסך לבן עם לוגו Microsoft, וכותרת \"היכנס\". יש שדה עם הכיתוב \"כתובת דוא\"ל, מספר טלפון או Skype\". הקלידו את כתובת הדוא\"ל הארגונית של חשבון ה-Global Admin, ולחצו על הכפתור הכחול \"הבא\".\n\nהערה: אם תידרשו להגדיר אימות דו-שלבי (MFA) לחשבונות מנהלים, ייתכן שתתבקשו קוד אימות בשלב זה. לכן הורידו אפליקציית הזדהות כמו Authenticator, סרקו באמצעות הטלפון הנייד את קוד ה-QR מהעמוד של Microsoft, עד שתקבלו באפליקציה קוד אימות מתחלף בן 6 ספרות. הזינו אותו בעמוד של Microsoft עד שתגיעו למסך \"הרשאות שהתבקשו\".",
        image: "/guides/outlook_org/step2-login.png",
      },
      {
        title: "שלב 4 — הקלידו את הסיסמה",
        body: "במסך הבא יבקשו את הסיסמה של אותו חשבון. הקלידו ולחצו \"היכנס\". ייתכן שתתבקשו גם לאשר \"הישאר מחובר?\" — כל תשובה תקינה, בחרו מה שנוח לכם.",
        image: "/guides/outlook_org/step3-password.png",
      },
      {
        title: "שלב 5 — מסך \"הרשאות שהתבקשו\"",
        body: "יופיע מסך עם כותרת \"הרשאות שהתבקשו\", לחצו \"קבל\".",
        image: "/guides/outlook_org/step4-permissions.png",
      },
      {
        title: "שלב 6 — חזרה למערכת + אימות שהחיבור הצליח",
        body: "הדפדפן יעביר אתכם אוטומטית בחזרה למערכת שלנו, לטאב \"אינטגרציות\". יופיע פס ירוק \"היומן הארגוני חובר בהצלחה!\", והכרטיס יראה \"מחובר ✓\" ירוק במקום הכפתור הכחול. זהו — סיימתם. מרגע זה, כל פגישה שתיקבע במערכת עבור יועץ מהארגון תופיע אוטומטית ביומן ה-Outlook שלו.",
        image: "/guides/outlook_org/step5-success.png",
      },
    ],
    verifyEndpoint: "/calendar/connection",
    verifySuccessCheck: (data) => data?.org?.status === "connected",
  },
};
