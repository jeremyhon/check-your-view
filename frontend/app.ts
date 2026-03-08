/* global Cesium */

import "./config";

import {
  applyQualityPreset,
  applyDebugSettingsLive,
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
import { syncAmenityToggleLabels } from "./js/amenity-controls";
import { isWithinBounds, parseStateFromQuery } from "./js/pose-state";
import { createTileDiagnosticsController } from "./js/tile-diagnostics";
import { createUrlSyncController } from "./js/url-sync";
import { initStateSync, type StateSyncController } from "./js/bootstrap/init-state-sync";
import { initUiBindings } from "./js/bootstrap/init-ui-bindings";
import { initViewer } from "./js/bootstrap/init-viewer";
import type { Cesium3DTileset, Viewer } from "cesium";
import type {
  AmenityLayerController,
  CameraController,
  CompassOverlayController,
  DebugState,
  LocationController,
  PanelController,
  QualityPreset,
  SceneDataController,
  UiElements,
  ViewState,
} from "./js/types";
import type { DpadControlsController } from "./js/dpad-controls";
import type { TileDiagnosticsController } from "./js/tile-diagnostics";
import type { UrlSyncController } from "./js/url-sync";

const SINGAPORE_RECTANGLE = Cesium.Rectangle.fromDegrees(
  SINGAPORE_RECTANGLE_DEGREES.west,
  SINGAPORE_RECTANGLE_DEGREES.south,
  SINGAPORE_RECTANGLE_DEGREES.east,
  SINGAPORE_RECTANGLE_DEGREES.north,
);
const D_PAD_STEP_METERS = 1;
const D_PAD_HOLD_REPEAT_MS = 120;
const D_PAD_URL_SYNC_DEBOUNCE_MS = 180;

const state: ViewState = { ...DEFAULTS };
const debugState: DebugState = { ...DEBUG_DEFAULTS };
const defaultQualityPreset: QualityPreset = isMobileClient ? "medium" : "high";
let currentQualityPreset: QualityPreset = defaultQualityPreset;
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
let dpadControlsController: DpadControlsController | null = null;
let stateSync!: StateSyncController;

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
  dpadForwardBtn: requireElement("dpadForwardBtn"),
  dpadLeftBtn: requireElement("dpadLeftBtn"),
  dpadRightBtn: requireElement("dpadRightBtn"),
  dpadBackwardBtn: requireElement("dpadBackwardBtn"),
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

function parseQualityPreset(value: string): QualityPreset {
  if (value === "ultra" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return defaultQualityPreset;
}

function applyQualityPresetFromInput(): void {
  const qualityPreset = parseQualityPreset(ui.qualityPreset.value);
  currentQualityPreset = qualityPreset;
  ui.qualityPreset.value = qualityPreset;
  applyQualityPreset(debugState, qualityPreset);
  syncDebugInputsFromState(ui, debugState, debugUiEnabled);
  applyDebugSettingsLive({ viewer, tileset, debugState, qualityPreset });
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

function handleLocationChanged(): void {
  cameraController.applyFixedPose();
  amenityLayerController?.refresh();
  urlSyncController.syncNow();
}

function handleDpadMove(forwardMeters: number, rightMeters: number): void {
  if (!viewer) {
    return;
  }
  cameraController.moveRelativeMeters(forwardMeters, rightMeters);
  stateSync.syncPositionInputsFromState();
  locationController.syncMiniMapFromState();
}

async function applyPoseFromForm() {
  try {
    stateSync.readStateFromInputs();
    await sceneDataController.ensureSceneDataLoaded();
    locationController.syncMiniMapFromState(true);
    cameraController.applyFixedPose();
    amenityLayerController?.refresh();
    stateSync.updateInputAngles();
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

function initializeStateFromQuery(): void {
  Object.assign(state, parseStateFromQuery(window.location.search, DEFAULTS, SG_LIMITS));
}

function setupCoreControllers(): void {
  urlSyncController = createUrlSyncController({
    state,
    debounceMs: D_PAD_URL_SYNC_DEBOUNCE_MS,
  });
  tileDiagnosticsController = createTileDiagnosticsController({
    ui,
    enabled: debugUiEnabled,
  });
}

function setupUiControllers(): void {
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
  compassOverlayController = createCompassOverlay({
    track: ui.compassTrack,
    readout: ui.compassReadout,
  });
  stateSync = initStateSync({
    ui,
    state,
    debugState,
    defaults: DEFAULTS,
    boundsLimits: SG_LIMITS,
    debugUiEnabled,
    compassOverlayController,
    locationController,
  });
}

function setupInitialUiState(): void {
  syncAmenityToggleLabels(ui);
  ui.qualityPreset.value = defaultQualityPreset;
  applyQualityPresetFromInput();
  panelController.initializePanelCollapsedState();
  setDebugPanelVisibility(ui, debugUiEnabled);
  stateSync.syncInputsFromState();
}

function setupUiBindings(): void {
  dpadControlsController = initUiBindings({
    ui,
    panelController,
    locationController,
    cameraController,
    urlSyncController,
    debugUiEnabled,
    debugState,
    getViewer: () => viewer,
    getTileset: () => tileset,
    getQualityPreset: () => currentQualityPreset,
    onApplyPose: applyPoseFromForm,
    onCopyShareLink: copyShareLink,
    onDpadMove: handleDpadMove,
    onSyncHeightFromFloorInputs: stateSync.syncHeightFromFloorInputs,
    onSyncFloorFromHeightInput: stateSync.syncFloorFromHeightInput,
    onQualityPresetChange: applyQualityPresetFromInput,
    dpadStepMeters: D_PAD_STEP_METERS,
    dpadHoldRepeatMs: D_PAD_HOLD_REPEAT_MS,
    previousDpadControls: dpadControlsController,
  });
}

async function setupViewerRuntime(): Promise<void> {
  const viewerRuntime = await initViewer({
    ui,
    state,
    debugState,
    singaporeRectangle: SINGAPORE_RECTANGLE,
    cameraFarMeters: CAMERA_FAR_METERS,
    debugUiEnabled,
    tileDiagnosticsController,
    urlSyncController,
    locationController,
    getQualityPreset: () => currentQualityPreset,
    setStatus,
    errorMessage,
    onOrientationInputUpdate: stateSync.updateInputAngles,
    onZoomPercentChanged: (zoomPercent: number) => {
      state.zoom_pct = zoomPercent;
      syncZoomResetOverlay(zoomPercent);
      amenityLayerController?.refresh();
      urlSyncController.syncThrottled();
    },
    previousAmenityLayerController: amenityLayerController,
    onTilesetLoaded: (nextTileset) => {
      tileset = nextTileset;
    },
  });
  viewer = viewerRuntime.viewer;
  cameraController = viewerRuntime.cameraController;
  sceneDataController = viewerRuntime.sceneDataController;
  amenityLayerController = viewerRuntime.amenityLayerController;
}

async function bootstrap() {
  initializeStateFromQuery();
  setupCoreControllers();
  setupUiControllers();
  setupInitialUiState();
  try {
    await setupViewerRuntime();
    setupUiBindings();
    urlSyncController.syncNow();
  } catch (error: unknown) {
    setStatus(`Viewer failed to initialize: ${errorMessage(error)}`, true);
  }
}

void bootstrap();
