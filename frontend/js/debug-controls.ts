import { clamp, parseNumber } from "./utils";
import type { Cesium3DTileset, Viewer } from "cesium";
import type { DebugControlId, DebugState, UiElements } from "./types";

type DebugLiveApplyArgs = {
  viewer: Viewer | null;
  tileset?: Cesium3DTileset | null;
  debugState: DebugState;
};

type DebugControlsBindOptions = {
  ui: UiElements;
  enabled: boolean;
  debugState: DebugState;
  onChange?: (controlId: DebugControlId) => void;
};

export function setDebugPanelVisibility(ui: UiElements, enabled: boolean): void {
  if (!ui.debugPanel) {
    return;
  }
  ui.debugPanel.hidden = !enabled;
}

export function syncDebugInputsFromState(
  ui: UiElements,
  debugState: DebugState,
  enabled: boolean,
): void {
  if (!enabled || !ui.debugFogEnabled) {
    return;
  }
  ui.debugFogEnabled.checked = debugState.fogEnabled;
  ui.debugDynamicSse.checked = debugState.dynamicScreenSpaceError;
  ui.debugSkipLod.checked = debugState.skipLevelOfDetail;
  ui.debugFoveatedSse.checked = debugState.foveatedScreenSpaceError;
  ui.debugCullWithChildren.checked = debugState.cullWithChildrenBounds;
  ui.debugCullWhileMoving.checked = debugState.cullRequestsWhileMoving;
  ui.debugLoadSiblings.checked = debugState.loadSiblings;
  ui.debugMaxSse.value = String(debugState.maximumScreenSpaceError);
  ui.debugCullMultiplier.value = String(debugState.cullRequestsWhileMovingMultiplier);
}

export function readDebugStateFromInputs(ui: UiElements, debugState: DebugState): void {
  if (!ui.debugFogEnabled) {
    return;
  }
  debugState.fogEnabled = ui.debugFogEnabled.checked;
  debugState.dynamicScreenSpaceError = ui.debugDynamicSse.checked;
  debugState.skipLevelOfDetail = ui.debugSkipLod.checked;
  debugState.foveatedScreenSpaceError = ui.debugFoveatedSse.checked;
  debugState.cullWithChildrenBounds = ui.debugCullWithChildren.checked;
  debugState.cullRequestsWhileMoving = ui.debugCullWhileMoving.checked;
  debugState.loadSiblings = ui.debugLoadSiblings.checked;
  debugState.maximumScreenSpaceError = clamp(
    parseNumber(ui.debugMaxSse.value, debugState.maximumScreenSpaceError),
    1,
    512,
  );
  debugState.cullRequestsWhileMovingMultiplier = clamp(
    parseNumber(ui.debugCullMultiplier.value, debugState.cullRequestsWhileMovingMultiplier),
    1,
    64,
  );
  ui.debugMaxSse.value = String(debugState.maximumScreenSpaceError);
  ui.debugCullMultiplier.value = String(debugState.cullRequestsWhileMovingMultiplier);
}

export function applyDebugSettingsToTileset(
  debugState: DebugState,
  targetTileset?: Cesium3DTileset | null,
): void {
  if (!targetTileset) {
    return;
  }
  const tilesetWithInternalCulling = targetTileset as Cesium3DTileset & {
    cullWithChildrenBounds?: boolean;
  };
  targetTileset.dynamicScreenSpaceError = debugState.dynamicScreenSpaceError;
  targetTileset.maximumScreenSpaceError = debugState.maximumScreenSpaceError;
  targetTileset.skipLevelOfDetail = debugState.skipLevelOfDetail;
  targetTileset.baseScreenSpaceError = 1024;
  targetTileset.skipScreenSpaceErrorFactor = 16;
  targetTileset.skipLevels = 1;
  tilesetWithInternalCulling.cullWithChildrenBounds = debugState.cullWithChildrenBounds;
  targetTileset.cullRequestsWhileMoving = debugState.cullRequestsWhileMoving;
  targetTileset.cullRequestsWhileMovingMultiplier = debugState.cullRequestsWhileMovingMultiplier;
  targetTileset.foveatedScreenSpaceError = debugState.foveatedScreenSpaceError;
  targetTileset.loadSiblings = debugState.loadSiblings;
  targetTileset.preloadWhenHidden = false;
  targetTileset.preloadFlightDestinations = false;
}

export function applyDebugSettingsLive({ viewer, tileset, debugState }: DebugLiveApplyArgs): void {
  if (!viewer) {
    return;
  }
  viewer.scene.fog.enabled = debugState.fogEnabled;
  applyDebugSettingsToTileset(debugState, tileset);
  viewer.scene.requestRender();
}

export function getDebugValueByControlId(
  controlId: DebugControlId,
  debugState: DebugState,
): boolean | number {
  const controlValueMap = {
    debugFogEnabled: debugState.fogEnabled,
    debugDynamicSse: debugState.dynamicScreenSpaceError,
    debugSkipLod: debugState.skipLevelOfDetail,
    debugFoveatedSse: debugState.foveatedScreenSpaceError,
    debugCullWithChildren: debugState.cullWithChildrenBounds,
    debugCullWhileMoving: debugState.cullRequestsWhileMoving,
    debugLoadSiblings: debugState.loadSiblings,
    debugMaxSse: debugState.maximumScreenSpaceError,
    debugCullMultiplier: debugState.cullRequestsWhileMovingMultiplier,
  };
  return controlValueMap[controlId];
}

export function bindDebugControls({
  ui,
  enabled,
  debugState,
  onChange,
}: DebugControlsBindOptions): void {
  if (!enabled) {
    return;
  }
  const debugControls: HTMLInputElement[] = [
    ui.debugFogEnabled,
    ui.debugDynamicSse,
    ui.debugSkipLod,
    ui.debugFoveatedSse,
    ui.debugCullWithChildren,
    ui.debugCullWhileMoving,
    ui.debugLoadSiblings,
    ui.debugMaxSse,
    ui.debugCullMultiplier,
  ];
  debugControls.forEach((control) => {
    const eventName = control.type === "number" ? "input" : "change";
    control.addEventListener(eventName, () => {
      readDebugStateFromInputs(ui, debugState);
      if (typeof onChange === "function") {
        const controlId = control.id as DebugControlId;
        onChange(controlId);
      }
    });
  });
}
