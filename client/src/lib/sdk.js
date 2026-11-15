import { DiscordSDK } from "@discord/embedded-app-sdk";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "";

let sdk = null;

export function getClientId() {
  return CLIENT_ID;
}

export function getSdk() {
  if (!CLIENT_ID) throw new Error("VITE_DISCORD_CLIENT_ID is missing");
  if (!sdk) sdk = new DiscordSDK(CLIENT_ID);
  return sdk;
}

export function isProbablyInDiscord() {
  try {
    return window.self !== window.top || /\.discordsays\.com$/i.test(window.location.hostname);
  } catch {
    return true;
  }
}

export function avatarUrl(user) {
  if (!user?.id) return "";
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  }
  const idx = Number(BigInt(user.id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

export async function bootstrapDiscord({ onStatus, timeoutMs = 12000 } = {}) {
  const status = (s) => onStatus?.(s);

  if (!CLIENT_ID) {
    throw new Error("حط VITE_DISCORD_CLIENT_ID في ملف .env للعميل");
  }

  if (!isProbablyInDiscord()) {
    throw new Error("OUTSIDE_DISCORD");
  }

  const discordSdk = getSdk();
  status("Connecting to Discord…");

  const ready = discordSdk.ready();
  const timed = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Discord ready timeout — افتح الأكتيفتي من داخل Discord")), timeoutMs)
  );
  await Promise.race([ready, timed]);

  status("Authorizing…");
  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds", "applications.commands"],
  });

  status("Exchanging token…");
  const { api } = await import("./api.js");
  const { access_token } = await api.exchangeToken(code);

  status("Authenticating…");
  const auth = await discordSdk.commands.authenticate({ access_token });

  return {
    sdk: discordSdk,
    auth,
    user: auth.user,
    instanceId: discordSdk.instanceId,
    channelId: discordSdk.channelId,
    guildId: discordSdk.guildId,
  };
}
