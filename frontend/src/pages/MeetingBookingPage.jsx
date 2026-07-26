import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import logoImg from "../assets/logo.png";
import { useFocusTrap } from "../hooks/useFocusTrap";

const HEBREW_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function monthLabel(month) {
  const [y, m] = month.split("-");
  return `${HEBREW_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function formatDateDDMMYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function SlotButton({ selected, disabled, onClick, children }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      aria-pressed={selected}
      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
        selected
          ? "border-sky-400 bg-sky-200 text-sky-900 font-semibold ring-2 ring-sky-300"
          : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
      }`}>
      {children}
    </button>
  );
}

function SlotPickerModal({ token, month, onClose, onBooked }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState([]);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(false);
  const [selected, setSelected] = useState(null); // { date, slot }
  const [confirmed, setConfirmed] = useState(null); // booked details, once confirmed

  useEffect(() => {
    axios.get(`/public/meeting-booking/${token}/freebusy`, { params: { month } })
      .then(res => {
        setDays(res.data.days || []);
        if (!res.data.ok) setError("לא ניתן היה לבדוק זמינות ביומן כרגע, נסו שוב מאוחר יותר.");
      })
      .catch(() => setError("אירעה שגיאה בטעינת המשבצות הפנויות."))
      .finally(() => setLoading(false));
  }, [token, month]);

  async function confirmSelection() {
    if (booking || !selected) return;
    setBooking(true);
    setError("");
    try {
      await axios.post(`/public/meeting-booking/${token}/book`, {
        month, meeting_date: selected.date, start_time: selected.slot.start_time, end_time: selected.slot.end_time,
      });
      setConfirmed(selected);
    } catch (err) {
      setError(err?.response?.data?.detail || "המשבצת הזו כבר אינה פנויה, בחרו מועד אחר.");
      setSelected(null);
    } finally {
      setBooking(false);
    }
  }

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="slot-confirmed-title"
          onKeyDown={handleKeyDown}
          className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-3">
          <h2 id="slot-confirmed-title" className="text-base font-bold text-green-700 text-center">הפגישה נקבעה בהצלחה!</h2>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1.5 text-sm text-slate-700">
            <p><span className="font-semibold">חודש:</span> {monthLabel(month)}</p>
            <p><span className="font-semibold">תאריך:</span> {HEBREW_WEEKDAYS[new Date(confirmed.date + "T00:00:00").getDay()]}, {formatDateDDMMYYYY(confirmed.date)}</p>
            <p><span className="font-semibold">שעה:</span> {confirmed.slot.start_time} - {confirmed.slot.end_time}</p>
          </div>
          <button type="button" onClick={() => onBooked({})}
            className="mt-2 px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors self-center">
            סגירה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="slot-picker-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto flex flex-col gap-3">
        <h2 id="slot-picker-title" className="text-base font-bold text-slate-800 text-center">
          בחירת מועד — {monthLabel(month)}
        </h2>

        {loading && <p role="status" aria-label="טוען משבצות פנויות" className="text-sm text-slate-500 text-center py-4">טוען משבצות פנויות...</p>}
        {error && <p role="alert" className="text-sm text-red-600 text-center">{error}</p>}

        {!loading && days.length === 0 && !error && (
          <p className="text-sm text-slate-500 text-center py-4">לא נמצאו משבצות פנויות בחודש זה.</p>
        )}

        {!loading && days.map(d => (
          <div key={d.date} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
            <p className="text-sm font-semibold text-slate-700 mb-1.5">
              {HEBREW_WEEKDAYS[new Date(d.date + "T00:00:00").getDay()]}, {formatDateDDMMYYYY(d.date)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {d.slots.map(slot => (
                <SlotButton key={slot.start_time} disabled={booking}
                  selected={selected?.date === d.date && selected?.slot.start_time === slot.start_time}
                  onClick={() => setSelected({ date: d.date, slot })}>
                  {slot.start_time}
                </SlotButton>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 justify-center mt-2">
          <button type="button" onClick={onClose} disabled={booking}
            className="px-6 py-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors disabled:opacity-50">
            סגירה
          </button>
          <button type="button" onClick={confirmSelection} disabled={!selected || booking}
            className="px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {booking ? "קובע..." : "אישור"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RangeSlotPickerModal({ token, range, onClose, onBooked }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState([]);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(false);
  const [selected, setSelected] = useState(null); // { date, slot }
  const [confirmed, setConfirmed] = useState(null);

  useEffect(() => {
    axios.get(`/public/meeting-booking/${token}/freebusy`, { params: { range_key: range.key } })
      .then(res => {
        setDays(res.data.days || []);
        if (!res.data.ok) setError("לא ניתן היה לבדוק זמינות ביומן כרגע, נסו שוב מאוחר יותר.");
      })
      .catch(() => setError("אירעה שגיאה בטעינת המשבצות הפנויות."))
      .finally(() => setLoading(false));
  }, [token, range.key]);

  async function confirmSelection() {
    if (booking || !selected) return;
    setBooking(true);
    setError("");
    try {
      await axios.post(`/public/meeting-booking/${token}/book`, {
        range_key: range.key, meeting_date: selected.date, start_time: selected.slot.start_time, end_time: selected.slot.end_time,
      });
      setConfirmed(selected);
    } catch (err) {
      setError(err?.response?.data?.detail || "המשבצת הזו כבר אינה פנויה, בחרו מועד אחר.");
      setSelected(null);
    } finally {
      setBooking(false);
    }
  }

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="range-slot-confirmed-title"
          onKeyDown={handleKeyDown}
          className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md flex flex-col gap-3">
          <h2 id="range-slot-confirmed-title" className="text-base font-bold text-green-700 text-center">הפגישה נקבעה בהצלחה!</h2>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1.5 text-sm text-slate-700">
            <p><span className="font-semibold">סוג:</span> {range.label}</p>
            <p><span className="font-semibold">תאריך:</span> {HEBREW_WEEKDAYS[new Date(confirmed.date + "T00:00:00").getDay()]}, {formatDateDDMMYYYY(confirmed.date)}</p>
            <p><span className="font-semibold">שעה:</span> {confirmed.slot.start_time} - {confirmed.slot.end_time}</p>
            {range.participants?.length > 0 && (
              <p><span className="font-semibold">משתתפים:</span> {range.participants.map(p => p.name).filter(Boolean).join(", ")}</p>
            )}
          </div>
          <button type="button" onClick={() => onBooked({})}
            className="mt-2 px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors self-center">
            סגירה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="range-slot-picker-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto flex flex-col gap-3">
        <h2 id="range-slot-picker-title" className="text-base font-bold text-slate-800 text-center">
          בחירת מועד — {range.label}
        </h2>

        {loading && <p role="status" aria-label="טוען משבצות פנויות" className="text-sm text-slate-500 text-center py-4">טוען משבצות פנויות...</p>}
        {error && <p role="alert" className="text-sm text-red-600 text-center">{error}</p>}

        {!loading && days.length === 0 && !error && (
          <p className="text-sm text-slate-500 text-center py-4">לא נמצאו משבצות פנויות בטווח זה.</p>
        )}

        {!loading && days.map(d => (
          <div key={d.date} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
            <p className="text-sm font-semibold text-slate-700 mb-1.5">
              {HEBREW_WEEKDAYS[new Date(d.date + "T00:00:00").getDay()]}, {formatDateDDMMYYYY(d.date)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {d.slots.map(slot => (
                <SlotButton key={slot.start_time} disabled={booking}
                  selected={selected?.date === d.date && selected?.slot.start_time === slot.start_time}
                  onClick={() => setSelected({ date: d.date, slot })}>
                  {slot.start_time}
                </SlotButton>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 justify-center mt-2">
          <button type="button" onClick={onClose} disabled={booking}
            className="px-6 py-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors disabled:opacity-50">
            סגירה
          </button>
          <button type="button" onClick={confirmSelection} disabled={!selected || booking}
            className="px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {booking ? "קובע..." : "אישור"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MeetingBookingPage() {
  const { token } = useParams();
  const [status, setStatus] = useState("loading"); // loading | invalid | expired | ready
  const [data, setData] = useState(null);
  const [pickerMonth, setPickerMonth] = useState(null);
  const [pickerRange, setPickerRange] = useState(null);

  function load() {
    axios.get(`/public/meeting-booking/${token}`)
      .then(res => { setData(res.data); setStatus("ready"); })
      .catch(err => {
        setStatus(err?.response?.status === 410 ? "expired" : "invalid");
      });
  }

  useEffect(() => { load(); }, [token]);

  function handleBooked() {
    // The picker modal already showed a detailed booking confirmation before calling this —
    // just close it and refresh the underlying open-items list.
    setPickerMonth(null);
    setPickerRange(null);
    load();
  }

  return (
    <div dir="rtl" className="bg-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg anim-fade-up">
        <div className="glass-card rounded-3xl px-8 py-10">
          <div className="flex justify-center mb-6">
            <img src={logoImg} alt="גפן AI לוגו" className="h-20 w-auto object-contain" />
          </div>

          {status === "loading" && (
            <p className="text-sm text-slate-500 text-center" role="status" aria-label="טוען">טוען...</p>
          )}

          {status === "invalid" && (
            <p className="text-sm text-red-600 text-center" role="alert">
              קישור לא תקין. אנא פנו ליועץ שלכם לקבלת קישור חדש.
            </p>
          )}

          {status === "expired" && (
            <p className="text-sm text-red-600 text-center" role="alert">
              פג תוקפו של קישור זה. אנא פנו ליועץ שלכם לקבלת קישור חדש.
            </p>
          )}

          {status === "ready" && data && data.mode === "ranges" && (
            <>
              <h1 className="text-lg font-bold text-slate-800 mb-1 text-center">קביעת מועד לפגישות</h1>
              <p className="text-sm text-slate-500 mb-6 text-center">
                {data.school_name}{data.advisor_names?.length ? ` · עם ${data.advisor_names.join(", ")}` : ""}
              </p>

{data.ranges.every(r => r.booked) ? (
                <p className="text-sm text-slate-500 text-center py-4">כל הפגישות הנדרשות כבר נקבעו — תודה!</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.ranges.map(r => (
                    <div key={r.key} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-700">{r.label}</span>
                        {r.booked ? (
                          <span className="text-xs px-3 py-1 rounded-lg bg-green-100 text-green-700 font-semibold">✓ נקבע</span>
                        ) : (
                          <button type="button" onClick={() => setPickerRange(r)}
                            className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors">
                            בחר מועד
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {formatDateDDMMYYYY(r.start_date)} עד {formatDateDDMMYYYY(r.end_date)}
                      </p>
                      {r.participants?.length > 0 && (
                        <p className="text-xs text-slate-500">
                          משתתפים: {r.participants.map(p => p.name).filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {status === "ready" && data && data.mode !== "ranges" && (
            <>
              <h1 className="text-lg font-bold text-slate-800 mb-1 text-center">קביעת מועד לפגישה</h1>
              <p className="text-sm text-slate-500 mb-6 text-center">
                {data.school_name}{data.advisor_name ? ` · עם ${data.advisor_name}` : ""}
              </p>

{data.open_months.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">כל הפגישות הנדרשות כבר נקבעו — תודה!</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.open_months.map(month => (
                    <div key={month} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <span className="text-sm font-medium text-slate-700">{monthLabel(month)}</span>
                      <button type="button" onClick={() => setPickerMonth(month)}
                        className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors">
                        בחר מועד
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(status === "invalid" || status === "expired") && (
            <div className="text-center mt-4">
              <Link to="/contact" className="text-sm text-blue-600 hover:underline">יצירת קשר</Link>
            </div>
          )}
        </div>
      </div>

      {pickerMonth && (
        <SlotPickerModal
          token={token}
          month={pickerMonth}
          onClose={() => setPickerMonth(null)}
          onBooked={handleBooked}
        />
      )}

      {pickerRange && (
        <RangeSlotPickerModal
          token={token}
          range={pickerRange}
          onClose={() => setPickerRange(null)}
          onBooked={handleBooked}
        />
      )}
    </div>
  );
}
