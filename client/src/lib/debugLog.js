/** Debug-mode NDJSON ingest (session 78922e). Safe no-op if blocked. */
export function debugLog(hypothesisId, location, message, data = {}) {
  // #region agent log
  fetch("http://127.0.0.1:7570/ingest/c56d912b-8aee-4e82-9091-3572c06f386e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "78922e",
    },
    body: JSON.stringify({
      sessionId: "78922e",
      runId: "pre-fix",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
