/* global Cesium */

import "./config";

import { clamp, normalizeDeg, parseNumber } from "./js/utils";
import {
  applyQualityPreset,
  applyDebugSettingsLive,
  applyDebugSettingsToTileset,
  bindDebugControls,
  getDebugValueByControlId,
  setDebugPanelVisibility,
  syncDebugInputsFromState,
} from "./js/debug-controls";
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
} from "./js/constants";
import { createLocationController } from "./js/location-controls";
import { createPanelController, setMiniMapInstructionText } from "./js/panel-controls";
import { createCompassOverlay } from "./js/compass-overlay";
import { createAmenityLayer } from "./js/amenity-layer";
import {
  buildShareUrlFromState,
  floorLevelFromHeight,
  heightFromFloor,
  isWithinBounds,
  parseStateFromQuery,
  sanitizeFloorHeight,
} from "./js/pose-state";
import { createCameraController } from "./js/camera-controls";
import { createSceneDataController } from "./js/scene-data";
import type { Cesium3DTileset, Viewer } from "cesium";
import type {
  CameraController,
  AmenityLayerController,
  CompassOverlayController,
  DebugControlId,
  DebugState,
  FloorSyncMode,
  LocationController,
  PanelController,
  QualityPreset,
  SceneDataController,
  UiElements,
  ViewState,
} from "./js/types";

const SINGAPORE_RECTANGLE = Cesium.Rectangle.fromDegrees(
  SINGAPORE_RECTANGLE_DEGREES.west,
  SINGAPORE_RECTANGLE_DEGREES.south,
  SINGAPORE_RECTANGLE_DEGREES.east,
  SINGAPORE_RECTANGLE_DEGREES.north,
);
const TILE_DIAGNOSTICS_INTERVAL_MS = 350;
const TILE_DIAGNOSTICS_LOG_INTERVAL_MS = 3000;

type TileDiagnosticsState = {
  startedAtMs: number;
  pendingRequests: number;
  tilesProcessing: number;
  maxPendingRequests: number;
  maxTilesProcessing: number;
  loadProgressEvents: number;
  tileLoadEvents: number;
  tileUnloadEvents: number;
  tileFailedEvents: number;
  allTilesLoadedEvents: number;
  initialTilesLoadedEvents: number;
  cameraChangedEvents: number;
  cameraMoveStartEvents: number;
  cameraMoveEndEvents: number;
  lastProgressAtMs: number;
  lastCameraChangeAtMs: number;
  lastTileLoadAtMs: number;
  lastTileFailedUrl: string;
  lastTileFailedMessage: string;
  lastLogAtMs: number;
};

const state: ViewState = { ...DEFAULTS };
const debugState: DebugState = { ...DEBUG_DEFAULTS };
const defaultQualityPreset: QualityPreset = isMobileClient ? "medium" : "high";
let viewer: Viewer | null = null;
let tileset: Cesium3DTileset | null = null;
let panelController!: PanelController;
let locationController!: LocationController;
let cameraController!: CameraController;
let sceneDataController!: SceneDataController;
let compassOverlayController!: CompassOverlayController;
let amenityLayerController: AmenityLayerController | null = null;
let tileDiagnosticsIntervalId: number | null = null;
let tileDiagnosticsWatchedTileset: Cesium3DTileset | null = null;
let tileDiagnosticsCleanupFns: Array<() => void> = [];

const tileDiagnosticsState: TileDiagnosticsState = {
  startedAtMs: performance.now(),
  pendingRequests: 0,
  tilesProcessing: 0,
  maxPendingRequests: 0,
  maxTilesProcessing: 0,
  loadProgressEvents: 0,
  tileLoadEvents: 0,
  tileUnloadEvents: 0,
  tileFailedEvents: 0,
  allTilesLoadedEvents: 0,
  initialTilesLoadedEvents: 0,
  cameraChangedEvents: 0,
  cameraMoveStartEvents: 0,
  cameraMoveEndEvents: 0,
  lastProgressAtMs: 0,
  lastCameraChangeAtMs: 0,
  lastTileLoadAtMs: 0,
  lastTileFailedUrl: "",
  lastTileFailedMessage: "",
  lastLogAtMs: 0,
};

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

const ui: UiElements = {
  compassTrack: requireElement("compassTrack"),
  compassReadout: requireElement("compassReadout"),
  zoomResetBtn: requireElement("zoomResetBtn"),
  tileDiagnostics: requireElement("tileDiagnostics"),
  miniMap: requireElement("miniMap"),
  miniMapInstruction: requireElement("miniMapInstruction"),
  lat: requireElement("lat"),
  lng: requireElement("lng"),
  searchInput: requireElement("searchInput"),
  searchResults: requireElement("searchResults"),
  amenitySummary: requireElement("amenitySummary"),
  amenityToggleMrtLrt: requireElement("amenityToggleMrtLrt"),
  amenityTogglePrimarySchools: requireElement("amenityTogglePrimarySchools"),
  amenityTogglePreschools: requireElement("amenityTogglePreschools"),
  amenityToggleShoppingMalls: requireElement("amenityToggleShoppingMalls"),
  amenityToggleSupermarketsWetMarkets: requireElement("amenityToggleSupermarketsWetMarkets"),
  amenityToggleHawkerFoodCourts: requireElement("amenityToggleHawkerFoodCourts"),
  floorLevel: requireElement("floorLevel"),
  floorHeightM: requireElement("floorHeightM"),
  heightM: requireElement("heightM"),
  qualityPreset: requireElement("qualityPreset"),
  fovDeg: requireElement("fovDeg"),
  headingDeg: requireElement("headingDeg"),
  pitchDeg: requireElement("pitchDeg"),
  baseMap: requireElement("baseMap"),
  debugPanel: requireElement("debugPanel"),
  debugFogEnabled: requireElement("debugFogEnabled"),
  debugDynamicSse: requireElement("debugDynamicSse"),
  debugSkipLod: requireElement("debugSkipLod"),
  debugFoveatedSse: requireElement("debugFoveatedSse"),
  debugCullWithChildren: requireElement("debugCullWithChildren"),
  debugCullWhileMoving: requireElement("debugCullWhileMoving"),
  debugLoadSiblings: requireElement("debugLoadSiblings"),
  debugMaxSse: requireElement("debugMaxSse"),
  debugCullMultiplier: requireElement("debugCullMultiplier"),
  panelCloseBtn: requireElement("panelCloseBtn"),
  panelOpenBtn: requireElement("panelOpenBtn"),
  applyBtn: requireElement("applyBtn"),
  copyBtn: requireElement("copyBtn"),
  status: requireElement("status"),
};

function syncInputsFromState() {
  ui.lat.value = String(state.lat);
  ui.lng.value = String(state.lng);
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.heightM.value = String(state.height_m);
  ui.fovDeg.value = String(state.fov_deg);
  ui.headingDeg.value = String(state.heading_deg);
  ui.pitchDeg.value = String(state.pitch_deg);
  ui.baseMap.value = state.base_map;
  compassOverlayController.syncHeading(state.heading_deg);
  syncDebugInputsFromState(ui, debugState, debugUiEnabled);
}

function readStateFromInputs() {
  state.lat = parseNumber(ui.lat.value, state.lat);
  state.lng = parseNumber(ui.lng.value, state.lng);
  if (!isWithinBounds(state.lat, state.lng, SG_LIMITS)) {
    state.lat = DEFAULTS.lat;
    state.lng = DEFAULTS.lng;
  }
  syncFloorAndHeightFromInputs("height");
  state.fov_deg = clamp(parseNumber(ui.fovDeg.value, state.fov_deg), 20, 120);
  state.heading_deg = normalizeDeg(parseNumber(ui.headingDeg.value, state.heading_deg));
  state.pitch_deg = clamp(parseNumber(ui.pitchDeg.value, state.pitch_deg), -89, 89);
  state.base_map = ui.baseMap.value === "DefaultRoad" ? "DefaultRoad" : "OrthoJPG";
}

function parseQualityPreset(value: string): QualityPreset {
  if (value === "ultra" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return defaultQualityPreset;
}

function applyQualityPresetFromInput(): void {
  const qualityPreset = parseQualityPreset(ui.qualityPreset.value);
  ui.qualityPreset.value = qualityPreset;
  applyQualityPreset(debugState, qualityPreset);
  syncDebugInputsFromState(ui, debugState, debugUiEnabled);
  applyDebugSettingsLive({ viewer, tileset, debugState });
}

function syncUrlToState() {
  const url = new URL(buildShareUrlFromState(state, window.location));
  const currentParams = new URLSearchParams(window.location.search);
  if (currentParams.get("debug") === "1") {
    url.searchParams.set("debug", "1");
  }
  window.history.replaceState({}, "", url.toString());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(message: string, isError = false): void {
  ui.status.textContent = message;
  ui.status.style.color = isError ? "#b42318" : "#1f2937";
}

function secondsAgo(timestampMs: number, nowMs: number): string {
  if (!timestampMs) {
    return "-";
  }
  return `${((nowMs - timestampMs) / 1000).toFixed(1)}s`;
}

function toMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function resetTileDiagnosticsState(): void {
  const now = performance.now();
  tileDiagnosticsState.startedAtMs = now;
  tileDiagnosticsState.pendingRequests = 0;
  tileDiagnosticsState.tilesProcessing = 0;
  tileDiagnosticsState.maxPendingRequests = 0;
  tileDiagnosticsState.maxTilesProcessing = 0;
  tileDiagnosticsState.loadProgressEvents = 0;
  tileDiagnosticsState.tileLoadEvents = 0;
  tileDiagnosticsState.tileUnloadEvents = 0;
  tileDiagnosticsState.tileFailedEvents = 0;
  tileDiagnosticsState.allTilesLoadedEvents = 0;
  tileDiagnosticsState.initialTilesLoadedEvents = 0;
  tileDiagnosticsState.lastProgressAtMs = 0;
  tileDiagnosticsState.lastTileLoadAtMs = 0;
  tileDiagnosticsState.lastTileFailedUrl = "";
  tileDiagnosticsState.lastTileFailedMessage = "";
  tileDiagnosticsState.lastLogAtMs = 0;
}

function detachTilesetDiagnosticsEvents(): void {
  tileDiagnosticsCleanupFns.forEach((cleanupFn) => {
    try {
      cleanupFn();
    } catch {
      // Ignore listener cleanup failures.
    }
  });
  tileDiagnosticsCleanupFns = [];
  tileDiagnosticsWatchedTileset = null;
}

function maybeLogTileDiagnostics(targetTileset: Cesium3DTileset, nowMs: number): void {
  if (!debugUiEnabled) {
    return;
  }
  if (nowMs - tileDiagnosticsState.lastLogAtMs < TILE_DIAGNOSTICS_LOG_INTERVAL_MS) {
    return;
  }
  tileDiagnosticsState.lastLogAtMs = nowMs;
  if (
    tileDiagnosticsState.pendingRequests === 0 &&
    tileDiagnosticsState.tilesProcessing === 0 &&
    tileDiagnosticsState.tileFailedEvents === 0
  ) {
    return;
  }
  const snapshot = {
    pendingRequests: tileDiagnosticsState.pendingRequests,
    tilesProcessing: tileDiagnosticsState.tilesProcessing,
    maxPendingRequests: tileDiagnosticsState.maxPendingRequests,
    maxTilesProcessing: tileDiagnosticsState.maxTilesProcessing,
    loadProgressEvents: tileDiagnosticsState.loadProgressEvents,
    tileLoadEvents: tileDiagnosticsState.tileLoadEvents,
    tileUnloadEvents: tileDiagnosticsState.tileUnloadEvents,
    tileFailedEvents: tileDiagnosticsState.tileFailedEvents,
    allTilesLoadedEvents: tileDiagnosticsState.allTilesLoadedEvents,
    initialTilesLoadedEvents: tileDiagnosticsState.initialTilesLoadedEvents,
    cameraChangedEvents: tileDiagnosticsState.cameraChangedEvents,
    cameraMoveStartEvents: tileDiagnosticsState.cameraMoveStartEvents,
    cameraMoveEndEvents: tileDiagnosticsState.cameraMoveEndEvents,
    tilesLoaded: targetTileset.tilesLoaded,
    totalMemoryUsageInBytes: targetTileset.totalMemoryUsageInBytes,
    cacheBytes: targetTileset.cacheBytes,
    maximumCacheOverflowBytes: targetTileset.maximumCacheOverflowBytes,
    maximumScreenSpaceError: targetTileset.maximumScreenSpaceError,
    dynamicScreenSpaceError: targetTileset.dynamicScreenSpaceError,
    skipLevelOfDetail: targetTileset.skipLevelOfDetail,
    cullRequestsWhileMoving: targetTileset.cullRequestsWhileMoving,
    foveatedScreenSpaceError: targetTileset.foveatedScreenSpaceError,
    loadSiblings: targetTileset.loadSiblings,
    lastTileFailedUrl: tileDiagnosticsState.lastTileFailedUrl,
    lastTileFailedMessage: tileDiagnosticsState.lastTileFailedMessage,
  };
  console.log(`[diag] tiles ${JSON.stringify(snapshot)}`);
}

function renderTileDiagnostics(): void {
  if (!debugUiEnabled) {
    return;
  }
  const now = performance.now();
  const activeTileset = tileset;
  if (!activeTileset) {
    ui.tileDiagnostics.textContent = "Waiting for tileset...";
    return;
  }
  const lines = [
    `uptime=${secondsAgo(tileDiagnosticsState.startedAtMs, now)}`,
    `cameraChanged=${tileDiagnosticsState.cameraChangedEvents} moveStart=${tileDiagnosticsState.cameraMoveStartEvents} moveEnd=${tileDiagnosticsState.cameraMoveEndEvents}`,
    `lastCameraChange=${secondsAgo(tileDiagnosticsState.lastCameraChangeAtMs, now)}`,
    `pending=${tileDiagnosticsState.pendingRequests} processing=${tileDiagnosticsState.tilesProcessing} (max ${tileDiagnosticsState.maxPendingRequests}/${tileDiagnosticsState.maxTilesProcessing})`,
    `loadProgressEvents=${tileDiagnosticsState.loadProgressEvents} lastProgress=${secondsAgo(tileDiagnosticsState.lastProgressAtMs, now)}`,
    `tileLoad=${tileDiagnosticsState.tileLoadEvents} tileUnload=${tileDiagnosticsState.tileUnloadEvents} tileFailed=${tileDiagnosticsState.tileFailedEvents} allLoaded=${tileDiagnosticsState.allTilesLoadedEvents} initialLoaded=${tileDiagnosticsState.initialTilesLoadedEvents}`,
    `lastTileLoad=${secondsAgo(tileDiagnosticsState.lastTileLoadAtMs, now)}`,
    `tilesLoadedFlag=${activeTileset.tilesLoaded}`,
    `memory=${toMegabytes(activeTileset.totalMemoryUsageInBytes)} cache=${toMegabytes(activeTileset.cacheBytes)} + overflow=${toMegabytes(activeTileset.maximumCacheOverflowBytes)}`,
    `sse(max=${activeTileset.maximumScreenSpaceError}, dynamic=${String(activeTileset.dynamicScreenSpaceError)})`,
    `lod(skip=${String(activeTileset.skipLevelOfDetail)}, cullMoving=${String(activeTileset.cullRequestsWhileMoving)}, foveated=${String(activeTileset.foveatedScreenSpaceError)}, siblings=${String(activeTileset.loadSiblings)})`,
  ];
  if (tileDiagnosticsState.lastTileFailedUrl) {
    lines.push(`lastFailUrl=${tileDiagnosticsState.lastTileFailedUrl}`);
  }
  if (tileDiagnosticsState.lastTileFailedMessage) {
    lines.push(`lastFailMessage=${tileDiagnosticsState.lastTileFailedMessage}`);
  }
  ui.tileDiagnostics.textContent = lines.join("\n");
  maybeLogTileDiagnostics(activeTileset, now);
}

function attachTilesetDiagnosticsEvents(targetTileset: Cesium3DTileset): void {
  if (!debugUiEnabled) {
    return;
  }
  if (tileDiagnosticsWatchedTileset === targetTileset) {
    return;
  }
  detachTilesetDiagnosticsEvents();
  tileDiagnosticsWatchedTileset = targetTileset;
  resetTileDiagnosticsState();

  const removeLoadProgress = targetTileset.loadProgress.addEventListener(
    (numberOfPendingRequests: number, numberOfTilesProcessing: number) => {
      tileDiagnosticsState.loadProgressEvents += 1;
      tileDiagnosticsState.pendingRequests = numberOfPendingRequests;
      tileDiagnosticsState.tilesProcessing = numberOfTilesProcessing;
      tileDiagnosticsState.maxPendingRequests = Math.max(
        tileDiagnosticsState.maxPendingRequests,
        numberOfPendingRequests,
      );
      tileDiagnosticsState.maxTilesProcessing = Math.max(
        tileDiagnosticsState.maxTilesProcessing,
        numberOfTilesProcessing,
      );
      tileDiagnosticsState.lastProgressAtMs = performance.now();
    },
  ) as unknown as () => void;
  const removeTileLoad = targetTileset.tileLoad.addEventListener(() => {
    tileDiagnosticsState.tileLoadEvents += 1;
    tileDiagnosticsState.lastTileLoadAtMs = performance.now();
  }) as unknown as () => void;
  const removeTileUnload = targetTileset.tileUnload.addEventListener(() => {
    tileDiagnosticsState.tileUnloadEvents += 1;
  }) as unknown as () => void;
  const removeTileFailed = targetTileset.tileFailed.addEventListener((error: unknown) => {
    tileDiagnosticsState.tileFailedEvents += 1;
    if (typeof error === "object" && error !== null) {
      const details = error as { url?: unknown; message?: unknown };
      if (typeof details.url === "string") {
        tileDiagnosticsState.lastTileFailedUrl = details.url;
      }
      if (typeof details.message === "string") {
        tileDiagnosticsState.lastTileFailedMessage = details.message;
      }
    }
  }) as unknown as () => void;
  const removeAllTilesLoaded = targetTileset.allTilesLoaded.addEventListener(() => {
    tileDiagnosticsState.allTilesLoadedEvents += 1;
  }) as unknown as () => void;
  const removeInitialTilesLoaded = targetTileset.initialTilesLoaded.addEventListener(() => {
    tileDiagnosticsState.initialTilesLoadedEvents += 1;
  }) as unknown as () => void;

  tileDiagnosticsCleanupFns = [
    removeLoadProgress,
    removeTileLoad,
    removeTileUnload,
    removeTileFailed,
    removeAllTilesLoaded,
    removeInitialTilesLoaded,
  ];
}

function syncZoomResetOverlay(zoomPercent: number): void {
  if (zoomPercent <= 100.01) {
    ui.zoomResetBtn.hidden = true;
    return;
  }
  const roundedZoomPercent = Math.round(zoomPercent);
  ui.zoomResetBtn.hidden = false;
  ui.zoomResetBtn.textContent = `${roundedZoomPercent}%`;
  ui.zoomResetBtn.setAttribute("aria-label", `Reset zoom from ${roundedZoomPercent}% to 100%`);
}

function updateInputAngles() {
  ui.headingDeg.value = state.heading_deg.toFixed(1);
  ui.pitchDeg.value = state.pitch_deg.toFixed(1);
  compassOverlayController.syncHeading(state.heading_deg);
}

function syncFloorAndHeightFromInputs(mode: FloorSyncMode): void {
  state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value, DEFAULTS.floor_height_m);
  const floorLevelInput = Math.max(parseNumber(ui.floorLevel.value, state.floor_level), 0);
  const heightInput = clamp(parseNumber(ui.heightM.value, state.height_m), 1, 5000);
  if (mode === "floor") {
    state.floor_level = floorLevelInput;
    state.height_m = clamp(heightFromFloor(state.floor_level, state.floor_height_m), 1, 5000);
  } else {
    state.height_m = heightInput;
    state.floor_level = floorLevelFromHeight(state.height_m, state.floor_height_m);
  }
  ui.floorHeightM.value = state.floor_height_m.toFixed(2);
  ui.floorLevel.value = state.floor_level.toFixed(2);
  ui.heightM.value = state.height_m.toFixed(1);
}

function syncHeightFromFloorInputs() {
  syncFloorAndHeightFromInputs("floor");
}

function syncFloorFromHeightInput() {
  syncFloorAndHeightFromInputs("height");
}

function handleLocationChanged(): void {
  cameraController.applyFixedPose();
  amenityLayerController?.refresh();
  syncUrlToState();
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
  viewer.scene.renderError.addEventListener((scene: unknown, error: unknown) => {
    setStatus(`Render error: ${errorMessage(error)}`, true);
  });
  window.addEventListener("error", (event) => {
    if (event?.message) {
      setStatus(`JS error: ${event.message}`, true);
    }
  });
  if (debugUiEnabled) {
    viewer.camera.changed.addEventListener(() => {
      tileDiagnosticsState.cameraChangedEvents += 1;
      tileDiagnosticsState.lastCameraChangeAtMs = performance.now();
    });
    viewer.camera.moveStart.addEventListener(() => {
      tileDiagnosticsState.cameraMoveStartEvents += 1;
      tileDiagnosticsState.lastCameraChangeAtMs = performance.now();
    });
    viewer.camera.moveEnd.addEventListener(() => {
      tileDiagnosticsState.cameraMoveEndEvents += 1;
      tileDiagnosticsState.lastCameraChangeAtMs = performance.now();
    });
  }

  cameraController = createCameraController({
    viewer,
    state,
    cameraFarMeters: CAMERA_FAR_METERS,
    initialZoomPercent: state.zoom_pct,
    onPoseChanged: syncUrlToState,
    onOrientationInputUpdate: updateInputAngles,
    onZoomPercentChanged: (zoomPercent: number) => {
      state.zoom_pct = zoomPercent;
      syncZoomResetOverlay(zoomPercent);
      amenityLayerController?.refresh();
      syncUrlToState();
    },
  });
  cameraController.lockPositionControls();
  cameraController.installOrientationDrag();
  cameraController.installZoomControls();
  cameraController.applyFixedPose();
  if (debugUiEnabled) {
    if (tileDiagnosticsIntervalId === null) {
      tileDiagnosticsIntervalId = window.setInterval(() => {
        renderTileDiagnostics();
      }, TILE_DIAGNOSTICS_INTERVAL_MS);
    }
    renderTileDiagnostics();
  }

  sceneDataController = createSceneDataController({
    viewer,
    state,
    singaporeRectangle: SINGAPORE_RECTANGLE,
    debugState,
    applyDebugSettingsToTileset,
    onTilesetLoaded: (nextTileset: Cesium3DTileset) => {
      tileset = nextTileset;
      window.__tileset = nextTileset;
      if (debugUiEnabled) {
        attachTilesetDiagnosticsEvents(nextTileset);
        renderTileDiagnostics();
      }
    },
  });
  amenityLayerController = createAmenityLayer({
    viewer,
    ui,
    state,
    setStatus,
  });
  amenityLayerController.bindToggleControls();
  void amenityLayerController.initialize();
  locationController.initializeMiniMap();

  // Avoid blank startup while heavy 3D tiles are loading.
  setStatus("Loading OneMap tiles...");
  void sceneDataController
    .ensureSceneDataLoaded(true)
    .then(() => {
      setStatus("Viewer ready.");
    })
    .catch((error: unknown) => {
      setStatus(`Failed loading OneMap tiles: ${errorMessage(error)}`, true);
    });
}

async function applyPoseFromForm() {
  try {
    readStateFromInputs();
    await sceneDataController.ensureSceneDataLoaded();
    locationController.syncMiniMapFromState(true);
    cameraController.applyFixedPose();
    amenityLayerController?.refresh();
    updateInputAngles();
    syncUrlToState();
    setStatus("Pose applied.");
  } catch (error: unknown) {
    setStatus(`Failed to apply pose: ${errorMessage(error)}`, true);
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
  panelController.bindPanelToggleButtons();
  locationController.bindSearchControls();
  ui.applyBtn.addEventListener("click", () => {
    void applyPoseFromForm();
  });
  ui.copyBtn.addEventListener("click", () => {
    void copyShareLink();
  });
  ui.zoomResetBtn.addEventListener("click", () => {
    if (!viewer) {
      return;
    }
    cameraController.resetZoom();
  });
  ui.floorLevel.addEventListener("change", () => {
    syncHeightFromFloorInputs();
  });
  ui.floorHeightM.addEventListener("change", () => {
    syncHeightFromFloorInputs();
  });
  ui.heightM.addEventListener("change", () => {
    syncFloorFromHeightInput();
  });
  ui.qualityPreset.addEventListener("change", () => {
    applyQualityPresetFromInput();
  });
  bindDebugControls({
    ui,
    enabled: debugUiEnabled,
    debugState,
    onChange: (controlId: DebugControlId) => {
      applyDebugSettingsLive({ viewer, tileset, debugState });
      console.log(`[debug] ${controlId} = ${getDebugValueByControlId(controlId, debugState)}`, {
        ...debugState,
      });
    },
  });
}

async function bootstrap() {
  Object.assign(state, parseStateFromQuery(window.location.search, DEFAULTS, SG_LIMITS));
  ui.qualityPreset.value = defaultQualityPreset;
  applyQualityPresetFromInput();
  setMiniMapInstructionText(ui, isMobileClient);
  locationController = createLocationController({
    ui,
    state,
    singaporeBounds: SINGAPORE_BOUNDS,
    isWithinSingapore: (lat: number, lng: number) => isWithinBounds(lat, lng, SG_LIMITS),
    setStatus,
    onLocationChanged: handleLocationChanged,
  });
  panelController = createPanelController({
    ui,
    storageKey: PANEL_COLLAPSE_STORAGE_KEY,
    defaultCollapsed: isMobileClient,
    onAfterToggle: (collapsed: boolean) => {
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
  compassOverlayController = createCompassOverlay({
    track: ui.compassTrack,
    readout: ui.compassReadout,
  });
  syncInputsFromState();
  bindUi();
  try {
    await initializeViewer();
    syncUrlToState();
  } catch (error: unknown) {
    setStatus(`Viewer failed to initialize: ${errorMessage(error)}`, true);
  }
}

void bootstrap();
