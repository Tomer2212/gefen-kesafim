import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { DatePickerPopover } from "./meetings/DatePickerPopover";
import { CONTROL_LETTER_STATUS_OPTIONS } from "./controlLetter/constants";

const DIVISION_LABEL = { tikkon: "תיכון", beinayim: "חטיבת ביניים", yesodi: "יסודי", other: "אחר" };

function formatDDMMYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

// Calendar-day addition (not business days) — received_date + days_to_answer.
function addDaysISO(iso, days) {
  if (!iso || days === null || days === undefined || days === "") return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Number(days));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Divisions are derived from school.stage (not gefen_accounts, which aren't guaranteed to
// exist for every school) — a שש-שנתי school has both תיכון and חטיבת ביניים; every other
// stage maps to a single division matching the stage value itself.
function divisionsForStage(stage) {
  if (stage === "sheshshnati") return ["tikkon", "beinayim"];
  if (DIVISION_LABEL[stage]) return [stage];
  return ["other"];
}

export function ControlLetterTab({ schoolId, schoolStage }) {
  const [rowsByDivision, setRowsByDivision] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;
    setLoading(true);
    axios.get(`/schools/${schoolId}/control-letters`)
      .then(res => {
        const map = {};
        for (const r of (res.data || [])) map[r.division_type] = r;
        setRowsByDivision(map);
      })
      .catch(() => setRowsByDivision({}))
      .finally(() => setLoading(false));
  }, [schoolId]);

  function saveField(divisionType, field, value) {
    setRowsByDivision(prev => ({ ...prev, [divisionType]: { ...(prev[divisionType] || {}), [field]: value } }));
    axios.put(`/schools/${schoolId}/control-letters/${divisionType}`, { [field]: value })
      .then(res => {
        setRowsByDivision(prev => ({ ...prev, [divisionType]: { ...(prev[divisionType] || {}), ...res.data } }));
      })
      .catch(() => {
        /* non-fatal — local draft still reflects the attempted change */
      });
  }

  function handleFileChange(divisionType, data) {
    setRowsByDivision(prev => ({ ...prev, [divisionType]: { ...(prev[divisionType] || {}), ...data } }));
  }

  const divisions = divisionsForStage(schoolStage);

  if (loading) {
    return (
      <div role="status" aria-label="טוען מכתבי בקרה" className="flex justify-center py-10">
        <div aria-hidden="true" className="spinner w-8 h-8" />
      </div>
    );
  }

  return (
    <div dir="rtl">
      {divisions.map((divisionType, i) => (
        <div key={divisionType} className={i === divisions.length - 1 ? "" : "mb-12"}>
          {divisions.length > 1 && (
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              {DIVISION_LABEL[divisionType] || "חטיבה"}
            </h2>
          )}
          <ControlLetterTable
            schoolId={schoolId}
            divisionType={divisionType}
            row={rowsByDivision[divisionType] || {}}
            onSaveField={(field, value) => saveField(divisionType, field, value)}
            onFileChange={data => handleFileChange(divisionType, data)}
          />
        </div>
      ))}
    </div>
  );
}

function ControlLetterTable({ schoolId, divisionType, row, onSaveField, onFileChange }) {
  const targetDate = formatDDMMYY(addDaysISO(row.received_date, row.days_to_answer));
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="overflow-auto dash-scroll-x">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr
              className="border-b border-slate-200"
              style={{ background: "rgba(241,245,249,0.97)" }}
            >
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap">תאריך קבלה</th>
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap">מס' ימים לתשובה</th>
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap">תאריך יעד</th>
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap">מכתב מקורי</th>
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap">סטטוס</th>
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold border-l border-slate-200 whitespace-nowrap">הערות</th>
              <th scope="col" className="text-right px-4 py-3 text-slate-900 font-semibold whitespace-nowrap">מכתב תשובה</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-4 py-3 border-l border-slate-100 align-top">
                <ReceivedDateCell value={row.received_date} onChange={v => onSaveField("received_date", v)} />
              </td>
              <td className="px-4 py-3 border-l border-slate-100 align-top">
                <DaysToAnswerInput value={row.days_to_answer} onSave={v => onSaveField("days_to_answer", v)} />
              </td>
              <td className="px-4 py-3 border-l border-slate-100 align-top text-slate-600 whitespace-nowrap">
                {targetDate || <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-3 border-l border-slate-100 align-top">
                <PdfAttachmentCell
                  schoolId={schoolId}
                  divisionType={divisionType}
                  kind="original"
                  fileName={row.original_letter_file_name}
                  onChange={onFileChange}
                />
              </td>
              <td className="px-4 py-3 border-l border-slate-100 align-top">
                <StatusDropdown value={row.status} onChange={v => onSaveField("status", v)} />
              </td>
              <td className="px-4 py-3 border-l border-slate-100 align-top">
                <NotesInput value={row.notes} onSave={v => onSaveField("notes", v)} />
              </td>
              <td className="px-4 py-3 align-top">
                <PdfAttachmentCell
                  schoolId={schoolId}
                  divisionType={divisionType}
                  kind="response"
                  fileName={row.response_letter_file_name}
                  onChange={onFileChange}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReceivedDateCell({ value, onChange }) {
  const [show, setShow] = useState(false);
  const anchorRef = useRef(null);
  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        ref={anchorRef}
        onClick={() => setShow(o => !o)}
        className="text-sm text-right hover:text-blue-600 transition-colors cursor-pointer font-medium text-slate-700 whitespace-nowrap"
      >
        {value ? formatDDMMYY(value) : <span className="text-slate-300 font-normal">בחר תאריך</span>}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="נקה תאריך קבלה"
          className="text-slate-300 hover:text-red-500 transition-colors text-xs leading-none"
        >
          ✕
        </button>
      )}
      {show && (
        <DatePickerPopover
          value={value}
          anchorRef={anchorRef}
          onChange={v => { setShow(false); onChange(v); }}
          onClose={() => setShow(false)}
        />
      )}
    </div>
  );
}

function DaysToAnswerInput({ value, onSave }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <input
      type="number"
      min="0"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onSave(draft === "" ? null : Number(draft))}
      aria-label="מס' ימים לתשובה"
      className="w-20 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40"
    />
  );
}

function NotesInput({ value, onSave }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => onSave(draft === "" ? null : draft)}
      aria-label="הערות"
      placeholder="הערות..."
      className="w-48 px-2 py-1 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40"
    />
  );
}

const ADMIN_FIELD_CLS = "text-sm text-slate-700 border rounded-md px-2 py-0.5 bg-transparent border-slate-300 focus:outline-none focus:ring-1 focus:border-blue-400 focus:ring-blue-100";

function StatusDropdown({ value, onChange }) {
  return (
    <div>
      <label className="sr-only">סטטוס</label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value || null)}
        className={`${ADMIN_FIELD_CLS} w-32`}
      >
        {CONTROL_LETTER_STATUS_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function PdfAttachmentCell({ schoolId, divisionType, kind, fileName, onChange }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const endpoint = `/schools/${schoolId}/control-letters/${divisionType}/${kind}-file`;

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      window.alert("ניתן להעלות קובצי PDF בלבד");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setBusy(true);
    try {
      const res = await axios.post(endpoint, formData);
      onChange(res.data);
    } catch {
      /* non-fatal — user can retry the upload */
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    try {
      const res = await axios.get(endpoint, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "control-letter.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal */
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      const res = await axios.delete(endpoint);
      onChange({ ...res.data, [`${kind}_letter_storage_key`]: null, [`${kind}_letter_file_name`]: null });
    } catch {
      /* non-fatal */
    } finally {
      setBusy(false);
    }
  }

  if (fileName) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="text-sm text-slate-700 hover:text-blue-600 underline decoration-dotted underline-offset-2 truncate max-w-[10rem]"
          title={fileName}
        >
          {fileName}
        </button>
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          aria-label={kind === "original" ? "הסר מכתב מקורי" : "הסר מכתב תשובה"}
          className="text-slate-300 hover:text-red-500 transition-colors text-xs leading-none disabled:opacity-40"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleUpload}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={kind === "original" ? "הוסף מכתב מקורי" : "הוסף מכתב תשובה"}
        className="text-slate-400 hover:text-blue-600 transition-colors text-base leading-none disabled:opacity-40"
      >
        <span className="text-slate-400 text-lg font-light">+</span>
      </button>
    </div>
  );
}
