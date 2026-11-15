import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSplash from "./screens/LoadingSplash.jsx";
import ActivityHome from "./screens/ActivityHome.jsx";
import Theater from "./screens/Theater.jsx";
import { bootstrapDiscord, isProbablyInDiscord } from "./lib/sdk.js";
import { connectWatchRoom } from "./lib/watchSocket.js";

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [status, setStatus] = useState("Starting…");
  const [error, setError] = useState("");
  const [outside, setOutside] = useState(false);
  const [session, setSession] = useState(null);
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
      sock?.close();
    };
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

  const content = useMemo(() => {
    if (screen === "loading" || !session) {
      return <LoadingSplash status={status} error={error} outside={outside} />;
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
    return (
      <ActivityHome
        session={session}
        room={room}
        onPick={onPick}
      />
    );
  }, [screen, session, status, error, outside, room, onPick, onHostControl]);

  return <div className="shell">{content}</div>;
}
