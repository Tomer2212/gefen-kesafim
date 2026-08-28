import { useEffect, useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { SchoolResultsList } from "./meetings/SchoolPickerCell";

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${HH}:${MM}`;
}

const DIRECTION_LABEL = { incoming: "שיחה נכנסת", outgoing: "שיחה יוצאת", internal: "שיחה פנימית" };

/**
 * Interrupting prompt for a call the current advisor made/received against a phone number
 * that matches no school contact. Small bottom-left card (like MeetingStatusUpdatePopup);
 * pressing "כן" opens a centered modal to pick the school and optionally save the contact.
 */
export default function UnknownCallPopup({ reminder, onDismiss, onSuccess }) {
  const callId = reminder.call_id;
  const phone = reminder.counterpart_phone_display || reminder.counterpart_phone || "";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  // modal steps: "school" | "done" | "offer-contact" | "contact-form" | "result"
  const [step, setStep] = useState("school");
  const [schools, setSchools] = useState([]);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [chosenSchool, setChosenSchool] = useState(null);
  const [perms, setPerms] = useState({ canEditDirectly: false, canRequestUpdate: false });
  const [contact, setContact] = useState({ role: "", name: "", phone: "", email: "" });
  const [resultMsg, setResultMsg] = useState("");

  const { ref, handleKeyDown } = useFocusTrap(() => setModalOpen(false));

  useEffect(() => {
    if (!modalOpen) return;
    axios.get("/schools/")
      .then(r => setSchools((r.data || []).filter(s => s.status !== "deleted")))
      .catch(() => setSchools([]));
    axios.get("/schools/users/me")
      .then(r => setPerms({
        canEditDirectly: !!r.data?.can_edit_school_directly,
        canRequestUpdate: r.data?.can_request_school_update !== false,
      }))
      .catch(() => {});
  }, [modalOpen]);

  async function handleNo() {
    setBusy(true);
    setError("");
    try {
      await axios.post(`/voicenter/calls/${callId}/dismiss-unknown`);
      onDismiss();
    } catch {
      setError("שגיאה — נסה שוב");
      setBusy(false);
    }
  }

  async function handleAttribute(school) {
    // called by SchoolResultsList's confirm button (its own submitting guard is active)
    setError("");
    try {
      await axios.patch(`/voicenter/calls/${callId}/resolve-contact-school`, { school_id: school.id });
    } catch (err) {
      setError(err.response?.data?.detail || "שגיאה בשיוך השיחה — נסה שוב");
      return; // stay on the school step
    }
    setChosenSchool(school);
    setContact(c => ({ ...c, phone: reminder.counterpart_phone || "" }));
    onSuccess?.(`השיחה שויכה ל${school.name}`);
    setStep("done");
  }

  async function handleSaveContact() {
    if (!contact.name.trim() || !contact.phone.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await axios.post(`/voicenter/calls/${callId}/save-contact`, {
        school_id: chosenSchool.id,
        role: contact.role.trim(),
        name: contact.name.trim(),
        phone: contact.phone.trim(),
        email: contact.email.trim(),
      });
      const mode = r.data?.mode;
      setResultMsg(
        mode === "applied" ? "איש הקשר נוסף לכרטיס בית הספר."
        : mode === "requested" ? "הבקשה להוספת איש הקשר נשלחה לאישור בעלים/מנהל."
        : mode === "duplicate" ? "המספר כבר קיים ברשימת אנשי הקשר של בית הספר."
        : "נשמר."
      );
      setStep("result");
    } catch {
      setError("שגיאה בשמירת איש הקשר — נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    setModalOpen(false);
    onDismiss();
  }

  const existingCount = (chosenSchool?.extra_contacts || []).length;

  return (
    <>
      {/* ---- small bottom-left card ---- */}
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={`unknown-call-title-${callId}`}
        dir="rtl"
        className="bg-white border border-slate-200 rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] overflow-hidden"
      >
        <div className="bg-violet-50 border-b border-violet-100 px-4 py-2.5 flex items-center gap-2">
          <span className="text-base" aria-hidden="true">📞</span>
          <h3 id={`unknown-call-title-${callId}`} className="text-sm font-bold text-violet-800 flex-1">
            שיחה ממספר לא מוכר
          </h3>
          <button
            aria-label="סגור"
            onClick={onDismiss}
            className="text-violet-600 hover:text-violet-800 p-0.5 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M12 2L2 12M2 2L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3">
          <p className="text-sm text-slate-700 mb-1">
            זיהינו שיחה עם מספר לא מוכר: <span className="font-semibold" dir="ltr">{phone}</span>
          </p>
          <p className="text-xs text-slate-500 mb-3">
            {DIRECTION_LABEL[reminder.direction] || "שיחה"}
            {reminder.call_time ? ` · ${fmtDateTime(reminder.call_time)}` : ""}
            {reminder.duration_seconds != null ? ` · משך ${fmtDuration(reminder.duration_seconds)}` : ""}
          </p>
          <p className="text-sm text-slate-700 mb-3">האם היא שייכת לבית ספר מסוים?</p>
          {error && <p role="alert" className="text-xs text-red-500 mb-2">{error}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              disabled={busy}
              onClick={() => { setError(""); setStep("school"); setModalOpen(true); }}
              className="text-xs font-medium px-2 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
            >
              כן, לשייך לבית ספר
            </button>
            <button
              disabled={busy}
              onClick={handleNo}
              className="text-xs font-medium px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              לא, לא שייך
            </button>
          </div>
        </div>
      </div>

      {/* ---- centered modal ---- */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)" }}
          onClick={e => { if (e.target === e.currentTarget && step !== "school") setModalOpen(false); }}
        >
          <div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unknown-call-modal-title"
            onKeyDown={handleKeyDown}
            dir="rtl"
            className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-3"
          >
            <h2 id="unknown-call-modal-title" className="font-bold text-slate-900">
              {step === "school" && "שיוך השיחה לבית ספר"}
              {step === "done" && "השיחה שויכה"}
              {step === "offer-contact" && "שמירת איש קשר"}
              {step === "contact-form" && `איש קשר חדש · ${chosenSchool?.name || ""}`}
              {step === "result" && "סיום"}
            </h2>

            {error && <p role="alert" className="text-xs text-red-500">{error}</p>}

            {step === "school" && (
              <>
                <p className="text-xs text-slate-500">
                  בחר את בית הספר שאליו שייכת השיחה מהמספר <span dir="ltr">{phone}</span>.
                </p>
                <SchoolResultsList
                  schools={schools}
                  query={query}
                  setQuery={setQuery}
                  pendingId={pendingId}
                  setPendingId={setPendingId}
                  onConfirm={handleAttribute}
                  onCancel={() => setModalOpen(false)}
                  submittingLabel="משייך..."
                />
              </>
            )}

            {step === "done" && (
              <>
                <p className="text-sm text-slate-700">
                  ✓ השיחה שויכה ל<span className="font-semibold">{chosenSchool?.name}</span>.
                </p>
                {(perms.canEditDirectly || perms.canRequestUpdate) ? (
                  <div className="flex gap-2 justify-end mt-1">
                    <button
                      type="button"
                      onClick={finish}
                      className="px-4 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors"
                    >
                      לא, רק השיחה
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("offer-contact")}
                      className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                    >
                      שמירת איש קשר
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-end mt-1">
                    <button
                      type="button"
                      onClick={finish}
                      className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                    >
                      סיום
                    </button>
                  </div>
                )}
              </>
            )}

            {step === "offer-contact" && (
              <>
                <p className="text-sm text-slate-700">
                  לשמור את המספר <span dir="ltr" className="font-semibold">{phone}</span> כאיש קשר של{" "}
                  <span className="font-semibold">{chosenSchool?.name}</span>?
                </p>
                <p className="text-xs text-slate-400">
                  רלוונטי רק אם המספר שייך באופן קבוע לבית הספר הזה — לא לשמור מספר של גורם שמשרת בתי ספר רבים.
                </p>
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    type="button"
                    onClick={finish}
                    className="px-4 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors"
                  >
                    לא, רק השיחה
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("contact-form")}
                    className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                  >
                    כן, שמור איש קשר
                  </button>
                </div>
              </>
            )}

            {step === "contact-form" && (
              <>
                {existingCount >= 3 && (
                  <p className="text-xs text-amber-600">
                    בכרטיס בית הספר כבר 3 אנשי קשר נוספים — ניתן עדיין {perms.canEditDirectly ? "להוסיף" : "לשלוח בקשה"}.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-1">
                    <label htmlFor="uc-role" className="text-xs text-slate-500 block mb-1">תפקיד</label>
                    <input
                      id="uc-role"
                      value={contact.role}
                      onChange={e => setContact(c => ({ ...c, role: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div className="col-span-1">
                    <label htmlFor="uc-name" className="text-xs text-slate-500 block mb-1">
                      שם <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="uc-name"
                      value={contact.name}
                      onChange={e => setContact(c => ({ ...c, name: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div className="col-span-1">
                    <label htmlFor="uc-phone" className="text-xs text-slate-500 block mb-1">
                      טלפון <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="uc-phone"
                      dir="ltr"
                      value={contact.phone}
                      onChange={e => setContact(c => ({ ...c, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div className="col-span-1">
                    <label htmlFor="uc-email" className="text-xs text-slate-500 block mb-1">מייל</label>
                    <input
                      id="uc-email"
                      type="email"
                      dir="ltr"
                      value={contact.email}
                      onChange={e => setContact(c => ({ ...c, email: e.target.value }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <button
                    type="button"
                    onClick={() => setStep("done")}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    ← חזרה
                  </button>
                  <button
                    type="button"
                    disabled={busy || !contact.name.trim() || !contact.phone.trim()}
                    onClick={handleSaveContact}
                    className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                  >
                    שמור
                  </button>
                </div>
              </>
            )}

            {step === "result" && (
              <>
                <p className="text-sm text-slate-700">{resultMsg}</p>
                <div className="flex justify-end mt-1">
                  <button
                    type="button"
                    onClick={finish}
                    className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                  >
                    סיום
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
