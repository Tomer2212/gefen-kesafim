import { useEffect, useState } from "react";
import axios from "axios";
import { useTasks } from "../context/TasksContext";
import { useMeetingsPolling } from "../hooks/useMeetingsPolling";
import TaskTypeChooser from "../components/tasks/TaskTypeChooser";
import TaskCreateWizard from "../components/tasks/TaskCreateWizard";
import PersonTaskCreateWizard from "../components/personTasks/PersonTaskCreateWizard";
import PersonTasksTable from "../components/personTasks/PersonTasksTable";
import ColumnPickerButton, { loadColVisible } from "../components/tasks/ColumnPickerButton";
import { ALL_PERSON_TASK_COLUMNS } from "../components/personTasks/personTaskColumns";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";

const COL_STORAGE_KEY = "admin_person_tasks_col_visible";

// "אנשי הארגון" sub-tab of ניהול -> משימות — same table/filter/pin/expand conventions as the
// school-tasks tab, reused via the generic ColumnFilterButton/ColumnPickerButton components.
export default function AdminPersonTasksTab() {
  const { openTask } = useTasks();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [choosingType, setChoosingType] = useState(false);
  const [personWizardOpen, setPersonWizardOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardIsMeetingTask, setWizardIsMeetingTask] = useState(true);
  const [colVisible, setColVisible] = useState(() => loadColVisible(ALL_PERSON_TASK_COLUMNS, COL_STORAGE_KEY));
  const [academicYear, setAcademicYear] = useState(DEFAULT_ACADEMIC_YEAR);

  function patchTaskLocally(freshTask) {
    setTasks(prev => prev.map(t => (t.id === freshTask.id ? { ...t, ...freshTask } : t)));
  }

  function loadTasks({ silent = false } = {}) {
    if (!silent) setLoading(true);
    axios.get("/person-tasks/", { params: { academic_year: academicYear } })
      .then(r => setTasks(Array.isArray(r.data) ? r.data : []))
      .catch(() => { if (!silent) setTasks([]); })
      .finally(() => { if (!silent) setLoading(false); });
  }

  useEffect(() => { loadTasks(); }, [academicYear]);
  // Field-based success metrics are re-evaluated live on every load (server-side, see
  // list_person_tasks) — this keeps the table itself fresh without a manual refresh while the
  // tab stays open, same mechanism already used for meetings polling.
  useMeetingsPolling(() => loadTasks({ silent: true }), true, [academicYear]);

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">משימות אנשי הארגון</h2>
          <p className="text-sm text-slate-500">הטלת משימות אישיות על אנשי צוות ומעקב אחר ביצוען</p>
        </div>
        <div className="flex items-center gap-2">
          <AcademicYearSelector value={academicYear} onChange={setAcademicYear} />
          <ColumnPickerButton colVisible={colVisible} setColVisible={setColVisible} size="md" columns={ALL_PERSON_TASK_COLUMNS} storageKey={COL_STORAGE_KEY} />
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
        <PersonTasksTable tasks={tasks} onChanged={loadTasks} onTaskRefreshed={patchTaskLocally} colVisible={colVisible} groupByAssignee />
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

      {personWizardOpen && (
        <PersonTaskCreateWizard
          initialAcademicYear={academicYear}
          onClose={() => setPersonWizardOpen(false)}
          onCreated={() => { setPersonWizardOpen(false); loadTasks(); }}
        />
      )}

      {wizardOpen && (
        <TaskCreateWizard
          isMeetingTask={wizardIsMeetingTask}
          initialAcademicYear={academicYear}
          onClose={() => setWizardOpen(false)}
          onCreated={(taskId) => {
            setWizardOpen(false);
            openTask(taskId);
          }}
        />
      )}
    </div>
  );
}
