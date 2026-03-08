import type { Viewer } from "cesium";
import type {
  AmenityCategoryId,
  AmenityDataset,
  AmenityLayerController,
  AmenityPoint,
  UiElements,
  ViewState,
} from "./types";

type AmenityLayerOptions = {
  viewer: Viewer;
  ui: UiElements;
  state: ViewState;
  setStatus: (message: string, isError?: boolean) => void;
};

type CategoryRenderConfig = {
  label: string;
  color: string;
  radiusM: number;
  baseLimit: number;
  minZoomPct: number;
};

const CATEGORY_ORDER: AmenityCategoryId[] = [
  "mrt_lrt",
  "shopping_malls",
  "primary_schools",
  "preschools",
  "supermarkets_wet_markets",
  "hawker_food_courts",
];

const CATEGORY_RENDER_CONFIG: Record<AmenityCategoryId, CategoryRenderConfig> = {
  mrt_lrt: {
    label: "MRT/LRT",
    color: "#0b5cab",
    radiusM: 6500,
    baseLimit: 28,
    minZoomPct: 100,
  },
  shopping_malls: {
    label: "Shopping Malls",
    color: "#0a7a52",
    radiusM: 5500,
    baseLimit: 24,
    minZoomPct: 100,
  },
  primary_schools: {
    label: "Primary Schools",
    color: "#8c2d75",
    radiusM: 4500,
    baseLimit: 30,
    minZoomPct: 100,
  },
  preschools: {
    label: "Preschools",
    color: "#cf5f16",
    radiusM: 3500,
    baseLimit: 18,
    minZoomPct: 140,
  },
  supermarkets_wet_markets: {
    label: "Supermarkets / Wet Markets",
    color: "#5e5ce6",
    radiusM: 3200,
    baseLimit: 20,
    minZoomPct: 150,
  },
  hawker_food_courts: {
    label: "Hawker / Food Courts",
    color: "#aa3a4f",
    radiusM: 3200,
    baseLimit: 20,
    minZoomPct: 170,
  },
};

const DEFAULT_CATEGORY_ENABLED: Record<AmenityCategoryId, boolean> = {
  mrt_lrt: true,
  shopping_malls: true,
  primary_schools: true,
  preschools: false,
  supermarkets_wet_markets: false,
  hawker_food_courts: false,
};

const TOGGLE_STORAGE_KEY = "check-your-view:amenity-toggles";
const STATIC_DATASET_PATH = "/data/amenities/osm-amenities-latest.json";

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function parseDataset(payload: unknown): AmenityPoint[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = payload as AmenityDataset;
  if (!Array.isArray(data.amenities)) {
    return [];
  }
  const validCategories = new Set<AmenityCategoryId>(CATEGORY_ORDER);
  return data.amenities.filter((item): item is AmenityPoint => {
    if (!item || typeof item !== "object") {
      return false;
    }
    if (typeof item.id !== "string" || typeof item.name !== "string") {
      return false;
    }
    if (typeof item.lat !== "number" || typeof item.lng !== "number") {
      return false;
    }
    return validCategories.has(item.category);
  });
}

function zoomLimitMultiplier(zoomPct: number): number {
  if (zoomPct >= 260) {
    return 2.1;
  }
  if (zoomPct >= 200) {
    return 1.7;
  }
  if (zoomPct >= 150) {
    return 1.35;
  }
  return 1;
}

export function createAmenityLayer({
  viewer,
  ui,
  state,
  setStatus,
}: AmenityLayerOptions): AmenityLayerController {
  const dataSource = new Cesium.CustomDataSource("amenity-labels");
  const amenitiesByCategory = new Map<AmenityCategoryId, AmenityPoint[]>();
  let loaded = false;
  let loadAttempted = false;
  let cameraMoveEndCleanup: (() => void) | null = null;

  function toggleMap(): Record<AmenityCategoryId, HTMLInputElement> {
    return {
      mrt_lrt: ui.amenityToggleMrtLrt,
      shopping_malls: ui.amenityToggleShoppingMalls,
      primary_schools: ui.amenityTogglePrimarySchools,
      preschools: ui.amenityTogglePreschools,
      supermarkets_wet_markets: ui.amenityToggleSupermarketsWetMarkets,
      hawker_food_courts: ui.amenityToggleHawkerFoodCourts,
    };
  }

  function loadTogglePreferences(): void {
    const toggles = toggleMap();
    const defaults = { ...DEFAULT_CATEGORY_ENABLED };
    try {
      const raw = localStorage.getItem(TOGGLE_STORAGE_KEY);
      if (!raw) {
        for (const category of CATEGORY_ORDER) {
          toggles[category].checked = defaults[category];
        }
        return;
      }
      const parsed = JSON.parse(raw) as Partial<Record<AmenityCategoryId, boolean>>;
      for (const category of CATEGORY_ORDER) {
        const value = parsed[category];
        toggles[category].checked = typeof value === "boolean" ? value : defaults[category];
      }
    } catch {
      for (const category of CATEGORY_ORDER) {
        toggles[category].checked = defaults[category];
      }
    }
  }

  function persistTogglePreferences(): void {
    const toggles = toggleMap();
    const payload: Partial<Record<AmenityCategoryId, boolean>> = {};
    for (const category of CATEGORY_ORDER) {
      payload[category] = toggles[category].checked;
    }
    try {
      localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }
  }

  function enabledCategories(): AmenityCategoryId[] {
    const toggles = toggleMap();
    return CATEGORY_ORDER.filter((category) => toggles[category].checked);
  }

  async function fetchDataset(): Promise<AmenityPoint[]> {
    const candidates = [`${state.proxy_base}/api/amenities`, STATIC_DATASET_PATH];
    for (const url of candidates) {
      try {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) {
          continue;
        }
        const payload = (await response.json()) as unknown;
        const points = parseDataset(payload);
        if (points.length > 0) {
          return points;
        }
      } catch {
        // Try next source.
      }
    }
    return [];
  }

  function setSummary(text: string): void {
    ui.amenitySummary.textContent = text;
  }

  function renderCategoryAmenities(category: AmenityCategoryId): number {
    const config = CATEGORY_RENDER_CONFIG[category];
    if (state.zoom_pct < config.minZoomPct) {
      return 0;
    }
    const points = amenitiesByCategory.get(category) || [];
    if (points.length === 0) {
      return 0;
    }
    const multiplier = zoomLimitMultiplier(state.zoom_pct);
    const limit = Math.max(1, Math.round(config.baseLimit * multiplier));
    const nearby = points
      .map((point) => ({
        point,
        distanceM: haversineMeters(state.lat, state.lng, point.lat, point.lng),
      }))
      .filter((row) => row.distanceM <= config.radiusM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, limit);

    const color = Cesium.Color.fromCssColorString(config.color);
    const background = color.withAlpha(0.78);
    nearby.forEach(({ point }) => {
      dataSource.entities.add({
        id: `amenity:${point.id}`,
        position: Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 1),
        point: {
          pixelSize: 6,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: point.name,
          font: "12px 'Segoe UI', sans-serif",
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          showBackground: true,
          backgroundColor: background,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });
    return nearby.length;
  }

  function refresh(): void {
    if (!loaded) {
      return;
    }
    dataSource.entities.removeAll();
    const enabled = enabledCategories();
    if (enabled.length === 0) {
      setSummary("Amenity labels disabled.");
      viewer.scene.requestRender();
      return;
    }

    let totalVisible = 0;
    for (const category of enabled) {
      totalVisible += renderCategoryAmenities(category);
    }
    const summaryPrefix = `Showing ${totalVisible} labels`;
    const enabledLabels = enabled
      .map((category) => CATEGORY_RENDER_CONFIG[category].label)
      .join(", ");
    setSummary(`${summaryPrefix} (${enabledLabels})`);
    viewer.scene.requestRender();
  }

  function bindToggleControls(): void {
    loadTogglePreferences();
    const toggles = toggleMap();
    for (const category of CATEGORY_ORDER) {
      toggles[category].addEventListener("change", () => {
        persistTogglePreferences();
        refresh();
      });
    }
  }

  async function initialize(): Promise<void> {
    if (!viewer.dataSources.contains(dataSource)) {
      await viewer.dataSources.add(dataSource);
    }
    if (!cameraMoveEndCleanup) {
      cameraMoveEndCleanup = viewer.camera.moveEnd.addEventListener(() => {
        refresh();
      }) as unknown as () => void;
    }
    if (loadAttempted) {
      refresh();
      return;
    }
    loadAttempted = true;
    const points = await fetchDataset();
    if (points.length === 0) {
      setSummary("Amenity dataset unavailable.");
      setStatus("Amenity labels unavailable: dataset endpoint returned no data.", true);
      return;
    }
    for (const category of CATEGORY_ORDER) {
      amenitiesByCategory.set(
        category,
        points.filter((point) => point.category === category),
      );
    }
    loaded = true;
    setSummary(`Amenity dataset loaded (${points.length} points).`);
    refresh();
  }

  return {
    bindToggleControls,
    initialize,
    refresh,
  };
}
