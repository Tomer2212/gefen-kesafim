// "Silent" update: preserves the existing rows' order/presence, only refreshes their
// data. Rows that disappeared or appeared server-side (filtered out by date, deleted,
// newly created elsewhere, etc.) are intentionally left alone — they only sync on an
// explicit reload (initial mount, manual refresh, filter change, or a column sort),
// so a background poll never yanks a row out from under someone mid-edit.
export function mergeMeetingsSilently(prev, fresh) {
  const freshById = new Map(fresh.map(m => [m.id, m]));
  return prev.map(m => freshById.get(m.id) ?? m);
}

// A silent (background poll) refresh needs to fetch fresh data for rows already on
// screen even if they fall outside the active date_from/date_to filter (see
// mergeMeetingsSilently above — those rows are deliberately kept, not dropped). But
// dropping the date filter entirely for every poll tick would turn each background
// request into an unbounded "every meeting this advisor/org ever had" query — exactly
// the kind of full-table scan this project's own architecture rules warn against.
// Instead, bound the silent query to the actual span of dates currently on screen —
// precise (never wider than what's genuinely visible) and still bounded.
export function visibleDateBounds(meetings) {
  const dates = meetings.map(m => m.meeting_date).filter(Boolean);
  if (dates.length === 0) return {};
  return {
    date_from: dates.reduce((a, b) => (a < b ? a : b)),
    date_to: dates.reduce((a, b) => (a > b ? a : b)),
  };
}
