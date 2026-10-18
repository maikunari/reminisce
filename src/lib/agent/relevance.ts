/**
 * How well an artist fits the person behind the seed, beyond Qloo's own
 * affinity: the same genre as the seed, from the person's formative years, from
 * their country, and no more famous than the seed is.
 *
 * Qloo blends every signal it is given. A seed such as Lonnie Donegan, blended
 * with "55 and older" and a hometown, is drowned out by what that crowd likes
 * in general (the Beatles, Tom Jones, Dolly Parton). The tool therefore leaves
 * the age signal out of a seeded artist call and caps popularity, and this
 * score then orders what comes back so the seed's own neighbourhood leads.
 */
import type { QlooEntity } from "@/lib/qloo/types";
import { entityAffinity } from "@/lib/qloo/types";

/** Ages the formative years run from; the youth window itself starts at 15. */
export const FORMATIVE_FROM = 10;
export const FORMATIVE_TO = 30;

/** What the planner knows of one seed: enough to keep suggestions near it. */
export interface SeedProfile {
  name: string;
  /** Qloo popularity percentile, 0 to 1, when known. */
  popularity?: number;
  /** Genre tag names, lower case. */
  tags: string[];
}

/** How far above the seed's own popularity an artist may be before it counts as "more mainstream". */
export const POPULARITY_MARGIN = 0.1;
/** The popularity cap sent to Qloo is never tighter than this, so a very niche seed still finds neighbours. */
const MIN_POPULARITY_CAP = 0.5;
/** A seed whose popularity is unknown is treated as this popular when penalising mainstream names. */
const ASSUMED_SEED_POPULARITY = 0.85;

export function foldTag(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * The `filter.popularity.max` for an artist call seeded on these profiles: a
 * little above the least famous seed, since that is the one a mainstream
 * answer would drown. Undefined when no seed has a known popularity or the cap
 * would not exclude anyone.
 */
export function popularityCapFor(seeds: SeedProfile[]): number | undefined {
  const known = seeds.map((s) => s.popularity).filter((p): p is number => typeof p === "number");
  if (known.length === 0) return undefined;
  const cap = Math.max(MIN_POPULARITY_CAP, Math.min(...known) + POPULARITY_MARGIN);
  return cap >= 0.99 ? undefined : Math.round(cap * 100) / 100;
}

/** UK nations and the long forms Qloo uses for a place of birth, to the country name the planner holds. */
const COUNTRY_ALIASES: Record<string, string> = {
  england: "united kingdom",
  scotland: "united kingdom",
  wales: "united kingdom",
  "northern ireland": "united kingdom",
  uk: "united kingdom",
  "great britain": "united kingdom",
  usa: "united states",
  "united states of america": "united states",
};

/** True when the artist's place of birth is in the home country. Unknown on either side is no evidence. */
export function bornInCountry(entity: QlooEntity, homeCountry: string | undefined): boolean {
  const place = entity.properties?.place_of_birth;
  if (!homeCountry || typeof place !== "string") return false;
  const home = foldTag(homeCountry);
  return place.split(",").some((part) => {
    const p = foldTag(part);
    return p === home || COUNTRY_ALIASES[p] === home;
  });
}

export interface ArtistFitContext {
  birthYear: number;
  seeds: SeedProfile[];
  homeCountry?: string;
}

export interface ArtistFit {
  score: number;
  /** Share of the seeds' genres the artist carries, 0 to 1. */
  genre: number;
  /** True when the artist began performing in the person's formative years. */
  formative: boolean;
}

export function artistFit(entity: QlooEntity, ctx: ArtistFitContext): ArtistFit {
  const base = entityAffinity(entity) ?? 0.5;
  const own = new Set((entity.tags ?? []).map((t) => foldTag(t.name)));
  const seedTags = new Set(ctx.seeds.flatMap((s) => s.tags));
  let shared = 0;
  for (const t of seedTags) if (own.has(t)) shared += 1;
  const genre = seedTags.size > 0 ? Math.min(1, shared / Math.min(seedTags.size, 2)) : 0;

  const from = ctx.birthYear + FORMATIVE_FROM;
  const to = ctx.birthYear + FORMATIVE_TO;
  const started = typeof entity.properties?.start_year === "number" ? entity.properties.start_year : undefined;
  const formative = started !== undefined && started >= from - 5 && started <= to;
  let era = 0;
  // An artist who died before the person's youth is no less loved for it (their records played on), so only the start counts.
  if (formative) era += 0.15;
  else if (started !== undefined && started > to) era -= 0.3;

  const known = ctx.seeds.map((s) => s.popularity).filter((p): p is number => typeof p === "number");
  const reference = (known.length > 0 ? Math.min(...known) : ASSUMED_SEED_POPULARITY) + POPULARITY_MARGIN / 2;
  const popularity = typeof entity.popularity === "number" ? entity.popularity : undefined;
  const mainstream = popularity !== undefined ? 1.5 * Math.max(0, popularity - reference) : 0;

  const country = bornInCountry(entity, ctx.homeCountry) ? 0.1 : 0;
  return { score: base + 0.3 * genre + era + country - mainstream, genre, formative };
}
