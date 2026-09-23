import { useState } from "react";
import ConnectionsList from "../components/ConnectionsList";
import { registerDeviceSession } from "../lib/deviceSession";
import logoImg from "../assets/logo.png";

export default function ConnectionsLimitPage() {
  const [retrying, setRetrying] = useState(false);
  const [stillBlocked, setStillBlocked] = useState(false);

  async function handleDisconnected() {
    setRetrying(true);
    setStillBlocked(false);
    const { ok, limitReached } = await registerDeviceSession();
    setRetrying(false);
    if (ok) {
      window.location.href = "/";
    } else if (limitReached) {
      setStillBlocked(true);
    }
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg anim-fade-up">
        <div className="glass-card rounded-3xl px-8 py-10">
          <div className="flex justify-center mb-4">
            <img src={logoImg} alt="גפן AI לוגו" className="h-16 w-auto object-contain" />
          </div>
          <h1 className="text-center text-lg font-bold text-slate-900 mb-2">
            הגעת למספר המקסימלי של חיבורים פעילים
          </h1>
          <p className="text-center text-sm text-slate-500 mb-6">
            כבר יש לך 3 חיבורים פעילים במקביל. כדי להתחבר מכאן, יש לנתק חיבור קיים אחד מהרשימה למטה.
          </p>

          {stillBlocked && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-center">
              עדיין יש 3 חיבורים פעילים. נסה לנתק חיבור נוסף.
            </p>
          )}
          {retrying && (
            <p role="status" className="text-sm text-slate-500 text-center mb-4">בודק שוב...</p>
          )}

          <ConnectionsList onDisconnected={handleDisconnected} />
        </div>
      </div>
    </div>
  );
}
