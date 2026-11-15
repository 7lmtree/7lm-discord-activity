const ENV_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

/** Inside Discord iframe use relative /.proxy paths; locally Vite proxies /api */
export function apiBase() {
  if (ENV_BASE) return ENV_BASE;
  if (typeof window !== "undefined" && window.location.hostname.endsWith("discordsays.com")) {
    return "/.proxy";
  }
  return "";
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  exchangeToken: (code) =>
    request("/api/discord/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  trending: (perPage = 24) => request(`/api/trending?perPage=${perPage}`),
  search: (q, page = 1) => request(`/api/search/${encodeURIComponent(q)}?page=${page}`),
  movie: (id) => request(`/api/movie/${id}`),
  sources: (id, season, episode) => {
    const q = new URLSearchParams();
    if (season != null) q.set("season", season);
    if (episode != null) q.set("episode", episode);
    const qs = q.toString();
    return request(`/api/sources/${id}${qs ? `?${qs}` : ""}`);
  },
};

export function posterUrl(item) {
  return (
    item?.poster ||
    item?.coverVerticalUrl ||
    item?.coverHorizontalUrl ||
    item?.image ||
    item?.cover ||
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
