// Crash-recovery backup of a note that is being edited but not saved yet. Lives only in this
// browser (localStorage), per user + container + note ("new" for a note not yet created), and is
// removed as soon as the note is saved or the user discards the changes. Never the source of
// truth — the note itself is only ever saved to the server by an explicit save.
// Used by the meeting-notes window (container = meeting) and the "סגירת שנה" tab
// (container = school + academic year; the note's area travels in the draft's `meta`).
// Every access is wrapped: storage can be unavailable (private mode, blocked site data).

const PREFIX = "meetingNoteDraft:";
const CLOSURE_PREFIX = "closureNoteDraft:";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function draftKey(userId, meetingId, segmentId) {
  return `${PREFIX}${userId}:${meetingId}:${segmentId || "new"}`;
}

// `areaKey` keeps two new (not yet created) notes of different areas apart.
export function closureDraftKey(userId, schoolId, academicYear, areaKey, noteId) {
  return `${CLOSURE_PREFIX}${userId}:${schoolId}:${academicYear}:${noteId || `new@${areaKey}`}`;
}

export function writeDraft(key, { html, text, meta }) {
  try { localStorage.setItem(key, JSON.stringify({ html, text, meta, at: Date.now() })); } catch { /* storage unavailable */ }
}

export function removeDraft(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// Newest first: [{ key, id (the part after the container), html, text, meta, at }]. Expired /
// corrupt entries are cleaned up on the way.
function findDraftsWithPrefix(prefix) {
  const found = [];
  const stale = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      let d = null;
      try { d = JSON.parse(localStorage.getItem(key)); } catch { d = null; }
      if (!d || !d.html || !(d.text || "").trim() || Date.now() - (d.at || 0) > MAX_AGE_MS) {
        stale.push(key);
        continue;
      }
      found.push({ key, id: key.slice(prefix.length), html: d.html, text: d.text, meta: d.meta || null, at: d.at });
    }
  } catch {
    return [];
  }
  stale.forEach(removeDraft);
  return found.sort((a, b) => b.at - a.at);
}

// Meeting notes: segmentId null = a new note.
export function findDrafts(userId, meetingId) {
  return findDraftsWithPrefix(`${PREFIX}${userId}:${meetingId}:`)
    .map(d => ({ ...d, segmentId: d.id === "new" ? null : d.id }));
}

// "סגירת שנה" notes of one school + year: noteId null = a new note; the area is in `meta`.
export function findClosureDrafts(userId, schoolId, academicYear) {
  return findDraftsWithPrefix(`${CLOSURE_PREFIX}${userId}:${schoolId}:${academicYear}:`)
    .map(d => ({ ...d, noteId: d.id.startsWith("new@") ? null : d.id }));
}
