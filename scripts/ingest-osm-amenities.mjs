#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const DEFAULT_OUT_PATH = process.env.AMENITIES_OUT || "data/amenities/osm-amenities-latest.json";
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 120_000;
const REQUEST_GAP_MS = 600;

const CATEGORY_CONFIGS = [
  {
    id: "mrt_lrt",
    label: "MRT/LRT",
    description: "Rail station labels sourced from OSM rail/public transport station features.",
    clauses: [
      'node["railway"="station"](area.sg);',
      'way["railway"="station"](area.sg);',
      'relation["railway"="station"](area.sg);',
      'node["public_transport"="station"](area.sg);',
      'way["public_transport"="station"](area.sg);',
      'relation["public_transport"="station"](area.sg);',
    ],
    include: (tags) => {
      const name = normalizeTag(tags.name);
      if (!name) {
        return false;
      }
      if (/\bMRT\b|\bLRT\b/i.test(name)) {
        return true;
      }
      const stationType = normalizeTag(tags.station).toLowerCase();
      if (stationType === "subway" || stationType === "light_rail") {
        return true;
      }
      const railway = normalizeTag(tags.railway).toLowerCase();
      return railway === "station" && /\bSTATION\b/i.test(name);
    },
  },
  {
    id: "primary_schools",
    label: "Primary Schools",
    description: "Primary school labels using OSM school amenities.",
    clauses: [
      'node["amenity"="school"](area.sg);',
      'way["amenity"="school"](area.sg);',
      'relation["amenity"="school"](area.sg);',
    ],
    include: (tags) => {
      const name = normalizeTag(tags.name);
      if (!name) {
        return false;
      }
      const isced = normalizeTag(tags["isced:level"]);
      return /\bPRIMARY SCHOOL\b/i.test(name) || /(^|[;,])\s*1(\s*[;,]|$)/.test(isced);
    },
  },
  {
    id: "preschools",
    label: "Preschools / Childcare",
    description: "Kindergarten labels using OSM amenity=kindergarten.",
    clauses: [
      'node["amenity"="kindergarten"](area.sg);',
      'way["amenity"="kindergarten"](area.sg);',
      'relation["amenity"="kindergarten"](area.sg);',
    ],
    include: (tags) => Boolean(normalizeTag(tags.name)),
  },
  {
    id: "shopping_malls",
    label: "Shopping Malls",
    description: "Shopping mall labels using OSM shop=mall.",
    clauses: [
      'node["shop"="mall"](area.sg);',
      'way["shop"="mall"](area.sg);',
      'relation["shop"="mall"](area.sg);',
    ],
    include: (tags) => Boolean(normalizeTag(tags.name)),
  },
  {
    id: "supermarkets_wet_markets",
    label: "Supermarkets / Wet Markets",
    description: "Daily essentials labels from supermarket and marketplace features.",
    clauses: [
      'node["shop"="supermarket"](area.sg);',
      'way["shop"="supermarket"](area.sg);',
      'relation["shop"="supermarket"](area.sg);',
      'node["amenity"="marketplace"](area.sg);',
      'way["amenity"="marketplace"](area.sg);',
      'relation["amenity"="marketplace"](area.sg);',
    ],
    include: (tags) => Boolean(normalizeTag(tags.name)),
    subcategory: (tags) =>
      normalizeTag(tags.shop).toLowerCase() === "supermarket" ? "supermarket" : "marketplace",
  },
  {
    id: "hawker_food_courts",
    label: "Hawker / Food Courts",
    description: "Food court labels using OSM amenity=food_court.",
    clauses: [
      'node["amenity"="food_court"](area.sg);',
      'way["amenity"="food_court"](area.sg);',
      'relation["amenity"="food_court"](area.sg);',
    ],
    include: (tags) => Boolean(normalizeTag(tags.name)),
  },
];

function parseArgs(argv) {
  const options = {
    outPath: DEFAULT_OUT_PATH,
    overpassUrl: DEFAULT_OVERPASS_URL,
    pretty: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--out") {
      options.outPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--overpass-url") {
      options.overpassUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--compact") {
      options.pretty = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.outPath) {
    throw new Error("Missing value for --out");
  }
  if (!options.overpassUrl) {
    throw new Error("Missing value for --overpass-url");
  }

  return options;
}

function printHelpAndExit() {
  console.log(`Ingest OSM amenities for Singapore and write a normalized dataset.

Usage:
  node scripts/ingest-osm-amenities.mjs [--out <path>] [--overpass-url <url>] [--compact]

Options:
  --out            Output JSON path (default: ${DEFAULT_OUT_PATH})
  --overpass-url   Overpass endpoint (default: ${DEFAULT_OVERPASS_URL})
  --compact        Write compact JSON (default is pretty-printed)
`);
  process.exit(0);
}

function normalizeTag(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildOverpassQuery(clauses) {
  return [
    "[out:json][timeout:240];",
    'area["ISO3166-1"="SG"][admin_level=2]->.sg;',
    "(",
    ...clauses,
    ");",
    "out tags center;",
  ].join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCoordinate(element) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }
  if (
    element.center &&
    typeof element.center.lat === "number" &&
    typeof element.center.lon === "number"
  ) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return null;
}

function pickTags(tags) {
  const keys = [
    "amenity",
    "shop",
    "railway",
    "public_transport",
    "station",
    "isced:level",
    "network",
    "operator",
  ];
  const out = {};
  for (const key of keys) {
    const value = normalizeTag(tags[key]);
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

async function fetchOverpassJson(overpassUrl, query) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(overpassUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const retriable = response.status === 429 || response.status >= 500;
        if (retriable && attempt < MAX_RETRIES) {
          const backoffMs = attempt * 1_500 + Math.floor(Math.random() * 500);
          console.warn(
            `[warn] Overpass request failed (${response.status}). Retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`,
          );
          await sleep(backoffMs);
          continue;
        }
        throw new Error(
          `Overpass request failed with status ${response.status}: ${text.slice(0, 200).trim()}`,
        );
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Failed to parse Overpass JSON: ${text.slice(0, 200).trim()}`);
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (attempt < MAX_RETRIES) {
        const backoffMs = attempt * 1_500 + Math.floor(Math.random() * 500);
        console.warn(
          `[warn] Overpass request ${isAbort ? "timed out" : "errored"}; retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_RETRIES})`,
        );
        await sleep(backoffMs);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error("Overpass request failed after maximum retries");
}

function normalizeCategoryElements(categoryConfig, elements) {
  const deduped = new Map();
  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const tags = typeof element.tags === "object" && element.tags ? element.tags : {};
    if (!categoryConfig.include(tags)) {
      continue;
    }
    const name = normalizeTag(tags.name);
    if (!name) {
      continue;
    }
    const coord = getCoordinate(element);
    if (!coord) {
      continue;
    }
    const osmType = normalizeTag(element.type);
    if (!osmType || typeof element.id !== "number") {
      continue;
    }
    const sourceId = `${osmType}/${element.id}`;
    if (deduped.has(sourceId)) {
      continue;
    }
    const normalized = {
      id: `${categoryConfig.id}:${sourceId}`,
      category: categoryConfig.id,
      name,
      lat: Number(coord.lat.toFixed(7)),
      lng: Number(coord.lng.toFixed(7)),
      osm_type: osmType,
      osm_id: element.id,
      osm_url: `https://www.openstreetmap.org/${sourceId}`,
      tags: pickTags(tags),
    };
    if (typeof categoryConfig.subcategory === "function") {
      const subcategory = normalizeTag(categoryConfig.subcategory(tags));
      if (subcategory) {
        normalized.subcategory = subcategory;
      }
    }
    deduped.set(sourceId, normalized);
  }
  return [...deduped.values()];
}

function sortAmenities(amenities) {
  return amenities.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    const nameDiff = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    if (nameDiff !== 0) {
      return nameDiff;
    }
    if (a.lat !== b.lat) {
      return a.lat - b.lat;
    }
    if (a.lng !== b.lng) {
      return a.lng - b.lng;
    }
    return a.id.localeCompare(b.id);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const categoriesMeta = CATEGORY_CONFIGS.map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
  const amenities = [];
  const counts = {};

  console.log(`[info] Using Overpass endpoint: ${options.overpassUrl}`);
  for (const category of CATEGORY_CONFIGS) {
    const query = buildOverpassQuery(category.clauses);
    console.log(`[info] Querying category: ${category.id}`);
    const payload = await fetchOverpassJson(options.overpassUrl, query);
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const normalized = normalizeCategoryElements(category, elements);
    counts[category.id] = normalized.length;
    amenities.push(...normalized);
    console.log(
      `[info] ${category.id}: fetched ${elements.length} raw elements, kept ${normalized.length} normalized points`,
    );
    await sleep(REQUEST_GAP_MS);
  }

  const sortedAmenities = sortAmenities(amenities);
  const dataset = {
    schema_version: 1,
    source: "OpenStreetMap via Overpass API",
    generated_at: generatedAt,
    overpass_url: options.overpassUrl,
    categories: categoriesMeta,
    counts,
    total: sortedAmenities.length,
    amenities: sortedAmenities,
  };

  const outputPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const serialized = options.pretty ? JSON.stringify(dataset, null, 2) : JSON.stringify(dataset);
  await writeFile(outputPath, `${serialized}\n`, "utf8");

  console.log(`[info] Wrote dataset to ${outputPath}`);
  console.log(`[info] Total amenities: ${dataset.total}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
