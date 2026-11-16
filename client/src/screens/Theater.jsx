import { useEffect, useMemo, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { IconBack } from "../components/Icons.jsx";
import { api, resolvePlayable, streamSrc } from "../lib/api.js";

function episodeLabel(state = {}) {
  if (state.season != null && state.episode != null) {
    return `الموسم ${state.season} · الحلقة ${state.episode}`;
  }
  if (state.episode != null) return `الحلقة ${state.episode}`;
  if (state.kind === "tv") return "مسلسل";
  if (state.kind === "anime") return "أنمي";
  if (state.kind === "movie") return "فيلم";
  return "";
}

function sourceType(url = "") {
  const u = String(url);
  if (/\.m3u8(\?|$)/i.test(u) || /[?&]u=.*m3u8/i.test(u) || /\/hls(\?|$)/i.test(u) || /m3u8/i.test(u)) {
    return "application/x-mpegURL";
  }
  if (/\.mpd(\?|$)/i.test(u) || /mpd/i.test(u)) return "application/dash+xml";
  if (/\.mp4/i.test(u) || /\/p\?u=/i.test(u)) return "video/mp4";
  return "video/mp4";
}

function maxEpisodeFor(state) {
  if (state.maxEpisode) return Number(state.maxEpisode);
  const seasons = state.seasons || [];
  const hit = seasons.find((s) => Number(s.se) === Number(state.season));
  return Number(hit?.maxEp || state.episode || 1);
}

export default function Theater({ room, onBack, onHostControl, socket, selfUserId }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const applying = useRef(false);
  const lastSent = useRef(0);
  const loadStarted = useRef(0);
  const hostRef = useRef(Boolean(room.youAreHost));
  const controlRef = useRef(onHostControl);
  const state = room.state || {};
  const isHost = room.youAreHost;
  hostRef.current = isHost;
  controlRef.current = onHostControl;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [epBusy, setEpBusy] = useState(false);
  const [panel, setPanel] = useState(""); // queue | host | quality

  useEffect(() => {
    const el = videoRef.current;
    if (!el || playerRef.current) return undefined;

    const player = videojs(el, {
      controls: true,
      autoplay: false,
      preload: "auto",
      fluid: true,
      responsive: true,
      playsinline: true,
      liveui: false,
      bigPlayButton: true,
      playbackRates: [0.75, 1, 1.25, 1.5, 2],
      controlBar: {
        pictureInPictureToggle: false,
        remainingTimeDisplay: true,
        volumePanel: { inline: true },
      },
      html5: {
        vhs: {
          overrideNative: !videojs.browser.IS_SAFARI,
          enableLowInitialPlaylist: true,
        },
        nativeAudioTracks: false,
        nativeVideoTracks: false,
      },
    });

    playerRef.current = player;

    const emitHost = (patch) => {
      if (!hostRef.current || applying.current) return;
      controlRef.current?.(patch);
    };

    const onPlay = () => emitHost({ playing: true, currentTime: player.currentTime() || 0 });
    const onPause = () => emitHost({ playing: false, currentTime: player.currentTime() || 0 });
    const onSeeked = () => emitHost({ currentTime: player.currentTime() || 0, playing: !player.paused() });
    const onTime = () => {
      if (!hostRef.current || applying.current) return;
      const now = Date.now();
      if (now - lastSent.current < 4000) return;
      lastSent.current = now;
      emitHost({ currentTime: player.currentTime() || 0, playing: !player.paused() });
    };
    const onErr = () => {
      const err = player.error();
      const message = err?.message || "فشل التشغيل — جرّب عنوان ثاني";
      setError(message);
      api.telemetry({
        type: "playback_failure",
        sourceType: sourceType(state.sourceUrl || ""),
        error: message,
        title: state.title,
        kind: state.kind,
        mediaId: state.mediaId,
        quality: state.quality,
      });
    };
    const onLoaded = () => {
      const loadMs = loadStarted.current ? Date.now() - loadStarted.current : null;
      api.telemetry({
        type: "playback_loaded",
        sourceType: sourceType(player.currentSrc?.() || state.sourceUrl || ""),
        loadMs,
        title: state.title,
        kind: state.kind,
        mediaId: state.mediaId,
        quality: state.quality,
      });
    };

    player.ready(() => {
      setReady(true);
      player.el()?.classList.toggle("vjs-locked", !hostRef.current);
    });
    player.on("play", onPlay);
    player.on("pause", onPause);
    player.on("seeked", onSeeked);
    player.on("timeupdate", onTime);
    player.on("error", onErr);
    player.on("loadeddata", onLoaded);

    return () => {
      player.off("play", onPlay);
      player.off("pause", onPause);
      player.off("seeked", onSeeked);
      player.off("timeupdate", onTime);
      player.off("error", onErr);
      player.off("loadeddata", onLoaded);
      if (!player.isDisposed()) player.dispose();
      playerRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) return;
    player.el()?.classList.toggle("vjs-locked", !isHost);
  }, [isHost]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready || !state.sourceUrl) return;
    setError("");
    const src = streamSrc(state.sourceUrl);
    const type = sourceType(src);
    const current = player.currentSrc?.() || "";
    if (current === src) return;
    loadStarted.current = Date.now();
    player.src({ src, type });
    player.one("loadedmetadata", () => {
      if (state.playing) player.play()?.catch?.(() => {});
    });
  }, [state.sourceUrl, ready]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready || !state.sourceUrl) return;
    applying.current = true;
    const drift = Math.abs((player.currentTime() || 0) - (state.currentTime || 0));
    if (drift > 1.25) {
      try {
        player.currentTime(state.currentTime || 0);
      } catch {
        /* ignore */
      }
    }
    if (state.playing) player.play()?.catch?.(() => {});
    else player.pause();
    const t = setTimeout(() => {
      applying.current = false;
    }, 120);
    return () => clearTimeout(t);
  }, [state.playing, state.currentTime, state.updatedAt, state.sourceUrl, ready]);

  const ep = episodeLabel(state);
  const maxEp = maxEpisodeFor(state);
  const canPrev = isHost && state.episode != null && Number(state.episode) > 1;
  const canNext = isHost && state.episode != null && Number(state.episode) < maxEp;
  const queue = state.queue || [];
  const sources = state.sources || [];
  const others = useMemo(
    () => (room.participants || []).filter((p) => p.userId !== room.hostUserId),
    [room.participants, room.hostUserId]
  );

  async function changeEpisode(delta) {
    if (!isHost || !state.mediaId || state.episode == null) return;
    const nextEp = Number(state.episode) + delta;
    if (nextEp < 1 || nextEp > maxEp) return;
    try {
      setEpBusy(true);
      setError("");
      const playable = await resolvePlayable(
        {
          id: state.mediaId,
          subjectId: state.mediaId,
          title: state.title,
          poster: state.poster,
          type: state.kind === "anime" ? "anime" : undefined,
          subjectType: state.kind === "tv" ? 2 : 1,
          episodes: maxEp,
        },
        {
          kind: state.kind,
          season: state.season || 1,
          episode: nextEp,
          animeType: state.animeType || "sub",
          quality: state.quality,
          maxEpisode: maxEp,
          seasons: state.seasons,
        }
      );
      onHostControl({
        ...playable,
        seasons: state.seasons,
        maxEpisode: maxEp,
        playing: true,
        currentTime: 0,
      });
    } catch (e) {
      setError(e.message || "فشل تغيير الحلقة");
    } finally {
      setEpBusy(false);
    }
  }

  function switchQuality(src) {
    if (!isHost || !src?.url) return;
    onHostControl({
      sourceUrl: src.url,
      quality: src.quality,
      currentTime: playerRef.current?.currentTime?.() || state.currentTime || 0,
      playing: state.playing,
    });
    setPanel("");
  }

  return (
    <div className="theater vjs-shell">
      <div className="theater-top visible">
        <button type="button" className="ghost icon-btn" onClick={onBack}>
          <IconBack />
          <span>رجوع</span>
        </button>
        <div className="theater-title">
          <strong>{state.title || "7LM Movie"}</strong>
          {ep && <em className="ep-chip">{ep}</em>}
          {state.animeType && <em className="ep-chip soft">{String(state.animeType).toUpperCase()}</em>}
          {state.quality && <em className="ep-chip soft">{state.quality}</em>}
          <span className={isHost ? "badge host" : "badge"}>{isHost ? "Host" : "Synced"}</span>
        </div>
        <span className="status">{isHost ? "أنت تتحكّم" : "متابعة مباشرة"}</span>
      </div>

      <div className="theater-tools">
        {(state.kind === "tv" || state.kind === "anime") && isHost && (
          <div className="chip-row">
            <button type="button" className="chip" disabled={!canPrev || epBusy} onClick={() => changeEpisode(-1)}>
              الحلقة السابقة
            </button>
            <button type="button" className="chip" disabled={!canNext || epBusy} onClick={() => changeEpisode(1)}>
              الحلقة التالية
            </button>
          </div>
        )}
        <div className="chip-row">
          {sources.length > 1 && isHost && (
            <button
              type="button"
              className={`chip ${panel === "quality" ? "on" : ""}`}
              onClick={() => setPanel(panel === "quality" ? "" : "quality")}
            >
              الجودة
            </button>
          )}
          <button
            type="button"
            className={`chip ${panel === "queue" ? "on" : ""}`}
            onClick={() => setPanel(panel === "queue" ? "" : "queue")}
          >
            الطابور ({queue.length})
          </button>
          <button
            type="button"
            className={`chip ${panel === "host" ? "on" : ""}`}
            onClick={() => setPanel(panel === "host" ? "" : "host")}
          >
            الهوست
          </button>
        </div>
      </div>

      {panel === "quality" && (
        <div className="theater-panel">
          <h3>اختر الجودة</h3>
          <div className="chip-row">
            {sources.map((s) => (
              <button
                key={`${s.quality}-${s.url}`}
                type="button"
                className={`chip ${state.quality === s.quality ? "on" : ""}`}
                onClick={() => switchQuality(s)}
              >
                {s.label || s.quality}
              </button>
            ))}
          </div>
        </div>
      )}

      {panel === "queue" && (
        <div className="theater-panel">
          <h3>طابور العناوين</h3>
          {!queue.length && <p className="muted-note">فاضي — المشاهدون يقترحون من التفاصيل</p>}
          <ul className="queue-list">
            {queue.map((qItem) => (
              <li key={qItem.id}>
                <div>
                  <strong>{qItem.title}</strong>
                  <em>
                    {qItem.suggestedByName || "Viewer"}
                    {qItem.episode != null ? ` · ح${qItem.episode}` : ""}
                  </em>
                </div>
                <div className="queue-actions">
                  {isHost && qItem.sourceUrl && (
                    <button type="button" className="chip on" onClick={() => socket?.acceptQueue(qItem.id)}>
                      تشغيل
                    </button>
                  )}
                  {(isHost || qItem.suggestedBy === String(selfUserId || "")) && (
                    <button type="button" className="chip" onClick={() => socket?.removeQueue(qItem.id)}>
                      حذف
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {panel === "host" && (
        <div className="theater-panel">
          <h3>نقل الهوست / تصويت</h3>
          <p className="muted-note">الهوست الحالي يقدر ينقل يدويًا. المشاهدون يصوّتون للأغلبية.</p>
          <ul className="queue-list">
            {(room.participants || []).map((p) => (
              <li key={p.userId}>
                <div>
                  <strong>{p.username}</strong>
                  {p.userId === room.hostUserId && <em>Host</em>}
                </div>
                <div className="queue-actions">
                  {isHost && p.userId !== room.hostUserId && (
                    <button type="button" className="chip on" onClick={() => socket?.transferHost(p.userId)}>
                      نقل
                    </button>
                  )}
                  {!isHost && p.userId !== room.hostUserId && (
                    <button type="button" className="chip" onClick={() => socket?.voteHost(p.userId)}>
                      صوّت
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!others.length && <p className="muted-note">ما في مشاهدين غيرك حاليًا</p>}
        </div>
      )}

      <div className="stage vjs-stage">
        {!state.sourceUrl && <p className="status">ما تم اختيار مصدر بعد</p>}
        {error && <div className="error-box browse-error">{error}</div>}
        <div data-vjs-player className={state.sourceUrl ? "" : "is-hidden"}>
          <video
            ref={videoRef}
            className="video-js vjs-big-play-centered vjs-show-big-play-button-on-pause"
            playsInline
            crossOrigin="anonymous"
          />
        </div>
      </div>
    </div>
  );
}
