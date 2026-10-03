// Storage for table counts: { [tableId]: { n, t, by } }
// - On Vercel: Upstash Redis REST (KV_REST_API_URL/KV_REST_API_TOKEN or
//   UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN, set by the Vercel
//   Marketplace "Upstash for Redis" integration).
// - Anywhere else: a local JSON file (DATA_FILE, default ./data/tables.json).
const fs = require("fs");
const path = require("path");

const HASH_KEY = process.env.REDIS_KEY || "wedding:tables";
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`redis: ${body.error || res.status}`);
  return body.result;
}

const redisStore = {
  async getAll() {
    const flat = (await redis(["HGETALL", HASH_KEY])) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
    return out;
  },
  async get(id) {
    const v = await redis(["HGET", HASH_KEY, String(id)]);
    return v ? JSON.parse(v) : null;
  },
  async set(id, rec) {
    await redis(["HSET", HASH_KEY, String(id), JSON.stringify(rec)]);
  },
  async clear() {
    await redis(["DEL", HASH_KEY]);
  },
};

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "tables.json");
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, DATA_FILE);
}

const fileStore = {
  async getAll() {
    return { ...load() };
  },
  async get(id) {
    return load()[id] || null;
  },
  async set(id, rec) {
    load()[id] = rec;
    persist();
  },
  async clear() {
    cache = {};
    persist();
  },
};

module.exports = REDIS_URL && REDIS_TOKEN ? redisStore : fileStore;
