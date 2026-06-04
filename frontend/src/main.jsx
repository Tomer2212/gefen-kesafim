import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import "./index.css";
import App from "./App.jsx";
import { supabase } from "./lib/supabase";

if (import.meta.env.VITE_API_URL) {
  axios.defaults.baseURL = import.meta.env.VITE_API_URL;
}

// Attach Supabase JWT to every request
axios.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

let _refreshing = false;
let _refreshQueue = [];

axios.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retried) {
      original._retried = true;
      if (_refreshing) {
        // Wait for the ongoing refresh to finish
        return new Promise((resolve, reject) => {
          _refreshQueue.push({ resolve, reject });
        }).then(token => {
          original.headers.Authorization = `Bearer ${token}`;
          return axios(original);
        }).catch(() => {
          window.location.href = "/login";
          return Promise.reject(err);
        });
      }
      _refreshing = true;
      const { data, error } = await supabase.auth.refreshSession();
      _refreshing = false;
      if (!error && data.session) {
        const token = data.session.access_token;
        _refreshQueue.forEach(p => p.resolve(token));
        _refreshQueue = [];
        original.headers.Authorization = `Bearer ${token}`;
        return axios(original);
      }
      _refreshQueue.forEach(p => p.reject());
      _refreshQueue = [];
      await supabase.auth.signOut();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
