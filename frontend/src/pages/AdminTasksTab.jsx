import { useSearchParams } from "react-router-dom";
import AdminSchoolTasksTab from "./AdminSchoolTasksTab";
import AdminPersonTasksTab from "./AdminPersonTasksTab";

const SUB_TAB_IDS = ["schools", "users"];
const SUB_TABS = [
  { id: "schools", label: "בתי ספר" },
  { id: "users", label: "אנשי הארגון" },
];

// 'משימות' tab (ניהול → משימות) — thin container with 2 sub-tabs: school-targeted tasks
// (existing, AdminSchoolTasksTab.jsx) and person-targeted tasks (new, AdminPersonTasksTab.jsx).
// Each sub-tab owns its own data/table/creation-wizard entry point independently.
export default function AdminTasksTab() {
  // ?subtab= (alongside AdminPage.jsx's own ?tab=tasks) — a page refresh must land back on
  // whichever of "בתי ספר"/"אנשי הארגון" was open, same principle as ProfilePage.jsx's tabs.
  const [searchParams, setSearchParams] = useSearchParams();
  const subTabParam = searchParams.get("subtab");
  const subTab = SUB_TAB_IDS.includes(subTabParam) ? subTabParam : "schools";
  function setSubTab(id) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("subtab", id);
      return p;
    });
  }

  return (
    <div dir="rtl">
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              subTab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "schools" ? <AdminSchoolTasksTab /> : <AdminPersonTasksTab />}
    </div>
  );
}
