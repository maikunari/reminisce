/**
 * Deterministic planner and adapter. Runs the same five tools through the
 * same loop as the LLM policy, so the trace looks identical, but every
 * decision is a fixed rule. Used when no LLM key is configured, when
 * LLM_MODE=fixture, or as a fallback when the LLM fails.
 */
import type { QlooEntityType } from "@/lib/qloo/types";
import { DOMAIN_INFO, type Domain, type Favorite } from "@/lib/session/types";

import type { Policy, PolicyStep, ToolCall } from "../loop";
import { newCallId } from "../loop";
import { NARRATION } from "../prompts";
import type { InsightsArgs, PlanArgs, AdaptArgs, ToolContext, ToolName, ToolOutcome } from "../tools";
import type { z } from "zod";

type InsightsArgsT = z.infer<typeof InsightsArgs>;
type PlanArgsT = z.infer<typeof PlanArgs>;
type AdaptArgsT = z.infer<typeof AdaptArgs>;

interface SearchHit {
  entity_id: string;
  name: string;
  types: string[];
  country_code?: string;
  disambiguation?: string;
}

interface InsightHit {
  entity_id: string;
  name: string;
  affinity: number | null;
}

interface Seed {
  id: string;
  name: string;
}

const FAVORITE_SEARCH_TYPES = [
  "urn:entity:artist",
  "urn:entity:movie",
  "urn:entity:tv_show",
  "urn:entity:person",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:place",
] as const;

/** ISO country code -> the country name Qloo uses in release_country. */
const COUNTRY_NAMES: Record<string, string> = {
  JP: "Japan",
  US: "United States",
  GB: "United Kingdom",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  DE: "Germany",
  MX: "Mexico",
  BR: "Brazil",
  KR: "South Korea",
  CN: "China",
  IN: "India",
  AU: "Australia",
  CA: "Canada",
  AR: "Argentina",
  PT: "Portugal",
  NL: "Netherlands",
  SE: "Sweden",
  GR: "Greece",
  IE: "Ireland",
  TW: "Taiwan",
  PH: "Philippines",
  HK: "Hong Kong",
  SG: "Singapore",
  MO: "Macau",
  MY: "Malaysia",
  PK: "Pakistan",
  BD: "Bangladesh",
  LK: "Sri Lanka",
  CO: "Colombia",
  PE: "Peru",
  CU: "Cuba",
  CL: "Chile",
  VE: "Venezuela",
  UY: "Uruguay",
  PR: "Puerto Rico",
  EC: "Ecuador",
  BO: "Bolivia",
  PY: "Paraguay",
  GT: "Guatemala",
  DO: "Dominican Republic",
  CR: "Costa Rica",
  PA: "Panama",
  HN: "Honduras",
  SV: "El Salvador",
  NI: "Nicaragua",
  NZ: "New Zealand",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  RU: "Russia",
  UA: "Ukraine",
  CZ: "Czech Republic",
  HU: "Hungary",
};

const DISAMBIGUATION_COUNTRIES: Record<string, string> = {
  japan: "Japan",
  united_states_of_america: "United States",
  united_states: "United States",
  united_kingdom: "United Kingdom",
  france: "France",
  spain: "Spain",
  italy: "Italy",
  germany: "Germany",
  mexico: "Mexico",
  brazil: "Brazil",
  canada: "Canada",
  australia: "Australia",
  south_korea: "South Korea",
  korea: "South Korea",
  china: "China",
  india: "India",
  taiwan: "Taiwan",
  philippines: "Philippines",
  hong_kong: "Hong Kong",
  singapore: "Singapore",
  pakistan: "Pakistan",
  argentina: "Argentina",
  colombia: "Colombia",
  peru: "Peru",
  cuba: "Cuba",
  chile: "Chile",
  ireland: "Ireland",
};

export function countryNameFor(hit: SearchHit | undefined): string | undefined {
  if (!hit) return undefined;
  if (hit.country_code && COUNTRY_NAMES[hit.country_code.toUpperCase()]) return COUNTRY_NAMES[hit.country_code.toUpperCase()];
  const last = hit.disambiguation?.split(",").map((s) => s.trim().toLowerCase().replace(/\s+/g, "_")).pop();
  return last ? DISAMBIGUATION_COUNTRIES[last] : undefined;
}

function call(name: ToolName, args: unknown): ToolCall {
  return { id: newCallId(), name, args };
}

function searchHits(out: ToolOutcome | undefined): SearchHit[] {
  if (!out?.ok) return [];
  const r = out.result as { results?: SearchHit[] };
  return Array.isArray(r.results) ? r.results : [];
}

function insightHits(out: ToolOutcome | undefined): InsightHit[] {
  if (!out?.ok) return [];
  const r = out.result as { entities?: InsightHit[] };
  return Array.isArray(r.entities) ? r.entities : [];
}

function tagHits(out: ToolOutcome | undefined): { id: string; name: string }[] {
  if (!out?.ok) return [];
  const r = out.result as { tags?: { id: string; name: string }[] };
  return Array.isArray(r.tags) ? r.tags : [];
}

function pickTagIds(tags: { id: string; name: string }[], words: string[], max: number): string[] {
  const matches = tags.filter((t) => words.some((w) => t.id.toLowerCase().includes(w) || t.name.toLowerCase().includes(w)));
  matches.sort((a, b) => a.id.length - b.id.length);
  return matches.slice(0, max).map((t) => t.id);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Round-robin interleave so consecutive cards change domain. */
function interleave(groups: { domain: Domain; ids: string[] }[], limit: number): { domain: Domain; entity_id: string }[] {
  const out: { domain: Domain; entity_id: string }[] = [];
  const queues = groups.map((g) => ({ domain: g.domain, ids: [...g.ids] }));
  while (out.length < limit && queues.some((q) => q.ids.length > 0)) {
    for (const q of queues) {
      const id = q.ids.shift();
      if (id !== undefined) out.push({ domain: q.domain, entity_id: id });
      if (out.length >= limit) break;
    }
  }
  return out;
}

abstract class GeneratorPolicy implements Policy {
  abstract readonly kind: "deterministic";
  private gen: Generator<PolicyStep, void, ToolOutcome | undefined> | null = null;
  private last: ToolOutcome | undefined;

  protected abstract script(): Generator<PolicyStep, void, ToolOutcome | undefined>;

  async next(): Promise<PolicyStep> {
    if (!this.gen) this.gen = this.script();
    const r = this.gen.next(this.last);
    this.last = undefined;
    if (r.done) return { done: true };
    return r.value;
  }

  observe(_call: ToolCall, outcome: ToolOutcome): void {
    this.last = outcome;
  }
}

export class ScriptedPlanPolicy extends GeneratorPolicy {
  readonly kind = "deterministic" as const;

  constructor(private readonly ctx: ToolContext) {
    super();
  }

  protected *script(): Generator<PolicyStep, void, ToolOutcome | undefined> {
    const ctx = this.ctx;
    const person = ctx.person;
    const yw = ctx.youthWindow;
    yield { narration: NARRATION.start(person, yw.start, yw.end) };

    // 1. Seeds: resolve each favorite to a Qloo entity id.
    const seeds: Seed[] = [];
    for (const fav of person.favorites.slice(0, 3)) {
      if (fav.entityId) {
        seeds.push({ id: fav.entityId, name: fav.name });
        ctx.names.set(fav.entityId, fav.name);
        continue;
      }
      const out = yield {
        narration: NARRATION.resolveFavorite(fav.name),
        toolCalls: [call("qloo_search_entity", { query: fav.name, types: fav.type ? [fav.type] : [...FAVORITE_SEARCH_TYPES], take: 5 })],
      };
      const hit = searchHits(out)[0];
      if (hit) seeds.push({ id: hit.entity_id, name: hit.name });
      else yield { narration: `Qloo has no entity for "${fav.name}". Continuing without it.` };
    }
    const seedIds = seeds.map((s) => s.id);

    // 2. Hometown -> locality (for the location signal and release country).
    const locOut = yield {
      narration: NARRATION.resolveHometown(person.hometown),
      toolCalls: [call("qloo_search_entity", { query: person.hometown, types: ["urn:entity:locality"], take: 3 })],
    };
    const locality = searchHits(locOut)[0];
    const locationQuery = locality?.name ?? person.hometown;
    const country = countryNameFor(locality);

    // 3. Tag ids for dining and landmarks (filter.tags only accepts real ids).
    const restOut = yield {
      narration: NARRATION.tags("restaurants"),
      toolCalls: [call("qloo_search_tags", { query: "restaurant", parent_type: "urn:entity:place", take: 8 })],
    };
    const restaurantTags = pickTagIds(tagHits(restOut), ["restaurant"], 1);
    const attrOut = yield {
      narration: NARRATION.tags("landmarks and attractions"),
      toolCalls: [call("qloo_search_tags", { query: "landmark", parent_type: "urn:entity:place", take: 8 })],
    };
    const attractionTags = pickTagIds(tagHits(attrOut), ["landmark", "attraction", "park", "museum", "monument"], 4);

    const base = {
      signal_entities: seedIds.length > 0 ? seedIds : undefined,
      signal_location_query: locationQuery,
      signal_age: ctx.ageBucket,
    };

    // 4. Music.
    const musicOut = yield {
      narration: NARRATION.insights(`artists ${locationQuery} listeners of ${person.name}'s generation loved`),
      toolCalls: [call("qloo_insights", { ...base, filter_type: "urn:entity:artist", purpose: "music of their youth", take: 10 } satisfies InsightsArgsT)],
    };
    const musicIds = insightHits(musicOut).map((h) => h.entity_id);

    // 5. Film, restricted to the youth window (and the home country when known).
    const filmArgs: InsightsArgsT = {
      ...base,
      filter_type: "urn:entity:movie",
      purpose: `films released ${yw.start} to ${yw.end}`,
      release_year_min: yw.start,
      release_year_max: yw.end,
      filter_release_country: country ? [country] : undefined,
      take: 10,
    };
    let filmOut = yield { narration: NARRATION.insights(`films from ${yw.start} to ${yw.end}`), toolCalls: [call("qloo_insights", filmArgs)] };
    if (insightHits(filmOut).length < 3 && country) {
      filmOut = yield { narration: NARRATION.widen("film"), toolCalls: [call("qloo_insights", { ...filmArgs, filter_release_country: undefined })] };
    }
    const filmIds = insightHits(filmOut).map((h) => h.entity_id);

    // 6. Television that premiered around the youth window.
    const tvArgs: InsightsArgsT = {
      ...base,
      filter_type: "urn:entity:tv_show",
      purpose: "television of their youth",
      release_year_min: yw.start - 5,
      release_year_max: yw.end,
      filter_release_country: country ? [country] : undefined,
      take: 8,
    };
    let tvOut = yield { narration: NARRATION.insights("television shows of the era"), toolCalls: [call("qloo_insights", tvArgs)] };
    if (insightHits(tvOut).length < 2 && country) {
      tvOut = yield { narration: NARRATION.widen("television"), toolCalls: [call("qloo_insights", { ...tvArgs, filter_release_country: undefined })] };
    }
    const tvIds = insightHits(tvOut).map((h) => h.entity_id);

    // 7. Places to eat in the hometown.
    const diningOut = yield {
      narration: NARRATION.insights(`places to eat in ${locationQuery}`),
      toolCalls: [
        call("qloo_insights", {
          signal_entities: base.signal_entities,
          signal_age: base.signal_age,
          filter_type: "urn:entity:place",
          purpose: `dining in ${locationQuery}`,
          filter_location_query: locationQuery,
          filter_tags: restaurantTags.length > 0 ? restaurantTags : undefined,
          take: 8,
        } satisfies InsightsArgsT),
      ],
    };
    const diningIds = insightHits(diningOut).map((h) => h.entity_id);

    // 8. Landmarks in the hometown, excluding the dining results.
    const placeArgs: InsightsArgsT = {
      signal_entities: base.signal_entities,
      signal_age: base.signal_age,
      filter_type: "urn:entity:place",
      purpose: `landmarks of ${locationQuery}`,
      filter_location_query: locationQuery,
      filter_tags: attractionTags.length > 0 ? attractionTags : undefined,
      exclude_entities: diningIds.length > 0 ? diningIds : undefined,
      take: 8,
    };
    let placeOut = yield { narration: NARRATION.insights(`landmarks of ${locationQuery}`), toolCalls: [call("qloo_insights", placeArgs)] };
    if (insightHits(placeOut).length < 2 && attractionTags.length > 0) {
      placeOut = yield { narration: NARRATION.widen("landmark"), toolCalls: [call("qloo_insights", { ...placeArgs, filter_tags: undefined })] };
    }
    const placeIds = insightHits(placeOut).map((h) => h.entity_id).filter((id) => !diningIds.includes(id));

    // 9. Trips. Destination insights require entity signals; stand in with the top artist if needed.
    const destSeeds = seedIds.length > 0 ? seedIds : musicIds.slice(0, 1);
    const destOut = yield {
      narration: NARRATION.insights(`destinations people from ${locationQuery} with these tastes travelled to`),
      toolCalls: [
        call("qloo_insights", {
          ...base,
          signal_entities: destSeeds.length > 0 ? destSeeds : undefined,
          filter_type: "urn:entity:destination",
          purpose: "trips of a lifetime",
          take: 8,
        } satisfies InsightsArgsT),
      ],
    };
    const destIds = insightHits(destOut).map((h) => h.entity_id);

    // 10. Choose and commit.
    const quota: { domain: Domain; ids: string[]; want: number }[] = [
      { domain: "music", ids: musicIds, want: 3 },
      { domain: "film", ids: filmIds, want: 2 },
      { domain: "dining", ids: diningIds, want: 1 },
      { domain: "place", ids: placeIds, want: 1 },
      { domain: "destination", ids: destIds, want: 1 },
      { domain: "tv", ids: tvIds, want: 1 },
    ];
    const target = 9;
    const chosen = new Set<string>();
    const groups = quota.map((q) => ({ domain: q.domain, ids: [] as string[] }));
    const takeFrom = (q: (typeof quota)[number], g: { ids: string[] }, n: number) => {
      for (const id of q.ids) {
        if (n <= 0) break;
        if (chosen.has(id)) continue;
        chosen.add(id);
        g.ids.push(id);
        n -= 1;
      }
    };
    quota.forEach((q, i) => takeFrom(q, groups[i]!, q.want));
    let guard = 0;
    while (chosen.size < target && guard < 12) {
      guard += 1;
      let added = false;
      quota.forEach((q, i) => {
        if (chosen.size >= target) return;
        const before = chosen.size;
        takeFrom(q, groups[i]!, 1);
        if (chosen.size > before) added = true;
      });
      if (!added) break;
    }
    const cards = interleave(groups, target);
    const domainCount = new Set(cards.map((c) => c.domain)).size;
    const planArgs: PlanArgsT = { cards: cards.map((c) => ({ entity_id: c.entity_id, domain: c.domain })) };
    yield { narration: NARRATION.plan(cards.length, domainCount), toolCalls: [call("plan_session", planArgs)] };
  }
}

const CROSS_DOMAIN: Record<Domain, Domain> = {
  music: "film",
  film: "music",
  tv: "music",
  dining: "destination",
  place: "dining",
  destination: "place",
};

export class ScriptedAdaptPolicy extends GeneratorPolicy {
  readonly kind = "deterministic" as const;

  constructor(private readonly ctx: ToolContext) {
    super();
  }

  private argsFor(domain: Domain, seeds: string[], exclude: string[], extra: Partial<InsightsArgsT> = {}): InsightsArgsT {
    const ctx = this.ctx;
    const yw = ctx.youthWindow;
    const type: QlooEntityType = DOMAIN_INFO[domain].qlooType;
    const common: InsightsArgsT = {
      filter_type: type,
      signal_entities: seeds.length > 0 ? unique(seeds).slice(0, 6) : undefined,
      signal_age: ctx.ageBucket,
      exclude_entities: exclude.length > 0 ? unique(exclude).slice(0, 60) : undefined,
      take: 6,
      ...extra,
    };
    switch (domain) {
      case "music":
      case "destination":
        return { ...common, signal_location_query: ctx.person.hometown };
      case "film":
        return { ...common, signal_location_query: ctx.person.hometown, release_year_min: yw.start, release_year_max: yw.end };
      case "tv":
        return { ...common, signal_location_query: ctx.person.hometown, release_year_min: yw.start - 5, release_year_max: yw.end };
      case "dining":
      case "place":
        return { ...common, filter_location_query: ctx.person.hometown };
    }
  }

  protected *script(): Generator<PolicyStep, void, ToolOutcome | undefined> {
    const ctx = this.ctx;
    const fb = ctx.feedback;
    if (!fb) return;
    const cards = ctx.existingCards;
    const upcoming = cards.filter((c, i) => i > fb.currentIndex && !c.reaction);
    if (upcoming.length === 0) {
      yield { narration: "No upcoming cards left to re-tune." };
      return;
    }
    const seeds = favoriteIds(ctx.favorites);
    const liked = cards.filter((c) => c.reaction === "lit_up").map((c) => c.entityId);
    const currentIds = cards.map((c) => c.entityId);
    const replacements: AdaptArgsT["replacements"] = [];

    if (fb.reaction === "lit_up") {
      yield { narration: NARRATION.adaptLiked(fb.card.title, this.ctx.person) };
      const signalSeeds = unique([fb.card.entityId, ...liked, ...seeds]);
      const domain = fb.card.domain;
      let tagIds: string[] = [];
      if (domain === "dining") {
        const tagOut = yield {
          narration: NARRATION.tags("restaurants"),
          toolCalls: [call("qloo_search_tags", { query: "restaurant", parent_type: "urn:entity:place", take: 8 })],
        };
        tagIds = pickTagIds(tagHits(tagOut), ["restaurant"], 1);
      }
      const sameOut = yield {
        narration: NARRATION.insights(`more ${DOMAIN_INFO[domain].plural} with "${fb.card.title}" as a signal`),
        toolCalls: [
          call(
            "qloo_insights",
            this.argsFor(domain, signalSeeds, currentIds, {
              purpose: `more like ${fb.card.title}`,
              filter_tags: tagIds.length > 0 ? tagIds : undefined,
            }),
          ),
        ],
      };
      const cross = CROSS_DOMAIN[domain];
      const crossOut = yield {
        narration: NARRATION.insights(`${DOMAIN_INFO[cross].plural} that match "${fb.card.title}" (cross-domain)`),
        toolCalls: [call("qloo_insights", this.argsFor(cross, signalSeeds, currentIds, { purpose: `cross-domain from ${fb.card.title}` }))],
      };
      const same = insightHits(sameOut).filter((h) => !currentIds.includes(h.entity_id));
      const other = insightHits(crossOut).filter((h) => !currentIds.includes(h.entity_id));
      // Fresh same-domain picks replace upcoming cards of that domain first, so the
      // deck keeps its mix; the cross-domain pick replaces a card of its own domain
      // when there is one, otherwise the next upcoming card.
      const taken = new Set<string>();
      const claim = (preferred: Domain): typeof upcoming[number] | undefined => {
        const pick =
          upcoming.find((c) => c.domain === preferred && !taken.has(c.entityId)) ??
          upcoming.find((c) => !taken.has(c.entityId));
        if (pick) taken.add(pick.entityId);
        return pick;
      };
      const plan: { hit: InsightHit | undefined; domain: Domain }[] = [
        { hit: same[0], domain },
        { hit: other[0], domain: cross },
        { hit: same[1], domain },
      ];
      for (const { hit, domain: d } of plan) {
        if (!hit) continue;
        const target = claim(d);
        if (!target) break;
        replacements.push({ replaces_entity_id: target.entityId, entity_id: hit.entity_id, domain: d });
      }
    } else {
      yield { narration: NARRATION.adaptDisliked(fb.card.title) };
      const lastLiked = [...cards].reverse().find((c) => c.reaction === "lit_up");
      const targetDomain: Domain = lastLiked ? lastLiked.domain : fb.card.domain === "music" ? "film" : "music";
      const out = yield {
        narration: NARRATION.insights(`${DOMAIN_INFO[targetDomain].plural} to replace the next ${DOMAIN_INFO[fb.card.domain].label.toLowerCase()} cards`),
        toolCalls: [
          call(
            "qloo_insights",
            this.argsFor(targetDomain, unique([...liked, ...seeds]), [fb.card.entityId, ...currentIds], {
              purpose: `steer away from ${fb.card.title}`,
            }),
          ),
        ],
      };
      const hits = insightHits(out).filter((h) => !currentIds.includes(h.entity_id));
      const sameDomainUpcoming = upcoming.filter((c) => c.domain === fb.card.domain);
      const targets = sameDomainUpcoming.length > 0 ? sameDomainUpcoming.slice(0, 2) : upcoming.slice(0, 1);
      targets.forEach((t, i) => {
        const hit = hits[i];
        if (hit) replacements.push({ replaces_entity_id: t.entityId, entity_id: hit.entity_id, domain: targetDomain });
      });
    }

    if (replacements.length === 0) {
      yield { narration: "Qloo returned nothing new to swap in; keeping the session as it is." };
      return;
    }
    yield { narration: NARRATION.adaptDone(replacements.length), toolCalls: [call("adapt_session", { replacements } satisfies AdaptArgsT)] };
  }
}

function favoriteIds(favorites: Favorite[]): string[] {
  return favorites.map((f) => f.entityId).filter((id): id is string => typeof id === "string" && id.length > 0);
}
