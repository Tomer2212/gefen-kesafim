import { useEffect, useState } from "react";
import axios from "axios";
import { useTasks } from "../context/TasksContext";
import TaskTypeChooser from "../components/tasks/TaskTypeChooser";
import TaskCreateWizard from "../components/tasks/TaskCreateWizard";
import TasksTable from "../components/tasks/TasksTable";
import ColumnPickerButton, { loadColVisible } from "../components/tasks/ColumnPickerButton";
import PersonTaskCreateWizard from "../components/personTasks/PersonTaskCreateWizard";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";

// "בתי ספר" sub-tab of ניהול -> משימות — a single table (mirrors DashboardPage.jsx's
// conventions) with per-column sort+filter and an "עמודות להצגה" picker instead of a filter
// bar above the table, and inline-expanding rows. "+ יצירת משימה" opens TaskTypeChooser, which
// can route to either this track's wizard OR the person-tasks wizard (kept reachable from both
// sub-tabs since the chooser is the single shared entry point).
export default function AdminSchoolTasksTab() {
  const { openTask } = useTasks();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [choosingType, setChoosingType] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardIsMeetingTask, setWizardIsMeetingTask] = useState(true);
  const [personWizardOpen, setPersonWizardOpen] = useState(false);
  const [colVisible, setColVisible] = useState(loadColVisible);
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);

  function patchTaskLocally(freshTask) {
    setTasks(prev => prev.map(t => (t.id === freshTask.id ? { ...t, ...freshTask } : t)));
  }

  function loadTasks() {
    setLoading(true);
    axios.get("/tasks/", { params: { academic_year: academicYear } })
      .then(r => setTasks(r.data))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTasks(); }, [academicYear]);

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">משימות בתי ספר</h2>
          <p className="text-sm text-slate-500">יצירה ומעקב אחר משימות תקשורת מול בתי ספר</p>
        </div>
        <div className="flex items-center gap-2">
          <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
          <ColumnPickerButton colVisible={colVisible} setColVisible={setColVisible} size="md" />
          <button
            type="button"
            onClick={() => setChoosingType(true)}
            className="btn-blue text-sm px-4 py-2"
          >
            + יצירת משימה חדשה
          </button>
        </div>
      </div>

      {loading ? (
        <div role="status" aria-label="טוען משימות" className="text-sm text-slate-400">טוען...</div>
      ) : (
        <TasksTable tasks={tasks} onChanged={loadTasks} onTaskRefreshed={patchTaskLocally} colVisible={colVisible} />
      )}

      {choosingType && (
        <TaskTypeChooser
          onClose={() => setChoosingType(false)}
          onChooseSchools={(isMeetingTask) => {
            setChoosingType(false);
            setWizardIsMeetingTask(isMeetingTask);
            setWizardOpen(true);
          }}
          onChooseUsers={() => {
            setChoosingType(false);
            setPersonWizardOpen(true);
          }}
        />
      )}

      {wizardOpen && (
        <TaskCreateWizard
          isMeetingTask={wizardIsMeetingTask}
          initialAcademicYear={academicYear}
          onClose={() => setWizardOpen(false)}
          onCreated={(taskId) => {
            setWizardOpen(false);
            loadTasks();
            openTask(taskId);
          }}
        />
      )}

      {personWizardOpen && (
        <PersonTaskCreateWizard
          initialAcademicYear={academicYear}
          onClose={() => setPersonWizardOpen(false)}
          onCreated={() => setPersonWizardOpen(false)}
        />
      )}
    </div>
  );
}
