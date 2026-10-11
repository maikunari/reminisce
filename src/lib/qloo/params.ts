/**
 * Typed, validated parameter building for `GET /v2/insights`.
 *
 * The hackathon guide warns that invalid parameters are silently ignored, so
 * every parameter we send is checked against two documents:
 *
 * 1. Entity Type Parameter Guide (per `filter.type` tables):
 *    https://docs.qloo.com/reference/available-parameters-by-entity-type
 * 2. Parameter Reference ("Compatible Entity Types" column):
 *    https://docs.qloo.com/reference/parameters
 *
 * A parameter is allowed for a type when either document lists it for that
 * type. Anything else is dropped and reported as a warning (which the agent
 * trace surfaces) instead of being sent and silently ignored.
 */
import type { QlooAgeBucket, QlooEntityType } from "./types";

type ParamSet = ReadonlySet<string>;

const set = (...names: string[]): ParamSet => new Set(names);

/**
 * Parameters the Parameter Reference marks as compatible with every entity
 * type (Artist, Book, Brand, Destination, Movie, Person, Place, Podcast,
 * TV Show, Video Game).
 */
export const UNIVERSAL_PARAMS: ParamSet = set(
  "filter.type",
  "filter.exclude.entities",
  "filter.exclude.tags",
  "operator.exclude.tags",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "filter.results.entities",
  "filter.results.entities.query",
  "filter.tags",
  "operator.filter.tags",
  "filter.external.exists",
  "operator.filter.external.exists",
  "filter.exists",
  "signal.demographics.age",
  "signal.demographics.age.weight",
  "signal.demographics.audiences",
  "signal.demographics.audiences.weight",
  "signal.demographics.gender",
  "signal.demographics.gender.weight",
  "signal.interests.entities",
  "signal.interests.entities.weight",
  "signal.interests.tags",
  "signal.interests.tags.weight",
  "operator.signal.interests.tags",
  "signal.location",
  "signal.location.query",
  "signal.location.radius",
  "signal.location.weight",
  "feature.explainability",
  "bias.trends",
  "offset",
  "page",
  "sort_by",
  "take",
);

/** Per-type additions from the Entity Type Parameter Guide. */
export const TYPE_PARAMS: Record<QlooEntityType, ParamSet> = {
  "urn:entity:artist": set(),
  "urn:entity:book": set("filter.publication_year.min", "filter.publication_year.max"),
  "urn:entity:brand": set(),
  "urn:entity:destination": set(
    "filter.geocode.name",
    "filter.geocode.admin1_region",
    "filter.geocode.admin2_region",
    "filter.geocode.country_code",
    "filter.location",
    "filter.location.query",
    "filter.location.radius",
    "filter.location.geohash",
    "filter.exclude.location.geohash",
  ),
  "urn:entity:movie": set(
    "filter.content_rating",
    "filter.release_year.min",
    "filter.release_year.max",
    "filter.release_country",
    "operator.filter.release_country",
    "filter.rating.min",
    "filter.rating.max",
  ),
  "urn:entity:person": set(
    "filter.date_of_birth.min",
    "filter.date_of_birth.max",
    "filter.date_of_death.min",
    "filter.date_of_death.max",
    "filter.gender",
  ),
  "urn:entity:place": set(
    "bias.quality",
    "filter.address",
    "filter.external.tripadvisor.rating.count.min",
    "filter.external.tripadvisor.rating.count.max",
    "filter.external.tripadvisor.rating.min",
    "filter.external.tripadvisor.rating.max",
    "filter.geocode.name",
    "filter.geocode.admin1_region",
    "filter.geocode.admin2_region",
    "filter.geocode.country_code",
    "filter.hotel_class.min",
    "filter.hotel_class.max",
    "filter.hours",
    "filter.location",
    "filter.location.query",
    "filter.location.geohash",
    "filter.exclude.location.geohash",
    "filter.location.radius",
    "filter.price_level.min",
    "filter.price_level.max",
    "filter.price_range.from",
    "filter.price_range.to",
    "filter.properties.business_rating.min",
    "filter.properties.business_rating.max",
    "filter.properties.resy.rating.min",
    "filter.properties.resy.rating.max",
    "filter.references_brand",
    "filter.resy.rating_count.min",
    "filter.resy.rating_count.max",
    "filter.resy.rating.party.min",
    "filter.resy.rating.party.max",
  ),
  "urn:entity:podcast": set(),
  "urn:entity:tv_show": set(
    "filter.content_rating",
    "filter.finale_year.min",
    "filter.finale_year.max",
    "filter.latest_known_year.min",
    "filter.latest_known_year.max",
    "filter.release_year.min",
    "filter.release_year.max",
    "filter.release_country",
    "operator.filter.release_country",
    "filter.rating.min",
    "filter.rating.max",
  ),
  "urn:entity:video_game": set(),
};

export function isParamSupported(type: QlooEntityType, name: string): boolean {
  return UNIVERSAL_PARAMS.has(name) || TYPE_PARAMS[type].has(name);
}

export type BiasTrends = "off" | "very_low" | "low" | "medium" | "high" | "very_high";

/** A structured Insights request. Field names map 1:1 to documented parameters. */
export interface InsightsRequest {
  type: QlooEntityType;
  signals?: {
    /** `signal.interests.entities` (comma-separated entity ids) */
    entities?: string[];
    /** `signal.interests.tags` */
    tags?: string[];
    /** `signal.location.query` (fuzzy locality name) */
    locationQuery?: string;
    /** `signal.demographics.age` */
    age?: QlooAgeBucket[];
    /** `signal.demographics.gender` */
    gender?: "male" | "female";
  };
  filters?: {
    /** `filter.tags` */
    tags?: string[];
    /** `filter.exclude.entities` */
    excludeEntities?: string[];
    /** `filter.release_year.min` / `.max` (movie, tv_show) */
    releaseYearMin?: number;
    releaseYearMax?: number;
    /** `filter.publication_year.min` / `.max` (book) */
    publicationYearMin?: number;
    publicationYearMax?: number;
    /** `filter.release_country` (movie, tv_show) */
    releaseCountry?: string[];
    /** `filter.location.query` (place, destination) */
    locationQuery?: string;
    /** `filter.location.radius` in meters (place, destination) */
    locationRadius?: number;
    /** `filter.geocode.country_code` (place, destination) */
    geocodeCountryCode?: string;
    /** `filter.popularity.min` */
    popularityMin?: number;
    /** `filter.exists` */
    exists?: "properties.image" | "properties.description";
  };
  take?: number;
  page?: number;
  /** `feature.explainability` */
  explainability?: boolean;
  /** `bias.trends` */
  biasTrends?: BiasTrends;
}

export interface BuiltParams {
  /** Query parameters in a deterministic (sorted) order. */
  params: Record<string, string>;
  /** Human-readable notes about parameters that were dropped. */
  warnings: string[];
}

function clampTake(take: number | undefined): number {
  if (take === undefined) return 10;
  return Math.max(1, Math.min(50, Math.round(take)));
}

/**
 * Build the query parameters for an Insights request, dropping anything the
 * docs do not list for the chosen `filter.type`.
 */
export function buildInsightsParams(req: InsightsRequest): BuiltParams {
  const raw: Record<string, string | undefined> = {
    "filter.type": req.type,
    "signal.interests.entities": joinList(req.signals?.entities),
    "signal.interests.tags": joinList(req.signals?.tags),
    "signal.location.query": clean(req.signals?.locationQuery),
    "signal.demographics.age": joinList(req.signals?.age),
    "signal.demographics.gender": req.signals?.gender,
    "filter.tags": joinList(req.filters?.tags),
    "filter.exclude.entities": joinList(req.filters?.excludeEntities),
    "filter.release_year.min": num(req.filters?.releaseYearMin),
    "filter.release_year.max": num(req.filters?.releaseYearMax),
    "filter.publication_year.min": num(req.filters?.publicationYearMin),
    "filter.publication_year.max": num(req.filters?.publicationYearMax),
    "filter.release_country": joinList(req.filters?.releaseCountry),
    "filter.location.query": clean(req.filters?.locationQuery),
    "filter.location.radius": num(req.filters?.locationRadius),
    "filter.geocode.country_code": clean(req.filters?.geocodeCountryCode),
    "filter.popularity.min": num(req.filters?.popularityMin),
    "filter.exists": req.filters?.exists,
    "feature.explainability": req.explainability ? "true" : undefined,
    "bias.trends": req.biasTrends,
    take: String(clampTake(req.take)),
    page: req.page && req.page > 1 ? String(Math.round(req.page)) : undefined,
  };

  const warnings: string[] = [];
  const params: Record<string, string> = {};
  for (const key of Object.keys(raw).sort()) {
    const value = raw[key];
    if (value === undefined || value === "") continue;
    if (!isParamSupported(req.type, key)) {
      warnings.push(`${key} is not documented for ${req.type}; dropped so it is not silently ignored by the API`);
      continue;
    }
    params[key] = value;
  }
  return { params, warnings };
}

function joinList(values: readonly string[] | undefined): string | undefined {
  if (!values) return undefined;
  const cleaned = values.map((v) => v.trim()).filter((v) => v.length > 0);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)).join(",") : undefined;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v.length > 0 ? v : undefined;
}

function num(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : undefined;
}

/** Deterministic query string: sorted keys, standard encoding. */
export function toQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}

/** Builds the `/search` query parameters. */
export function buildSearchParams(opts: {
  query: string;
  types?: readonly string[];
  take?: number;
  page?: number;
}): Record<string, string> {
  const params: Record<string, string> = { query: opts.query.trim() };
  const types = joinList(opts.types);
  if (types) params.types = types;
  params.take = String(Math.max(1, Math.min(50, opts.take ?? 8)));
  if (opts.page && opts.page > 1) params.page = String(opts.page);
  return params;
}

/** Builds the `/v2/tags` query parameters. */
export function buildTagsParams(opts: {
  query: string;
  parentTypes?: readonly string[];
  tagTypes?: readonly string[];
  take?: number;
}): Record<string, string> {
  const params: Record<string, string> = { "filter.query": opts.query.trim() };
  const parents = joinList(opts.parentTypes);
  if (parents) params["filter.parents.types"] = parents;
  const tagTypes = joinList(opts.tagTypes);
  if (tagTypes) params["filter.tag.types"] = tagTypes;
  params.take = String(Math.max(1, Math.min(50, opts.take ?? 10)));
  return params;
}
