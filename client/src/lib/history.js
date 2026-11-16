const KEY = "7lm_last_watched_v1";
const MAX = 24;

export function loadLastWatched() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveLastWatched(entry) {
  if (!entry?.mediaId && !entry?.title) return loadLastWatched();
  try {
    const prev = loadLastWatched();
    const key = String(entry.mediaId || entry.title);
    const next = [
      {
        mediaId: entry.mediaId || null,
        kind: entry.kind || "movie",
        title: entry.title || "Untitled",
        poster: entry.poster || null,
        season: entry.season ?? null,
        episode: entry.episode ?? null,
        animeType: entry.animeType || null,
        quality: entry.quality || null,
        at: Date.now(),
      },
      ...prev.filter((x) => String(x.mediaId || x.title) !== key),
    ].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadLastWatched();
  }
}
