import { useState } from "react";
import axios from "axios";

function DownloadIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" className="flex-shrink-0">
      <path d="M8.5 2v9M5 8l3.5 3.5L12 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 13.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
      <rect x="2" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 5h5M5 7.5h5M5 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M11 9.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function Spinner({ dark }) {
  return (
    <span
      className="w-4 h-4 rounded-full flex-shrink-0"
      style={{
        border: dark ? "2px solid rgba(0,0,0,0.15)" : "2px solid rgba(255,255,255,0.3)",
        borderTopColor: dark ? "#b91c1c" : "white",
        animation: "spin-smooth 0.7s linear infinite",
      }}
    />
  );
}

export default function DownloadButton({ runId, authHeader, onNewRun }) {
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [downloadingPdf,   setDownloadingPdf]   = useState(false);
  const [pdfError,         setPdfError]         = useState(false);

  async function handleDownloadExcel() {
    if (downloadingExcel || downloadingPdf) return;
    setDownloadingExcel(true);
    try {
      const response = await axios.get(`/analyze/download/${runId}`, {
        headers: authHeader,
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hashvaa-gefen-ksafim.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleDownloadPdf() {
    if (downloadingExcel || downloadingPdf) return;
    setPdfError(false);
    setDownloadingPdf(true);
    try {
      const response = await axios.get(`/analyze/pdf/${runId}`, {
        headers: authHeader,
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "hashvaa-gefen-kesafim.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setPdfError(true);
      setTimeout(() => setPdfError(false), 3000);
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="flex justify-center gap-3 mt-2 anim-fade-up-4 flex-wrap items-center">
      {/* Excel */}
      <button
        onClick={handleDownloadExcel}
        disabled={downloadingExcel || downloadingPdf}
        className="flex items-center gap-2 px-6 py-3 text-sm rounded-full transition-all"
        style={{
          fontWeight: 700,
          background: "rgba(34,197,94,0.09)",
          color: "#16a34a",
          border: "1.5px solid rgba(34,197,94,0.28)",
        }}
      >
        {downloadingExcel ? <><Spinner dark /><span>מוריד...</span></> : <><DownloadIcon /><span>הורד קובץ Excel</span></>}
      </button>

      {/* PDF */}
      <button
        onClick={handleDownloadPdf}
        disabled={downloadingExcel || downloadingPdf}
        className="flex items-center gap-2 px-6 py-3 text-sm rounded-full transition-all"
        style={{
          fontWeight: 700,
          background: pdfError ? "#fee2e2" : "rgba(239,68,68,0.08)",
          color: pdfError ? "#dc2626" : "#dc2626",
          border: "1.5px solid rgba(239,68,68,0.25)",
        }}
      >
        {downloadingPdf ? (
          <><Spinner dark /><span>מוריד...</span></>
        ) : pdfError ? (
          <span>שגיאה, נסה שוב</span>
        ) : (
          <>
            <DownloadIcon />
            <span>הורד קובץ PDF</span>
          </>
        )}
      </button>

      {/* New run */}
      <button
        onClick={() => window.open(window.location.origin, "_blank")}
        className="btn-ghost flex items-center gap-2 px-5 py-3 text-sm font-600"
        style={{ fontWeight: 600 }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="flex-shrink-0">
          <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        בדיקה חדשה
      </button>
    </div>
  );
}
