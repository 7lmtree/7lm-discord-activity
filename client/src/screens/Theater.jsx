import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import {
  IconBack,
  IconExitFullscreen,
  IconForward,
  IconFullscreen,
  IconMute,
  IconPause,
  IconPlay,
  IconRewind,
  IconVolume,
} from "../components/Icons.jsx";

function formatTime(sec = 0) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function sourceType(url = "") {
  if (/\.m3u8(\?|$)/i.test(url) || url.includes("m3u8")) return "application/x-mpegURL";
  if (/\.mpd(\?|$)/i.test(url)) return "application/dash+xml";
  if (/\.mp4(\?|$)/i.test(url)) return "video/mp4";
  return "application/x-mpegURL";
}

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

export default function Theater({ room, onBack, onHostControl }) {
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const shellRef = useRef(null);
  const applying = useRef(false);
  const lastSent = useRef(0);
  const hideTimer = useRef(null);
  const hostRef = useRef(Boolean(room.youAreHost));
  const controlRef = useRef(onHostControl);
  const state = room.state || {};
  const isHost = room.youAreHost;
  hostRef.current = isHost;
  controlRef.current = onHostControl;

  const [playing, setPlaying] = useState(Boolean(state.playing));
  const [current, setCurrent] = useState(state.currentTime || 0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showUi, setShowUi] = useState(true);
  const [fs, setFs] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || playerRef.current) return undefined;

    const videoEl = document.createElement("video");
    videoEl.className = "video-js vjs-big-play-centered vjs-fill";
    videoEl.setAttribute("playsinline", "true");
    mount.appendChild(videoEl);

    const player = videojs(videoEl, {
      controls: false,
      fluid: true,
      fill: true,
      autoplay: false,
      preload: "auto",
      playsinline: true,
      responsive: true,
      inactivityTimeout: 0,
      bigPlayButton: false,
      html5: {
        vhs: { overrideNative: !videojs.browser.IS_ANY_SAFARI },
        nativeAudioTracks: false,
        nativeVideoTracks: false,
      },
    });

    playerRef.current = player;

    const onPlay = () => {
      setPlaying(true);
      if (!applying.current && hostRef.current) {
        controlRef.current?.({ playing: true, currentTime: player.currentTime() || 0 });
      }
    };
    const onPause = () => {
      setPlaying(false);
      setShowUi(true);
      if (!applying.current && hostRef.current) {
        controlRef.current?.({ playing: false, currentTime: player.currentTime() || 0 });
      }
    };
    const onTime = () => {
      const t = player.currentTime() || 0;
      setCurrent(t);
      try {
        const buf = player.buffered();
        if (buf?.length) setBuffered(buf.end(buf.length - 1));
      } catch {
        /* ignore */
      }
      if (!hostRef.current || applying.current) return;
      const now = Date.now();
      if (now - lastSent.current < 4000) return;
      lastSent.current = now;
      controlRef.current?.({ currentTime: t, playing: !player.paused() });
    };
    const onMeta = () => setDuration(player.duration() || 0);

    player.ready(() => setReady(true));
    player.on("play", onPlay);
    player.on("pause", onPause);
    player.on("timeupdate", onTime);
    player.on("loadedmetadata", onMeta);
    player.on("durationchange", onMeta);
    player.on("volumechange", () => {
      setMuted(Boolean(player.muted()));
      setVolume(Number(player.volume() || 0));
    });

    return () => {
      clearTimeout(hideTimer.current);
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
      }
      playerRef.current = null;
      setReady(false);
      if (mount) mount.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !state.sourceUrl || !ready) return;
    const type = sourceType(state.sourceUrl);
    const currentSrc = player.currentSrc?.() || "";
    if (currentSrc !== state.sourceUrl) {
      player.src({ src: state.sourceUrl, type });
    }
  }, [state.sourceUrl, ready]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !state.sourceUrl || !ready) return;
    const drift = Math.abs((player.currentTime() || 0) - (state.currentTime || 0));
    applying.current = true;
    if (drift > 1.25) {
      try {
        player.currentTime(state.currentTime || 0);
      } catch {
        /* ignore */
      }
    }
    if (state.playing) player.play?.()?.catch?.(() => {});
    else player.pause?.();
    setPlaying(Boolean(state.playing));
    setCurrent(state.currentTime || 0);
    const t = setTimeout(() => {
      applying.current = false;
    }, 80);
    return () => clearTimeout(t);
  }, [state.playing, state.currentTime, state.sourceUrl, state.updatedAt, ready]);

  function emit(patch) {
    if (!isHost || applying.current) return;
    onHostControl?.(patch);
  }

  function pokeUi() {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const player = playerRef.current;
      if (player && !player.paused()) setShowUi(false);
    }, 2800);
  }

  function togglePlay() {
    const player = playerRef.current;
    if (!player || !isHost) return;
    if (player.paused()) {
      player.play?.()?.catch?.(() => {});
      emit({ playing: true, currentTime: player.currentTime() || 0 });
    } else {
      player.pause?.();
      emit({ playing: false, currentTime: player.currentTime() || 0 });
    }
    pokeUi();
  }

  function seekTo(ratio) {
    const player = playerRef.current;
    if (!player || !isHost || !duration) return;
    const next = Math.min(duration, Math.max(0, ratio * duration));
    player.currentTime(next);
    setCurrent(next);
    emit({ currentTime: next, playing: !player.paused() });
  }

  function skip(delta) {
    const player = playerRef.current;
    if (!player || !isHost) return;
    const next = Math.min(duration || 1e9, Math.max(0, (player.currentTime() || 0) + delta));
    player.currentTime(next);
    setCurrent(next);
    emit({ currentTime: next, playing: !player.paused() });
    pokeUi();
  }

  async function toggleFs() {
    const node = shellRef.current;
    if (!node) return;
    try {
      if (!document.fullscreenElement) {
        await node.requestFullscreen?.();
        setFs(true);
      } else {
        await document.exitFullscreen?.();
        setFs(false);
      }
    } catch {
      /* ignore */
    }
  }

  const progress = duration ? (current / duration) * 100 : 0;
  const bufferPct = duration ? (buffered / duration) * 100 : 0;
  const ep = episodeLabel(state);

  return (
    <div
      className={`theater vjs-shell ${showUi ? "ui-on" : "ui-off"}`}
      ref={shellRef}
      onMouseMove={pokeUi}
      onTouchStart={pokeUi}
      onClick={pokeUi}
    >
      <div className={`theater-top ${showUi ? "visible" : ""}`}>
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
        {state.sourceUrl ? (
          <div
            ref={mountRef}
            data-vjs-player
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
          />
        ) : (
          <p className="status">ما تم اختيار مصدر بعد</p>
        )}

        {showUi && state.sourceUrl && (
          <button type="button" className="big-play" onClick={togglePlay} disabled={!isHost}>
            {playing ? <IconPause size={28} /> : <IconPlay size={28} />}
          </button>
        )}
      </div>

      <div className={`controls ${showUi ? "visible" : ""}`}>
        <div
          className={`scrub ${isHost ? "" : "locked"}`}
          onPointerDown={(e) => {
            if (!isHost) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
            seekTo((x - rect.left) / Math.max(rect.width, 1));
          }}
        >
          <div className="scrub-buffer" style={{ width: `${bufferPct}%` }} />
          <div className="scrub-progress" style={{ width: `${progress}%` }} />
          <div className="scrub-knob" style={{ insetInlineStart: `${progress}%` }} />
        </div>

        <div className="controls-row">
          <div className="controls-left">
            <button type="button" className="ctrl" onClick={togglePlay} disabled={!isHost} aria-label="تشغيل">
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ctrl" onClick={() => skip(-10)} disabled={!isHost} aria-label="رجوع 10">
              <IconRewind />
              <span className="ctrl-label">10</span>
            </button>
            <button type="button" className="ctrl" onClick={() => skip(10)} disabled={!isHost} aria-label="تقديم 10">
              <IconForward />
              <span className="ctrl-label">10</span>
            </button>
            <button
              type="button"
              className="ctrl"
              aria-label="الصوت"
              onClick={() => {
                const player = playerRef.current;
                if (!player) return;
                player.muted(!player.muted());
              }}
            >
              {muted || volume === 0 ? <IconMute /> : <IconVolume />}
            </button>
            <input
              className="vol"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => {
                const player = playerRef.current;
                const v = Number(e.target.value);
                setVolume(v);
                setMuted(v === 0);
                if (player) {
                  player.volume(v);
                  player.muted(v === 0);
                }
              }}
            />
            <span className="time">
              {formatTime(current)} / {formatTime(duration)}
            </span>
          </div>
          <div className="controls-right">
            <button type="button" className="ctrl" onClick={toggleFs} aria-label="ملء الشاشة">
              {fs ? <IconExitFullscreen /> : <IconFullscreen />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
