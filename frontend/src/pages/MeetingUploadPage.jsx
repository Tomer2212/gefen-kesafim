import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import logoImg from "../assets/logo.png";

export default function MeetingUploadPage() {
  const { token } = useParams();
  const [status, setStatus] = useState("loading"); // loading | invalid | expired | ready
  const [data, setData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function load() {
    axios.get(`/public/meeting-upload/${token}`)
      .then(res => { setData(res.data); setStatus("ready"); })
      .catch(err => {
        setStatus(err?.response?.status === 410 ? "expired" : "invalid");
      });
  }

  useEffect(() => { load(); }, [token]);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const form = new FormData();
      files.forEach(f => form.append("files", f));
      await axios.post(`/public/meeting-upload/${token}/files`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUploadMsg("success");
      load();
    } catch {
      setUploadMsg("error");
    } finally {
      setUploading(false);
    }
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

          {status === "ready" && data && (
            <>
              <h1 className="text-lg font-bold text-slate-800 mb-1 text-center">
                העלאת קבצים לפגישה בבית הספר {data.school_name}
              </h1>
              <p className="text-sm text-slate-500 mb-6 text-center">
                תאריך הפגישה: {data.meeting_date}
              </p>

              {data.no_baseline_this_year && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4">
                  טרם בוצעה בדיקה עבור בית הספר בשנת הלימודים הנוכחית — הרשימה למטה כללית.
                </p>
              )}

              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-700 mb-2">קבצים נדרשים:</h2>
                <ul className="text-sm text-slate-600 list-disc pr-5 space-y-1">
                  {data.checklist_items.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>

              <label htmlFor="upload-dropzone" className="sr-only">גרירת קבצים להעלאה</label>
              <div
                id="upload-dropzone"
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors mb-4 ${
                  dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  aria-label="בחירת קבצים להעלאה"
                  className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                />
                <p className="text-sm text-slate-500">
                  {uploading ? "מעלה..." : "גררו לכאן את כל הקבצים, או לחצו לבחירה"}
                </p>
              </div>

              {uploadMsg === "success" && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4" role="status">
                  הקבצים התקבלו בהצלחה, תודה!
                </p>
              )}
              {uploadMsg === "error" && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4" role="alert">
                  אירעה שגיאה בהעלאה. נסו שוב או פנו ליועץ.
                </p>
              )}

              {data.already_uploaded?.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-700 mb-2">קבצים שהועלו עד כה:</h2>
                  <ul className="text-sm text-slate-500 list-disc pr-5 space-y-1">
                    {data.already_uploaded.map((f, i) => <li key={i}>{f.original_filename}</li>)}
                  </ul>
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
    </div>
  );
}
