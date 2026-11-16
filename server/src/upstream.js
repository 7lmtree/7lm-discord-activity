/**
 * Fetch with retries for Render free-tier cold starts (502/503/504 / network).
 */
export async function fetchWithRetry(url, options = {}, { retries = 3, timeoutMs = 55_000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if ([502, 503, 504].includes(res.status) && attempt < retries) {
        await sleep(900 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt >= retries) break;
      await sleep(900 * (attempt + 1));
    }
  }
  throw lastErr || new Error("Upstream fetch failed");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
