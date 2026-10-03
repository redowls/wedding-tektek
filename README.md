# Wedding Seating

Mobile web app for ushers: tap a table on the ballroom plan, set how many guests are seated (0–12).
All ushers see the same live map (auto-refresh every 3 s).

**Table numbers are editable.** The numbering on the map is a guess from the venue plan, so any
usher can set a table's real printed number once (letters allowed, max 6 chars, e.g. `A3`, `B-07`).
After that the admin PIN (`ADMIN_PIN`) is needed to change it — the write is atomic (`HSETNX` on
Redis, single-threaded check-and-set on the file store), so simultaneous edits pick exactly one
winner and the rest get HTTP 423. Duplicate numbers are allowed. Counts stay keyed by the internal
table id (1..134), never by the printed number, so duplicates can never merge or duplicate a count.
Guest counts themselves stay freely editable by anyone, any time.

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
- `POST /api/tables` `{ id, n, by, expectT }` → set the count; 409 if someone else updated it after you opened it
- `POST /api/tables` `{ action: "set-label", id, label, by }` → set the printed number; **423** once it is set
- `POST /api/tables` `{ action: "set-label", id, label, by, pin }` → admin change of a set number
- `POST /api/tables` `{ action: "verify-pin", pin }` → checks the PIN before asking for a number
- `DELETE /api/tables` with header `x-admin-pin` → reset all counts (`?labels=1` also clears the numbers)

## Table numbering

`public/tables.js` holds the 134 table positions (auto-detected from the venue plan), numbered row by row
top (stage side) → bottom, left → right, with the plan rotated 90° left. Those ids are permanent database
keys — to show the venue's real numbers, rename tables in the app (✏️ Edit no.) rather than editing this file.
