// Column keys to display per result type
const FINANCE_COLS = [
  { key: "קוד דיווח",      label: "קוד דיווח" },
  { key: "שם ספק",          label: "שם ספק" },
  { key: "מספר חשבונית",    label: "מספר חשבונית" },
  { key: "תאריך חשבונית",   label: "תאריך" },
  { key: "סכום",             label: "סכום" },
  { key: "תיאור",            label: "תיאור" },
];

const GEFEN_COLS = [
  { key: "report_code",      label: "קוד דיווח" },
  { key: "קוד ושם ספק",     label: "קוד ושם ספק" },
  { key: "מספר חשבונית",    label: "מספר חשבונית" },
  { key: "תאריך חשבונית",   label: "תאריך חשבונית" },
  { key: "סכום פריט",       label: "סכום פריט" },
  { key: "מהות ההוצאה",     label: "מהות ההוצאה" },
];

function CountBadge({ count, type }) {
  const isZero = count === 0;
  return (
    <span
      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-700"
      style={{
        fontWeight: 700,
        background: isZero ? "#dcfce7" : "#fee2e2",
        color: isZero ? "#15803d" : "#dc2626",
      }}
    >
      {isZero ? "✓" : count}
      {!isZero && " רשומות"}
    </span>
  );
}

function ResultTable({ title, rows, columns, index }) {
  const isEmpty = rows.length === 0;

  return (
    <div
      className="anim-fade-up glass-card-dark rounded-2xl overflow-hidden"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <CountBadge count={rows.length} />
        <h3 className="text-sm font-700 text-slate-700 text-right" style={{ fontWeight: 700 }}>
          {title}
        </h3>
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center gap-2 py-10">
          <div
            className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{ background: "#dcfce7", color: "#15803d" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
              <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-sm font-700" style={{ fontWeight: 700 }}>אין פערים</span>
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm border-collapse" dir="rtl">
            <thead>
              <tr>
                {columns.map(col => (
                  <th
                    key={col.key}
                    className="text-right px-4 py-3 text-white text-xs font-700 whitespace-nowrap sticky top-0 z-10"
                    style={{
                      fontWeight: 700,
                      background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-t border-slate-100 hover:bg-blue-50/40 transition-colors"
                  style={{ background: i % 2 === 0 ? "white" : "rgba(248,250,252,0.7)" }}
                >
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className="px-4 py-2.5 text-right text-slate-700 align-middle"
                      style={{ maxWidth: "200px" }}
                    >
                      <span
                        className="block truncate text-xs"
                        title={row[col.key] || "—"}
                      >
                        {row[col.key] || <span className="text-slate-300">—</span>}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ResultsView({ result }) {
  const financeRows = result.rows_finance_not_gefen ?? [];
  const gefenRows   = result.rows_gefen_not_finance ?? [];
  const { summary } = result;

  return (
    <div className="flex flex-col gap-5">
      {/* Summary bar */}
      <div
        className="glass-card rounded-2xl px-6 py-4 anim-fade-up"
        style={{ animationDelay: "0s" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-2xl font-900" style={{ fontWeight: 900, color: "#0070F3" }}>
                {summary.gefen_rows}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">שורות גפן</p>
            </div>
            <div className="w-px bg-slate-200" />
            <div className="text-center">
              <p className="text-2xl font-900" style={{ fontWeight: 900, color: "#0070F3" }}>
                {summary.finance_rows}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">שורות כספים</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="text-center">
              <p
                className="text-2xl font-900"
                style={{
                  fontWeight: 900,
                  color: summary.in_finance_not_gefen > 0 ? "#dc2626" : "#16a34a",
                }}
              >
                {summary.in_finance_not_gefen}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">לא שויך בגפן</p>
            </div>
            <div className="w-px bg-slate-200" />
            <div className="text-center">
              <p
                className="text-2xl font-900"
                style={{
                  fontWeight: 900,
                  color: summary.in_gefen_not_finance > 0 ? "#dc2626" : "#16a34a",
                }}
              >
                {summary.in_gefen_not_finance}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">חסר בכספים</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tables */}
      <ResultTable
        title="קיים בתוכנת הכספים, לא משויך בגפן"
        rows={financeRows}
        columns={FINANCE_COLS}
        index={1}
      />
      <ResultTable
        title="משויך בגפן, לא מופיע בתוכנת הכספים"
        rows={gefenRows}
        columns={GEFEN_COLS}
        index={2}
      />
    </div>
  );
}
