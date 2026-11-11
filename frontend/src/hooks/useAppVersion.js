import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// True once /version.json (written by the build, see vite.config.js) names a build other than
// the one this tab is running — i.e. a deploy happened while the tab stayed open.
// Fetched with plain fetch from the static site itself, not axios (whose baseURL is the API).
export function useAppVersion() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    let cancelled = false;

    async function check() {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        if (!cancelled && version && version !== __APP_VERSION__) setStale(true);
      } catch { /* offline or mid-deploy — try again next time */ }
    }

    const timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return stale;
}
