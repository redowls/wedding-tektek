// GET    /api/tables  -> { tables, labels, now, adminEnabled }
//
// POST /api/tables
//   { id, n, by, expectT }                  set the guest count (always editable;
//                                           409 if someone else saved meanwhile)
//   { action: "set-label", id, label, by }  set the table's printed number — allowed
//                                           once per table, then 423 (locked)
//   { action: "set-label", id, label, by, pin }  admin change of a locked number
//   { action: "verify-pin", pin }           -> { ok: true } | 403
//
// DELETE /api/tables  header x-admin-pin -> clears the counts
//                     ?labels=1 also clears the table numbers
//
// Counts stay keyed by the internal table id, never by the printed number, so
// duplicate numbers are harmless: each table keeps exactly one count record.
const store = require("../lib/store");

const TABLE_COUNT = 134;
const CAPACITY = 12;
const LABEL_MAX = 6;
const WRONG_PIN_DELAY_MS = 1000; // slows down PIN guessing

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  }
  return {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rejectPin(res) {
  await sleep(WRONG_PIN_DELAY_MS);
  return send(res, 403, { error: "Wrong admin PIN" });
}

const validId = (id) => Number.isInteger(id) && id >= 1 && id <= TABLE_COUNT;

module.exports = async function handler(req, res) {
  const ADMIN_PIN = process.env.ADMIN_PIN;
  try {
    if (req.method === "GET") {
      const [tables, labels] = await Promise.all([store.counts.getAll(), store.labels.getAll()]);
      return send(res, 200, { tables, labels, now: Date.now(), adminEnabled: Boolean(ADMIN_PIN) });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const by = String(body.by || "").trim().slice(0, 30);
      const hasPin = body.pin !== undefined && body.pin !== null && body.pin !== "";

      if (body.action === "verify-pin") {
        if (!ADMIN_PIN) return send(res, 409, { error: "No admin PIN is set on the server" });
        if (body.pin !== ADMIN_PIN) return rejectPin(res);
        return send(res, 200, { ok: true });
      }

      // ----- the number printed on a table: one free edit, then admin only -----
      if (body.action === "set-label") {
        const id = Number(body.id);
        if (!validId(id)) return send(res, 400, { error: "Unknown table" });
        const label = String(body.label ?? "").trim().slice(0, LABEL_MAX);
        if (!label) return send(res, 400, { error: "Enter a table number" });

        if (!hasPin) {
          const rec = { label, t: Date.now(), by, edits: 1 };
          if (await store.labels.setIfAbsent(id, rec)) return send(res, 200, { ok: true, rec });
          return send(res, 423, { locked: true, rec: await store.labels.get(id) });
        }
        if (!ADMIN_PIN) return send(res, 409, { error: "No admin PIN is set on the server" });
        if (body.pin !== ADMIN_PIN) return rejectPin(res);
        const current = await store.labels.get(id);
        const rec = {
          label,
          t: Date.now(),
          by,
          edits: (current && current.edits ? current.edits : 0) + 1,
          ...(current ? { prev: current.label } : {}),
        };
        await store.labels.set(id, rec);
        return send(res, 200, { ok: true, rec });
      }

      // ----- guest count: anyone, any number of times -----
      const id = Number(body.id);
      const n = Number(body.n);
      if (!validId(id)) return send(res, 400, { error: "Unknown table" });
      if (!Number.isInteger(n) || n < 0 || n > CAPACITY) {
        return send(res, 400, { error: `Count must be 0-${CAPACITY}` });
      }
      const current = await store.counts.get(id);
      const currentT = current ? current.t : 0;
      if (body.expectT !== undefined && Number(body.expectT) !== currentT && !body.force) {
        return send(res, 409, { conflict: true, rec: current });
      }
      const rec = { n, t: Date.now(), by };
      await store.counts.set(id, rec);
      return send(res, 200, { ok: true, rec });
    }

    if (req.method === "DELETE") {
      if (!ADMIN_PIN) return send(res, 403, { error: "Reset is disabled (ADMIN_PIN not set)" });
      if (req.headers["x-admin-pin"] !== ADMIN_PIN) return rejectPin(res);
      await store.counts.clear();
      const url = new URL(req.url || "/", "http://x");
      const alsoLabels = url.searchParams.get("labels") === "1";
      if (alsoLabels) await store.labels.clear();
      return send(res, 200, { ok: true, labelsCleared: alsoLabels });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Server error" });
  }
};
