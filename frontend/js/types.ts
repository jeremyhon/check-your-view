import type { Cesium3DTileset } from "cesium";

export interface ViewState {
  proxy_base: string;
  lat: number;
  lng: number;
  zoom_pct: number;
  height_m: number;
  floor_level: number;
  floor_height_m: number;
  heading_deg: number;
  pitch_deg: number;
  fov_deg: number;
}

export interface DebugState {
  fogEnabled: boolean;
  dynamicScreenSpaceError: boolean;
  maximumScreenSpaceError: number;
  skipLevelOfDetail: boolean;
  cullWithChildrenBounds: boolean;
  cullRequestsWhileMoving: boolean;
  cullRequestsWhileMovingMultiplier: number;
  loadSiblings: boolean;
  foveatedScreenSpaceError: boolean;
}

export type QualityPreset = "ultra" | "high" | "medium" | "low";

export interface BoundsLimits {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type SingaporeBounds = [[number, number], [number, number]];

export interface LocationLike {
  origin: string;
  pathname: string;
}

export interface OneMapSearchResult {
  LATITUDE?: string;
  LONGITUDE?: string;
  SEARCHVAL?: string;
  ADDRESS?: string;
}

export interface OneMapSearchPayload {
  results?: OneMapSearchResult[];
}

export interface UiElements {
  compassTrack: HTMLElement;
  compassReadout: HTMLElement;
  zoomResetBtn: HTMLButtonElement;
  indoorStatusBadge: HTMLElement;
  tileDiagnostics: HTMLElement;
  miniMap: HTMLElement;
  miniMapInstruction: HTMLElement;
  lat: HTMLInputElement;
  lng: HTMLInputElement;
  searchInput: HTMLInputElement;
  searchResults: HTMLElement;
  floorLevel: HTMLInputElement;
  floorHeightM: HTMLInputElement;
  heightM: HTMLInputElement;
  qualityPreset: HTMLSelectElement;
  fovDeg: HTMLInputElement;
  headingDeg: HTMLInputElement;
  pitchDeg: HTMLInputElement;
  debugPanel: HTMLDetailsElement;
  debugFogEnabled: HTMLInputElement;
  debugDynamicSse: HTMLInputElement;
  debugSkipLod: HTMLInputElement;
  debugFoveatedSse: HTMLInputElement;
  debugCullWithChildren: HTMLInputElement;
  debugCullWhileMoving: HTMLInputElement;
  debugLoadSiblings: HTMLInputElement;
  debugMaxSse: HTMLInputElement;
  debugCullMultiplier: HTMLInputElement;
  panelCloseBtn: HTMLButtonElement;
  panelOpenBtn: HTMLButtonElement;
  applyBtn: HTMLButtonElement;
  copyBtn: HTMLButtonElement;
  status: HTMLElement;
}

export interface CompassOverlayController {
  syncHeading(headingDeg: number): void;
}

export interface PanelController {
  bindPanelToggleButtons(): void;
  initializePanelCollapsedState(): void;
}

export interface LocationController {
  bindSearchControls(): void;
  initializeMiniMap(): void;
  invalidateMiniMap(): void;
  syncMiniMapFromState(recenter?: boolean): void;
}

export interface CameraController {
  applyFixedPose(): void;
  installOrientationDrag(): void;
  lockPositionControls(): void;
  installZoomControls(): void;
  resetZoom(): void;
}

export interface SceneDataController {
  ensureSceneDataLoaded(force?: boolean): Promise<void>;
  getTileset(): Cesium3DTileset | undefined;
}

export type FloorSyncMode = "floor" | "height";

export type DebugControlId =
  | "debugFogEnabled"
  | "debugDynamicSse"
  | "debugSkipLod"
  | "debugFoveatedSse"
  | "debugCullWithChildren"
  | "debugCullWhileMoving"
  | "debugLoadSiblings"
  | "debugMaxSse"
  | "debugCullMultiplier";
