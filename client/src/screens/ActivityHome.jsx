import { useEffect, useState } from "react";
import { DiscordSDK, Events } from "@discord/embedded-app-sdk";
import { api, extractList, posterUrl, titleText } from "../lib/api.js";
import { avatarUrl } from "../lib/sdk.js";

export default function ActivityHome({ session, room, onPick }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [discordPeople, setDiscordPeople] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await api.trending(24);
        if (!cancelled) setItems(extractList(data).slice(0, 24));
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load titles");
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

    const handler = (payload) => {
      setDiscordPeople(payload?.participants || []);
    };
    sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
    return () => {
      alive = false;
      sdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
    };
  }, [session.sdk]);

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    try {
      setLoading(true);
      setErr("");
      const data = await api.search(q.trim());
      setItems(extractList(data).slice(0, 24));
    } catch (e2) {
      setErr(e2.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function mediaId(item) {
    return item.id || item.movieId || item.contentId || item.subjectId || item.detailPath;
  }

  async function pick(item) {
    const id = mediaId(item);
    if (!id) return;
    try {
      setErr("");
      const sources = await api.sources(id);
      const list = Array.isArray(sources) ? sources : sources?.sources || sources?.data || [];
      const best =
        [...list].sort((a, b) => (b.resolution || 0) - (a.resolution || 0))[0] || list[0];
      const url = best?.url || best?.file || best?.src;
      if (!url) throw new Error("ما لقيت مصدر تشغيل");
      onPick({
        mediaId: String(id),
        kind: item.subjectType === 2 || item.domainType === 1 || item.type === "tv" ? "tv" : "movie",
        title: titleText(item),
        poster: posterUrl(item),
        sourceUrl: url,
        playing: true,
        currentTime: 0,
      });
    } catch (e) {
      setErr(e.message || "ما قدرت أشغّل العنوان");
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
    <div className="home">
      <header className="topbar">
        <h1>
          7LM<span style={{ color: "var(--accent)" }}> Watch</span>
        </h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {room.youAreHost ? (
            <span className="badge host">Host</span>
          ) : (
            <span className="badge">Viewer</span>
          )}
          <span className="status" style={{ fontSize: "0.8rem" }}>
            {session.user?.global_name || session.user?.username}
          </span>
        </div>
      </header>

      <div className="layout">
        <main className="main">
          <form className="search" onSubmit={search}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث عن فيلم أو مسلسل…"
            />
            <button type="submit">بحث</button>
          </form>

          <h2 className="row-title">{q ? "نتائج البحث" : "ترند الآن"}</h2>
          {err && <div className="error-box">{err}</div>}
          <div className="grid">
            {loading &&
              !items.length &&
              Array.from({ length: 12 }).map((_, i) => (
                <div key={`sk-${i}`} className="card skeleton-card" aria-hidden>
                  <div className="skeleton-poster" />
                  <div className="skeleton-line" />
                </div>
              ))}
            {items.map((item) => {
              const id = mediaId(item) || titleText(item);
              const poster = posterUrl(item);
              return (
                <button key={id} type="button" className="card" onClick={() => pick(item)}>
                  {poster ? <img src={poster} alt="" loading="lazy" /> : <div className="skeleton-poster" />}
                  <p>{titleText(item)}</p>
                </button>
              );
            })}
          </div>
        </main>

        <aside className="side">
          <h2>في الجلسة</h2>
          <ul className="people">
            {people.map((p) => (
              <li key={p.userId}>
                {p.avatar ? (
                  <img className="avatar" src={p.avatar} alt="" />
                ) : (
                  <span className="avatar" />
                )}
                <span>
                  {p.username}
                  {room.hostUserId === p.userId || room.state?.hostUserId === p.userId
                    ? " · host"
                    : ""}
                </span>
              </li>
            ))}
            {!people.length && <li className="status">ما فيه أحد بعد</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}
