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

function inDiscordFrame() {
  return typeof window !== "undefined" && /\.discordsays\.com$/i.test(window.location.hostname);
}

/** Discord Activity CSP blocks external image hosts — route through our /api/img proxy */
export function mediaSrc(url) {
  const raw = pickUrl(url);
  if (!raw) return "";
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  if (raw.includes("/api/img?")) return raw;
  // Local/static assets stay as-is
  if (raw.startsWith("/art/") || raw.startsWith("./art/")) return raw;
  try {
    const abs = raw.startsWith("//") ? `https:${raw}` : raw;
    if (!/^https?:\/\//i.test(abs)) return raw;
    // Discord CDN avatars are allowed by CSP exceptions
    if (/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//i.test(abs)) return abs;
    return `${apiBase()}/api/img?u=${encodeURIComponent(abs)}`;
  } catch {
    return raw;
  }
}

/**
 * Rewrite stream hosts to Discord URL Mapping prefixes.
 * Requires Portal mappings (see STREAM_URL_MAPPINGS).
 */
export function streamSrc(url) {
  const raw = pickUrl(url);
  if (!raw || !inDiscordFrame()) return raw;
  try {
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    const host = u.hostname.toLowerCase();
    const rest = `${u.pathname}${u.search}${u.hash}`;
    if (host === "api.emnexmovies.cc") return `${apiBase()}/emnex${rest}`;
    if (host === "api.emnexanime.site") return `${apiBase()}/emnex-anime${rest}`;
    if (host === "bcdnw.hakunaymatata.com") return `${apiBase()}/stream-cdn${rest}`;
    if (host === "fetch.nexabloom.top") return `${apiBase()}/nexabloom${rest}`;
    if (host.endsWith(".hakunaymatata.com")) {
      const sub = host.replace(/\.hakunaymatata\.com$/, "");
      return `${apiBase()}/hakuna/${sub}${rest}`;
    }
    if (host.endsWith(".nexabloom.top")) {
      const sub = host.replace(/\.nexabloom\.top$/, "");
      return `${apiBase()}/nexa/${sub}${rest}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

/** Mappings passed to Discord SDK patchUrlMappings + Developer Portal */
export const STREAM_URL_MAPPINGS = [
  { prefix: "/emnex", target: "api.emnexmovies.cc" },
  { prefix: "/emnex-anime", target: "api.emnexanime.site" },
  { prefix: "/stream-cdn", target: "bcdnw.hakunaymatata.com" },
  { prefix: "/nexabloom", target: "fetch.nexabloom.top" },
  { prefix: "/hakuna/{subdomain}", target: "{subdomain}.hakunaymatata.com" },
  { prefix: "/nexa/{subdomain}", target: "{subdomain}.nexabloom.top" },
];

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
  animeTrending: (page = 1, perPage = 24) =>
    request(`/api/anime/trending?perPage=${perPage}&page=${page}`, {}, { retries: 2 }),
  animePopular: (page = 1, perPage = 24) =>
    request(`/api/anime/popular?perPage=${perPage}&page=${page}`, {}, { retries: 2 }),
  animeSearch: (q, page = 1, perPage = 24) =>
    request(
      `/api/anime/search/${encodeURIComponent(q)}?perPage=${perPage}&page=${page}`,
      {},
      { retries: 2 }
    ),
  movie: (id) => request(`/api/movie/${id}`),
  sources: (id, season, episode) => {
    const q = new URLSearchParams();
    if (season != null) q.set("season", season);
    if (episode != null) q.set("episode", episode);
    const qs = q.toString();
    return request(`/api/sources/${id}${qs ? `?${qs}` : ""}`, {}, { retries: 2 });
  },
  animeSources: (id, ep = 1, type = "sub") =>
    request(
      `/api/anime/sources/${encodeURIComponent(id)}/${encodeURIComponent(ep)}?type=${encodeURIComponent(type)}`,
      {},
      { retries: 2 }
    ),
};

export function posterUrl(item) {
  return mediaSrc(
    pickUrl(item?.poster) ||
      pickUrl(item?.coverVerticalUrl) ||
      pickUrl(item?.coverHorizontalUrl) ||
      pickUrl(item?.cover) ||
      pickUrl(item?.image) ||
      pickUrl(item?.thumbnail) ||
      ""
  );
}

export function bannerUrl(item) {
  const raw =
    pickUrl(item?.banner) ||
    pickUrl(item?.coverHorizontalUrl) ||
    pickUrl(item?.poster) ||
    pickUrl(item?.cover) ||
    "";
  return mediaSrc(raw) || posterUrl(item);
}

export function titleText(item) {
  return (
    item?.titles?.english ||
    item?.titles?.romaji ||
    item?.title ||
    item?.name ||
    item?.localName ||
    "Untitled"
  );
}

export function isAnimeItem(item) {
  const poster = typeof item?.poster === "string" ? item.poster : item?.poster?.url || "";
  return (
    item?.type === "anime" ||
    Boolean(item?.idMal) ||
    (Boolean(item?.format) && Boolean(item?.episodes != null) && /anilist/i.test(poster))
  );
}

export function isSeriesItem(item) {
  if (isAnimeItem(item)) return true;
  const type = String(item?.type || item?.category || item?.contentType || "").toLowerCase();
  return (
    item?.subjectType === 2 ||
    item?.domainType === 1 ||
    type === "tv" ||
    type === "series" ||
    type === "show" ||
    Boolean(item?.episodeCount || item?.totalEpisodes || item?.seasons || item?.seasonCount)
  );
}

export function mediaKey(item) {
  return String(
    item?.id || item?.movieId || item?.contentId || item?.subjectId || item?.detailPath || titleText(item)
  );
}

export function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.recommendItems)) return payload.recommendItems;
  return [];
}

export function metaLine(item) {
  const bits = [];
  if (item?.imdbRatingValue || item?.rating) bits.push(`${item.imdbRatingValue || item.rating}`);
  if (item?.releaseDate) bits.push(String(item.releaseDate).slice(0, 4));
  else if (item?.year) bits.push(String(item.year));
  if (item?.genre) bits.push(String(item.genre).split(",")[0]);
  else if (Array.isArray(item?.genres) && item.genres[0]) bits.push(item.genres[0]);
  if (isSeriesItem(item)) bits.push(isAnimeItem(item) ? "Anime" : "Series");
  else bits.push("Movie");
  return bits.filter(Boolean).join(" · ");
}

export function pickSourceUrl(payload) {
  // Anime sources often return { hls } instead of a sources[] list
  if (payload?.hls) return String(payload.hls);
  if (typeof payload?.stream === "string") return payload.stream;

  const list = Array.isArray(payload)
    ? payload
    : payload?.sources?.length
      ? payload.sources
      : payload?.processedSources?.length
        ? payload.processedSources
        : payload?.data?.length
          ? payload.data
          : [];
  const best =
    [...list].sort((a, b) => (b.resolution || 0) - (a.resolution || 0))[0] || list[0] || null;
  return (
    best?.url ||
    best?.streamUrl ||
    best?.file ||
    best?.src ||
    best?.hls ||
    payload?.url ||
    payload?.streamUrl ||
    ""
  );
}

export async function resolvePlayable(item) {
  const id = item.id || item.movieId || item.contentId || item.subjectId || item.detailPath;
  if (!id) throw new Error("عنوان بدون معرف");

  if (isAnimeItem(item)) {
    const sources = await api.animeSources(id, 1);
    const url = streamSrc(pickSourceUrl(sources));
    if (!url) throw new Error("ما لقيت مصدر تشغيل للأنمي");
    return {
      mediaId: String(id),
      kind: "anime",
      title: titleText(item),
      poster: posterUrl(item),
      banner: bannerUrl(item),
      sourceUrl: url,
      playing: true,
      currentTime: 0,
      season: 1,
      episode: 1,
    };
  }

  const series = isSeriesItem(item);
  const sources = await api.sources(id, series ? 1 : undefined, series ? 1 : undefined);
  let url = pickSourceUrl(sources);

  // Some titles only resolve after season/episode even if classified poorly
  if (!url && !series) {
    const retry = await api.sources(id, 1, 1);
    url = pickSourceUrl(retry);
  }

  url = streamSrc(url);
  if (!url) throw new Error("ما لقيت مصدر تشغيل");
  return {
    mediaId: String(id),
    kind: series ? "tv" : "movie",
    title: titleText(item),
    poster: posterUrl(item),
    banner: bannerUrl(item),
    sourceUrl: url,
    playing: true,
    currentTime: 0,
    season: series ? 1 : null,
    episode: series ? 1 : null,
  };
}
