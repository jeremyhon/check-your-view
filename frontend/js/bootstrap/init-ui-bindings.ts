import {
  applyDebugSettingsLive,
  bindDebugControls,
  getDebugValueByControlId,
} from "../debug-controls";
import { bindDpadControls } from "../dpad-controls";
import type { Cesium3DTileset, Viewer } from "cesium";
import type { DpadControlsController } from "../dpad-controls";
import type {
  CameraController,
  DebugControlId,
  DebugState,
  LocationController,
  PanelController,
  QualityPreset,
  UiElements,
} from "../types";
import type { UrlSyncController } from "../url-sync";

type InitUiBindingsOptions = {
  ui: UiElements;
  panelController: PanelController;
  locationController: LocationController;
  cameraController: CameraController;
  urlSyncController: UrlSyncController;
  debugUiEnabled: boolean;
  debugState: DebugState;
  getViewer: () => Viewer | null;
  getTileset: () => Cesium3DTileset | null;
  getQualityPreset: () => QualityPreset;
  onApplyPose: () => Promise<void>;
  onCopyShareLink: () => Promise<void>;
  onDpadMove: (forwardMeters: number, rightMeters: number) => void;
  onSyncHeightFromFloorInputs: () => void;
  onSyncFloorFromHeightInput: () => void;
  onQualityPresetChange: () => void;
  dpadStepMeters: number;
  dpadHoldRepeatMs: number;
  previousDpadControls: DpadControlsController | null;
};

export function initUiBindings({
  ui,
  panelController,
  locationController,
  cameraController,
  urlSyncController,
  debugUiEnabled,
  debugState,
  getViewer,
  getTileset,
  getQualityPreset,
  onApplyPose,
  onCopyShareLink,
  onDpadMove,
  onSyncHeightFromFloorInputs,
  onSyncFloorFromHeightInput,
  onQualityPresetChange,
  dpadStepMeters,
  dpadHoldRepeatMs,
  previousDpadControls,
}: InitUiBindingsOptions): DpadControlsController {
  panelController.bindPanelToggleButtons();
  locationController.bindSearchControls();

  ui.applyBtn.addEventListener("click", () => {
    void onApplyPose();
  });
  ui.copyBtn.addEventListener("click", () => {
    void onCopyShareLink();
  });
  ui.zoomResetBtn.addEventListener("click", () => {
    if (!getViewer()) {
      return;
    }
    cameraController.resetZoom();
  });

  if (previousDpadControls) {
    previousDpadControls.dispose();
  }
  const dpadControlsController = bindDpadControls({
    bindings: [
      { button: ui.dpadForwardBtn, forwardMeters: dpadStepMeters, rightMeters: 0 },
      { button: ui.dpadBackwardBtn, forwardMeters: -dpadStepMeters, rightMeters: 0 },
      { button: ui.dpadLeftBtn, forwardMeters: 0, rightMeters: -dpadStepMeters },
      { button: ui.dpadRightBtn, forwardMeters: 0, rightMeters: dpadStepMeters },
    ],
    repeatIntervalMs: dpadHoldRepeatMs,
    onMove: onDpadMove,
    onStop: () => {
      urlSyncController.syncNow();
    },
  });

  ui.floorLevel.addEventListener("change", () => {
    onSyncHeightFromFloorInputs();
  });
  ui.floorHeightM.addEventListener("change", () => {
    onSyncHeightFromFloorInputs();
  });
  ui.heightM.addEventListener("change", () => {
    onSyncFloorFromHeightInput();
  });
  ui.qualityPreset.addEventListener("change", () => {
    onQualityPresetChange();
  });

  bindDebugControls({
    ui,
    enabled: debugUiEnabled,
    debugState,
    onChange: (controlId: DebugControlId) => {
      applyDebugSettingsLive({
        viewer: getViewer(),
        tileset: getTileset(),
        debugState,
        qualityPreset: getQualityPreset(),
      });
      console.log(`[debug] ${controlId} = ${getDebugValueByControlId(controlId, debugState)}`, {
        ...debugState,
      });
    },
  });

  return dpadControlsController;
}
