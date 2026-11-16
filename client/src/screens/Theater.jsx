import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { IconBack } from "../components/Icons.jsx";
import { streamSrc } from "../lib/api.js";

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

export default function Theater({ room, onBack, onHostControl }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const applying = useRef(false);
  const lastSent = useRef(0);
  const hostRef = useRef(Boolean(room.youAreHost));
  const controlRef = useRef(onHostControl);
  const state = room.state || {};
  const isHost = room.youAreHost;
  hostRef.current = isHost;
  controlRef.current = onHostControl;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

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
      setError(err?.message || "فشل التشغيل — جرّب عنوان ثاني");
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

    return () => {
      player.off("play", onPlay);
      player.off("pause", onPause);
      player.off("seeked", onSeeked);
      player.off("timeupdate", onTime);
      player.off("error", onErr);
      if (!player.isDisposed()) player.dispose();
      playerRef.current = null;
      setReady(false);
    };
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
          <span className={isHost ? "badge host" : "badge"}>{isHost ? "Host" : "Synced"}</span>
        </div>
        <span className="status">{isHost ? "أنت تتحكّم" : "متابعة مباشرة"}</span>
      </div>

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
