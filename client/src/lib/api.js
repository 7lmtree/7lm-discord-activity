const ENV_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

/** Inside Discord iframe use relative /.proxy paths; locally Vite proxies /api */
export function apiBase() {
  if (ENV_BASE) return ENV_BASE;
  if (typeof window !== "undefined" && window.location.hostname.endsWith("discordsays.com")) {
    return "/.proxy";
  }
  return "";
}

function pickUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.url || value.src || value.href || value.vertical || value.horizontal || "";
  }
  return "";
}

async function request(path, options = {}, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
      const res = await fetch(`${apiBase()}${path}`, {
        headers: { Accept: "application/json", ...(options.headers || {}) },
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        let message = `فشل الطلب (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = String(body.error);
          else if (body?.error_description) message = String(body.error_description);
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      return res.json();
    } catch (err) {
      lastError = err;
      const retryable =
        err?.name === "AbortError" ||
        /failed to fetch|network|aborted|timeout/i.test(String(err?.message || ""));
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  const msg = lastError?.name === "AbortError" ? "انتهت مهلة الاتصال — حاول مرة ثانية" : lastError?.message;
  throw new Error(msg || "فشل الاتصال");
}

export const api = {
  exchangeToken: (code) =>
    request(
      "/api/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        timeoutMs: 20000,
      },
      { retries: 1 }
    ),
  trending: (perPage = 24) => request(`/api/trending?perPage=${perPage}`, {}, { retries: 3 }),
  search: (q, page = 1) =>
    request(`/api/search/${encodeURIComponent(q)}?page=${page}`, {}, { retries: 2 }),
  movie: (id) => request(`/api/movie/${id}`),
  sources: (id, season, episode) => {
    const q = new URLSearchParams();
    if (season != null) q.set("season", season);
    if (episode != null) q.set("episode", episode);
    const qs = q.toString();
    return request(`/api/sources/${id}${qs ? `?${qs}` : ""}`, {}, { retries: 2 });
  },
};

export function posterUrl(item) {
  return (
    pickUrl(item?.poster) ||
    pickUrl(item?.coverVerticalUrl) ||
    pickUrl(item?.coverHorizontalUrl) ||
    pickUrl(item?.cover) ||
    pickUrl(item?.image) ||
    pickUrl(item?.thumbnail) ||
    ""
  );
}

export function titleText(item) {
  return item?.title || item?.name || item?.localName || "Untitled";
}

export function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.recommendItems)) return payload.recommendItems;
  return [];
}
