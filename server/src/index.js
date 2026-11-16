import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { createWatchHub } from "./watchRooms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();
app.use(cors({ origin: config.clientOrigin === "*" ? true : config.clientOrigin }));
app.use(express.json({ limit: "256kb" }));

const trendingCache = { body: null, at: 0, ttlMs: 90_000 };

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
      trendingCache.body = await upstream.text();
      trendingCache.at = Date.now();
      console.log("Warmed movies trending cache");
    }
  } catch (err) {
    console.warn("Warm movies API failed:", err.message);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "7lm-discord-activity",
    moviesApi: config.moviesApiBase,
    discordConfigured: Boolean(config.discordClientId && config.discordClientSecret),
    clientId: config.discordClientId || null,
  });
});

app.post("/api/token", exchangeDiscordToken);
app.post("/api/discord/token", exchangeDiscordToken);

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
    req.path === "/img"
  ) {
    return next();
  }
  if (res.headersSent) return next();

  const isTrendingGet = req.method === "GET" && req.path.startsWith("/trending");
  if (isTrendingGet && trendingCache.body && Date.now() - trendingCache.at < trendingCache.ttlMs) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "HIT");
    return res.send(trendingCache.body);
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
    if (isTrendingGet && upstream.ok) {
      trendingCache.body = text;
      trendingCache.at = Date.now();
    }
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("X-Cache", "MISS");
    res.send(text);
  } catch (err) {
    if (isTrendingGet && trendingCache.body) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "STALE");
      return res.send(trendingCache.body);
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
const hub = createWatchHub();

wss.on("connection", (ws) => {
  ws.on("message", (data) => hub.handleMessage(ws, data));
  ws.on("close", () => hub.leave(ws));
  ws.on("error", () => hub.leave(ws));
});

server.listen(config.port, () => {
  console.log(`7LM Discord Activity server on :${config.port}`);
  warmMoviesApi();
  setInterval(warmMoviesApi, 4 * 60 * 1000);
});
