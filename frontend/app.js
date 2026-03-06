/* global Cesium */

import { clamp, normalizeDeg, parseNumber } from "./js/utils.js";
import {
  applyDebugSettingsLive,
  applyDebugSettingsToTileset,
  bindDebugControls,
  getDebugValueByControlId,
  setDebugPanelVisibility,
  syncDebugInputsFromState,
} from "./js/debug-controls.js";
import {
  CAMERA_FAR_METERS,
  DEBUG_DEFAULTS,
  DEFAULTS,
  PANEL_COLLAPSE_STORAGE_KEY,
  SG_LIMITS,
  SINGAPORE_BOUNDS,
  SINGAPORE_RECTANGLE_DEGREES,
  debugUiEnabled,
  isMobileClient,
} from "./js/constants.js";
import { createLocationController } from "./js/location-controls.js";
import { createPanelController, setMiniMapInstructionText } from "./js/panel-controls.js";
import {
  buildShareUrlFromState,
  floorLevelFromHeight,
  heightFromFloor,
  isWithinBounds,
  parseStateFromQuery,
  sanitizeFloorHeight,
} from "./js/pose-state.js";
import { createCameraController } from "./js/camera-controls.js";
const SINGAPORE_RECTANGLE = Cesium.Rectangle.fromDegrees(
  SINGAPORE_RECTANGLE_DEGREES.west,
  SINGAPORE_RECTANGLE_DEGREES.south,
  SINGAPORE_RECTANGLE_DEGREES.east,
  SINGAPORE_RECTANGLE_DEGREES.north,
);

const state = { ...DEFAULTS };
const debugState = { ...DEBUG_DEFAULTS };
let viewer;
let tileset;
let loadedDataKey = "";
let panelController;
let locationController;
let cameraController;

const $ = (id) => document.getElementById(id);

const ui = {
  miniMap: $("miniMap"),
  miniMapInstruction: $("miniMapInstruction"),
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
  debugPanel: $("debugPanel"),
  debugFogEnabled: $("debugFogEnabled"),
  debugDynamicSse: $("debugDynamicSse"),
  debugSkipLod: $("debugSkipLod"),
  debugFoveatedSse: $("debugFoveatedSse"),
  debugCullWithChildren: $("debugCullWithChildren"),
  debugCullWhileMoving: $("debugCullWhileMoving"),
  debugLoadSiblings: $("debugLoadSiblings"),
  debugMaxSse: $("debugMaxSse"),
  debugCullMultiplier: $("debugCullMultiplier"),
  panelToggleBtn: $("panelToggleBtn"),
  applyBtn: $("applyBtn"),
  copyBtn: $("copyBtn"),
  status: $("status"),
};

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
  syncDebugInputsFromState(ui, debugState, debugUiEnabled);
}

function readStateFromInputs() {
  state.lat = parseNumber(ui.lat.value, state.lat);
  state.lng = parseNumber(ui.lng.value, state.lng);
  if (!isWithinBounds(state.lat, state.lng, SG_LIMITS)) {
    state.lat = DEFAULTS.lat;
    state.lng = DEFAULTS.lng;
  }
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value, DEFAULTS.floor_height_m);
  state.floor_level = Math.max(parseNumber(ui.floorLevel.value, state.floor_level), 0);
  state.height_m = clamp(parseNumber(ui.heightM.value, state.height_m), 1, 5000);
  state.fov_deg = clamp(parseNumber(ui.fovDeg.value, state.fov_deg), 20, 120);
  state.heading_deg = normalizeDeg(parseNumber(ui.headingDeg.value, state.heading_deg));
  state.pitch_deg = clamp(parseNumber(ui.pitchDeg.value, state.pitch_deg), -89, 89);
  state.base_map = ui.baseMap.value === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";
}

function syncUrlToState() {
  window.history.replaceState({}, "", buildShareUrlFromState(state, window.location));
}

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.style.color = isError ? "#b42318" : "#1f2937";
}

function updateInputAngles() {
  ui.headingDeg.value = state.heading_deg.toFixed(1);
  ui.pitchDeg.value = state.pitch_deg.toFixed(1);
}

function syncHeightFromFloorInputs() {
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value, DEFAULTS.floor_height_m);
  state.floor_level = Math.max(parseNumber(ui.floorLevel.value, state.floor_level), 0);
  state.height_m = clamp(heightFromFloor(state.floor_level, state.floor_height_m), 1, 5000);
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.heightM.value = state.height_m.toFixed(1);
}

function syncFloorFromHeightInput() {
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value, DEFAULTS.floor_height_m);
  state.height_m = clamp(parseNumber(ui.heightM.value, state.height_m), 1, 5000);
  state.floor_level = floorLevelFromHeight(state.height_m, state.floor_height_m);
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.heightM.value = state.height_m.toFixed(1);
}

function baseMapUrl() {
  return `${state.proxy_base}/maps/tiles/${state.base_map}/{z}/{x}/{y}.png`;
}

function handleLocationChanged() {
  cameraController.applyFixedPose();
  syncUrlToState();
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
  applyDebugSettingsToTileset(debugState, tileset);
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
  viewer.scene.globe.showGroundAtmosphere = true;
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
  }
  if (viewer.scene.skyBox) {
    viewer.scene.skyBox.show = true;
  }
  viewer.scene.fog.enabled = debugState.fogEnabled;
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

  cameraController = createCameraController({
    viewer,
    state,
    cameraFarMeters: CAMERA_FAR_METERS,
    onPoseChanged: syncUrlToState,
    onOrientationInputUpdate: updateInputAngles,
  });
  cameraController.lockPositionControls();
  cameraController.installOrientationDrag();
  cameraController.applyFixedPose();
  locationController.initializeMiniMap();

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
    locationController.syncMiniMapFromState(true);
    cameraController.applyFixedPose();
    syncUrlToState();
    setStatus("Pose applied.");
  } catch (error) {
    setStatus(`Failed to apply pose: ${error.message}`, true);
  }
}

async function copyShareLink() {
  const url = buildShareUrlFromState(state, window.location);
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Share link copied.");
  } catch {
    setStatus("Copy failed. URL updated in address bar.", true);
  }
}

function bindUi() {
  panelController.bindPanelToggle();
  locationController.bindSearchControls();
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
  bindDebugControls({
    ui,
    enabled: debugUiEnabled,
    debugState,
    onChange: (controlId) => {
      applyDebugSettingsLive({ viewer, tileset, debugState });
      console.log(`[debug] ${controlId} = ${getDebugValueByControlId(controlId, debugState)}`, {
        ...debugState,
      });
    },
  });
}

async function bootstrap() {
  Object.assign(state, parseStateFromQuery(window.location.search, DEFAULTS, SG_LIMITS));
  setMiniMapInstructionText(ui, isMobileClient);
  locationController = createLocationController({
    ui,
    state,
    singaporeBounds: SINGAPORE_BOUNDS,
    isWithinSingapore: (lat, lng) => isWithinBounds(lat, lng, SG_LIMITS),
    setStatus,
    onLocationChanged: handleLocationChanged,
  });
  panelController = createPanelController({
    ui,
    storageKey: PANEL_COLLAPSE_STORAGE_KEY,
    defaultCollapsed: isMobileClient,
    onAfterToggle: (collapsed) => {
      if (viewer) {
        viewer.scene.requestRender();
      }
      if (!collapsed) {
        locationController.invalidateMiniMap();
      }
    },
  });
  panelController.initializePanelCollapsedState();
  setDebugPanelVisibility(ui, debugUiEnabled);
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
