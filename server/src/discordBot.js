import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * Minimal Discord bot scaffolding:
 * - Slash-command registration via REST
 * - Interactions HTTP endpoint (Ed25519 verify)
 * - Commands: /7lm-status, /7lm-watch, /7lm-help
 *
 * Env: DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_CLIENT_ID, DISCORD_NOTIFY_CHANNEL_ID
 */

export const BOT_COMMANDS = [
  {
    name: "7lm-help",
    description: "Help for 7LM Movie Discord Activity",
    type: 1,
  },
  {
    name: "7lm-status",
    description: "Show 7LM Activity server status",
    type: 1,
  },
  {
    name: "7lm-watch",
    description: "How to start a 7LM watch party in a voice channel",
    type: 1,
  },
];

function verifyDiscordSignature(req, rawBody) {
  const signature = req.get("X-Signature-Ed25519");
  const timestamp = req.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !config.discordPublicKey) return false;
  try {
    const message = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, "hex");
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(config.discordPublicKey, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, message, key, sig);
  } catch (err) {
    console.warn("[discordBot] signature verify failed:", err.message);
    return false;
  }
}

export function attachDiscordInteractions(app, { getHealth } = {}) {
  app.post("/api/discord/interactions", (req, res) => {
    const raw = req.rawBody || JSON.stringify(req.body || {});
    if (!config.discordPublicKey) {
      return res.status(503).json({ error: "DISCORD_PUBLIC_KEY not configured" });
    }
    if (!verifyDiscordSignature(req, raw)) {
      return res.status(401).send("invalid request signature");
    }

    const body = req.body || {};

    if (body.type === 1) {
      return res.json({ type: 1 });
    }

    if (body.type === 2) {
      const name = body.data?.name;
      if (name === "7lm-help") {
        return res.json({
          type: 4,
          data: {
            content:
              "**7LM Movie Activity**\n" +
              "1) انضم لقناة صوتية\n" +
              "2) افتح Activity → **7LM Movie**\n" +
              "3) الهوست يختار فيلم/أنمي والكل يتزامن\n" +
              "أوامر: `/7lm-status` · `/7lm-watch` · `/7lm-help`",
          },
        });
      }
      if (name === "7lm-watch") {
        return res.json({
          type: 4,
          data: {
            content:
              "ابدأ جلسة مشاهدة: Voice channel → Activity launcher → **7LM Movie**. " +
              "استخدم شاشة التفاصيل لاختيار الموسم/الحلقة و Sub/Dub والجودة.",
          },
        });
      }
      if (name === "7lm-status") {
        const health = typeof getHealth === "function" ? getHealth() : { ok: true };
        return res.json({
          type: 4,
          data: {
            content: `7LM Activity: **${health.ok ? "online" : "degraded"}** · rooms: \`${
              health.roomStore || "?"
            }\` · notify: ${health.notifyConfigured ? "on" : "off"}`,
          },
        });
      }
      return res.json({
        type: 4,
        data: { content: "أمر غير معروف — جرّب `/7lm-help`" },
      });
    }

    return res.status(400).json({ error: "unhandled interaction type" });
  });
}

export async function registerSlashCommands() {
  if (!config.discordBotToken || !config.discordClientId) {
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID required");
  }
  const res = await fetch(
    `https://discord.com/api/v10/applications/${config.discordClientId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${config.discordBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(BOT_COMMANDS),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Register failed ${res.status}: ${text}`);
  return JSON.parse(text);
}
