# check-your-view

Thin wrapper for reproducing apartment viewpoints against OneMap 3D assets.

## Current Architecture

1. Cloudflare Worker reverse proxy to OneMap internal 3D endpoints.
2. Frontend viewer (next step) consumes Worker URLs, not OneMap directly.
3. Camera is fixed in position and can rotate in place.

## Why Worker Proxy

OneMap 3D tileset access is referer-gated. Browser code cannot set arbitrary `Referer`, so direct frontend calls get `403`. The Worker injects required headers and applies strict path allowlisting.

## Allowed Proxied Paths

- `/omapi/tilesets/sg_noterrain_tiles/...`
- `/maps/tiles/OrthoJPG/...`
- `/maps/tiles/DefaultRoad/...`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure local Worker secrets:

```bash
cp worker/.dev.vars.example worker/.dev.vars
# edit worker/.dev.vars and set ONEMAP_API_TOKEN
```

3. Run Worker locally:

```bash
npm run worker:dev
```

4. Run frontend locally (separate terminal):

```bash
npm run viewer:dev
```

5. Open viewer:

`http://localhost:5173`

6. Deploy Worker:

```bash
npm run worker:deploy
```

## Worker Config

Configured in `worker/wrangler.toml`:

- `ONEMAP_BASE_URL` (default `https://www.onemap.gov.sg`)
- `ONEMAP_REFERER` (default `https://www.onemap.gov.sg/3d`)
- `ALLOWED_ORIGINS` (comma-separated or `*`)
- `ONEMAP_API_TOKEN` (secret; set with Wrangler)

Set production secret:

```bash
wrangler secret put ONEMAP_API_TOKEN --config worker/wrangler.toml
```

Set production allowlist origin (example):

```bash
wrangler deploy --config worker/wrangler.toml --var ALLOWED_ORIGINS=https://check-your-view.pages.dev
```

## Frontend Runtime Config

Frontend proxy base is controlled by `frontend/config.js`:

```js
window.CHECK_YOUR_VIEW_CONFIG = {
  proxyBase: "https://your-worker-subdomain.workers.dev",
};
```

For local dev it defaults to `http://localhost:8787`.

## Manual Deploy Script

Deploy both Worker and Pages in one command:

```bash
npm run deploy
```

Requirements:

- `CLOUDFLARE_API_TOKEN` in shell env
- optional `CLOUDFLARE_ACCOUNT_ID` (defaults to this account)
- `ONEMAP_API_TOKEN` in shell env, or `token.txt` in repo root

Script path: `scripts/deploy.sh`

## Planned View URL Schema (Frontend)

- `lat`
- `lng`
- `floor_level`
- `floor_height_m`
- `height_m`
- `heading_deg`
- `pitch_deg`
- `fov_deg`

This schema represents exact camera position and orientation with height in meters.

## Frontend Behavior

- Single camera mode only.
- Camera position locked to `lat/lng/height_m`.
- Height can be controlled directly or via `floor_level * floor_height_m`.
- Search box above mini map (OneMap search endpoint) for quick location jumps.
- Mini map above coordinate fields for click/drag location selection.
- Mouse drag changes orientation (`heading_deg`, `pitch_deg`) only.
- Share link encodes exact camera pose and proxy URL.
- 3D tiles use aggressive LOD skipping/culling to avoid loading far-distance content unnecessarily.
