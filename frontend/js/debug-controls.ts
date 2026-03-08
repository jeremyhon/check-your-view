import { clamp, parseNumber } from "./utils";
import type { Cesium3DTileset, Viewer } from "cesium";
import type { DebugControlId, DebugState, QualityPreset, UiElements } from "./types";

type DebugLiveApplyArgs = {
  viewer: Viewer | null;
  tileset?: Cesium3DTileset | null;
  debugState: DebugState;
  qualityPreset: QualityPreset;
};

type DebugControlsBindOptions = {
  ui: UiElements;
  enabled: boolean;
  debugState: DebugState;
  onChange?: (controlId: DebugControlId) => void;
};

type TileCacheBudget = {
  cacheBytes: number;
  overflowBytes: number;
};

const BYTES_PER_MB = 1024 * 1024;
const QUALITY_CACHE_BUDGET: Record<QualityPreset, TileCacheBudget> = {
  ultra: { cacheBytes: 1024 * BYTES_PER_MB, overflowBytes: 512 * BYTES_PER_MB },
  high: { cacheBytes: 768 * BYTES_PER_MB, overflowBytes: 384 * BYTES_PER_MB },
  medium: { cacheBytes: 512 * BYTES_PER_MB, overflowBytes: 256 * BYTES_PER_MB },
  low: { cacheBytes: 320 * BYTES_PER_MB, overflowBytes: 160 * BYTES_PER_MB },
};

export function getQualityCacheBudget(qualityPreset: QualityPreset): TileCacheBudget {
  return QUALITY_CACHE_BUDGET[qualityPreset];
}
const QUALITY_PRESETS: Record<
  QualityPreset,
  Omit<DebugState, "fogEnabled" | "loadSiblings" | "cullWithChildrenBounds">
> = {
  ultra: {
    dynamicScreenSpaceError: false,
    maximumScreenSpaceError: 2,
    skipLevelOfDetail: false,
    cullRequestsWhileMoving: false,
    cullRequestsWhileMovingMultiplier: 1,
    foveatedScreenSpaceError: false,
  },
  high: {
    dynamicScreenSpaceError: true,
    maximumScreenSpaceError: 8,
    skipLevelOfDetail: true,
    cullRequestsWhileMoving: true,
    cullRequestsWhileMovingMultiplier: 8,
    foveatedScreenSpaceError: true,
  },
  medium: {
    dynamicScreenSpaceError: true,
    maximumScreenSpaceError: 16,
    skipLevelOfDetail: true,
    cullRequestsWhileMoving: true,
    cullRequestsWhileMovingMultiplier: 12,
    foveatedScreenSpaceError: true,
  },
  low: {
    dynamicScreenSpaceError: true,
    maximumScreenSpaceError: 32,
    skipLevelOfDetail: true,
    cullRequestsWhileMoving: true,
    cullRequestsWhileMovingMultiplier: 16,
    foveatedScreenSpaceError: true,
  },
};

export function applyQualityPreset(debugState: DebugState, qualityPreset: QualityPreset): void {
  const profile = QUALITY_PRESETS[qualityPreset];
  debugState.dynamicScreenSpaceError = profile.dynamicScreenSpaceError;
  debugState.maximumScreenSpaceError = profile.maximumScreenSpaceError;
  debugState.skipLevelOfDetail = profile.skipLevelOfDetail;
  debugState.cullRequestsWhileMoving = profile.cullRequestsWhileMoving;
  debugState.cullRequestsWhileMovingMultiplier = profile.cullRequestsWhileMovingMultiplier;
  debugState.foveatedScreenSpaceError = profile.foveatedScreenSpaceError;
  debugState.cullWithChildrenBounds = true;
  debugState.loadSiblings = false;
}

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
  qualityPreset: QualityPreset = "high",
): void {
  if (!targetTileset) {
    return;
  }
  const tilesetWithInternalCulling = targetTileset as Cesium3DTileset & {
    cullWithChildrenBounds?: boolean;
    immediatelyLoadDesiredLevelOfDetail?: boolean;
    preferLeaves?: boolean;
  };
  targetTileset.dynamicScreenSpaceError = debugState.dynamicScreenSpaceError;
  targetTileset.maximumScreenSpaceError = debugState.maximumScreenSpaceError;
  targetTileset.skipLevelOfDetail = debugState.skipLevelOfDetail;
  targetTileset.baseScreenSpaceError = debugState.skipLevelOfDetail ? 1024 : 0;
  targetTileset.skipScreenSpaceErrorFactor = debugState.skipLevelOfDetail ? 16 : 1;
  targetTileset.skipLevels = debugState.skipLevelOfDetail ? 1 : 0;
  tilesetWithInternalCulling.cullWithChildrenBounds = debugState.cullWithChildrenBounds;
  targetTileset.cullRequestsWhileMoving = debugState.cullRequestsWhileMoving;
  targetTileset.cullRequestsWhileMovingMultiplier = debugState.cullRequestsWhileMovingMultiplier;
  targetTileset.foveatedScreenSpaceError = debugState.foveatedScreenSpaceError;
  targetTileset.loadSiblings = debugState.loadSiblings;
  const cacheBudget = getQualityCacheBudget(qualityPreset);
  targetTileset.cacheBytes = cacheBudget.cacheBytes;
  targetTileset.maximumCacheOverflowBytes = cacheBudget.overflowBytes;
  targetTileset.preloadWhenHidden = false;
  targetTileset.preloadFlightDestinations = false;
  tilesetWithInternalCulling.immediatelyLoadDesiredLevelOfDetail = false;
  tilesetWithInternalCulling.preferLeaves = false;
}

export function applyDebugSettingsLive({
  viewer,
  tileset,
  debugState,
  qualityPreset,
}: DebugLiveApplyArgs): void {
  if (!viewer) {
    return;
  }
  viewer.scene.fog.enabled = debugState.fogEnabled;
  applyDebugSettingsToTileset(debugState, tileset, qualityPreset);
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
