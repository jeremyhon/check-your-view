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
- `/maps/tiles/Default/...`
- `/maps/tiles/DefaultRoad/...`

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Configure local Worker secrets:

```bash
cp worker/.dev.vars.example worker/.dev.vars
# edit worker/.dev.vars and set ONEMAP_API_TOKEN
```

3. Run both frontend + worker in one command (hot reload enabled):

```bash
pnpm run dev
```

4. Open viewer:

`http://localhost:5173`

This uses fixed dev ports:

- frontend: `5173`
- worker proxy: `8787`

5. Deploy Worker:

```bash
pnpm run worker:deploy
```

Optional: run services separately:

```bash
pnpm run viewer:dev
pnpm run worker:dev
```

## Environment Loading (direnv)

Use `direnv` to auto-load deploy secrets only inside this repo directory.

1. Install and enable `direnv` shell integration.
2. Create `~/.config/secrets/check-my-view.env` using [.envrc.example](/home/jeremyhon/check-my-view/.envrc.example).
3. In repo root, run:

```bash
direnv allow
```

Required vars for deploy scripts:

- `CLOUDFLARE_API_TOKEN`
- optional `CLOUDFLARE_ACCOUNT_ID`
- `ONEMAP_API_TOKEN` (only needed for `deploy:sync-secrets`)

## Worker Config

Configured in `worker/wrangler.toml`:

- `ONEMAP_BASE_URL` (default `https://www.onemap.gov.sg`)
- `ONEMAP_REFERER` (default `https://www.onemap.gov.sg/3d`)
- `ALLOWED_ORIGINS` (comma-separated or `*`)
- `AMENITIES_DATA_URL` (URL to generated OSM amenities JSON used by `/api/amenities`)
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

Frontend proxy base is controlled by `frontend/config.ts`:

```js
window.CHECK_YOUR_VIEW_CONFIG = {
  proxyBase: "https://your-worker-subdomain.workers.dev",
};
```

For local dev it defaults to `http://localhost:8787`.

Amenity labels load from Worker endpoint `/api/amenities` first, then fall back to static
file `/data/amenities/osm-amenities-latest.json` on the frontend host.

## TypeScript Tooling

- Source code is TypeScript across frontend and worker.
- Type checking uses `tsgo` from `@typescript/native-preview` (not `tsc`).

Run type checks:

```bash
pnpm run typecheck
```

Build frontend assets:

```bash
pnpm run build
```

## Manual Deploy Script

Deploy both Worker and Pages in one command:

```bash
pnpm run deploy
```

This deploy path now type-checks/builds frontend TypeScript and deploys `frontend/dist`.

Sync ONEMAP secret explicitly (only when needed):

```bash
pnpm run deploy:sync-secrets
```

Requirements:

- `CLOUDFLARE_API_TOKEN` in shell env
- optional `CLOUDFLARE_ACCOUNT_ID` (defaults to this account)
- `ONEMAP_API_TOKEN` in shell env, or `token.txt` in repo root (only for `--sync-secrets`)

Script path: `scripts/deploy.sh`

## Repeatable Smoke Test

Run production smoke checks:

```bash
pnpm run smoke:test
```

The script validates:

- Pages root HTML and expected title/subtitle
- frontend bundle asset reachable from current `index.html`
- Worker tileset endpoint
- Worker imagery tile endpoint
- Worker search endpoint
- Worker amenities endpoint

Optional overrides:

```bash
SITE_URL="https://<pages-domain>" \
PROXY_URL="https://<worker-domain>" \
pnpm run smoke:test
```

## OSM Amenity Ingestion

Generate a normalized OSM amenity dataset (Singapore) for these 6 categories:

- `mrt_lrt`
- `primary_schools`
- `preschools`
- `shopping_malls`
- `supermarkets_wet_markets`
- `hawker_food_courts`

Run:

```bash
pnpm run amenities:ingest
```

Default output path:

- `frontend/data/amenities/osm-amenities-latest.json`

Optional flags:

```bash
pnpm run amenities:ingest -- --out /tmp/osm-amenities.json --compact
```

## Linting And Formatting

Run lint checks:

```bash
pnpm run lint
```

Fix lint issues automatically where possible:

```bash
pnpm run lint:fix
```

Check formatting:

```bash
pnpm run format
```

Apply formatting:

```bash
pnpm run format:fix
```

## Current View URL Schema (Frontend)

- `lat`
- `lng`
- `zoom_pct` (`100` to `400`)
- `floor_level`
- `floor_height_m`
- `height_m`
- `heading_deg`
- `pitch_deg`
- `fov_deg`

This schema represents exact camera pose + zoom. `fov_deg` is the base lens value and `zoom_pct`
is an additional runtime zoom multiplier used by wheel/pinch.

## Frontend State Contract

Use these buckets as the source of truth when adding features:

- `ShareState` (URL): stable, linkable view state (`lat`, `lng`, `zoom_pct`, `height_m`, floor
  fields, `heading_deg`, `pitch_deg`, `fov_deg`).
- `SessionState` (browser/session): UI convenience state that should not affect shared view
  semantics (for example panel collapsed/open, debug mode, quality preset).
- `RuntimeState` (memory-only): ephemeral rendering and interaction state (Cesium handles,
  diagnostics counters, in-flight requests, pointer gesture internals).

Rules:

- Only put reproducible viewpoint data in URL.
- Keep `proxy_base` runtime-config only (not URL share state).
- Preserve `debug=1` when URL is rewritten so debugging survives state edits.

## Frontend Behavior

- Single camera mode only.
- Camera position locked to `lat/lng/height_m`.
- Height can be controlled directly or via `floor_level * floor_height_m`.
- Search box above mini map (OneMap search endpoint) for quick location jumps.
- Mini map above coordinate fields for click/drag location selection.
- Mouse drag changes orientation (`heading_deg`, `pitch_deg`) only.
- Share link encodes exact camera pose + zoom values.
- Debug globals `window.__viewer` and `window.__tileset` are exposed only with `?debug=1`.
- Debug rendering controls are hidden by default and shown with `?debug=1`.
- 3D tiles use aggressive LOD skipping/culling to avoid loading far-distance content unnecessarily.
