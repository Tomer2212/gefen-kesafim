import { useEffect, useState } from "react";
import axios from "axios";

// Superadmin "שימוש ומכסות" — backend: routers/platform_usage_router.py.

const KIND_LABEL = {
  task: "משימות",
  reminder: "תזכורות פגישה",
  upload_request: "בקשות קבצים",
  upload_followup: "השלמת קבצים",
  booking: "תיאום ישיר",
  other: "אחר",
};

const MANUAL_STATUS = {
  pending: { label: "ממתינה לביצוע", cls: "bg-red-50 text-red-700 border-red-200" },
  ok: { label: "בוצעה — תקין", cls: "bg-green-50 text-green-700 border-green-200" },
  attention: { label: "בוצעה — דורש תשומת לב", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

const fmt = n => (n == null ? "—" : Number(n).toLocaleString("he-IL"));
const gb = bytes => (bytes == null ? "—" : `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1)}GB`);
const mb = bytes => (bytes == null ? "—" : `${Math.round(bytes / 1024 ** 2).toLocaleString("he-IL")}MB`);
const dateIL = iso => (iso ? new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const dateTimeIL = iso => (iso ? new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function barColor(pct) {
  if (pct >= 85) return "#dc2626";
  if (pct >= 70) return "#d97706";
  return "#16a34a";
}

function Meter({ label, valueText, pct, hint }) {
  const safePct = Number.isFinite(pct) ? pct : 0;
  const clamped = Math.max(0, Math.min(100, safePct));
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm text-slate-600 tabular-nums">{valueText}</span>
      </div>
      <div
        className="h-2.5 rounded-full bg-slate-100 overflow-hidden"
        role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}
      >
        <div className="h-full rounded-full" style={{ width: `${Math.max(clamped, 1)}%`, background: barColor(safePct) }} />
      </div>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5" aria-label={title}>
      <h2 className="text-base font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </section>
  );
}

function ResendCard({ resend }) {
  if (resend.error) return <Card title="מיילים (Resend)"><p role="alert" className="text-sm text-red-600">{resend.error}</p></Card>;
  const projectedPct = resend.limit ? (resend.projected * 100) / resend.limit : 0;
  return (
    <Card title="מיילים (Resend)" subtitle={`מחזור נוכחי: ${dateIL(resend.cycle_start)} עד ${dateIL(resend.renews_on)}`}>
      <Meter
        label="נוצלו במחזור הנוכחי"
        valueText={`${fmt(resend.used)} מתוך ${fmt(resend.limit)} (${resend.pct}%)`}
        pct={resend.pct}
        hint={`המכסה מתחדשת ב-${dateIL(resend.renews_on)} — בעוד ${resend.days_left} ימים`}
      />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">קצב יומי ממוצע</div>
          <div className="font-semibold text-slate-800 tabular-nums">{fmt(resend.daily_rate)} מיילים</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">צפי לסוף המחזור</div>
          <div className="font-semibold tabular-nums" style={{ color: barColor(projectedPct) }}>{fmt(resend.projected)} מיילים</div>
        </div>
      </div>
      {resend.resend_reported == null && (
        <p className="text-xs text-slate-400 mt-3">המספר מבוסס על ספירה פנימית. מהשליחה הבאה יוצג גם המספר המדויק ש-Resend מדווח.</p>
      )}
    </Card>
  );
}

function OrgTable({ resend }) {
  const orgs = resend.orgs || [];
  const total = orgs.reduce((s, o) => s + o.cycle, 0) || 1;
  return (
    <Card title="מיילים לפי ארגון" subtitle="כל המיילים שנשלחו דרך Resend במחזור הנוכחי">
      {orgs.length === 0 ? (
        <p className="text-sm text-slate-400">לא נשלחו מיילים במחזור הזה</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th scope="col" className="text-right font-medium py-2">ארגון</th>
                <th scope="col" className="text-right font-medium py-2">במחזור</th>
                <th scope="col" className="text-right font-medium py-2">היום</th>
                <th scope="col" className="text-right font-medium py-2">7 ימים</th>
                <th scope="col" className="text-right font-medium py-2">מתוך הכל</th>
                <th scope="col" className="text-right font-medium py-2">פירוט</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(o => (
                <tr key={o.org_id || "none"} className="border-b border-slate-50 align-top">
                  <th scope="row" className="text-right font-semibold text-slate-800 py-2">{o.name}</th>
                  <td className="py-2 tabular-nums">{fmt(o.cycle)}</td>
                  <td className="py-2 tabular-nums">{fmt(o.today)}</td>
                  <td className="py-2 tabular-nums">{fmt(o.week)}</td>
                  <td className="py-2 tabular-nums">{Math.round((o.cycle * 100) / total)}%</td>
                  <td className="py-2 text-xs text-slate-500">
                    {Object.entries(o.by_kind || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
                      .map(([k, n]) => `${KIND_LABEL[k] || k}: ${fmt(n)}`).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SupabaseCard({ supabase }) {
  const mem = supabase.memory;
  const reqs = supabase.requests_per_day || [];
  return (
    <Card title="מסד הנתונים (Supabase)" subtitle="נמדד אוטומטית בכל טעינה של המסך">
      {supabase.stats_error ? (
        <p role="alert" className="text-sm text-red-600 mb-4">שגיאה בטעינת נתוני מסד הנתונים</p>
      ) : (
        <>
          <Meter label="גודל מסד הנתונים" valueText={`${gb(supabase.db_bytes)} מתוך 8GB`} pct={(supabase.db_bytes * 100) / supabase.db_limit_bytes} />
          <Meter label="נפח קבצים" valueText={`${gb(supabase.storage_bytes)} מתוך 100GB`} pct={(supabase.storage_bytes * 100) / supabase.storage_limit_bytes} />
          <Meter label="חיבורים פתוחים" valueText={`${fmt(supabase.connections)} מתוך ${fmt(supabase.max_connections)}`} pct={(supabase.connections * 100) / (supabase.max_connections || 1)} />
        </>
      )}
      {mem ? (
        <Meter
          label="זיכרון שרת המסד (מתוך הסף שבו Supabase מתריעים SEVERE)"
          valueText={`${gb(mem.committed_bytes)} מתוך ${gb(mem.severe_at_bytes)} (${mem.commit_pct_of_severe}%)`}
          pct={mem.commit_pct_of_severe}
          hint={`זיכרון פיזי: ${mb(mem.total_bytes)} · Swap בשימוש: ${mb(mem.swap_used_bytes)}${mem.commit_pct_of_severe >= 100 ? " — מעל הסף: סיכון לקריסה, יש לשדרג את ה-Compute" : ""}`}
        />
      ) : (
        <p className="text-xs text-slate-400 mb-4">נתוני הזיכרון לא זמינים כרגע</p>
      )}
      {reqs.length > 0 && (
        <div className="mb-4">
          <div className="text-sm font-medium text-slate-700 mb-1">פניות ביום (מנבא את קצב רישום היומנים)</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {reqs.map(r => (
              <span key={r.date} className="rounded-lg bg-slate-50 px-2 py-1 tabular-nums">
                {dateIL(r.date)}: {fmt(r.total)}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Egress ו-Log Ingestion לא נגישים אוטומטית — נבדקים בבדיקה הידנית השבועית
        (<a className="text-blue-600 underline" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">לוח הבקרה של Supabase</a>).
      </p>
    </Card>
  );
}

function RenderCard({ render }) {
  return (
    <Card title="שרת ואתר (Render)" subtitle="תעבורה מתחילת החודש הקלנדרי">
      {!render.configured ? (
        <p className="text-sm text-slate-500">מוצג רק במחשב המקומי: מפתח של Render נותן שליטה בכל החשבון, ולכן הוא לא נשמר בשרת. Claude בודק את Render בבדיקה השבועית. חריגה בתעבורה רק מחויבת בתשלום, היא לא משביתה את האתר.</p>
      ) : render.bandwidth_error ? (
        <p role="alert" className="text-sm text-red-600">שגיאה בטעינת נתוני Render</p>
      ) : (
        <>
          <Meter
            label="תעבורה החודש"
            valueText={`${render.bandwidth_gb}GB מתוך ${render.included_gb}GB כלולים`}
            pct={(render.bandwidth_gb * 100) / (render.included_gb || 1)}
            hint={`צפי לסוף החודש: ${render.projected_gb}GB · עלות חריגה צפויה: $${render.projected_overage_usd} (חריגה מחויבת בלבד, לא משביתה)`}
          />
          {render.memory_max_7d != null && render.memory_limit_bytes ? (
            <Meter
              label="זיכרון השרת (שיא ב-7 ימים)"
              valueText={`${mb(render.memory_max_7d)} מתוך ${mb(render.memory_limit_bytes)}`}
              pct={(render.memory_max_7d * 100) / render.memory_limit_bytes}
              hint={render.cpu_max_7d != null ? `שיא מעבד ב-7 ימים: ${render.cpu_max_7d.toFixed(2)} ליבות` : undefined}
            />
          ) : (render.cpu_max_7d != null || render.memory_max_7d != null) && (
            <p className="text-xs text-slate-500">
              שיא ב-7 ימים — מעבד: {render.cpu_max_7d != null ? render.cpu_max_7d.toFixed(2) : "—"}
              {render.memory_max_7d != null && ` · זיכרון: ${mb(render.memory_max_7d)}`}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function ManualCheckCard({ checks, currentWeek }) {
  const current = checks.find(c => c.week_start === currentWeek);
  const status = MANUAL_STATUS[current?.status || "pending"];
  return (
    <Card title="בדיקה ידנית שבועית" subtitle="Egress ו-Log Ingestion של Supabase — כל יום א׳">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-slate-600">השבוע ({dateIL(currentWeek)}):</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>
      </div>
      {(!current || current.status === "pending") && (
        <ol className="list-decimal pr-5 text-sm text-slate-700 space-y-1 mb-4">
          <li>להיכנס ל-<a className="text-blue-600 underline" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com</a>.</li>
          <li>ללחוץ בתפריט השמאלי על אייקון הגרף (Usage).</li>
          <li>לצלם את האזור "Usage Summary" (רואים בו Egress ו-Log Ingestion).</li>
          <li>לשלוח את הצילום ל-Claude ב-Claude Code ולכתוב "בדיקה שבועית".</li>
        </ol>
      )}
      {current?.verdict && <p className="text-sm text-slate-700 mb-4 whitespace-pre-line">{current.verdict}</p>}
      {checks.filter(c => c.status !== "pending").length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th scope="col" className="text-right font-medium py-2">שבוע</th>
                <th scope="col" className="text-right font-medium py-2">Egress</th>
                <th scope="col" className="text-right font-medium py-2">Log Ingestion</th>
                <th scope="col" className="text-right font-medium py-2">תוצאה</th>
              </tr>
            </thead>
            <tbody>
              {checks.filter(c => c.status !== "pending").map(c => (
                <tr key={c.id} className="border-b border-slate-50">
                  <th scope="row" className="text-right font-medium text-slate-700 py-2">{dateIL(c.week_start)}</th>
                  <td className="py-2 tabular-nums">{c.values?.egress_gb != null ? `${c.values.egress_gb}GB / 250GB` : "—"}</td>
                  <td className="py-2 tabular-nums">{c.values?.log_ingestion_gb != null ? `${c.values.log_ingestion_gb}GB / 20GB` : "—"}</td>
                  <td className="py-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${MANUAL_STATUS[c.status].cls}`}>{MANUAL_STATUS[c.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SettingsCard({ settings, onSaved }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await axios.put("/platform/settings", {
        resend_monthly_limit: Number(form.resend_monthly_limit),
        resend_cycle_day: Number(form.resend_cycle_day),
        render_included_bandwidth_gb: Number(form.render_included_bandwidth_gb),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(err?.response?.status === 422 ? "יש ערך לא תקין: מכסה לפחות 100, יום חידוש בין 1 ל-28"
        : typeof detail === "string" ? detail : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  const field = (id, label, key, props) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        id={id} type="number" value={form[key] ?? ""} {...props}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
      />
    </div>
  );

  return (
    <Card title="הגדרות מסלולים" subtitle="לעדכן כשמשדרגים מסלול או כשיום החיוב משתנה">
      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        {field("usage-resend-limit", "מכסת Resend בחודש", "resend_monthly_limit", { min: 100 })}
        {field("usage-resend-day", "יום החידוש של Resend בחודש", "resend_cycle_day", { min: 1, max: 28 })}
        {field("usage-render-gb", "תעבורה כלולה ב-Render (GB)", "render_included_bandwidth_gb", { min: 0, step: "any" })}
        <div className="sm:col-span-3 flex items-center gap-3">
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#0070F3" }}>
            {saving ? "שומר..." : "שמור"}
          </button>
          {saved && <span role="status" className="text-xs text-green-600">נשמר</span>}
          {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

export default function PlatformUsagePanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await axios.get("/platform/usage");
      setData(res.data);
      setError("");
    } catch {
      setError("טעינת נתוני השימוש נכשלה. נסה לרענן את הדף.");
    }
  }

  useEffect(() => { load(); }, []);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <div role="status" aria-label="טוען נתוני שימוש" className="flex items-center justify-center py-20">
        <span aria-hidden="true" className="w-8 h-8 border-blue-200 border-t-blue-500 rounded-full inline-block" style={{ animation: "spin 0.8s linear infinite", borderWidth: 3 }} />
      </div>
    );
  }

  const issues = data.last_daily_check_result?.issues || [];
  return (
    <div className="flex flex-col gap-4">
      <div className={`rounded-2xl border p-4 text-sm ${issues.length ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
        <div className="font-semibold text-slate-800">
          בדיקה אוטומטית אחרונה: {data.last_daily_check_at ? dateTimeIL(data.last_daily_check_at) : "טרם רצה"}
          {data.last_daily_check_at && (issues.length ? ` — ${issues.length} נושאים דורשים תשומת לב` : " — הכל תקין")}
        </div>
        {issues.length > 0 && (
          <ul className="list-disc pr-5 mt-2 space-y-1 text-slate-700">
            {issues.map(i => <li key={i.key}>{i.text}</li>)}
          </ul>
        )}
        <p className="text-xs text-slate-500 mt-1">רצה בכל יום עבודה (א-ה) ב-07:00, ושולחת מייל והתראה כשמשהו מתקרב למגבלה.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ResendCard resend={data.resend} />
        <SupabaseCard supabase={data.supabase} />
      </div>
      <OrgTable resend={data.resend} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ManualCheckCard checks={data.manual_checks || []} currentWeek={data.current_week_start} />
        <RenderCard render={data.render} />
      </div>
      <SettingsCard settings={data.settings} onSaved={load} />
    </div>
  );
}
