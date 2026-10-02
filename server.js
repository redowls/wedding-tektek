// Local / VPS server: serves public/ and the same /api/tables handler Vercel uses.
const http = require("http");
const fs = require("fs");
const path = require("path");
const tablesApi = require("./api/tables");

const PORT = Number(process.env.PORT || 3077);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC = path.join(__dirname, "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/tables") {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 10000) req.destroy();
      });
      req.on("end", () => {
        req.body = raw;
        tablesApi(req, res);
      });
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) {
      res.statusCode = 403;
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
      res.setHeader("Cache-Control", rel === "floorplan.jpg" ? "public, max-age=3600" : "no-cache");
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => console.log(`wedding-seating on http://${HOST}:${PORT}`));
