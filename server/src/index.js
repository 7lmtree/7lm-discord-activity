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

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "7lm-discord-activity",
    moviesApi: config.moviesApiBase,
    discordConfigured: Boolean(config.discordClientId && config.discordClientSecret),
  });
});

app.post("/api/discord/token", async (req, res) => {
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
});

/** BFF: proxy movie/anime API so Discord needs one /api mapping */
app.use("/api", async (req, res, next) => {
  if (req.path === "/health" || req.path.startsWith("/discord")) return next();
  if (res.headersSent) return next();
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
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.send(text);
  } catch (err) {
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
});
