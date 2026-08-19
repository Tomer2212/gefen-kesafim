import TaskDetailContent from "./TaskDetailContent";

// Thin host for the redesigned Tasks table's inline row-expansion — renders the exact same
// per-school table/handlers the floating TaskPanel.jsx shows, via the shared TaskDetailContent.
// A fixed height wrapper is required here (unlike TaskPanel.jsx's resizable window, which
// already provides one) since TaskDetailContent's internal layout relies on flex-1 to size its
// scrollable table area.
export default function TaskRowExpandedDetail({ taskId, onTaskChange }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col" style={{ height: "65vh" }}>
      <TaskDetailContent taskId={taskId} onTaskChange={onTaskChange} />
    </div>
  );
}
