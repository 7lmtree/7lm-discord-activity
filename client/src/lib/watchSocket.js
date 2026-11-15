import { apiBase } from "./api.js";

function wsUrl() {
  const base = apiBase();
  if (base.startsWith("http")) {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/ws/watch";
    u.search = "";
    return u.toString();
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const prefix = base || "";
  return `${proto}//${host}${prefix}/ws/watch`;
}

export function connectWatchRoom({ instanceId, user, onMessage, onStatus }) {
  const url = wsUrl();
  onStatus?.("Connecting watch room…");
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    onStatus?.("Joined room");
    ws.send(
      JSON.stringify({
        type: "join",
        instanceId,
        user: {
          userId: user.id,
          username: user.global_name || user.username,
          avatar: user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
            : null,
        },
      })
    );
  });

  ws.addEventListener("message", (ev) => {
    try {
      onMessage?.(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  });

  ws.addEventListener("close", () => onStatus?.("Room disconnected"));
  ws.addEventListener("error", () => onStatus?.("Room connection error"));

  const ping = setInterval(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
  }, 25000);

  return {
    sendControl(patch) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "control", patch }));
      }
    },
    close() {
      clearInterval(ping);
      ws.close();
    },
  };
}
