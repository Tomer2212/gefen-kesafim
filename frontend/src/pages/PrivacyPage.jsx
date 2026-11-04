import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";

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
    body: 'מדיניות פרטיות זו מתארת את האופן שבו מערכת ניתוח תקציב גפ"ן ("המערכת", "האתר") אוספת, מעבדת ושומרת מידע הקשור למשתמשים בה ולאנשי קשר בבתי ספר. השימוש במערכת מהווה הסכמה מלאה ובלתי מסויגת למדיניות פרטיות זו.',
  },
  {
    num: "2",
    title: 'מי אנחנו',
    body: 'המערכת מיועדת לשימוש יועצים כלכליים, חברות ראיית חשבון ומנהלי בתי ספר לצורך ניתוח וביקורת תקציב גפ"ן של מוסדות חינוך.',
  },
  {
    num: "3",
    title: "איזה מידע נאסף",
    intro: "במסגרת השימוש במערכת נאסף מידע מהקטגוריות הבאות:",
    items: [
      { text: "", bold: "מידע אישי של המשתמשים", suffix: " — שם מלא, כתובת אימייל, מספר טלפון, ותפקיד בארגון (יועץ / מנהל / בעלים)." },
      { text: "", bold: "מידע תפעולי", suffix: ' — פרטי בתי ספר (שם, סמל מוסד, פרטי קשר), קבצי תכנון תקציב, דיווחי ביצוע וקבצי תוכנת כספים המועלים לצורך הבדיקה, לרבות סכומים, קודי תקציב ופרטי ספקים.' },
      { text: "", bold: "מידע טכני", suffix: " — כתובת IP, נתוני התחברות (זמן ומזהה סשן), ונתוני שימוש בסיסיים באתר לצורך תפעולו התקין." },
      { text: "", bold: "מידע על מיילים הקשורים לפגישות", suffix: " — במיילים שהמערכת שולחת לאנשי קשר בבתי ספר לקראת פגישה (תזכורות ובקשות קבצים) נשמרים שם הנמען, תפקידו, כתובת האימייל שלו, תוכן ההודעה ומועד שליחתה. בנוסף, מוטמעת במיילים אלה תמונה שקופה קטנה, המאפשרת לזהות אם המייל נפתח, ונשמר מועד הפתיחה הראשונה שזוהתה. המידע מוצג למשתמשי הארגון שיש להם גישה לבית הספר. הזיהוי אינו מדויק תמיד: חסימת טעינת תמונות בתוכנת הדואר מונעת אותו, וחלק מתוכנות הדואר טוענות תמונות גם בלי שהמייל נקרא." },
      { text: "", bold: "מידע על שיחות ופגישות", suffix: " — בארגון שהפעיל את האפשרויות האלה: נתוני שיחות טלפון (כגון מספר, מועד ומשך), תמלול וסיכום של שיחות, הקלטות של פגישות עם התמלול והסיכום שלהן, ואירועי יומן." },
      { text: "", bold: "שאלות ובקשות לעוזרי ה-AI", suffix: " — מה שהמשתמש כותב לעוזרי ה-AI במערכת." },
    ],
  },
  {
    num: "4",
    title: "מטרת איסוף המידע",
    body: "המידע נאסף אך ורק לצרכים הבאים: אספקת שירותי המערכת (הרצת בדיקות התאמה בין גפן לכספים, ניהול נתוני בתי הספר, היערכות לפגישות ומעקב אחר הודעות וקבצים שהתבקשו לקראתן, תיעוד וסיכום של שיחות ופגישות, ועוזרי AI), מתן תמיכה טכנית למשתמשים, שיפור ותחזוקת ביצועי המערכת, ותקשורת עם המשתמש (עדכונים תפעוליים או פניות תמיכה). המידע אינו משמש לצרכי פרסום.",
  },
  {
    num: "5",
    title: "כיצד המידע מעובד ונשמר",
    items: [
      { text: "הקבצים המועלים לבדיקה (קבצי גפן, קבצי כספים) והקובץ המיוצא (Excel) מעובדים במערכת ונשמרים באחסון מאובטח (Supabase Storage) לצורך שמירת היסטוריית הבדיקות ואפשרות הורדה חוזרת.", bold: null },
      { text: "הקבצים שהועלו לבדיקה ", bold: "נשמרים לתקופה של עד 24 חודשים", suffix: " ממועד הבדיקה, ולאחר מכן נמחקים אוטומטית ולצמיתות משרתי האחסון." },
      { text: "סיכום תוצאות הבדיקה (המספרים והממצאים, ללא הקבצים המקוריים) ", bold: "נשמר ללא הגבלת זמן", suffix: " בהיסטוריית בית הספר במערכת, לצורך מעקב ורצף עבודה." },
      { text: "הקובץ המיוצא (Excel) ונתוני עיבוד זמניים של הרצת בדיקה ", bold: "נמחקים אוטומטית לאחר 120 יום", suffix: "." },
      { text: "המידע הבא ", bold: "נשמר ללא מועד מחיקה אוטומטית", suffix: ", כל עוד הוא נחוץ לארגון, עד למחיקתו בידי הארגון או לפי בקשה (ראו סעיף 8): קבצים שהועלו לקראת פגישה, הקלטות פגישות, תמלולים וסיכומים של שיחות ופגישות, תוכן מיילים ונתוני פתיחה שלהם, חוזים וקבצים שצורפו לבית ספר, ופרטי בתי ספר ואנשי קשר." },
      { text: "פרטי המשתמש נשמרים כל עוד החשבון פעיל.", bold: null },
      { text: "המידע אינו מועבר לצדדים שלישיים למעט לצורך תפעול המערכת עצמה (ראו סעיף 6), אינו משמש לצרכי פרסום ואינו נמכר.", bold: null },
    ],
  },
  {
    num: "6",
    title: "העברת מידע לצדדים שלישיים",
    intro: "המערכת נעזרת בספקי שירות חיצוניים, שמקבלים מידע רק במידה הנדרשת לכל שירות. המידע אינו נמכר ואינו משמש לפרסום. הספקים הם:",
    items: [
      { text: "", bold: "אחסון ותשתית", suffix: " — Supabase (מסד נתונים, התחברות משתמשים ואחסון קבצים, ראו סעיף 7), Render (הפעלת השרתים והאתר) ו-Cloudflare (אחסון סרטוני הדרכה)." },
      { text: "", bold: "שליחת מיילים", suffix: " — Resend (תזכורות, בקשות קבצים והודעות אחרות מהמערכת) ו-Google Gmail (פניות דרך טופס יצירת הקשר והודעות הקשורות להרשמה)." },
      { text: "", bold: "עוזרי AI", suffix: " — Anthropic (סוכן הניהול במערכת) מקבלת את בקשת המשתמש ונתונים מהמערכת הדרושים לביצועה, כגון שמות בתי ספר ואנשי קשר. Google (הצ'אטבוט לעזרה במערכת), או OpenRouter כספק גיבוי, מקבלת את שאלת המשתמש. בדיקת ההתאמה בין גפן לכספים אינה מעבירה את הקבצים לספק AI." },
      { text: "", bold: "סיכום פגישות", suffix: " — בארגון שהפעיל זאת, הקלטת הפגישה ותמלולה נשלחים ל-OpenAI לצורך תמלול וסיכום." },
      { text: "", bold: "יומן ודואר ארגוני", suffix: " — בארגון שחיבר את Microsoft Outlook, אירועי יומן ומיילים עוברים דרך Microsoft." },
      { text: "", bold: "טלפוניה", suffix: " — בארגון שחיבר ספק שיחות (Voicenter או EXM), נתוני שיחות מתקבלים ממנו, וב-Voicenter גם תמלול וסיכום שיחה." },
      { text: "", bold: "WhatsApp (טרם פעיל)", suffix: " — ככל שארגון יפעיל בעתיד שליחה דרך Twilio, יועברו אליה פרטי הנמען ותוכן ההודעה." },
    ],
    footer: "חלק מהספקים עשויים לעבד מידע מחוץ לישראל ולאירופה. ככל שיתווסף ספק נוסף, כגון ספק סליקה או חשבוניות, מדיניות זו תעודכן בהתאם.",
  },
  {
    num: "7",
    title: "אבטחת מידע",
    intro: "המערכת מסתמכת על תשתית Supabase, המספקת רמת הגנה גבוהה על המידע:",
    items: [
      { text: "כל הנתונים (מסד הנתונים והקבצים המאוחסנים) ", bold: "מוצפנים במנוחה", suffix: " באמצעות תקן AES-256, באופן קבוע ואוטומטי." },
      { text: "כל התקשורת בין המשתמש למערכת ", bold: "מוצפנת בתעבורה", suffix: " באמצעות TLS 1.2 ומעלה (HTTPS)." },
      { text: "מתבצעים ", bold: "גיבויים יומיים", suffix: " אוטומטיים של מסד הנתונים, הנשמרים לתקופה של 7 ימים, לצורך שחזור מהיר במקרה תקלה." },
      { text: "מסד הנתונים והקבצים ב-Supabase ממוקמים באזור אירופה (Frankfurt), בתחום תקנות הגנת הפרטיות האירופיות (GDPR).", bold: null },
      { text: "ספק התשתית עומד בהסמכת ", bold: "SOC 2 Type II", suffix: " ברמת התשתית עבור כלל הלקוחות." },
    ],
    footer: "עם זאת, המשתמש מאשר כי אין אבטחה מוחלטת בסביבת אינטרנט, ועל כן השימוש והעלאת הקבצים מתבצעים על אחריותו בלבד.",
  },
  {
    num: "8",
    title: "זכויות המשתמש",
    intro: 'בהתאם לחוק הגנת הפרטיות, התשמ"א-1981, לכל משתמש ולכל איש קשר שמידע עליו נשמר במערכת הזכות:',
    items: [
      "לעיין במידע האישי השמור עליו במערכת.",
      "לבקש תיקון של מידע שגוי או לא מעודכן.",
      "לבקש מחיקה של חשבונו ושל המידע האישי הקשור אליו, בכפוף לצרכים תפעוליים וחוקיים לגיטימיים (כגון שמירת רישומים פיננסיים היסטוריים).",
    ],
    footer: "לצורך מימוש זכויות אלו ניתן לפנות באמצעות פרטי הקשר המופיעים באתר.",
  },
  {
    num: "9",
    title: "אחריות המשתמש",
    items: [
      { text: "המשתמש אחראי לוודא כי הוא מורשה להעלות את הקבצים למערכת.", bold: null },
      { text: "המשתמש אחראי לוודא כי אינו מעלה מידע אישי מעבר לנדרש לצורך הניתוח.", bold: null },
      { text: "אין להעלות קבצים המכילים מידע אישי רגיש שאינו נחוץ לניתוח התקציבי.", bold: null },
    ],
  },
  {
    num: "10",
    title: "שינויים במדיניות הפרטיות",
    richBody: [
      { text: "המערכת שומרת לעצמה את הזכות לעדכן מדיניות פרטיות זו בכל עת וללא הודעה מוקדמת. " },
      { bold: "האחריות לעיון במדיניות הפרטיות המעודכנת חלה על המשתמש בלבד." },
      { text: " המשך השימוש במערכת לאחר פרסום גרסה מעודכנת מהווה הסכמה לתנאיה החדשים. תאריך העדכון האחרון מצוין בראש מסמך זה." },
    ],
  },
  {
    num: "11",
    title: "יצירת קשר",
    body: "לשאלות בנוגע למדיניות פרטיות זו, לרבות מימוש זכויות עיון/תיקון/מחיקה, ניתן לפנות אלינו דרך פרטי הקשר המופיעים באתר.",
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
      <Sidebar dark />
      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16">
        <div className="text-center mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>
            מדיניות פרטיות
          </h1>
          <p className="text-slate-500 text-sm">
            מערכת בדיקת פערי גפן–כספים &nbsp;·&nbsp; תאריך עדכון אחרון: 4.11.26
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
    </div>
  );
}
