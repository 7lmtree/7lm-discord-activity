import { useEffect, useMemo, useState } from "react";
import { DiscordSDK, Events } from "@discord/embedded-app-sdk";
import {
  api,
  bannerUrl,
  extractList,
  extractPager,
  isAnimeItem,
  isSeriesItem,
  mediaKey,
  metaLine,
  posterUrl,
  ratingValue,
  titleText,
} from "../lib/api.js";
import { avatarUrl } from "../lib/sdk.js";
import { loadLastWatched } from "../lib/history.js";
import MediaRow from "../components/MediaRow.jsx";
import { IconPlay } from "../components/Icons.jsx";

const FILTERS = [
  { id: "all", label: "الكل" },
  { id: "movies", label: "أفلام" },
  { id: "series", label: "مسلسلات" },
  { id: "anime", label: "أنمي" },
];

const SORTS = [
  { id: "trending", label: "ترند" },
  { id: "rating", label: "تقييم" },
];

function dedupeAppend(prev, next) {
  const seen = new Set(prev.map((x) => mediaKey(x)));
  const out = [...prev];
  for (const item of next) {
    const k = mediaKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function sortByRating(list) {
  return [...list].sort((a, b) => (ratingValue(b) || 0) - (ratingValue(a) || 0));
}

export default function ActivityHome({ session, room, onOpenDetail, onSuggest }) {
  const [trending, setTrending] = useState([]);
  const [anime, setAnime] = useState([]);
  const [searchHits, setSearchHits] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [discordPeople, setDiscordPeople] = useState([]);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("trending");
  const [trendPage, setTrendPage] = useState(1);
  const [animePage, setAnimePage] = useState(1);
  const [trendMore, setTrendMore] = useState(false);
  const [animeMore, setAnimeMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState("");
  const [lastWatched, setLastWatched] = useState([]);
  const [bridgeFavs, setBridgeFavs] = useState([]);
  const [bridgeStub, setBridgeStub] = useState(true);

  useEffect(() => {
    setLastWatched(loadLastWatched());
    api.bridgeFavorites().then((res) => {
      setBridgeFavs(extractList(res));
      setBridgeStub(Boolean(res?.stub));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const [trendRes, animeRes] = await Promise.all([
          api.trending(36, 1),
          api.animeTrending(1, 24).catch(() => api.animePopular(1, 24)),
        ]);
        if (cancelled) return;
        setTrending(extractList(trendRes));
        setTrendPage(1);
        setTrendMore(extractPager(trendRes).hasMore);
        const animeList = extractList(animeRes);
        setAnime(animeList);
        setAnimePage(1);
        setAnimeMore(extractPager(animeRes).hasMore);
        if (!animeList.length) setErr((prev) => prev || "قائمة الأنمي فاضيّة مؤقتًا");
      } catch (e) {
        if (!cancelled) setErr(e.message || "فشل تحميل العناوين");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sdk = session.sdk;
    if (!(sdk instanceof DiscordSDK)) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await sdk.commands.getActivityInstanceConnectedParticipants();
        if (alive) setDiscordPeople(res?.participants || []);
      } catch {
        /* optional */
      }
    })();
    const handler = (payload) => setDiscordPeople(payload?.participants || []);
    sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
    return () => {
      alive = false;
      sdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
    };
  }, [session.sdk]);

  const series = useMemo(
    () => trending.filter((x) => isSeriesItem(x) && !isAnimeItem(x)),
    [trending]
  );
  const movies = useMemo(() => {
    const onlyMovies = trending.filter((x) => !isSeriesItem(x) && !isAnimeItem(x));
    if (onlyMovies.length) return onlyMovies;
    return trending.filter((x) => !isAnimeItem(x));
  }, [trending]);

  const sortedTrending = useMemo(
    () => (sort === "rating" ? sortByRating(trending) : trending),
    [trending, sort]
  );
  const sortedAnime = useMemo(
    () => (sort === "rating" ? sortByRating(anime) : anime),
    [anime, sort]
  );
  const sortedSeries = useMemo(
    () => (sort === "rating" ? sortByRating(series) : series),
    [series, sort]
  );
  const sortedMovies = useMemo(
    () => (sort === "rating" ? sortByRating(movies) : movies),
    [movies, sort]
  );

  const hero = sortedTrending[0] || sortedAnime[0] || null;

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) {
      setSearchHits([]);
      return;
    }
    try {
      setSearching(true);
      setErr("");
      const [movieRes, animeRes] = await Promise.all([
        api.search(q.trim()),
        api.animeSearch(q.trim()).catch(() => ({ items: [] })),
      ]);
      let merged = [...extractList(movieRes), ...extractList(animeRes)];
      if (filter === "movies") merged = merged.filter((x) => !isSeriesItem(x) && !isAnimeItem(x));
      if (filter === "series") merged = merged.filter((x) => isSeriesItem(x) && !isAnimeItem(x));
      if (filter === "anime") merged = merged.filter((x) => isAnimeItem(x));
      if (sort === "rating") merged = sortByRating(merged);
      const seen = new Set();
      setSearchHits(
        merged
          .filter((item) => {
            const key = mediaKey(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 48)
      );
    } catch (e2) {
      setErr(e2.message || "فشل البحث");
    } finally {
      setSearching(false);
    }
  }

  async function loadMoreTrending() {
    try {
      setLoadingMore("trend");
      const next = Number(trendPage) + 1;
      const res = await api.trending(24, next);
      setTrending((prev) => dedupeAppend(prev, extractList(res)));
      setTrendPage(next);
      setTrendMore(extractPager(res).hasMore);
    } catch (e) {
      setErr(e.message || "فشل تحميل المزيد");
    } finally {
      setLoadingMore("");
    }
  }

  async function loadMoreAnime() {
    try {
      setLoadingMore("anime");
      const next = Number(animePage) + 1;
      const res = await api.animeTrending(next, 24).catch(() => api.animePopular(next, 24));
      setAnime((prev) => dedupeAppend(prev, extractList(res)));
      setAnimePage(next);
      setAnimeMore(extractPager(res).hasMore);
    } catch (e) {
      setErr(e.message || "فشل تحميل المزيد");
    } finally {
      setLoadingMore("");
    }
  }

  const people =
    (room.participants?.length ? room.participants : null) ||
    discordPeople.map((p) => ({
      userId: p.id,
      username: p.nickname || p.username || p.global_name || "User",
      avatar: p.avatar
        ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=64`
        : avatarUrl(p),
    }));

  const queue = room.state?.queue || [];

  return (
    <div className="browse">
      <header className="nav">
        <div className="nav-brand">
          <span className="nav-mark">7</span>
          <strong>
            7LM<span>WATCH</span>
          </strong>
        </div>
        <form className="nav-search" onSubmit={search}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث في الأفلام والأنمي…"
          />
          <button type="submit">{searching ? "…" : "بحث"}</button>
        </form>
        <div className="nav-meta">
          <span className={room.youAreHost ? "badge host" : "badge"}>
            {room.youAreHost ? "Host" : "Viewer"}
          </span>
          <div className="avatar-stack" title="في الجلسة">
            {people.slice(0, 5).map((p) =>
              p.avatar ? (
                <img key={p.userId} className="avatar" src={p.avatar} alt="" />
              ) : (
                <span key={p.userId} className="avatar" />
              )
            )}
          </div>
        </div>
      </header>

      <div className="browse-toolbar">
        <div className="chip-row">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip ${filter === f.id ? "on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="chip-row">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip ${sort === s.id ? "on" : ""}`}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="error-box browse-error">{err}</div>}

      {queue.length > 0 && (
        <div className="queue-banner">
          <strong>الطابور ({queue.length})</strong>
          <span>{queue.map((qItem) => qItem.title).slice(0, 3).join(" · ")}</span>
        </div>
      )}

      {!q.trim() && hero && filter === "all" && (
        <section
          className="hero"
          style={{ "--hero-image": `url(${bannerUrl(hero) || posterUrl(hero)})` }}
        >
          <div className="hero-shade" />
          <div className="hero-copy">
            <p className="hero-kicker">7LM Watch Party</p>
            <h1>{titleText(hero)}</h1>
            <p className="hero-meta">{metaLine(hero)}</p>
            <p className="hero-desc">
              افتح التفاصيل لاختيار الموسم/الحلقة والجودة — الهوست يتحكّم والكل يتزامن.
            </p>
            <div className="hero-actions">
              <button type="button" className="primary play-cta" onClick={() => onOpenDetail(hero)}>
                <IconPlay size={16} /> عرض التفاصيل
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="browse-body">
        {q.trim() && (
          <MediaRow
            title={`نتائج «${q.trim()}»`}
            items={searchHits}
            loading={searching}
            onPick={onOpenDetail}
          />
        )}
        {!q.trim() && (
          <>
            {lastWatched.length > 0 && (filter === "all" || filter === "movies") && (
              <MediaRow
                title="شاهدت مؤخرًا"
                items={lastWatched.map((x) => ({
                  ...x,
                  id: x.mediaId,
                  subjectId: x.mediaId,
                  poster: x.poster,
                  title: x.title,
                  type: x.kind === "anime" ? "anime" : x.kind,
                }))}
                onPick={onOpenDetail}
              />
            )}
            {!bridgeStub && bridgeFavs.length > 0 && (
              <MediaRow title="مفضّلات 7LM" items={bridgeFavs} onPick={onOpenDetail} />
            )}
            {(filter === "all" || filter === "movies" || filter === "series") && (
              <MediaRow
                title="ترند الآن"
                items={
                  filter === "movies"
                    ? sortedMovies
                    : filter === "series"
                      ? sortedSeries
                      : sortedTrending
                }
                loading={loading}
                onPick={onOpenDetail}
                hasMore={trendMore && filter !== "anime"}
                loadingMore={loadingMore === "trend"}
                onLoadMore={loadMoreTrending}
              />
            )}
            {(filter === "all" || filter === "anime") && (
              <MediaRow
                title="أنمي"
                items={sortedAnime}
                loading={loading}
                onPick={onOpenDetail}
                hasMore={animeMore}
                loadingMore={loadingMore === "anime"}
                onLoadMore={loadMoreAnime}
              />
            )}
            {filter === "all" && (
              <>
                <MediaRow title="مسلسلات" items={sortedSeries.slice(0, 24)} loading={loading} onPick={onOpenDetail} />
                <MediaRow title="أفلام" items={sortedMovies.slice(0, 24)} loading={loading} onPick={onOpenDetail} />
              </>
            )}
            {bridgeStub && (
              <p className="muted-note bridge-note">
                ربط الحساب مع 7lmmovie (مفضّلات/سجل) جاهز كـ stub — فعّل ACCOUNT_API_BASE عند توفر الـ API.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
