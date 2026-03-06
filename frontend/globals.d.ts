type RuntimeConfig = {
  proxyBase?: string;
};

declare global {
  const Cesium: typeof import("cesium");
  const L: typeof import("leaflet");

  interface Window {
    CHECK_YOUR_VIEW_CONFIG?: RuntimeConfig;
    __viewer?: unknown;
    __tileset?: unknown;
  }
}

export {};
