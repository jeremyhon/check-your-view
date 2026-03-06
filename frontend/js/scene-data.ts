/* global Cesium */

export function createSceneDataController({
  viewer,
  state,
  singaporeRectangle,
  debugState,
  applyDebugSettingsToTileset,
  onTilesetLoaded,
}) {
  let tileset;
  let loadedDataKey = "";

  function baseMapUrl() {
    return `${state.proxy_base}/maps/tiles/${state.base_map}/{z}/{x}/{y}.png`;
  }

  function refreshBasemapLayer() {
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

  async function loadTileset() {
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

  async function ensureSceneDataLoaded(force = false) {
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
