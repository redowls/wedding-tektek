# Wedding Seating

Mobile web app for ushers: tap a table on the ballroom plan, set how many guests are seated (0–12).
All ushers see the same live map (auto-refresh every 3 s).

Legend: 0 white · 1–5 light yellow · 6 yellow · 7–11 light red · 12 (full) red.

## Run locally / on a VPS

    node server.js            # http://127.0.0.1:3077 (PORT, HOST, DATA_FILE env vars)

Data is stored in `data/tables.json` (or `DATA_FILE`).

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (Framework preset: **Other**, no build command).
2. In the Vercel project: **Storage → Marketplace → Upstash for Redis → Create & connect**.
   This adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars; the API uses Redis automatically when they exist.
   (Vercel functions have no persistent disk, so the JSON-file store does NOT work there.)
3. Optional: set `ADMIN_PIN` to enable the "Reset all" button.
4. Redeploy.

## API

- `GET /api/tables` → `{ tables: { "12": { n, t, by } } }`
- `POST /api/tables` `{ id, n, by, expectT }` → 409 if someone else updated that table after you opened it
- `DELETE /api/tables` with header `x-admin-pin` → reset all (only if `ADMIN_PIN` is set)

## Table numbering

`public/tables.js` holds the 134 table positions (auto-detected from the venue plan), numbered row by row
top (stage side) → bottom, left → right, with the plan rotated 90° left. Edit the `id`s there to match the official numbering.
