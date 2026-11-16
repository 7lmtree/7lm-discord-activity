/**
 * Ping Render free-tier services so Discord Activity doesn't hit cold-start 502.
 * Used by GitHub Actions and optional Render Cron Job.
 */
const targets = [
  "https://sevenlm-discord-activity.onrender.com/api/health",
  "https://emnex-movies-backend.onrender.com/api/health",
];

async function ping(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "7lm-keepalive/1" },
      signal: AbortSignal.timeout(90_000),
    });
    const ms = Date.now() - started;
    const text = await res.text();
    console.log(`${res.status} ${ms}ms ${url} ${text.slice(0, 80)}`);
    return res.ok;
  } catch (err) {
    console.error(`FAIL ${Date.now() - started}ms ${url} :: ${err.message}`);
    return false;
  }
}

const results = [];
for (const url of targets) {
  results.push(await ping(url));
}
process.exit(results.every(Boolean) ? 0 : 1);
