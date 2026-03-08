#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-https://check-your-view.pages.dev}"
PROXY_URL="${PROXY_URL:-https://check-your-view-proxy.jeremy-hon-gy.workers.dev}"
SEARCH_PATH="${SEARCH_PATH:-/api/common/elastic/search?searchVal=Marina%20Bay%20Sands&returnGeom=Y&getAddrDetails=Y&pageNum=1}"
TILESET_PATH="${TILESET_PATH:-/omapi/tilesets/sg_noterrain_tiles/tileset.json}"
IMAGERY_PATH="${IMAGERY_PATH:-/maps/tiles/OrthoJPG/17/103350/65068.png}"
AMENITIES_PATH="${AMENITIES_PATH:-/api/amenities}"
AMENITIES_DATASET_URL="${AMENITIES_DATASET_URL:-${SITE_URL}/data/amenities/osm-amenities-latest.json}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

ok() {
  echo "PASS: $*"
}

echo "Smoke test target:"
echo "  SITE_URL=${SITE_URL}"
echo "  PROXY_URL=${PROXY_URL}"

site_status="$(curl -sS -L -o "${tmpdir}/index.html" -w "%{http_code}" "${SITE_URL}/")"
[[ "${site_status}" == "200" ]] || fail "site root returned ${site_status}"
rg -q "<title>Check Your View</title>" "${tmpdir}/index.html" || fail "site title not found"
rg -q "A quick way to verify the view from the flat of your dreams" "${tmpdir}/index.html" || fail "site subtitle not found"
ok "site root is healthy"

asset_path="$(rg -o 'assets/index-[^"]+\.js' -N "${tmpdir}/index.html" | head -n1 || true)"
if [[ -n "${asset_path}" ]]; then
  asset_status="$(curl -sS -o /dev/null -w "%{http_code}" "${SITE_URL}/${asset_path}")"
  [[ "${asset_status}" == "200" ]] || fail "frontend bundle returned ${asset_status}"
  ok "frontend bundle is reachable (${asset_path})"
else
  dev_module_path="$(rg -o '\./app\.ts' -N "${tmpdir}/index.html" | head -n1 || true)"
  [[ -n "${dev_module_path}" ]] || fail "frontend bundle path not found in index.html"
  dev_module_status="$(curl -sS -o /dev/null -w "%{http_code}" "${SITE_URL}/app.ts")"
  [[ "${dev_module_status}" == "200" ]] || fail "frontend dev module returned ${dev_module_status}"
  ok "frontend dev module is reachable (/app.ts)"
fi

tileset_status="$(curl -sS -o "${tmpdir}/tileset.json" -w "%{http_code}" "${PROXY_URL}${TILESET_PATH}")"
[[ "${tileset_status}" == "200" ]] || fail "tileset endpoint returned ${tileset_status}"
rg -q '"geometricError"' "${tmpdir}/tileset.json" || fail "tileset payload missing geometricError"
ok "tileset endpoint is healthy"

imagery_status="$(curl -sS -o "${tmpdir}/tile.bin" -w "%{http_code}" "${PROXY_URL}${IMAGERY_PATH}")"
[[ "${imagery_status}" == "200" ]] || fail "imagery endpoint returned ${imagery_status}"
tile_magic="$(xxd -l 3 -p "${tmpdir}/tile.bin" || true)"
if [[ "${tile_magic}" != "ffd8ff" && "${tile_magic}" != "89504e" ]]; then
  fail "imagery endpoint returned unexpected binary format (magic=${tile_magic})"
fi
ok "imagery endpoint is healthy (magic=${tile_magic})"

search_status="$(curl -sS -o "${tmpdir}/search.json" -w "%{http_code}" "${PROXY_URL}${SEARCH_PATH}")"
[[ "${search_status}" == "200" ]] || fail "search endpoint returned ${search_status}"
rg -q '"results"' "${tmpdir}/search.json" || fail "search payload missing results"
ok "search endpoint is healthy"

dataset_status="$(curl -sS -o "${tmpdir}/amenities-dataset.json" -w "%{http_code}" "${AMENITIES_DATASET_URL}")"
[[ "${dataset_status}" == "200" ]] || fail "amenities dataset URL returned ${dataset_status}"
rg -q '"amenities"' "${tmpdir}/amenities-dataset.json" || fail "amenities dataset missing amenities array"
ok "amenities dataset file is reachable"

amenities_status="$(curl -sS -o "${tmpdir}/amenities.json" -w "%{http_code}" "${PROXY_URL}${AMENITIES_PATH}")"
[[ "${amenities_status}" == "200" ]] || fail "amenities endpoint returned ${amenities_status}"
rg -q '"amenities"' "${tmpdir}/amenities.json" || fail "amenities payload missing amenities array"
rg -q '"counts"' "${tmpdir}/amenities.json" || fail "amenities payload missing counts"
ok "amenities endpoint is healthy"

echo "Smoke test succeeded."
