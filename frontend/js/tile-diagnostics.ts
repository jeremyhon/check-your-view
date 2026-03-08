import type { Cesium3DTileset } from "cesium";
import type { UiElements } from "./types";

type TileDiagnosticsState = {
  startedAtMs: number;
  pendingRequests: number;
  tilesProcessing: number;
  maxPendingRequests: number;
  maxTilesProcessing: number;
  loadProgressEvents: number;
  tileLoadEvents: number;
  tileUnloadEvents: number;
  tileFailedEvents: number;
  allTilesLoadedEvents: number;
  initialTilesLoadedEvents: number;
  cameraChangedEvents: number;
  cameraMoveStartEvents: number;
  cameraMoveEndEvents: number;
  lastProgressAtMs: number;
  lastCameraChangeAtMs: number;
  lastTileLoadAtMs: number;
  lastTileFailedUrl: string;
  lastTileFailedMessage: string;
  lastLogAtMs: number;
};

type TileDiagnosticsControllerOptions = {
  ui: UiElements;
  enabled: boolean;
  renderIntervalMs?: number;
  logIntervalMs?: number;
};

export type TileDiagnosticsController = {
  start: () => void;
  stop: () => void;
  onTilesetLoaded: (tileset: Cesium3DTileset) => void;
  onCameraChanged: () => void;
  onCameraMoveStart: () => void;
  onCameraMoveEnd: () => void;
  render: () => void;
};

const DEFAULT_RENDER_INTERVAL_MS = 350;
const DEFAULT_LOG_INTERVAL_MS = 3000;

function createDiagnosticsState(): TileDiagnosticsState {
  return {
    startedAtMs: performance.now(),
    pendingRequests: 0,
    tilesProcessing: 0,
    maxPendingRequests: 0,
    maxTilesProcessing: 0,
    loadProgressEvents: 0,
    tileLoadEvents: 0,
    tileUnloadEvents: 0,
    tileFailedEvents: 0,
    allTilesLoadedEvents: 0,
    initialTilesLoadedEvents: 0,
    cameraChangedEvents: 0,
    cameraMoveStartEvents: 0,
    cameraMoveEndEvents: 0,
    lastProgressAtMs: 0,
    lastCameraChangeAtMs: 0,
    lastTileLoadAtMs: 0,
    lastTileFailedUrl: "",
    lastTileFailedMessage: "",
    lastLogAtMs: 0,
  };
}

function secondsAgo(timestampMs: number, nowMs: number): string {
  if (!timestampMs) {
    return "-";
  }
  return `${((nowMs - timestampMs) / 1000).toFixed(1)}s`;
}

function toMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function createTileDiagnosticsController({
  ui,
  enabled,
  renderIntervalMs = DEFAULT_RENDER_INTERVAL_MS,
  logIntervalMs = DEFAULT_LOG_INTERVAL_MS,
}: TileDiagnosticsControllerOptions): TileDiagnosticsController {
  let tileset: Cesium3DTileset | null = null;
  let watchedTileset: Cesium3DTileset | null = null;
  let renderIntervalId: number | null = null;
  let cleanupFns: Array<() => void> = [];
  let diagnosticsState = createDiagnosticsState();

  function resetState(): void {
    diagnosticsState = createDiagnosticsState();
  }

  function detachTilesetEvents(): void {
    cleanupFns.forEach((cleanupFn) => {
      try {
        cleanupFn();
      } catch {
        // Ignore listener cleanup failures.
      }
    });
    cleanupFns = [];
    watchedTileset = null;
  }

  function maybeLog(targetTileset: Cesium3DTileset, nowMs: number): void {
    if (!enabled) {
      return;
    }
    if (nowMs - diagnosticsState.lastLogAtMs < logIntervalMs) {
      return;
    }
    diagnosticsState.lastLogAtMs = nowMs;
    if (
      diagnosticsState.pendingRequests === 0 &&
      diagnosticsState.tilesProcessing === 0 &&
      diagnosticsState.tileFailedEvents === 0
    ) {
      return;
    }
    const snapshot = {
      pendingRequests: diagnosticsState.pendingRequests,
      tilesProcessing: diagnosticsState.tilesProcessing,
      maxPendingRequests: diagnosticsState.maxPendingRequests,
      maxTilesProcessing: diagnosticsState.maxTilesProcessing,
      loadProgressEvents: diagnosticsState.loadProgressEvents,
      tileLoadEvents: diagnosticsState.tileLoadEvents,
      tileUnloadEvents: diagnosticsState.tileUnloadEvents,
      tileFailedEvents: diagnosticsState.tileFailedEvents,
      allTilesLoadedEvents: diagnosticsState.allTilesLoadedEvents,
      initialTilesLoadedEvents: diagnosticsState.initialTilesLoadedEvents,
      cameraChangedEvents: diagnosticsState.cameraChangedEvents,
      cameraMoveStartEvents: diagnosticsState.cameraMoveStartEvents,
      cameraMoveEndEvents: diagnosticsState.cameraMoveEndEvents,
      tilesLoaded: targetTileset.tilesLoaded,
      totalMemoryUsageInBytes: targetTileset.totalMemoryUsageInBytes,
      cacheBytes: targetTileset.cacheBytes,
      maximumCacheOverflowBytes: targetTileset.maximumCacheOverflowBytes,
      maximumScreenSpaceError: targetTileset.maximumScreenSpaceError,
      dynamicScreenSpaceError: targetTileset.dynamicScreenSpaceError,
      skipLevelOfDetail: targetTileset.skipLevelOfDetail,
      cullRequestsWhileMoving: targetTileset.cullRequestsWhileMoving,
      foveatedScreenSpaceError: targetTileset.foveatedScreenSpaceError,
      loadSiblings: targetTileset.loadSiblings,
      lastTileFailedUrl: diagnosticsState.lastTileFailedUrl,
      lastTileFailedMessage: diagnosticsState.lastTileFailedMessage,
    };
    console.log(`[diag] tiles ${JSON.stringify(snapshot)}`);
  }

  function render(): void {
    if (!enabled) {
      return;
    }
    const now = performance.now();
    if (!tileset) {
      ui.tileDiagnostics.textContent = "Waiting for tileset...";
      return;
    }
    const lines = [
      `uptime=${secondsAgo(diagnosticsState.startedAtMs, now)}`,
      `cameraChanged=${diagnosticsState.cameraChangedEvents} moveStart=${diagnosticsState.cameraMoveStartEvents} moveEnd=${diagnosticsState.cameraMoveEndEvents}`,
      `lastCameraChange=${secondsAgo(diagnosticsState.lastCameraChangeAtMs, now)}`,
      `pending=${diagnosticsState.pendingRequests} processing=${diagnosticsState.tilesProcessing} (max ${diagnosticsState.maxPendingRequests}/${diagnosticsState.maxTilesProcessing})`,
      `loadProgressEvents=${diagnosticsState.loadProgressEvents} lastProgress=${secondsAgo(diagnosticsState.lastProgressAtMs, now)}`,
      `tileLoad=${diagnosticsState.tileLoadEvents} tileUnload=${diagnosticsState.tileUnloadEvents} tileFailed=${diagnosticsState.tileFailedEvents} allLoaded=${diagnosticsState.allTilesLoadedEvents} initialLoaded=${diagnosticsState.initialTilesLoadedEvents}`,
      `lastTileLoad=${secondsAgo(diagnosticsState.lastTileLoadAtMs, now)}`,
      `tilesLoadedFlag=${tileset.tilesLoaded}`,
      `memory=${toMegabytes(tileset.totalMemoryUsageInBytes)} cache=${toMegabytes(tileset.cacheBytes)} + overflow=${toMegabytes(tileset.maximumCacheOverflowBytes)}`,
      `sse(max=${tileset.maximumScreenSpaceError}, dynamic=${String(tileset.dynamicScreenSpaceError)})`,
      `lod(skip=${String(tileset.skipLevelOfDetail)}, cullMoving=${String(tileset.cullRequestsWhileMoving)}, foveated=${String(tileset.foveatedScreenSpaceError)}, siblings=${String(tileset.loadSiblings)})`,
    ];
    if (diagnosticsState.lastTileFailedUrl) {
      lines.push(`lastFailUrl=${diagnosticsState.lastTileFailedUrl}`);
    }
    if (diagnosticsState.lastTileFailedMessage) {
      lines.push(`lastFailMessage=${diagnosticsState.lastTileFailedMessage}`);
    }
    ui.tileDiagnostics.textContent = lines.join("\n");
    maybeLog(tileset, now);
  }

  function attachTilesetEvents(targetTileset: Cesium3DTileset): void {
    if (!enabled) {
      return;
    }
    if (watchedTileset === targetTileset) {
      return;
    }
    detachTilesetEvents();
    watchedTileset = targetTileset;
    resetState();

    const removeLoadProgress = targetTileset.loadProgress.addEventListener(
      (numberOfPendingRequests: number, numberOfTilesProcessing: number) => {
        diagnosticsState.loadProgressEvents += 1;
        diagnosticsState.pendingRequests = numberOfPendingRequests;
        diagnosticsState.tilesProcessing = numberOfTilesProcessing;
        diagnosticsState.maxPendingRequests = Math.max(
          diagnosticsState.maxPendingRequests,
          numberOfPendingRequests,
        );
        diagnosticsState.maxTilesProcessing = Math.max(
          diagnosticsState.maxTilesProcessing,
          numberOfTilesProcessing,
        );
        diagnosticsState.lastProgressAtMs = performance.now();
      },
    ) as unknown as () => void;
    const removeTileLoad = targetTileset.tileLoad.addEventListener(() => {
      diagnosticsState.tileLoadEvents += 1;
      diagnosticsState.lastTileLoadAtMs = performance.now();
    }) as unknown as () => void;
    const removeTileUnload = targetTileset.tileUnload.addEventListener(() => {
      diagnosticsState.tileUnloadEvents += 1;
    }) as unknown as () => void;
    const removeTileFailed = targetTileset.tileFailed.addEventListener((error: unknown) => {
      diagnosticsState.tileFailedEvents += 1;
      if (typeof error === "object" && error !== null) {
        const details = error as { url?: unknown; message?: unknown };
        if (typeof details.url === "string") {
          diagnosticsState.lastTileFailedUrl = details.url;
        }
        if (typeof details.message === "string") {
          diagnosticsState.lastTileFailedMessage = details.message;
        }
      }
    }) as unknown as () => void;
    const removeAllTilesLoaded = targetTileset.allTilesLoaded.addEventListener(() => {
      diagnosticsState.allTilesLoadedEvents += 1;
    }) as unknown as () => void;
    const removeInitialTilesLoaded = targetTileset.initialTilesLoaded.addEventListener(() => {
      diagnosticsState.initialTilesLoadedEvents += 1;
    }) as unknown as () => void;

    cleanupFns = [
      removeLoadProgress,
      removeTileLoad,
      removeTileUnload,
      removeTileFailed,
      removeAllTilesLoaded,
      removeInitialTilesLoaded,
    ];
  }

  function markCameraChange(): void {
    diagnosticsState.lastCameraChangeAtMs = performance.now();
  }

  function onCameraChanged(): void {
    if (!enabled) {
      return;
    }
    diagnosticsState.cameraChangedEvents += 1;
    markCameraChange();
  }

  function onCameraMoveStart(): void {
    if (!enabled) {
      return;
    }
    diagnosticsState.cameraMoveStartEvents += 1;
    markCameraChange();
  }

  function onCameraMoveEnd(): void {
    if (!enabled) {
      return;
    }
    diagnosticsState.cameraMoveEndEvents += 1;
    markCameraChange();
  }

  function onTilesetLoaded(targetTileset: Cesium3DTileset): void {
    tileset = targetTileset;
    attachTilesetEvents(targetTileset);
    render();
  }

  function start(): void {
    if (!enabled) {
      return;
    }
    if (renderIntervalId !== null) {
      return;
    }
    renderIntervalId = window.setInterval(() => {
      render();
    }, renderIntervalMs);
    render();
  }

  function stop(): void {
    if (renderIntervalId !== null) {
      window.clearInterval(renderIntervalId);
      renderIntervalId = null;
    }
    detachTilesetEvents();
  }

  return {
    start,
    stop,
    onTilesetLoaded,
    onCameraChanged,
    onCameraMoveStart,
    onCameraMoveEnd,
    render,
  };
}
