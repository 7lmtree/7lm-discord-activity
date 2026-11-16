import { useEffect, useRef, useState } from "react";

function formatTime(sec = 0) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function Theater({ room, onBack, onHostControl }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const shellRef = useRef(null);
  const applying = useRef(false);
  const lastSent = useRef(0);
  const hideTimer = useRef(null);
  const state = room.state || {};
  const isHost = room.youAreHost;

  const [playing, setPlaying] = useState(Boolean(state.playing));
  const [current, setCurrent] = useState(state.currentTime || 0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showUi, setShowUi] = useState(true);
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !state.sourceUrl) return undefined;
    let cancelled = false;

    (async () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const url = state.sourceUrl;
      const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes("m3u8");
      if (isHls && el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = url;
      } else if (isHls) {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(el);
        } else {
          el.src = url;
        }
      } else {
        el.src = url;
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [state.sourceUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !state.sourceUrl) return;
    const drift = Math.abs((el.currentTime || 0) - (state.currentTime || 0));
    applying.current = true;
    if (drift > 1.25) {
      try {
        el.currentTime = state.currentTime || 0;
      } catch {
        /* ignore */
      }
    }
    if (state.playing) el.play?.().catch(() => {});
    else el.pause?.();
    setPlaying(Boolean(state.playing));
    setCurrent(state.currentTime || 0);
    const t = setTimeout(() => {
      applying.current = false;
    }, 50);
    return () => clearTimeout(t);
  }, [state.playing, state.currentTime, state.sourceUrl, state.updatedAt]);

  function emit(patch) {
    if (!isHost || applying.current) return;
    onHostControl?.(patch);
  }

  function pokeUi() {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowUi(false);
    }, 2800);
  }

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  function togglePlay() {
    const el = videoRef.current;
    if (!el || !isHost) return;
    if (el.paused) {
      el.play?.().catch(() => {});
      emit({ playing: true, currentTime: el.currentTime || 0 });
    } else {
      el.pause?.();
      emit({ playing: false, currentTime: el.currentTime || 0 });
    }
    pokeUi();
  }

  function seekTo(ratio) {
    const el = videoRef.current;
    if (!el || !isHost || !duration) return;
    const next = Math.min(duration, Math.max(0, ratio * duration));
    el.currentTime = next;
    setCurrent(next);
    emit({ currentTime: next, playing: !el.paused });
  }

  function skip(delta) {
    const el = videoRef.current;
    if (!el || !isHost) return;
    const next = Math.min(duration || 1e9, Math.max(0, (el.currentTime || 0) + delta));
    el.currentTime = next;
    setCurrent(next);
    emit({ currentTime: next, playing: !el.paused });
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

  return (
    <div
      className={`theater yt ${showUi ? "ui-on" : "ui-off"}`}
      ref={shellRef}
      onMouseMove={pokeUi}
      onTouchStart={pokeUi}
      onClick={pokeUi}
    >
      <div className={`theater-top ${showUi ? "visible" : ""}`}>
        <button type="button" className="ghost" onClick={onBack}>
          ← رجوع
        </button>
        <div className="theater-title">
          <strong>{state.title || "Watch Party"}</strong>
          <span className={isHost ? "badge host" : "badge"}>{isHost ? "Host" : "Synced"}</span>
        </div>
        <span className="status">{isHost ? "أنت تتحكّم" : "متابعة مباشرة"}</span>
      </div>

      <div className="stage">
        {state.sourceUrl ? (
          <video
            ref={videoRef}
            playsInline
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            onPlay={() => {
              setPlaying(true);
              if (!applying.current) emit({ playing: true, currentTime: videoRef.current?.currentTime || 0 });
            }}
            onPause={() => {
              setPlaying(false);
              setShowUi(true);
              if (!applying.current) emit({ playing: false, currentTime: videoRef.current?.currentTime || 0 });
            }}
            onTimeUpdate={() => {
              const el = videoRef.current;
              if (!el) return;
              setCurrent(el.currentTime || 0);
              if (el.buffered?.length) {
                try {
                  setBuffered(el.buffered.end(el.buffered.length - 1));
                } catch {
                  /* ignore */
                }
              }
              if (!isHost || applying.current) return;
              const now = Date.now();
              if (now - lastSent.current < 4000) return;
              lastSent.current = now;
              emit({ currentTime: el.currentTime || 0, playing: !el.paused });
            }}
            onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
            onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
          />
        ) : (
          <p className="status">ما تم اختيار مصدر بعد</p>
        )}

        {showUi && (
          <button type="button" className="big-play" onClick={togglePlay} disabled={!isHost}>
            {playing ? "❚❚" : "▶"}
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
            <button type="button" className="ctrl" onClick={togglePlay} disabled={!isHost}>
              {playing ? "❚❚" : "▶"}
            </button>
            <button type="button" className="ctrl" onClick={() => skip(-10)} disabled={!isHost}>
              -10
            </button>
            <button type="button" className="ctrl" onClick={() => skip(10)} disabled={!isHost}>
              +10
            </button>
            <button
              type="button"
              className="ctrl"
              onClick={() => {
                const el = videoRef.current;
                if (!el) return;
                el.muted = !el.muted;
                setMuted(el.muted);
              }}
            >
              {muted || volume === 0 ? "🔇" : "🔊"}
            </button>
            <input
              className="vol"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => {
                const el = videoRef.current;
                const v = Number(e.target.value);
                setVolume(v);
                setMuted(v === 0);
                if (el) {
                  el.volume = v;
                  el.muted = v === 0;
                }
              }}
            />
            <span className="time">
              {formatTime(current)} / {formatTime(duration)}
            </span>
          </div>
          <div className="controls-right">
            <button type="button" className="ctrl" onClick={toggleFs}>
              {fs ? "⛶" : "⛶"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
