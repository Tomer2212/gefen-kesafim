import { useEffect, useState } from "react";
import axios from "axios";

// Whether the org has connected an AI meeting-summary integration (OpenAI/Whisper
// API key) via "ניהול אינטגרציות". Used to gate the "סיכום פגישה" button across
// all three meetings surfaces (כרטיס בית ספר / אזור אישי / ניהול). Defaults to
// `true` while loading so the button doesn't flicker into a disabled state on
// every page load — it settles to the real value once the request resolves.
export function useAiSummaryEnabled() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    axios.get("/schools/meeting-summary-settings")
      .then(r => { if (!cancelled) setEnabled(!!r.data?.enabled && !!r.data?.has_api_key); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  return enabled;
}
