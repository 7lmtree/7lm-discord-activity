import { useEffect, useMemo, useState } from "react";
import { DiscordSDK, Events } from "@discord/embedded-app-sdk";
import {
  api,
  bannerUrl,
  extractList,
  isAnimeItem,
  isSeriesItem,
  mediaKey,
  metaLine,
  posterUrl,
  resolvePlayable,
  titleText,
} from "../lib/api.js";
import { avatarUrl } from "../lib/sdk.js";
import MediaRow from "../components/MediaRow.jsx";

export default function ActivityHome({ session, room, onPick }) {
  const [trending, setTrending] = useState([]);
  const [anime, setAnime] = useState([]);
  const [searchHits, setSearchHits] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState("");
  const [discordPeople, setDiscordPeople] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [trendRes, animeRes] = await Promise.all([
          api.trending(36),
          api.animeTrending(1).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setTrending(extractList(trendRes).slice(0, 36));
        setAnime(extractList(animeRes).slice(0, 24));
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
    () => trending.filter((x) => isSeriesItem(x) && !isAnimeItem(x)).slice(0, 18),
    [trending]
  );
  const movies = useMemo(
    () => trending.filter((x) => !isSeriesItem(x)).slice(0, 18),
    [trending]
  );
  const hero = trending[0] || anime[0] || null;

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
      const merged = [...extractList(movieRes), ...extractList(animeRes)];
      const seen = new Set();
      setSearchHits(
        merged.filter((item) => {
          const key = mediaKey(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 30)
      );
    } catch (e2) {
      setErr(e2.message || "فشل البحث");
    } finally {
      setSearching(false);
    }
  }

  async function pick(item) {
    try {
      setErr("");
      setBusyId(mediaKey(item));
      const playable = await resolvePlayable(item);
      onPick(playable);
    } catch (e) {
      setErr(e.message || "ما قدرت أشغّل العنوان");
    } finally {
      setBusyId("");
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

      {err && <div className="error-box browse-error">{err}</div>}

      {!q.trim() && hero && (
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
              اختر عنوان وابدأ الجلسة — الهوست يتحكّم، والكل يشوف بنفس التوقيت داخل القناة.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                className="primary play-cta"
                disabled={Boolean(busyId)}
                onClick={() => pick(hero)}
              >
                {busyId === mediaKey(hero) ? "جاري التحميل…" : "▶ تشغيل الآن"}
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
            onPick={pick}
          />
        )}
        {!q.trim() && (
          <>
            <MediaRow title="ترند الآن" items={trending.slice(0, 18)} loading={loading} onPick={pick} />
            <MediaRow title="مسلسلات" items={series} loading={loading} onPick={pick} />
            <MediaRow title="أفلام" items={movies} loading={loading} onPick={pick} />
            <MediaRow title="أنمي" items={anime} loading={loading} onPick={pick} />
          </>
        )}
      </div>
    </div>
  );
}
