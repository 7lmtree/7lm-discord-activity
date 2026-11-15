import { useEffect, useRef } from "react";

export default function Theater({ room, onBack, onHostControl }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const applying = useRef(false);
  const lastSent = useRef(0);
  const state = room.state || {};
  const isHost = room.youAreHost;

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
    const t = setTimeout(() => {
      applying.current = false;
    }, 50);
    return () => clearTimeout(t);
  }, [state.playing, state.currentTime, state.sourceUrl, state.updatedAt]);

  function emit(patch) {
    if (!isHost || applying.current) return;
    onHostControl?.(patch);
  }

  return (
    <div className="theater">
      <div className="theater-bar">
        <button type="button" className="ghost" onClick={onBack}>
          رجوع
        </button>
        <strong>{state.title || "Watch Party"}</strong>
        <span className={isHost ? "badge host" : "badge"}>{isHost ? "Host" : "Synced"}</span>
      </div>

      <div className="player-wrap">
        {state.sourceUrl ? (
          <video
            ref={videoRef}
            controls={isHost}
            playsInline
            onPlay={() => {
              if (!applying.current) emit({ playing: true, currentTime: videoRef.current?.currentTime || 0 });
            }}
            onPause={() => {
              if (!applying.current) emit({ playing: false, currentTime: videoRef.current?.currentTime || 0 });
            }}
            onSeeked={() => {
              if (!applying.current) emit({ currentTime: videoRef.current?.currentTime || 0 });
            }}
            onTimeUpdate={() => {
              if (!isHost || applying.current) return;
              const now = Date.now();
              if (now - lastSent.current < 4000) return;
              lastSent.current = now;
              emit({
                currentTime: videoRef.current?.currentTime || 0,
                playing: !videoRef.current?.paused,
              });
            }}
          />
        ) : (
          <p className="status">ما تم اختيار مصدر بعد</p>
        )}
      </div>

      <p className="hint">
        {isHost
          ? "أنت الهوست — play / pause / seek ينبثّون للجميع."
          : "وضع المتابعة — التحكم عند الهوست."}
      </p>
    </div>
  );
}
