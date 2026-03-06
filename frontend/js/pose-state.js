import { clamp, normalizeDeg, parseNumber } from "./utils.js";

export function sanitizeFloorHeight(value, defaultFloorHeight) {
  return clamp(parseNumber(value, defaultFloorHeight), 0.1, 10);
}

export function floorLevelFromHeight(height, floorHeight) {
  const safeFloorHeight = Math.max(floorHeight, 0.1);
  return Math.max(height / safeFloorHeight, 0);
}

export function heightFromFloor(level, floorHeight) {
  return Math.max(level, 0) * Math.max(floorHeight, 0.1);
}

export function isWithinBounds(lat, lng, limits) {
  return (
    lat >= limits.minLat && lat <= limits.maxLat && lng >= limits.minLng && lng <= limits.maxLng
  );
}

export function normalizeLegacyDegeneratePose(state, defaults) {
  const nearZero = (value) => Math.abs(value) < 0.0001;
  if (nearZero(state.heading_deg) && nearZero(state.pitch_deg) && state.fov_deg <= 20.1) {
    state.pitch_deg = defaults.pitch_deg;
    state.fov_deg = defaults.fov_deg;
  }
}

export function parseStateFromQuery(search, defaults, limits) {
  const params = new URLSearchParams(search);
  const nextState = { ...defaults };

  nextState.proxy_base = params.get("proxy_base") || defaults.proxy_base;
  nextState.lat = parseNumber(params.get("lat"), defaults.lat);
  nextState.lng = parseNumber(params.get("lng"), defaults.lng);
  if (!isWithinBounds(nextState.lat, nextState.lng, limits)) {
    nextState.lat = defaults.lat;
    nextState.lng = defaults.lng;
  }

  nextState.floor_height_m = sanitizeFloorHeight(
    params.get("floor_height_m"),
    defaults.floor_height_m,
  );

  const hasHeight = params.has("height_m");
  const hasFloorLevel = params.has("floor_level");
  if (hasHeight) {
    const heightCandidate = parseNumber(params.get("height_m"), defaults.height_m);
    nextState.height_m = clamp(heightCandidate, 1, 5000);
  } else {
    nextState.height_m = defaults.height_m;
  }

  if (hasFloorLevel) {
    nextState.floor_level = Math.max(
      parseNumber(params.get("floor_level"), defaults.floor_level),
      0,
    );
    if (!hasHeight) {
      nextState.height_m = clamp(
        heightFromFloor(nextState.floor_level, nextState.floor_height_m),
        1,
        5000,
      );
    }
  } else {
    nextState.floor_level = floorLevelFromHeight(nextState.height_m, nextState.floor_height_m);
  }

  nextState.heading_deg = normalizeDeg(
    parseNumber(params.get("heading_deg"), defaults.heading_deg),
  );
  nextState.pitch_deg = clamp(parseNumber(params.get("pitch_deg"), defaults.pitch_deg), -89, 89);
  const fovCandidate = parseNumber(params.get("fov_deg"), defaults.fov_deg);
  nextState.fov_deg = fovCandidate > 0 ? clamp(fovCandidate, 20, 120) : defaults.fov_deg;

  const candidateBaseMap = params.get("base_map") || defaults.base_map;
  nextState.base_map = candidateBaseMap === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";

  normalizeLegacyDegeneratePose(nextState, defaults);
  return nextState;
}

export function serializeStateToQuery(state) {
  const params = new URLSearchParams();
  params.set("lat", state.lat.toFixed(6));
  params.set("lng", state.lng.toFixed(6));
  params.set("floor_level", state.floor_level.toFixed(2));
  params.set("floor_height_m", state.floor_height_m.toFixed(2));
  params.set("height_m", state.height_m.toFixed(1));
  params.set("heading_deg", state.heading_deg.toFixed(1));
  params.set("pitch_deg", state.pitch_deg.toFixed(1));
  params.set("fov_deg", state.fov_deg.toFixed(1));
  params.set("base_map", state.base_map);
  return params;
}

export function buildShareUrlFromState(state, locationLike) {
  const params = serializeStateToQuery(state);
  return `${locationLike.origin}${locationLike.pathname}?${params.toString()}`;
}
