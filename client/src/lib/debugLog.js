/** Debug-mode ingest (session 78922e). Dual-write: local + Activity telemetry. */
function apiBaseForDebug() {
  try {
    const env = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
    if (env) return env;
    if (typeof window !== "undefined" && /\.discordsays\.com$/i.test(window.location.hostname)) {
      return "/.proxy";
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function debugLog(hypothesisId, location, message, data = {}) {
  const payload = {
    sessionId: "78922e",
    runId: "pre-fix",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch("http://127.0.0.1:7570/ingest/c56d912b-8aee-4e82-9091-3572c06f386e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "78922e",
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  try {
    fetch(`${apiBaseForDebug()}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        type: "debug",
        error: JSON.stringify(payload).slice(0, 280),
        title: `${hypothesisId}:${message}`.slice(0, 120),
        kind: "debug",
      }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
  // #endregion
}
