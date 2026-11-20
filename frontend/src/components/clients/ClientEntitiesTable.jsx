import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { supabase } from "../../lib/supabase";
import { AcademicYearSelector } from "../AcademicYearSelector";
import { useRowVirtualizer } from "../../hooks/useRowVirtualizer";
import { VirtualRows } from "../common/VirtualRows";
import {
  ColumnHeaderFilter, buildRowComparator, dateToNum, describeColumnFilter, fmtInt,
  formatDDMMYY, formatMeetingHours, numToISO, passesAllColumnFilters,
} from "../table/columnFilters";
import { ENTITY_TYPE_LABELS } from "../../constants/clientEntities";
import { SegmentedControl } from "../common/SegmentedControl";

// Home screen "סוג לקוח: מחוזות / בעלויות" table — same search / header filter / multi-sort /
// drag-to-reorder / virtualization as the schools table (shared columnFilters module), over
// GET /clients. Default view = the org's clients (+ any with meetings this year); the whole
// catalog (8 districts / the directory's ownerships) loads only on request.

const NAME_META = { key: "name", label: "שם", fmt: "text" };

const COLUMNS = [
  { key: "is_client", label: "לקוח של הארגון", fmt: "text" },
  { key: "contacts", label: "אנשי קשר", fmt: "textMulti" },
  { key: "our_school_count", label: "בתי ספר לקוחות שלנו", fmt: "int" },
  { key: "directory_school_count", label: "בתי ספר במאגר", fmt: "int", types: ["ownership"] },
  { key: "meetings_done_total", label: 'סה"כ פגישות שבוצעו', fmt: "int" },
  { key: "minutes_total", label: 'סה"כ שעות שבוצעו', fmt: "hours" },
  { key: "meetings_done_gefen", label: "פגישות שבוצעו [גפן]", fmt: "int" },
  { key: "minutes_gefen", label: "שעות שבוצעו [גפן]", fmt: "hours" },
  { key: "meetings_done_current", label: "פגישות שבוצעו [שוטף]", fmt: "int" },
  { key: "minutes_current", label: "שעות שבוצעו [שוטף]", fmt: "hours" },
  { key: "last_meeting_date", label: "פגישה אחרונה", fmt: "date" },
  { key: "next_meeting_date", label: "פגישה הבאה", fmt: "date" },
];
const DEFAULT_VISIBLE = [
  "is_client", "contacts", "our_school_count", "directory_school_count",
  "meetings_done_total", "minutes_total", "last_meeting_date", "next_meeting_date",
];

function columnsFor(type) {
  return COLUMNS.filter(c => !c.types || c.types.includes(type));
}

function contactText(c) {
  return c.role ? `${c.name} (${c.role})` : c.name;
}

function filterValuesFor(r) {
  return {
    name: r.label || null,
    is_client: r.is_client ? "לקוח" : "לא מסומן",
    contacts: (r.contacts || []).map(contactText),
    our_school_count: r.our_school_count ?? 0,
    directory_school_count: r.directory_school_count ?? null,
    meetings_done_total: r.meetings_done_total ?? 0,
    minutes_total: r.minutes_total ?? 0,
    meetings_done_gefen: r.meetings_done_gefen ?? 0,
    minutes_gefen: r.minutes_gefen ?? 0,
    meetings_done_current: r.meetings_done_current ?? 0,
    minutes_current: r.minutes_current ?? 0,
    last_meeting_date: dateToNum(r.last_meeting_date),
    next_meeting_date: dateToNum(r.next_meeting_date),
  };
}

function renderCell(row, col) {
  const v = row.filterValues[col.key];
  if (col.key === "is_client") {
    return row.data.is_client
      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">לקוח</span>
      : <span className="text-xs text-slate-400">לא מסומן</span>;
  }
  if (col.fmt === "textMulti") return v.length ? <span className="whitespace-pre-line">{v.join("\n")}</span> : "—";
  if (col.fmt === "hours") return formatMeetingHours(v);
  if (col.fmt === "date") return v ? formatDDMMYY(numToISO(v)) : "—";
  if (col.fmt === "int") return v === 0 ? "0" : fmtInt(v);
  return v || "—";
}

const ClientRow = memo(function ClientRow({ row, visibleCols, onOpen, opening }) {
  return (
    <tr
      className={`group border-b border-slate-100 transition-colors hover:bg-slate-50 ${opening ? "cursor-wait opacity-60" : "cursor-pointer"}`}
      onClick={() => onOpen(row.data)}
      role="button"
      tabIndex={0}
      aria-label={`פתח כרטיס ${row.data.label}`}
      onKeyDown={e => e.key === "Enter" && onOpen(row.data)}
    >
      <td className="px-5 py-3 border-l border-slate-100 bg-white group-hover:bg-slate-50" style={{ position: "sticky", right: 0, zIndex: 5 }}>
        <span className="font-semibold text-slate-900">{row.data.label}</span>
      </td>
      {visibleCols.map((col, i) => (
        <td key={col.key} className={`px-5 py-3 text-slate-600${i < visibleCols.length - 1 ? " border-l border-slate-100" : ""}`}>
          {renderCell(row, col)}
        </td>
      ))}
    </tr>
  );
});

export default function ClientEntitiesTable({ type, userId, academicYear, onAcademicYearChange }) {
  const navigate = useNavigate();
  const labels = ENTITY_TYPE_LABELS[type];
  const typeColumns = useMemo(() => columnsFor(type), [type]);
  const filterMeta = useMemo(() => [NAME_META, ...typeColumns], [typeColumns]);

  const [scope, setScope] = useState("clients");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState({});
  const [sortSpecs, setSortSpecs] = useState([]);
  const [openFilterKey, setOpenFilterKey] = useState(null);
  const [colOrder, setColOrder] = useState(() => typeColumns.map(c => c.key));
  const [colVisible, setColVisible] = useState(() => DEFAULT_VISIBLE.filter(k => typeColumns.some(c => c.key === k)));
  const [showColPicker, setShowColPicker] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [openingKey, setOpeningKey] = useState(null);
  const colPickerRef = useRef(null);
  const allPrefsRef = useRef({});

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/clients/", { signal, params: { type, scope, academic_year: academicYear } });
      setData(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      if (axios.isCancel?.(e) || e?.name === "CanceledError") return;
      setError(`שגיאה בטעינת ${labels.plural} — נסה שוב`);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [type, scope, academicYear, labels.plural]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Column order / visibility per type, saved on profiles.client_tables_prefs.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase.from("profiles").select("client_tables_prefs").eq("id", userId).single().then(({ data: prof }) => {
      if (cancelled) return;
      const all = prof?.client_tables_prefs || {};
      allPrefsRef.current = all;
      const p = all[type];
      const known = new Set(typeColumns.map(c => c.key));
      if (Array.isArray(p?.order)) {
        const order = p.order.filter(k => known.has(k));
        setColOrder([...order, ...typeColumns.map(c => c.key).filter(k => !order.includes(k))]);
      }
      if (Array.isArray(p?.visible)) setColVisible(p.visible.filter(k => known.has(k)));
    });
    return () => { cancelled = true; };
  }, [userId, type, typeColumns]);

  function savePrefs(order, visible) {
    if (!userId) return;
    const next = { ...allPrefsRef.current, [type]: { order, visible } };
    allPrefsRef.current = next;
    supabase.from("profiles").update({ client_tables_prefs: next }).eq("id", userId).then(() => {});
  }

  useEffect(() => {
    if (!showColPicker) return;
    function onDown(e) { if (!colPickerRef.current?.contains(e.target)) setShowColPicker(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showColPicker]);

  const baseRows = useMemo(() => data.map(r => ({ data: r, filterValues: filterValuesFor(r) })), [data]);

  const searchedRows = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return baseRows;
    return baseRows.filter(r =>
      (r.data.label || "").includes(q) || r.filterValues.contacts.some(c => c.includes(q))
    );
  }, [baseRows, searchQuery]);

  // Default order: clients first, then by name.
  const finalRows = useMemo(() => {
    const rows = searchedRows.filter(r => passesAllColumnFilters(r, columnFilters, filterMeta));
    if (sortSpecs.length) return [...rows].sort(buildRowComparator(sortSpecs, filterMeta));
    return [...rows].sort((a, b) =>
      (b.data.is_client - a.data.is_client) || (b.data.our_school_count - a.data.our_school_count)
      || a.data.label.localeCompare(b.data.label, "he"));
  }, [searchedRows, columnFilters, sortSpecs, filterMeta]);

  const visibleCols = useMemo(
    () => colOrder.filter(k => colVisible.includes(k)).map(k => typeColumns.find(c => c.key === k)).filter(Boolean),
    [colOrder, colVisible, typeColumns],
  );

  const valueFilterOptions = useMemo(() => {
    const out = {};
    for (const key of Object.keys(columnFilters)) {
      const vals = new Set();
      for (const r of baseRows) {
        const v = r.filterValues[key];
        for (const x of Array.isArray(v) ? v : [v]) vals.add(x === null || x === undefined || x === "" ? "__BLANK__" : String(x));
      }
      out[key] = [...vals];
    }
    return out;
  }, [columnFilters, baseRows]);

  const { scrollRef, virtualizer, items, padTop, padBottom } = useRowVirtualizer(finalRows, {
    estimateSize: 52, getItemKey: r => r.data.key,
  });

  async function openCard(row) {
    if (openingKey) return;
    if (row.id) { navigate(`/client/${row.id}`); return; }
    setOpeningKey(row.key);
    try {
      const res = await axios.post("/clients/adopt", { type, key: row.key });
      navigate(`/client/${res.data.id}`);
    } catch {
      setError("לא הצלחנו לפתוח את הכרטיס — נסה שוב");
      setOpeningKey(null);
    }
  }

  function toggleColumn(key) {
    const next = colVisible.includes(key) ? colVisible.filter(k => k !== key) : [...colVisible, key];
    setColVisible(next);
    savePrefs(colOrder, next);
  }

  function dropOn(targetKey) {
    if (!dragKey || dragKey === targetKey) return;
    const order = colOrder.filter(k => k !== dragKey);
    order.splice(order.indexOf(targetKey), 0, dragKey);
    setColOrder(order);
    savePrefs(order, colVisible);
  }

  const hasFilter = !!searchQuery.trim() || Object.keys(columnFilters).length > 0;
  function clearAll() { setSearchQuery(""); setColumnFilters({}); }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <input
            type="search"
            id={`client-search-${type}`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`חיפוש לפי שם ${labels.singular} או איש קשר...`}
            className="input-field pl-12"
            aria-label={`חיפוש ${labels.plural}`}
          />
        </div>

        <SegmentedControl ariaLabel="היקף הרשימה" value={scope} onChange={setScope}
          options={[{ value: "clients", label: "הלקוחות שלנו" }, { value: "all", label: labels.allLabel }]} />

        <div className="relative" ref={colPickerRef}>
          <button type="button" onClick={() => setShowColPicker(o => !o)} aria-expanded={showColPicker}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl transition-all font-medium btn-ghost">
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" />
            </svg>
            עמודות לתצוגה
          </button>
          {showColPicker && (
            <div className="absolute left-0 top-full mt-1.5 z-20 glass-card rounded-xl py-1 shadow-lg" style={{ minWidth: 220 }} dir="rtl">
              {typeColumns.map(c => (
                <label key={c.key} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-blue-50 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={colVisible.includes(c.key)} onChange={() => toggleColumn(c.key)}
                    className="w-3.5 h-3.5 rounded accent-blue-600" />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <AcademicYearSelector value={academicYear} onChange={onAcademicYearChange} />
      </div>

      {loading && (
        <div role="status" aria-label={`טוען ${labels.plural}`} className="flex justify-center py-20">
          <div aria-hidden="true" className="spinner w-10 h-10" />
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button type="button" onClick={() => load()} className="btn-blue text-sm px-4 py-2">רענן</button>
        </div>
      )}

      {!loading && !error && (
        <>
          <p className="text-sm text-slate-500 mb-2">
            {hasFilter ? `מוצגים ${finalRows.length} מתוך ${data.length}` : `סה"כ ${data.length} ${labels.plural}`}
          </p>

          {hasFilter && (
            <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-blue-50 border border-blue-100 text-sm" role="group" aria-label="סינונים פעילים בטבלה">
              <span className="font-medium text-blue-800">סינונים פעילים:</span>
              {!!searchQuery.trim() && (
                <span className="inline-flex items-center gap-1 pl-1 pr-2.5 py-0.5 rounded-full bg-white border border-blue-200 text-blue-800">
                  חיפוש: "{searchQuery.trim()}"
                  <button type="button" onClick={() => setSearchQuery("")} className="w-5 h-5 rounded-full hover:bg-blue-100 leading-none" aria-label="הסר סינון: חיפוש">✕</button>
                </span>
              )}
              {Object.entries(columnFilters).map(([key, spec]) => {
                const meta = filterMeta.find(c => c.key === key);
                const summary = describeColumnFilter(spec, meta?.fmt, valueFilterOptions[key]);
                return (
                  <span key={key} className="inline-flex items-center gap-1 pl-1 pr-2.5 py-0.5 rounded-full bg-white border border-blue-200 text-blue-800">
                    <span><span className="font-medium">{meta?.label || key}</span>{summary && `: ${summary}`}</span>
                    <button type="button" onClick={() => setColumnFilters(prev => { const n = { ...prev }; delete n[key]; return n; })}
                      className="w-5 h-5 rounded-full hover:bg-blue-100 leading-none" aria-label={`הסר סינון: ${meta?.label || key}`}>✕</button>
                  </span>
                );
              })}
              <button type="button" onClick={clearAll} className="mr-auto text-blue-700 underline hover:text-blue-900">נקה סינון</button>
            </div>
          )}

          <div className="glass-card rounded-2xl overflow-hidden relative">
            {finalRows.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-slate-500">
                  {hasFilter
                    ? "לא נמצאו תוצאות התואמות לסינון"
                    : scope === "clients"
                    ? `עדיין אין ${labels.plural} שמסומנים כלקוחות של הארגון`
                    : `לא נמצאו ${labels.plural}`}
                </p>
                {!hasFilter && scope === "clients" && (
                  <button type="button" onClick={() => setScope("all")} className="btn-ghost text-sm px-4 py-2 mt-3">
                    הצג את {labels.allLabel}
                  </button>
                )}
                {hasFilter && <button type="button" onClick={clearAll} className="btn-ghost text-sm px-4 py-2 mt-3">נקה סינון</button>}
              </div>
            ) : (
              <div ref={scrollRef} className="overflow-auto dash-scroll-x max-h-[70vh]">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200"
                      style={{ position: "sticky", top: 0, background: "rgba(241,245,249,0.97)", zIndex: 10, backdropFilter: "blur(8px)" }}>
                      <th scope="col" className="text-right px-5 py-3 text-slate-900 font-semibold border-l border-slate-200"
                        style={{ position: "sticky", right: 0, zIndex: 11, background: "rgba(241,245,249,0.97)" }}>
                        <div className="flex items-center justify-between gap-1">
                          <span>{labels.singular}</span>
                          <ColumnHeaderFilter colDef={NAME_META} columnFilters={columnFilters} setColumnFilters={setColumnFilters}
                            sortSpecs={sortSpecs} setSortSpecs={setSortSpecs} openKey={openFilterKey} setOpenKey={setOpenFilterKey}
                            baseDisplayRows={searchedRows} allFilterMeta={filterMeta} />
                        </div>
                      </th>
                      {visibleCols.map((col, i) => (
                        <th key={col.key} scope="col" draggable title="גרור לשינוי סדר"
                          onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setDragKey(col.key); }}
                          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                          onDrop={e => { e.preventDefault(); dropOn(col.key); setDragKey(null); }}
                          onDragEnd={() => setDragKey(null)}
                          className={`text-right px-4 py-3 font-semibold select-none cursor-grab active:cursor-grabbing text-slate-900${i < visibleCols.length - 1 ? " border-l border-slate-200" : ""}${dragKey === col.key ? " opacity-30" : ""}`}>
                          <div className="flex items-center justify-between gap-1">
                            <span>{col.label}</span>
                            <ColumnHeaderFilter colDef={col} columnFilters={columnFilters} setColumnFilters={setColumnFilters}
                              sortSpecs={sortSpecs} setSortSpecs={setSortSpecs} openKey={openFilterKey} setOpenKey={setOpenFilterKey}
                              baseDisplayRows={searchedRows} allFilterMeta={filterMeta} />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <VirtualRows items={items} padTop={padTop} padBottom={padBottom} colSpan={visibleCols.length + 1}
                    measureElement={virtualizer.measureElement} rows={finalRows} rowKey={r => r.data.key}>
                    {row => <ClientRow row={row} visibleCols={visibleCols} onOpen={openCard} opening={openingKey === row.data.key} />}
                  </VirtualRows>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
