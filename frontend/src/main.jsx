import { createRoot } from "react-dom/client";
import axios from "axios";
import "./index.css";
import App from "./App.jsx";
import { supabase } from "./lib/supabase";
import { getDeviceId, clearDeviceId } from "./lib/deviceSession";

if (import.meta.env.VITE_API_URL) {
  axios.defaults.baseURL = import.meta.env.VITE_API_URL;
}
axios.defaults.timeout = 45000;

// Module-level token mirror — updated synchronously by onAuthStateChange.
let _currentToken = null;

supabase.auth.getSession().then(({ data: { session } }) => {
  _currentToken = session?.access_token ?? null;
});

supabase.auth.onAuthStateChange((_event, session) => {
  _currentToken = session?.access_token ?? null;
});

// Attach Supabase JWT + this browser's device id to every outgoing request (synchronous).
axios.interceptors.request.use((config) => {
  if (config._retried) return config;
  if (_currentToken) {
    config.headers.Authorization = `Bearer ${_currentToken}`;
  }
  config.headers["X-Device-Id"] = getDeviceId();
  return config;
});

let _refreshing = false;
let _refreshQueue = [];

axios.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401) {
      // Diagnostic: shows "Token expired" or "Invalid token" from backend
      console.warn('[Auth 401]', original?.url, err.response?.data?.detail);

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
        }).then(token => {
          return axios({
            method: original.method,
            url: original.url,
            baseURL: original.baseURL,
            data: original.data,
            params: original.params,
            timeout: original.timeout,
            responseType: original.responseType,
            headers: { Authorization: `Bearer ${token}` },
            _retried: true,
          });
        }).catch(() => {
          window.location.href = "/login";
          return Promise.reject(err);
        });
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
          return axios({
            method: original.method,
            url: original.url,
            baseURL: original.baseURL,
            data: original.data,
            params: original.params,
            timeout: original.timeout,
            responseType: original.responseType,
            headers: { Authorization: `Bearer ${token}` },
            _retried: true,
          });
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
