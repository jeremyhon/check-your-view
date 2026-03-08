import { AMENITY_CATEGORY_CONFIG, AMENITY_CATEGORY_ORDER } from "./amenity-config";
import type { AmenityCategoryId, UiElements } from "./types";

export function getAmenityToggleMap(ui: UiElements): Record<AmenityCategoryId, HTMLInputElement> {
  return {
    mrt_lrt: ui.amenityToggleMrtLrt,
    shopping_malls: ui.amenityToggleShoppingMalls,
    primary_schools: ui.amenityTogglePrimarySchools,
    preschools: ui.amenityTogglePreschools,
    supermarkets_wet_markets: ui.amenityToggleSupermarketsWetMarkets,
    hawker_food_courts: ui.amenityToggleHawkerFoodCourts,
  };
}

export function syncAmenityToggleLabels(ui: UiElements): void {
  const toggleMap = getAmenityToggleMap(ui);
  for (const category of AMENITY_CATEGORY_ORDER) {
    const toggle = toggleMap[category];
    const labelText = AMENITY_CATEGORY_CONFIG[category].label;
    const labelSpan = toggle.closest("label")?.querySelector("span");
    if (labelSpan) {
      labelSpan.textContent = labelText;
    }
  }
}
