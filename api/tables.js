// GET    /api/tables          -> { tables: { [id]: { n, t, by } }, now }
// POST   /api/tables          body { id, n, by, expectT }
//          -> 200 { ok, rec } | 409 { conflict, rec } when someone else updated
//             the table after this user opened it (expectT = the t they saw)
// DELETE /api/tables          header x-admin-pin -> clears everything
//          (only when ADMIN_PIN is set in the environment)
const store = require("../lib/store");

const TABLE_COUNT = 134;
const CAPACITY = 12;

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

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return send(res, 200, { tables: await store.getAll(), now: Date.now() });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const id = Number(body.id);
      const n = Number(body.n);
      if (!Number.isInteger(id) || id < 1 || id > TABLE_COUNT) {
        return send(res, 400, { error: "Unknown table" });
      }
      if (!Number.isInteger(n) || n < 0 || n > CAPACITY) {
        return send(res, 400, { error: `Count must be 0-${CAPACITY}` });
      }
      const current = await store.get(id);
      const currentT = current ? current.t : 0;
      if (body.expectT !== undefined && Number(body.expectT) !== currentT && !body.force) {
        return send(res, 409, { conflict: true, rec: current });
      }
      const by = String(body.by || "").trim().slice(0, 30);
      const rec = { n, t: Date.now(), by };
      await store.set(id, rec);
      return send(res, 200, { ok: true, rec });
    }

    if (req.method === "DELETE") {
      const pin = process.env.ADMIN_PIN;
      if (!pin) return send(res, 403, { error: "Reset is disabled (ADMIN_PIN not set)" });
      if (req.headers["x-admin-pin"] !== pin) return send(res, 403, { error: "Wrong PIN" });
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
