// Unified column definition — same keys for both tables (backend normalizes)
const UNIFIED_COLS = [
  { key: "קוד דיווח",    label: "קוד דיווח"    },
  { key: "שם ספק",       label: "שם ספק"        },
  { key: "מספר אסמכתה",  label: "מספר אסמכתה"  },
  { key: "תאריך",        label: "תאריך"         },
  { key: "סכום",         label: "סכום פריט"     },
  { key: "תיאור",        label: "תיאור"         },
];

const STAGE_LABELS = {
  tikkon:   "תיכון",
  beinayim: "יסודי/חטיבה",
  both:     "תיכון + יסודי/חטיבה",
};

// ---------------------------------------------------------------------------
// Summary section components
// ---------------------------------------------------------------------------

function InfoGrid({ rows }) {
  return (
    <dl className="text-sm leading-relaxed" style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: "6px", columnGap: "10px" }}>
      {rows.filter(r => r.value != null).map(({ label, value, highlight }) => (
        <>
          <dt key={label + "_l"} className="text-slate-400 text-right whitespace-nowrap">{label}:</dt>
          <dd key={label + "_v"} className={highlight ? "font-700 text-slate-700" : "text-slate-600"} style={highlight ? { fontWeight: 700 } : {}}>{value}</dd>
        </>
      ))}
    </dl>
  );
}

function SummaryBlock({ title, children, index = 0 }) {
  return (
    <div
      className="anim-fade-up glass-card-dark rounded-2xl overflow-hidden"
      style={{ animationDelay: `${index * 0.06}s` }}
    >
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-xs font-700 text-slate-500 tracking-wide" style={{ fontWeight: 700 }}>
          {title}
        </h3>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </div>
  );
}

function GefenFileCard({ file }) {
  return (
    <div className="flex flex-col gap-2">
      <InfoGrid rows={[
        { label: "שם קובץ",        value: file.filename },
        { label: "שלב",             value: STAGE_LABELS[file.division] ?? file.division },
        { label: "אסמכתאות שזוהו", value: file.rows },
      ]} />
      {file.was_deduplicated && (
        <p className="text-xs text-amber-600">כפילות שורות זוהתה בקובץ זה ונוטרלה אוטומטית</p>
      )}
    </div>
  );
}

function GefenFilesDetail({ gefen_files, gefen_rows, gefen_merge_note }) {
  const hasMerge = gefen_files.length === 2 && gefen_merge_note;
  const { overlap, unique, file0_rows, file1_rows } = gefen_merge_note ?? {};

  let mergeNote = null;
  if (hasMerge) {
    const totalRaw = file0_rows + file1_rows;
    if (overlap === file1_rows) {
      mergeNote = `כלל האסמכתאות ב-${gefen_files[1].filename} קיימות גם ב-${gefen_files[0].filename}.`;
    } else if (overlap === file0_rows) {
      mergeNote = `כלל האסמכתאות ב-${gefen_files[0].filename} קיימות גם ב-${gefen_files[1].filename}.`;
    } else if (overlap > 0) {
      mergeNote = `${overlap} שורות מופיעות בשני הקבצים (מתוך ${totalRaw} סה"כ).`;
    }
  }

  const singleFileDedup = gefen_files.length === 1 && gefen_files[0]?.was_deduplicated;

  return (
    <div>
      {/* File cards — side by side if 2 files, vertical if 1 */}
      {gefen_files.length === 2 ? (
        <div className="flex items-start gap-0">
          <div className="flex-1 px-2">
            <GefenFileCard file={gefen_files[0]} />
          </div>
          <div className="w-px self-stretch bg-slate-100 mx-3" />
          <div className="flex-1 px-2">
            <GefenFileCard file={gefen_files[1]} />
          </div>
        </div>
      ) : (
        <div className="px-2">
          {(gefen_files ?? []).map((f, i) => <GefenFileCard key={i} file={f} />)}
        </div>
      )}

      {/* Findings row */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-1">
        {mergeNote && (
          <p className="text-xs text-slate-500">{mergeNote}</p>
        )}
        {singleFileDedup && (
          <p className="text-xs text-slate-500">
            קובץ הגפן הכיל כפילות של כלל השורות — נוטרלה אוטומטית.
          </p>
        )}
        <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
          {`סה"כ ${gefen_rows} אסמכתאות ייחודיות`}
        </p>
      </div>
    </div>
  );
}

function SummarySection({ summary }) {
  const { division, gefen_files, finance_file } = summary;
  const stageLabel  = STAGE_LABELS[division] ?? division;
  const filtered    = summary.finance_rows_total !== summary.finance_rows_checked;
  const software    = finance_file?.software ?? "כספים";

  // Gefen coverage label — derived from the detected overall division
  const gefenLabel  = STAGE_LABELS[division] ?? division;
  const financeDesc = filtered ? `${software} עבור ${STAGE_LABELS["both"]}` : `${software} עבור ${stageLabel}`;

  return (
    <div className="flex flex-col gap-3">

      {/* Block 1: Gefen files */}
      <SummaryBlock title="קבצי גפן" index={0}>
        <GefenFilesDetail
          gefen_files={gefen_files ?? []}
          gefen_rows={summary.gefen_rows}
          gefen_merge_note={summary.gefen_merge_note}
        />
      </SummaryBlock>

      {/* Block 2: Finance file */}
      <SummaryBlock title="קבצים מתוכנת הכספים" index={1}>
        <div className="px-2 flex flex-col gap-2">
          <InfoGrid rows={[
            { label: "שם קובץ",              value: finance_file?.filename },
            { label: "סוג תוכנה",             value: finance_file?.software },
            { label: "שלב",                   value: stageLabel },
            { label: "אסמכתאות שזוהו",       value: summary.finance_rows_total + (finance_file?.cancelled_rows ?? 0) },
            { label: "אסמכתאות מבוטלות",     value: finance_file?.cancelled_rows ?? null },
          ]} />
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-1">
            {filtered && (
              <p className="text-xs text-slate-500">
                {`מתוך ${summary.finance_rows_total} שורות כספים, ${summary.finance_rows_checked} שייכות לשלב שנבדק.`}
              </p>
            )}
            <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
              {`סה"כ ${summary.finance_rows_checked} אסמכתאות ייחודיות`}
            </p>
          </div>
        </div>
      </SummaryBlock>

      {/* Block 3: Conclusion */}
      <SummaryBlock title="מסקנה ותהליך הבדיקה" index={2}>
        <div className="px-2 flex flex-col gap-2">
          <InfoGrid rows={[
            { label: "גפן",          value: (gefen_files ?? []).length === 1 ? `הועלה קובץ דיווח ביצוע עבור ${gefenLabel}` : `הועלו קבצי דיווח ביצוע עבור ${gefenLabel}` },
            { label: "תוכנת כספים", value: `הועלה קובץ ${software} עבור ${filtered ? STAGE_LABELS["both"] : stageLabel}` },
          ]} />
          <div className="pt-3 border-t border-slate-100">
            <p className="text-sm font-700 text-slate-700" style={{ fontWeight: 700 }}>
              {filtered ? `לכן הבדיקה בוצעה עבור ${stageLabel} בלבד.` : `לכן הבדיקה בוצעה עבור ${stageLabel}.`}
            </p>
          </div>
        </div>
      </SummaryBlock>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Result table
// ---------------------------------------------------------------------------

function CountBadge({ count }) {
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
        <h3 className="text-sm font-700 text-slate-700 text-right" style={{ fontWeight: 700 }}>
          {title}
        </h3>
        <CountBadge count={rows.length} />
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center gap-2 py-10">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="#16a34a" fillOpacity="0.15"/>
            <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm font-700" style={{ fontWeight: 700, color: "#15803d" }}>אין פערים</span>
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

// ---------------------------------------------------------------------------
// Division banner
// ---------------------------------------------------------------------------

const DIVISION_LABELS = {
  tikkon:   "חטיבה עליונה בלבד",
  beinayim: "יסודי/חטיבה בלבד",
  both:     "יסודי/חטיבה + חטיבה עליונה",
};

function DivisionBanner({ summary }) {
  const { division, finance_rows_total, finance_rows_checked } = summary;
  const label    = DIVISION_LABELS[division] ?? division;
  const filtered = finance_rows_total !== finance_rows_checked;

  return (
    <div
      className="anim-fade-up glass-card-dark rounded-2xl px-5 py-3.5 flex items-center justify-center flex-wrap gap-2"
      style={{ animationDelay: "0s" }}
    >
      <span className="text-sm text-slate-500">
        הבדיקה בוצעה עבור:{" "}
        <span className="font-700 text-slate-700" style={{ fontWeight: 700 }}>{label}</span>
      </span>
      {filtered && (
        <span className="text-xs text-slate-400">
          {finance_rows_checked} מתוך {finance_rows_total} שורות כספים נבדקו
          <span className="mx-1">·</span>
          {finance_rows_total - finance_rows_checked} שורות{" "}
          {division === "tikkon" ? "יסודי/חטיבה" : "חטיבה עליונה"} הוצאו
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function ResultsView({ result, downloadSlot }) {
  const financeRows = result.rows_finance_not_gefen ?? [];
  const gefenRows   = result.rows_gefen_not_finance ?? [];
  const { summary } = result;

  return (
    <div className="flex flex-col gap-5">
      <DivisionBanner summary={summary} />

      <ResultTable
        title={`קיים ב${summary.finance_file?.software ?? "תוכנת הכספים"}, לא משויך בגפן`}
        rows={financeRows}
        columns={UNIFIED_COLS}
        index={1}
      />
      <ResultTable
        title={`משויך בגפן, לא קיים ב${summary.finance_file?.software ?? "תוכנת הכספים"}`}
        rows={gefenRows}
        columns={UNIFIED_COLS}
        index={2}
      />

      {/* Download buttons — right after the tables */}
      {downloadSlot}

      {/* Separator + heading before detail blocks */}
      <div className="mt-10 text-center">
        <h2 className="text-base font-800 text-slate-400" style={{ fontWeight: 800, letterSpacing: "0.04em" }}>
          תהליך הבדיקה וממצאים
        </h2>
      </div>

      <SummarySection summary={summary} />
    </div>
  );
}
