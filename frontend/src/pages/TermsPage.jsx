import { useNavigate } from "react-router-dom";

const SECTIONS = [
  {
    num: "1",
    title: "כללי",
    body: "השימוש במערכת זו מהווה הסכמה מלאה לתנאי שימוש אלו. אם אינך מסכים לתנאים, אנא הפסק את השימוש באופן מיידי.",
  },
  {
    num: "2",
    title: "מהות השירות",
    body: "המערכת מספקת כלי טכני לצורך השוואה אוטומטית בין קבצי דיווח ביצוע ממערכת הגפן של משרד החינוך לבין קבצי פירוט הוצאות מתוכנות כספים. המערכת אינה מהווה ייעוץ חשבונאי, משפטי או פיננסי מכל סוג שהוא.",
  },
  {
    num: "3",
    title: "הגבלת אחריות",
    items: [
      "המערכת מסופקת \"כמות שהיא\" (AS IS) ללא כל אחריות מפורשת או משתמעת לגבי דיוק התוצאות, שלמותן או התאמתן לכל מטרה שהיא.",
      "התוצאות המוצגות במערכת מבוססות אך ורק על הנתונים שהועלו על ידי המשתמש. אחריות על נכונות הקבצים שהועלו ועל פרשנות התוצאות חלה באופן בלעדי על המשתמש.",
      "בעל המערכת לא יישא בכל אחריות לנזק ישיר, עקיף, מקרי, או תוצאתי הנובע משימוש במערכת, לרבות ובלי לגרוע מכלליות האמור: קיזוזי תקציב על ידי משרד החינוך, החלטות תקציביות שגויות, הליכים משפטיים או מנהליים כלשהם.",
      "המשתמש מצהיר כי הוא מודע לכך שהמערכת עשויה לא לזהות את כל הפערים הקיימים, וכי תוצאות הבדיקה אינן מהוות תחליף לביקורת מקצועית של רואה חשבון מוסמך.",
    ],
  },
  {
    num: "4",
    title: "אחריות המשתמש",
    items: [
      "המשתמש אחראי באופן בלעדי לאימות התוצאות המוצגות מול הנתונים המקוריים.",
      "המשתמש מתחייב שלא לקבל החלטות פיננסיות או תקציביות בהסתמך בלעדי על תוצאות המערכת, ללא בדיקה ואימות נוספים.",
      "המשתמש מאשר כי הוא מורשה לעבד את הנתונים שהוא מעלה למערכת ואחראי לציות לכל דין החל על עיבוד נתונים אלו.",
    ],
  },
  {
    num: "5",
    title: "פרטיות ואבטחת מידע",
    items: [
      "הקבצים המועלאים למערכת מעובדים לצורך ביצוע הבדיקה בלבד ואינם נשמרים לצמיתות לאחר השלמת הבדיקה.",
      "המשתמש אחראי לוודא כי הוא מורשה להעלות את הנתונים הכלולים בקבצים בהתאם להוראות כל דין, לרבות חוק הגנת הפרטיות.",
      "בעל המערכת לא ישתמש בנתונים שהועלו לכל מטרה שאינה מתן השירות.",
    ],
  },
  {
    num: "6",
    title: "קניין רוחני",
    body: "כל הזכויות במערכת, לרבות קוד המקור, העיצוב והלוגיקה שמאחוריה, שמורות לבעל המערכת.",
  },
  {
    num: "7",
    title: "שינויים בתנאים",
    body: "בעל המערכת רשאי לעדכן תנאים אלו בכל עת. המשך השימוש במערכת לאחר עדכון התנאים מהווה הסכמה לתנאים המעודכנים.",
  },
  {
    num: "8",
    title: "דין וסמכות שיפוט",
    body: "תנאים אלו כפופים לדין הישראלי. סמכות השיפוט הבלעדית לכל סכסוך הנובע מתנאים אלו תהא נתונה לבתי המשפט המוסמכים במחוז תל אביב.",
  },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
        </svg>
      </div>
      <span className="font-800 text-base" style={{ fontWeight: 800, color: "#0070F3" }}>
        מערכת גפן–כספים
      </span>
    </div>
  );
}

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      {/* Top navigation */}
      <nav className="topbar sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              ראשי
            </button>
            <button
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-full"
              style={{ background: "rgba(0,112,243,0.08)", color: "#0070F3", fontWeight: 600, cursor: "default" }}
              disabled
            >
              תנאי שימוש
            </button>
          </div>
          <Logo />
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        {/* Heading */}
        <div className="text-center mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>
            תנאי שימוש
          </h1>
          <p className="text-slate-500 text-sm">
            מערכת בדיקת פערי גפן–כספים &nbsp;·&nbsp; תאריך עדכון אחרון: 22.4.26
          </p>
        </div>

        {/* Sections */}
        <div className="flex flex-col gap-4">
          {SECTIONS.map((sec, i) => (
            <div
              key={sec.num}
              className="glass-card rounded-2xl px-6 py-5 anim-fade-up"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div className="flex items-start gap-3">
                {/* Section number badge */}
                <span
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-700 mt-0.5"
                  style={{ fontWeight: 700, background: "rgba(0,112,243,0.1)", color: "#0070F3" }}
                >
                  {sec.num}
                </span>
                <div className="flex-1">
                  <h2 className="text-sm font-800 mb-2" style={{ fontWeight: 800, color: "#1e293b" }}>
                    {sec.title}
                  </h2>
                  {sec.body && (
                    <p className="text-sm text-slate-600 leading-relaxed">{sec.body}</p>
                  )}
                  {sec.items && (
                    <ul className="flex flex-col gap-2">
                      {sec.items.map((item, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
                          <span
                            className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full"
                            style={{ background: "#0070F3", opacity: 0.5 }}
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Back button at bottom */}
        <div className="flex justify-center mt-8">
          <button
            onClick={() => navigate("/")}
            className="btn-blue px-8 py-2.5 text-sm"
          >
            חזרה לדף הראשי
          </button>
        </div>
      </main>
    </div>
  );
}
