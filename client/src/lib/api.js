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
  if (raw.startsWith("/art/") || raw.startsWith("./art/")) return raw;
  try {
    const abs = raw.startsWith("//") ? `https:${raw}` : raw;
    if (!/^https?:\/\//i.test(abs)) return raw;
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
        const cold =
          [502, 503, 504].includes(res.status) ||
          /يستيقظ|upstream|bad gateway|unavailable/i.test(message);
        if (cold && attempt < retries) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        if (cold) {
          throw new Error("الخادم يستيقظ — افتح الأكتيفتي مرة ثانية بعد 10–20 ثانية");
        }
        throw new Error(message);
      }
      return res.json();
    } catch (err) {
      lastError = err;
      const retryable =
        err?.name === "AbortError" ||
        /failed to fetch|network|aborted|timeout|يستيقظ/i.test(String(err?.message || ""));
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    }
  }
  const msg =
    lastError?.name === "AbortError" ? "انتهت مهلة الاتصال — حاول مرة ثانية" : lastError?.message;
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
  trending: (perPage = 24, page = 1) =>
    request(`/api/trending?perPage=${perPage}&page=${page}`, {}, { retries: 3 }),
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
  translateAr: (text) =>
    request(
      "/api/translate/ar",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        timeoutMs: 15000,
      },
      { retries: 1 }
    ),
  telemetry: (payload) =>
    request(
      "/api/telemetry",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
        timeoutMs: 8000,
      },
      { retries: 0 }
    ).catch(() => null),
  /** Account bridge — safe stubs when upstream unavailable */
  bridgeFavorites: () => request("/api/bridge/favorites", {}, { retries: 0 }).catch(() => ({ items: [], stub: true })),
  bridgeHistory: () => request("/api/bridge/history", {}, { retries: 0 }).catch(() => ({ items: [], stub: true })),
  bridgePushHistory: (entry) =>
    request(
      "/api/bridge/history",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry || {}),
        timeoutMs: 8000,
      },
      { retries: 0 }
    ).catch(() => ({ ok: false, stub: true })),
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

export function descriptionText(item) {
  return (
    item?.description ||
    item?.overview ||
    item?.summary ||
    item?.plot ||
    item?.explains ||
    ""
  );
}

export function isAnimeItem(item) {
  const poster = typeof item?.poster === "string" ? item.poster : item?.poster?.url || "";
  return (
    item?.type === "anime" ||
    item?.kind === "anime" ||
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

export function resolveMediaId(item) {
  return String(
    item?.subjectId || item?.id || item?.movieId || item?.contentId || item?.detailPath || ""
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

export function extractPager(payload) {
  if (payload?.pager) {
    return {
      hasMore: Boolean(payload.pager.hasMore),
      nextPage: payload.pager.nextPage || null,
      page: Number(payload.pager.page || 1),
    };
  }
  if (payload?.pageInfo) {
    return {
      hasMore: Boolean(payload.pageInfo.hasNextPage),
      nextPage: payload.pageInfo.hasNextPage
        ? Number(payload.pageInfo.currentPage || 1) + 1
        : null,
      page: Number(payload.pageInfo.currentPage || 1),
    };
  }
  return { hasMore: false, nextPage: null, page: 1 };
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

export function ratingValue(item) {
  const raw = item?.imdbRatingValue || item?.rating || item?.score;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function extractSeasonList(detail) {
  const raw =
    detail?.seasons?.seasons ||
    detail?.seasons ||
    detail?.seasonList ||
    detail?.season ||
    [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({
      se: Number(s.se ?? s.season ?? s.number ?? s.id ?? 1),
      maxEp: Number(s.maxEp ?? s.episodeCount ?? s.total ?? s.episodes ?? 1),
    }))
    .filter((s) => s.se > 0 && s.maxEp > 0);
}

export function extractSubtitles(payload) {
  const raw = Array.isArray(payload?.subtitles)
    ? payload.subtitles
    : Array.isArray(payload?.subs)
      ? payload.subs
      : Array.isArray(payload?.tracks)
        ? payload.tracks
        : [];
  return raw
    .map((t, i) => {
      const url = t?.url || t?.file || t?.src || t?.vtt || "";
      if (!url) return null;
      const lang = String(t.lang || t.language || t.label || t.srclang || `Track ${i + 1}`);
      const srclang = String(t.srclang || t.code || lang)
        .slice(0, 8)
        .toLowerCase()
        .replace(/[^a-z-]/g, "") || "und";
      return {
        label: lang,
        lang,
        srclang,
        url: streamSrc(String(url)),
        default: Boolean(t.default) || i === 0,
      };
    })
    .filter(Boolean);
}

export function extractSourceList(payload) {
  if (payload?.hls) {
    return [
      {
        label: payload.type ? String(payload.type).toUpperCase() : "HLS",
        quality: payload.provider || "auto",
        resolution: 0,
        url: String(payload.hls),
      },
    ];
  }
  const list = Array.isArray(payload)
    ? payload
    : payload?.processedSources?.length
      ? payload.processedSources
      : payload?.sources?.length
        ? payload.sources
        : payload?.data?.length
          ? payload.data
          : [];
  return list
    .map((s, i) => {
      const url = s?.url || s?.streamUrl || s?.file || s?.src || s?.hls || "";
      if (!url) return null;
      const resolution = Number(s.resolution || s.quality || 0) || 0;
      const quality = s.quality || (resolution ? `${resolution}p` : `Source ${i + 1}`);
      return {
        label: String(quality),
        quality: String(quality),
        resolution,
        url: String(url),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
}

export function pickSourceUrl(payload, preferredQuality) {
  const list = extractSourceList(payload);
  if (!list.length) {
    return (
      (typeof payload?.stream === "string" && payload.stream) ||
      payload?.url ||
      payload?.streamUrl ||
      ""
    );
  }
  if (preferredQuality) {
    const hit = list.find(
      (s) =>
        String(s.quality).toLowerCase() === String(preferredQuality).toLowerCase() ||
        String(s.label).toLowerCase() === String(preferredQuality).toLowerCase()
    );
    if (hit) return hit.url;
  }
  return list[0].url;
}

export function needsArabicHelp(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return !/[\u0600-\u06FF]/.test(t);
}

export async function maybeTranslateDescription(text) {
  if (!needsArabicHelp(text)) return { text: text || "", translated: false };
  try {
    const res = await api.translateAr(text);
    return { text: res?.text || text, translated: Boolean(res?.translated) };
  } catch {
    return { text, translated: false };
  }
}

export async function resolvePlayable(item, opts = {}) {
  const id = resolveMediaId(item);
  if (!id) throw new Error("عنوان بدون معرف");

  const season = opts.season ?? 1;
  const episode = opts.episode ?? 1;
  const animeType = opts.animeType || "sub";
  const quality = opts.quality || null;

  if (isAnimeItem(item) || opts.kind === "anime") {
    const sources = await api.animeSources(id, episode, animeType);
    const list = extractSourceList(sources);
    const subs = extractSubtitles(sources);
    const url = streamSrc(pickSourceUrl(sources, quality));
    if (!url) throw new Error("ما لقيت مصدر تشغيل للأنمي");
    return {
      mediaId: String(id),
      kind: "anime",
      title: titleText(item),
      poster: posterUrl(item),
      banner: bannerUrl(item),
      description: descriptionText(item),
      sourceUrl: url,
      sources: list.map((s) => ({ ...s, url: streamSrc(s.url) })),
      subtitles: subs,
      subtitleLang: subs.find((s) => s.default)?.lang || subs[0]?.lang || null,
      playing: true,
      currentTime: 0,
      season: 1,
      episode: Number(episode) || 1,
      maxEpisode: Number(item?.episodes || opts.maxEpisode || episode) || episode,
      seasons: [{ se: 1, maxEp: Number(item?.episodes || opts.maxEpisode || episode) || episode }],
      animeType,
      quality: quality || list[0]?.quality || null,
    };
  }

  const series = isSeriesItem(item) || opts.kind === "tv";
  const sources = await api.sources(
    id,
    series ? season : undefined,
    series ? episode : undefined
  );
  let list = extractSourceList(sources);
  let url = pickSourceUrl(sources, quality);

  if (!url && !series) {
    const retry = await api.sources(id, 1, 1);
    list = extractSourceList(retry);
    url = pickSourceUrl(retry, quality);
  }

  url = streamSrc(url);
  if (!url) throw new Error("ما لقيت مصدر تشغيل");
  const subs = extractSubtitles(sources);
  return {
    mediaId: String(id),
    kind: series ? "tv" : "movie",
    title: titleText(item),
    poster: posterUrl(item),
    banner: bannerUrl(item),
    description: descriptionText(item),
    sourceUrl: url,
    sources: list.map((s) => ({ ...s, url: streamSrc(s.url) })),
    subtitles: subs,
    subtitleLang: subs.find((s) => s.default)?.lang || subs[0]?.lang || null,
    playing: true,
    currentTime: 0,
    season: series ? Number(season) || 1 : null,
    episode: series ? Number(episode) || 1 : null,
    maxEpisode: opts.maxEpisode ?? null,
    seasons: opts.seasons || null,
    animeType: null,
    quality: quality || list[0]?.quality || null,
  };
}
