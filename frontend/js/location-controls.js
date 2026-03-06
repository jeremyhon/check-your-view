/* global L */

import { parseNumber } from "./utils.js";

export function createLocationController({
  ui,
  state,
  singaporeBounds,
  isWithinSingapore,
  setStatus,
  onLocationChanged,
}) {
  let miniMap;
  let miniMarker;
  let searchDebounceId = null;
  let searchAbortController = null;

  function miniMapBaseUrl() {
    return `${state.proxy_base}/maps/tiles/DefaultRoad/{z}/{x}/{y}.png`;
  }

  function syncMiniMapFromState(recenter = false) {
    if (!miniMap || !miniMarker) {
      return;
    }
    const center = [state.lat, state.lng];
    miniMarker.setLatLng(center);
    if (recenter) {
      miniMap.setView(center, miniMap.getZoom(), { animate: false });
    }
  }

  function clearSearchResults() {
    ui.searchResults.innerHTML = "";
    ui.searchResults.classList.remove("visible");
  }

  function updateLocation(lat, lng, message) {
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

  function updateLocationFromMiniMap(lat, lng) {
    updateLocation(lat, lng, "Location updated from mini map.");
  }

  function initializeMiniMap() {
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

    miniMap.setView([state.lat, state.lng], 15);
    miniMarker = L.marker([state.lat, state.lng], { draggable: true }).addTo(miniMap);

    miniMap.on("click", (event) => {
      const { lat, lng } = event.latlng;
      miniMarker.setLatLng([lat, lng]);
      updateLocationFromMiniMap(lat, lng);
    });

    miniMarker.on("dragend", () => {
      const { lat, lng } = miniMarker.getLatLng();
      updateLocationFromMiniMap(lat, lng);
    });

    window.setTimeout(() => miniMap.invalidateSize(), 0);
  }

  function handleSearchSelect(result) {
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

  function renderSearchResults(results) {
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

  async function runLocationSearch(query) {
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
      const payload = await response.json();
      const results = Array.isArray(payload.results) ? payload.results : [];
      renderSearchResults(results);
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      clearSearchResults();
      setStatus(`Search failed: ${error.message}`, true);
    }
  }

  function bindSearchControls() {
    ui.searchInput.addEventListener("input", (event) => {
      const query = event.target.value.trim();
      if (searchDebounceId) {
        window.clearTimeout(searchDebounceId);
      }
      searchDebounceId = window.setTimeout(() => {
        void runLocationSearch(query);
      }, 250);
    });
    ui.searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      const first = ui.searchResults.querySelector(".search-result-item:not([disabled])");
      if (first) {
        first.click();
        event.preventDefault();
      }
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (target === ui.searchInput || ui.searchResults.contains(target)) {
        return;
      }
      clearSearchResults();
    });
  }

  function invalidateMiniMap() {
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
