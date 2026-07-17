import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useGuide } from "../context/GuideContext";

export default function AdminIntegrationsTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState(null);
  const { openGuide } = useGuide();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const calendarResult = params.get("calendar");
    if (calendarResult === "connected") {
      setBanner({ type: "success", text: "היומן הארגוני חובר בהצלחה!" });
    } else if (calendarResult === "error") {
      setBanner({ type: "error", text: "החיבור ליומן נכשל. נסו שוב או פנו לתמיכה." });
    }
    if (calendarResult) {
      params.delete("calendar");
      params.set("tab", "integrations");
      navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true });
    }
  }, []);

  useEffect(() => {
    axios.get("/calendar/connection")
      .then(r => setConnection(r.data))
      .catch(() => setConnection({ org: { status: "disconnected" }, personal: { status: "disconnected" } }))
      .finally(() => setLoading(false));
  }, []);

  async function handleConnectOutlook() {
    setConnecting(true);
    try {
      const res = await axios.get("/calendar/connect/microsoft/admin-consent-url");
      window.location.href = res.data.url;
    } catch {
      setBanner({ type: "error", text: "לא ניתן היה להתחיל את תהליך החיבור. נסו שוב." });
      setConnecting(false);
    }
  }

  const orgStatus = connection?.org?.status || "disconnected";
  const isConnected = orgStatus === "connected";

  return (
    <div className="max-w-2xl">
      {banner && (
        <div
          role="alert"
          className={`mb-4 text-sm rounded-xl px-4 py-3 border ${
            banner.type === "success"
              ? "text-green-700 bg-green-50 border-green-200"
              : "text-red-600 bg-red-50 border-red-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      <p className="text-slate-500 text-sm mb-6">
        חיבור יומן ארגוני מאפשר לקבוע פגישות במערכת ולראות אותן אוטומטית ביומן ה-Outlook של היועצים, וגם להציג את זמינות היועץ בזמן קביעת פגישה.
      </p>

      {loading ? (
        <div role="status" aria-label="טוען סטטוס חיבור" className="flex justify-center py-10">
          <div aria-hidden="true" className="spinner w-8 h-8" />
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl p-5 flex items-center justify-between gap-4 bg-white shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm" aria-hidden="true">
              O
            </div>
            <div>
              <div className="font-semibold text-slate-900">Outlook ארגוני (Microsoft 365)</div>
              <div className={`text-xs mt-0.5 ${isConnected ? "text-green-600" : "text-slate-500"}`}>
                {isConnected ? "מחובר" : "לא מחובר"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openGuide("outlook_org")}
              className="px-3 py-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors"
            >
              הדרכה
            </button>
            <button
              onClick={handleConnectOutlook}
              disabled={connecting || isConnected}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                isConnected
                  ? "bg-green-50 text-green-700 cursor-default"
                  : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              }`}
            >
              {isConnected ? "מחובר ✓" : connecting ? "מתחבר..." : "חבר יומן ארגוני"}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-4">
        החיבור מתבצע ברמת הארגון על ידי בעל/ת הרשאת אדמין ב-Microsoft 365, פעם אחת בלבד — לאחר מכן כל היועצים בארגון מסונכרנים אוטומטית, בלי שכל אחד יצטרך להתחבר בנפרד.
      </p>
    </div>
  );
}
