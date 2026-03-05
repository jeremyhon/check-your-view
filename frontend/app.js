/* global Cesium, L */

const runtimeConfig = window.CHECK_YOUR_VIEW_CONFIG || {};
const defaultProxyBase = runtimeConfig.proxyBase || "http://localhost:8787";

const DEFAULTS = {
  proxy_base: defaultProxyBase,
  lat: 1.3197,
  lng: 103.8422,
  height_m: 150,
  floor_level: 50,
  floor_height_m: 3,
  heading_deg: 0,
  pitch_deg: -80,
  fov_deg: 60,
  base_map: "OrthoJPG",
};

const SINGAPORE_RECTANGLE = Cesium.Rectangle.fromDegrees(103.55, 1.15, 104.1, 1.5);
const SINGAPORE_BOUNDS = [
  [1.15, 103.55],
  [1.5, 104.1],
];
const SG_LIMITS = {
  minLat: 1.15,
  maxLat: 1.5,
  minLng: 103.55,
  maxLng: 104.1,
};

const state = { ...DEFAULTS };
let viewer;
let tileset;
let fixedPosition;
let miniMap;
let miniMarker;
let loadedDataKey = "";
let dragging = false;
let activePointerId = null;
let searchDebounceId = null;
let searchAbortController = null;
let lastX = 0;
let lastY = 0;

const $ = (id) => document.getElementById(id);

const ui = {
  miniMap: $("miniMap"),
  lat: $("lat"),
  lng: $("lng"),
  searchInput: $("searchInput"),
  searchResults: $("searchResults"),
  floorLevel: $("floorLevel"),
  floorHeightM: $("floorHeightM"),
  heightM: $("heightM"),
  fovDeg: $("fovDeg"),
  headingDeg: $("headingDeg"),
  pitchDeg: $("pitchDeg"),
  baseMap: $("baseMap"),
  applyBtn: $("applyBtn"),
  copyBtn: $("copyBtn"),
  status: $("status"),
};

function parseNumber(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDeg(value) {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function sanitizeFloorHeight(value) {
  return clamp(parseNumber(value, DEFAULTS.floor_height_m), 0.1, 10);
}

function floorLevelFromHeight(height, floorHeight) {
  const safeFloorHeight = Math.max(floorHeight, 0.1);
  return Math.max(height / safeFloorHeight, 0);
}

function heightFromFloor(level, floorHeight) {
  return Math.max(level, 0) * Math.max(floorHeight, 0.1);
}

function isWithinSingapore(lat, lng) {
  return (
    lat >= SG_LIMITS.minLat &&
    lat <= SG_LIMITS.maxLat &&
    lng >= SG_LIMITS.minLng &&
    lng <= SG_LIMITS.maxLng
  );
}

function normalizeLegacyDegeneratePose() {
  const nearZero = (x) => Math.abs(x) < 0.0001;
  if (nearZero(state.heading_deg) && nearZero(state.pitch_deg) && state.fov_deg <= 20.1) {
    state.pitch_deg = DEFAULTS.pitch_deg;
    state.fov_deg = DEFAULTS.fov_deg;
  }
}

function applyStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  state.proxy_base = params.get("proxy_base") || DEFAULTS.proxy_base;
  state.lat = parseNumber(params.get("lat"), DEFAULTS.lat);
  state.lng = parseNumber(params.get("lng"), DEFAULTS.lng);
  if (!isWithinSingapore(state.lat, state.lng)) {
    state.lat = DEFAULTS.lat;
    state.lng = DEFAULTS.lng;
  }
  state.floor_height_m = sanitizeFloorHeight(params.get("floor_height_m"));
  const hasHeight = params.has("height_m");
  const hasFloorLevel = params.has("floor_level");

  if (hasHeight) {
    const heightCandidate = parseNumber(params.get("height_m"), DEFAULTS.height_m);
    state.height_m = clamp(heightCandidate, 1, 5000);
  } else {
    state.height_m = DEFAULTS.height_m;
  }

  if (hasFloorLevel) {
    state.floor_level = Math.max(parseNumber(params.get("floor_level"), DEFAULTS.floor_level), 0);
    if (!hasHeight) {
      state.height_m = clamp(heightFromFloor(state.floor_level, state.floor_height_m), 1, 5000);
    }
  } else {
    state.floor_level = floorLevelFromHeight(state.height_m, state.floor_height_m);
  }
  state.heading_deg = normalizeDeg(parseNumber(params.get("heading_deg"), DEFAULTS.heading_deg));
  state.pitch_deg = clamp(parseNumber(params.get("pitch_deg"), DEFAULTS.pitch_deg), -89, 89);
  const fovCandidate = parseNumber(params.get("fov_deg"), DEFAULTS.fov_deg);
  state.fov_deg = fovCandidate > 0 ? clamp(fovCandidate, 20, 120) : DEFAULTS.fov_deg;
  const candidateBaseMap = params.get("base_map") || DEFAULTS.base_map;
  state.base_map = candidateBaseMap === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";
  normalizeLegacyDegeneratePose();
}

function syncInputsFromState() {
  ui.lat.value = state.lat;
  ui.lng.value = state.lng;
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.heightM.value = state.height_m;
  ui.fovDeg.value = state.fov_deg;
  ui.headingDeg.value = state.heading_deg;
  ui.pitchDeg.value = state.pitch_deg;
  ui.baseMap.value = state.base_map;
}

function readStateFromInputs() {
  state.lat = parseNumber(ui.lat.value, state.lat);
  state.lng = parseNumber(ui.lng.value, state.lng);
  if (!isWithinSingapore(state.lat, state.lng)) {
    state.lat = DEFAULTS.lat;
    state.lng = DEFAULTS.lng;
  }
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value);
  state.floor_level = Math.max(parseNumber(ui.floorLevel.value, state.floor_level), 0);
  state.height_m = clamp(parseNumber(ui.heightM.value, state.height_m), 1, 5000);
  state.fov_deg = clamp(parseNumber(ui.fovDeg.value, state.fov_deg), 20, 120);
  state.heading_deg = normalizeDeg(parseNumber(ui.headingDeg.value, state.heading_deg));
  state.pitch_deg = clamp(parseNumber(ui.pitchDeg.value, state.pitch_deg), -89, 89);
  state.base_map = ui.baseMap.value === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";
}

function buildShareUrl() {
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
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function syncUrlToState() {
  window.history.replaceState({}, "", buildShareUrl());
}

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.style.color = isError ? "#b42318" : "#1f2937";
}

function setFixedCameraPose() {
  fixedPosition = Cesium.Cartesian3.fromDegrees(state.lng, state.lat, state.height_m);
  viewer.camera.setView({
    destination: fixedPosition,
    orientation: {
      heading: Cesium.Math.toRadians(state.heading_deg),
      pitch: Cesium.Math.toRadians(state.pitch_deg),
      roll: 0,
    },
  });
  viewer.camera.frustum.fov = Cesium.Math.toRadians(state.fov_deg);
  viewer.camera.frustum.near = 0.2;
  viewer.camera.frustum.far = 30000;
}

function lockCameraControls() {
  const c = viewer.scene.screenSpaceCameraController;
  c.enableInputs = false;
  c.enableTranslate = false;
  c.enableZoom = false;
  c.enableRotate = false;
  c.enableTilt = false;
  c.enableLook = false;
}

function updateInputAngles() {
  ui.headingDeg.value = state.heading_deg.toFixed(1);
  ui.pitchDeg.value = state.pitch_deg.toFixed(1);
}

function syncHeightFromFloorInputs() {
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value);
  state.floor_level = Math.max(parseNumber(ui.floorLevel.value, state.floor_level), 0);
  state.height_m = clamp(heightFromFloor(state.floor_level, state.floor_height_m), 1, 5000);
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.heightM.value = state.height_m.toFixed(1);
}

function syncFloorFromHeightInput() {
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value);
  state.height_m = clamp(parseNumber(ui.heightM.value, state.height_m), 1, 5000);
  state.floor_level = floorLevelFromHeight(state.height_m, state.floor_height_m);
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.heightM.value = state.height_m.toFixed(1);
}

function installOrientationDrag() {
  const canvas = viewer.scene.canvas;
  canvas.style.cursor = "grab";

  canvas.addEventListener("pointerdown", (event) => {
    // Primary drag input for mouse/touch/pen.
    if (event.pointerType === "mouse" && event.button > 2) {
      return;
    }
    activePointerId = event.pointerId;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.style.cursor = "grabbing";
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Older browsers may not support pointer capture.
    }
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointerId) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    state.heading_deg = normalizeDeg(state.heading_deg - dx * 0.2);
    state.pitch_deg = clamp(state.pitch_deg + dy * 0.2, -89, 89);
    setFixedCameraPose();
    updateInputAngles();
    syncUrlToState();
    event.preventDefault();
  });

  const endDrag = (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    dragging = false;
    activePointerId = null;
    canvas.style.cursor = "grab";
    event.preventDefault();
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}

function baseMapUrl() {
  return `${state.proxy_base}/maps/tiles/${state.base_map}/{z}/{x}/{y}.png`;
}

function miniMapBaseUrl() {
  return `${state.proxy_base}/maps/tiles/DefaultRoad/{z}/{x}/{y}.png`;
}

function syncMiniMapFromState(recenter = false) {
  if (!miniMap || !miniMarker) {
    return;
  }
  const center = [state.lat, state.lng];
  miniMarker.setLatLng(center);
  if (recenter) {
    miniMap.setView(center, miniMap.getZoom(), { animate: false });
  }
}

function updateLocationFromMiniMap(lat, lng) {
  updateLocation(lat, lng, "Location updated from mini map.");
}

function initializeMiniMap() {
  if (typeof L === "undefined" || !ui.miniMap) {
    setStatus("Mini map failed to load.", true);
    return;
  }
  miniMap = L.map(ui.miniMap, {
    zoomControl: true,
    attributionControl: false,
    minZoom: 11,
    maxZoom: 19,
  });
  miniMap.setMaxBounds(SINGAPORE_BOUNDS);

  L.tileLayer(miniMapBaseUrl(), {
    minZoom: 11,
    maxZoom: 19,
    bounds: SINGAPORE_BOUNDS,
    noWrap: true,
  }).addTo(miniMap);

  miniMap.setView([state.lat, state.lng], 15);
  miniMarker = L.marker([state.lat, state.lng], { draggable: true }).addTo(miniMap);

  miniMap.on("click", (event) => {
    const { lat, lng } = event.latlng;
    miniMarker.setLatLng([lat, lng]);
    updateLocationFromMiniMap(lat, lng);
  });

  miniMarker.on("dragend", () => {
    const { lat, lng } = miniMarker.getLatLng();
    updateLocationFromMiniMap(lat, lng);
  });

  window.setTimeout(() => miniMap.invalidateSize(), 0);
}

function clearSearchResults() {
  ui.searchResults.innerHTML = "";
  ui.searchResults.classList.remove("visible");
}

function updateLocation(lat, lng, message) {
  state.lat = lat;
  state.lng = lng;
  ui.lat.value = lat.toFixed(6);
  ui.lng.value = lng.toFixed(6);
  syncMiniMapFromState(true);
  setFixedCameraPose();
  syncUrlToState();
  setStatus(message);
}

function handleSearchSelect(result) {
  const lat = parseNumber(result.LATITUDE, state.lat);
  const lng = parseNumber(result.LONGITUDE, state.lng);
  if (!isWithinSingapore(lat, lng)) {
    setStatus("Search result is outside supported Singapore bounds.", true);
    return;
  }
  const label = result.SEARCHVAL || result.ADDRESS || "selected location";
  ui.searchInput.value = label;
  clearSearchResults();
  updateLocation(lat, lng, `Moved to: ${label}`);
}

function renderSearchResults(results) {
  ui.searchResults.innerHTML = "";
  if (results.length === 0) {
    const empty = document.createElement("button");
    empty.className = "search-result-item";
    empty.type = "button";
    empty.textContent = "No results";
    empty.disabled = true;
    ui.searchResults.appendChild(empty);
    ui.searchResults.classList.add("visible");
    return;
  }

  results.slice(0, 8).forEach((result) => {
    const button = document.createElement("button");
    button.className = "search-result-item";
    button.type = "button";
    const title = result.SEARCHVAL || result.ADDRESS || "Unnamed result";
    const subtitle = result.ADDRESS && result.ADDRESS !== title ? ` - ${result.ADDRESS}` : "";
    button.textContent = `${title}${subtitle}`;
    button.addEventListener("click", () => handleSearchSelect(result));
    ui.searchResults.appendChild(button);
  });
  ui.searchResults.classList.add("visible");
}

async function runLocationSearch(query) {
  if (query.length < 2) {
    clearSearchResults();
    return;
  }

  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  const url = `${state.proxy_base}/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  try {
    const response = await fetch(url, { signal: searchAbortController.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results : [];
    renderSearchResults(results);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    clearSearchResults();
    setStatus(`Search failed: ${error.message}`, true);
  }
}

function refreshBasemapLayer() {
  viewer.imageryLayers.removeAll(true);
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: baseMapUrl(),
    rectangle: SINGAPORE_RECTANGLE,
    minimumLevel: 11,
    maximumLevel: 19,
    credit: "OneMap",
  });
  viewer.imageryLayers.addImageryProvider(provider);
}

async function loadTileset() {
  if (tileset) {
    viewer.scene.primitives.remove(tileset);
  }
  const url = `${state.proxy_base}/omapi/tilesets/sg_noterrain_tiles/tileset.json`;
  tileset = await Cesium.Cesium3DTileset.fromUrl(url);
  // Favor near-view detail and aggressively skip/cull far tiles.
  tileset.dynamicScreenSpaceError = true;
  tileset.maximumScreenSpaceError = 32;
  tileset.skipLevelOfDetail = true;
  tileset.baseScreenSpaceError = 1024;
  tileset.skipScreenSpaceErrorFactor = 16;
  tileset.skipLevels = 1;
  tileset.cullWithChildrenBounds = true;
  tileset.cullRequestsWhileMoving = true;
  tileset.cullRequestsWhileMovingMultiplier = 12;
  tileset.loadSiblings = false;
  tileset.preloadWhenHidden = false;
  tileset.preloadFlightDestinations = false;
  viewer.scene.primitives.add(tileset);
  window.__tileset = tileset;
}

async function ensureSceneDataLoaded(force = false) {
  const dataKey = `${state.proxy_base}|${state.base_map}`;
  if (!force && dataKey === loadedDataKey && tileset) {
    return;
  }

  refreshBasemapLayer();
  await loadTileset();
  loadedDataKey = dataKey;
}

async function initializeViewer() {
  Cesium.Ion.defaultAccessToken = "";
  viewer = new Cesium.Viewer("viewerContainer", {
    animation: false,
    timeline: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
    baseLayer: false,
  });
  window.__viewer = viewer;
  viewer.scene.camera.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.0002;
  viewer.scene.fog.screenSpaceErrorFactor = 2;
  viewer.scene.debugShowFramesPerSecond = false;
  viewer.scene.renderError.addEventListener((scene, error) => {
    setStatus(`Render error: ${error?.message || error}`, true);
  });
  window.addEventListener("error", (event) => {
    if (event?.message) {
      setStatus(`JS error: ${event.message}`, true);
    }
  });

  lockCameraControls();
  installOrientationDrag();
  setFixedCameraPose();
  initializeMiniMap();

  // Avoid blank startup while heavy 3D tiles are loading.
  setStatus("Loading OneMap tiles...");
  void ensureSceneDataLoaded(true)
    .then(() => {
      setStatus("Viewer ready.");
    })
    .catch((error) => {
      setStatus(`Failed loading OneMap tiles: ${error.message}`, true);
    });
}

async function applyPoseFromForm() {
  try {
    readStateFromInputs();
    await ensureSceneDataLoaded();
    syncMiniMapFromState(true);
    setFixedCameraPose();
    syncUrlToState();
    setStatus("Pose applied.");
  } catch (error) {
    setStatus(`Failed to apply pose: ${error.message}`, true);
  }
}

async function copyShareLink() {
  const url = buildShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Share link copied.");
  } catch {
    setStatus("Copy failed. URL updated in address bar.", true);
  }
}

function bindUi() {
  ui.applyBtn.addEventListener("click", () => {
    void applyPoseFromForm();
  });
  ui.copyBtn.addEventListener("click", () => {
    void copyShareLink();
  });
  ui.floorLevel.addEventListener("input", () => {
    syncHeightFromFloorInputs();
  });
  ui.floorHeightM.addEventListener("input", () => {
    syncHeightFromFloorInputs();
  });
  ui.heightM.addEventListener("input", () => {
    syncFloorFromHeightInput();
  });
  ui.searchInput.addEventListener("input", (event) => {
    const query = event.target.value.trim();
    if (searchDebounceId) {
      window.clearTimeout(searchDebounceId);
    }
    searchDebounceId = window.setTimeout(() => {
      void runLocationSearch(query);
    }, 250);
  });
  ui.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const first = ui.searchResults.querySelector(".search-result-item:not([disabled])");
    if (first) {
      first.click();
      event.preventDefault();
    }
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target === ui.searchInput || ui.searchResults.contains(target)) {
      return;
    }
    clearSearchResults();
  });
}

async function bootstrap() {
  applyStateFromQuery();
  syncInputsFromState();
  bindUi();
  try {
    await initializeViewer();
    syncUrlToState();
  } catch (error) {
    setStatus(`Viewer failed to initialize: ${error.message}`, true);
  }
}

void bootstrap();
