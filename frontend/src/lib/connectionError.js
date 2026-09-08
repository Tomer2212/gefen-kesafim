// Classify a failed API request into an accurate Hebrew message.
//
// Motivation: a network path that tampers with HTTPS (ISP "security", antivirus
// with HTTPS scanning, corporate proxy, filtering DNS) can strip CORS headers or
// block our requests entirely. The browser then reports a bare "Network Error"
// with no response object — historically shown to the user as "ודא שהשרת פועל",
// which sends them down the wrong path. This helper separates: device offline /
// request timeout / network-path block / real server 5xx.

const API_BASE = import.meta.env.VITE_API_URL || "";

const MSG_BLOCKED =
  "לא הצלחנו להגיע לשרת. אם אתרים אחרים נטענים אצלך כרגיל, סביר שספק האינטרנט, " +
  "אנטי-וירוס או חומת אש חוסמים את הגישה לגפן AI. נסו: רשת אחרת (למשל נקודה חמה " +
  "מהנייד), השבתת VPN / סינון תוכן, או פנייה לספק האינטרנט לשחרור החסימה לכתובת gefenai.co.il.";

/**
 * Synchronous classification. Returns { kind, message }.
 *   offline  – the device has no internet connection
 *   timeout  – the request was sent but the server did not answer in time
 *   server   – the server answered with 5xx
 *   http     – the server answered with another error status (4xx)
 *   blocked  – no response, device is online, not a timeout → network path issue
 */
export function describeConnectionError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { kind: "offline", message: "אין חיבור לאינטרנט במכשיר שלך. בדקו את החיבור ונסו שוב." };
  }

  const isTimeout = err?.code === "ECONNABORTED" || /timeout/i.test(err?.message || "");
  if (isTimeout) {
    return { kind: "timeout", message: "השרת לא הגיב בזמן — ייתכן עומס זמני. המתינו רגע ונסו לרענן." };
  }

  const status = err?.response?.status;
  if (status >= 500) {
    return { kind: "server", message: `שגיאה בשרת (${status}) — נסו לרענן את הדף בעוד מספר שניות.` };
  }
  if (status) {
    return { kind: "http", message: `שגיאה בבקשה (${status}).` };
  }

  return { kind: "blocked", message: MSG_BLOCKED };
}

/**
 * Is the API server reachable at all? Uses mode:"no-cors" so it resolves even when
 * a middlebox strips CORS headers from real (authenticated) responses — which is the
 * exact signature we want to tell apart from "server is actually down".
 */
export async function serverIsReachable(timeoutMs = 4000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetch(`${API_BASE}/health`, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Async classification: same as describeConnectionError, but for the "blocked" case
 * it probes /health to sharpen the verdict into:
 *   blocked-cors – server responds, but the network strips part of the traffic (CORS)
 *   unreachable  – server does not respond at all (down, or fully blocked)
 */
export async function diagnoseConnectionError(err) {
  const base = describeConnectionError(err);
  if (base.kind !== "blocked") return base;

  const reachable = await serverIsReachable();
  if (reachable) {
    return {
      kind: "blocked-cors",
      message:
        "השרת פעיל, אך רשת האינטרנט שלך חוסמת חלק מהתקשורת איתו. זה כמעט תמיד נגרם מספק " +
        "האינטרנט, אנטי-וירוס עם סריקת HTTPS, או חומת אש. נסו רשת אחרת (נקודה חמה מהנייד), " +
        "או פנו לספק האינטרנט לשחרור החסימה לכתובת gefenai.co.il.",
    };
  }
  return {
    kind: "unreachable",
    message:
      "לא ניתן להגיע לשרת כרגע. ייתכן שהשרת אינו זמין זמנית, או שהרשת שלך חוסמת אותו לחלוטין. " +
      "נסו לרענן בעוד מספר דקות, או להתחבר מרשת אחרת (למשל נקודה חמה מהנייד).",
  };
}
