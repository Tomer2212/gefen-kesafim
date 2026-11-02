// Crash-recovery backup of a meeting note that is being edited but not saved yet. Lives only in
// this browser (localStorage), per user + meeting + note ("new" for a note not yet created), and
// is removed as soon as the note is saved or the user discards the changes. Never the source of
// truth — the note itself is only ever saved to the server by an explicit save.
// Every access is wrapped: storage can be unavailable (private mode, blocked site data).

const PREFIX = "meetingNoteDraft:";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function draftKey(userId, meetingId, segmentId) {
  return `${PREFIX}${userId}:${meetingId}:${segmentId || "new"}`;
}

export function writeDraft(key, { html, text }) {
  try { localStorage.setItem(key, JSON.stringify({ html, text, at: Date.now() })); } catch { /* storage unavailable */ }
}

export function removeDraft(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// Newest first: [{ key, segmentId (null = new note), html, text, at }]. Expired / corrupt entries
// are cleaned up on the way.
export function findDrafts(userId, meetingId) {
  const prefix = `${PREFIX}${userId}:${meetingId}:`;
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
      const seg = key.slice(prefix.length);
      found.push({ key, segmentId: seg === "new" ? null : seg, html: d.html, text: d.text, at: d.at });
    }
  } catch {
    return [];
  }
  stale.forEach(removeDraft);
  return found.sort((a, b) => b.at - a.at);
}
