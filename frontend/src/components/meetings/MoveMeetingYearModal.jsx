import { useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { ACADEMIC_YEARS, getAcademicYearForDate } from "../../constants/academicYears";
import { formatMeetingDate } from "./constants";

// Re-tags a meeting to another academic year. Only the year label changes — the backend
// endpoint deliberately skips the Outlook sync, so nothing is sent to participants.
export function MoveMeetingYearModal({ meeting, onConfirm, onCancel }) {
  const { ref, handleKeyDown } = useFocusTrap(onCancel);
  const [selectedYear, setSelectedYear] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const currentYear = meeting.academic_year;
  const dateYear = getAcademicYearForDate(meeting.meeting_date);
  const showDateWarning = !!selectedYear && !!meeting.meeting_date && dateYear !== selectedYear;

  async function handleConfirm() {
    if (!selectedYear || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(selectedYear);
    } catch (err) {
      setError(err?.response?.data?.detail || "שגיאה בהעברת הפגישה — נסה שוב");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="move-meeting-year-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl p-6 w-[400px] max-w-[calc(100vw-32px)] flex flex-col gap-4">
        <h2 id="move-meeting-year-title" className="text-base font-bold text-slate-800 text-center">
          לאיזו שנת לימודים ברצונך להעביר את הפגישה?
        </h2>
        <div role="radiogroup" aria-labelledby="move-meeting-year-title" className="flex flex-wrap gap-2 justify-center">
          {ACADEMIC_YEARS.map(year => {
            const isCurrent = year === currentYear;
            const isSelected = year === selectedYear;
            return (
              <button key={year} type="button" role="radio" aria-checked={isSelected}
                disabled={isCurrent || saving}
                onClick={() => setSelectedYear(year)}
                className={`px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
                  isCurrent
                    ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                    : isSelected
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-300 text-slate-700 hover:border-blue-400 hover:bg-blue-50"
                }`}>
                {year}{isCurrent ? " (נוכחית)" : ""}
              </button>
            );
          })}
        </div>
        {showDateWarning && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-2.5 leading-snug">
            {dateYear
              ? `תאריך הפגישה (${formatMeetingDate(meeting.meeting_date)}) שייך לשנת ${dateYear} ולא לשנה שנבחרה.`
              : `תאריך הפגישה (${formatMeetingDate(meeting.meeting_date)}) אינו שייך לשנה שנבחרה.`}
            {" "}הפגישה תועבר בכל זאת והתאריך לא ישתנה.
          </p>
        )}
        <p className="text-xs text-slate-500 text-center">
          ההעברה אינה שולחת מיילים ואינה מעדכנת את היומן באאוטלוק.
        </p>
        {error && <p role="alert" className="text-xs text-red-600 text-center">{error}</p>}
        {saving && <p role="status" aria-label="מעביר את הפגישה" className="text-xs text-slate-500 text-center">מעביר...</p>}
        <div className="flex gap-3 justify-center mt-1">
          <button type="button" onClick={handleConfirm} disabled={!selectedYear || saving}
            className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors">
            העבר
          </button>
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-5 py-2 rounded-full border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-semibold transition-colors">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
