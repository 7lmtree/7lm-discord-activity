import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/**
 * Persistent room state: Redis when REDIS_URL is set, else durable JSON file.
 * Live WebSocket clients stay in memory; this stores serializable room.state (+ queue meta).
 */

const KEY_PREFIX = "7lm:room:";

export async function createRoomStore() {
  let redis = null;
  let mode = "memory+file";

  if (config.redisUrl) {
    try {
      const mod = await import("redis");
      redis = mod.createClient({ url: config.redisUrl });
      redis.on("error", (err) => console.warn("[roomStore] redis error:", err.message));
      await redis.connect();
      mode = "redis";
      console.log("[roomStore] using Redis");
    } catch (err) {
      console.warn("[roomStore] Redis unavailable, falling back to file:", err.message);
      redis = null;
      mode = "memory+file";
    }
  }

  const memory = new Map();
  let fileCache = null;
  let dirty = false;
  let flushTimer = null;

  async function ensureDir() {
    await fs.mkdir(path.dirname(config.roomPersistPath), { recursive: true });
  }

  async function loadFile() {
    if (fileCache) return fileCache;
    try {
      const raw = await fs.readFile(config.roomPersistPath, "utf8");
      fileCache = JSON.parse(raw) || {};
    } catch {
      fileCache = {};
    }
    return fileCache;
  }

  function scheduleFlush() {
    if (mode === "redis") return;
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (!dirty) return;
      dirty = false;
      try {
        await ensureDir();
        const data = await loadFile();
        await fs.writeFile(config.roomPersistPath, JSON.stringify(data), "utf8");
      } catch (err) {
        console.warn("[roomStore] file flush failed:", err.message);
      }
    }, 800);
  }

  async function get(instanceId) {
    const id = String(instanceId);
    if (memory.has(id)) return memory.get(id);

    if (redis) {
      try {
        const raw = await redis.get(KEY_PREFIX + id);
        if (raw) {
          const parsed = JSON.parse(raw);
          memory.set(id, parsed);
          return parsed;
        }
      } catch (err) {
        console.warn("[roomStore] redis get failed:", err.message);
      }
    }

    const file = await loadFile();
    if (file[id]) {
      memory.set(id, file[id]);
      return file[id];
    }
    return null;
  }

  async function set(instanceId, state) {
    const id = String(instanceId);
    const payload = { ...state, updatedAt: Date.now() };
    memory.set(id, payload);

    if (redis) {
      try {
        await redis.set(KEY_PREFIX + id, JSON.stringify(payload), { EX: 60 * 60 * 24 * 7 });
        return;
      } catch (err) {
        console.warn("[roomStore] redis set failed:", err.message);
      }
    }

    const file = await loadFile();
    file[id] = payload;
    scheduleFlush();
  }

  async function del(instanceId) {
    const id = String(instanceId);
    memory.delete(id);
    if (redis) {
      try {
        await redis.del(KEY_PREFIX + id);
      } catch {
        /* ignore */
      }
    }
    const file = await loadFile();
    if (file[id]) {
      delete file[id];
      scheduleFlush();
    }
  }

  return {
    mode,
    get,
    set,
    del,
  };
}
