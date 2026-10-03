// GET    /api/tables          -> { tables: { [id]: { n, t, by } }, now, adminEnabled }
// POST   /api/tables
//   { id, n, by }                   first save of a table; 423 if already filled
//   { id, n, by, pin, expectT }     admin change of a filled table; 403 on wrong PIN,
//                                   409 if another admin changed it since you opened it
//   { action: "verify-pin", pin }   -> { ok: true } | 403
// DELETE /api/tables          header x-admin-pin -> clears everything
//
// A table locks as soon as it is saved once: one usher, one update per table.
// Only the admin PIN can change it afterwards, so two ushers can never
// overwrite each other's count.
const store = require("../lib/store");

const TABLE_COUNT = 134;
const CAPACITY = 12;
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

module.exports = async function handler(req, res) {
  const ADMIN_PIN = process.env.ADMIN_PIN;
  try {
    if (req.method === "GET") {
      return send(res, 200, {
        tables: await store.getAll(),
        now: Date.now(),
        adminEnabled: Boolean(ADMIN_PIN),
      });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }

      if (body.action === "verify-pin") {
        if (!ADMIN_PIN) return send(res, 409, { error: "No admin PIN is set on the server" });
        if (body.pin !== ADMIN_PIN) return rejectPin(res);
        return send(res, 200, { ok: true });
      }

      const id = Number(body.id);
      const n = Number(body.n);
      if (!Number.isInteger(id) || id < 1 || id > TABLE_COUNT) {
        return send(res, 400, { error: "Unknown table" });
      }
      if (!Number.isInteger(n) || n < 0 || n > CAPACITY) {
        return send(res, 400, { error: `Count must be 0-${CAPACITY}` });
      }
      const by = String(body.by || "").trim().slice(0, 30);

      // Usher path: succeeds only while the table is still untouched.
      if (body.pin === undefined || body.pin === null || body.pin === "") {
        const rec = { n, t: Date.now(), by, edits: 1 };
        if (await store.setIfAbsent(id, rec)) return send(res, 200, { ok: true, rec });
        return send(res, 423, { locked: true, rec: await store.get(id) });
      }

      // Admin path: may change an already-filled table.
      if (!ADMIN_PIN) return send(res, 409, { error: "No admin PIN is set on the server" });
      if (body.pin !== ADMIN_PIN) return rejectPin(res);

      const current = await store.get(id);
      const currentT = current ? current.t : 0;
      if (body.expectT !== undefined && Number(body.expectT) !== currentT && !body.force) {
        return send(res, 409, { conflict: true, rec: current });
      }
      const rec = {
        n,
        t: Date.now(),
        by,
        edits: (current && current.edits ? current.edits : 0) + 1,
        ...(current ? { prev: { n: current.n, by: current.by, t: current.t } } : {}),
      };
      await store.set(id, rec);
      return send(res, 200, { ok: true, rec });
    }

    if (req.method === "DELETE") {
      if (!ADMIN_PIN) return send(res, 403, { error: "Reset is disabled (ADMIN_PIN not set)" });
      if (req.headers["x-admin-pin"] !== ADMIN_PIN) return rejectPin(res);
      await store.clear();
      return send(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: "Server error" });
  }
};
