import { createRoot } from "react-dom/client";
import axios from "axios";
import "./index.css";
import App from "./App.jsx";
import { supabase } from "./lib/supabase";
import { getDeviceId, clearDeviceId } from "./lib/deviceSession";
import { getTrustedDeviceToken, clearTrustedDeviceToken } from "./lib/trustedDevice";

if (import.meta.env.VITE_API_URL) {
  axios.defaults.baseURL = import.meta.env.VITE_API_URL;
}
axios.defaults.timeout = 45000;

// Module-level token mirror — updated synchronously by onAuthStateChange.
let _currentToken = null;

// On a cold page load (e.g. a hard refresh on a deep link), a request can fire before this
// initial getSession() resolves, going out with no Authorization header — the request
// interceptor below awaits this once so that race can't produce an unauthenticated request.
const _initialSession = supabase.auth.getSession().then(({ data: { session } }) => {
  _currentToken = session?.access_token ?? null;
});

supabase.auth.onAuthStateChange((_event, session) => {
  _currentToken = session?.access_token ?? null;
});

function applyAuthHeaders(config, token) {
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers["X-Device-Id"] = getDeviceId();
  const trustedToken = getTrustedDeviceToken();
  if (trustedToken) {
    config.headers["X-Trusted-Device-Token"] = trustedToken;
  }
  return config;
}

// Attach Supabase JWT + this browser's device id to every outgoing request.
axios.interceptors.request.use(async (config) => {
  if (config._retried) return config;
  if (_currentToken === null) await _initialSession;
  return applyAuthHeaders(config, _currentToken);
});

// Re-send the original request (all its headers, incl. X-Client-Surface) with a fresh token.
function retryWithToken(original, token) {
  original._retried = true;
  return axios(applyAuthHeaders(original, token));
}

let _refreshing = false;
let _refreshQueue = [];

// While a deploy switches backend instances, a request can briefly get 502/503/504 or no
// response at all. Those are retried with backoff so users don't notice:
// - reads (and a POST its caller marked `retryable`, i.e. a read-only POST): any such failure,
//   including our own JSON 503 ("שגיאה זמנית בשרת" — a transient DB hiccup);
// - writes (PUT/PATCH/DELETE): only when the request never reached the app — no response, or a
//   gateway error page from Render's proxy. Our own 503 on a write means the handler ran and
//   failed part-way; re-sending it could repeat side effects (Outlook sync, activity log).
// A plain POST is never retried, since re-sending a create could duplicate it.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const READ_METHODS = new Set(["get", "head", "options"]);
const WRITE_METHODS = new Set(["put", "patch", "delete"]);

function isTransientFailure(err) {
  const config = err.config;
  if (!config || axios.isCancel(err)) return false;
  const method = (config.method || "get").toLowerCase();
  const isRead = READ_METHODS.has(method) || config.retryable;
  if (!isRead && !WRITE_METHODS.has(method)) return false;
  if (err.response) {
    if (!TRANSIENT_STATUSES.has(err.response.status)) return false;
    if (isRead) return true;
    const fromApp = String(err.response.headers?.["content-type"] || "").includes("application/json");
    return !fromApp;
  }
  // No response: network error or the backend restarting — but not our own 45s timeout,
  // which means the request was slow, not dropped.
  return err.code !== "ECONNABORTED";
}

axios.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (isTransientFailure(err)) {
      const attempt = original._transientAttempt || 0;
      if (attempt < RETRY_DELAYS_MS.length) {
        original._transientAttempt = attempt + 1;
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        return axios(original);
      }
    }
    if (err.response?.status === 401) {
      // Diagnostic: shows "Token expired" or "Invalid token" from backend
      console.warn('[Auth 401]', original?.url, err.response?.data?.detail);

      if (err.response?.data?.detail === "mfa_challenge_required") {
        // The Supabase session itself is still valid (password step passed) — this
        // user just needs to complete (or re-complete, if their trusted-device token
        // expired/was invalid) the TOTP step-up. Don't sign out: send them to the
        // challenge screen on LoginPage, which reuses the existing session.
        clearTrustedDeviceToken();
        // Guard against a reload loop: if some other call fires before the MFA step-up
        // completes while already on /login (LoginPage's own useEffect is already
        // driving the challenge screen from the exact same session), a hard redirect
        // here would reload the page, re-run everything from scratch, and could 401
        // again — repeating forever. Only navigate when we're not already there.
        if (!window.location.pathname.startsWith("/login")) {
          window.location.href = "/login?mfa_required=1";
        }
        return Promise.reject(err);
      }

      if (err.response?.data?.detail === "device_revoked") {
        // Disconnected remotely (אזור אישי / ניהול) — refreshing the Supabase token won't
        // help, since the block is on this device id specifically. Sign out immediately.
        // Clearing the device id is essential, not cosmetic: without it, this same
        // (now-permanently-revoked) id keeps getting sent on every future request —
        // including the next login's own registration attempt — locking this browser out
        // forever instead of just ending this one session.
        try { sessionStorage.setItem("gefen_device_revoked", "1"); } catch { /* best-effort */ }
        clearDeviceId();
        await supabase.auth.signOut();
        window.location.href = "/login";
        return Promise.reject(err);
      }

      if (original._retried) {
        await supabase.auth.signOut();
        window.location.href = "/login";
        return Promise.reject(err);
      }
      if (_refreshing) {
        return new Promise((resolve, reject) => {
          _refreshQueue.push({ resolve, reject });
        }).then(
          token => retryWithToken(original, token),
          // The refresh itself failed — the session is gone.
          () => {
            window.location.href = "/login";
            return Promise.reject(err);
          },
        );
        // A failure of the retried request itself (e.g. a 502 mid-deploy) is passed to the
        // caller as-is; a second 401 is handled by the `_retried` branch above.
      }
      _refreshing = true;
      try {
        const { data, error } = await supabase.auth.refreshSession();
        _refreshing = false;
        if (!error && data.session) {
          const token = data.session.access_token;
          // If Supabase returned the SAME token that got 401 — retrying is pointless.
          const prevToken = String(original.headers?.Authorization || '').replace('Bearer ', '');
          if (token === prevToken) {
            console.warn('[Auth] refreshSession returned same token — forcing re-login');
            _refreshQueue.forEach(p => p.reject());
            _refreshQueue = [];
            await supabase.auth.signOut();
            window.location.href = "/login";
            return Promise.reject(err);
          }
          _refreshQueue.forEach(p => p.resolve(token));
          _refreshQueue = [];
          return retryWithToken(original, token);
        }
      } catch {
        _refreshing = false;
      }
      _refreshQueue.forEach(p => p.reject());
      _refreshQueue = [];
      await supabase.auth.signOut();
      window.location.href = "/login";
      return Promise.reject(err);
    }
    return Promise.reject(err);
  }
);

createRoot(document.getElementById("root")).render(
  <App />
);
