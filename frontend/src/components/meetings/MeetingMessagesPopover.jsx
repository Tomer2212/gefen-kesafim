import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 250;
const VIEWPORT_MARGIN = 16;
const MIN_ROOM_BELOW = 320;
const MIN_PANEL_HEIGHT = 160;

const MESSAGE_TYPE_LABELS = {
  reminder: "תזכורת",
  upload_request: "בקשת קבצי גפן",
  upload_followup: "בקשה חוזרת לקבצים",
};

const JERUSALEM_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function jerusalemParts(iso) {
  if (!iso) return null;
  const parts = Object.fromEntries(JERUSALEM_FORMAT.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return { date: `${parts.day}.${parts.month}.${parts.year}`, shortDate: `${parts.day}.${parts.month}`, time: `${parts.hour}:${parts.minute}` };
}

function MessageStatus({ message }) {
  if (message.status === "failed") {
    return (
      <div>
        <div className="font-semibold text-red-800">נכשל</div>
        {message.error_message && <div className="text-xs text-red-800 break-all max-w-xs" dir="ltr">{message.error_message}</div>}
      </div>
    );
  }
  if (message.status === "skipped") {
    return (
      <div>
        <div className="font-semibold text-amber-900">לא נשלח</div>
        <div className="text-xs text-slate-900">{message.error_message ? "הנמען ביקש הסרה מרשימת התפוצה" : "התזכורת לפגישה כבויה"}</div>
      </div>
    );
  }
  if (message.opened_at) {
    const opened = jerusalemParts(message.opened_at);
    return <span className="font-semibold text-green-900">נפתחה ב-{opened.shortDate} ב-{opened.time}</span>;
  }
  return <span className="text-slate-900">נשלחה</span>;
}

function FileLines({ title, items, className }) {
  return (
    <div>
      <div className="font-semibold text-slate-900">{title}</div>
      <ul className={className}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}

function UploadedFiles({ meetingId, uploads, onChanged }) {
  const [downloadError, setDownloadError] = useState(false);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [coverageError, setCoverageError] = useState(false);

  async function setCoverage(fileId, division) {
    setCoverageBusy(true);
    setCoverageError(false);
    try {
      await axios.patch(`/schools/meetings/${meetingId}/uploaded-files/${fileId}/coverage`, { division });
      await onChanged();
    } catch {
      setCoverageError(true);
    } finally {
      setCoverageBusy(false);
    }
  }

  async function handleDownload(file) {
    setDownloadError(false);
    try {
      const res = await axios.get(`/schools/meetings/${meetingId}/uploaded-files/${file.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
    }
  }

  if (!uploads) return <span className="text-xs text-red-800" role="alert">טעינת פרטי הקבצים נכשלה</span>;

  const showYears = uploads.years.length > 1;
  return (
    <div className="flex flex-col gap-2">
      {uploads.years.map(year => (
        <div key={year.academic_year} className="flex flex-col gap-1.5">
          {showYears && <div className="font-bold text-slate-900">שנת הלימודים {year.academic_year}</div>}
          {year.files.length > 0 && (
            <FileLines title="הועלו:" className="text-green-900" items={year.files.map(file => (
              <span key={file.id} className="inline-flex items-baseline gap-2">
                <button type="button" onClick={() => handleDownload(file)}
                  title={`הורדת ${file.filename}${file.uploaded_by ? ` · הועלה על ידי ${file.uploaded_by}` : ""}`}
                  aria-label={`הורדת ${file.type_label}: ${file.filename}`}
                  className="hover:underline text-right">
                  {file.type_label}
                </button>
                {file.advisor_confirmed && (
                  <button type="button" disabled={coverageBusy} onClick={() => setCoverage(file.id, null)}
                    aria-label={`ביטול השימוש בקובץ ${file.filename} לחטיבה נוספת`}
                    className="text-xs text-slate-900 underline disabled:opacity-50">
                    בטל
                  </button>
                )}
              </span>
            ))} />
          )}
          {year.missing.length > 0 && (
            <FileLines title="חסרים:" className="text-red-800" items={year.missing.map(item => (
              <span key={item.label} className="inline-flex items-baseline gap-2">
                {item.label}
                {item.reusable_file_id && (
                  <button type="button" disabled={coverageBusy} onClick={() => setCoverage(item.reusable_file_id, item.division_type)}
                    title={item.reusable_filename}
                    aria-label={`שימוש בקובץ ${item.reusable_filename} עבור ${item.label}`}
                    className="text-xs font-semibold text-blue-900 underline whitespace-nowrap disabled:opacity-50">
                    השתמש בקובץ הקיים
                  </button>
                )}
              </span>
            ))} />
          )}
        </div>
      ))}
      {uploads.all_received && <div className="font-semibold text-green-900">כל הקבצים התקבלו ✓</div>}
      {downloadError && <div className="text-xs text-red-800" role="alert">הורדת הקובץ נכשלה — נסה שוב</div>}
      {coverageError && <div className="text-xs text-red-800" role="alert">העדכון נכשל — נסה שוב</div>}
    </div>
  );
}

function RequestAgainButton({ meetingId, email, onSent }) {
  const [state, setState] = useState("idle"); // idle | working | failed
  const [errorDetail, setErrorDetail] = useState("");

  async function handleClick() {
    setState("working");
    try {
      await axios.post(`/schools/meetings/${meetingId}/request-missing-files`, { recipient_email: email });
      await onSent();
      setState("idle");
    } catch (err) {
      setErrorDetail(err.response?.data?.detail || "השליחה נכשלה — נסה שוב");
      setState("failed");
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={handleClick} disabled={state === "working"}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-slate-800 hover:bg-slate-900 transition-colors disabled:opacity-50 whitespace-nowrap">
        {state === "working" ? "שולח..." : "בקש מחדש"}
      </button>
      {state === "failed" && <div className="text-xs text-red-800 mt-1" role="alert">{errorDetail}</div>}
    </div>
  );
}

function MessageRow({ meetingId, message, expanded, onToggleContent, onRequested }) {
  const sent = jerusalemParts(message.sent_at);
  const contentId = `meeting-message-content-${message.id}`;
  return (
    <Fragment>
      <tr className="border-b border-slate-400 align-top">
        <td className="py-2 px-2 font-medium text-slate-900 whitespace-nowrap">{MESSAGE_TYPE_LABELS[message.message_type] || "לא תועד"}</td>
        <td className="py-2 px-2 text-slate-900">{message.recipient_name || "—"}</td>
        <td className="py-2 px-2 text-slate-900">{message.recipient_role || "—"}</td>
        <td className="py-2 px-2 text-slate-900 whitespace-nowrap" dir="ltr" style={{ textAlign: "right" }}>{message.recipient_email}</td>
        <td className="py-2 px-2">
          {message.body_html ? (
            <button type="button" onClick={onToggleContent} aria-expanded={expanded} aria-controls={contentId}
              className="text-blue-900 hover:underline whitespace-nowrap">
              {expanded ? "הסתר" : "הצג"}
            </button>
          ) : (
            <span className="text-slate-900 whitespace-nowrap">{message.status === "skipped" ? "—" : "לא תועד"}</span>
          )}
        </td>
        <td className="py-2 px-2 text-slate-900 whitespace-nowrap" dir="ltr" style={{ textAlign: "right" }}>{sent?.date || "—"}</td>
        <td className="py-2 px-2 text-slate-900 whitespace-nowrap" dir="ltr" style={{ textAlign: "right" }}>{sent?.time || "—"}</td>
        <td className="py-2 px-2"><MessageStatus message={message} /></td>
        <td className="py-2 px-2">
          {message.message_type === "upload_request" && <UploadedFiles meetingId={meetingId} uploads={message.uploads} onChanged={onRequested} />}
          {message.message_type === "upload_followup" && (message.missing_items || []).length > 0 && (
            <FileLines title="התבקשו:" className="text-slate-900" items={message.missing_items} />
          )}
          {message.message_type === "reminder" && <span className="text-slate-900">לא רלוונטי</span>}
          {message.can_request_again && (
            <RequestAgainButton meetingId={meetingId} email={message.recipient_email} onSent={onRequested} />
          )}
        </td>
      </tr>
      {expanded && (
        <tr id={contentId} className="border-b border-slate-400">
          <td colSpan={9} className="p-2">
            {message.subject && <div className="font-semibold text-slate-900 mb-2">נושא: {message.subject}</div>}
            {/* sandbox + pointer-events: display only — the stored email holds live links (upload, opt-out). */}
            <iframe title={`תוכן ההודעה אל ${message.recipient_name || message.recipient_email}`}
              sandbox="" srcDoc={message.body_html}
              className="w-full rounded-lg border border-slate-400 bg-white"
              style={{ height: 380, pointerEvents: "none" }} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// Mounted only while pinned, so useFocusTrap doesn't steal focus from whatever the user is
// doing when the panel merely opens on hover (focus leaving a row field would autosave it).
function PinnedFocusTrap({ panelRef, onClose }) {
  const { ref, handleKeyDown } = useFocusTrap(onClose);
  useLayoutEffect(() => {
    ref.current = panelRef.current;
    const panel = panelRef.current;
    panel?.addEventListener("keydown", handleKeyDown);
    return () => panel?.removeEventListener("keydown", handleKeyDown);
  });
  return null;
}

/**
 * The "נשלח ל..." badge in a meeting row's תזכורת column, plus the details panel it opens on
 * hover or click. Shared by every meetings table via MeetingRow.
 * `statuses` is the row's lightweight /reminder-status list.
 */
export function MeetingMessagesBadge({ meetingId, statuses }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [position, setPosition] = useState(null);
  const badgeRef = useRef(null);
  const panelRef = useRef(null);
  const timerRef = useRef(null);

  const clearTimer = () => clearTimeout(timerRef.current);
  useEffect(() => clearTimer, []);

  const close = useCallback(() => {
    clearTimeout(timerRef.current);
    setOpen(false);
    setPinned(false);
    setExpandedId(null);
    setPosition(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`/schools/meetings/${meetingId}/messages`);
      setData(res.data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [meetingId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function reposition() {
      const rect = badgeRef.current?.getBoundingClientRect();
      if (!rect || !panelRef.current) return;
      // The panel sizes itself to its content (w-max), so measure it rather than assume a width.
      const width = panelRef.current.offsetWidth;
      const centered = rect.left + rect.width / 2 - width / 2;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(centered, window.innerWidth - width - VIEWPORT_MARGIN));
      const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - 6;
      const above = rect.top - VIEWPORT_MARGIN - 6;
      setPosition(below >= MIN_ROOM_BELOW || below >= above
        ? { left, top: rect.bottom + 6, maxHeight: Math.max(below, MIN_PANEL_HEIGHT) }
        : { left, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(above, MIN_PANEL_HEIGHT) });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, data, loadError, expandedId]);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (!panelRef.current?.contains(e.target) && !badgeRef.current?.contains(e.target)) close();
    }
    function handleEscape(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, close]);

  function scheduleOpen() {
    clearTimer();
    if (!open) timerRef.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function scheduleClose() {
    clearTimer();
    if (!pinned) timerRef.current = setTimeout(close, CLOSE_DELAY_MS);
  }

  function togglePinned() {
    clearTimer();
    if (open && pinned) { close(); return; }
    setOpen(true);
    setPinned(true);
  }

  const attempted = statuses.filter(s => s.status !== "skipped");
  const sentCount = attempted.filter(s => s.status === "sent").length;
  const allSent = attempted.length > 0 && sentCount === attempted.length;
  const messages = data?.messages || [];
  const badgeText = attempted.length > 0 ? `נשלח ל-${sentCount}/${attempted.length}` : "לא נשלח";

  return (
    <div className="relative inline-block mr-1">
      <button type="button" ref={badgeRef}
        onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} onClick={togglePinned}
        aria-haspopup="dialog" aria-expanded={open} aria-label={`${badgeText} — פירוט ההודעות שנשלחו לפגישה`}
        // A row locked to another advisor disables pointer events, but the details stay open to them.
        className={`pointer-events-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
          allSent ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-amber-50 border-amber-300 text-amber-700"
        }`}>
        {badgeText}
      </button>
      {open && createPortal(
        <>
        {/* Portaled out of the table; stop React events so they never reach the row's autosave handlers. */}
        <div ref={panelRef} dir="rtl"
          role="dialog" aria-modal={pinned} aria-labelledby={`meeting-messages-title-${meetingId}`}
          onMouseEnter={clearTimer} onMouseLeave={scheduleClose}
          onBlur={e => e.stopPropagation()} onFocus={e => e.stopPropagation()}
          onMouseDown={e => { e.stopPropagation(); clearTimer(); setPinned(true); }}
          onClick={e => e.stopPropagation()}
          className="fixed z-50 w-max overflow-auto rounded-xl border-2 border-black bg-slate-200 p-4 text-sm text-right shadow-xl whitespace-normal"
          style={{ maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`, ...(position || { left: 0, top: 0, visibility: "hidden" }) }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 id={`meeting-messages-title-${meetingId}`} className="font-bold text-slate-900">הודעות שנשלחו לקראת הפגישה</h2>
            <button type="button" onClick={close} aria-label="סגור חלונית" className="btn-ghost text-sm px-2 py-1">✕</button>
          </div>

          {loadError && <div role="alert" className="text-sm text-red-800 text-center py-6">טעינת ההודעות נכשלה — נסה שוב</div>}
          {!loadError && !data && <div role="status" aria-label="טוען הודעות" className="text-sm text-slate-900 text-center py-6">טוען…</div>}
          {!loadError && data && messages.length === 0 && <div className="text-sm text-slate-900 text-center py-6">טרם נשלחו הודעות</div>}

          {!loadError && messages.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-900 border-b border-slate-500">
                  {["סוג הודעה", "שם נמען", "תפקיד", "מייל", "תוכן", "תאריך", "שעה", "סטטוס", "קבצים"].map(label => (
                    <th key={label} scope="col" className="text-right font-semibold py-1.5 px-2 whitespace-nowrap">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {messages.map(message => (
                  <MessageRow key={message.id} meetingId={meetingId} message={message}
                    expanded={expandedId === message.id}
                    onToggleContent={() => setExpandedId(id => (id === message.id ? null : message.id))}
                    onRequested={load} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        {/* After the panel, not inside it: its ref must already be attached when this mounts. */}
        {pinned && <PinnedFocusTrap panelRef={panelRef} onClose={close} />}
        </>,
        document.body
      )}
    </div>
  );
}
