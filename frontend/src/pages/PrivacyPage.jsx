import { useNavigate } from "react-router-dom";

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

const SECTIONS = [
  {
    num: "1",
    title: "כללי",
    body: 'מדיניות פרטיות זו מתארת את האופן שבו מערכת ניתוח תקציב גפ"ן ("המערכת", "האתר") מטפלת במידע המועלה אליה על ידי המשתמשים. השימוש במערכת מהווה הסכמה מלאה ובלתי מסויגת למדיניות פרטיות זו.',
  },
  {
    num: "2",
    title: 'מי אנחנו',
    body: 'המערכת מיועדת לשימוש יועצים כלכליים, חברות ראיית חשבון ומנהלי בתי ספר לצורך ניתוח וביקורת תקציב גפ"ן של מוסדות חינוך.',
  },
  {
    num: "3",
    title: "איזה מידע נאסף",
    intro: "במסגרת השימוש במערכת, המשתמש מעלה קבצים מהסוגים הבאים:",
    items: [
      'קובצי תכנון תקציב גפ"ן (קבצי Excel)',
      "קובצי דיווח ביצוע (קבצי Excel)",
      "קובצי תוכנת כספים (קבצי Excel)",
    ],
    footer: "קבצים אלו עשויים להכיל נתונים פיננסיים של מוסדות חינוך, לרבות שמות תוכניות, סכומים, קודי תקציב ופרטי ספקים.",
  },
  {
    num: "4",
    title: "כיצד המידע מעובד ונשמר",
    items: [
      { text: "הקבצים המועלים מעובדים באופן ", bold: "זמני בלבד", suffix: " לצורך הפקת הדוחות המבוקשים." },
      { text: "הקבצים נשמרים באופן זמני בשרת המערכת לצורך העיבוד ומחיקתם מתבצעת ", bold: "אוטומטית", suffix: " עם סיום הסשן או אתחול השרת." },
      { text: "", bold: "אין שמירה קבועה", suffix: " של קבצי המקור או תוצאות הניתוח לאחר סיום העיבוד." },
      { text: "המידע אינו מועבר לצדדים שלישיים, אינו משמש לצרכי פרסום ואינו נמכר.", bold: null },
    ],
  },
  {
    num: "5",
    title: "אבטחת מידע",
    body: "המערכת נוקטת באמצעי אבטחה סבירים להגנה על המידע המועלה במהלך עיבודו. יחד עם זאת, המשתמש מאשר כי אין אבטחה מוחלטת בסביבת אינטרנט, ועל כן ההעלאה מתבצעת על אחריותו בלבד.",
  },
  {
    num: "6",
    title: "אחריות המשתמש",
    items: [
      { text: "המשתמש אחראי לוודא כי הוא מורשה להעלות את הקבצים למערכת.", bold: null },
      { text: "המשתמש אחראי לוודא כי אינו מעלה מידע אישי מעבר לנדרש לצורך הניתוח.", bold: null },
      { text: "אין להעלות קבצים המכילים מידע אישי רגיש שאינו נחוץ לניתוח התקציבי.", bold: null },
    ],
  },
  {
    num: "7",
    title: "שינויים במדיניות הפרטיות",
    richBody: [
      { text: "המערכת שומרת לעצמה את הזכות לעדכן מדיניות פרטיות זו בכל עת וללא הודעה מוקדמת. " },
      { bold: "האחריות לעיון במדיניות הפרטיות המעודכנת חלה על המשתמש בלבד." },
      { text: " המשך השימוש במערכת לאחר פרסום גרסה מעודכנת מהווה הסכמה לתנאיה החדשים. תאריך העדכון האחרון מצוין בראש מסמך זה." },
    ],
  },
  {
    num: "8",
    title: "יצירת קשר",
    body: "לשאלות בנוגע למדיניות פרטיות זו ניתן לפנות אלינו דרך פרטי הקשר המופיעים באתר.",
  },
];

function BulletItem({ children }) {
  return (
    <li className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
      <span
        className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full"
        style={{ background: "#0070F3", opacity: 0.5 }}
      />
      <span>{children}</span>
    </li>
  );
}

function RichItem({ item }) {
  if (typeof item === "string") {
    return <BulletItem>{item}</BulletItem>;
  }
  if (item.bold) {
    return (
      <BulletItem>
        {item.text}
        <strong style={{ fontWeight: 700, color: "#1e293b" }}>{item.bold}</strong>
        {item.suffix}
      </BulletItem>
    );
  }
  return <BulletItem>{item.text}{item.suffix}</BulletItem>;
}

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
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
              onClick={() => navigate("/terms")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              תנאי שימוש
            </button>
            <button
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-full"
              style={{ background: "rgba(0,112,243,0.08)", color: "#0070F3", fontWeight: 600, cursor: "default" }}
              disabled
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
            <button
              onClick={() => navigate("/accessibility")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              נגישות
            </button>
          </div>
          <Logo />
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        <div className="text-center mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>
            מדיניות פרטיות
          </h1>
          <p className="text-slate-500 text-sm">
            מערכת בדיקת פערי גפן–כספים &nbsp;·&nbsp; תאריך עדכון אחרון: 8.5.26
          </p>
        </div>

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

                  {/* Plain body */}
                  {sec.body && (
                    <p className="text-sm text-slate-600 leading-relaxed">{sec.body}</p>
                  )}

                  {/* Rich body (inline bold spans) */}
                  {sec.richBody && (
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {sec.richBody.map((chunk, j) =>
                        chunk.bold
                          ? <strong key={j} style={{ fontWeight: 700, color: "#1e293b" }}>{chunk.bold}</strong>
                          : <span key={j}>{chunk.text}</span>
                      )}
                    </p>
                  )}

                  {/* List with optional intro + footer */}
                  {(sec.intro || sec.items || sec.footer) && (
                    <div className="flex flex-col gap-2">
                      {sec.intro && (
                        <p className="text-sm text-slate-600 leading-relaxed mb-1">{sec.intro}</p>
                      )}
                      {sec.items && (
                        <ul className="flex flex-col gap-2">
                          {sec.items.map((item, j) => (
                            <RichItem key={j} item={item} />
                          ))}
                        </ul>
                      )}
                      {sec.footer && (
                        <p className="text-sm text-slate-500 leading-relaxed mt-1 pt-2 border-t border-slate-100">
                          {sec.footer}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Closing note */}
        <div
          className="mt-6 rounded-2xl px-5 py-4 anim-fade-up text-center"
          style={{ background: "rgba(0,112,243,0.05)", border: "1px solid rgba(0,112,243,0.12)" }}
        >
          <p className="text-xs text-slate-500 leading-relaxed italic">
            השימוש במערכת מהווה אישור כי קראת את מדיניות הפרטיות, הבנת אותה והסכמת לתנאיה.
          </p>
        </div>

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
