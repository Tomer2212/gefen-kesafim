// The start of the note a user was tagged in ("mention" = meeting note, "closure_mention" =
// "סגירת שנה" note), shown under the notification's title — so the tag is understandable even
// before opening it, or when the user has no access to the school. `note_preview` is the
// note's plain text cut by the server at 100 characters.
const PREVIEW_TYPES = ["mention", "closure_mention"];
const SERVER_PREVIEW_LENGTH = 100;

export default function NotePreview({ notif, className = "" }) {
  const data = notif?.data || {};
  // "meeting_moved": the original and new times, always in full.
  if (notif?.type === "meeting_moved" && data.text) {
    return <span className={className} style={{ whiteSpace: "pre-line", WebkitLineClamp: "unset" }}>{data.text}</span>;
  }
  const text = (data.note_preview || "").trim();
  if (!PREVIEW_TYPES.includes(notif?.type) || !text) return null;
  const cut = (data.note_preview || "").length >= SERVER_PREVIEW_LENGTH;
  const area = notif.type === "closure_mention" && data.area_label ? `סגירת שנה · ${data.area_label}: ` : "";
  return (
    <span className={className} style={{ wordBreak: "break-word" }}>
      {area}"{text}{cut ? "…" : ""}"
    </span>
  );
}
