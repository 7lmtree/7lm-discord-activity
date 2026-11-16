import { apiBase } from "./api.js";
import { debugLog } from "./debugLog.js";

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

/**
 * Watch-room socket with automatic reconnect + request_sync after disconnect.
 */
export function connectWatchRoom({ instanceId, user, onMessage, onStatus }) {
  let ws = null;
  let ping = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer = null;

  const joinPayload = () =>
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
    });

  function clearPing() {
    if (ping) clearInterval(ping);
    ping = null;
  }

  function sendRaw(obj) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function connect() {
    if (closed) return;
    const url = wsUrl();
    onStatus?.(attempt === 0 ? "Connecting watch room…" : "Reconnecting watch room…");
    // #region agent log
    debugLog("D", "watchSocket.js:connect", "ws_connecting", { url, attempt });
    // #endregion
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      attempt = 0;
      onStatus?.("Joined room");
      // #region agent log
      debugLog("D", "watchSocket.js:open", "ws_open", { url });
      // #endregion
      ws.send(joinPayload());
      // After reconnect, ask server for fresh state (also sent on join)
      sendRaw({ type: "request_sync" });
      clearPing();
      ping = setInterval(() => {
        if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    });

    ws.addEventListener("message", (ev) => {
      try {
        onMessage?.(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    });

    ws.addEventListener("close", () => {
      clearPing();
      // #region agent log
      debugLog("D", "watchSocket.js:close", "ws_close", { url, attempt, intentional: closed });
      // #endregion
      if (closed) {
        onStatus?.("Room disconnected");
        return;
      }
      onStatus?.("Room disconnected — reconnecting…");
      const delay = Math.min(15000, 800 * 2 ** Math.min(attempt, 4));
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });

    ws.addEventListener("error", () => {
      // #region agent log
      debugLog("D", "watchSocket.js:error", "ws_error", { url, attempt });
      // #endregion
      onStatus?.("Room connection error");
    });
  }

  connect();

  return {
    sendControl(patch) {
      sendRaw({ type: "control", patch });
    },
    suggestQueue(item) {
      sendRaw({ type: "suggest_queue", item });
    },
    acceptQueue(id) {
      sendRaw({ type: "accept_queue", id });
    },
    removeQueue(id) {
      sendRaw({ type: "remove_queue", id });
    },
    transferHost(userId) {
      sendRaw({ type: "transfer_host", userId });
    },
    voteHost(userId) {
      sendRaw({ type: "vote_host", userId });
    },
    requestSync() {
      sendRaw({ type: "request_sync" });
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearPing();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
