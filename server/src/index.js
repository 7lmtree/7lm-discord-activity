import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { createWatchHub } from "./watchRooms.js";
import { createRoomStore } from "./roomStore.js";
import { createTtlCache } from "./cache.js";
import { recordTelemetry, listTelemetry } from "./telemetry.js";
import { createNotifyHook } from "./discordNotify.js";
import { attachDiscordInteractions } from "./discordBot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();
app.use(cors({ origin: config.clientOrigin === "*" ? true : config.clientOrigin }));
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      if (req.originalUrl?.startsWith("/api/discord/interactions")) {
        req.rawBody = buf.toString("utf8");
      }
    },
  })
);

const apiCache = createTtlCache({ defaultTtlMs: 90_000, maxEntries: 250 });
let roomStoreMode = "memory+file";

function cacheKey(req) {
  return `${req.method}:${req.path}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
}

function shouldCacheGet(req) {
  if (req.method !== "GET") return false;
  return (
    req.path.startsWith("/trending") ||
    req.path.startsWith("/anime/trending") ||
    req.path.startsWith("/anime/popular") ||
    req.path.startsWith("/anime/sources/") ||
    req.path.startsWith("/sources/") ||
    req.path.startsWith("/movie/")
  );
}

function cacheTtlFor(pathName) {
  if (pathName.startsWith("/sources/") || pathName.startsWith("/anime/sources/")) return 45_000;
  if (pathName.startsWith("/movie/")) return 120_000;
  return 90_000;
}

async function exchangeDiscordToken(req, res) {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: "Missing code" });
  if (!config.discordClientId || !config.discordClientSecret) {
    return res.status(500).json({ error: "Discord credentials not configured on server" });
  }

  try {
    const body = new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: "authorization_code",
      code: String(code),
    });
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error: json?.error_description || json?.error || "Token exchange failed",
      });
    }
    return res.json({ access_token: json.access_token });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Token exchange failed" });
  }
}

async function warmMoviesApi() {
  try {
    const upstream = await fetch(`${config.moviesApiBase}/api/trending?perPage=12`, {
      headers: { Accept: "application/json" },
    });
    if (upstream.ok) {
      const text = await upstream.text();
      apiCache.set("GET:/trending?perPage=12", text, 90_000);
      console.log("Warmed movies trending cache");
    }
  } catch (err) {
    console.warn("Warm movies API failed:", err.message);
  }
}

function healthPayload() {
  return {
    ok: true,
    service: "7lm-discord-activity",
    moviesApi: config.moviesApiBase,
    discordConfigured: Boolean(config.discordClientId && config.discordClientSecret),
    botConfigured: Boolean(config.discordBotToken),
    notifyConfigured: Boolean(config.discordBotToken && config.discordNotifyChannelId),
    interactionsConfigured: Boolean(config.discordPublicKey),
    redisConfigured: Boolean(config.redisUrl),
    roomStore: roomStoreMode,
    accountBridge: Boolean(config.accountApiBase),
    clientId: config.discordClientId || null,
    cache: apiCache.stats(),
  };
}

app.get("/api/health", (_req, res) => {
  res.json(healthPayload());
});

app.post("/api/token", exchangeDiscordToken);
app.post("/api/discord/token", exchangeDiscordToken);

attachDiscordInteractions(app, { getHealth: healthPayload });

/** Lightweight playback telemetry */
app.post("/api/telemetry", (req, res) => {
  const body = req.body || {};
  recordTelemetry({
    type: body.type || "playback",
    sourceType: body.sourceType || null,
    loadMs: body.loadMs != null ? Number(body.loadMs) : null,
    error: body.error ? String(body.error).slice(0, 300) : null,
    title: body.title ? String(body.title).slice(0, 120) : null,
    kind: body.kind || null,
    mediaId: body.mediaId || null,
    quality: body.quality || null,
  });
  res.json({ ok: true });
});

app.get("/api/telemetry", (req, res) => {
  const limit = Number(req.query.limit || 50);
  res.json({ events: listTelemetry(limit) });
});

/**
 * Optional EN→AR description helper (MyMemory — no heavy deps).
 * Only used when Arabic text is missing on the client.
 */
app.post("/api/translate/ar", async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 1800);
  if (!text) return res.status(400).json({ error: "Missing text" });
  if (/[\u0600-\u06FF]/.test(text)) {
    return res.json({ text, translated: false, reason: "already_arabic" });
  }
  const cacheK = `tr:ar:${text.slice(0, 80)}:${text.length}`;
  const cached = apiCache.get(cacheK);
  if (cached) {
    try {
      return res.json(JSON.parse(cached));
    } catch {
      /* miss */
    }
  }
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ar`;
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    const json = await upstream.json();
    const translated = json?.responseData?.translatedText || text;
    // MyMemory returns quota warnings as "translatedText" — never show/cache those.
    if (/MYMEMORY WARNING/i.test(translated) || /AVAILABLE FREE TRANSLATIONS/i.test(translated)) {
      return res.json({ text, translated: false, reason: "quota", provider: "mymemory" });
    }
    const payload = { text: translated, translated: translated !== text, provider: "mymemory" };
    if (payload.translated) {
      apiCache.set(cacheK, JSON.stringify(payload), 6 * 60 * 60 * 1000);
    }
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Translate failed", text });
  }
});

/**
 * Account bridge stubs toward 7lmmovie favorites/history.
 * Proxies only when ACCOUNT_API_BASE is set; otherwise returns safe empty payloads.
 */
app.get("/api/bridge/favorites", async (req, res) => {
  if (!config.accountApiBase) {
    return res.json({
      items: [],
      stub: true,
      message: "ACCOUNT_API_BASE not configured — favorites bridge inactive",
    });
  }
  try {
    const auth = req.get("authorization") || "";
    const upstream = await fetch(`${config.accountApiBase}/api/favorites`, {
      headers: { Accept: "application/json", ...(auth ? { Authorization: auth } : {}) },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Favorites bridge failed", items: [] });
  }
});

app.get("/api/bridge/history", async (req, res) => {
  if (!config.accountApiBase) {
    return res.json({
      items: [],
      stub: true,
      message: "ACCOUNT_API_BASE not configured — history bridge inactive",
    });
  }
  try {
    const auth = req.get("authorization") || "";
    const upstream = await fetch(`${config.accountApiBase}/api/history`, {
      headers: { Accept: "application/json", ...(auth ? { Authorization: auth } : {}) },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: err.message || "History bridge failed", items: [] });
  }
});

app.post("/api/bridge/history", async (req, res) => {
  if (!config.accountApiBase) {
    return res.json({ ok: true, stub: true, saved: req.body || null });
  }
  try {
    const auth = req.get("authorization") || "";
    const upstream = await fetch(`${config.accountApiBase}/api/history`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
      },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: err.message || "History bridge failed" });
  }
});

/** Image proxy — Discord Activity CSP blocks external poster hosts */
app.get("/api/img", async (req, res) => {
  try {
    const raw = String(req.query.u || "");
    if (!raw) return res.status(400).json({ error: "Missing u" });
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return res.status(400).json({ error: "Invalid protocol" });
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local") ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
    ) {
      return res.status(400).json({ error: "Blocked host" });
    }
    const upstream = await fetch(url.href, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "7LM-Discord-Activity/1.0",
      },
      redirect: "follow",
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "Upstream image failed" });
    const ct = upstream.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(ct) && !/octet-stream/i.test(ct)) {
      return res.status(415).json({ error: "Not an image" });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.send(buf);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Image proxy failed" });
  }
});

/** BFF: proxy movie/anime API so Discord needs one /api mapping */
app.use("/api", async (req, res, next) => {
  if (
    req.path === "/health" ||
    req.path.startsWith("/discord") ||
    req.path === "/token" ||
    req.path === "/img" ||
    req.path === "/telemetry" ||
    req.path.startsWith("/translate") ||
    req.path.startsWith("/bridge")
  ) {
    return next();
  }
  if (res.headersSent) return next();

  const key = cacheKey(req);
  const cacheable = shouldCacheGet(req);
  if (cacheable) {
    const hit = apiCache.get(key);
    if (hit) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "HIT");
      return res.send(hit);
    }
  }

  const target = `${config.moviesApiBase}/api${req.url}`;
  try {
    const headers = { Accept: "application/json" };
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    if (res.headersSent) return;
    if (cacheable && upstream.ok) {
      apiCache.set(key, text, cacheTtlFor(req.path));
    }
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("X-Cache", "MISS");
    res.send(text);
  } catch (err) {
    if (cacheable) {
      const stale = apiCache.get(key);
      if (stale) {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("X-Cache", "STALE");
        return res.send(stale);
      }
    }
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || "Upstream proxy failed" });
    }
  }
});

app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(404).json({ error: "Client not built. Run npm run build in client/." });
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/watch" });

const store = await createRoomStore();
roomStoreMode = store.mode;
const hub = createWatchHub({
  store,
  onTitleChange: createNotifyHook(),
});

wss.on("connection", (ws) => {
  ws.on("message", (data) => hub.handleMessage(ws, data));
  ws.on("close", () => hub.leave(ws));
  ws.on("error", () => hub.leave(ws));
});

server.listen(config.port, () => {
  console.log(`7LM Discord Activity server on :${config.port}`);
  console.log(`Room store: ${roomStoreMode}`);
  warmMoviesApi();
  setInterval(warmMoviesApi, 4 * 60 * 1000);
});
