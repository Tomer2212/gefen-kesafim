import { useState } from "react";
import axios from "axios";

export default function DownloadButton({ runId, authHeader, onNewRun }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await axios.get(`/analyze/download/${runId}`, {
        headers: authHeader,
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reconciliation.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user can retry
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex gap-3 mt-2 anim-fade-up-4">
      {/* Download */}
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="btn-green flex items-center gap-2 px-6 py-3 text-sm font-700"
        style={{ fontWeight: 700, flex: 1 }}
      >
        {downloading ? (
          <>
            <span
              className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full flex-shrink-0"
              style={{ animation: "spin-smooth 0.7s linear infinite" }}
            />
            מוריד...
          </>
        ) : (
          <>
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" className="flex-shrink-0">
              <path
                d="M8.5 2v9M5 8l3.5 3.5L12 8"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 13.5h13"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            הורד קובץ Excel
          </>
        )}
      </button>

      {/* New run */}
      <button
        onClick={onNewRun}
        className="btn-ghost flex items-center gap-2 px-5 py-3 text-sm font-600"
        style={{ fontWeight: 600 }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="flex-shrink-0">
          <path
            d="M2 7.5A5.5 5.5 0 0 1 13 7.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M11 5l2 2.5-2 2.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        בדיקה חדשה
      </button>
    </div>
  );
}
