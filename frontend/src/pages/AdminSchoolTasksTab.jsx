import { useEffect, useState } from "react";
import axios from "axios";
import { useTasks } from "../context/TasksContext";
import TaskTypeChooser from "../components/tasks/TaskTypeChooser";
import TaskCreateWizard from "../components/tasks/TaskCreateWizard";
import TasksTable from "../components/tasks/TasksTable";
import ColumnPickerButton, { loadColVisible } from "../components/tasks/ColumnPickerButton";
import PersonTaskCreateWizard from "../components/personTasks/PersonTaskCreateWizard";
import RoundsView from "../components/rounds/RoundsView";
import { AcademicYearSelector } from "../components/AcademicYearSelector";
import { DEFAULT_ACADEMIC_YEAR } from "../constants/academicYears";

const TASKS_REFRESH_MS = 60000;

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
  // "משימות" | "סבבי פגישות" (components/rounds) — remembered in the URL so a reload stays put.
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get("view") === "rounds" ? "rounds" : "tasks");
  const [openRoundId, setOpenRoundId] = useState(() => new URLSearchParams(window.location.search).get("round"));
  const [roundNames, setRoundNames] = useState({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view === "rounds") params.set("view", "rounds"); else params.delete("view");
    if (view === "rounds" && openRoundId) params.set("round", openRoundId); else params.delete("round");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [view, openRoundId]);

  // Round names for the tasks table's "סבב" tag.
  useEffect(() => {
    axios.get("/rounds/", { params: { academic_year: academicYear } })
      .then(r => setRoundNames(Object.fromEntries((r.data || []).map(x => [x.id, x.name]))))
      .catch(() => {});
  }, [academicYear]);

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

  // Progress is refreshed server-side every 5 minutes (POST /tasks/recompute-progress), so an open
  // table picks that up by itself: no spinner, and a failed poll keeps the rows on screen.
  useEffect(() => {
    let stale = false;
    function refresh() {
      if (document.hidden) return;
      axios.get("/tasks/", { params: { academic_year: academicYear } })
        .then(r => { if (!stale) setTasks(r.data); })
        .catch(() => {});
    }
    const timer = setInterval(refresh, TASKS_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stale = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [academicYear]);

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">משימות בתי ספר</h2>
          <p className="text-sm text-slate-500">יצירה ומעקב אחר משימות תקשורת מול בתי ספר</p>
        </div>
        <div className="flex items-center gap-2">
          <AcademicYearSelector value={academicYear} onChange={(y) => { setAcademicYear(y); setOpenRoundId(null); }} />
          {view === "tasks" && (
            <>
              <ColumnPickerButton colVisible={colVisible} setColVisible={setColVisible} size="md" />
              <button
                type="button"
                onClick={() => setChoosingType(true)}
                className="btn-blue text-sm px-4 py-2"
              >
                + יצירת משימה חדשה
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 border border-slate-200 rounded-xl p-1 w-fit mb-4" role="tablist" aria-label="תצוגה">
        {[["tasks", "משימות"], ["rounds", "סבבי פגישות"]].map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v}
            onClick={() => { setView(v); if (v === "tasks") loadTasks(); }}
            className={`text-sm px-4 py-1.5 rounded-lg font-medium ${view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </div>

      {view === "rounds" ? (
        <RoundsView
          academicYear={academicYear} openRoundId={openRoundId} setOpenRoundId={setOpenRoundId}
          onRoundsChanged={(list) => setRoundNames(Object.fromEntries(list.map(x => [x.id, x.name])))}
        />
      ) : loading ? (
        <div role="status" aria-label="טוען משימות" className="text-sm text-slate-400">טוען...</div>
      ) : (
        <TasksTable tasks={tasks} onChanged={loadTasks} onTaskRefreshed={patchTaskLocally} colVisible={colVisible} roundNames={roundNames} />
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
