import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

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
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
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

function Spinner() {
  return (
    <span className="w-4 h-4 rounded-full flex-shrink-0"
      style={{
        border: "2px solid rgba(255,255,255,0.3)",
        borderTopColor: "white",
        animation: "spin-smooth 0.7s linear infinite",
        display: "inline-block",
      }}
    />
  );
}

function Label({ children, required, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-700 text-slate-700 mb-1.5" style={{ fontWeight: 700 }}>
      {children}
      {required && <span style={{ color: "#dc2626", marginRight: "3px" }}>*</span>}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  border: "1.5px solid #e2e8f0",
  borderRadius: "10px",
  padding: "9px 12px",
  fontSize: "14px",
  color: "#1e293b",
  background: "white",
  outline: "none",
  transition: "border-color 0.15s",
  textAlign: "right",
  direction: "rtl",
};

export default function ContactPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [subject,     setSubject]     = useState("");
  const [description, setDescription] = useState("");
  const [userEmail,   setUserEmail]   = useState("");
  const [userPhone,   setUserPhone]   = useState("");
  const [files,       setFiles]       = useState([]);
  const [consent,     setConsent]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [sent,        setSent]        = useState(false);
  const [ticketId,    setTicketId]    = useState("");
  const [error,       setError]       = useState("");

  function handleFileChange(e) {
    const selected = Array.from(e.target.files);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      const fresh = selected.filter(f => !existing.has(f.name + f.size));
      return [...prev, ...fresh];
    });
    e.target.value = "";
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!subject.trim() || !description.trim() || !userEmail.trim()) {
      setError("יש למלא את כל השדות המסומנים בכוכבית.");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(userEmail)) {
      setError("כתובת המייל שהוזנה אינה תקינה.");
      return;
    }
    if (userPhone.trim()) {
      const digits = userPhone.replace(/[-\s]/g, "");
      if (!/^05\d{8}$/.test(digits)) {
        setError("שים לב — המספר שהוזן לא תקין. יש להזין מספר נייד ישראלי (10 ספרות המתחילות ב-05).");
        return;
      }
    }
    if (!consent) {
      setError("יש לאשר קבלת עדכונים לפני שליחת הפנייה.");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("subject",     subject.trim());
      fd.append("description", description.trim());
      fd.append("user_email",  userEmail.trim());
      fd.append("user_phone",  userPhone.trim());
      fd.append("consent",     consent ? "true" : "false");
      files.forEach(f => fd.append("files", f));

      const res = await axios.post("/contact/send", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setTicketId(res.data.ticket ?? "");
      setSent(true);
    } catch {
      setError("שליחת הפנייה נכשלה. אנא נסה שנית מאוחר יותר.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <nav className="topbar sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/")}
              className="btn-ghost flex items-center gap-1.5 px-4 py-1.5 text-sm"
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              ראשי
            </button>
            <button onClick={() => navigate("/terms")}   className="btn-ghost px-4 py-1.5 text-sm">תנאי שימוש</button>
            <button onClick={() => navigate("/privacy")} className="btn-ghost px-4 py-1.5 text-sm">מדיניות פרטיות</button>
            <button onClick={() => navigate("/guide")}   className="btn-ghost px-4 py-1.5 text-sm">הדרכה</button>
            <span
              aria-current="page"
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-full"
              style={{ background: "rgba(0,112,243,0.08)", color: "#0070F3", fontWeight: 600, cursor: "default" }}
            >
              צור קשר
            </span>
            <button onClick={() => navigate("/accessibility")} className="btn-ghost px-4 py-1.5 text-sm">נגישות</button>
          </div>
          <Logo />
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <div className="text-center mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>
            צור קשר
          </h1>
          <p className="text-sm leading-relaxed max-w-md mx-auto" style={{ color: "#0f172a" }}>
            פתחו פנייה ונחזור אליכם בהקדם האפשרי!
            <br />
            השתדלו לפרט ככל שניתן ובמידת הצורך לצרף צילומי מסך וקבצים רלוונטיים כדי שנוכל לטפל כראוי בפנייתכם. אנחנו בדרך כלל משיבים תוך 2 ימי עסקים.
          </p>
        </div>

        {sent ? (
          <div className="glass-card rounded-3xl px-8 py-14 anim-fade-up flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(22,163,74,0.1)" }}>
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="12" fill="#16a34a" fillOpacity="0.15"/>
                <path d="M8 14l4 4 8-8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-xl font-800" style={{ fontWeight: 800, color: "#0f172a" }}>
              הפנייה נשלחה בהצלחה!
            </h2>
            {ticketId && (
              <div className="px-4 py-2 rounded-xl text-sm font-700 tabular-nums"
                style={{ background: "rgba(0,112,243,0.08)", color: "#0070F3", fontWeight: 700 }}>
                מספר פנייה: {ticketId}
              </div>
            )}
            <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
              קיבלנו את פנייתך ונחזור אליך בהקדם לכתובת <strong style={{ color: "#334155" }}>{userEmail}</strong>
            </p>
            <button onClick={() => navigate("/")} className="btn-blue px-8 py-2.5 text-sm mt-2">
              חזרה לדף הראשי
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card rounded-3xl px-7 py-7 anim-fade-up flex flex-col gap-5">

            {/* Subject */}
            <div>
              <Label required htmlFor="contact-subject">נושא הפנייה</Label>
              <input
                id="contact-subject"
                type="text"
                placeholder="לדוגמה: שגיאה בעיבוד קובץ גפן"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = "#0070F3"; }}
                onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
              />
            </div>

            {/* Description */}
            <div>
              <Label required htmlFor="contact-description">תיאור הפנייה</Label>
              <textarea
                id="contact-description"
                rows={5}
                placeholder="תאר את הבעיה או הפנייה בפירוט..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                style={{ ...inputStyle, resize: "vertical", minHeight: "110px" }}
                onFocus={e => { e.target.style.borderColor = "#0070F3"; }}
                onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
              />
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100" />

            {/* Contact details */}
            <div className="flex flex-col gap-4">
              <p className="text-xs font-700 text-slate-400 tracking-wide" style={{ fontWeight: 700 }}>
                פרטי קשר — כדי שנוכל לחזור אליך
              </p>
              <div>
                <Label required htmlFor="contact-email">כתובת מייל</Label>
                <input
                  id="contact-email"
                  type="email"
                  placeholder="example@gmail.com"
                  value={userEmail}
                  onChange={e => setUserEmail(e.target.value)}
                  style={{ ...inputStyle, direction: "ltr", textAlign: "left" }}
                  onFocus={e => { e.target.style.borderColor = "#0070F3"; }}
                  onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
                />
              </div>
              <div>
                <Label htmlFor="contact-phone">מספר טלפון</Label>
                <input
                  id="contact-phone"
                  type="tel"
                  placeholder="050-0000000"
                  value={userPhone}
                  onChange={e => setUserPhone(e.target.value.replace(/[^\d\-]/g, ""))}
                  style={{ ...inputStyle, direction: "ltr", textAlign: "left" }}
                  onFocus={e => { e.target.style.borderColor = "#0070F3"; }}
                  onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
                />
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100" />

            {/* File attachment */}
            <div>
              <Label htmlFor="contact-files">קבצים מצורפים</Label>
              <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                ניתן לצרף צילום מסך של הבעיה וכן את הקבצים שהועלו אם הייתה שגיאה בעיבוד.
              </p>
              <input
                id="contact-files"
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current.click()}
                className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl transition-all"
                style={{ fontWeight: 600, border: "1.5px dashed #cbd5e1", color: "#64748b", background: "rgba(248,250,252,0.8)" }}
              >
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 2v9M4 8l3.5 3.5L11 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" transform="rotate(180 7.5 7.5)"/>
                  <path d="M2 12.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                בחר קבצים להעלאה
              </button>

              {files.length > 0 && (
                <ul className="flex flex-col gap-1.5 mt-3">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg"
                      style={{ background: "rgba(0,112,243,0.05)", border: "1px solid rgba(0,112,243,0.12)" }}>
                      <span className="text-xs text-slate-600 truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        aria-label="הסר קובץ"
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all"
                        style={{ background: "rgba(220,38,38,0.1)", color: "#dc2626" }}
                      >
                        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100" />

            {/* Consent checkbox */}
            <label
              htmlFor="consent-checkbox"
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                id="consent-checkbox"
                checked={consent}
                onChange={() => setConsent(v => !v)}
                className="sr-only peer"
              />
              <div
                className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2"
                style={{
                  border: consent ? "none" : "1.5px solid #cbd5e1",
                  background: consent ? "#0070F3" : "white",
                }}
              >
                {consent && (
                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M2 5.5l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span className="text-sm text-slate-600 leading-relaxed">
                אני מאשר/ת קבלת עדכונים במייל ו/או בטלפון בנוגע לפנייה זו.
                <span style={{ color: "#dc2626", marginRight: "3px" }}>*</span>
              </span>
            </label>

            {/* Error */}
            {error && (
              <div role="alert" className="rounded-xl px-4 py-3 text-sm text-right"
                style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid rgba(220,38,38,0.2)" }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-blue flex items-center justify-center gap-2 py-3 text-sm mt-1"
              style={{ opacity: loading ? 0.75 : 1 }}
            >
              {loading ? (
                <><Spinner /><span>שולח...</span></>
              ) : (
                <>
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M13 2L2 7l4.5 2.5L9 13l4-11z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  שלח פנייה
                </>
              )}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
