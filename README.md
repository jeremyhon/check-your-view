# Condo View Wrapper

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

2. Run Worker locally:

```bash
npm run worker:dev
```

3. Run frontend locally (separate terminal):

```bash
npm run viewer:dev
```

4. Open viewer:

`http://localhost:5173`

5. Deploy Worker:

```bash
npm run worker:deploy
```

## Worker Config

Configured in `worker/wrangler.toml`:

- `ONEMAP_BASE_URL` (default `https://www.onemap.gov.sg`)
- `ONEMAP_REFERER` (default `https://www.onemap.gov.sg/3d`)
- `ALLOWED_ORIGINS` (comma-separated or `*`)

## Planned View URL Schema (Frontend)

- `lat`
- `lng`
- `height_m`
- `heading_deg`
- `pitch_deg`
- `roll_deg`
- `fov_deg`

This schema represents exact camera position and orientation with height in meters.

## Frontend Behavior

- Single camera mode only.
- Camera position locked to `lat/lng/height_m`.
- Mouse drag changes orientation (`heading_deg`, `pitch_deg`) only.
- Share link encodes exact camera pose and proxy URL.
