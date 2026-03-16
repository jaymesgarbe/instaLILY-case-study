/**
 * cache.js — Redis get/set wrapper with graceful degradation.
 * If Redis is unavailable, operations are no-ops (cache misses).
 * This ensures the enrichment pipeline never hard-fails due to cache issues.
 */

const { createClient } = require("redis");
const logger = require("./logger");

let client = null;

async function getClient() {
  if (client?.isOpen) return client;
  client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
  client.on("error", (err) => logger.warn("[Cache] Redis error:", err.message));
  await client.connect().catch((err) => {
    logger.warn("[Cache] Redis unavailable, running without cache:", err.message);
    client = null;
  });
  return client;
}

async function getCache(key) {
  try {
    const c = await getClient();
    if (!c) return null;
    const val = await c.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function setCache(key, value, ttlSeconds = 21600) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // no-op
  }
}

async function deleteCache(key) {
  try {
    const c = await getClient();
    if (!c) return;
    await c.del(key);
  } catch {
    // no-op
  }
}

module.exports = { getCache, setCache, deleteCache };
