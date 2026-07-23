import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function CallSummaryModal({ call, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [transcript, setTranscript] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");

  async function loadTranscript() {
    setLoadingTranscript(true);
    setTranscriptError("");
    try {
      const res = await axios.get(`/voicenter/calls/${call.call_id}/transcript`);
      const url = res.data?.url;
      if (!url) throw new Error("no url");
      const fileRes = await axios.get(url);
      setTranscript(Array.isArray(fileRes.data) ? fileRes.data : []);
    } catch {
      setTranscriptError("לא ניתן היה לטעון את התמלול כרגע");
    } finally {
      setLoadingTranscript(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="call-summary-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="call-summary-title" className="font-bold text-black">סיכום שיחה</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">{call.ai_summary || "אין סיכום זמין לשיחה זו."}</p>

          {call.ai_transcript_available && (
            <div className="border-t border-slate-100 pt-4">
              {!transcript && !loadingTranscript && (
                <button type="button" onClick={loadTranscript}
                  className="text-sm text-blue-600 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition-colors">
                  הצג תמלול מלא
                </button>
              )}
              {loadingTranscript && (
                <div role="status" aria-label="טוען תמלול" className="flex justify-center py-4">
                  <div aria-hidden="true" className="spinner w-6 h-6" />
                </div>
              )}
              {transcriptError && <p role="alert" className="text-sm text-red-600">{transcriptError}</p>}
              {transcript && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {transcript.map((line, i) => (
                    <div key={i} className="text-sm">
                      <span className="font-semibold text-slate-600">{line.speaker === "Speaker0" ? "נציג" : "צד שני"}: </span>
                      <span className="text-slate-700">{line.text}</span>
                    </div>
                  ))}
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
