// "זכור מכשיר זה ל-30 יום" — lets a user with MFA enabled skip the TOTP challenge
// on this specific browser until the token expires. Stored client-side only; the
// backend holds just a hash of it (trusted_devices table) and is the real source
// of truth — see backend/auth.py's _is_device_trusted (fail-closed on the server).
const TRUSTED_DEVICE_KEY = "gefen_trusted_device";

export function getTrustedDeviceToken() {
  try {
    const raw = localStorage.getItem(TRUSTED_DEVICE_KEY);
    if (!raw) return null;
    const { token, expires_at } = JSON.parse(raw);
    if (!token || !expires_at || new Date(expires_at) <= new Date()) {
      localStorage.removeItem(TRUSTED_DEVICE_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function setTrustedDeviceToken(token, expiresAt) {
  try {
    localStorage.setItem(TRUSTED_DEVICE_KEY, JSON.stringify({ token, expires_at: expiresAt }));
  } catch {
    // best-effort only — worst case the user is asked for a code again next time
  }
}

export function clearTrustedDeviceToken() {
  try {
    localStorage.removeItem(TRUSTED_DEVICE_KEY);
  } catch {
    // best-effort only
  }
}
