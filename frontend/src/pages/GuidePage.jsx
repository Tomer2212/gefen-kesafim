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

const REQUIRED   = "required";
const OPTIONAL   = "optional";
const NOT_NEEDED = "none";

const FILE_COLS = [
  { key: "tikhnun", label: "תכנון תקציבי" },
  { key: "doch",    label: "דיווח ביצוע (גפן)" },
  { key: "ksafim",  label: "תוכנת כספים" },
];

const TABS = [
  {
    name: "כלל הבדיקות האפשריות",
    desc: "להפעלת כל הלשוניות במערכת יש להעלות את שלושת סוגי הקבצים יחד. העלאה חלקית תאפשר גישה ללשוניות הרלוונטיות בלבד.",
    tikhnun: REQUIRED, doch: REQUIRED, ksafim: REQUIRED,
  },
  {
    name: "השוואה גפן-כספים",
    desc: "השוואה בין אסמכתאות המשויכות בגפן לבין רשומות תוכנת הכספים. מציגה פערים בשני הכיוונים.",
    tikhnun: NOT_NEEDED, doch: REQUIRED,  ksafim: REQUIRED,
  },
  {
    name: "סקירה",
    desc: "סקירה כוללת של מצב התקציב: פרטי מוסד, סכום שתוכנן, תקציב שנותר, ואחוזי דיווח.",
    tikhnun: REQUIRED,   doch: OPTIONAL,  ksafim: NOT_NEEDED,
  },
  {
    name: "אסמכתאות שנדחו",
    desc: "רשימת חשבוניות שנדחו על ידי מערכת הגפן.",
    tikhnun: NOT_NEEDED, doch: REQUIRED,  ksafim: NOT_NEEDED,
  },
  {
    name: "ללא PDF",
    desc: "אסמכתאות בגפן שאין להן קובץ PDF מצורף.",
    tikhnun: NOT_NEEDED, doch: REQUIRED,  ksafim: NOT_NEEDED,
  },
  {
    name: "דיווח חסר",
    desc: "תוכניות שתוכננו בגפן אך טרם דווחו במלואן — מציג את הפער בין התכנון לביצוע.",
    tikhnun: REQUIRED,   doch: REQUIRED,  ksafim: NOT_NEEDED,
  },
  {
    name: "יוזמות וצרכים",
    desc: "בדיקת ניצול תקציב היוזמות לפי מודל התמרוץ (30% / 40%).",
    tikhnun: REQUIRED,   doch: NOT_NEEDED, ksafim: NOT_NEEDED,
  },
  {
    name: "תקציב קבוע",
    desc: "השוואה בין התקציב הקבוע המאושר לבין הסכום שתוכנן — מציגה הפרשים לפי סל ותת-סל.",
    tikhnun: REQUIRED,   doch: NOT_NEEDED, ksafim: NOT_NEEDED,
  },
];

function StatusBadge({ status }) {
  if (status === REQUIRED) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full"
        style={{ background: "rgba(22,163,74,0.12)" }}
        title="נדרש"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M2.5 6.5l3 3 5-6" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  if (status === OPTIONAL) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-700"
        style={{ fontWeight: 600, background: "rgba(251,191,36,0.12)", color: "#92400e" }}
        title="אופציונלי"
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", display: "inline-block", flexShrink: 0 }} />
        אופציונלי
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full"
      style={{ background: "rgba(220,38,38,0.08)" }}
      title="לא נדרש"
    >
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
        <path d="M2 2l7 7M9 2L2 9" stroke="#dc2626" strokeWidth="1.7" strokeLinecap="round"/>
      </svg>
    </span>
  );
}

export default function GuidePage() {
  const navigate = useNavigate();

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <nav className="topbar sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/")} className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              ראשי
            </button>
            <button onClick={() => navigate("/terms")}   className="btn-ghost px-4 py-1.5 text-sm">תנאי שימוש</button>
            <button onClick={() => navigate("/privacy")} className="btn-ghost px-4 py-1.5 text-sm">מדיניות פרטיות</button>
            <span
              aria-current="page"
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-full"
              style={{ background: "rgba(0,112,243,0.08)", color: "#0070F3", fontWeight: 600, cursor: "default" }}
            >
              הדרכה
            </span>
            <button onClick={() => navigate("/contact")} className="btn-ghost px-4 py-1.5 text-sm">צור קשר</button>
            <button onClick={() => navigate("/accessibility")} className="btn-ghost px-4 py-1.5 text-sm">נגישות</button>
          </div>
          <Logo />
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16 text-center">
        {/* Page heading */}
        <div className="mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>הדרכה</h1>
          <p className="text-slate-500 text-sm">מדריך למשתמש — גפן AI</p>
        </div>

        {/* Section heading */}
        <div className="mb-4 anim-fade-up">
          <h2 className="text-base font-800 text-slate-700" style={{ fontWeight: 800 }}>קבצים להעלאה לפי תוצאה רצויה</h2>
          <p className="text-sm text-slate-400 mt-1">בחר את הלשונית הרצויה כדי לדעת אילו קבצים יש להעלות</p>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-5 mb-5 anim-fade-up flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: "rgba(22,163,74,0.12)" }}>
              <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                <path d="M2.5 6.5l3 3 5-6" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span className="text-xs text-slate-500">נדרש</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
            <span className="text-xs text-slate-500">אופציונלי — משפיע על חלק מהנתונים</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: "rgba(220,38,38,0.08)" }}>
              <svg width="9" height="9" viewBox="0 0 11 11" fill="none">
                <path d="M2 2l7 7M9 2L2 9" stroke="#dc2626" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
            </span>
            <span className="text-xs text-slate-500">לא נדרש</span>
          </div>
        </div>

        {/* Cards */}
        <div className="flex flex-col gap-3">
          {TABS.map((tab, i) => (
            <div
              key={tab.name}
              className="glass-card rounded-2xl px-5 py-4 anim-fade-up"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div className="mb-3">
                <h3 className="text-sm font-800 text-slate-800 mb-0.5" style={{ fontWeight: 800 }}>{tab.name}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{tab.desc}</p>
              </div>
              <div className="flex items-center justify-center gap-6 flex-wrap">
                {FILE_COLS.map(col => (
                  <div key={col.key} className="flex flex-col items-center gap-1.5">
                    <span className="text-xs text-slate-400 font-500 text-center" style={{ fontWeight: 500 }}>{col.label}</span>
                    <StatusBadge status={tab[col.key]} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-center mt-8">
          <button onClick={() => navigate("/")} className="btn-blue px-8 py-2.5 text-sm">
            חזרה לדף הראשי
          </button>
        </div>
      </main>
    </div>
  );
}
