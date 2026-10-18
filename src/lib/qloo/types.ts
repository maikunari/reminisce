/**
 * Types for the Qloo hackathon API.
 *
 * Shapes follow the documented responses:
 * - Insights:   https://docs.qloo.com/reference/insights-api-deep-dive
 * - Search:     https://docs.qloo.com/reference/get-search
 * - Tags:       https://docs.qloo.com/reference/search-tags
 * - Entity schema per type: https://docs.qloo.com/reference/schema-taxonomy
 */

/** `filter.type` values supported by the hackathon Insights API. */
export const QLOO_ENTITY_TYPES = [
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:video_game",
] as const;

export type QlooEntityType = (typeof QLOO_ENTITY_TYPES)[number];

/**
 * `types` values accepted by `/search`. These are not the same list as
 * `filter.type`; locality, album, actor, author and director are search-only.
 */
export const QLOO_SEARCH_TYPES = [
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:locality",
  "urn:entity:album",
  "urn:entity:actor",
  "urn:entity:author",
  "urn:entity:director",
] as const;

export type QlooSearchType = (typeof QLOO_SEARCH_TYPES)[number];

/** `signal.demographics.age` enum (Parameter Reference). */
export const QLOO_AGE_BUCKETS = [
  "24_and_younger",
  "25_to_29",
  "30_to_34",
  "35_to_44",
  "45_to_54",
  "55_and_older",
] as const;

export type QlooAgeBucket = (typeof QLOO_AGE_BUCKETS)[number];

export interface QlooTag {
  id: string;
  name: string;
  type?: string;
  subtype?: string;
}

export interface QlooAka {
  value: string;
  languages?: string[];
}

export interface QlooGeocode {
  name?: string;
  admin1_region?: string;
  admin2_region?: string;
  country_code?: string;
  metro?: string;
  neighborhood?: string;
}

/** The `properties` bag varies by entity subtype; these are the documented fields we read. */
export interface QlooEntityProperties {
  image?: { url: string };
  description?: string;
  short_description?: string;
  short_descriptions?: QlooAka[];
  akas?: QlooAka[];
  release_year?: number;
  release_date?: string;
  release_country?: string[];
  content_rating?: string;
  duration?: number;
  publication_year?: number;
  date_of_birth?: string;
  year_of_death?: number;
  place_of_birth?: string;
  address?: string;
  geocode?: QlooGeocode;
  business_rating?: number;
  price_level?: number;
  is_closed?: boolean;
  website?: string;
  websites?: string[];
  population?: number;
  [key: string]: unknown;
}

export interface QlooExplainability {
  /** Input entity id -> normalized contribution (0..1). */
  entities?: Record<string, number>;
  warning?: string;
  [key: string]: unknown;
}

export interface QlooEntityQuery {
  affinity?: number;
  measurements?: Record<string, number>;
  explainability?: QlooExplainability;
  [key: string]: unknown;
}

/** One entity in an Insights response. */
export interface QlooEntity {
  name: string;
  entity_id: string;
  type: "urn:entity";
  subtype: string;
  properties?: QlooEntityProperties;
  popularity?: number;
  tags?: QlooTag[];
  query?: QlooEntityQuery;
  /** Some documentation examples flatten the affinity to the top level. */
  affinity?: number;
  disambiguation?: string;
  location?: { lat: number; lon: number; geohash?: string };
  external?: Record<string, unknown>;
}

export interface QlooLocalitySignal {
  entity_id?: string;
  name?: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface QlooInsightsResponse {
  success: boolean;
  results: { entities: QlooEntity[] };
  query?: {
    locality?: { signal?: QlooLocalitySignal; filter?: QlooLocalitySignal };
    explainability?: Record<string, unknown>;
    [key: string]: unknown;
  };
  warnings?: unknown;
  duration?: number;
  /** Present only on fixture responses. Never produced by the live API. */
  _fixture?: QlooFixtureMeta;
}

/** One result from `/search`. */
export interface QlooSearchResult {
  name: string;
  entity_id: string;
  types: string[];
  properties?: QlooEntityProperties;
  popularity?: number;
  tags?: QlooTag[];
  disambiguation?: string;
  location?: { lat: number; lon: number };
}

export interface QlooSearchResponse {
  results: QlooSearchResult[];
  duration?: number;
  _fixture?: QlooFixtureMeta;
}

export interface QlooTagResult {
  id: string;
  name: string;
  type?: string;
  subtype?: string;
  parents?: { type: string }[];
  popularity?: number;
  [key: string]: unknown;
}

export interface QlooTagsResponse {
  success?: boolean;
  results: { tags: QlooTagResult[] };
  duration?: number;
  _fixture?: QlooFixtureMeta;
}

export interface QlooFixtureMeta {
  source: "recorded" | "synthetic";
  note: string;
  recordedAt?: string;
}

/** Returns the affinity score wherever the API put it. */
export function entityAffinity(entity: QlooEntity): number | null {
  const q = entity.query?.affinity;
  if (typeof q === "number") return q;
  if (typeof entity.affinity === "number") return entity.affinity;
  return null;
}

/** Up to a dozen tag names, trimmed, for carrying a seed's genres along with a favorite. */
export function tagNamesOf(tags: QlooTag[] | undefined): string[] | undefined {
  const names = (tags ?? []).map((t) => t.name?.trim()).filter((n): n is string => !!n);
  return names.length > 0 ? [...new Set(names)].slice(0, 12) : undefined;
}

export function entityImageUrl(entity: { properties?: QlooEntityProperties } | QlooSearchResult): string | undefined {
  const url = entity.properties?.image?.url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

export function entityYear(entity: { properties?: QlooEntityProperties }): number | undefined {
  const p = entity.properties;
  if (!p) return undefined;
  if (typeof p.release_year === "number") return p.release_year;
  if (typeof p.publication_year === "number") return p.publication_year;
  if (typeof p.release_date === "string") {
    const y = Number.parseInt(p.release_date.slice(0, 4), 10);
    if (Number.isFinite(y)) return y;
  }
  return undefined;
}
