import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8787),
  discordClientId: process.env.DISCORD_CLIENT_ID || "",
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  discordBotToken: process.env.DISCORD_BOT_TOKEN || "",
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY || "",
  discordNotifyChannelId: process.env.DISCORD_NOTIFY_CHANNEL_ID || "",
  moviesApiBase: (
    process.env.MOVIES_API_BASE || "https://emnex-movies-backend.onrender.com"
  ).replace(/\/$/, ""),
  /** Optional bridge toward 7lmmovie site account APIs (stub-safe if unset) */
  accountApiBase: (process.env.ACCOUNT_API_BASE || "").replace(/\/$/, ""),
  clientOrigin: process.env.CLIENT_ORIGIN || "*",
  redisUrl: process.env.REDIS_URL || "",
  roomPersistPath:
    process.env.ROOM_PERSIST_PATH ||
    path.resolve(__dirname, "../../data/rooms.json"),
};
