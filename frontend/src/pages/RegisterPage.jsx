import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import logoImg from "../assets/logo.png";

export default function RegisterPage() {
  const [form, setForm] = useState({
    org_name: "",
    owner_name: "",
    owner_email: "",
    owner_phone: "",
    business_number: "",
    consent_contact: false,
    consent_contact_at: null,
    consent_marketing: true,
    consent_marketing_at: new Date().toISOString(),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({
        ...prev,
        [name]: checked,
        [`${name}_at`]: new Date().toISOString(),
      }));
      return;
    }
    if (name === "owner_phone" || name === "business_number") {
      if (!/^\d*$/.test(value)) return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await axios.post("/signup/apply", form);
      setSubmitted(true);
    } catch (err) {
      const msg = err.response?.data?.detail;
      if (msg?.includes("כבר קיימת")) {
        setError("כבר קיימת בקשה פתוחה עם מייל זה. נחזור אליך בהקדם.");
      } else {
        setError("אירעה שגיאה בשליחת הבקשה. אנא נסה שוב.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm anim-fade-up">
        <div className="glass-card rounded-3xl px-8 py-10">

          {submitted ? (
            <>
              <div className="flex justify-center mb-6">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", boxShadow: "0 6px 20px rgba(16,185,129,0.35)" }}>
                  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <h1 className="text-center text-xl mb-3" style={{ color: "#10b981", fontWeight: 800 }}>
                הבקשה נשלחה בהצלחה!
              </h1>
              <p className="text-center text-sm text-slate-500 mb-8 font-medium leading-relaxed">
                קיבלנו את פרטיך ונחזור אליך בהקדם עם עדכון.<br />
                בינתיים ניתן לחזור לדף הכניסה.
              </p>
              <Link to="/login" className="btn-blue w-full py-3 text-base flex items-center justify-center">
                חזור לכניסה
              </Link>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-5">
                <img src={logoImg} alt="גפן AI לוגו" className="h-24 w-auto object-contain" />
              </div>
              <h1 className="text-center text-lg mb-1" style={{ color: "#0070F3", fontWeight: 800 }}>
                בקשת הרשמה
              </h1>
              <p className="text-center text-xs mb-6 font-medium" style={{ color: "#000" }}>
                אנא מלאו את הפרטים ונחזור אליכם בהקדם
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="reg-org-name" className="text-xs text-right" style={{ fontWeight: 600, color: "#000" }}>
                    שם הארגון
                  </label>
                  <input
                    id="reg-org-name"
                    name="org_name"
                    className="input-field"
                    type="text"
                    placeholder="שם הארגון"
                    value={form.org_name}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="reg-owner-name" className="text-xs text-right" style={{ fontWeight: 600, color: "#000" }}>
                    שם מלא (בעל הארגון)
                  </label>
                  <input
                    id="reg-owner-name"
                    name="owner_name"
                    className="input-field"
                    type="text"
                    placeholder="ישראל ישראלי"
                    value={form.owner_name}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="reg-email" className="text-xs text-right" style={{ fontWeight: 600, color: "#000" }}>
                    מייל (בעל הארגון)
                  </label>
                  <input
                    id="reg-email"
                    name="owner_email"
                    className="input-field"
                    type="email"
                    placeholder="your@email.com"
                    value={form.owner_email}
                    onChange={handleChange}
                    required
                    dir="ltr"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="reg-phone" className="text-xs text-right" style={{ fontWeight: 600, color: "#000" }}>
                    מספר טלפון (בעל הארגון)
                  </label>
                  <input
                    id="reg-phone"
                    name="owner_phone"
                    className="input-field"
                    type="tel"
                    placeholder="050-0000000"
                    value={form.owner_phone}
                    onChange={handleChange}
                    required
                    dir="ltr"
                    pattern="05\d{8}"
                    maxLength={10}
                    title="מספר טלפון חייב להתחיל ב-05 ולהכיל 10 ספרות בדיוק"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="reg-business" className="text-xs text-right" style={{ fontWeight: 600, color: "#000" }}>
                    מספר עוסק / ח.פ.
                  </label>
                  <input
                    id="reg-business"
                    name="business_number"
                    className="input-field"
                    type="text"
                    placeholder="123456789"
                    value={form.business_number}
                    onChange={handleChange}
                    required
                    dir="ltr"
                    maxLength={11}
                    pattern="\d{1,11}"
                    title="מספר עוסק / ח.פ. חייב להכיל עד 11 ספרות"
                    inputMode="numeric"
                  />
                </div>

                <div className="flex flex-col gap-2 mt-1 border border-slate-200 rounded-xl px-4 py-3 bg-slate-50">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="consent_contact"
                      checked={form.consent_contact}
                      onChange={handleChange}
                      className="mt-0.5 flex-shrink-0 accent-blue-600"
                      required
                    />
                    <span className="text-xs text-slate-700 leading-relaxed">
                      אני מאשר/ת לפנות אליי כחלק מתהליך ההרשמה.
                      <span className="text-red-500 mr-0.5">*</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="consent_marketing"
                      checked={form.consent_marketing}
                      onChange={handleChange}
                      className="mt-0.5 flex-shrink-0 accent-blue-600"
                    />
                    <span className="text-xs text-slate-700 leading-relaxed">
                      אני מאשר/ת לקבל הצעות שיווקיות.
                    </span>
                  </label>
                </div>

                {error && (
                  <div role="alert" className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
                      <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.5" />
                      <path d="M8 4.5v4M8 10.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !form.consent_contact}
                  className="btn-blue mt-1 py-3 text-base"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full inline-block" style={{ animation: "spin-smooth 0.7s linear infinite" }} />
                      שולח...
                    </span>
                  ) : "שליחת הבקשה"}
                </button>

                <Link
                  to="/login"
                  className="text-center text-sm text-slate-500 hover:text-slate-700 hover:underline mt-1"
                >
                  יש לכם חשבון? כניסה למערכת
                </Link>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
