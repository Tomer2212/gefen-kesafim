import { useNavigate, Link } from "react-router-dom";

const SECTIONS = [
  {
    num: "1",
    title: "כללי",
    body: 'אתר גפן AI פועל לפי עקרונות הנגישות כפי שהוגדרו בתקן הישראלי ת"י 5568 (המבוסס על הנחיות WCAG 2.1 ברמה AA). אנו מחויבים לספק חוויית שימוש שווה לכלל המשתמשים, לרבות אנשים עם מוגבלויות.',
  },
  {
    num: "2",
    title: "ההתאמות שביצענו",
    items: [
      'ניווט מקלדת מלא — ניתן לנווט בין כל אלמנטי הממשק באמצעות מקלדת בלבד, ללא שימוש בעכבר.',
      'תגיות ARIA — כל הרכיבים האינטראקטיביים מכילים תגיות ARIA (role, aria-label, aria-modal, aria-current, aria-labelledby) המספקות תיאור מילולי לתוכנות קריאת מסך.',
      'מבנה טבלאות נגיש — כל טבלאות הנתונים כוללות תגיית scope="col" בכותרות העמודות.',
      'נגישות מודאלים — כל חלונות הקופץ כוללים ניהול focus אוטומטי: focus עובר לחלון הנפתח, ניתן לסגור בלחיצת Escape, וה-focus חוזר לאלמנט שממנו נפתח הדיאלוג.',
      "נגישות טפסים — כל שדות הקלט מקושרים לתוויות (label) באמצעות htmlFor ו-id. לצ'קבוקסים יש אינדיקציה ויזואלית של מיקוד מקלדת.",
      'הודעות שגיאה — מוכרזות אוטומטית לקוראי מסך באמצעות role="alert".',
      'מסך טעינה — מכריז אוטומטית לקוראי מסך באמצעות role="status".',
      'אייקונים דקורטיביים — כל הגרפיקה הדקורטיבית מוסתרת מקוראי מסך באמצעות aria-hidden="true".',
      'סימון עמוד נוכחי — פריטי ניווט של העמוד הנוכחי מסומנים עם aria-current="page".',
    ],
  },
  {
    num: "3",
    title: "מגבלות ידועות",
    body: "קבצי ה-Excel המיוצאים מהמערכת אינם מותאמים לנגישות מלאה. אנו פועלים לשיפור מתמיד של רמת הנגישות בכלל רכיבי המערכת.",
  },
];

function Logo() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate("/")}
      aria-label="חזור לעמוד הראשי"
      className="flex items-center gap-2.5"
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
        </svg>
      </div>
      <span className="font-800 text-base" style={{ fontWeight: 800, color: "#0070F3" }}>
        גפן AI
      </span>
    </button>
  );
}

export default function AccessibilityStatementPage() {
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
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              ראשי
            </button>
            <button
              onClick={() => navigate("/terms")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              תנאי שימוש
            </button>
            <button
              onClick={() => navigate("/privacy")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              מדיניות פרטיות
            </button>
            <button
              onClick={() => navigate("/guide")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              הדרכה
            </button>
            <button
              onClick={() => navigate("/contact")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              צור קשר
            </button>
            <span
              aria-current="page"
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-full"
              style={{ background: "rgba(0,112,243,0.08)", color: "#0070F3", fontWeight: 600, cursor: "default" }}
            >
              נגישות
            </span>
          </div>
          <Logo />
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        {/* Heading */}
        <div className="text-center mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>
            הצהרת נגישות
          </h1>
          <p className="text-slate-500 text-sm">
            מערכת בדיקת פערי גפן–כספים &nbsp;·&nbsp; תאריך עדכון אחרון: 8.5.26
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

          {/* Contact section — rendered separately for mailto + Link */}
          <div
            className="glass-card rounded-2xl px-6 py-5 anim-fade-up"
            style={{ animationDelay: "0.15s" }}
          >
            <div className="flex items-start gap-3">
              <span
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-700 mt-0.5"
                style={{ fontWeight: 700, background: "rgba(0,112,243,0.1)", color: "#0070F3" }}
              >
                4
              </span>
              <div className="flex-1">
                <h2 className="text-sm font-800 mb-2" style={{ fontWeight: 800, color: "#1e293b" }}>
                  פרטי התקשרות — רכז הנגישות
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed mb-3">
                  לכל שאלה, בקשה או דיווח על בעיית נגישות, ניתן לפנות לרכז הנגישות:
                </p>
                <p className="text-sm font-600 text-slate-700 mb-1" style={{ fontWeight: 600 }}>
                  תומר אלון
                </p>
                <a
                  href="mailto:geffen360@gmail.com"
                  className="text-sm text-blue-600 hover:underline block mb-2"
                >
                  geffen360@gmail.com
                </a>
                <p className="text-sm text-slate-600">
                  או דרך{" "}
                  <Link to="/contact" className="text-blue-600 hover:underline">
                    טופס 'צור קשר'
                  </Link>
                  {" "}באתר.
                </p>
              </div>
            </div>
          </div>
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
