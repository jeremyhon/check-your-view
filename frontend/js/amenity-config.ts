import type { AmenityCategoryId } from "./types";

export type AmenityCategoryConfig = {
  label: string;
  color: string;
  radiusM: number;
  baseLimit: number;
  defaultEnabled: boolean;
};

export const AMENITY_CATEGORY_ORDER: AmenityCategoryId[] = [
  "mrt_lrt",
  "shopping_malls",
  "primary_schools",
  "preschools",
  "supermarkets_wet_markets",
  "hawker_food_courts",
];

export const AMENITY_CATEGORY_CONFIG: Record<AmenityCategoryId, AmenityCategoryConfig> = {
  mrt_lrt: {
    label: "MRT / LRT",
    color: "#0b5cab",
    radiusM: 6500,
    baseLimit: 28,
    defaultEnabled: true,
  },
  shopping_malls: {
    label: "Shopping Malls",
    color: "#0a7a52",
    radiusM: 5500,
    baseLimit: 24,
    defaultEnabled: true,
  },
  primary_schools: {
    label: "Primary Schools",
    color: "#8c2d75",
    radiusM: 4500,
    baseLimit: 30,
    defaultEnabled: true,
  },
  preschools: {
    label: "Preschools",
    color: "#cf5f16",
    radiusM: 3500,
    baseLimit: 18,
    defaultEnabled: false,
  },
  supermarkets_wet_markets: {
    label: "Supermarkets / Wet Markets",
    color: "#5e5ce6",
    radiusM: 3200,
    baseLimit: 20,
    defaultEnabled: false,
  },
  hawker_food_courts: {
    label: "Hawker / Food Courts",
    color: "#aa3a4f",
    radiusM: 3200,
    baseLimit: 20,
    defaultEnabled: false,
  },
};
