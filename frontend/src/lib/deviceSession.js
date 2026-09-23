// Tracks "this browser" as one of the user's active connections (עד 3), independent of
// Supabase's own session/refresh-token bookkeeping. See backend/routers/sessions_router.py
// and CLAUDE.md's "ניהול וניתוק חיבורים מרוחקים" section for the full design.
import axios from "axios";

const DEVICE_ID_KEY = "gefen_device_id";

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // localStorage unavailable (private mode etc.) — fall back to a per-tab id
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // best-effort only
    }
  }
  return id;
}

// Called after the backend rejects a request with "device_revoked" — the old id must not
// be reused, or every future request (including the next registration attempt) keeps
// getting blocked by the same revoked-device check, permanently locking this browser out
// instead of just ending this one session. Clearing it lets the next login register as a
// genuinely new connection.
export function clearDeviceId() {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch {
    // best-effort only
  }
}

export function getDeviceLabel() {
  const ua = navigator.userAgent || "";
  let browser = "דפדפן";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";
  else if (/OPR\//.test(ua)) browser = "Opera";

  let os = "מחשב";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "Mac";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} · ${os}`;
}

// Called once per login / app-load. Returns { ok: true } or, when the user already has
// 3 active connections, { ok: false, limitReached: true } — the caller must send the user
// to free up a slot before continuing.
export async function registerDeviceSession() {
  try {
    await axios.post("/sessions/register", {
      device_id: getDeviceId(),
      device_label: getDeviceLabel(),
    });
    return { ok: true };
  } catch (err) {
    if (err?.response?.status === 409) {
      return { ok: false, limitReached: true };
    }
    // Transient failure — don't block the user from using the app over this.
    return { ok: true };
  }
}
