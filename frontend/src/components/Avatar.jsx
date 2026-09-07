// Round profile picture. Renders the image when `url` is set, otherwise a
// deterministic colored circle with the user's initials. Used by the Sidebar
// (expanded + collapsed user block) and the "פרטים אישיים" tab.

const PALETTE = [
  "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",
];

export function getInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[parts.length - 1][0] || "");
}

function colorFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({ url, name = "", size = 36, className = "" }) {
  const dim = { width: size, height: size };
  const initials = getInitials(name);

  if (url) {
    return (
      <img
        src={url}
        alt={name ? `תמונת פרופיל של ${name}` : "תמונת פרופיל"}
        style={{ ...dim, objectFit: "cover" }}
        className={`rounded-full flex-shrink-0 bg-slate-200 ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        ...dim,
        background: colorFor(name),
        fontSize: Math.round(size * 0.4),
      }}
      className={`rounded-full flex-shrink-0 inline-flex items-center justify-center font-semibold text-white select-none ${className}`}
    >
      {initials}
    </span>
  );
}
