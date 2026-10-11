/**
 * The agent's five tools, as OpenAI-compatible function definitions plus the
 * server-side runtime that executes them against the Qloo client.
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
  type TraceQloo,
  type YouthWindow,
} from "@/lib/session/types";
import { isAgeBucket } from "@/lib/session/youth-window";

import { offlinePrompt, whyLine } from "./prompts";

// ---------------------------------------------------------------------------
// Argument schemas (zod validates LLM output; JSON schema is derived for the LLM)
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

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export interface ToolDefinition {
  type: "function";
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "qloo_search_entity",
      description:
        "Look up Qloo entity ids by name (GET /search). Use it to resolve the person's favorites to entity ids and the hometown to a urn:entity:locality.",
      parameters: jsonSchema(SearchEntityArgs),
    },
  },
  {
    type: "function",
    function: {
      name: "qloo_search_tags",
      description:
        "Find valid Qloo tag ids by keyword (GET /v2/tags). filter_tags and signal_tags in qloo_insights only accept ids returned here.",
      parameters: jsonSchema(SearchTagsArgs),
    },
  },
  {
    type: "function",
    function: {
      name: "qloo_insights",
      description:
        "Get taste-correlated entities from the Qloo Insights API (GET /v2/insights) for one filter_type, using seed entities, the hometown and the age bucket as signals. Returns entities with affinity scores; only these ids may be used in plan_session or adapt_session.",
      parameters: jsonSchema(InsightsArgs),
    },
  },
  {
    type: "function",
    function: {
      name: "plan_session",
      description:
        "Commit the final reminiscence session: 8 to 10 cards across at least 3 domains, using entity ids from qloo_insights results. Returns ok:false with reasons if the plan is invalid; fix and call again.",
      parameters: jsonSchema(PlanArgs),
    },
  },
  {
    type: "function",
    function: {
      name: "adapt_session",
      description:
        "Replace upcoming cards after caregiver feedback. Each replacement names the upcoming card's entity id it replaces and a new entity id from a fresh qloo_insights result.",
      parameters: jsonSchema(AdaptArgs),
    },
  },
];

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface PoolEntry {
  entity: QlooEntity;
  qlooType: QlooEntityType;
  params: Record<string, string>;
  source: QlooSource;
  status: number;
  durationMs: number;
  warnings: string[];
  rank: number;
  seedIds: string[];
  seedNames: string[];
}

/** Every entity the agent has fetched this run, keyed by entity id. */
export class EntityPool {
  private readonly entries = new Map<string, PoolEntry>();

  add(entry: PoolEntry): void {
    const existing = this.entries.get(entry.entity.entity_id);
    const incoming = entityAffinity(entry.entity) ?? -1;
    const current = existing ? (entityAffinity(existing.entity) ?? -1) : -Infinity;
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
  existingCards: Card[];
  feedback?: Feedback;
  now: Date;
}

export type ToolFinal = { kind: "plan"; cards: Card[] } | { kind: "adapt"; replacements: Card[] };

export interface ToolOutcome {
  ok: boolean;
  /** JSON-serialisable result handed back to the policy (and the LLM). */
  result: unknown;
  /** One line for the trace. */
  summary: string;
  qloo?: TraceQloo;
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

function compactEntity(e: QlooEntity) {
  return {
    entity_id: e.entity_id,
    name: e.name,
    type: e.subtype,
    year: entityYear(e),
    affinity: entityAffinity(e),
    popularity: typeof e.popularity === "number" ? Math.round(e.popularity * 100) / 100 : undefined,
    tags: (e.tags ?? []).slice(0, 3).map((t) => t.name),
    description: short(e.properties?.short_description ?? e.properties?.description, 120),
    has_image: !!entityImageUrl(e),
  };
}

async function runSearchEntity(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = SearchEntityArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("qloo_search_entity", parsed.error);
  const args = parsed.data;
  const res = await ctx.qloo.search(args.query, { types: args.types, take: args.take ?? 5 });
  const results = res.body.results.map((r) => {
    ctx.names.set(r.entity_id, r.name);
    return {
      entity_id: r.entity_id,
      name: r.name,
      types: r.types,
      year: entityYear(r),
      popularity: typeof r.popularity === "number" ? Math.round(r.popularity * 100) / 100 : undefined,
      disambiguation: r.disambiguation,
      country_code: r.properties?.geocode?.country_code,
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
    }
  }
  return {
    ok: true,
    result: { results },
    summary: `${results.length} match${results.length === 1 ? "" : "es"} for "${args.query}"${
      results[0] ? `: ${results[0].name}` : ""
    }`,
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
  });
  const tags = res.body.results.tags.map((t) => ({ id: t.id, name: t.name, type: t.type ?? t.subtype }));
  return {
    ok: true,
    result: { tags },
    summary: `${tags.length} tag${tags.length === 1 ? "" : "s"} for "${args.query}"${tags[0] ? `: ${tags[0].id}` : ""}`,
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

async function runInsights(rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = InsightsArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("qloo_insights", parsed.error);
  const args = parsed.data;
  const req = insightsRequestFromArgs(args);
  const res = await ctx.qloo.insights(req);
  const seedIds = args.signal_entities ?? [];
  const seedNames = seedIds.map((id) => ctx.names.get(id) ?? ctx.pool.get(id)?.entity.name ?? id.slice(0, 8));
  const entities = res.body.results.entities;
  entities.forEach((entity, index) => {
    ctx.names.set(entity.entity_id, entity.name);
    ctx.pool.add({
      entity,
      qlooType: args.filter_type,
      params: res.request.params,
      source: res.source,
      status: res.status,
      durationMs: res.durationMs,
      warnings: res.warnings,
      rank: index + 1,
      seedIds,
      seedNames,
    });
  });
  const label = DOMAIN_LABEL_BY_TYPE[args.filter_type] ?? args.filter_type;
  return {
    ok: true,
    result: {
      filter_type: args.filter_type,
      request: res.request.params,
      source: res.source,
      warnings: res.warnings,
      entities: entities.map(compactEntity),
    },
    summary: `${entities.length} ${label}${args.purpose ? ` for "${args.purpose}"` : ""}${
      entities[0] ? `; top: ${entities[0].name}` : ""
    }${res.warnings.length > 0 ? ` (${res.warnings.length} dropped param)` : ""}`,
    qloo: traceOf(res, entities.length),
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

function subtitleFor(domain: Domain, e: QlooEntity): string | undefined {
  const p = e.properties ?? {};
  switch (domain) {
    case "music": {
      const dob = typeof p.date_of_birth === "string" ? p.date_of_birth.slice(0, 4) : undefined;
      const place = typeof p.place_of_birth === "string" ? p.place_of_birth.split(",")[0]?.trim() : undefined;
      return [dob ? `born ${dob}` : undefined, place].filter(Boolean).join(" · ") || undefined;
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
      const closed = p.is_closed ? "closed now" : undefined;
      return [city, closed].filter(Boolean).join(" · ") || undefined;
    }
    case "destination": {
      const region = p.geocode?.admin1_region;
      const country = p.geocode?.country_code;
      return [region, country].filter(Boolean).join(", ") || undefined;
    }
  }
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
  const cleanPrompt = prompt?.replace(/\s+/g, " ").trim();
  return {
    id: `card_${randomUUID().slice(0, 8)}`,
    entityId: e.entity_id,
    domain,
    title: e.name,
    subtitle: subtitleFor(domain, e),
    year,
    imageUrl: entityImageUrl(e),
    description: short(e.properties?.description ?? e.properties?.short_description, 220),
    tags: (e.tags ?? []).slice(0, 3).map((t) => t.name),
    why: whyLine(domain, signals),
    prompt:
      cleanPrompt && cleanPrompt.length > 0
        ? cleanPrompt
        : offlinePrompt({
            domain,
            language: ctx.language,
            title: e.name,
            year,
            entityId: e.entity_id,
            person: ctx.person,
            youthStart: ctx.youthWindow.start,
          }),
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

export const PLAN_MIN_CARDS = 8;
export const PLAN_MAX_CARDS = 10;
export const PLAN_MIN_DOMAINS = 3;

function runPlan(rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  const parsed = PlanArgs.safeParse(rawArgs);
  if (!parsed.success) return argError("plan_session", parsed.error);
  const errors: string[] = [];
  const seen = new Set<string>();
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
    picked.push({ entry, domain: c.domain, prompt: c.prompt });
  }
  const poolSize = ctx.pool.size;
  const minCards = Math.min(PLAN_MIN_CARDS, poolSize);
  const domainsInPool = new Set(ctx.pool.all().map((e) => e.qlooType)).size;
  const minDomains = Math.min(PLAN_MIN_DOMAINS, domainsInPool);
  const domains = new Set(picked.map((p) => p.domain));
  if (picked.length < minCards) errors.push(`need at least ${minCards} valid cards, got ${picked.length}`);
  if (domains.size < minDomains) errors.push(`need at least ${minDomains} domains, got ${domains.size}`);
  if (errors.length > 0) {
    return {
      ok: false,
      result: { ok: false, errors, available: availableByDomain(ctx) },
      summary: `plan rejected: ${errors[0]}`,
    };
  }
  const cards = picked.slice(0, PLAN_MAX_CARDS).map((p) => buildCard(p.entry, p.domain, p.prompt, ctx, "plan"));
  return {
    ok: true,
    result: { ok: true, cards: cards.map((c) => ({ id: c.id, title: c.title, domain: c.domain })) },
    summary: `plan committed: ${cards.length} cards across ${domains.size} domains`,
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
  const currentIds = new Set(ctx.existingCards.map((c) => c.entityId));
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
    summary: `adapt committed: ${replacements.length} replacement${replacements.length === 1 ? "" : "s"}`,
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
