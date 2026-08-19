import { useEffect, useState } from "react";
import axios from "axios";
import PersonTasksTable from "./PersonTasksTable";
import ColumnPickerButton, { loadColVisible } from "../tasks/ColumnPickerButton";
import { ALL_PERSON_TASK_COLUMNS } from "./personTaskColumns";

const COL_STORAGE_KEY = "personal_tasks_col_visible";

// אזור אישי -> "משימות" — same professional table (PersonTasksTable.jsx, the exact component
// used in ניהול -> משימות -> אנשי הארגון) filtered to GET /person-tasks/mine, per the explicit
// product decision that this should look identical, not a simplified personal to-do list.
export default function PersonalTasksSection() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [colVisible, setColVisible] = useState(() => loadColVisible(ALL_PERSON_TASK_COLUMNS, COL_STORAGE_KEY));

  function patchTaskLocally(freshTask) {
    setTasks(prev => prev.map(t => (t.id === freshTask.id ? { ...t, ...freshTask } : t)));
  }

  function loadTasks() {
    setLoading(true);
    axios.get("/person-tasks/mine")
      .then(r => setTasks(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTasks(); }, []);

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <ColumnPickerButton colVisible={colVisible} setColVisible={setColVisible} columns={ALL_PERSON_TASK_COLUMNS} storageKey={COL_STORAGE_KEY} />
      </div>
      {loading ? (
        <div role="status" aria-label="טוען משימות" className="text-sm text-slate-400">טוען...</div>
      ) : (
        <PersonTasksTable tasks={tasks} onChanged={loadTasks} onTaskRefreshed={patchTaskLocally} colVisible={colVisible} onlyCurrentUser />
      )}
    </div>
  );
}
