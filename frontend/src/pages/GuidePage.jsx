import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Sidebar from "../components/Sidebar";

function Logo() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate("/")}
      aria-label="חזור לעמוד הראשי"
      className="flex items-center gap-2.5"
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "linear-gradient(135deg, #0070F3 0%, #0055cc 100%)" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.5"/>
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="white" fillOpacity="0.9"/>
        </svg>
      </div>
      <span className="font-800 text-base" style={{ fontWeight: 800, color: "#0070F3" }}>
        גפן AI
      </span>
    </button>
  );
}

const FILES_CHECKLIST_PDF = "/guide/which-files-to-upload.pdf";

function TrainingVideos() {
  const [videos, setVideos] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    axios.get("/training-videos/")
      .then(res => { if (!cancelled) setVideos(res.data || []); })
      .catch(() => { if (!cancelled) setError("לא ניתן לטעון את סרטוני ההדרכה כרגע"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div role="status" aria-label="טוען סרטוני הדרכה" className="text-sm text-slate-400 mb-8">
        טוען סרטוני הדרכה...
      </div>
    );
  }
  if (error) {
    return <div role="alert" className="text-sm text-red-600 mb-8">{error}</div>;
  }
  if (videos.length === 0) return null;

  return (
    <div className="mb-8 anim-fade-up text-right">
      <h2 className="text-base font-800 text-slate-700 mb-3 text-center" style={{ fontWeight: 800 }}>
        סרטוני הדרכה
      </h2>
      <div className="flex flex-col gap-3">
        {videos.map(v => {
          const isOpen = openId === v.id;
          return (
            <div key={v.id} className="glass-card rounded-2xl px-5 py-4">
              <button
                onClick={() => setOpenId(isOpen ? null : v.id)}
                aria-expanded={isOpen}
                aria-controls={`training-video-${v.id}`}
                className="w-full flex items-center justify-between text-sm font-700 text-slate-800"
                style={{ fontWeight: 700, background: "none", border: "none", cursor: "pointer" }}
              >
                <span>{v.title}</span>
                <span aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div id={`training-video-${v.id}`} className="mt-3">
                  {v.video_url ? (
                    <video controls preload="metadata" width="100%" style={{ borderRadius: 12 }}>
                      <source src={v.video_url} type="video/mp4" />
                      הדפדפן שלך אינו תומך בהצגת וידאו.
                    </video>
                  ) : (
                    <p className="text-xs text-slate-400">הסרטון עדיין לא זמין</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function GuidePage() {
  const navigate = useNavigate();

  return (
    <div dir="rtl" className="bg-scene min-h-screen">
      <Sidebar dark />
      <div style={{ marginRight: "var(--sidebar-w, 240px)", transition: "margin-right 0.25s cubic-bezier(0.4,0,0.2,1)" }}>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-16 text-center">
        {/* Page heading */}
        <div className="mb-8 anim-fade-up">
          <h1 className="text-3xl font-900 mb-2" style={{ fontWeight: 900, color: "#0f172a" }}>הדרכה</h1>
          <p className="text-slate-500 text-sm">מדריך למשתמש — גפן AI</p>
        </div>

        <TrainingVideos />

        {/* Section heading */}
        <div className="mb-4 anim-fade-up flex items-center justify-between flex-wrap gap-2">
          <div className="text-right">
            <h2 className="text-base font-800 text-slate-700" style={{ fontWeight: 800 }}>אילו קבצים צריך להעלות לביצוע תקין של בדיקה</h2>
          </div>
          <a
            href={FILES_CHECKLIST_PDF}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-700 text-blue-600 hover:underline"
            style={{ fontWeight: 700 }}
          >
            פתיחה בכרטיסייה נפרדת
          </a>
        </div>

        {/* PDF guide */}
        <div className="glass-card rounded-2xl overflow-hidden anim-fade-up" style={{ height: "80vh" }}>
          <iframe
            src={`${FILES_CHECKLIST_PDF}#toolbar=0&navpanes=0&view=FitH`}
            title="אילו קבצים צריך להעלות לביצוע תקין של בדיקה"
            className="w-full h-full"
            style={{ border: "none" }}
          />
        </div>

        <div className="flex justify-center mt-8">
          <button onClick={() => navigate("/")} className="btn-blue px-8 py-2.5 text-sm">
            חזרה לדף הראשי
          </button>
        </div>
      </main>
      </div>
    </div>
  );
}
