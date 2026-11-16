/** Lightweight playback / source telemetry (ring buffer + console) */

const MAX = 200;
const events = [];

export function recordTelemetry(event) {
  const row = {
    ...event,
    at: new Date().toISOString(),
  };
  events.push(row);
  if (events.length > MAX) events.shift();
  const kind = event?.type || "event";
  console.log(
    `[telemetry] ${kind}`,
    event?.sourceType || "",
    event?.loadMs != null ? `${event.loadMs}ms` : "",
    event?.error || event?.title || ""
  );
  return row;
}

export function listTelemetry(limit = 50) {
  return events.slice(-Math.min(MAX, Math.max(1, limit)));
}
