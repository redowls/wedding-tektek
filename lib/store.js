// Two stores, kept separate on purpose:
//   counts  { [tableId]: { n, t, by } }           how many guests are seated
//   labels  { [tableId]: { label, t, by, edits } } the number printed on the map
//
// tableId is the permanent internal key (1..134) and is never renamed, so two
// tables may show the same number without their counts ever merging.
//
// - On Vercel: Upstash Redis REST (KV_REST_API_URL/KV_REST_API_TOKEN or
//   UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN, set by the Vercel
//   Marketplace "Upstash for Redis" integration).
// - Anywhere else: a local JSON file per store.
const fs = require("fs");
const path = require("path");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "tables.json");
const LABEL_FILE = DATA_FILE.replace(/(\.json)?$/i, "-labels.json");

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

function redisStore(key) {
  return {
    async getAll() {
      const flat = (await redis(["HGETALL", key])) || [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
      return out;
    },
    async get(id) {
      const v = await redis(["HGET", key, String(id)]);
      return v ? JSON.parse(v) : null;
    },
    async set(id, rec) {
      await redis(["HSET", key, String(id), JSON.stringify(rec)]);
    },
    // HSETNX only writes while the field is still empty, so of N simultaneous
    // callers exactly one wins.
    async setIfAbsent(id, rec) {
      return (await redis(["HSETNX", key, String(id), JSON.stringify(rec)])) === 1;
    },
    async clear() {
      await redis(["DEL", key]);
    },
  };
}

function fileStore(file) {
  let cache = null;
  const load = () => {
    if (!cache) {
      try {
        cache = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        cache = {};
      }
    }
    return cache;
  };
  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file);
  };
  return {
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
    // No await between the check and the write, so Node's single thread makes
    // this atomic the same way HSETNX is.
    async setIfAbsent(id, rec) {
      const all = load();
      if (all[id]) return false;
      all[id] = rec;
      persist();
      return true;
    },
    async clear() {
      cache = {};
      persist();
    },
  };
}

module.exports = {
  counts: useRedis ? redisStore(process.env.REDIS_KEY || "wedding:tables") : fileStore(DATA_FILE),
  labels: useRedis ? redisStore(process.env.REDIS_LABEL_KEY || "wedding:labels") : fileStore(LABEL_FILE),
};
