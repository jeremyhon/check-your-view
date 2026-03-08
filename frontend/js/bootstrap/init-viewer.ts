import { createAmenityLayer } from "../amenity-layer";
import { createCameraController } from "../camera-controls";
import { applyDebugSettingsToTileset } from "../debug-controls";
import { createSceneDataController } from "../scene-data";
import type { Cesium3DTileset, Rectangle, Viewer } from "cesium";
import type {
  AmenityLayerController,
  CameraController,
  DebugState,
  LocationController,
  QualityPreset,
  SceneDataController,
  UiElements,
  ViewState,
} from "../types";
import type { TileDiagnosticsController } from "../tile-diagnostics";
import type { UrlSyncController } from "../url-sync";

type InitViewerOptions = {
  ui: UiElements;
  state: ViewState;
  debugState: DebugState;
  singaporeRectangle: Rectangle;
  cameraFarMeters: number;
  debugUiEnabled: boolean;
  tileDiagnosticsController: TileDiagnosticsController;
  urlSyncController: UrlSyncController;
  locationController: LocationController;
  getQualityPreset: () => QualityPreset;
  setStatus: (message: string, isError?: boolean) => void;
  errorMessage: (error: unknown) => string;
  onOrientationInputUpdate: () => void;
  onZoomPercentChanged: (zoomPercent: number) => void;
  previousAmenityLayerController: AmenityLayerController | null;
  onTilesetLoaded: (tileset: Cesium3DTileset) => void;
};

export type InitViewerResult = {
  viewer: Viewer;
  cameraController: CameraController;
  sceneDataController: SceneDataController;
  amenityLayerController: AmenityLayerController;
};

export async function initViewer({
  ui,
  state,
  debugState,
  singaporeRectangle,
  cameraFarMeters,
  debugUiEnabled,
  tileDiagnosticsController,
  urlSyncController,
  locationController,
  getQualityPreset,
  setStatus,
  errorMessage,
  onOrientationInputUpdate,
  onZoomPercentChanged,
  previousAmenityLayerController,
  onTilesetLoaded,
}: InitViewerOptions): Promise<InitViewerResult> {
  if (previousAmenityLayerController) {
    previousAmenityLayerController.dispose();
  }

  Cesium.Ion.defaultAccessToken = "";
  const viewer = new Cesium.Viewer("viewerContainer", {
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
  viewer.scene.renderError.addEventListener((_scene: unknown, error: unknown) => {
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

  const cameraController = createCameraController({
    viewer,
    state,
    cameraFarMeters,
    initialZoomPercent: state.zoom_pct,
    onPoseChanged: () => {
      urlSyncController.syncDebounced();
    },
    onOrientationInputUpdate,
    onZoomPercentChanged,
  });
  cameraController.lockPositionControls();
  cameraController.installOrientationDrag();
  cameraController.installZoomControls();
  cameraController.applyFixedPose();
  tileDiagnosticsController.start();

  const sceneDataController = createSceneDataController({
    viewer,
    state,
    singaporeRectangle,
    debugState,
    applyDebugSettingsToTileset: (nextDebugState, targetTileset) => {
      applyDebugSettingsToTileset(nextDebugState, targetTileset, getQualityPreset());
    },
    onTilesetLoaded: (tileset) => {
      if (debugUiEnabled) {
        window.__tileset = tileset;
      }
      tileDiagnosticsController.onTilesetLoaded(tileset);
      onTilesetLoaded(tileset);
    },
  });

  const amenityLayerController = createAmenityLayer({
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

  return {
    viewer,
    cameraController,
    sceneDataController,
    amenityLayerController,
  };
}
