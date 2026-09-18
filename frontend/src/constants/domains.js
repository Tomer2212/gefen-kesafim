// "תחומי ידע" — the finance-software systems an advisor is trained on (profiles.control_domains).
export const DOMAIN_OPTIONS = [
  { value: "gefen", label: "גפן" },
  { value: "kesafim2000", label: "כספים2000" },
  { value: "payscool", label: "פייסקול" },
  { value: "schoolcash", label: "סקולקאש" },
];

// Per-domain proficiency level (profiles.control_domain_levels: {domain: level}).
export const DOMAIN_LEVEL_OPTIONS = [
  { value: "beginner", label: "מתחיל" },
  { value: "advanced", label: "מתקדם" },
  { value: "expert", label: "מומחה" },
];
export const DOMAIN_LEVEL_RANK = { beginner: 1, advanced: 2, expert: 3 };
