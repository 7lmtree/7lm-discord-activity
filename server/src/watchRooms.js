/** In-memory watch rooms keyed by Discord activity instanceId */

function emptyState() {
  return {
    mediaId: null,
    kind: "movie",
    title: null,
    poster: null,
    season: null,
    episode: null,
    sourceUrl: null,
    playing: false,
    currentTime: 0,
    hostUserId: null,
    updatedAt: Date.now(),
  };
}

export function createWatchHub() {
  const rooms = new Map();

  function getRoom(instanceId) {
    let room = rooms.get(instanceId);
    if (!room) {
      room = { state: emptyState(), clients: new Map() };
      rooms.set(instanceId, room);
    }
    return room;
  }

  function participants(room) {
    return [...room.clients.values()];
  }

  function broadcast(room, payload, except = null) {
    const raw = JSON.stringify(payload);
    for (const [ws] of room.clients) {
      if (ws !== except && ws.readyState === 1) ws.send(raw);
    }
  }

  function send(ws, payload) {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  }

  function pickHost(room) {
    const first = room.clients.values().next().value;
    room.state.hostUserId = first?.userId || null;
  }

  function join(ws, instanceId, user) {
    const room = getRoom(instanceId);
    room.clients.set(ws, {
      userId: String(user.userId),
      username: user.username || "Viewer",
      avatar: user.avatar || null,
    });
    if (!room.state.hostUserId) pickHost(room);
    ws._instanceId = instanceId;
    ws._userId = String(user.userId);

    send(ws, {
      type: "state",
      state: room.state,
      participants: participants(room),
      youAreHost: room.state.hostUserId === String(user.userId),
    });
    broadcast(
      room,
      {
        type: "participants",
        participants: participants(room),
        hostUserId: room.state.hostUserId,
      },
      ws
    );
  }

  function leave(ws) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    const wasHost = room.state.hostUserId === ws._userId;
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(instanceId);
      return;
    }
    if (wasHost) pickHost(room);
    broadcast(room, {
      type: "participants",
      participants: participants(room),
      hostUserId: room.state.hostUserId,
    });
    if (wasHost) {
      broadcast(room, {
        type: "state",
        state: room.state,
        hostUserId: room.state.hostUserId,
      });
    }
  }

  function control(ws, patch) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    if (room.state.hostUserId !== ws._userId) {
      send(ws, { type: "error", message: "Only the host can control playback" });
      return;
    }
    const allowed = [
      "mediaId",
      "kind",
      "title",
      "poster",
      "season",
      "episode",
      "sourceUrl",
      "playing",
      "currentTime",
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) room.state[key] = patch[key];
    }
    room.state.updatedAt = Date.now();
    broadcast(room, {
      type: "state",
      state: room.state,
      hostUserId: room.state.hostUserId,
      from: ws._userId,
    });
  }

  function handleMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "join" && msg.instanceId && msg.user) {
      join(ws, String(msg.instanceId), msg.user);
      return;
    }
    if (msg.type === "control" && msg.patch) {
      control(ws, msg.patch);
      return;
    }
    if (msg.type === "ping") {
      send(ws, { type: "pong", t: Date.now() });
    }
  }

  return { handleMessage, leave };
}
