/* global Cesium */

import type { Cesium3DTileset, Rectangle, Viewer } from "cesium";
import type { DebugState, SceneDataController, ViewState } from "./types";

type SceneDataControllerOptions = {
  viewer: Viewer;
  state: ViewState;
  singaporeRectangle: Rectangle;
  debugState: DebugState;
  applyDebugSettingsToTileset: (
    debugState: DebugState,
    targetTileset?: Cesium3DTileset | null,
  ) => void;
  onTilesetLoaded?: (tileset: Cesium3DTileset) => void;
};

export function createSceneDataController({
  viewer,
  state,
  singaporeRectangle,
  debugState,
  applyDebugSettingsToTileset,
  onTilesetLoaded,
}: SceneDataControllerOptions): SceneDataController {
  let tileset: Cesium3DTileset | undefined;
  let loadedDataKey = "";

  function baseMapUrl(): string {
    return `${state.proxy_base}/maps/tiles/${state.base_map}/{z}/{x}/{y}.png`;
  }

  function refreshBasemapLayer(): void {
    viewer.imageryLayers.removeAll(true);
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: baseMapUrl(),
      rectangle: singaporeRectangle,
      minimumLevel: 11,
      maximumLevel: 19,
      credit: "OneMap",
    });
    viewer.imageryLayers.addImageryProvider(provider);
  }

  async function loadTileset(): Promise<void> {
    if (tileset) {
      viewer.scene.primitives.remove(tileset);
    }
    const url = `${state.proxy_base}/omapi/tilesets/sg_noterrain_tiles/tileset.json`;
    tileset = await Cesium.Cesium3DTileset.fromUrl(url);
    applyDebugSettingsToTileset(debugState, tileset);
    viewer.scene.primitives.add(tileset);
    if (typeof onTilesetLoaded === "function") {
      onTilesetLoaded(tileset);
    }
  }

  async function ensureSceneDataLoaded(force = false): Promise<void> {
    const dataKey = `${state.proxy_base}|${state.base_map}`;
    if (!force && dataKey === loadedDataKey && tileset) {
      return;
    }
    refreshBasemapLayer();
    await loadTileset();
    loadedDataKey = dataKey;
  }

  return {
    ensureSceneDataLoaded,
    getTileset: () => tileset,
  };
}
