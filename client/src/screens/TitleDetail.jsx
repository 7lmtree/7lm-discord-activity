import { useEffect, useMemo, useState } from "react";
import {
  api,
  bannerUrl,
  descriptionText,
  extractSeasonList,
  extractSourceList,
  isAnimeItem,
  isSeriesItem,
  maybeTranslateDescription,
  mediaKey,
  metaLine,
  posterUrl,
  ratingValue,
  resolveMediaId,
  resolvePlayable,
  streamSrc,
  titleText,
} from "../lib/api.js";
import { IconBack, IconPlay, IconStar } from "../components/Icons.jsx";

export default function TitleDetail({ item, room, onBack, onPlay, onSuggest }) {
  const anime = isAnimeItem(item);
  const series = isSeriesItem(item);
  const [detail, setDetail] = useState(item);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [desc, setDesc] = useState(descriptionText(item));
  const [descTranslated, setDescTranslated] = useState(false);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [animeType, setAnimeType] = useState("sub");
  const [sources, setSources] = useState([]);
  const [quality, setQuality] = useState("");
  const [loadingSources, setLoadingSources] = useState(false);

  const seasons = useMemo(() => {
    if (anime) {
      const max = Number(detail?.episodes || item?.episodes || 12) || 12;
      return [{ se: 1, maxEp: max }];
    }
    const list = extractSeasonList(detail);
    return list.length ? list : series ? [{ se: 1, maxEp: 12 }] : [];
  }, [detail, item, anime, series]);

  const maxEp = useMemo(() => {
    const hit = seasons.find((s) => s.se === Number(season));
    return hit?.maxEp || 1;
  }, [seasons, season]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const id = resolveMediaId(item);
        if (!anime && id) {
          const movie = await api.movie(id).catch(() => null);
          if (!cancelled && movie && typeof movie === "object") {
            setDetail({ ...item, ...movie });
            const d = descriptionText(movie) || descriptionText(item);
            setDesc(d);
          }
        } else {
          setDesc(descriptionText(item));
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "فشل تحميل التفاصيل");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item, anime]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!desc || descTranslated) return;
      const res = await maybeTranslateDescription(desc);
      if (!cancelled && res.translated && res.text) {
        setDesc(res.text);
        setDescTranslated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desc, descTranslated]);

  useEffect(() => {
    if (seasons.length && !seasons.some((s) => s.se === season)) {
      setSeason(seasons[0].se);
    }
  }, [seasons, season]);

  useEffect(() => {
    if (episode > maxEp) setEpisode(1);
  }, [maxEp, episode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = resolveMediaId(detail);
      if (!id) return;
      try {
        setLoadingSources(true);
        let payload;
        if (anime) {
          payload = await api.animeSources(id, episode, animeType);
        } else if (series) {
          payload = await api.sources(id, season, episode);
        } else {
          payload = await api.sources(id);
        }
        if (cancelled) return;
        const list = extractSourceList(payload).map((s) => ({
          ...s,
          url: streamSrc(s.url),
        }));
        setSources(list);
        setQuality((prev) => {
          if (prev && list.some((s) => s.quality === prev)) return prev;
          return list[0]?.quality || "";
        });
      } catch (e) {
        if (!cancelled) {
          setSources([]);
          setErr((prev) => prev || e.message || "فشل جلب المصادر");
        }
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, anime, series, season, episode, animeType]);

  async function play() {
    try {
      setBusy(true);
      setErr("");
      const playable = await resolvePlayable(detail, {
        kind: anime ? "anime" : series ? "tv" : "movie",
        season: series || anime ? season : null,
        episode: series || anime ? episode : null,
        animeType: anime ? animeType : null,
        quality: quality || null,
        maxEpisode: maxEp,
        seasons,
      });
      if (quality && playable.sources?.length) {
        const hit = playable.sources.find((s) => s.quality === quality);
        if (hit?.url) {
          playable.sourceUrl = hit.url;
          playable.quality = quality;
        }
      }
      playable.seasons = seasons;
      playable.maxEpisode = maxEp;
      onPlay?.(playable);
    } catch (e) {
      setErr(e.message || "ما قدرت أشغّل العنوان");
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    try {
      setBusy(true);
      setErr("");
      const playable = await resolvePlayable(detail, {
        kind: anime ? "anime" : series ? "tv" : "movie",
        season: series || anime ? season : null,
        episode: series || anime ? episode : null,
        animeType: anime ? animeType : null,
        quality: quality || null,
        maxEpisode: maxEp,
        seasons,
      });
      onSuggest?.(playable);
    } catch (e) {
      setErr(e.message || "ما قدرت أضيف للاقتراحات");
    } finally {
      setBusy(false);
    }
  }

  const rating = ratingValue(detail);
  const canHostPlay = room.youAreHost || !room.state?.hostUserId;

  return (
    <div className="detail">
      <header className="detail-top">
        <button type="button" className="ghost icon-btn" onClick={onBack}>
          <IconBack />
          <span>رجوع</span>
        </button>
        <span className={room.youAreHost ? "badge host" : "badge"}>
          {room.youAreHost ? "Host" : "Viewer"}
        </span>
      </header>

      <section
        className="detail-hero"
        style={{ "--hero-image": `url(${bannerUrl(detail) || posterUrl(detail)})` }}
      >
        <div className="hero-shade" />
        <div className="detail-hero-grid">
          <div className="detail-poster">
            {posterUrl(detail) ? (
              <img src={posterUrl(detail)} alt="" />
            ) : (
              <div className="skeleton-poster" />
            )}
          </div>
          <div className="detail-copy">
            <p className="hero-kicker">تفاصيل العنوان</p>
            <h1>{titleText(detail)}</h1>
            <p className="hero-meta">
              {rating != null && (
                <span className="rating-pill">
                  <IconStar size={12} /> {rating}
                </span>
              )}
              {metaLine(detail)}
            </p>
            {loading ? (
              <p className="hero-desc">جاري التحميل…</p>
            ) : (
              <p className="hero-desc">
                {desc || "لا يوجد وصف متاح."}
                {descTranslated ? " · تُرجم للعربية" : ""}
              </p>
            )}
          </div>
        </div>
      </section>

      {err && <div className="error-box browse-error">{err}</div>}

      <div className="detail-body">
        {anime && (
          <div className="picker-block">
            <h2>الصوت / الترجمة</h2>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${animeType === "sub" ? "on" : ""}`}
                onClick={() => setAnimeType("sub")}
              >
                ترجمة (Sub)
              </button>
              <button
                type="button"
                className={`chip ${animeType === "dub" ? "on" : ""}`}
                onClick={() => setAnimeType("dub")}
              >
                دبلجة (Dub)
              </button>
            </div>
            <p className="muted-note">ملفات الترجمة (CC) تظهر داخل المشغّل بعد التشغيل</p>
          </div>
        )}

        {(series || anime) && seasons.length > 0 && (
          <div className="picker-block">
            <h2>الموسم / الحلقة</h2>
            <div className="picker-row">
              {!anime && (
                <label>
                  الموسم
                  <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
                    {seasons.map((s) => (
                      <option key={s.se} value={s.se}>
                        الموسم {s.se}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                الحلقة
                <select value={episode} onChange={(e) => setEpisode(Number(e.target.value))}>
                  {Array.from({ length: maxEp }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      الحلقة {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="chip-row ep-grid">
              {Array.from({ length: Math.min(maxEp, 40) }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`chip ${episode === n ? "on" : ""}`}
                  onClick={() => setEpisode(n)}
                >
                  {n}
                </button>
              ))}
              {maxEp > 40 && <span className="muted-note">+{maxEp - 40} حلقة — استخدم القائمة</span>}
            </div>
          </div>
        )}

        <div className="picker-block">
          <h2>الجودة {loadingSources ? "…" : ""}</h2>
          {sources.length > 1 ? (
            <div className="chip-row">
              {sources.map((s) => (
                <button
                  key={`${s.quality}-${s.url}`}
                  type="button"
                  className={`chip ${quality === s.quality ? "on" : ""}`}
                  onClick={() => setQuality(s.quality)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-note">
              {sources.length === 1 ? `مصدر واحد: ${sources[0].label}` : "لا مصادر بعد"}
            </p>
          )}
        </div>

        <div className="detail-actions">
          {canHostPlay ? (
            <button type="button" className="primary play-cta" disabled={busy || !sources.length} onClick={play}>
              {busy ? (
                "جاري التحميل…"
              ) : (
                <>
                  <IconPlay size={16} /> تشغيل في الغرفة
                </>
              )}
            </button>
          ) : (
            <button type="button" className="primary play-cta" disabled={busy || !sources.length} onClick={suggest}>
              {busy ? "…" : "اقترح للهوست"}
            </button>
          )}
          {canHostPlay && (
            <button type="button" className="ghost" disabled={busy || !sources.length} onClick={suggest}>
              أضف للطابور
            </button>
          )}
        </div>
        <p className="muted-note">id: {mediaKey(detail)}</p>
      </div>
    </div>
  );
}
