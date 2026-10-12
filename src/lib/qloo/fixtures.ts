/**
 * Fixture mode for the Qloo client.
 *
 * Two layers:
 *  1. Recorded responses (fixtures/recorded/*.json, written by scripts/record.ts
 *     from the real hackathon API). Matched by an exact request hash.
 *  2. A synthetic catalog (fixtures/synthetic/*.json), hand-authored and shaped
 *     like documented Qloo responses, used when nothing has been recorded. It
 *     is clearly marked `_fixture.source = "synthetic"` on every response.
 *
 * The synthetic scorer is deterministic: the same request always yields the
 * same entities in the same order, which keeps tests and demos stable.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import inCatalog from "../../../fixtures/synthetic/in.json";
import jpCatalog from "../../../fixtures/synthetic/jp.json";
import krCatalog from "../../../fixtures/synthetic/kr.json";
import latamCatalog from "../../../fixtures/synthetic/latam.json";
import localitiesData from "../../../fixtures/synthetic/localities.json";
import phCatalog from "../../../fixtures/synthetic/ph.json";
import regionsData from "../../../fixtures/synthetic/regions.json";
import tagsData from "../../../fixtures/synthetic/tags.json";
import ukCatalog from "../../../fixtures/synthetic/uk.json";
import usCatalog from "../../../fixtures/synthetic/us.json";
import worldCatalog from "../../../fixtures/synthetic/world.json";
import zhCatalog from "../../../fixtures/synthetic/zh.json";
import { toQueryString } from "./params";
import { fold, isTypedPlace, phrase, tokens } from "./place";
import type {
  QlooEntity,
  QlooInsightsResponse,
  QlooSearchResponse,
  QlooSearchResult,
  QlooTagResult,
  QlooTagsResponse,
} from "./types";

export type QlooPath = "/search" | "/v2/insights" | "/v2/tags" | "/entities";

export interface QlooRequest {
  path: QlooPath;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Request hashing (shared by the recorder and the recorded-fixture lookup)
// ---------------------------------------------------------------------------

export function canonicalRequestKey(req: QlooRequest): string {
  return `GET ${req.path}?${toQueryString(req.params)}`;
}

export function requestHash(req: QlooRequest): string {
  return createHash("sha256").update(canonicalRequestKey(req)).digest("hex").slice(0, 16);
}

export function recordedFixtureFilename(req: QlooRequest): string {
  const slug = req.path.replace(/^\//, "").replace(/\//g, "-");
  return `${slug}__${requestHash(req)}.json`;
}

export interface RecordedFixture<T = unknown> {
  _meta: {
    recordedAt: string;
    source: "live";
    request: { method: "GET"; path: string; params: Record<string, string>; key: string };
    status: number;
  };
  body: T;
}

export const DEFAULT_RECORDED_ROOT = path.join(process.cwd(), "fixtures", "recorded");

export async function findRecordedFixture<T>(
  req: QlooRequest,
  root: string = DEFAULT_RECORDED_ROOT,
): Promise<RecordedFixture<T> | null> {
  const file = path.join(root, recordedFixtureFilename(req));
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text) as RecordedFixture<T>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRecordedFixture(
  req: QlooRequest,
  status: number,
  body: unknown,
  root: string = DEFAULT_RECORDED_ROOT,
): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, recordedFixtureFilename(req));
  const fixture: RecordedFixture = {
    _meta: {
      recordedAt: new Date().toISOString(),
      source: "live",
      request: { method: "GET", path: req.path, params: req.params, key: canonicalRequestKey(req) },
      status,
    },
    body,
  };
  await fs.writeFile(file, JSON.stringify(fixture, null, 2) + "\n", "utf8");
  return file;
}

// ---------------------------------------------------------------------------
// Synthetic catalog
// ---------------------------------------------------------------------------

/** Authoring metadata attached to synthetic entities; stripped before serving. */
export interface SyntheticHints {
  /** Cultural world(s) the entity belongs to: jp, us, uk, latam, ph, in, kr, zh, or generic (international). */
  world: string | string[];
  /** ISO country codes the entity is specific to; empty means the whole world. */
  countries?: string[];
  localities?: string[];
  /** [firstYear, lastYear] of the entity's cultural relevance. */
  era?: [number, number];
  /** Seed entity id -> affinity weight (0..1). */
  related?: Record<string, number>;
  kind?: "dining" | "landmark";
}

export type SyntheticEntity = QlooEntity & { _syn: SyntheticHints };

export interface SyntheticLocality {
  entity_id: string;
  name: string;
  key: string;
  world: string;
  akas: string[];
  properties: QlooEntity["properties"];
  location: { lat: number; lon: number };
  disambiguation: string;
  /** True when the place is not in the catalog and only its country or region was inferred from the name. */
  inferred?: boolean;
}

/** One country in regions.json: how a hometown that is not a catalog locality maps to a world. */
export interface SyntheticRegion {
  code: string;
  name: string;
  world: string;
  /** Words that name the country or its regions ("mexico", "jalisco"). Matched as whole tokens after folding. */
  keywords: string[];
  /** Towns and cities without their own catalog entry. */
  cities: string[];
}

export interface SyntheticCatalog {
  _meta: { synthetic: true; note: string };
  entities: SyntheticEntity[];
}

interface SyntheticTag extends QlooTagResult {
  parents: { type: string }[];
}

export const SYNTHETIC_NOTE =
  "Synthetic fixture: hand-authored, shaped like a Qloo response, not Qloo data. Record real responses with `npm run record` once QLOO_API_KEY is available.";

export function loadSyntheticCatalog(): {
  entities: SyntheticEntity[];
  localities: SyntheticLocality[];
  tags: SyntheticTag[];
  regions: SyntheticRegion[];
} {
  const catalogs = [jpCatalog, usCatalog, ukCatalog, latamCatalog, phCatalog, inCatalog, krCatalog, zhCatalog, worldCatalog] as unknown as SyntheticCatalog[];
  const entities = catalogs.flatMap((c) => c.entities);
  return {
    entities,
    localities: (localitiesData as { localities: SyntheticLocality[] }).localities,
    tags: (tagsData as { tags: SyntheticTag[] }).tags,
    regions: (regionsData as { countries: SyntheticRegion[] }).countries,
  };
}

/** The generic world: international names that are not tied to one region. */
export const GENERIC_WORLD = "generic";

export function worldsOf(hints: Pick<SyntheticHints, "world">): string[] {
  return Array.isArray(hints.world) ? hints.world : [hints.world];
}

const US_STATE_CODES = new Set(
  "al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy".split(" "),
);

/** Length of the longest whole-token run of `phrases` found in `words`, or 0. */
function longestRun(words: string[], phrases: string[]): number {
  let best = 0;
  for (const candidate of phrases) {
    const needle = tokens(candidate);
    if (needle.length <= best || needle.length > words.length) continue;
    for (let i = 0; i + needle.length <= words.length; i++) {
      if (needle.every((w, k) => words[i + k] === w)) {
        best = needle.length;
        break;
      }
    }
  }
  return best;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Deterministic pseudo-duration so fixture responses look like real ones. */
function fakeDuration(seed: string): number {
  let h = 7;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 20 + (h % 60);
}

export class SyntheticQloo {
  private readonly entities: SyntheticEntity[];
  private readonly byId: Map<string, SyntheticEntity>;
  private readonly localities: SyntheticLocality[];
  private readonly tagList: SyntheticTag[];
  private readonly regions: SyntheticRegion[];

  constructor(data = loadSyntheticCatalog()) {
    this.entities = data.entities;
    this.byId = new Map(data.entities.map((e) => [e.entity_id, e]));
    this.localities = data.localities;
    this.tagList = data.tags;
    this.regions = data.regions;
  }

  /** Authoring hints for an entity id (tests and tooling only; never served). */
  hintsFor(entityId: string): SyntheticHints | undefined {
    return this.byId.get(entityId)?._syn;
  }

  /**
   * A hometown that is not a catalog locality may still name a country or a
   * region ("Puebla", "Puebla, Mexico", "Cebu", "Boston, Massachusetts"): the
   * country-level world then still shapes the deck, while nothing claims to be
   * a place in that town.
   */
  inferRegion(query: string): SyntheticRegion | null {
    // A catalogue city leading the text names no region by itself: only the
    // rest can ("London, Ontario"), so "Los Angeles, Chile" is not Angeles, PH.
    // A US state code as a whole qualifier ("York, PA", "Delhi, NY") likewise
    // leaves the town out and means the United States, unless another
    // qualifier names a region; mid-text it is just a word ("la", "in").
    const [head = "", ...rest] = query.split(",");
    const lead = this.localities.some((l) => [l.name, ...l.akas].some((n) => phrase(n) === phrase(head)));
    const qualifiers = rest.filter((q) => !US_STATE_CODES.has(phrase(q)));
    const stateCode = qualifiers.length < rest.length;
    const words = tokens(lead || stateCode ? qualifiers.join(",") : query);
    // The longest matching name is the most specific ("buffalo, new york" is
    // not York; "la paz, bolivia" is not La Paz, Mexico); at equal length a
    // city beats a country word, then file order decides.
    let best: { region: SyntheticRegion; score: number } | null = null;
    for (const region of this.regions) {
      const score = Math.max(
        longestRun(words, region.cities) * 2 + 1,
        longestRun(words, region.keywords) * 2,
        region.code === "US" && stateCode ? 1.5 : 0,
      );
      if (score > 1 && (!best || score > best.score)) best = { region, score };
    }
    return best?.region ?? null;
  }

  resolveLocality(query: string | undefined): SyntheticLocality | null {
    if (!query) return null;
    const located = this.localities.find((l) =>
      isTypedPlace(query, { ...l.properties?.geocode, name: l.name, akas: l.akas, disambiguation: l.disambiguation }),
    );
    if (located) return located;
    const name = query.trim();
    const region = this.inferRegion(name);
    // Unknown place: synthesize a locality so the location signal still flows
    // through the trace. Its world comes from the country or region the name
    // mentions, or the generic world when nothing is recognised.
    return {
      entity_id: `ffffffff-0000-4000-8000-${createHash("sha256").update(fold(name)).digest("hex").slice(0, 12)}`,
      name,
      key: fold(name).replace(/\s+/g, "_"),
      world: region?.world ?? GENERIC_WORLD,
      akas: [],
      properties: { geocode: region ? { name, country_code: region.code } : { name } },
      location: { lat: 0, lon: 0 },
      disambiguation: region ? `${name}, ${region.name}` : name,
      inferred: true,
    };
  }

  private localityToSearchResult(l: SyntheticLocality): QlooSearchResult {
    return {
      name: l.name,
      entity_id: l.entity_id,
      types: ["urn:entity:locality"],
      properties: { ...l.properties, akas: l.akas.map((value) => ({ value })) },
      popularity: 0.9,
      tags: [],
      disambiguation: l.disambiguation,
      location: l.location,
    };
  }

  private strip(e: SyntheticEntity): QlooEntity {
    const rest = { ...e } as Partial<SyntheticEntity>;
    delete rest._syn;
    return rest as QlooEntity;
  }

  search(params: Record<string, string>): QlooSearchResponse {
    const query = fold(params.query ?? "");
    const types = splitList(params.types);
    const take = Math.max(1, Math.min(50, Number(params.take ?? 8) || 8));
    if (query.length === 0) return { results: [], duration: 12, _fixture: { source: "synthetic", note: SYNTHETIC_NOTE } };

    const wantsLocality = types.length === 0 || types.includes("urn:entity:locality");
    const wantsEntityType = (subtype: string) => types.length === 0 || types.includes(subtype);

    const scored: { score: number; result: QlooSearchResult }[] = [];
    for (const e of this.entities) {
      if (!wantsEntityType(e.subtype)) continue;
      const names = [e.name, ...(e.properties?.akas ?? []).map((a) => a.value)].map(fold);
      let score = 0;
      for (const n of names) {
        if (n === query) score = Math.max(score, 3);
        else if (n.startsWith(query)) score = Math.max(score, 2);
        else if (n.includes(query)) score = Math.max(score, 1);
      }
      if (score === 0) continue;
      const base = this.strip(e);
      scored.push({
        score: score + (e.popularity ?? 0),
        result: {
          name: base.name,
          entity_id: base.entity_id,
          types: [base.subtype],
          properties: base.properties,
          popularity: base.popularity,
          tags: base.tags,
          disambiguation: base.disambiguation,
          location: base.location,
        },
      });
    }
    if (wantsLocality) {
      let localityHits = 0;
      for (const l of this.localities) {
        const names = [l.name, ...l.akas].map(fold);
        let score = 0;
        for (const n of names) {
          if (n === query) score = Math.max(score, 3);
          else if (n.startsWith(query)) score = Math.max(score, 2);
          else if (n.includes(query)) score = Math.max(score, 1);
        }
        if (score > 0) {
          localityHits += 1;
          scored.push({ score: score + 0.5, result: this.localityToSearchResult(l) });
        }
      }
      // A town the catalog does not list but whose country it recognises still
      // resolves, so the planner learns the country and the deck stays regional.
      if (localityHits === 0 && types.includes("urn:entity:locality")) {
        const resolved = this.resolveLocality(params.query);
        if (resolved && (!resolved.inferred || resolved.world !== GENERIC_WORLD)) {
          scored.push({ score: 0.5, result: this.localityToSearchResult(resolved) });
        }
      }
    }
    scored.sort((a, b) => b.score - a.score || a.result.name.localeCompare(b.result.name));
    return {
      results: scored.slice(0, take).map((s) => s.result),
      duration: fakeDuration(query),
      _fixture: { source: "synthetic", note: SYNTHETIC_NOTE },
    };
  }

  tags(params: Record<string, string>): QlooTagsResponse {
    const query = fold(params["filter.query"] ?? "");
    const parents = splitList(params["filter.parents.types"]);
    const take = Math.max(1, Math.min(50, Number(params.take ?? 10) || 10));
    const matches = this.tagList.filter((t) => {
      if (parents.length > 0 && !t.parents.some((p) => parents.includes(p.type))) return false;
      if (query.length === 0) return true;
      return fold(t.name).includes(query) || fold(t.id).includes(query.replace(/\s+/g, "_"));
    });
    matches.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.name.localeCompare(b.name));
    return {
      success: true,
      results: { tags: matches.slice(0, take).map((t) => ({ ...t })) },
      duration: fakeDuration(query),
      _fixture: { source: "synthetic", note: SYNTHETIC_NOTE },
    };
  }

  insights(params: Record<string, string>): QlooInsightsResponse {
    const type = params["filter.type"] ?? "";
    const seeds = splitList(params["signal.interests.entities"]);
    const signalTags = splitList(params["signal.interests.tags"]);
    const filterTags = splitList(params["filter.tags"]);
    const exclude = new Set(splitList(params["filter.exclude.entities"]));
    const ages = splitList(params["signal.demographics.age"]);
    const releaseMin = numberOr(params["filter.release_year.min"]);
    const releaseMax = numberOr(params["filter.release_year.max"]);
    const pubMin = numberOr(params["filter.publication_year.min"]);
    const pubMax = numberOr(params["filter.publication_year.max"]);
    const releaseCountries = splitList(params["filter.release_country"]).map(fold);
    const countryCode = params["filter.geocode.country_code"]?.toUpperCase();
    const popularityMin = numberOr(params["filter.popularity.min"]);
    const take = Math.max(1, Math.min(50, Number(params.take ?? 20) || 20));
    const page = Math.max(1, Number(params.page ?? 1) || 1);
    const explain = params["feature.explainability"] === "true";

    const signalLocality = this.resolveLocality(params["signal.location.query"]);
    const filterLocality = this.resolveLocality(params["filter.location.query"]);
    const seedEntities = seeds.map((id) => this.byId.get(id)).filter((e): e is SyntheticEntity => !!e);
    // Favourites tied to one region (Pedro Infante) say where someone is from;
    // names the whole world shares (The Beatles) do not.
    const regionalSeeds = seedEntities.filter((e) => !worldsOf(e._syn).includes(GENERIC_WORLD));
    const seedWorlds = new Set(regionalSeeds.flatMap((e) => worldsOf(e._syn)));
    const seedCountries = new Set(regionalSeeds.flatMap((e) => e._syn.countries ?? []));
    // A hometown in the generic world: a catalog city (Madrid) or a town whose
    // country was recognised but has no regional catalogue (Berlin).
    const homeIsGeneric =
      !!signalLocality && signalLocality.world === GENERIC_WORLD && (!signalLocality.inferred || !!signalLocality.properties?.geocode?.country_code);

    // The "home" taste profile: the hometown's world when it is known or can be
    // inferred, otherwise the world(s) of the regional favourites. A person from
    // Mexico City, or one who loved Pedro Infante, is scored against Mexico either way.
    const homeWorlds = new Set<string>();
    let homeCountry: string | undefined;
    if (signalLocality && signalLocality.world !== GENERIC_WORLD) {
      homeWorlds.add(signalLocality.world);
      homeCountry = signalLocality.properties?.geocode?.country_code;
    } else if (!homeIsGeneric && seedWorlds.size > 0) {
      for (const w of seedWorlds) homeWorlds.add(w);
      if (seedCountries.size === 1) homeCountry = [...seedCountries][0];
    }
    // No regional home: international names only, plus regional names a favourite points at.
    const internationalOnly = homeWorlds.size === 0 && !!signalLocality;

    const scored: { entity: SyntheticEntity; affinity: number; contributions: Record<string, number> }[] = [];
    for (const e of this.entities) {
      if (e.subtype !== type) continue;
      if (exclude.has(e.entity_id) || seeds.includes(e.entity_id)) continue;
      const year = e.properties?.release_year ?? e.properties?.publication_year;
      if (releaseMin !== undefined && (year === undefined || year < releaseMin)) continue;
      if (releaseMax !== undefined && (year === undefined || year > releaseMax)) continue;
      if (pubMin !== undefined && (year === undefined || year < pubMin)) continue;
      if (pubMax !== undefined && (year === undefined || year > pubMax)) continue;
      if (releaseCountries.length > 0) {
        const countries = (e.properties?.release_country ?? []).map(fold);
        if (!countries.some((c) => releaseCountries.includes(c))) continue;
      }
      if (countryCode && e.properties?.geocode?.country_code?.toUpperCase() !== countryCode) continue;
      if (popularityMin !== undefined && (e.popularity ?? 0) < popularityMin) continue;
      const tagIds = new Set((e.tags ?? []).map((t) => t.id));
      if (filterTags.length > 0 && !filterTags.some((t) => tagIds.has(t))) continue;
      if (filterLocality) {
        // A place is only "in" a town the catalog lists it under. A town the
        // catalog does not know gets no places at all rather than another city's.
        const locs = e._syn.localities ?? [];
        if (!locs.includes(filterLocality.key)) continue;
      }

      const eWorlds = worldsOf(e._syn);
      const eCountries = e._syn.countries ?? [];
      const isGeneric = eWorlds.includes(GENERIC_WORLD);
      const inHomeWorld = eWorlds.some((w) => homeWorlds.has(w));
      if (internationalOnly && !isGeneric && !seedEntities.some((seed) => e._syn.related?.[seed.entity_id] !== undefined)) continue;

      let score = 0.3 * (e.popularity ?? 0.5);
      const contributions: Record<string, number> = {};
      let bestSeed = 0;
      for (const seed of seedEntities) {
        const explicit = e._syn.related?.[seed.entity_id];
        const sWorlds = worldsOf(seed._syn);
        const sameWorld = sWorlds.some((w) => eWorlds.includes(w));
        const sameCountry = (seed._syn.countries ?? []).some((c) => eCountries.includes(c));
        const r = explicit ?? (sameWorld ? (isGeneric && sWorlds.includes(GENERIC_WORLD) ? 0.2 : sameCountry || eCountries.length === 0 ? 0.35 : 0.25) : 0.05);
        contributions[seed.entity_id] = round4(r);
        bestSeed = Math.max(bestSeed, r);
      }
      if (seedEntities.length > 0) score += 0.5 * bestSeed;
      else if (seedWorlds.size === 0) score += 0.2;

      if (signalTags.length > 0) {
        const hits = signalTags.filter((t) => tagIds.has(t)).length;
        score += 0.15 * Math.min(1, hits / signalTags.length);
      }

      if (homeWorlds.size > 0) {
        const locs = e._syn.localities ?? [];
        if (signalLocality && !signalLocality.inferred && locs.includes(signalLocality.key)) score += 0.18;
        else if (inHomeWorld && homeCountry && eCountries.includes(homeCountry)) score += 0.12;
        else if (inHomeWorld && eCountries.length === 0) score += 0.08;
        else if (inHomeWorld) score += 0.02;
        else if (isGeneric) score -= 0.12;
        else score -= 0.2;
      } else if (signalLocality) {
        // A generic-world or unknown hometown: its own places first (Madrid), then
        // international names, then regional names a favourite points at.
        const locs = e._syn.localities ?? [];
        if (!signalLocality.inferred && locs.includes(signalLocality.key)) score += 0.18;
        else if (isGeneric) score += 0.08;
        else score -= 0.12;
      }

      if (ages.length > 0 && e._syn.era) {
        const older = ages.some((a) => a === "55_and_older" || a === "45_to_54" || a === "35_to_44");
        if (older && e._syn.era[0] <= 1985) score += 0.05;
        if (!older && e._syn.era[1] >= 2000) score += 0.05;
      }

      scored.push({ entity: e, affinity: round4(Math.min(0.99, Math.max(0.02, score))), contributions });
    }

    scored.sort((a, b) => b.affinity - a.affinity || a.entity.name.localeCompare(b.entity.name));
    const start = (page - 1) * take;
    const pageItems = scored.slice(start, start + take);

    const entities: QlooEntity[] = pageItems.map(({ entity, affinity, contributions }) => {
      const base = this.strip(entity);
      const query: QlooEntity["query"] = { affinity };
      if (explain && Object.keys(contributions).length > 0) {
        query.explainability = {
          entities: Object.fromEntries(Object.entries(contributions).filter(([, v]) => v >= 0.1)),
        };
      }
      return { ...base, query };
    });

    const response: QlooInsightsResponse = {
      success: true,
      results: { entities },
      duration: fakeDuration(canonicalRequestKey({ path: "/v2/insights", params })),
      _fixture: { source: "synthetic", note: SYNTHETIC_NOTE },
    };
    const localityQuery: NonNullable<QlooInsightsResponse["query"]> = {};
    if (signalLocality) {
      localityQuery.locality = {
        signal: { entity_id: signalLocality.entity_id, name: signalLocality.name, subtype: "urn:entity:locality" },
      };
    }
    if (filterLocality) {
      localityQuery.locality = {
        ...(localityQuery.locality ?? {}),
        filter: { entity_id: filterLocality.entity_id, name: filterLocality.name, subtype: "urn:entity:locality" },
      };
    }
    if (Object.keys(localityQuery).length > 0) response.query = localityQuery;
    return response;
  }
}

function numberOr(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

let synthetic: SyntheticQloo | null = null;
export function getSyntheticQloo(): SyntheticQloo {
  if (!synthetic) synthetic = new SyntheticQloo();
  return synthetic;
}
