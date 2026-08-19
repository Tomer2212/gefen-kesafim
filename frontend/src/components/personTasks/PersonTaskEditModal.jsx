import { useState } from "react";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import DirectStyleDateInput from "../tasks/DirectStyleDateInput";
import { URGENCY_LABELS } from "./personTaskColumns";

// Creator-only edit form for a person-task's 4 basic fields (name/description/due_date/
// urgency) — deliberately NOT the full creation wizard: changing WHO the task is assigned to or
// its success metric would require deciding what happens to already-existing (possibly
// partially-completed) target rows, which is out of scope for this quick-edit action. Saving
// notifies every current assignee with a summary of what changed (see patch_person_task).
export default function PersonTaskEditModal({ task, onClose, onSaved }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  const [name, setName] = useState(task.name || "");
  const [description, setDescription] = useState(task.description || "");
  const [dueDate, setDueDate] = useState(task.due_date || "");
  const [urgency, setUrgency] = useState(task.urgency ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await axios.patch(`/person-tasks/${task.id}`, {
        name: name.trim(), description: description.trim() || undefined,
        due_date: dueDate || undefined, urgency,
      });
      onSaved(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "עדכון המשימה נכשל — נסה שוב.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-task-edit-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="person-task-edit-title" className="font-bold text-slate-800">עריכת משימה</h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-4 text-sm">
          <div>
            <label htmlFor="pte-name" className="block text-xs font-semibold text-slate-600 mb-1">שם המשימה</label>
            <input id="pte-name" value={name} onChange={e => setName(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label htmlFor="pte-desc" className="block text-xs font-semibold text-slate-600 mb-1">מה צריך לעשות? (ההסבר יוצג למשתמשים שעליהם מוטלת המשימה, מומלץ לכלול מהו המדד להשלמת המשימה)</label>
            <textarea id="pte-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2" />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label htmlFor="pte-due" className="block text-xs font-semibold text-slate-600 mb-1">תאריך יעד (אופציונלי)</label>
              <DirectStyleDateInput id="pte-due" value={dueDate} onChange={setDueDate} />
            </div>
            <div>
              <label htmlFor="pte-urgency" className="block text-xs font-semibold text-slate-600 mb-1">רמת דחיפות</label>
              <select id="pte-urgency" value={urgency} onChange={e => setUrgency(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-2 bg-white">
                {Object.entries(URGENCY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-500">שינויים ישלחו התראה מיידית לכל מי שהוטלה עליו המשימה, עם פירוט מה השתנה.</p>
          {error && <p role="alert" className="text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded-xl font-medium text-slate-500 hover:bg-slate-50">ביטול</button>
          <button type="button" onClick={handleSave} disabled={saving || !name.trim()} className="text-sm px-4 py-2 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
        </div>
      </div>
    </div>
  );
}
