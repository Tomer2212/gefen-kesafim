import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useGuide } from "../context/GuideContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

function VoicenterSettingsModal({ settings, loading, onSave, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [enabled, setEnabled] = useState(true);
  const [bearerToken, setBearerToken] = useState("");
  const [showBearer, setShowBearer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // "success" | "error" | null
  const [copied, setCopied] = useState(false);
  const prevLoadingRef = useRef(loading);

  async function handleCopyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(settings?.webhook_url || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — no-op
    }
  }

  useEffect(() => {
    if (prevLoadingRef.current && !loading && settings) {
      setEnabled(settings.enabled);
    }
    prevLoadingRef.current = loading;
  }, [loading, settings]);

  async function handleToggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    await onSave({ enabled: next });
    setSaving(false);
  }

  async function handleSaveCredentials() {
    setSaving(true);
    setSaveResult(null);
    const ok = await onSave({ api_bearer_token: bearerToken });
    setSaving(false);
    setBearerToken("");
    if (ok) {
      setSaveResult("success");
      setTimeout(() => { setSaveResult(null); onClose(); }, 1200);
    } else {
      setSaveResult("error");
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    const ok = await onSave({ api_bearer_token: "", enabled: false });
    setDisconnecting(false);
    setConfirmDisconnect(false);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="voicenter-modal-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="voicenter-modal-title" className="font-bold text-black">הגדרות VOICENTER</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div role="status" aria-label="טוען הגדרות" className="flex justify-center py-10">
              <div aria-hidden="true" className="spinner w-7 h-7" />
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-xs text-slate-400">
                המערכת שולפת שיחות ישירות מ-Voicenter בכל טעינה של טאב "שיחות" — שום פרט שיחה (מספרים, משך, הקלטה) לא נשמר אצלנו. יש להזין כאן רק טוקן API אחד (Authorization Bearer) שקיבלתם מ-Voicenter, ולהדביק את כתובת ה-Webhook בפאנל שלהם — זו מיועדת רק לקליטת סיכום AI ותמלול, שלא ניתנים לשליפה בדרך אחרת.
              </p>

              <div>
                <label htmlFor="voicenter-webhook-url" className="block text-xs font-semibold text-slate-500 mb-1.5">
                  כתובת ה-Webhook — הדביקו בשדה "כתובת CDR חיצונית" בפאנל Voicenter
                </label>
                <div className="flex gap-2">
                  <input
                    id="voicenter-webhook-url"
                    readOnly
                    value={settings?.webhook_url || ""}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 font-mono outline-none"
                  />
                  <button
                    onClick={handleCopyWebhookUrl}
                    aria-label="העתק כתובת webhook"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap"
                  >
                    {copied ? "הועתק ✓" : "העתק"}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div>
                  <label htmlFor="voicenter-enabled-toggle" className="text-sm font-medium text-slate-700">שליפת שיחות פעילה</label>
                  <div className="text-xs text-slate-400 mt-0.5">כשכבוי, טאב "שיחות" לא ישלוף נתונים</div>
                </div>
                <button
                  id="voicenter-enabled-toggle"
                  role="switch"
                  aria-checked={enabled}
                  onClick={handleToggleEnabled}
                  disabled={saving}
                  className={`w-11 h-6 rounded-full transition-colors relative disabled:opacity-60 ${enabled ? "bg-green-500" : "bg-slate-300"}`}
                >
                  <span aria-hidden="true" className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? "right-0.5" : "right-5"}`} />
                </button>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <label htmlFor="voicenter-bearer-input" className="block text-sm font-medium text-slate-700 mb-1">
                  טוקן API (Bearer)
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  {settings?.has_bearer_token ? "טוקן שמור במערכת כרגע." : "לא הוזן טוקן עדיין."} זהו הטוקן שקיבלתם מ-Voicenter לצורך שליפת שיחות.
                </p>
                <div className="flex gap-2">
                  <input
                    id="voicenter-bearer-input"
                    type={showBearer ? "text" : "password"}
                    value={bearerToken}
                    onChange={(e) => setBearerToken(e.target.value)}
                    placeholder="הדביקו כאן את הטוקן..."
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBearer((v) => !v)}
                    aria-label={showBearer ? "הסתר טוקן" : "הצג טוקן"}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    {showBearer ? "הסתר" : "הצג"}
                  </button>
                </div>
              </div>

              <button
                onClick={handleSaveCredentials}
                disabled={saving || !bearerToken}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {saving ? "שומר..." : "שמור טוקן"}
              </button>

              {saveResult === "success" && (
                <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">
                  הטוקן נשמר בהצלחה ✓
                </p>
              )}
              {saveResult === "error" && (
                <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                  שמירת הטוקן נכשלה — נסו שוב
                </p>
              )}

              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                חשוב: ה-API של Voicenter מקבל בקשות רק מכתובת IP מורשית מראש — יש לוודא מול Voicenter שכתובת ה-IP של השרת שלנו רשומה אצלם.
              </p>

              {settings?.has_bearer_token && (
                <div className="border-t border-slate-100 pt-4">
                  {confirmDisconnect ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">למחוק את הטוקן השמור ולכבות את החיבור?</span>
                      <div className="flex gap-2">
                        <button onClick={handleDisconnect} disabled={disconnecting}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60">
                          {disconnecting ? "מנתק..." : "אישור ניתוק"}
                        </button>
                        <button onClick={() => setConfirmDisconnect(false)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors">
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDisconnect(true)}
                      className="text-xs text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 transition-colors">
                      ניתוק חיבור Voicenter
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

function TwilioSettingsModal({ settings, loading, onSave, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    const ok = await onSave({ account_sid: accountSid, auth_token: authToken, from_number: fromNumber });
    setSaving(false);
    if (ok) {
      setSaveResult("success");
      setTimeout(() => { setSaveResult(null); onClose(); }, 1200);
    } else {
      setSaveResult("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="twilio-modal-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="twilio-modal-title" className="font-bold text-black">הגדרות Twilio (וואטסאפ)</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {loading ? (
            <div role="status" aria-label="טוען הגדרות" className="flex justify-center py-10">
              <div aria-hidden="true" className="spinner w-7 h-7" />
            </div>
          ) : (
            <>
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                תשתית בלבד בשלב זה — שמירת הפרטים כאן אינה מפעילה שליחת וואטסאפ בפועל עדיין. ערוץ הוואטסאפ יישאר מנוטרל במסך "יצירת משימה" עד לחיבור מלא.
              </p>
              <div>
                <label htmlFor="twilio-sid" className="block text-sm font-medium text-slate-700 mb-1">Account SID</label>
                <input id="twilio-sid" value={accountSid} onChange={e => setAccountSid(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400" />
              </div>
              <div>
                <label htmlFor="twilio-token" className="block text-sm font-medium text-slate-700 mb-1">Auth Token</label>
                <input id="twilio-token" type="password" value={authToken} onChange={e => setAuthToken(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400" />
              </div>
              <div>
                <label htmlFor="twilio-from" className="block text-sm font-medium text-slate-700 mb-1">מספר שולח (From)</label>
                <input id="twilio-from" value={fromNumber} onChange={e => setFromNumber(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400" />
              </div>
              <button onClick={handleSave} disabled={saving}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60">
                {saving ? "שומר..." : "שמור"}
              </button>
              {saveResult === "success" && (
                <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">נשמר בהצלחה ✓</p>
              )}
              {saveResult === "error" && (
                <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">השמירה נכשלה — נסו שוב</p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminIntegrationsTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState(null);
  const { openGuide } = useGuide();

  const [voicenterSettings, setVoicenterSettings] = useState(null);
  const [voicenterLoading, setVoicenterLoading] = useState(true);
  const [voicenterModalOpen, setVoicenterModalOpen] = useState(false);

  const [twilioSettings, setTwilioSettings] = useState(null);
  const [twilioLoading, setTwilioLoading] = useState(true);
  const [twilioModalOpen, setTwilioModalOpen] = useState(false);

  function loadTwilioSettings() {
    setTwilioLoading(true);
    axios.get("/tasks/twilio-settings")
      .then(r => setTwilioSettings(r.data))
      .catch(() => setTwilioSettings(null))
      .finally(() => setTwilioLoading(false));
  }

  useEffect(() => {
    loadTwilioSettings();
  }, []);

  async function handleSaveTwilioSettings(patch) {
    try {
      await axios.put("/tasks/twilio-settings", patch);
      loadTwilioSettings();
      return true;
    } catch {
      setBanner({ type: "error", text: "שמירת הגדרות Twilio נכשלה. נסו שוב." });
      return false;
    }
  }

  function loadVoicenterSettings() {
    setVoicenterLoading(true);
    axios.get("/voicenter/settings")
      .then(r => setVoicenterSettings(r.data))
      .catch(() => setVoicenterSettings(null))
      .finally(() => setVoicenterLoading(false));
  }

  useEffect(() => {
    loadVoicenterSettings();
  }, []);

  async function handleSaveVoicenterSettings(patch) {
    try {
      await axios.put("/voicenter/settings", patch);
      loadVoicenterSettings();
      return true;
    } catch {
      setBanner({ type: "error", text: "שמירת הגדרות Voicenter נכשלה. נסו שוב." });
      return false;
    }
  }

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
        חיבור יומן ארגוני מאפשר לקבוע פגישות במערכת ולראות אותן אוטומטית ביומן ה-Outlook של היועצים, וגם להציג את זמינות היועץ בזמן קביעת פגישה. החיבור הזה גם מאפשר ל"סוכן ניהול" לשלוח בקשות שריון פגישה ישירות מתיבת המייל האמיתית של היועץ.
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
              disabled={connecting}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                isConnected
                  ? "bg-green-50 text-green-700 hover:bg-green-100"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              } disabled:opacity-60`}
            >
              {isConnected ? "מחובר ✓ · עדכן הרשאות" : connecting ? "מתחבר..." : "חבר יומן ארגוני"}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-4">
        החיבור מתבצע ברמת הארגון על ידי בעל/ת הרשאת אדמין ב-Microsoft 365, פעם אחת בלבד — לאחר מכן כל היועצים בארגון מסונכרנים אוטומטית, בלי שכל אחד יצטרך להתחבר בנפרד.
      </p>

      <p className="text-slate-500 text-sm mb-6 mt-8">
        חיבור ל-VOICENTER מאפשר לשלוף בזמן אמת את פרטי שיחות הטלפון (מספרים, משך, סטטוס, קישור הקלטה) שהיועצים מבצעים או מקבלים, ולהציג אותם בטאב "שיחות" — בלי לשמור עותק של השיחות במערכת שלנו.
      </p>

      {voicenterLoading ? (
        <div role="status" aria-label="טוען סטטוס VOICENTER" className="flex justify-center py-10">
          <div aria-hidden="true" className="spinner w-8 h-8" />
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl p-5 flex items-center justify-between gap-4 bg-white shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600 font-bold text-sm" aria-hidden="true">
              V
            </div>
            <div>
              <div className="font-semibold text-slate-900">VOICENTER — שיחות טלפון</div>
              <div className={`text-xs mt-0.5 ${voicenterSettings?.enabled ? "text-green-600" : "text-slate-500"}`}>
                {voicenterSettings?.enabled ? "מופעל" : "כבוי"} · {voicenterSettings?.has_bearer_token ? "טוקן הוגדר" : "טרם הוגדר טוקן"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openGuide("voicenter")}
              className="px-3 py-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors"
            >
              הדרכה
            </button>
            <button
              onClick={() => setVoicenterModalOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              הגדרות Voicenter
            </button>
          </div>
        </div>
      )}

      {voicenterModalOpen && (
        <VoicenterSettingsModal
          settings={voicenterSettings}
          loading={voicenterLoading}
          onSave={handleSaveVoicenterSettings}
          onClose={() => setVoicenterModalOpen(false)}
        />
      )}

      <p className="text-slate-500 text-sm mb-6 mt-8">
        חיבור Twilio מאפשר לשלוח הודעות וואטסאפ במסגרת "משימות" (אזור ניהול → בתי ספר). בשלב זה זו תשתית בלבד — ניתן לשמור פרטי חיבור, אך שליחה בפועל עדיין מנוטרלת עד להשלמת האינטגרציה. לגבי מיילים שנשלחים דרך משימות: ברירת המחדל היא שליחה דרך המערכת (גפן AI, לא יוצג בתיבת הדואר היוצא שלכם); אם Outlook הארגוני מחובר, ניתן לבחור בהגדרות כל משימה לשלוח דרכו במקום — כך שההודעה תוצג בדואר היוצא של היועץ.
      </p>

      {twilioLoading ? (
        <div role="status" aria-label="טוען סטטוס Twilio" className="flex justify-center py-10">
          <div aria-hidden="true" className="spinner w-8 h-8" />
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl p-5 flex items-center justify-between gap-4 bg-white shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-sm" aria-hidden="true">
              T
            </div>
            <div>
              <div className="font-semibold text-slate-900">Twilio — וואטסאפ</div>
              <div className="text-xs mt-0.5 text-slate-500">
                לא מחובר {twilioSettings?.has_credentials ? "· פרטים נשמרו (טרם הופעל)" : ""}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTwilioModalOpen(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              הגדרות Twilio
            </button>
          </div>
        </div>
      )}

      {twilioModalOpen && (
        <TwilioSettingsModal
          settings={twilioSettings}
          loading={twilioLoading}
          onSave={handleSaveTwilioSettings}
          onClose={() => setTwilioModalOpen(false)}
        />
      )}
    </div>
  );
}
