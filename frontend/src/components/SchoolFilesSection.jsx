import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { buildAuthorColorMap, canDeleteSegment, canEditSegment, formatUpdateDate } from "./SchoolNotesModal";

export function FilesThread({ files, currentUser, onUpload, onEditDescription, onDelete, onDownload, title }) {
  const [editDraft, setEditDraft] = useState(null); // { fileId, text }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  // Reuse the same color-by-author logic as NotesThread by wrapping each file
  // as a single-segment "group" — buildAuthorColorMap only cares about
  // author_id/created_at across the flattened segments.
  const authorColorMap = buildAuthorColorMap(files.map(f => ({ segments: [f] })));

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSaving(true); setError("");
    try {
      await onUpload(file, "");
    } catch {
      setError("העלאת הקובץ נכשלה — נסה שוב");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(fileId, text) {
    const description = (text || "").trim();
    setEditDraft(null);
    setSaving(true); setError("");
    try {
      await onEditDescription(fileId, description);
    } catch {
      setError("עריכת התיאור נכשלה — אין הרשאה או שגיאה זמנית");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(fileId) {
    setSaving(true); setError("");
    try {
      await onDelete(fileId);
    } catch {
      setError("מחיקת הקובץ נכשלה — אין הרשאה או שגיאה זמנית");
    } finally {
      setSaving(false);
    }
  }

  const addButton = (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChosen} aria-label="בחירת קובץ להעלאה" />
      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={saving}
        className="border border-slate-300 hover:border-slate-400 text-slate-700 bg-white text-xs font-semibold px-3.5 py-2 rounded-lg transition-all">
        + הוסף קובץ
      </button>
    </>
  );

  return (
    <div className="flex flex-col">
      {title ? (
        <div className="flex items-center justify-between bg-white border-b border-black/20 px-4 py-3">
          <p className="text-[23px] font-bold text-black flex items-center gap-2">{title}</p>
          {addButton}
        </div>
      ) : (
        <div className="mb-2">{addButton}</div>
      )}

      <div className={title ? "flex flex-col gap-2 px-4 py-4" : "flex flex-col gap-2"}>
      {error && <div role="alert" className="text-xs text-red-600">{error}</div>}

      <table className="w-full text-sm border border-slate-200 border-collapse font-sans" dir="rtl">
        <thead>
          <tr className="bg-slate-100 divide-x divide-slate-200">
            <th scope="col" className="text-right text-xs font-semibold text-gray-700 px-3 py-3" style={{ width: "110px" }}>תאריך</th>
            <th scope="col" className="text-right text-xs font-semibold text-gray-700 px-3 py-3" style={{ width: "120px" }}>משתמש</th>
            <th scope="col" className="text-right text-xs font-semibold text-gray-700 px-3 py-3">תיאור</th>
            <th scope="col" className="text-right text-xs font-semibold text-gray-700 px-3 py-3" style={{ width: "160px" }}>קובץ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {files.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6">
                <div className="flex flex-col items-center gap-1.5 text-slate-400">
                  <FolderOpen className="w-5 h-5 opacity-40" aria-hidden="true" />
                  <span className="text-xs">אין עדיין קבצים</span>
                </div>
              </td>
            </tr>
          )}
          {files.map(f => {
            const editable = canEditSegment(currentUser, f);
            const deletable = canDeleteSegment(currentUser, f);
            const isEditing = editDraft?.fileId === f.id;
            const color = authorColorMap[f.author_id];
            return (
              <tr key={f.id} className="divide-x divide-slate-200 even:bg-slate-100/80 hover:bg-blue-50/60 transition-colors">
                <td className="px-3 py-3 align-top">
                  <div className="text-sm px-2 py-1 rounded" style={{ background: color?.bg, color: color?.text }}>
                    {formatUpdateDate(f.created_at)}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="text-sm px-2 py-1 rounded" style={{ background: color?.bg, color: color?.text }}>
                    {f.author_name || "—"}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="text-sm px-2 py-1 rounded flex items-start justify-between gap-2"
                    style={{ background: color?.bg, color: color?.text }}
                    onClick={() => {
                      if (!editable) return;
                      setEditDraft({ fileId: f.id, text: f.description || "" });
                    }}>
                    {isEditing ? (
                      <>
                        <label htmlFor={`edit-file-desc-${f.id}`} className="sr-only">עריכת תיאור הקובץ</label>
                        <textarea id={`edit-file-desc-${f.id}`} rows={2} autoFocus
                          className="w-full text-xs border border-slate-300 rounded p-1" dir="rtl"
                          value={editDraft.text} onClick={e => e.stopPropagation()}
                          onChange={e => setEditDraft(d => ({ ...d, text: e.target.value }))}
                          onBlur={() => saveEdit(f.id, editDraft.text)} />
                      </>
                    ) : (
                      <span className="flex-1" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {f.description || "—"}
                      </span>
                    )}
                    {deletable && !isEditing && (
                      <button type="button" aria-label="מחק קובץ זה" className="text-slate-400 hover:text-red-600 text-xs flex-shrink-0"
                        onClick={e => { e.stopPropagation(); handleDelete(f.id); }}>
                        ✕
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <button type="button" onClick={() => onDownload(f.id, f.file_name)}
                    className="text-sm text-blue-600 hover:underline truncate max-w-[150px] block text-right">
                    {f.file_name}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
