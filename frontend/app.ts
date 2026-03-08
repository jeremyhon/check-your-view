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
  floorLevelFromHeight,
  heightFromFloor,
  isWithinBounds,
  parseStateFromQuery,
  sanitizeFloorHeight,
} from "./js/pose-state";
import { createCameraController } from "./js/camera-controls";
import { createSceneDataController } from "./js/scene-data";
import { createTileDiagnosticsController } from "./js/tile-diagnostics";
import { createUrlSyncController } from "./js/url-sync";
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
import type { TileDiagnosticsController } from "./js/tile-diagnostics";
import type { UrlSyncController } from "./js/url-sync";

const SINGAPORE_RECTANGLE = Cesium.Rectangle.fromDegrees(
  SINGAPORE_RECTANGLE_DEGREES.west,
  SINGAPORE_RECTANGLE_DEGREES.south,
  SINGAPORE_RECTANGLE_DEGREES.east,
  SINGAPORE_RECTANGLE_DEGREES.north,
);
const INSIDE_BUILDING_HEADROOM_METERS = 2;
const INDOOR_VISIBILITY_RETRY_DELAY_MS = 900;

const state: ViewState = { ...DEFAULTS };
const debugState: DebugState = { ...DEBUG_DEFAULTS };
const defaultQualityPreset: QualityPreset = isMobileClient ? "medium" : "high";
let isInsideBuilding = false;
let viewer: Viewer | null = null;
let tileset: Cesium3DTileset | null = null;
let panelController!: PanelController;
let locationController!: LocationController;
let cameraController!: CameraController;
let sceneDataController!: SceneDataController;
let compassOverlayController!: CompassOverlayController;
let amenityLayerController: AmenityLayerController | null = null;
let tileDiagnosticsController!: TileDiagnosticsController;
let urlSyncController!: UrlSyncController;
let indoorVisibilityRetryTimerId: number | null = null;

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
  indoorStatusBadge: requireElement("indoorStatusBadge"),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(message: string, isError = false): void {
  ui.status.textContent = message;
  ui.status.style.color = isError ? "#b42318" : "#1f2937";
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

function syncIndoorStatusOverlay(insideBuilding: boolean): void {
  if (insideBuilding === isInsideBuilding) {
    return;
  }
  isInsideBuilding = insideBuilding;
  ui.indoorStatusBadge.hidden = !insideBuilding;
}

function updateInputAngles() {
  ui.headingDeg.value = state.heading_deg.toFixed(1);
  ui.pitchDeg.value = state.pitch_deg.toFixed(1);
  compassOverlayController.syncHeading(state.heading_deg);
  locationController.syncMiniMapFromState();
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

function updateIndoorBuildingVisibility(): void {
  if (!viewer || !tileset) {
    return;
  }
  const activeViewer = viewer;
  const activeTileset = tileset;
  const previousShow = activeTileset.show;
  const scene = activeViewer.scene;
  if (!scene.sampleHeightSupported) {
    activeTileset.show = true;
    syncIndoorStatusOverlay(false);
    if (activeTileset.show !== previousShow) {
      scene.requestRender();
    }
    return;
  }

  const cameraPosition = Cesium.Cartographic.fromCartesian(activeViewer.camera.positionWC);
  if (!cameraPosition) {
    activeTileset.show = true;
    syncIndoorStatusOverlay(false);
    if (activeTileset.show !== previousShow) {
      scene.requestRender();
    }
    return;
  }

  // Force visible while sampling so we can recover after moving out of a building.
  activeTileset.show = true;
  const cameraHeight = cameraPosition.height;
  const sampledHeight = scene.sampleHeight(cameraPosition);
  const insideBuildingDetected =
    typeof sampledHeight === "number" &&
    Number.isFinite(sampledHeight) &&
    sampledHeight - cameraHeight >= INSIDE_BUILDING_HEADROOM_METERS;

  activeTileset.show = !insideBuildingDetected;
  syncIndoorStatusOverlay(insideBuildingDetected);
  if (activeTileset.show !== previousShow) {
    scene.requestRender();
  }
}

function refreshIndoorBuildingVisibility(): void {
  updateIndoorBuildingVisibility();
  if (indoorVisibilityRetryTimerId !== null) {
    window.clearTimeout(indoorVisibilityRetryTimerId);
  }
  indoorVisibilityRetryTimerId = window.setTimeout(() => {
    indoorVisibilityRetryTimerId = null;
    updateIndoorBuildingVisibility();
  }, INDOOR_VISIBILITY_RETRY_DELAY_MS);
}

function handleLocationChanged(): void {
  cameraController.applyFixedPose();
  refreshIndoorBuildingVisibility();
  amenityLayerController?.refresh();
  urlSyncController.syncNow();
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
  if (debugUiEnabled) {
    window.__viewer = viewer;
  }
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
      tileDiagnosticsController.onCameraChanged();
    });
    viewer.camera.moveStart.addEventListener(() => {
      tileDiagnosticsController.onCameraMoveStart();
    });
    viewer.camera.moveEnd.addEventListener(() => {
      tileDiagnosticsController.onCameraMoveEnd();
    });
  }

  cameraController = createCameraController({
    viewer,
    state,
    cameraFarMeters: CAMERA_FAR_METERS,
    initialZoomPercent: state.zoom_pct,
    onPoseChanged: () => {
      urlSyncController.syncNow();
    },
    onOrientationInputUpdate: updateInputAngles,
    onZoomPercentChanged: (zoomPercent: number) => {
      state.zoom_pct = zoomPercent;
      syncZoomResetOverlay(zoomPercent);
      amenityLayerController?.refresh();
      urlSyncController.syncThrottled();
    },
  });
  cameraController.lockPositionControls();
  cameraController.installOrientationDrag();
  cameraController.installZoomControls();
  cameraController.applyFixedPose();
  tileDiagnosticsController.start();

  sceneDataController = createSceneDataController({
    viewer,
    state,
    singaporeRectangle: SINGAPORE_RECTANGLE,
    debugState,
    applyDebugSettingsToTileset,
    onTilesetLoaded: (nextTileset: Cesium3DTileset) => {
      tileset = nextTileset;
      if (debugUiEnabled) {
        window.__tileset = nextTileset;
      }
      tileDiagnosticsController.onTilesetLoaded(nextTileset);
      refreshIndoorBuildingVisibility();
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
    refreshIndoorBuildingVisibility();
    amenityLayerController?.refresh();
    updateInputAngles();
    urlSyncController.syncNow();
    setStatus("Pose applied.");
  } catch (error: unknown) {
    setStatus(`Failed to apply pose: ${errorMessage(error)}`, true);
  }
}

async function copyShareLink() {
  const url = urlSyncController.buildShareUrl();
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
  urlSyncController = createUrlSyncController({ state });
  tileDiagnosticsController = createTileDiagnosticsController({
    ui,
    enabled: debugUiEnabled,
  });
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
    urlSyncController.syncNow();
  } catch (error: unknown) {
    setStatus(`Viewer failed to initialize: ${errorMessage(error)}`, true);
  }
}

void bootstrap();
