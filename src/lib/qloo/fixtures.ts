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

import jpCatalog from "../../../fixtures/synthetic/jp.json";
import usCatalog from "../../../fixtures/synthetic/us.json";
import worldCatalog from "../../../fixtures/synthetic/world.json";
import localitiesData from "../../../fixtures/synthetic/localities.json";
import tagsData from "../../../fixtures/synthetic/tags.json";
import { toQueryString } from "./params";
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
  world: string;
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
} {
  const catalogs = [jpCatalog, usCatalog, worldCatalog] as unknown as SyntheticCatalog[];
  const entities = catalogs.flatMap((c) => c.entities);
  return {
    entities,
    localities: (localitiesData as { localities: SyntheticLocality[] }).localities,
    tags: (tagsData as { tags: SyntheticTag[] }).tags,
  };
}

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
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

  constructor(data = loadSyntheticCatalog()) {
    this.entities = data.entities;
    this.byId = new Map(data.entities.map((e) => [e.entity_id, e]));
    this.localities = data.localities;
    this.tagList = data.tags;
  }

  resolveLocality(query: string | undefined): SyntheticLocality | null {
    if (!query) return null;
    const q = fold(query);
    const exact = this.localities.find((l) => fold(l.name) === q || l.akas.some((a) => fold(a) === q));
    if (exact) return exact;
    const partial = this.localities.find(
      (l) => fold(l.name).includes(q) || q.includes(fold(l.name)) || l.akas.some((a) => fold(a).includes(q)),
    );
    if (partial) return partial;
    // Unknown place: synthesize a locality so the location signal still flows
    // through the trace. Marked by the generic world.
    const name = query.trim();
    return {
      entity_id: `ffffffff-0000-4000-8000-${createHash("sha256").update(fold(name)).digest("hex").slice(0, 12)}`,
      name,
      key: fold(name).replace(/\s+/g, "_"),
      world: "generic",
      akas: [],
      properties: { geocode: { name } },
      location: { lat: 0, lon: 0 },
      disambiguation: name,
    };
  }

  private localityToSearchResult(l: SyntheticLocality): QlooSearchResult {
    return {
      name: l.name,
      entity_id: l.entity_id,
      types: ["urn:entity:locality"],
      properties: l.properties,
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
      for (const l of this.localities) {
        const names = [l.name, ...l.akas].map(fold);
        let score = 0;
        for (const n of names) {
          if (n === query) score = Math.max(score, 3);
          else if (n.startsWith(query)) score = Math.max(score, 2);
          else if (n.includes(query)) score = Math.max(score, 1);
        }
        if (score > 0) scored.push({ score: score + 0.5, result: this.localityToSearchResult(l) });
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
    const seedWorlds = new Set(seedEntities.map((e) => e._syn.world));

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
        const locs = e._syn.localities ?? [];
        const inLocality = locs.includes(filterLocality.key) || (filterLocality.world === "generic" && e._syn.world === "generic");
        if (!inLocality) continue;
      }

      let score = 0.3 * (e.popularity ?? 0.5);
      const contributions: Record<string, number> = {};
      let bestSeed = 0;
      for (const seed of seedEntities) {
        const explicit = e._syn.related?.[seed.entity_id];
        const sameWorld = seed._syn.world === e._syn.world;
        const r = explicit ?? (sameWorld ? (e._syn.world === "generic" ? 0.2 : 0.35) : 0.05);
        contributions[seed.entity_id] = round4(r);
        bestSeed = Math.max(bestSeed, r);
      }
      if (seedEntities.length > 0) score += 0.5 * bestSeed;
      else if (seedWorlds.size === 0) score += 0.2;

      if (signalTags.length > 0) {
        const hits = signalTags.filter((t) => tagIds.has(t)).length;
        score += 0.15 * Math.min(1, hits / signalTags.length);
      }

      if (signalLocality) {
        const locs = e._syn.localities ?? [];
        if (locs.includes(signalLocality.key)) score += 0.18;
        else if (signalLocality.world !== "generic" && e._syn.world === signalLocality.world) score += 0.08;
        else if (signalLocality.world !== "generic" && e._syn.world !== "generic") score -= 0.2;
        else if (signalLocality.world === "generic" && e._syn.world !== "generic") score -= 0.12;
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
