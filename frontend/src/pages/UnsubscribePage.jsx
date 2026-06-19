import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import axios from "axios";
import logoImg from "../assets/logo.png";

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const email = params.get("email");
    const token = params.get("token");
    if (!email || !token) {
      setStatus("invalid");
      return;
    }
    axios.patch("/signup/unsubscribe", { email, token })
      .then(() => setStatus("success"))
      .catch(() => setStatus("invalid"));
  }, []);

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm anim-fade-up">
        <div className="glass-card rounded-3xl px-8 py-10 text-center">
          <div className="flex justify-center mb-6">
            <img src={logoImg} alt="גפן AI לוגו" className="h-20 w-auto object-contain" />
          </div>

          {status === "loading" && (
            <p className="text-sm text-slate-500">מעבד את הבקשה...</p>
          )}

          {status === "success" && (
            <>
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-green-100">
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <h1 className="text-lg font-bold text-slate-800 mb-2">הוסרת בהצלחה</h1>
              <p className="text-sm text-slate-500 leading-relaxed mb-6">
                כתובת המייל שלך הוסרה מרשימת התפוצה השיווקית של גפן AI.
              </p>
              <Link to="/login" className="text-sm text-blue-600 hover:underline">
                חזרה לדף הכניסה
              </Link>
            </>
          )}

          {status === "invalid" && (
            <>
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-red-100">
                  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </div>
              </div>
              <h1 className="text-lg font-bold text-slate-800 mb-2">קישור לא תקין</h1>
              <p className="text-sm text-slate-500 leading-relaxed mb-6">
                הקישור אינו תקין. לבקשת הסרה ידנית פנה אלינו דרך טופס יצירת הקשר.
              </p>
              <Link to="/contact" className="text-sm text-blue-600 hover:underline">
                יצירת קשר
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
