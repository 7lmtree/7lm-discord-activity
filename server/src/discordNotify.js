import { config } from "./config.js";

/**
 * Episode / title change notifications via Discord bot REST.
 * No-op when DISCORD_BOT_TOKEN or DISCORD_NOTIFY_CHANNEL_ID missing.
 */

let lastKey = "";

export async function notifyTitleChange(payload = {}) {
  const token = config.discordBotToken;
  const channelId = config.discordNotifyChannelId;
  if (!token || !channelId) {
    return { ok: false, skipped: true, reason: "missing DISCORD_BOT_TOKEN or DISCORD_NOTIFY_CHANNEL_ID" };
  }

  const title = payload.title || "عنوان جديد";
  const ep =
    payload.season != null && payload.episode != null
      ? ` · الموسم ${payload.season} · الحلقة ${payload.episode}`
      : payload.episode != null
        ? ` · الحلقة ${payload.episode}`
        : "";
  const host = payload.hostName ? ` (هوست: ${payload.hostName})` : "";
  const key = `${payload.mediaId || ""}|${payload.season}|${payload.episode}|${payload.sourceUrl || ""}`;
  if (key === lastKey) return { ok: true, deduped: true };
  lastKey = key;

  const content = `🎬 **7LM Watch** — تغيّر العنوان إلى **${title}**${ep}${host}`;

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn("[discordNotify] failed:", res.status, text.slice(0, 200));
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[discordNotify] error:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Hook used by watch rooms — safe to call always */
export function createNotifyHook() {
  return (roomState, meta = {}) => {
    if (!roomState?.title && !roomState?.mediaId) return;
    notifyTitleChange({
      mediaId: roomState.mediaId,
      title: roomState.title,
      season: roomState.season,
      episode: roomState.episode,
      sourceUrl: roomState.sourceUrl,
      hostName: meta.hostName,
    }).catch(() => {});
  };
}
