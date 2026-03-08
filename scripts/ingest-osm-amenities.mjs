#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const DEFAULT_OUT_PATH =
  process.env.AMENITIES_OUT || "frontend/public/data/amenities/osm-amenities-latest.json";
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
      const stationType = normalizeTag(tags.station).toLowerCase();
      if (stationType === "subway" || stationType === "light_rail") {
        return true;
      }
      const network = normalizeTag(tags.network);
      if (/\bMRT\b|\bLRT\b/i.test(`${name} ${network}`)) {
        return true;
      }
      return false;
    },
    nearDuplicateMeters: 180,
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
    nearDuplicateMeters: 120,
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
    nearDuplicateMeters: 80,
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
    nearDuplicateMeters: 120,
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
    nearDuplicateMeters: 60,
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
    nearDuplicateMeters: 60,
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

function isConstructionOrProposed(tags) {
  const railway = normalizeTag(tags.railway).toLowerCase();
  const publicTransport = normalizeTag(tags.public_transport).toLowerCase();
  const construction = normalizeTag(tags.construction);
  const proposed = normalizeTag(tags.proposed);
  if (construction || proposed) {
    return true;
  }
  return railway === "construction" || railway === "proposed" || publicTransport === "construction";
}

function isLowSignalName(name, categoryId) {
  const trimmed = normalizeTag(name);
  if (!trimmed) {
    return true;
  }
  if (/^\(.*\)$/.test(trimmed)) {
    return true;
  }
  const alnumLength = trimmed.replace(/[^\p{L}\p{N}]+/gu, "").length;
  if (alnumLength < 2) {
    return true;
  }
  if (categoryId === "hawker_food_courts" && /^[A-Za-z0-9-]{1,4}$/.test(trimmed)) {
    return true;
  }
  return false;
}

function normalizeNameForDedupe(name) {
  return normalizeTag(name).toLocaleLowerCase("en").replace(/\s+/g, " ");
}

function sourceTypeRank(osmType) {
  if (osmType === "relation") {
    return 0;
  }
  if (osmType === "way") {
    return 1;
  }
  if (osmType === "node") {
    return 2;
  }
  return 3;
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const toRadians = Math.PI / 180;
  const dLat = (bLat - aLat) * toRadians;
  const dLng = (bLng - aLng) * toRadians;
  const lat1 = aLat * toRadians;
  const lat2 = bLat * toRadians;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function createCategoryQa(rawCount) {
  return {
    raw_elements: rawCount,
    kept_after_source_dedupe: 0,
    kept_final: 0,
    dropped: {
      construction_or_proposed: 0,
      category_filter: 0,
      missing_name: 0,
      low_signal_name: 0,
      missing_coordinate: 0,
      invalid_source: 0,
      duplicate_source_id: 0,
      duplicate_name_distance: 0,
    },
    sample_drops: {
      construction_or_proposed: [],
      low_signal_name: [],
      duplicate_name_distance: [],
    },
  };
}

function pushSampleDrop(samples, reason, value) {
  const list = samples[reason];
  if (!Array.isArray(list)) {
    return;
  }
  if (list.length >= 8) {
    return;
  }
  if (!value) {
    return;
  }
  list.push(value);
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
  const qa = createCategoryQa(elements.length);
  const dedupedBySource = new Map();
  for (const element of elements) {
    if (!element || typeof element !== "object") {
      qa.dropped.invalid_source += 1;
      continue;
    }
    const tags = typeof element.tags === "object" && element.tags ? element.tags : {};
    const name = normalizeTag(tags.name);
    if (isConstructionOrProposed(tags)) {
      qa.dropped.construction_or_proposed += 1;
      pushSampleDrop(qa.sample_drops, "construction_or_proposed", name);
      continue;
    }
    if (!categoryConfig.include(tags)) {
      qa.dropped.category_filter += 1;
      continue;
    }
    if (!name) {
      qa.dropped.missing_name += 1;
      continue;
    }
    if (isLowSignalName(name, categoryConfig.id)) {
      qa.dropped.low_signal_name += 1;
      pushSampleDrop(qa.sample_drops, "low_signal_name", name);
      continue;
    }
    const coord = getCoordinate(element);
    if (!coord) {
      qa.dropped.missing_coordinate += 1;
      continue;
    }
    const osmType = normalizeTag(element.type);
    if (!osmType || typeof element.id !== "number") {
      qa.dropped.invalid_source += 1;
      continue;
    }
    const sourceId = `${osmType}/${element.id}`;
    if (dedupedBySource.has(sourceId)) {
      qa.dropped.duplicate_source_id += 1;
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
      _name_key: normalizeNameForDedupe(name),
    };
    if (typeof categoryConfig.subcategory === "function") {
      const subcategory = normalizeTag(categoryConfig.subcategory(tags));
      if (subcategory) {
        normalized.subcategory = subcategory;
      }
    }
    dedupedBySource.set(sourceId, normalized);
  }

  qa.kept_after_source_dedupe = dedupedBySource.size;
  const candidates = [...dedupedBySource.values()].sort((a, b) => {
    if (a._name_key !== b._name_key) {
      return a._name_key.localeCompare(b._name_key);
    }
    const rankDiff = sourceTypeRank(a.osm_type) - sourceTypeRank(b.osm_type);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.id.localeCompare(b.id);
  });

  const accepted = [];
  const byName = new Map();
  const nearDuplicateMeters = Number(categoryConfig.nearDuplicateMeters || 80);

  for (const candidate of candidates) {
    const sameNameIndices = byName.get(candidate._name_key) || [];
    let duplicate = false;
    for (const idx of sameNameIndices) {
      const existing = accepted[idx];
      const distance = haversineMeters(candidate.lat, candidate.lng, existing.lat, existing.lng);
      if (distance <= nearDuplicateMeters) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      qa.dropped.duplicate_name_distance += 1;
      pushSampleDrop(
        qa.sample_drops,
        "duplicate_name_distance",
        `${candidate.name} (${candidate.lat}, ${candidate.lng})`,
      );
      continue;
    }
    const nextIndex = accepted.length;
    accepted.push(candidate);
    byName.set(candidate._name_key, [...sameNameIndices, nextIndex]);
  }

  qa.kept_final = accepted.length;
  const finalized = accepted.map((item) => {
    const { _name_key: _nameKey, ...rest } = item;
    return rest;
  });
  return { amenities: finalized, qa };
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
  const qaByCategory = {};
  const rawCounts = {};

  console.log(`[info] Using Overpass endpoint: ${options.overpassUrl}`);
  for (const category of CATEGORY_CONFIGS) {
    const query = buildOverpassQuery(category.clauses);
    console.log(`[info] Querying category: ${category.id}`);
    const payload = await fetchOverpassJson(options.overpassUrl, query);
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    rawCounts[category.id] = elements.length;
    const { amenities: normalized, qa } = normalizeCategoryElements(category, elements);
    counts[category.id] = normalized.length;
    qaByCategory[category.id] = qa;
    amenities.push(...normalized);
    console.log(
      `[info] ${category.id}: raw=${elements.length}, kept=${normalized.length}, dropped_name_distance_dup=${qa.dropped.duplicate_name_distance}, dropped_low_signal=${qa.dropped.low_signal_name}, dropped_construction=${qa.dropped.construction_or_proposed}`,
    );
    await sleep(REQUEST_GAP_MS);
  }

  const sortedAmenities = sortAmenities(amenities);
  const qaTotals = {
    raw_elements: Object.values(rawCounts).reduce((sum, value) => sum + value, 0),
    kept_final: sortedAmenities.length,
    dropped: {
      construction_or_proposed: 0,
      category_filter: 0,
      missing_name: 0,
      low_signal_name: 0,
      missing_coordinate: 0,
      invalid_source: 0,
      duplicate_source_id: 0,
      duplicate_name_distance: 0,
    },
  };
  for (const qa of Object.values(qaByCategory)) {
    for (const [reason, value] of Object.entries(qa.dropped)) {
      qaTotals.dropped[reason] += value;
    }
  }

  const dataset = {
    schema_version: 1,
    source: "OpenStreetMap via Overpass API",
    generated_at: generatedAt,
    overpass_url: options.overpassUrl,
    categories: categoriesMeta,
    qa: {
      raw_counts: rawCounts,
      totals: qaTotals,
      by_category: qaByCategory,
    },
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
