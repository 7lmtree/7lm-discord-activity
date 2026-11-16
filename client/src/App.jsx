import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSplash from "./screens/LoadingSplash.jsx";
import ActivityHome from "./screens/ActivityHome.jsx";
import TitleDetail from "./screens/TitleDetail.jsx";
import Theater from "./screens/Theater.jsx";
import PipCard from "./components/PipCard.jsx";
import {
  bootstrapDiscord,
  isProbablyInDiscord,
  LAYOUT,
  publishPresence,
  subscribeLayoutMode,
} from "./lib/sdk.js";
import { connectWatchRoom } from "./lib/watchSocket.js";
import { saveLastWatched } from "./lib/history.js";
import { api, apiBase } from "./lib/api.js";

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [status, setStatus] = useState("نجهّز الجلسة…");
  const [error, setError] = useState("");
  const [outside, setOutside] = useState(false);
  const [session, setSession] = useState(null);
  const [layoutMode, setLayoutMode] = useState(LAYOUT.FOCUSED);
  const [detailItem, setDetailItem] = useState(null);
  const [room, setRoom] = useState({
    state: null,
    participants: [],
    youAreHost: false,
    hostUserId: null,
  });
  const [socket, setSocket] = useState(null);
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let sock = null;
    let unsubLayout = () => {};
    let retryTimer = null;

    (async () => {
      try {
        if (!isProbablyInDiscord()) {
          setOutside(true);
          setScreen("loading");
          return;
        }
        setError("");
        setStatus("نوقظ الخادم…");
        // Wake Render before OAuth (free tier cold start)
        try {
          await fetch(`${apiBase()}/api/health`, {
            headers: { Accept: "application/json" },
          });
        } catch {
          /* continue — retries below handle wake */
        }
        const boot = await bootstrapDiscord({ onStatus: setStatus });
        if (cancelled) return;
        setSession(boot);
        unsubLayout = subscribeLayoutMode(boot.sdk, setLayoutMode);

        sock = connectWatchRoom({
          instanceId: boot.instanceId,
          user: boot.user,
          onStatus: setStatus,
          onMessage: (msg) => {
            if (msg.type === "state") {
              setRoom((prev) => ({
                ...prev,
                state: msg.state,
                hostUserId: msg.hostUserId || msg.state?.hostUserId || prev.hostUserId,
                youAreHost:
                  msg.youAreHost ??
                  (msg.state?.hostUserId || msg.hostUserId) === String(boot.user.id),
                participants: msg.participants || prev.participants,
              }));
              if (msg.state?.sourceUrl) setScreen("theater");
              publishPresence(boot.sdk, {
                title: msg.state?.title,
                poster: msg.state?.poster || msg.state?.banner,
                people: (msg.participants || []).length || 1,
                season: msg.state?.season,
                episode: msg.state?.episode,
                kind: msg.state?.kind,
              });
            }
            if (msg.type === "participants") {
              setRoom((prev) => ({
                ...prev,
                participants: msg.participants || [],
                hostUserId: msg.hostUserId || prev.hostUserId,
                youAreHost: (msg.hostUserId || prev.hostUserId) === String(boot.user.id),
              }));
            }
            if (msg.type === "queue") {
              setRoom((prev) => ({
                ...prev,
                state: { ...(prev.state || {}), queue: msg.queue || [] },
              }));
            }
            if (msg.type === "host_votes") {
              setRoom((prev) => ({
                ...prev,
                state: { ...(prev.state || {}), hostVotes: msg.hostVotes || {} },
              }));
            }
            if (msg.type === "error") setError(msg.message || "Room error");
          },
        });
        setSocket(sock);
        setScreen("home");
      } catch (e) {
        if (cancelled) return;
        if (e.message === "OUTSIDE_DISCORD") {
          setOutside(true);
          setScreen("loading");
          return;
        }
        const msg = e.message || "Failed to start Discord activity";
        const cold = /502|503|504|يستيقظ|bad gateway|failed to fetch|network/i.test(msg);
        if (cold && bootKey < 2) {
          setStatus("الخادم يستيقظ — نعيد المحاولة…");
          retryTimer = setTimeout(() => setBootKey((k) => k + 1), 3500);
          return;
        }
        setError(
          cold
            ? "الخادم يستيقظ (Render Free). افتح الأكتيفتي مرة ثانية بعد 15–20 ثانية."
            : msg
        );
        setScreen("loading");
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubLayout();
      sock?.close();
    };
  }, [bootKey]);

  useEffect(() => {
    if (!session?.sdk) return;
    publishPresence(session.sdk, {
      title: room.state?.title,
      poster: room.state?.poster || room.state?.banner,
      people: room.participants?.length || 1,
      season: room.state?.season,
      episode: room.state?.episode,
      kind: room.state?.kind,
    });
  }, [
    session?.sdk,
    room.state?.title,
    room.state?.poster,
    room.state?.banner,
    room.state?.season,
    room.state?.episode,
    room.state?.kind,
    room.participants?.length,
  ]);

  const persistWatch = useCallback((patch) => {
    if (!patch?.title && !patch?.mediaId) return;
    saveLastWatched(patch);
    api.bridgePushHistory({
      mediaId: patch.mediaId,
      title: patch.title,
      kind: patch.kind,
      season: patch.season,
      episode: patch.episode,
      poster: patch.poster,
      at: Date.now(),
    });
  }, []);

  const onPick = useCallback(
    (patch) => {
      if (!room.youAreHost && room.state?.hostUserId) {
        setError("فقط الهوست يقدر يختار الفيلم");
        return;
      }
      socket?.sendControl(patch);
      setRoom((prev) => ({
        ...prev,
        state: { ...(prev.state || {}), ...patch, updatedAt: Date.now() },
      }));
      persistWatch(patch);
      setDetailItem(null);
      setScreen("theater");
    },
    [socket, room.youAreHost, room.state?.hostUserId, persistWatch]
  );

  const onSuggest = useCallback(
    (item) => {
      socket?.suggestQueue({
        mediaId: item.mediaId,
        kind: item.kind,
        title: item.title,
        poster: item.poster,
        season: item.season,
        episode: item.episode,
        animeType: item.animeType,
        quality: item.quality,
        sourceUrl: item.sourceUrl,
      });
      setError("");
      setStatus("تمت إضافة الاقتراح للطابور");
      setDetailItem(null);
      setScreen("home");
    },
    [socket]
  );

  const onHostControl = useCallback(
    (patch) => {
      socket?.sendControl(patch);
      if (patch?.mediaId || patch?.title) persistWatch({ ...(room.state || {}), ...patch });
    },
    [socket, persistWatch, room.state]
  );

  const minimized = layoutMode === LAYOUT.PIP || layoutMode === LAYOUT.GRID;

  const content = useMemo(() => {
    if (screen === "loading" || !session) {
      return <LoadingSplash status={status} error={error} outside={outside} />;
    }
    if (minimized) {
      return (
        <PipCard
          title={room.state?.title}
          poster={room.state?.poster || room.state?.banner}
          peopleCount={room.participants?.length || 0}
          season={room.state?.season}
          episode={room.state?.episode}
          playing={Boolean(room.state?.playing)}
          isHost={room.youAreHost}
          onTogglePlay={(playing) => {
            if (!room.youAreHost) return;
            onHostControl({
              playing,
              currentTime: room.state?.currentTime || 0,
            });
          }}
        />
      );
    }
    if (screen === "theater") {
      return (
        <Theater
          room={room}
          socket={socket}
          selfUserId={session.user?.id}
          onBack={() => setScreen("home")}
          onHostControl={onHostControl}
        />
      );
    }
    if (screen === "detail" && detailItem) {
      return (
        <TitleDetail
          item={detailItem}
          room={room}
          onBack={() => {
            setDetailItem(null);
            setScreen("home");
          }}
          onPlay={onPick}
          onSuggest={onSuggest}
        />
      );
    }
    return (
      <ActivityHome
        session={session}
        room={room}
        onOpenDetail={(item) => {
          setDetailItem(item);
          setScreen("detail");
        }}
        onSuggest={onSuggest}
      />
    );
  }, [
    screen,
    session,
    status,
    error,
    outside,
    room,
    onPick,
    onHostControl,
    onSuggest,
    minimized,
    detailItem,
    socket,
  ]);

  return (
    <div className={`shell ${minimized ? "shell-pip" : ""}`}>
      {error && screen !== "loading" && (
        <div className="error-box browse-error toast-error" onClick={() => setError("")}>
          {error}
        </div>
      )}
      {content}
    </div>
  );
}
