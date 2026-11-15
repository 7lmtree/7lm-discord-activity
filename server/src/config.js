import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 8787),
  discordClientId: process.env.DISCORD_CLIENT_ID || "",
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  moviesApiBase: (
    process.env.MOVIES_API_BASE || "https://emnex-movies-backend.onrender.com"
  ).replace(/\/$/, ""),
  clientOrigin: process.env.CLIENT_ORIGIN || "*",
};
