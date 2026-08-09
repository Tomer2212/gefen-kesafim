export const CONTROL_LETTER_STATUS_OPTIONS = [
  { value: "",             label: "בחר",         color: "#64748b", bg: "#f8fafc", dot: "#94a3b8" },
  { value: "in_progress",  label: "בתהליך",      color: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" },
  { value: "problem",      label: "בעיה",         color: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" },
  { value: "handled_1",    label: "טופל 1",       color: "#15803d", bg: "#f0fdf4", dot: "#22c55e" },
  { value: "further_fix",  label: "תיקון נוסף",   color: "#c2410c", bg: "#fff7ed", dot: "#f97316" },
  { value: "handled_2",    label: "טופל 2",       color: "#0f766e", bg: "#f0fdfa", dot: "#14b8a6" },
];

export const CONTROL_LETTER_STATUS_MAP = Object.fromEntries(
  CONTROL_LETTER_STATUS_OPTIONS.map(s => [s.value, s])
);
