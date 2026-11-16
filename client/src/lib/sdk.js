import { DiscordSDK, Common } from "@discord/embedded-app-sdk";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "";
export const LAYOUT = Common?.LayoutModeTypeObject || { FOCUSED: 0, PIP: 1, GRID: 2 };

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

function absoluteArt(path) {
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

/** Compact UI when Discord shrinks the Activity (PiP / grid). */
export function subscribeLayoutMode(discordSdk, onMode) {
  if (!discordSdk?.subscribe) return () => {};
  const handler = (update) => {
    const mode = update?.layout_mode;
    if (mode == null) return;
    onMode?.(mode);
  };
  discordSdk.subscribe("ACTIVITY_LAYOUT_MODE_UPDATE", handler);
  return () => {
    try {
      discordSdk.unsubscribe?.("ACTIVITY_LAYOUT_MODE_UPDATE", handler);
    } catch {
      /* ignore */
    }
  };
}

export async function publishPresence(discordSdk, { title, poster, people = 1 } = {}) {
  if (!discordSdk?.commands?.setActivity) return;
  const large =
    (poster && /^https?:\/\//i.test(poster) ? poster : "") || absoluteArt("/art/pip.jpg");
  try {
    await discordSdk.commands.setActivity({
      activity: {
        type: 3,
        details: title ? `يشاهد: ${title}` : "7LM Watch Party",
        state: people > 1 ? `${people} في الغرفة` : "غرفة مشاهدة",
        assets: {
          large_image: large,
          large_text: title || "7LM Watch",
          small_image: absoluteArt("/art/icon.jpg"),
          small_text: "7LM",
        },
      },
    });
  } catch {
    /* rpc.activities.write may be unavailable — Art Assets still cover shelf/PiP chrome */
  }
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
  status("نتصل بديسكورد…");

  const ready = discordSdk.ready();
  const timed = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("انتهت مهلة الاتصال — افتح الأكتيفتي من داخل Discord")), timeoutMs)
  );
  await Promise.race([ready, timed]);

  try {
    await discordSdk.commands.setOrientationLockState({
      lock_state: Common.OrientationLockStateTypeObject.UNLOCKED,
      picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
    });
  } catch {
    /* optional */
  }

  status("جاري التفويض…");
  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "applications.commands", "rpc.activities.write"],
  });

  status("تبادل التوكن…");
  const { api } = await import("./api.js");
  const { access_token } = await api.exchangeToken(code);
  if (!access_token) throw new Error("ما وصل access_token من السيرفر");

  status("تأكيد الهوية…");
  const auth = await discordSdk.commands.authenticate({ access_token });

  try {
    await publishPresence(discordSdk, { title: "جاهز للمشاهدة", people: 1 });
  } catch {
    /* ignore */
  }

  return {
    sdk: discordSdk,
    auth,
    user: auth.user,
    instanceId: discordSdk.instanceId,
    channelId: discordSdk.channelId,
    guildId: discordSdk.guildId,
  };
}
