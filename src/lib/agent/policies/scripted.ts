/**
 * Deterministic planner and adapter. Runs the same five tools through the
 * same loop as the LLM policy, so the trace looks identical, but every
 * decision is a fixed rule. Used when no LLM key is configured, when
 * LLM_MODE=fixture, or as a fallback when the LLM fails.
 */
import { fold, isTypedPlace } from "@/lib/qloo/place";
import type { QlooEntityType } from "@/lib/qloo/types";
import { DOMAIN_INFO, type Domain, type Favorite } from "@/lib/session/types";

import type { Policy, PolicyStep, ToolCall } from "../loop";
import { newCallId } from "../loop";
import { NARRATION } from "../prompts";
import { chooseDeck } from "./pool";
import { PLACE_TAGS, type InsightsArgs, type PlanArgs, type AdaptArgs, type ToolContext, type ToolName, type ToolOutcome } from "../tools";
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
  akas?: string[];
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
  // Qloo often answers in the locality's own language: "大阪市, 大阪府, 近畿地方, 日本", "Ciudad de México, ..., México".
  日本: "Japan",
  espana: "Spain",
  deutschland: "Germany",
  italia: "Italy",
  brasil: "Brazil",
  polska: "Poland",
  대한민국: "South Korea",
  한국: "South Korea",
  中国: "China",
  中华人民共和国: "China",
  台灣: "Taiwan",
  臺灣: "Taiwan",
  台湾: "Taiwan",
  香港: "Hong Kong",
  pilipinas: "Philippines",
};

export function countryNameFor(hit: SearchHit | undefined): string | undefined {
  if (!hit) return undefined;
  if (hit.country_code && COUNTRY_NAMES[hit.country_code.toUpperCase()]) return COUNTRY_NAMES[hit.country_code.toUpperCase()];
  const last = hit.disambiguation?.split(",").map((s) => fold(s).replace(/\s+/g, "_")).pop();
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

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * A policy written as a generator: each `yield` is one step, and the step's
 * outcomes come back from the yield in the order of its tool calls.
 */
abstract class GeneratorPolicy implements Policy {
  abstract readonly kind: "deterministic";
  private gen: Generator<PolicyStep, void, ToolOutcome[]> | null = null;
  private outcomes: ToolOutcome[] = [];

  protected abstract script(): Generator<PolicyStep, void, ToolOutcome[]>;

  async next(): Promise<PolicyStep> {
    if (!this.gen) this.gen = this.script();
    const r = this.gen.next(this.outcomes);
    this.outcomes = [];
    if (r.done) return { done: true };
    return r.value;
  }

  observe(_call: ToolCall, outcome: ToolOutcome): void {
    this.outcomes.push(outcome);
  }
}

export class ScriptedPlanPolicy extends GeneratorPolicy {
  readonly kind = "deterministic" as const;

  constructor(private readonly ctx: ToolContext) {
    super();
  }

  protected *script(): Generator<PolicyStep, void, ToolOutcome[]> {
    const ctx = this.ctx;
    const person = ctx.person;
    const yw = ctx.youthWindow;
    yield { narration: NARRATION.start(person, yw.start, yw.end) };

    // 1. Seeds and the hometown, looked up together: each favorite to a Qloo
    // entity id, the hometown to a locality (for the location signal and release country).
    const favorites = person.favorites.slice(0, 3);
    const lookups = favorites.filter((f) => !f.entityId);
    const resolved = yield {
      narration: NARRATION.resolve(
        lookups.map((f) => f.name),
        person.hometown,
      ),
      toolCalls: [
        ...lookups.map((fav) => call("qloo_search_entity", { query: fav.name, types: fav.type ? [fav.type] : [...FAVORITE_SEARCH_TYPES], take: 5 })),
        call("qloo_search_entity", { query: person.hometown, types: ["urn:entity:locality"], take: 3 }),
      ],
    };
    const seeds: Seed[] = [];
    const missing: string[] = [];
    for (const fav of favorites) {
      if (fav.entityId) {
        seeds.push({ id: fav.entityId, name: fav.name });
        ctx.names.set(fav.entityId, fav.name);
        continue;
      }
      const hit = searchHits(resolved[lookups.indexOf(fav)])[0];
      if (hit) seeds.push({ id: hit.entity_id, name: hit.name });
      else missing.push(fav.name);
    }
    for (const name of missing) yield { narration: `Qloo has no entity for "${name}". Continuing without it.` };
    const seedIds = seeds.map((s) => s.id);

    const top = searchHits(resolved[lookups.length])[0];
    // Adopt Qloo's locality only when it is the typed town itself; a lookalike
    // ("Chester" -> Manchester) is left to the location query to resolve.
    const locality = top && isTypedPlace(person.hometown, top) ? top : undefined;
    const locationQuery = locality?.name ?? person.hometown;
    const country = countryNameFor(locality);
    if (country) ctx.homeCountry = country;

    // Tag ids for dining and landmarks are the same for everyone, so they are not looked up.
    const restaurantTags = [PLACE_TAGS.restaurant];
    const attractionTags = [PLACE_TAGS.touristAttraction, PLACE_TAGS.landmark];

    const base = {
      signal_entities: seedIds.length > 0 ? seedIds : undefined,
      signal_location_query: locationQuery,
      signal_age: ctx.ageBucket,
    };

    // 2. Every domain at once. A thin answer is widened by the tool itself,
    // always inside the youth window.
    const musicArgs: InsightsArgsT = { ...base, filter_type: "urn:entity:artist", purpose: "music of their youth", take: 10 };
    // Films restricted to the youth window (and the home country when known).
    const filmArgs: InsightsArgsT = {
      ...base,
      filter_type: "urn:entity:movie",
      purpose: `films released ${yw.start} to ${yw.end}`,
      release_year_min: yw.start,
      release_year_max: yw.end,
      filter_release_country: country ? [country] : undefined,
      take: 10,
    };
    // Television that premiered around the youth window.
    const tvArgs: InsightsArgsT = {
      ...base,
      filter_type: "urn:entity:tv_show",
      purpose: "television of their youth",
      release_year_min: yw.start - 5,
      release_year_max: yw.end,
      filter_release_country: country ? [country] : undefined,
      take: 8,
    };
    // Places to eat in the hometown.
    const diningArgs: InsightsArgsT = {
      signal_entities: base.signal_entities,
      signal_age: base.signal_age,
      filter_type: "urn:entity:place",
      purpose: `dining in ${locationQuery}`,
      filter_location_query: locationQuery,
      filter_tags: restaurantTags,
      take: 8,
    };
    // Landmarks in the hometown, tuned by age only: the seed's taste pulls in
    // modern venues (an arena, a gym) where the hometown's own sights (its
    // theatre, its museums, its zoo) belong. Any that are also places to eat are dropped below.
    const placeArgs: InsightsArgsT = {
      signal_age: base.signal_age,
      filter_type: "urn:entity:place",
      purpose: `landmarks of ${locationQuery}`,
      filter_location_query: locationQuery,
      filter_tags: attractionTags,
      take: 8,
    };
    // Trips. Destination insights require entity signals; without a seed they
    // wait for the top artist to stand in.
    const destArgs = (seeds: string[]): InsightsArgsT => ({
      ...base,
      signal_entities: seeds,
      filter_type: "urn:entity:destination",
      purpose: "trips of a lifetime",
      take: 8,
    });
    const asked = yield {
      narration: NARRATION.insightsAll(locationQuery, yw.start, yw.end),
      toolCalls: [
        call("qloo_insights", musicArgs),
        call("qloo_insights", filmArgs),
        call("qloo_insights", tvArgs),
        call("qloo_insights", diningArgs),
        call("qloo_insights", placeArgs),
        ...(seedIds.length > 0 ? [call("qloo_insights", destArgs(seedIds))] : []),
      ],
    };
    const [musicOut, filmOut, tvOut, diningOut] = asked;
    let placeOut = asked[4];
    let destOut = asked[5];
    const musicIds = insightHits(musicOut).map((h) => h.entity_id);
    const filmIds = insightHits(filmOut).map((h) => h.entity_id);
    const tvIds = insightHits(tvOut).map((h) => h.entity_id);
    const diningIds = insightHits(diningOut).map((h) => h.entity_id);

    // 3. Only when needed: landmarks without the tags, and trips seeded by the top artist.
    const widenPlaces = insightHits(placeOut).length < 2;
    const lateDest = !destOut && musicIds.length > 0;
    if (widenPlaces || lateDest) {
      const more = yield {
        narration: widenPlaces ? NARRATION.widen("landmark") : NARRATION.insights(`destinations people from ${locationQuery} with these tastes travelled to`),
        toolCalls: [
          ...(widenPlaces ? [call("qloo_insights", { ...placeArgs, filter_tags: undefined })] : []),
          ...(lateDest ? [call("qloo_insights", destArgs(musicIds.slice(0, 1)))] : []),
        ],
      };
      if (widenPlaces) placeOut = more[0];
      if (lateDest) destOut = more[widenPlaces ? 1 : 0];
    }
    const placeIds = insightHits(placeOut).map((h) => h.entity_id).filter((id) => !diningIds.includes(id));
    const destIds = insightHits(destOut).map((h) => h.entity_id);

    // 4. Choose and commit.
    const cards = chooseDeck({ music: musicIds, film: filmIds, dining: diningIds, place: placeIds, destination: destIds, tv: tvIds });
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

  protected *script(): Generator<PolicyStep, void, ToolOutcome[]> {
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
      const cross = CROSS_DOMAIN[domain];
      // The same domain and one other, asked together.
      const [sameOut, crossOut] = yield {
        narration: NARRATION.insights(`more ${DOMAIN_INFO[domain].plural} with "${fb.card.title}" as a signal, and ${DOMAIN_INFO[cross].plural} that match it`),
        toolCalls: [
          call(
            "qloo_insights",
            this.argsFor(domain, signalSeeds, currentIds, {
              purpose: `more like ${fb.card.title}`,
              filter_tags: domain === "dining" ? [PLACE_TAGS.restaurant] : undefined,
            }),
          ),
          call("qloo_insights", this.argsFor(cross, signalSeeds, currentIds, { purpose: `cross-domain from ${fb.card.title}` })),
        ],
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
      const [out] = yield {
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
