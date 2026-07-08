import { useEffect, useMemo, useState } from "react";
import axios from "axios";

function formatGoalDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y.slice(2)}`;
}

function fmtPct(v, decimals = 2) {
  if (v == null) return "—";
  return (Number(v) * 100).toFixed(decimals) + "%";
}

export function GoalsTab({ accounts, schoolId, schoolStage, activeSubTab, academicYear, logs }) {
  const isSheshsSnati = schoolStage === "sheshshnati";
  const division = isSheshsSnati ? activeSubTab : schoolStage;

  // Same division-filtering logic as ChecksTab, so the budget list here matches what "בדיקות" shows.
  const filteredLogs = useMemo(() => {
    if (!isSheshsSnati) return logs || [];
    return (logs || []).filter(log => {
      if (!log.gefen_account_id) {
        const div = log.summary?.division;
        if (div === "tikkon") return activeSubTab === "tikkon";
        if (div === "beinayim") return activeSubTab === "beinayim";
        return activeSubTab === "tikkon";
      }
      const acc = accounts.find(a => a.id === log.gefen_account_id);
      return activeSubTab === "tikkon"
        ? acc?.division_type === "tikkon"
        : acc?.division_type === "beinayim";
    });
  }, [logs, accounts, isSheshsSnati, activeSubTab]);

  const budgets = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const log of filteredLogs) {
      const bs = log.summary?.tikhnun_result?.budgets;
      if (Array.isArray(bs)) {
        for (const b of bs) {
          if (b.name && !seen.has(b.name)) {
            seen.add(b.name);
            result.push(b.name);
          }
        }
      }
    }
    return result;
  }, [filteredLogs]);

  // Defaults to "גפן" (the same app-wide default used everywhere else — DashboardPage's
  // activeSummaryBudget, DEFAULT_BUDGET_TYPES) instead of "" — an empty budget_name here
  // silently diverged from what every other screen assumes for a school with no real
  // check/budget history yet, which made the dashboard's goal columns unable to find a
  // status saved from this tab for such schools.
  const [selectedBudget, setSelectedBudget] = useState("גפן");
  const [goals, setGoals] = useState([]);
  const [importantDates, setImportantDates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState(null);

  // filteredLogs is ordered newest-first (same assumption ChecksTab/CompareChecksModal rely on) —
  // find the latest log that has tikhnun data for the currently selected budget.
  const latestBudgetOverview = useMemo(() => {
    for (const log of filteredLogs) {
      const bs = log.summary?.tikhnun_result?.budgets;
      const match = Array.isArray(bs) ? bs.find(b => b.name === selectedBudget) : null;
      if (match?.overview) return match.overview;
    }
    return null;
  }, [filteredLogs, selectedBudget]);

  useEffect(() => {
    if (budgets.length > 0 && !budgets.includes(selectedBudget)) {
      setSelectedBudget(budgets[0]);
    } else if (budgets.length === 0 && selectedBudget !== "גפן") {
      setSelectedBudget("גפן");
    }
  }, [budgets, selectedBudget]);

  useEffect(() => {
    if (!division || !academicYear) { setGoals([]); setImportantDates([]); return; }
    setLoading(true);
    setError("");
    axios.get(`/schools/${schoolId}/goals`, {
      params: { division_type: division, budget_name: selectedBudget, academic_year: academicYear },
    })
      .then(r => {
        setGoals(r.data?.goals || []);
        setImportantDates(r.data?.important_dates || []);
      })
      .catch(() => setError("שגיאה בטעינת היעדים"))
      .finally(() => setLoading(false));
  }, [schoolId, division, academicYear, selectedBudget]);

  async function toggleMet(goal, met) {
    if (!division) return;
    const nextMet = goal.met === met ? null : met;
    setSavingKey(goal.key);
    setGoals(prev => prev.map(g => g.key === goal.key ? { ...g, met: nextMet } : g));
    try {
      await axios.patch(`/schools/${schoolId}/goals`, {
        division_type: division,
        budget_name: selectedBudget,
        goal_key: goal.key,
        academic_year: academicYear,
        met: nextMet,
      });
    } catch {
      setGoals(prev => prev.map(g => g.key === goal.key ? { ...g, met: goal.met } : g));
      setError("שגיאה בשמירת הסטטוס");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div dir="rtl" className="flex flex-col">
      <h2 className="text-lg font-bold text-slate-900 mb-4">יעדים</h2>

      {budgets.length > 1 && (
        <div className="flex items-end border-b border-slate-200 mb-4 gap-1 flex-shrink-0">
          {budgets.map(bname => (
            <button
              key={bname}
              type="button"
              onClick={() => setSelectedBudget(bname)}
              className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
                selectedBudget === bname
                  ? "border-blue-600 text-blue-600 font-semibold"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
              }`}
            >
              {bname}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}

      {loading ? (
        <div role="status" aria-label="טוען יעדים" className="flex justify-center py-10">
          <div aria-hidden="true" className="spinner w-7 h-7" />
        </div>
      ) : (
        <>
          <div className="glass-card rounded-2xl overflow-hidden border border-slate-200">
            <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th scope="col" className="py-3 px-2 pr-3 text-xs font-semibold text-slate-500 whitespace-nowrap">תאריך יעד</th>
                    <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">סוג</th>
                    <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">יעד</th>
                    <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">מצב נוכחי</th>
                    <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap">עמידה ביעד</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                        אין יעדים להצגה עבור חטיבה זו
                      </td>
                    </tr>
                  ) : goals.map(goal => {
                    const noClass = goal.met === false ? "bg-red-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
                    const yesClass = goal.met === true ? "bg-green-500 text-white" : "bg-white text-slate-400 hover:bg-slate-50";
                    const currentStatus = goal.goal_type === "planning"
                      ? fmtPct(latestBudgetOverview?.pct_plan)
                      : fmtPct(latestBudgetOverview?.pct_tanuz);
                    return (
                      <tr key={goal.key} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                        <td className="py-2.5 px-2 pr-3 text-sm text-slate-700 tabular-nums whitespace-nowrap">{formatGoalDate(goal.target_date)}</td>
                        <td className="py-2.5 px-2 text-sm text-slate-700 whitespace-nowrap">{goal.goal_type === "planning" ? "תכנון" : "דיווח"}</td>
                        <td className="py-2.5 px-2 text-sm text-slate-700 tabular-nums">{goal.goal_number}</td>
                        <td className="py-2.5 px-2 text-sm text-slate-700 tabular-nums">{currentStatus}</td>
                        <td className="py-2.5 px-2">
                          <div
                            role="group"
                            aria-label={`עמידה ביעד: ${goal.goal_type === "planning" ? "תכנון" : "דיווח"} ${goal.goal_number}`}
                            className={`inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold flex-shrink-0 ${savingKey === goal.key ? "opacity-50 pointer-events-none" : ""}`}
                            style={{ direction: "ltr" }}
                          >
                            <button
                              type="button"
                              onClick={() => toggleMet(goal, false)}
                              aria-pressed={goal.met === false}
                              className={`px-3 py-1.5 transition-colors focus:outline-none ${noClass}`}
                            >לא</button>
                            <button
                              type="button"
                              onClick={() => toggleMet(goal, true)}
                              aria-pressed={goal.met === true}
                              className={`px-3 py-1.5 border-r border-slate-200 transition-colors focus:outline-none ${yesClass}`}
                            >כן</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          </div>

          <div className="mt-32">
            <h2 className="text-lg font-bold text-slate-900 mb-4">תאריכים חשובים</h2>
            <div className="glass-card rounded-2xl overflow-hidden border border-slate-200">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th scope="col" className="py-3 px-2 pr-3 text-xs font-semibold text-slate-500 whitespace-nowrap">תאריך</th>
                    <th scope="col" className="py-3 px-2 text-xs font-semibold text-slate-500">מהות</th>
                  </tr>
                </thead>
                <tbody>
                  {importantDates.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-12 text-center text-sm text-slate-400">
                        אין תאריכים חשובים להצגה עבור חטיבה זו
                      </td>
                    </tr>
                  ) : importantDates.map(d => (
                    <tr key={d.label} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 px-2 pr-3 text-sm text-slate-700 tabular-nums whitespace-nowrap">{formatGoalDate(d.target_date)}</td>
                      <td className="py-2.5 px-2 text-sm text-slate-700">{d.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
