#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required in the environment."
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  export CLOUDFLARE_ACCOUNT_ID="d01f17e7fb269a7d9761cafe83c91b4c"
fi

if [[ -z "${ONEMAP_API_TOKEN:-}" ]] && [[ -f "token.txt" ]]; then
  export ONEMAP_API_TOKEN="$(tr -d '\r\n' < token.txt)"
fi

if [[ -z "${ONEMAP_API_TOKEN:-}" ]]; then
  echo "ONEMAP_API_TOKEN is required. Set env var or create token.txt in repo root."
  exit 1
fi

echo "Syncing Worker secret ONEMAP_API_TOKEN..."
printf "%s" "$ONEMAP_API_TOKEN" | npx wrangler secret put ONEMAP_API_TOKEN --config worker/wrangler.toml

echo "Deploying Worker..."
npm run worker:deploy

echo "Deploying Pages..."
npx wrangler pages deploy frontend --project-name check-your-view

echo "Deploy complete."
