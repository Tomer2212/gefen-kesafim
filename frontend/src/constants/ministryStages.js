// "שלב חינוך" — the school stage as the Ministry of Education defines it (schools.ministry_stage).
// Descriptive only — it never drives checks, divisions, contacts or meetings; schools.stage
// ("חשבונות במערכת גפן") does. The stored value IS the Hebrew string below; "אחר" carries free
// text in schools.ministry_stage_other_text.

export const MINISTRY_STAGE_OTHER = "אחר";

export const MINISTRY_STAGE_VALUES = [
  "יסודי בלבד",
  'חט"ב בלבד',
  "עליונה בלבד",
  'יסודי וחט"ב',
  'חט"ב + עליונה',
  "יסודי ועליונה",
  'יסודי חט"ב ועליונה',
  MINISTRY_STAGE_OTHER,
];

export const MINISTRY_STAGE_OPTIONS = MINISTRY_STAGE_VALUES.map(v => ({ value: v, label: v }));

// "אחר (פירוט)" for "אחר" with free text, otherwise the stored value itself ("" when unset).
export function ministryStageLabel(school) {
  const value = school?.ministry_stage || "";
  const other = value === MINISTRY_STAGE_OTHER ? (school?.ministry_stage_other_text || "").trim() : "";
  return other ? `${value} (${other})` : value;
}

// Which levels a value covers → the canonical value. Ignores spacing, quotes, "בלבד", "ו"/"+".
const COMBOS = {
  "100": "יסודי בלבד",
  "010": 'חט"ב בלבד',
  "001": "עליונה בלבד",
  "110": 'יסודי וחט"ב',
  "011": 'חט"ב + עליונה',
  "101": "יסודי ועליונה",
  "111": 'יסודי חט"ב ועליונה',
};

// Excel import: -> { ministry_stage, ministry_stage_other_text }. Never fails — text that
// names no known level is kept as "אחר" + the original text, so nothing the file said is lost.
export function matchMinistryStage(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ministry_stage: null, ministry_stage_other_text: null };
  const key = text.replace(/[\s\-_.,'"׳״()/\\+]+/g, "");
  if (key === MINISTRY_STAGE_OTHER) return { ministry_stage: MINISTRY_STAGE_OTHER, ministry_stage_other_text: null };
  // The app's own old wording (a file exported from here) — same mapping as the 2026-11-17 backfill.
  if (["שששנתי", "6שנתי", "שישנתי"].includes(key)) return { ministry_stage: COMBOS["011"], ministry_stage_other_text: null };
  const yesodi = key.includes("יסוד");
  const chativa = key.includes("חטב") || key.includes("ביניים");
  const elyona = key.includes("עליונה") || key.includes("תיכון");
  const combo = COMBOS[`${+yesodi}${+chativa}${+elyona}`];
  return combo
    ? { ministry_stage: combo, ministry_stage_other_text: null }
    : { ministry_stage: MINISTRY_STAGE_OTHER, ministry_stage_other_text: text };
}

// Only the one-level values say unambiguously how checks split (schools.stage) — a combined
// value may be one Gefen account or several, so it is never guessed.
const SINGLE_LEVEL_STAGE = { "יסודי בלבד": "yesodi", 'חט"ב בלבד': "beinayim", "עליונה בלבד": "tikkon" };
export function stageSuggestionForMinistryStage(ministryStage) {
  return SINGLE_LEVEL_STAGE[ministryStage] || null;
}
