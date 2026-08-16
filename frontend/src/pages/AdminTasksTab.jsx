import { useEffect, useState } from "react";
import axios from "axios";
import { useTasks } from "../context/TasksContext";
import TaskTypeChooser from "../components/tasks/TaskTypeChooser";
import TaskCreateWizard from "../components/tasks/TaskCreateWizard";

// 'משימות' tab (ניהול → משימות) — single entry point for task creation. Clicking
// "+ יצירת משימה" opens TaskTypeChooser first (school-communication vs. per-advisor,
// the latter not yet implemented), then TaskCreateWizard for the schools path.
// Previously this lived as a chip bar (TaskListBar) above the schools table; that
// component is now only rendered here.
export default function AdminTasksTab() {
  const { openTask } = useTasks();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [choosingType, setChoosingType] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardIsMeetingTask, setWizardIsMeetingTask] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  function loadTasks() {
    setLoading(true);
    axios.get("/tasks/")
      .then(r => setTasks(r.data))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTasks(); }, []);

  const openTasks = tasks.filter(t => t.status !== "archived");
  const archivedTasks = tasks.filter(t => t.status === "archived");

  function TaskCard({ t }) {
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => openTask(t.id)}
        className="text-right border border-slate-200 rounded-xl p-4 bg-white hover:border-blue-400 hover:shadow-sm transition-all flex flex-col gap-1"
      >
        <div className="font-semibold text-slate-800">{t.name}</div>
        <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
          {t.status === "scheduled" ? (
            <span className="text-amber-600 font-medium">מתוזמן</span>
          ) : t.status === "archived" ? (
            <span className="text-slate-400">בארכיון</span>
          ) : (
            <span className="text-green-600 font-medium">פעיל</span>
          )}
          <span>· {t.total_schools ?? 0} בתי ספר</span>
          {t.created_by_name && <span>· נוצר ע"י {t.created_by_name}</span>}
        </div>
      </button>
    );
  }

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">משימות</h2>
          <p className="text-sm text-slate-500">יצירה ומעקב אחר משימות תקשורת מול בתי ספר</p>
        </div>
        <button
          type="button"
          onClick={() => setChoosingType(true)}
          className="btn-blue text-sm px-4 py-2"
        >
          + יצירת משימה חדשה
        </button>
      </div>

      {loading ? (
        <div role="status" aria-label="טוען משימות" className="text-sm text-slate-400">טוען...</div>
      ) : openTasks.length === 0 ? (
        <div className="text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl p-8 text-center">
          אין משימות פתוחות כרגע
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {openTasks.map(t => <TaskCard key={t.id} t={t} />)}
        </div>
      )}

      {archivedTasks.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="text-sm text-slate-500 hover:text-slate-700 font-medium"
          >
            {showArchived ? "▼" : "◀"} משימות בארכיון ({archivedTasks.length})
          </button>
          {showArchived && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
              {archivedTasks.map(t => <TaskCard key={t.id} t={t} />)}
            </div>
          )}
        </div>
      )}

      {choosingType && (
        <TaskTypeChooser
          onClose={() => setChoosingType(false)}
          onChooseSchools={(isMeetingTask) => {
            setChoosingType(false);
            setWizardIsMeetingTask(isMeetingTask);
            setWizardOpen(true);
          }}
        />
      )}

      {wizardOpen && (
        <TaskCreateWizard
          isMeetingTask={wizardIsMeetingTask}
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
