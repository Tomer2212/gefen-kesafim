import PersonTaskDetailContent from "./PersonTaskDetailContent";
import PersonTaskAdminDetailContent from "./PersonTaskAdminDetailContent";

// groupByAssignee=true (ניהול -> משימות -> אנשי הארגון only, per explicit product decision — in
// אזור אישי / כרטיס בית ספר the current user/school is already the only relevant "group", so
// grouping-by-assignee would add a redundant extra click there) swaps in the throughput-focused
// per-assignee view instead of the flat per-target list.
export default function PersonTaskRowExpandedDetail({ taskId, onTaskChange, groupByAssignee = false, onlyCurrentUser = false, scopeSchoolId = null }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-white p-3">
      {groupByAssignee
        ? <PersonTaskAdminDetailContent taskId={taskId} onTaskChange={onTaskChange} />
        : <PersonTaskDetailContent taskId={taskId} onTaskChange={onTaskChange} onlyCurrentUser={onlyCurrentUser} scopeSchoolId={scopeSchoolId} />}
    </div>
  );
}
