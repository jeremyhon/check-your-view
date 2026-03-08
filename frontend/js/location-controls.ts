/* global L */

import { parseNumber } from "./utils";
import type { LeafletMouseEvent, Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import type {
  LocationController,
  OneMapSearchPayload,
  OneMapSearchResult,
  SingaporeBounds,
  UiElements,
  ViewState,
} from "./types";

type LocationControllerOptions = {
  ui: UiElements;
  state: ViewState;
  singaporeBounds: SingaporeBounds;
  isWithinSingapore: (lat: number, lng: number) => boolean;
  setStatus: (message: string, isError?: boolean) => void;
  onLocationChanged?: () => void;
};

export function createLocationController({
  ui,
  state,
  singaporeBounds,
  isWithinSingapore,
  setStatus,
  onLocationChanged,
}: LocationControllerOptions): LocationController {
  let miniMap: LeafletMap | null = null;
  let miniMarker: LeafletMarker | null = null;
  let searchDebounceId: number | null = null;
  let searchAbortController: AbortController | null = null;

  function miniMapBaseUrl(): string {
    return `${state.proxy_base}/maps/tiles/Default/{z}/{x}/{y}.png`;
  }

  function syncMiniMapFromState(recenter = false): void {
    if (!miniMap || !miniMarker) {
      return;
    }
    const center: [number, number] = [state.lat, state.lng];
    miniMarker.setLatLng(center);
    if (recenter) {
      miniMap.setView(center, miniMap.getZoom(), { animate: false });
    }
  }

  function clearSearchResults(): void {
    ui.searchResults.innerHTML = "";
    ui.searchResults.classList.remove("visible");
  }

  function updateLocation(lat: number, lng: number, message: string): void {
    state.lat = lat;
    state.lng = lng;
    ui.lat.value = lat.toFixed(6);
    ui.lng.value = lng.toFixed(6);
    syncMiniMapFromState(true);
    if (typeof onLocationChanged === "function") {
      onLocationChanged();
    }
    setStatus(message);
  }

  function updateLocationFromMiniMap(lat: number, lng: number): void {
    updateLocation(lat, lng, "Location updated from mini map.");
  }

  function initializeMiniMap(): void {
    if (typeof L === "undefined" || !ui.miniMap) {
      setStatus("Mini map failed to load.", true);
      return;
    }
    miniMap = L.map(ui.miniMap, {
      zoomControl: true,
      attributionControl: false,
      minZoom: 11,
      maxZoom: 19,
    });
    miniMap.setMaxBounds(singaporeBounds);

    L.tileLayer(miniMapBaseUrl(), {
      minZoom: 11,
      maxZoom: 19,
      bounds: singaporeBounds,
      noWrap: true,
    }).addTo(miniMap);

    miniMap.setView([state.lat, state.lng], 17);
    miniMarker = L.marker([state.lat, state.lng], { draggable: true }).addTo(miniMap);

    miniMap.on("click", (event: LeafletMouseEvent) => {
      if (!miniMarker) {
        return;
      }
      const { lat, lng } = event.latlng;
      miniMarker.setLatLng([lat, lng]);
      updateLocationFromMiniMap(lat, lng);
    });

    miniMarker.on("dragend", () => {
      if (!miniMarker) {
        return;
      }
      const { lat, lng } = miniMarker.getLatLng();
      updateLocationFromMiniMap(lat, lng);
    });

    const currentMiniMap = miniMap;
    window.setTimeout(() => currentMiniMap.invalidateSize(), 0);
  }

  function handleSearchSelect(result: OneMapSearchResult): void {
    const lat = parseNumber(result.LATITUDE, state.lat);
    const lng = parseNumber(result.LONGITUDE, state.lng);
    if (!isWithinSingapore(lat, lng)) {
      setStatus("Search result is outside supported Singapore bounds.", true);
      return;
    }
    const label = result.SEARCHVAL || result.ADDRESS || "selected location";
    ui.searchInput.value = label;
    clearSearchResults();
    updateLocation(lat, lng, `Moved to: ${label}`);
  }

  function renderSearchResults(results: OneMapSearchResult[]): void {
    ui.searchResults.innerHTML = "";
    if (results.length === 0) {
      const empty = document.createElement("button");
      empty.className = "search-result-item";
      empty.type = "button";
      empty.textContent = "No results";
      empty.disabled = true;
      ui.searchResults.appendChild(empty);
      ui.searchResults.classList.add("visible");
      return;
    }

    results.slice(0, 8).forEach((result) => {
      const button = document.createElement("button");
      button.className = "search-result-item";
      button.type = "button";
      const title = result.SEARCHVAL || result.ADDRESS || "Unnamed result";
      const subtitle = result.ADDRESS && result.ADDRESS !== title ? ` - ${result.ADDRESS}` : "";
      button.textContent = `${title}${subtitle}`;
      button.addEventListener("click", () => handleSearchSelect(result));
      ui.searchResults.appendChild(button);
    });
    ui.searchResults.classList.add("visible");
  }

  async function runLocationSearch(query: string): Promise<void> {
    if (query.length < 2) {
      clearSearchResults();
      return;
    }

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    const url = `${state.proxy_base}/api/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    try {
      const response = await fetch(url, { signal: searchAbortController.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as OneMapSearchPayload;
      const results = Array.isArray(payload.results) ? payload.results : [];
      renderSearchResults(results);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      clearSearchResults();
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Search failed: ${message}`, true);
    }
  }

  function bindSearchControls(): void {
    ui.searchInput.addEventListener("input", (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const query = target.value.trim();
      if (searchDebounceId) {
        window.clearTimeout(searchDebounceId);
      }
      searchDebounceId = window.setTimeout(() => {
        void runLocationSearch(query);
      }, 250);
    });
    ui.searchInput.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }
      const first = ui.searchResults.querySelector(".search-result-item:not([disabled])");
      if (first instanceof HTMLButtonElement) {
        first.click();
        event.preventDefault();
      }
    });
    document.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (target === ui.searchInput || ui.searchResults.contains(target))) {
        return;
      }
      clearSearchResults();
    });
  }

  function invalidateMiniMap(): void {
    if (miniMap) {
      miniMap.invalidateSize();
    }
  }

  return {
    bindSearchControls,
    initializeMiniMap,
    invalidateMiniMap,
    syncMiniMapFromState,
  };
}
