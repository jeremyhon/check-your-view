import { syncDebugInputsFromState } from "../debug-controls";
import { clamp, normalizeDeg, parseNumber } from "../utils";
import {
  floorLevelFromHeight,
  heightFromFloor,
  isWithinBounds,
  sanitizeFloorHeight,
} from "../pose-state";
import type {
  BoundsLimits,
  CompassOverlayController,
  DebugState,
  FloorSyncMode,
  LocationController,
  UiElements,
  ViewState,
} from "../types";

type InitStateSyncOptions = {
  ui: UiElements;
  state: ViewState;
  debugState: DebugState;
  defaults: ViewState;
  boundsLimits: BoundsLimits;
  debugUiEnabled: boolean;
  compassOverlayController: CompassOverlayController;
  locationController: LocationController;
};

export type StateSyncController = {
  syncPositionInputsFromState: () => void;
  syncInputsFromState: () => void;
  readStateFromInputs: () => void;
  updateInputAngles: () => void;
  syncHeightFromFloorInputs: () => void;
  syncFloorFromHeightInput: () => void;
};

export function initStateSync({
  ui,
  state,
  debugState,
  defaults,
  boundsLimits,
  debugUiEnabled,
  compassOverlayController,
  locationController,
}: InitStateSyncOptions): StateSyncController {
  function syncPositionInputsFromState(): void {
    ui.lat.value = state.lat.toFixed(6);
    ui.lng.value = state.lng.toFixed(6);
  }

  function syncFloorAndHeightFromInputs(mode: FloorSyncMode): void {
    state.floor_height_m = sanitizeFloorHeight(ui.floorHeightM.value, defaults.floor_height_m);
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

  function syncInputsFromState(): void {
    syncPositionInputsFromState();
    ui.floorLevel.value = state.floor_level.toFixed(2);
    ui.floorHeightM.value = state.floor_height_m.toFixed(2);
    ui.heightM.value = String(state.height_m);
    ui.fovDeg.value = String(state.fov_deg);
    ui.headingDeg.value = String(state.heading_deg);
    ui.pitchDeg.value = String(state.pitch_deg);
    compassOverlayController.syncHeading(state.heading_deg);
    syncDebugInputsFromState(ui, debugState, debugUiEnabled);
  }

  function readStateFromInputs(): void {
    state.lat = parseNumber(ui.lat.value, state.lat);
    state.lng = parseNumber(ui.lng.value, state.lng);
    if (!isWithinBounds(state.lat, state.lng, boundsLimits)) {
      state.lat = defaults.lat;
      state.lng = defaults.lng;
    }
    syncFloorAndHeightFromInputs("height");
    state.fov_deg = clamp(parseNumber(ui.fovDeg.value, state.fov_deg), 20, 120);
    state.heading_deg = normalizeDeg(parseNumber(ui.headingDeg.value, state.heading_deg));
    state.pitch_deg = clamp(parseNumber(ui.pitchDeg.value, state.pitch_deg), -89, 89);
  }

  function updateInputAngles(): void {
    ui.headingDeg.value = state.heading_deg.toFixed(1);
    ui.pitchDeg.value = state.pitch_deg.toFixed(1);
    compassOverlayController.syncHeading(state.heading_deg);
    locationController.syncMiniMapFromState();
  }

  return {
    syncPositionInputsFromState,
    syncInputsFromState,
    readStateFromInputs,
    updateInputAngles,
    syncHeightFromFloorInputs: () => {
      syncFloorAndHeightFromInputs("floor");
    },
    syncFloorFromHeightInput: () => {
      syncFloorAndHeightFromInputs("height");
    },
  };
}
