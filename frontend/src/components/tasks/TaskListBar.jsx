import { useEffect, useState } from "react";
import axios from "axios";
import { useTasks } from "../../context/TasksContext";
import TaskCreateWizard from "./TaskCreateWizard";

// Mounted above the schools table in AdminPage.jsx's "בתי ספר" tab — shows every open
// (non-archived) task as a chip with live progress, and the "יצירת משימה" entry point.
// Clicking a chip opens/restores its floating TaskPanel via TasksContext.
export default function TaskListBar() {
  const { openTask } = useTasks();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  function loadTasks() {
    setLoading(true);
    axios.get("/tasks/")
      .then(r => setTasks(r.data.filter(t => t.status !== "archived")))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTasks(); }, []);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <span className="text-xs font-semibold text-slate-500">משימות:</span>
      {loading ? (
        <span className="text-xs text-slate-400">טוען...</span>
      ) : tasks.length === 0 ? (
        <span className="text-xs text-slate-400">אין משימות פתוחות</span>
      ) : (
        tasks.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => openTask(t.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-1.5"
          >
            {t.name}
            {t.status === "scheduled" ? (
              <span className="text-amber-600">(מתוזמן)</span>
            ) : (
              <span className="text-slate-400">({t.total_schools ?? 0})</span>
            )}
          </button>
        ))
      )}
      <button
        type="button"
        onClick={() => setWizardOpen(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700"
      >
        + יצירת משימה
      </button>

      {wizardOpen && (
        <TaskCreateWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(taskId) => {
            setWizardOpen(false);
            loadTasks();
            openTask(taskId);
          }}
        />
      )}
    </div>
  );
}
