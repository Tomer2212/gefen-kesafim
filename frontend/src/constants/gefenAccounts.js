// A school's Gefen accounts ("חשבונות במערכת גפן"). Mirrors backend/gefen_accounts.py — keep
// the two in sync. Each account covers grade layers (yesodi / chativa / elyona); its
// division_type is derived from them and is unique per school:
//   elyona only -> tikkon · elyona + another -> combined · yesodi only -> yesodi · else -> beinayim

export const LAYERS = ["yesodi", "chativa", "elyona"];
export const LAYER_LABELS = { yesodi: "יסודי", chativa: 'חט"ב', elyona: "עליונה" };
export const MAX_ACCOUNTS = 3;

const DIVISION_ORDER = { yesodi: 0, beinayim: 1, combined: 2, tikkon: 3, other: 4 };
const DEFAULT_COVERS = { tikkon: ["elyona"], beinayim: ["chativa"], yesodi: ["yesodi"], combined: ["chativa", "elyona"], other: [] };
const STAGE_ACCOUNTS = { yesodi: [["yesodi"]], beinayim: [["chativa"]], tikkon: [["elyona"]], sheshshnati: [["chativa"], ["elyona"]] };

// The 7 possible contents of one account, as a single <select> value ("yesodi+chativa").
export const ACCOUNT_TYPE_OPTIONS = [
  ["yesodi"], ["chativa"], ["elyona"],
  ["yesodi", "chativa"], ["chativa", "elyona"], ["yesodi", "elyona"], ["yesodi", "chativa", "elyona"],
].map(covers => ({ value: covers.join("+"), label: coversLabel(covers), covers }));

export function normalizeCovers(covers) {
  const set = new Set(covers || []);
  return LAYERS.filter(l => set.has(l));
}

export function divisionTypeFor(covers) {
  const set = new Set(normalizeCovers(covers));
  if (set.size === 1 && set.has("elyona")) return "tikkon";
  if (set.has("elyona")) return "combined";
  if (set.size === 1 && set.has("yesodi")) return "yesodi";
  return "beinayim";
}

export function coversLabel(covers) {
  return normalizeCovers(covers).map(l => LAYER_LABELS[l]).join(" + ");
}

export function accountCovers(account) {
  const covers = normalizeCovers(account?.covers);
  return covers.length ? covers : [...(DEFAULT_COVERS[account?.division_type] || [])];
}

export function accountLabel(account) {
  return coversLabel(accountCovers(account)) || account?.custom_label || "";
}

export function sortAccounts(accounts) {
  return [...(accounts || [])].sort((a, b) => (DIVISION_ORDER[a.division_type] ?? 9) - (DIVISION_ORDER[b.division_type] ?? 9));
}

// Hebrew error for an invalid list of covers, or null.
export function validateCoversList(coversList) {
  if (coversList.length > MAX_ACCOUNTS) return `ניתן להגדיר עד ${MAX_ACCOUNTS} חשבונות גפן`;
  const seen = new Set();
  for (const covers of coversList) {
    const layers = normalizeCovers(covers);
    if (!layers.length) return "יש לבחור לכל חשבון אילו שכבות הוא כולל";
    const dup = layers.find(l => seen.has(l));
    if (dup) return `השכבה ${LAYER_LABELS[dup]} מופיעה ביותר מחשבון אחד`;
    layers.forEach(l => seen.add(l));
  }
  return null;
}

// The school's accounts, sorted — falling back to the ones its legacy stage implies for a
// school saved before accounts were kept for every school (display / tabs only, never saved).
export function schoolAccounts(school) {
  // The school list returns the selected year's accounts (year_gefen_accounts) — those win.
  if (Array.isArray(school?.year_gefen_accounts)) return sortAccounts(school.year_gefen_accounts);
  const real = sortAccounts(school?.gefen_accounts || []);
  if (real.length) return real;
  return (STAGE_ACCOUNTS[school?.stage] || []).map(covers => ({ id: null, covers, division_type: divisionTypeFor(covers) }));
}

// "יסודי + חט"ב; עליונה" — the accounts as one line (tables, filters, sort).
export function schoolAccountsLabel(school) {
  return schoolAccounts(school).map(accountLabel).join("; ");
}

// Editor draft rows ({key, id, covers, finance_software, tmura_model}) from a school.
export function accountsDraftFromSchool(school) {
  return sortAccounts(school?.gefen_accounts || []).map(a => ({
    key: a.id, id: a.id, covers: accountCovers(a), finance_software: a.finance_software ?? null, tmura_model: a.tmura_model ?? null,
  }));
}

// PUT /schools/{id}/accounts body from editor draft rows.
export function accountsPayload(draft) {
  return {
    accounts: draft.map(d => ({
      id: d.id || null, covers: normalizeCovers(d.covers),
      ...(d.finance_software != null && { finance_software: d.finance_software }),
      ...(d.tmura_model != null && { tmura_model: d.tmura_model }),
    })),
  };
}

export function accountsDraftEqual(a, b) {
  const sig = d => d.map(x => normalizeCovers(x.covers).join("+")).filter(Boolean).sort().join("|");
  return sig(a || []) === sig(b || []);
}

// Draft rows a legacy stage implies (a new school whose Ministry stage is a single level).
export function accountsDraftFromStage(stage) {
  return (STAGE_ACCOUNTS[stage] || []).map((covers, i) => ({ key: `stage-${stage}-${i}`, id: null, covers, finance_software: null, tmura_model: null }));
}

// Which file division (as detected from report codes: "tikkon" / "beinayim") an account can
// receive — a combined account receives both.
export function accountBuckets(account) {
  const layers = accountCovers(account);
  const out = [];
  if (layers.includes("elyona")) out.push("tikkon");
  if (layers.includes("yesodi") || layers.includes("chativa")) out.push("beinayim");
  return out;
}

// The single file division an account's tab expects, or null when it accepts either.
export function divisionBucket(account) {
  const buckets = accountBuckets(account);
  return buckets.length === 1 ? buckets[0] : null;
}

// The division_type (= account tab) a check log belongs to: its own account, else the only
// account its detected file division fits, else the first tab.
export function logAccountDivision(log, accounts) {
  const own = accounts.find(a => a.id && a.id === log.gefen_account_id);
  if (own) return own.division_type;
  // An active account wins over an archive tab (an account removed for the year).
  const fitting = accounts.filter(a => accountBuckets(a).includes(log.summary?.division));
  const fits = fitting.some(a => !a.archived) ? fitting.filter(a => !a.archived) : fitting;
  return (fits.length === 1 ? fits[0] : accounts.find(a => !a.archived) || accounts[0])?.division_type ?? null;
}

// schools.stage as the server derives it from the accounts (gefen_accounts.derive_stage) —
// lets an edit form show the six-year contact rows live while the account list is edited.
export function deriveStage(accountsOrDraft) {
  const divisions = new Set((accountsOrDraft || [])
    .map(a => a.division_type || (normalizeCovers(a.covers).length ? divisionTypeFor(a.covers) : null))
    .filter(Boolean));
  if (!divisions.size) return "";
  if (divisions.has("tikkon") && (divisions.has("beinayim") || divisions.has("yesodi"))) return "sheshshnati";
  if (divisions.size === 1) {
    const only = [...divisions][0];
    return ["yesodi", "beinayim", "tikkon"].includes(only) ? only : "other";
  }
  return "other";
}

// ---- per academic year -------------------------------------------------------------------
// GET /schools/{id}/gefen-accounts?academic_year=Y → {active, archived}: active = the year's
// accounts; archived = accounts removed for that year that still have checks of it
// (read-only tabs). Each item: {id, division_type, covers, label, archived, checks_count}.

export const ACCOUNTS_REQUEST_PREFIX = "gefen_accounts@";

export function viewTabAccounts(view) {
  return [...(view?.active || []), ...(view?.archived || [])];
}

export function accountsDraftFromView(view) {
  return (view?.active || []).map(a => ({
    key: a.division_type, id: a.id, covers: accountCovers(a),
    finance_software: a.finance_software ?? null, tmura_model: a.tmura_model ?? null, checks_count: a.checks_count || 0,
  }));
}

// Accounts the draft drops or changes the kind of, vs. the saved year list — {label, checks_count}.
export function removedAccounts(original, draft) {
  const kept = new Set((draft || []).filter(d => normalizeCovers(d.covers).length).map(d => divisionTypeFor(d.covers)));
  return (original || [])
    .filter(o => !kept.has(divisionTypeFor(o.covers)))
    .map(o => ({ label: coversLabel(o.covers), checks_count: o.checks_count || 0 }));
}

// Update-request value for one year's accounts: the account labels.
export function draftLabels(draft) {
  return (draft || []).map(d => coversLabel(d.covers)).filter(Boolean);
}
