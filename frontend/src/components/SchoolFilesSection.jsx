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
        className="btn-ghost text-xs px-3 py-1.5">
        + הוסף קובץ
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {title ? (
        <div className="relative flex items-center justify-center mb-1">
          <p className="text-sm font-semibold text-slate-700">{title}</p>
          <div className="absolute left-0">{addButton}</div>
        </div>
      ) : addButton}

      {error && <div role="alert" className="text-xs text-red-600">{error}</div>}

      <table className="w-full text-sm border-collapse" dir="rtl">
        <thead>
          <tr>
            <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2" style={{ width: "110px" }}>תאריך</th>
            <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2" style={{ width: "120px" }}>משתמש</th>
            <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2">תיאור</th>
            <th scope="col" className="text-right text-xs font-700 text-slate-500 px-3 py-2" style={{ width: "160px" }}>קובץ</th>
          </tr>
        </thead>
        <tbody>
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
              <tr key={f.id} className="border-t border-slate-100">
                <td className="px-3 py-2 align-top">
                  <div className="text-xs px-1.5 py-1 rounded" style={{ background: color?.bg, color: color?.text }}>
                    {formatUpdateDate(f.created_at)}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-xs px-1.5 py-1 rounded" style={{ background: color?.bg, color: color?.text }}>
                    {f.author_name || "—"}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-xs px-1.5 py-1 rounded flex items-start justify-between gap-2"
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
                <td className="px-3 py-2 align-top">
                  <button type="button" onClick={() => onDownload(f.id, f.file_name)}
                    className="text-xs text-blue-600 hover:underline truncate max-w-[150px] block text-right">
                    {f.file_name}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
