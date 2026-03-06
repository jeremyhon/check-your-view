#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SYNC_SECRETS="false"

usage() {
  cat <<'EOF'
Usage: bash scripts/deploy.sh [--sync-secrets]

Options:
  --sync-secrets   Update Worker secret ONEMAP_API_TOKEN before deploy.
  -h, --help       Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sync-secrets)
      SYNC_SECRETS="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required in the environment."
  exit 1
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  export CLOUDFLARE_ACCOUNT_ID="d01f17e7fb269a7d9761cafe83c91b4c"
fi

if [[ "$SYNC_SECRETS" == "true" ]]; then
  if [[ -z "${ONEMAP_API_TOKEN:-}" ]] && [[ -f "token.txt" ]]; then
    export ONEMAP_API_TOKEN="$(tr -d '\r\n' < token.txt)"
  fi
  if [[ -z "${ONEMAP_API_TOKEN:-}" ]]; then
    echo "ONEMAP_API_TOKEN is required for --sync-secrets. Set env var or create token.txt."
    exit 1
  fi
  echo "Syncing Worker secret ONEMAP_API_TOKEN..."
  printf "%s" "$ONEMAP_API_TOKEN" | pnpm exec wrangler secret put ONEMAP_API_TOKEN --config worker/wrangler.toml
else
  echo "Skipping secret sync (pass --sync-secrets to update ONEMAP_API_TOKEN)."
fi

echo "Deploying Worker..."
pnpm run worker:deploy

echo "Deploying Pages..."
pnpm exec wrangler pages deploy frontend --project-name check-your-view

echo "Deploy complete."
