/** Watch rooms keyed by Discord activity instanceId — with queue, host transfer, persistence */

function emptyState() {
  return {
    mediaId: null,
    kind: "movie",
    title: null,
    poster: null,
    banner: null,
    description: null,
    season: null,
    episode: null,
    maxEpisode: null,
    seasons: null,
    animeType: null,
    quality: null,
    sources: [],
    subtitles: [],
    subtitleLang: null,
    sourceUrl: null,
    playing: false,
    currentTime: 0,
    hostUserId: null,
    queue: [],
    hostVotes: {},
    updatedAt: Date.now(),
  };
}

const CONTROL_KEYS = [
  "mediaId",
  "kind",
  "title",
  "poster",
  "banner",
  "description",
  "season",
  "episode",
  "maxEpisode",
  "seasons",
  "animeType",
  "quality",
  "sources",
  "subtitles",
  "subtitleLang",
  "sourceUrl",
  "playing",
  "currentTime",
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createWatchHub({ store, onTitleChange } = {}) {
  const rooms = new Map();

  function getLive(instanceId) {
    let room = rooms.get(instanceId);
    if (!room) {
      room = { state: emptyState(), clients: new Map(), persistTimer: null };
      rooms.set(instanceId, room);
    }
    return room;
  }

  async function hydrate(instanceId) {
    const room = getLive(instanceId);
    if (room._hydrated || !store) return room;
    room._hydrated = true;
    try {
      const saved = await store.get(instanceId);
      if (saved && typeof saved === "object") {
        room.state = {
          ...emptyState(),
          ...saved,
          hostVotes: saved.hostVotes || {},
          queue: Array.isArray(saved.queue) ? saved.queue : [],
        };
      }
    } catch (err) {
      console.warn("[watchRooms] hydrate failed:", err.message);
    }
    return room;
  }

  function schedulePersist(instanceId, room) {
    if (!store) return;
    if (room.persistTimer) clearTimeout(room.persistTimer);
    room.persistTimer = setTimeout(() => {
      store.set(instanceId, { ...room.state }).catch((err) => {
        console.warn("[watchRooms] persist failed:", err.message);
      });
    }, 400);
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

  function emitState(room, extra = {}) {
    broadcast(room, {
      type: "state",
      state: room.state,
      participants: participants(room),
      hostUserId: room.state.hostUserId,
      ...extra,
    });
  }

  function maybeNotify(room, prev) {
    if (!onTitleChange) return;
    const changed =
      prev?.mediaId !== room.state.mediaId ||
      prev?.season !== room.state.season ||
      prev?.episode !== room.state.episode ||
      prev?.sourceUrl !== room.state.sourceUrl;
    if (!changed || !room.state.mediaId) return;
    const host = [...room.clients.values()].find((p) => p.userId === room.state.hostUserId);
    onTitleChange(room.state, { hostName: host?.username });
  }

  async function join(ws, instanceId, user) {
    const room = await hydrate(instanceId);
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
      hostUserId: room.state.hostUserId,
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
    schedulePersist(instanceId, room);
  }

  function leave(ws) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    const wasHost = room.state.hostUserId === ws._userId;
    room.clients.delete(ws);

    if (room.state.hostVotes) {
      delete room.state.hostVotes[ws._userId];
      for (const [voter, target] of Object.entries(room.state.hostVotes)) {
        if (target === ws._userId) delete room.state.hostVotes[voter];
      }
    }

    if (room.clients.size === 0) {
      schedulePersist(instanceId, room);
      rooms.delete(instanceId);
      return;
    }
    if (wasHost) {
      pickHost(room);
      room.state.hostVotes = {};
    }
    broadcast(room, {
      type: "participants",
      participants: participants(room),
      hostUserId: room.state.hostUserId,
    });
    if (wasHost) emitState(room);
    schedulePersist(instanceId, room);
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
    const prev = { ...room.state };
    for (const key of CONTROL_KEYS) {
      if (patch[key] !== undefined) room.state[key] = patch[key];
    }
    room.state.updatedAt = Date.now();
    broadcast(room, {
      type: "state",
      state: room.state,
      hostUserId: room.state.hostUserId,
      from: ws._userId,
      participants: participants(room),
    });
    maybeNotify(room, prev);
    schedulePersist(instanceId, room);
  }

  function suggestQueue(ws, item) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    const client = room.clients.get(ws);
    if (!client || !item?.title) return;
    const entry = {
      id: uid(),
      mediaId: item.mediaId || item.id || null,
      kind: item.kind || "movie",
      title: String(item.title).slice(0, 200),
      poster: item.poster || null,
      season: item.season ?? null,
      episode: item.episode ?? null,
      animeType: item.animeType || null,
      quality: item.quality || null,
      sourceUrl: item.sourceUrl || null,
      sources: Array.isArray(item.sources) ? item.sources : [],
      subtitles: Array.isArray(item.subtitles) ? item.subtitles : [],
      subtitleLang: item.subtitleLang || null,
      suggestedBy: client.userId,
      suggestedByName: client.username,
      at: Date.now(),
    };
    room.state.queue = [...(room.state.queue || []), entry].slice(-30);
    room.state.updatedAt = Date.now();
    broadcast(room, { type: "queue", queue: room.state.queue });
    emitState(room);
    schedulePersist(instanceId, room);
  }

  function acceptQueue(ws, queueId) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    if (room.state.hostUserId !== ws._userId) {
      send(ws, { type: "error", message: "Only the host can accept queue items" });
      return;
    }
    const entry = (room.state.queue || []).find((q) => q.id === queueId);
    if (!entry) return;
    const prev = { ...room.state };
    room.state.queue = (room.state.queue || []).filter((q) => q.id !== queueId);
    if (entry.sourceUrl) {
      room.state.mediaId = entry.mediaId;
      room.state.kind = entry.kind;
      room.state.title = entry.title;
      room.state.poster = entry.poster;
      room.state.season = entry.season;
      room.state.episode = entry.episode;
      room.state.animeType = entry.animeType;
      room.state.quality = entry.quality;
      room.state.sourceUrl = entry.sourceUrl;
      room.state.sources = entry.sources || [];
      room.state.subtitles = entry.subtitles || [];
      room.state.subtitleLang = entry.subtitleLang || null;
      room.state.playing = true;
      room.state.currentTime = 0;
    }
    room.state.updatedAt = Date.now();
    emitState(room);
    broadcast(room, { type: "queue", queue: room.state.queue });
    if (entry.sourceUrl) maybeNotify(room, prev);
    schedulePersist(instanceId, room);
  }

  function removeQueue(ws, queueId) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    const client = room.clients.get(ws);
    const entry = (room.state.queue || []).find((q) => q.id === queueId);
    if (!entry) return;
    const isHost = room.state.hostUserId === ws._userId;
    if (!isHost && entry.suggestedBy !== client?.userId) {
      send(ws, { type: "error", message: "Cannot remove this queue item" });
      return;
    }
    room.state.queue = (room.state.queue || []).filter((q) => q.id !== queueId);
    room.state.updatedAt = Date.now();
    broadcast(room, { type: "queue", queue: room.state.queue });
    emitState(room);
    schedulePersist(instanceId, room);
  }

  function transferHost(ws, targetUserId) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    if (room.state.hostUserId !== ws._userId) {
      send(ws, { type: "error", message: "Only the host can transfer" });
      return;
    }
    const target = String(targetUserId);
    const exists = [...room.clients.values()].some((p) => p.userId === target);
    if (!exists) {
      send(ws, { type: "error", message: "User not in room" });
      return;
    }
    room.state.hostUserId = target;
    room.state.hostVotes = {};
    room.state.updatedAt = Date.now();
    emitState(room);
    broadcast(room, {
      type: "participants",
      participants: participants(room),
      hostUserId: room.state.hostUserId,
    });
    schedulePersist(instanceId, room);
  }

  function voteHost(ws, targetUserId) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    const voter = ws._userId;
    const target = String(targetUserId);
    if (target === room.state.hostUserId) return;
    const exists = [...room.clients.values()].some((p) => p.userId === target);
    if (!exists) return;

    room.state.hostVotes = { ...(room.state.hostVotes || {}), [voter]: target };
    const votes = Object.values(room.state.hostVotes).filter((v) => v === target).length;
    const needed = Math.ceil(Math.max(1, room.clients.size - 1) / 2);
    broadcast(room, {
      type: "host_votes",
      hostVotes: room.state.hostVotes,
      target,
      votes,
      needed,
    });

    if (votes >= needed && room.clients.size >= 2) {
      room.state.hostUserId = target;
      room.state.hostVotes = {};
      room.state.updatedAt = Date.now();
      emitState(room);
      broadcast(room, {
        type: "participants",
        participants: participants(room),
        hostUserId: room.state.hostUserId,
      });
    }
    schedulePersist(instanceId, room);
  }

  function requestSync(ws) {
    const instanceId = ws._instanceId;
    if (!instanceId) return;
    const room = rooms.get(instanceId);
    if (!room) return;
    send(ws, {
      type: "state",
      state: room.state,
      participants: participants(room),
      youAreHost: room.state.hostUserId === ws._userId,
      hostUserId: room.state.hostUserId,
      resync: true,
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
    if (msg.type === "suggest_queue" && msg.item) {
      suggestQueue(ws, msg.item);
      return;
    }
    if (msg.type === "accept_queue" && msg.id) {
      acceptQueue(ws, msg.id);
      return;
    }
    if (msg.type === "remove_queue" && msg.id) {
      removeQueue(ws, msg.id);
      return;
    }
    if (msg.type === "transfer_host" && msg.userId) {
      transferHost(ws, msg.userId);
      return;
    }
    if (msg.type === "vote_host" && msg.userId) {
      voteHost(ws, msg.userId);
      return;
    }
    if (msg.type === "request_sync") {
      requestSync(ws);
      return;
    }
    if (msg.type === "ping") {
      send(ws, { type: "pong", t: Date.now() });
    }
  }

  return { handleMessage, leave };
}
