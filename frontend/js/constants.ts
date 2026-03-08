import type { BoundsLimits, DebugState, SingaporeBounds, ViewState } from "./types";

const runtimeConfig = window.CHECK_YOUR_VIEW_CONFIG || {};

export const defaultProxyBase = runtimeConfig.proxyBase || "http://localhost:8787";
export const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
export const isMobileClient =
  (typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 960px), (pointer: coarse)").matches) ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
export const debugUiEnabled = new URLSearchParams(window.location.search).get("debug") === "1";
export const DISABLE_3D_OPTIMIZATIONS = true;
export const defaultMaxSse = DISABLE_3D_OPTIMIZATIONS ? 8 : isMobileClient ? 64 : 4;
export const CAMERA_FAR_METERS = 2_000_000;
export const PANEL_COLLAPSE_STORAGE_KEY = "check-your-view:panel-collapsed";

export const SINGAPORE_RECTANGLE_DEGREES = {
  west: 103.55,
  south: 1.15,
  east: 104.1,
  north: 1.5,
};

export const SINGAPORE_BOUNDS: SingaporeBounds = [
  [SINGAPORE_RECTANGLE_DEGREES.south, SINGAPORE_RECTANGLE_DEGREES.west],
  [SINGAPORE_RECTANGLE_DEGREES.north, SINGAPORE_RECTANGLE_DEGREES.east],
];

export const SG_LIMITS: BoundsLimits = {
  minLat: SINGAPORE_RECTANGLE_DEGREES.south,
  maxLat: SINGAPORE_RECTANGLE_DEGREES.north,
  minLng: SINGAPORE_RECTANGLE_DEGREES.west,
  maxLng: SINGAPORE_RECTANGLE_DEGREES.east,
};

export const DEFAULTS: ViewState = {
  proxy_base: defaultProxyBase,
  lat: 1.284048,
  lng: 103.860691,
  height_m: 196,
  floor_level: 65.33,
  floor_height_m: 3,
  heading_deg: -85.6,
  pitch_deg: -15.8,
  fov_deg: 60,
  base_map: "OrthoJPG",
};

export const DEBUG_DEFAULTS: DebugState = DISABLE_3D_OPTIMIZATIONS
  ? {
      fogEnabled: !isLocalHost,
      dynamicScreenSpaceError: false,
      maximumScreenSpaceError: defaultMaxSse,
      skipLevelOfDetail: false,
      cullWithChildrenBounds: false,
      cullRequestsWhileMoving: false,
      cullRequestsWhileMovingMultiplier: 1,
      loadSiblings: false,
      foveatedScreenSpaceError: false,
    }
  : isLocalHost
    ? {
        fogEnabled: false,
        dynamicScreenSpaceError: false,
        maximumScreenSpaceError: defaultMaxSse,
        skipLevelOfDetail: true,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: false,
        cullRequestsWhileMovingMultiplier: 12,
        loadSiblings: true,
        foveatedScreenSpaceError: true,
      }
    : {
        fogEnabled: true,
        dynamicScreenSpaceError: true,
        maximumScreenSpaceError: defaultMaxSse,
        skipLevelOfDetail: true,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: true,
        cullRequestsWhileMovingMultiplier: 12,
        loadSiblings: false,
        foveatedScreenSpaceError: true,
      };
