import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSplash from "./screens/LoadingSplash.jsx";
import ActivityHome from "./screens/ActivityHome.jsx";
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

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [status, setStatus] = useState("نجهّز الجلسة…");
  const [error, setError] = useState("");
  const [outside, setOutside] = useState(false);
  const [session, setSession] = useState(null);
  const [layoutMode, setLayoutMode] = useState(LAYOUT.FOCUSED);
  const [room, setRoom] = useState({
    state: null,
    participants: [],
    youAreHost: false,
    hostUserId: null,
  });
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let sock = null;
    let unsubLayout = () => {};

    (async () => {
      try {
        if (!isProbablyInDiscord()) {
          setOutside(true);
          setScreen("loading");
          return;
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
            if (msg.type === "error") setError(msg.message || "Room error");
          },
        });
        setSocket(sock);
        setScreen("home");
      } catch (e) {
        if (cancelled) return;
        if (e.message === "OUTSIDE_DISCORD") {
          setOutside(true);
        } else {
          setError(e.message || "Failed to start Discord activity");
        }
        setScreen("loading");
      }
    })();

    return () => {
      cancelled = true;
      unsubLayout();
      sock?.close();
    };
  }, []);

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
      setScreen("theater");
    },
    [socket, room.youAreHost, room.state?.hostUserId]
  );

  const onHostControl = useCallback(
    (patch) => {
      socket?.sendControl(patch);
    },
    [socket]
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
        />
      );
    }
    if (screen === "theater") {
      return (
        <Theater
          room={room}
          onBack={() => setScreen("home")}
          onHostControl={onHostControl}
        />
      );
    }
    return <ActivityHome session={session} room={room} onPick={onPick} />;
  }, [screen, session, status, error, outside, room, onPick, onHostControl, minimized]);

  return <div className={`shell ${minimized ? "shell-pip" : ""}`}>{content}</div>;
}
