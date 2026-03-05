/* global Cesium */

const DEFAULTS = {
  proxy_base: "http://localhost:8787",
  lat: 1.3197,
  lng: 103.8422,
  height_m: 300,
  heading_deg: 0,
  pitch_deg: -80,
  roll_deg: 0,
  fov_deg: 60,
  base_map: "OrthoJPG",
};

const SINGAPORE_RECTANGLE = Cesium.Rectangle.fromDegrees(103.55, 1.15, 104.1, 1.5);

const state = { ...DEFAULTS };
let viewer;
let tileset;
let fixedPosition;
let loadedDataKey = "";
let dragging = false;
let activePointerId = null;
let lastX = 0;
let lastY = 0;

const $ = (id) => document.getElementById(id);

const ui = {
  proxyBase: $("proxyBase"),
  lat: $("lat"),
  lng: $("lng"),
  heightM: $("heightM"),
  fovDeg: $("fovDeg"),
  headingDeg: $("headingDeg"),
  pitchDeg: $("pitchDeg"),
  rollDeg: $("rollDeg"),
  baseMap: $("baseMap"),
  applyBtn: $("applyBtn"),
  copyBtn: $("copyBtn"),
  status: $("status"),
};

function parseNumber(value, fallback) {
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

function applyStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  state.proxy_base = params.get("proxy_base") || DEFAULTS.proxy_base;
  state.lat = parseNumber(params.get("lat"), DEFAULTS.lat);
  state.lng = parseNumber(params.get("lng"), DEFAULTS.lng);
  state.height_m = parseNumber(params.get("height_m"), DEFAULTS.height_m);
  state.heading_deg = parseNumber(params.get("heading_deg"), DEFAULTS.heading_deg);
  state.pitch_deg = parseNumber(params.get("pitch_deg"), DEFAULTS.pitch_deg);
  state.roll_deg = parseNumber(params.get("roll_deg"), DEFAULTS.roll_deg);
  state.fov_deg = parseNumber(params.get("fov_deg"), DEFAULTS.fov_deg);
  const candidateBaseMap = params.get("base_map") || DEFAULTS.base_map;
  state.base_map = candidateBaseMap === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";
}

function syncInputsFromState() {
  ui.proxyBase.value = state.proxy_base;
  ui.lat.value = state.lat;
  ui.lng.value = state.lng;
  ui.heightM.value = state.height_m;
  ui.fovDeg.value = state.fov_deg;
  ui.headingDeg.value = state.heading_deg;
  ui.pitchDeg.value = state.pitch_deg;
  ui.rollDeg.value = state.roll_deg;
  ui.baseMap.value = state.base_map;
}

function readStateFromInputs() {
  state.proxy_base = ui.proxyBase.value.trim() || DEFAULTS.proxy_base;
  state.lat = parseNumber(ui.lat.value, state.lat);
  state.lng = parseNumber(ui.lng.value, state.lng);
  state.height_m = parseNumber(ui.heightM.value, state.height_m);
  state.fov_deg = clamp(parseNumber(ui.fovDeg.value, state.fov_deg), 20, 120);
  state.heading_deg = normalizeDeg(parseNumber(ui.headingDeg.value, state.heading_deg));
  state.pitch_deg = clamp(parseNumber(ui.pitchDeg.value, state.pitch_deg), -89, 89);
  state.roll_deg = normalizeDeg(parseNumber(ui.rollDeg.value, state.roll_deg));
  state.base_map = ui.baseMap.value === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";
}

function buildShareUrl() {
  const params = new URLSearchParams();
  params.set("proxy_base", state.proxy_base);
  params.set("lat", state.lat.toFixed(6));
  params.set("lng", state.lng.toFixed(6));
  params.set("height_m", state.height_m.toFixed(1));
  params.set("heading_deg", state.heading_deg.toFixed(1));
  params.set("pitch_deg", state.pitch_deg.toFixed(1));
  params.set("roll_deg", state.roll_deg.toFixed(1));
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
      roll: Cesium.Math.toRadians(state.roll_deg),
    },
  });
  viewer.camera.frustum.fov = Cesium.Math.toRadians(state.fov_deg);
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

function refreshBasemapLayer() {
  viewer.imageryLayers.removeAll(true);
  viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: baseMapUrl(),
      rectangle: SINGAPORE_RECTANGLE,
      minimumLevel: 11,
      maximumLevel: 19,
      credit: "OneMap",
    }),
  );
}

async function loadTileset() {
  if (tileset) {
    viewer.scene.primitives.remove(tileset);
  }
  const url = `${state.proxy_base}/omapi/tilesets/sg_noterrain_tiles/tileset.json`;
  tileset = await Cesium.Cesium3DTileset.fromUrl(url);
  tileset.dynamicScreenSpaceError = true;
  tileset.maximumScreenSpaceError = 32;
  viewer.scene.primitives.add(tileset);
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
  viewer.scene.camera.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
  viewer.scene.globe.showGroundAtmosphere = false;
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
