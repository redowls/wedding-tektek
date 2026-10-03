# Wedding Seating

Mobile web app for ushers: tap a table on the ballroom plan, set how many guests are seated (0–12).
All ushers see the same live map (auto-refresh every 3 s).

**One update per table.** A table locks as soon as it is saved once, so two ushers can never
overwrite each other's count — the write is atomic (`HSETNX` on Redis, single-threaded
check-and-set on the file store), so of N simultaneous saves exactly one wins and the rest get
HTTP 423. Changing a locked table needs the admin PIN (`ADMIN_PIN`); that enters admin mode for
the session (kept in memory only, never stored on the phone) and records `edits` plus the
previous value in `prev`. Tables not filled in yet are drawn with a dashed grey outline.

**Set `ADMIN_PIN`** wherever this runs — without it a wrong number can never be corrected.

Legend: 0 white · 1–2 pale yellow · 3–4 light yellow · 5–6 yellow · 7–8 orange · 9–10 light red · 11 red · 12 (full) dark red.

## Run locally / on a VPS

    node server.js            # http://127.0.0.1:3077 (PORT, HOST, DATA_FILE env vars)

Data is stored in `data/tables.json` (or `DATA_FILE`).

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (Framework preset: **Other**, no build command).
2. In the Vercel project: **Storage → Marketplace → Upstash for Redis → Create & connect** — pick region **Singapore (ap-southeast-1)** to sit next to the API (vercel.json pins functions to `sin1` Singapore, closest to Indonesia).
   This adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars; the API uses Redis automatically when they exist.
   (Vercel functions have no persistent disk, so the JSON-file store does NOT work there.)
3. Optional: set `ADMIN_PIN` to enable the "Reset all" button.
4. Redeploy.

## API

- `GET /api/tables` → `{ tables: { "12": { n, t, by } } }`
- `POST /api/tables` `{ id, n, by }` → first save only; **423** if the table is already filled
- `POST /api/tables` `{ id, n, by, pin, expectT }` → admin change; 403 wrong PIN, 409 if another admin changed it meanwhile
- `POST /api/tables` `{ action: "verify-pin", pin }` → checks the PIN before showing the editor
- `DELETE /api/tables` with header `x-admin-pin` → reset all (only if `ADMIN_PIN` is set)

## Table numbering

`public/tables.js` holds the 134 table positions (auto-detected from the venue plan), numbered row by row
top (stage side) → bottom, left → right, with the plan rotated 90° left. Edit the `id`s there to match the official numbering.
