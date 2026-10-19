/**
 * The agent's five tools: argument schemas plus the server-side runtime that
 * executes them against the Qloo client.
 *
 * Every Qloo call made through these tools is recorded in an EntityPool, so
 * `plan_session` / `adapt_session` can only commit entities the agent actually
 * fetched, and every card carries the exact request that produced it.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { QlooClient, QlooResult } from "@/lib/qloo/client";
import type { InsightsRequest } from "@/lib/qloo/params";
import {
  QLOO_AGE_BUCKETS,
  QLOO_ENTITY_TYPES,
  QLOO_SEARCH_TYPES,
  entityAffinity,
  entityImageUrl,
  entityYear,
  genreTagIdsOf,
  type QlooAgeBucket,
  type QlooEntity,
  type QlooEntityType,
  type QlooInsightsResponse,
  type QlooSearchResponse,
  type QlooTagsResponse,
} from "@/lib/qloo/types";
import {
  DOMAINS,
  DOMAIN_INFO,
  type Card,
  type CardSignals,
  type Domain,
  type Favorite,
  type Language,
  type Person,
  type QlooSource,
  type Reaction,
  type TracePreviewItem,
  type TraceQloo,
  type YouthWindow,
} from "@/lib/session/types";
import { isAgeBucket } from "@/lib/session/youth-window";

import { dictionary } from "@/lib/i18n";
import { PLAN_MAX_CARDS, PLAN_MIN_CARDS, PLAN_MIN_DOMAINS } from "@/lib/session/deck";

import { offlinePrompt, whyLine } from "./prompts";
import { artistFit, type SeedProfile } from "./relevance";
import { ArtistLedger, artistAliasesOf, artistKeysOf, isMatureTitle, ledgerOfCards } from "./suitability";

// ---------------------------------------------------------------------------
// Argument schemas (zod validates every policy's arguments)
// ---------------------------------------------------------------------------

export const SearchEntityArgs = z.object({
  query: z.string().min(1).max(120).describe("The name to look up, e.g. an artist, film, dish, place or hometown."),
  types: z
    .array(z.enum(QLOO_SEARCH_TYPES))
    .max(8)
    .optional()
    .describe("Restrict to these Qloo types. Use urn:entity:locality to resolve a hometown or city."),
  take: z.number().int().min(1).max(20).optional().describe("Max results (default 5)."),
});

export const SearchTagsArgs = z.object({
  query: z.string().min(1).max(80).describe("Keyword to find tags for, e.g. 'restaurant', 'landmark', 'enka'."),
  parent_type: z
    .enum(QLOO_ENTITY_TYPES)
    .optional()
    .describe("Only tags that apply to this entity type (filter.parents.types)."),
  take: z.number().int().min(1).max(20).optional(),
});

export const InsightsArgs = z.object({
  filter_type: z.enum(QLOO_ENTITY_TYPES).describe("Qloo filter.type to recommend."),
  purpose: z.string().max(160).optional().describe("One short line on why you are making this call; shown in the trace."),
  signal_entities: z
    .array(z.string().min(8))
    .max(10)
    .optional()
    .describe("Qloo entity ids (from qloo_search_entity or earlier results) to use as taste signals: signal.interests.entities."),
  signal_location_query: z.string().max(80).optional().describe("Hometown or region name: signal.location.query."),
  signal_age: z.enum(QLOO_AGE_BUCKETS).optional().describe("signal.demographics.age bucket for the person today."),
  signal_tags: z.array(z.string()).max(10).optional().describe("Valid tag ids as taste signals: signal.interests.tags."),
  filter_tags: z.array(z.string()).max(10).optional().describe("Valid tag ids from qloo_search_tags: filter.tags."),
  filter_location_query: z
    .string()
    .max(80)
    .optional()
    .describe("Only for place/destination: restrict results to this locality (filter.location.query)."),
  filter_release_country: z
    .array(z.string())
    .max(5)
    .optional()
    .describe("Only for movie/tv_show: country names such as 'Japan' or 'United States' (filter.release_country)."),
  release_year_min: z.number().int().optional().describe("Only for movie/tv_show: filter.release_year.min."),
  release_year_max: z.number().int().optional().describe("Only for movie/tv_show: filter.release_year.max."),
  exclude_entities: z.array(z.string()).max(60).optional().describe("Entity ids to leave out: filter.exclude.entities."),
  take: z.number().int().min(1).max(25).optional().describe("Max results (default 10)."),
});

const CardArg = z.object({
  entity_id: z.string().describe("An entity id returned by qloo_insights in this session."),
  domain: z.enum(DOMAINS).describe("music, film, tv, dining, place or destination."),
  prompt: z
    .string()
    .max(300)
    .optional()
    .describe("A warm, open conversation prompt in the person's language. One question, at most 25 words."),
});

export const PlanArgs = z.object({
  cards: z.array(CardArg).min(1).max(14).describe("8 to 10 cards across at least 3 domains, best first."),
});

export const AdaptArgs = z.object({
  replacements: z
    .array(
      CardArg.extend({
        replaces_entity_id: z.string().describe("Entity id of the upcoming card to replace."),
      }),
    )
    .min(1)
    .max(5),
});

export const TOOL_NAMES = [
  "qloo_search_entity",
  "qloo_search_tags",
  "qloo_insights",
  "plan_session",
  "adapt_session",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface PoolEntry {
  entity: QlooEntity;
  qlooType: QlooEntityType;
  /** The session domain the call that fetched it was filling (dining and landmarks are both places). */
  domain?: Domain;
  params: Record<string, string>;
  source: QlooSource;
  status: number;
  durationMs: number;
  warnings: string[];
  rank: number;
  seedIds: string[];
  seedNames: string[];
  /** Artists: how well the entity fits the person behind the seed (see relevance.ts); orders the deck ahead of raw affinity. */
  fit?: number;
}

/** Every entity the agent has fetched this run, keyed by entity id. */
export class EntityPool {
  private readonly entries = new Map<string, PoolEntry>();

  add(entry: PoolEntry): void {
    const existing = this.entries.get(entry.entity.entity_id);
    const incoming = entry.fit ?? entityAffinity(entry.entity) ?? -1;
    const current = existing ? (existing.fit ?? entityAffinity(existing.entity) ?? -1) : -Infinity;
    if (!existing || incoming > current) this.entries.set(entry.entity.entity_id, entry);
  }

  get(id: string): PoolEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  byType(type: QlooEntityType): PoolEntry[] {
    return [...this.entries.values()].filter((e) => e.qlooType === type);
  }

  all(): PoolEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface Feedback {
  card: Card;
  reaction: Reaction;
  currentIndex: number;
  /** Entities to keep out besides the deck's own cards. */
  exclude: string[];
}

export interface ToolContext {
  qloo: QlooClient;
  person: Person;
  /** Working copy of person.favorites; search results fill in entity ids. */
  favorites: Favorite[];
  language: Language;
  youthWindow: YouthWindow;
  ageBucket: QlooAgeBucket;
  phase: "plan" | "adapt";
  pool: EntityPool;
  /** entity id -> display name, for seeds that came from search rather than insights. */
  names: Map<string, string>;
  /** entity id -> what is known of a seed (its music genres): from the intake form, search results and cards already dealt. */
  seeds: Map<string, SeedProfile>;
  existingCards: Card[];
  feedback?: Feedback;
  /** Qloo's name for the hometown's country ("Japan"), once known: films and TV are kept to its releases. */
  homeCountry?: string;
  now: Date;
  /** Epoch-ms deadline shared by the loop and every Qloo request it makes. */
  deadline: number;
}

export type ToolFinal = { kind: "plan"; cards: Card[] } | { kind: "adapt"; replacements: Card[] };

export interface ToolOutcome {
  ok: boolean;
  /** JSON-serialisable result handed back to the policy (and the LLM). */
  result: unknown;
  /** One line for the trace. */
  summary: string;
  qloo?: TraceQloo;
  /** Earlier Qloo requests this call made before widening, oldest first. */
  attempts?: { summary: string; qloo: TraceQloo }[];
  /** Insights only: the session domain and its first few entities. */
  domain?: Domain;
  preview?: TracePreviewItem[];
  final?: ToolFinal;
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export async function executeTool(name: ToolName, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case "qloo_search_entity":
      return runSearchEntity(rawArgs, ctx);
    case "qloo_search_tags":
      return runSearchTags(rawArgs, ctx);
    case "qloo_insights":
      return runInsights(rawArgs, ctx);
    case "plan_session":
      return runPlan(rawArgs, ctx);
    case "adapt_session":
      return runAdapt(rawArgs, ctx);
  }
}

function argError(name: string, error: z.ZodError): ToolOutcome {
  const issues = error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`);
  return { ok: false, result: { ok: false, error: "invalid arguments", issues }, summary: `${name}: invalid arguments (${issues[0]})` };
}

function traceOf<T>(res: QlooResult<T>, count: number): TraceQloo {
  return {
    path: res.request.path,
    params: res.request.params,
    source: res.source,
    status: res.status,
    durationMs: res.durationMs,
    resultCount: count,
    warnings: res.warnings,
    ...(res.cached ? { cached: true } : {}),
  };
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function short(text: string | undefined, max = 140): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Up to three tag names for a card or the model; Qloo leaves some tags without a name. */
function tagNamesOf(e: QlooEntity): string[] {
  return (e.tags ?? []).map((t) => t?.name).filter((n): n is string => typeof n === "string" && n.length > 0).slice(0, 3);
}

function compactEntity(e: QlooEntity) {
  return {
    entity_id: e.entity_id,
    name: e.name,
    type: e.subtype,
    year: entityYear(e),
    affinity: entityAffinity(e),
    popularity: typeof e.popularity === "number" ? Math.round(e.popularity * 100) / 100 : undefined,
    tags: tagNamesOf(e),
    description: short(e.properties?.short_description ?? e.properties?.description, 120),
    has_image: !!entityImageUrl(e),
  };
}

/**
 * Order favorite matches so the first is one Qloo can use as a taste signal.
 * Search can put a bare person record first ("Hibari Misora", no popularity)
 * ahead of the artist ("Misora Hibari"); Insights rejects such a seed, or with
 * a location signal silently ignores it and answers for the city alone. So:
 * the same name first (in any word order), then anything but a person, then
 * hits with a popularity score, then Qloo's own order.
 */
export function rankFavoriteHits<T extends { name: string; types: string[]; popularity?: number | null }>(query: string, hits: T[]): T[] {
  const words = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort().join(" ");
  const wanted = words(query);
  const score = (h: T) => (words(h.name) === wanted ? 0 : 4) + (h.types.every((t) => t === "urn:entity:person") ? 2 : 0) + (typeof h.popularity === "number" ? 0 : 1);
  return hits.map((h, i) => ({ h, i, s: score(h) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.h);
}

async function runSearchEntity(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = SearchEntityArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("qloo_search_entity", parsed.error);
  const args = parsed.data;
  const res = await ctx.qloo.search(args.query, { types: args.types, take: args.take ?? 5, deadline: ctx.deadline });
  const hits = args.types?.includes("urn:entity:locality") ? res.body.results : rankFavoriteHits(args.query, res.body.results);
  const results = hits.map((r) => {
    ctx.names.set(r.entity_id, r.name);
    ctx.seeds.set(r.entity_id, { name: r.name, genres: genreTagIdsOf(r.tags) });
    return {
      entity_id: r.entity_id,
      name: r.name,
      types: r.types,
      year: entityYear(r),
      popularity: typeof r.popularity === "number" ? Math.round(r.popularity * 100) / 100 : undefined,
      disambiguation: r.disambiguation,
      country_code: r.properties?.geocode?.country_code,
      akas: r.types.includes("urn:entity:locality") ? r.properties?.akas?.map((a) => a.value) : undefined,
      description: short(r.properties?.short_description ?? r.properties?.description, 100),
      image_url: entityImageUrl(r),
    };
  });
  const top = results[0];
  if (top && !top.types.includes("urn:entity:locality")) {
    const fav = ctx.favorites.find((f) => !f.entityId && fold(f.name) === fold(args.query));
    if (fav) {
      fav.entityId = top.entity_id;
      fav.type = top.types[0];
      fav.imageUrl = top.image_url;
      fav.genres = genreTagIdsOf(hits[0]?.tags);
      // The seed answers to the name the caregiver typed ("Hibari Misora"), not Qloo's order of it ("Misora Hibari").
      ctx.names.set(top.entity_id, fav.name);
    }
  }
  return {
    ok: true,
    result: { results },
    summary: args.types?.includes("urn:entity:locality")
      ? top
        ? `Resolved "${args.query}" to ${top.name}${top.disambiguation ? ` (${top.disambiguation})` : ""}`
        : `No locality found for "${args.query}"; using the name as typed`
      : top
        ? `Looked up "${args.query}": ${results.length} match${results.length === 1 ? "" : "es"}, best ${top.name}`
        : `Looked up "${args.query}": no entity found`,
    qloo: traceOf(res, results.length),
  };
}

async function runSearchTags(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = SearchTagsArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("qloo_search_tags", parsed.error);
  const args = parsed.data;
  const res = await ctx.qloo.searchTags(args.query, {
    parentTypes: args.parent_type ? [args.parent_type] : undefined,
    take: args.take ?? 8,
    deadline: ctx.deadline,
  });
  const tags = res.body.results.tags.map((t) => ({ id: t.id, name: t.name, type: t.type ?? t.subtype }));
  return {
    ok: true,
    result: { tags },
    summary: `Found ${tags.length} Qloo tag${tags.length === 1 ? "" : "s"} for "${args.query}"${tags[0] ? `, first ${tags[0].name}` : ""}`,
    qloo: traceOf(res, tags.length),
  };
}

export function insightsRequestFromArgs(args: z.infer<typeof InsightsArgs>): InsightsRequest {
  return {
    type: args.filter_type,
    signals: {
      entities: args.signal_entities,
      tags: args.signal_tags,
      locationQuery: args.signal_location_query,
      age: args.signal_age ? [args.signal_age] : undefined,
    },
    filters: {
      tags: args.filter_tags,
      excludeEntities: args.exclude_entities,
      releaseYearMin: args.release_year_min,
      releaseYearMax: args.release_year_max,
      releaseCountry: args.filter_release_country,
      locationQuery: args.filter_location_query,
    },
    take: args.take ?? 10,
    explainability: true,
  };
}

/** Release years a film or TV card may come from: the youth window, and for TV the five years before it (what was on at home). */
export function eraFor(type: QlooEntityType, youthWindow: YouthWindow): [number, number] | undefined {
  if (type === "urn:entity:movie") return [youthWindow.start, youthWindow.end];
  if (type === "urn:entity:tv_show") return [youthWindow.start - 5, youthWindow.end];
  return undefined;
}

/**
 * Qloo's tag ids for restaurants, tourist attractions and landmarks. They are
 * the same for every session, so the planners use them directly instead of
 * spending a /v2/tags call (and a model turn) to find them each time.
 */
export const PLACE_TAGS = {
  restaurant: "urn:tag:genre:place:restaurant",
  touristAttraction: "urn:tag:genre:place:tourist_attraction",
  landmark: "urn:tag:genre:place:landmark",
} as const;

/** The session domain an Insights call fills. A place call is dining when it filters by a restaurant tag. */
export function domainForInsights(filterType: string, filterTags?: readonly string[]): Domain | undefined {
  switch (filterType) {
    case "urn:entity:artist":
      return "music";
    case "urn:entity:movie":
      return "film";
    case "urn:entity:tv_show":
      return "tv";
    case "urn:entity:destination":
      return "destination";
    case "urn:entity:place":
      return filterTags?.some((t) => /restaurant|dining|food/.test(t) && !/tourist_attraction|landmark/.test(t)) ? "dining" : "place";
    default:
      return undefined;
  }
}

/** Fewer results than this and the tool widens the request itself, so the policy never has to retry. */
export const MIN_USEFUL_RESULTS = 3;
/** Artists are asked for in a larger page, since the era check can leave out many of a page's modern names. */
const ARTIST_PAGE = 25;
/** Time a widening step needs; with less left the tool answers with what it has. */
const WIDEN_MIN_TIME_MS = 3_000;

type InsightsArgsT = z.infer<typeof InsightsArgs>;

/**
 * Keep media inside the person's years whatever the policy asked for: missing
 * year filters are filled in and wider ones are narrowed to the era. A 1960s
 * youth window never gets a 2018 show.
 */
function keepEra(args: InsightsArgsT, ctx: ToolContext, notes: string[]): InsightsArgsT {
  const era = eraFor(args.filter_type, ctx.youthWindow);
  if (!era) return args;
  const [lo, hi] = era;
  const min = Math.min(Math.max(args.release_year_min ?? lo, lo), hi);
  const max = Math.max(Math.min(args.release_year_max ?? hi, hi), min);
  if (min !== args.release_year_min || max !== args.release_year_max) {
    if (args.release_year_min !== undefined || args.release_year_max !== undefined) notes.push(`kept to ${min} to ${max}`);
  }
  return { ...args, release_year_min: min, release_year_max: max };
}

/**
 * Keep films and TV to the hometown country's releases whatever the policy
 * asked for, the way keepEra keeps them to the years: a missing country is
 * filled in, and a list without it gets it. An Osaka youth gets Japanese
 * films first, not Star Wars.
 */
function keepHome(args: InsightsArgsT, ctx: ToolContext, notes: string[]): InsightsArgsT {
  if (!ctx.homeCountry || !eraFor(args.filter_type, ctx.youthWindow)) return args;
  const asked = args.filter_release_country ?? [];
  if (asked.some((c) => c.toLowerCase() === ctx.homeCountry!.toLowerCase())) return args;
  if (asked.length > 0) notes.push(`kept to ${ctx.homeCountry} releases`);
  return { ...args, filter_release_country: [ctx.homeCountry, ...asked].slice(0, 5) };
}

/** What is known of the seeds an Insights call names; ids nothing is known of are left out. */
function profilesOf(ids: readonly string[], ctx: ToolContext): SeedProfile[] {
  return ids
    .map((id) => {
      const known = ctx.seeds.get(id);
      if (known) return known;
      const pooled = ctx.pool.get(id)?.entity;
      return pooled ? { name: pooled.name, genres: genreTagIdsOf(pooled.tags) } : undefined;
    })
    .filter((p): p is SeedProfile => !!p);
}

/**
 * Keep a seeded artist call about the seed. Qloo blends every signal, and live
 * the hometown signal is what drowns a niche seed (a skiffle fan from London
 * came back as Dolly Parton and Twiggy; the age bucket pulls the same way). So
 * the call carries the seed alone, and the person's years and country are
 * applied to what comes back (see relevance.ts). The hometown it left out is
 * handed back so the widening can try it if the seed alone returns too little.
 */
function keepSeed(args: InsightsArgsT, ctx: ToolContext, notes: string[]): { args: InsightsArgsT; leftOut?: string } {
  if (args.filter_type !== "urn:entity:artist" || !args.signal_entities?.length) return { args };
  let next = args;
  let leftOut: string | undefined;
  if (next.signal_age) {
    next = { ...next, signal_age: undefined };
    notes.push("left the age signal out so the seed leads");
  }
  // The synthetic catalogue has no birthplaces to rank by and needs the hometown to know which world to serve.
  if (next.signal_location_query && ctx.qloo.mode === "live") {
    leftOut = next.signal_location_query;
    next = { ...next, signal_location_query: undefined };
    notes.push("left the hometown signal out so the seed leads");
  }
  return { args: next, leftOut };
}

interface WideningStep {
  args: InsightsArgsT;
  note: string;
  /** Leaves the home country's releases: only when they gave nothing at all. */
  leavesHome?: boolean;
}

/**
 * Widening steps for a thin answer, tried in order until one brings enough.
 * Each keeps the era. On live Qloo the first matters most: it returns no TV
 * shows at all for a location signal combined with release years (Chicago,
 * 1955 to 1975: none; the same request without the location signal: eight
 * shows from the era). Dropping the release country instead keeps the
 * hometown's own taste, so dropping both comes last; and a few home-country
 * titles beat any number of foreign ones, so those steps run only when the
 * home country had none.
 */
function wideningSteps(args: InsightsArgsT, leftOutLocation?: string): WideningStep[] {
  const steps: WideningStep[] = [];
  const hasLocation = !!args.signal_location_query;
  const hasCountry = !!args.filter_release_country?.length;
  switch (args.filter_type) {
    case "urn:entity:movie":
    case "urn:entity:tv_show":
      if (hasLocation) steps.push({ args: { ...args, signal_location_query: undefined }, note: "without the hometown signal" });
      // Television is what was on at home: another country's shows are never it (live Qloo
      // has no Japanese shows for the 1960s and offers an American science series instead),
      // so a TV call keeps to the home country and an empty answer skips the domain.
      if (args.filter_type === "urn:entity:movie") {
        if (hasCountry) steps.push({ args: { ...args, filter_release_country: undefined }, note: "from any country", leavesHome: true });
        if (hasLocation && hasCountry) {
          steps.push({ args: { ...args, signal_location_query: undefined, filter_release_country: undefined }, note: "without the hometown signal, from any country", leavesHome: true });
        }
      }
      break;
    case "urn:entity:artist":
      // A seeded call left the hometown out; if the seed alone is thin, the hometown is tried as a second signal.
      if (leftOutLocation) steps.push({ args: { ...args, signal_location_query: leftOutLocation }, note: "with the hometown signal" });
      if (hasLocation) steps.push({ args: { ...args, signal_location_query: undefined }, note: "without the hometown signal" });
      break;
    case "urn:entity:place":
      if (args.signal_entities?.length) steps.push({ args: { ...args, signal_entities: undefined }, note: "without the seed taste" });
      break;
    default:
      break;
  }
  return steps;
}

/**
 * Media from outside the era is left out, and so is an artist who could not
 * have been heard in it: one who started after it ended, or was born too late
 * to be performing by then (under 15 when it ended).
 */
function inEra(entity: QlooEntity, type: QlooEntityType, era: [number, number] | undefined, youthWindow: YouthWindow): boolean {
  if (type === "urn:entity:artist") {
    const p = entity.properties ?? {};
    const started = typeof p.start_year === "number" ? p.start_year : NaN;
    const born = typeof p.date_of_birth === "string" ? Number(p.date_of_birth.slice(0, 4)) : NaN;
    return !(started > youthWindow.end) && !(born > youthWindow.end - 15);
  }
  if (!era) return true;
  const year = entityYear(entity);
  return year === undefined || (year >= era[0] && year <= era[1]);
}

/**
 * Television from the home country is a show the country made, not one it
 * also aired: live Qloo lists an American science series under Japan too, so
 * a show counts only when the home country leads its release countries.
 */
function madeAtHome(entity: QlooEntity, type: QlooEntityType, homeCountry: string | undefined): boolean {
  if (type !== "urn:entity:tv_show" || !homeCountry) return true;
  const countries = entity.properties?.release_country;
  if (!Array.isArray(countries) || countries.length === 0) return true;
  return String(countries[0]).toLowerCase() === homeCountry.toLowerCase();
}

const SCREEN_TYPES = new Set<QlooEntityType>(["urn:entity:movie", "urn:entity:tv_show"]);

async function runInsights(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = InsightsArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("qloo_insights", parsed.error);
  const adjustments: string[] = [];
  const seeded = keepSeed(keepHome(keepEra(parsed.data, ctx, adjustments), ctx, adjustments), ctx, adjustments);
  const first = seeded.args;
  const era = eraFor(first.filter_type, ctx.youthWindow);
  const domain = domainForInsights(first.filter_type, first.filter_tags);
  const label = DOMAIN_LABEL_BY_TYPE[first.filter_type] ?? first.filter_type;
  const take = first.take ?? 10;
  const seedIds = first.signal_entities ?? [];
  // Only seeds we can name reach the caregiver's "why" line; an id is never printed.
  const seedNames = seedIds.map((id) => ctx.names.get(id) ?? ctx.pool.get(id)?.entity.name).filter((n): n is string => !!n);

  const steps: WideningStep[] = [{ args: first, note: "" }, ...wideningSteps(first, seeded.leftOut)];
  const attempts: { summary: string; qloo: TraceQloo }[] = [];
  const found = new Map<string, QlooEntity>();
  const fits = new Map<string, number>();
  const isArtist = first.filter_type === "urn:entity:artist";
  const seedProfiles = isArtist ? profilesOf(seedIds, ctx) : [];
  let last: QlooResult<QlooInsightsResponse> | undefined;
  let lastNote = "";
  for (const [index, step] of steps.entries()) {
    if (index > 0 && (found.size >= MIN_USEFUL_RESULTS || ctx.deadline - Date.now() < WIDEN_MIN_TIME_MS)) break;
    if (step.leavesHome && found.size > 0) break;
    if (last) {
      attempts.push({ summary: `${last.body.results.entities.length} ${label}${lastNote ? ` ${lastNote}` : ""}; asking again ${step.note}`, qloo: traceOf(last, last.body.results.entities.length) });
    }
    let res: QlooResult<QlooInsightsResponse>;
    try {
      const page = step.args.filter_type === "urn:entity:artist" ? { ...step.args, take: Math.max(take, ARTIST_PAGE) } : step.args;
      res = await ctx.qloo.insights(insightsRequestFromArgs(page), { deadline: ctx.deadline });
    } catch (error) {
      // The first request's failure is the tool's failure; a widening step's only ends the widening.
      if (index === 0) throw error;
      attempts.pop();
      break;
    }
    const stepSeeds = step.args.signal_entities ?? [];
    const stepSeedNames = stepSeeds.length > 0 ? seedNames : [];
    res.body.results.entities.forEach((entity, rank) => {
      if (!inEra(entity, first.filter_type, era, ctx.youthWindow) || !madeAtHome(entity, first.filter_type, ctx.homeCountry)) return;
      if (SCREEN_TYPES.has(first.filter_type) && isMatureTitle(entity)) return;
      ctx.names.set(entity.entity_id, entity.name);
      // A seeded artist is ordered by how well it fits the person, not by Qloo's affinity alone.
      const fit = isArtist && seedProfiles.length > 0 ? artistFit(entity, { birthYear: ctx.person.birthYear, seeds: seedProfiles, homeCountry: ctx.homeCountry }).score : undefined;
      if (fit !== undefined) fits.set(entity.entity_id, Math.max(fit, fits.get(entity.entity_id) ?? -Infinity));
      ctx.pool.add({
        entity,
        qlooType: first.filter_type,
        domain,
        params: res.request.params,
        source: res.source,
        status: res.status,
        durationMs: res.durationMs,
        warnings: res.warnings,
        rank: rank + 1,
        seedIds: stepSeeds,
        seedNames: stepSeedNames,
        fit,
      });
      // Ranked artists are cut to `take` after the sort; everything else keeps Qloo's order.
      if (!found.has(entity.entity_id) && (fit !== undefined || found.size < take)) found.set(entity.entity_id, entity);
    });
    last = res;
    lastNote = step.note;
  }
  const res = last!;
  const ranked = [...found.values()];
  if (fits.size > 0) ranked.sort((a, b) => (fits.get(b.entity_id) ?? -Infinity) - (fits.get(a.entity_id) ?? -Infinity));
  const entities = ranked.slice(0, take);
  if (lastNote) adjustments.push(`asked again ${lastNote}`);
  const empty = entities.length === 0;
  return {
    ok: true,
    result: {
      filter_type: first.filter_type,
      request: res.request.params,
      source: res.source,
      warnings: res.warnings,
      ...(adjustments.length > 0 ? { adjusted: adjustments } : {}),
      entities: entities.map(compactEntity),
      ...(empty ? { note: "Qloo has nothing for this in the person's years, even widened. Skip this domain; do not retry it." } : {}),
    },
    summary: `${entities.length} ${label} came back${first.purpose ? ` for "${first.purpose}"` : ""}${entities[0] ? `, first ${entities[0].name}` : ""}${
      adjustments.length > 0 ? ` (${adjustments.join("; ")})` : ""
    }${res.warnings.length > 0 ? ` (${res.warnings.length} parameter${res.warnings.length === 1 ? "" : "s"} dropped before sending)` : ""}`,
    qloo: traceOf(res, entities.length),
    attempts: attempts.length > 0 ? attempts : undefined,
    domain,
    preview: entities.slice(0, 3).map((e) => ({ name: e.name, imageUrl: entityImageUrl(e), year: entityYear(e) })),
  };
}

const DOMAIN_LABEL_BY_TYPE: Partial<Record<QlooEntityType, string>> = {
  "urn:entity:artist": "artists",
  "urn:entity:movie": "films",
  "urn:entity:tv_show": "TV shows",
  "urn:entity:place": "places",
  "urn:entity:destination": "destinations",
  "urn:entity:book": "books",
};

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function subtitleFor(domain: Domain, e: QlooEntity, language: Language = "en"): string | undefined {
  const t = dictionary(language).subtitle;
  const p = e.properties ?? {};
  switch (domain) {
    case "music": {
      const dob = typeof p.date_of_birth === "string" ? p.date_of_birth.slice(0, 4) : undefined;
      const place = typeof p.place_of_birth === "string" ? p.place_of_birth.split(",")[0]?.trim() : undefined;
      return [dob ? t.born(dob) : undefined, place].filter(Boolean).join(" · ") || undefined;
    }
    case "film":
    case "tv": {
      const year = entityYear(e);
      const country = Array.isArray(p.release_country) ? p.release_country[0] : undefined;
      return [year ? String(year) : undefined, country].filter(Boolean).join(" · ") || undefined;
    }
    case "dining":
    case "place": {
      const city = p.geocode?.name ?? (typeof p.address === "string" ? p.address.split(",").slice(-2)[0]?.trim() : undefined);
      const closed = p.is_closed ? t.closedNow : undefined;
      return [city, closed].filter(Boolean).join(" · ") || undefined;
    }
    case "destination": {
      const region = p.geocode?.admin1_region;
      const country = p.geocode?.country_code;
      return [region, country].filter(Boolean).join(", ") || undefined;
    }
  }
}

const BECAUSE_DOMAINS: ReadonlySet<Domain> = new Set(["music", "film", "tv", "destination"]);

/**
 * The seed a card is "because of": the one Qloo says contributed most, else the
 * first. A typed favorite is named as the caregiver typed it; any other seed is
 * a card the person lit up that a re-tune leans on. Only for domains a seed's
 * taste shapes; a restaurant is chosen for the town, not for a singer.
 */
function becauseOf(entry: PoolEntry, domain: Domain, ctx: ToolContext): Card["becauseOf"] {
  if (!BECAUSE_DOMAINS.has(domain) || entry.seedIds.length === 0) return undefined;
  const contributions = explainabilityOf(entry.entity) ?? {};
  const best = [...entry.seedIds].sort((a, b) => (contributions[b] ?? 0) - (contributions[a] ?? 0))[0];
  if (!best) return undefined;
  const favorite = ctx.favorites.find((f) => f.entityId === best);
  if (favorite) return { name: favorite.name, via: "favorite" };
  const name = ctx.names.get(best) ?? ctx.pool.get(best)?.entity.name;
  return name ? { name, via: "lit_up" } : undefined;
}

function explainabilityOf(e: QlooEntity): Record<string, number> | undefined {
  const raw = e.query?.explainability?.entities;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number") out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildCard(
  entry: PoolEntry,
  domain: Domain,
  prompt: string | undefined,
  ctx: ToolContext,
  addedBy: "plan" | "adapt",
  replacedEntityId?: string,
): Card {
  const e = entry.entity;
  const params = entry.params;
  const ageParam = params["signal.demographics.age"];
  const yearMin = params["filter.release_year.min"];
  const yearMax = params["filter.release_year.max"];
  const signals: CardSignals = {
    qlooType: entry.qlooType,
    path: "/v2/insights",
    params,
    affinity: entityAffinity(e),
    popularity: typeof e.popularity === "number" ? e.popularity : undefined,
    source: entry.source,
    explainability: explainabilityOf(e),
    seedNames: entry.seedNames,
    locationQuery: params["signal.location.query"] ?? params["filter.location.query"],
    ageBucket: ageParam && isAgeBucket(ageParam) ? ageParam : undefined,
    yearRange: yearMin && yearMax ? [Number(yearMin), Number(yearMax)] : undefined,
    rank: entry.rank,
    warnings: entry.warnings,
  };
  const year = entityYear(e);
  const because = becauseOf(entry, domain, ctx);
  const startYear = domain === "music" && typeof e.properties?.start_year === "number" ? e.properties.start_year : undefined;
  const aliases = domain === "music" ? artistAliasesOf(e).slice(0, 10) : [];
  const cleanPrompt = prompt?.replace(/\s+/g, " ").trim();
  return {
    id: `card_${randomUUID().slice(0, 8)}`,
    entityId: e.entity_id,
    domain,
    title: e.name,
    subtitle: subtitleFor(domain, e, ctx.language),
    year,
    ...(startYear !== undefined ? { startYear } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    imageUrl: entityImageUrl(e),
    description: short(e.properties?.description ?? e.properties?.short_description, 220),
    tags: tagNamesOf(e),
    why: whyLine(domain, signals, ctx.language),
    ...(because ? { becauseOf: because } : {}),
    prompt: cleanPrompt
      ? cleanPrompt
      : offlinePrompt({
          domain,
          language: ctx.language,
          title: e.name,
          year,
          entityId: e.entity_id,
          person: ctx.person,
        }),
    promptSource: cleanPrompt ? "llm" : "template",
    signals,
    addedBy,
    replacedEntityId,
  };
}

function domainMatches(domain: Domain, entry: PoolEntry): boolean {
  return DOMAIN_INFO[domain].qlooType === entry.qlooType;
}

function availableByDomain(ctx: ToolContext): Record<string, { entity_id: string; name: string; affinity: number | null }[]> {
  const out: Record<string, { entity_id: string; name: string; affinity: number | null }[]> = {};
  for (const domain of DOMAINS) {
    const type = DOMAIN_INFO[domain].qlooType;
    out[domain] = ctx.pool
      .byType(type)
      .sort((a, b) => (entityAffinity(b.entity) ?? 0) - (entityAffinity(a.entity) ?? 0))
      .slice(0, 8)
      .map((e) => ({ entity_id: e.entity.entity_id, name: e.entity.name, affinity: entityAffinity(e.entity) }));
  }
  return out;
}

export { PLAN_MAX_CARDS, PLAN_MIN_CARDS, PLAN_MIN_DOMAINS } from "@/lib/session/deck";

function runPlan(rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = PlanArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("plan_session", parsed.error);
  const errors: string[] = [];
  const seen = new Set<string>();
  const artists = new ArtistLedger();
  const duplicates: string[] = [];
  const picked: { entry: PoolEntry; domain: Domain; prompt?: string }[] = [];
  for (const c of parsed.data.cards) {
    if (seen.has(c.entity_id)) continue;
    const entry = ctx.pool.get(c.entity_id);
    if (!entry) {
      errors.push(`${c.entity_id} was not returned by qloo_insights in this session`);
      continue;
    }
    if (!domainMatches(c.domain, entry)) {
      errors.push(`${entry.entity.name} is ${entry.qlooType}, which does not fit domain "${c.domain}"`);
      continue;
    }
    seen.add(c.entity_id);
    // One entity per artist: Qloo lists some under two (a romanised and a native name).
    if (c.domain === "music" && !artists.claim(artistKeysOf(entry.entity))) {
      duplicates.push(`${entry.entity.name} is an artist already in the deck`);
      continue;
    }
    picked.push({ entry, domain: c.domain, prompt: c.prompt });
  }
  picked.splice(PLAN_MAX_CARDS);
  const poolSize = ctx.pool.size;
  const minCards = Math.min(PLAN_MIN_CARDS, poolSize);
  const domainsInPool = new Set(ctx.pool.all().map((e) => e.qlooType)).size;
  const minDomains = Math.min(PLAN_MIN_DOMAINS, domainsInPool);
  const domains = new Set(picked.map((p) => p.domain));
  if (picked.length < minCards) errors.push(`need at least ${minCards} valid cards, got ${picked.length}`);
  if (domains.size < minDomains) errors.push(`need at least ${minDomains} domains in the first ${PLAN_MAX_CARDS} cards, got ${domains.size}`);
  if (errors.length > 0) {
    errors.push(...duplicates);
    return {
      ok: false,
      result: { ok: false, errors, available: availableByDomain(ctx) },
      summary: `plan rejected: ${errors[0]}`,
    };
  }
  const cards = picked.map((p) => buildCard(p.entry, p.domain, p.prompt, ctx, "plan"));
  return {
    ok: true,
    result: { ok: true, cards: cards.map((c) => ({ id: c.id, title: c.title, domain: c.domain })) },
    summary: `Committed ${cards.length} cards across ${domains.size} domains`,
    final: { kind: "plan", cards },
  };
}

function runAdapt(rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = AdaptArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("adapt_session", parsed.error);
  const errors: string[] = [];
  const feedback = ctx.feedback;
  if (!feedback) {
    return { ok: false, result: { ok: false, errors: ["no feedback in context"] }, summary: "adapt rejected: no feedback" };
  }
  const upcoming = new Map<string, Card>();
  ctx.existingCards.forEach((card, index) => {
    if (index > feedback.currentIndex && !card.reaction) upcoming.set(card.entityId, card);
  });
  const currentIds = new Set([...ctx.existingCards.map((c) => c.entityId), ...feedback.exclude]);
  const artists = ledgerOfCards(ctx.existingCards, (id) => ctx.pool.get(id)?.entity);
  const used = new Set<string>();
  const replaced = new Set<string>();
  const replacements: Card[] = [];
  for (const r of parsed.data.replacements) {
    if (!upcoming.has(r.replaces_entity_id)) {
      errors.push(`${r.replaces_entity_id} is not an upcoming, unreacted card`);
      continue;
    }
    if (replaced.has(r.replaces_entity_id)) continue;
    if (currentIds.has(r.entity_id) || used.has(r.entity_id)) {
      errors.push(`${r.entity_id} is already in the session`);
      continue;
    }
    const entry = ctx.pool.get(r.entity_id);
    if (!entry) {
      errors.push(`${r.entity_id} was not returned by qloo_insights in this adaptation`);
      continue;
    }
    if (!domainMatches(r.domain, entry)) {
      errors.push(`${entry.entity.name} is ${entry.qlooType}, which does not fit domain "${r.domain}"`);
      continue;
    }
    if (r.domain === "music" && !artists.claim(artistKeysOf(entry.entity))) {
      errors.push(`${entry.entity.name} is an artist already in the session`);
      continue;
    }
    used.add(r.entity_id);
    replaced.add(r.replaces_entity_id);
    replacements.push(buildCard(entry, r.domain, r.prompt, ctx, "adapt", r.replaces_entity_id));
  }
  if (replacements.length === 0) {
    errors.push("no valid replacements");
    return {
      ok: false,
      result: { ok: false, errors, upcoming: [...upcoming.values()].map((c) => ({ entity_id: c.entityId, title: c.title, domain: c.domain })), available: availableByDomain(ctx) },
      summary: `adapt rejected: ${errors[0]}`,
    };
  }
  const resulting = ctx.existingCards.map((c) => replacements.find((r) => r.replacedEntityId === c.entityId)?.domain ?? c.domain);
  if (new Set(resulting).size < Math.min(PLAN_MIN_DOMAINS, new Set(ctx.existingCards.map((c) => c.domain)).size)) {
    return {
      ok: false,
      result: { ok: false, errors: ["replacements would leave fewer than 3 domains in the session"], available: availableByDomain(ctx) },
      summary: "adapt rejected: domain mix",
    };
  }
  return {
    ok: true,
    result: { ok: true, replacements: replacements.map((c) => ({ id: c.id, title: c.title, domain: c.domain, replaces: c.replacedEntityId })) },
    summary: `Replaced ${replacements.length} upcoming card${replacements.length === 1 ? "" : "s"}`,
    final: { kind: "adapt", replacements },
  };
}

/** Useful for policies: the best unused entries of a type, sorted by affinity. */
export function bestEntries(pool: EntityPool, type: QlooEntityType, exclude: Set<string>): PoolEntry[] {
  return pool
    .byType(type)
    .filter((e) => !exclude.has(e.entity.entity_id))
    .sort((a, b) => (entityAffinity(b.entity) ?? 0) - (entityAffinity(a.entity) ?? 0) || a.rank - b.rank);
}

export type SearchResponseBody = QlooSearchResponse;
export type TagsResponseBody = QlooTagsResponse;
export type InsightsResponseBody = QlooInsightsResponse;

/** The ids with each artist once, first listed wins: Qloo can list one artist as two entities. */
export function distinctArtistIds(ids: string[], pool: EntityPool): string[] {
  const artists = new ArtistLedger();
  return ids.filter((id) => {
    const entry = pool.get(id);
    return !entry || artists.claim(artistKeysOf(entry.entity));
  });
}
