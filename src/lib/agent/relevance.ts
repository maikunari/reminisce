/**
 * How well an artist fits the person behind the seed, beyond Qloo's own
 * affinity: the same music genre as the seed, from the person's formative
 * years, and from their country.
 *
 * Qloo blends every signal it is given, and measured live it is the hometown
 * signal that drowns a niche seed: Lonnie Donegan alone returns Billy Fury and
 * The Vipers Skiffle Group, Donegan with London returns Dolly Parton, Dave
 * Davies and Twiggy (Hibari Misora with Osaka, J-pop idols; Sinatra with
 * Chicago, Streisand and Elton John). So a seeded artist call carries the seed
 * alone (see keepSeed in tools.ts), and the person's years and country come
 * back in afterwards, as tie-breaks on this score: a seed-only answer's
 * affinities are nearly flat, so these decide the order, and Qloo cannot let
 * them outweigh the seed. There is no popularity term: the household names of
 * a person's own era (Nat King Cole for a Sinatra fan) are what reminiscence
 * is for, and a seed-only answer does not lead with strangers' favourites.
 */
import { GENRE_TAG_PREFIX, entityAffinity, genreTagIdsOf, type QlooEntity } from "@/lib/qloo/types";

/** Ages the formative years run from; the youth window itself starts at 15. */
export const FORMATIVE_FROM = 10;
export const FORMATIVE_TO = 30;

/** What the planner knows of one seed: enough to keep suggestions near it. */
export interface SeedProfile {
  name: string;
  /** Music genre tag ids, lower case (urn:tag:genre:music:skiffle). */
  genres: string[];
}

/** Added for an artist born in the person's country: a tie-break among artists Qloo scores almost alike. */
const COUNTRY_BONUS = 0.15;
const GENRE_BONUS = 0.3;
const FORMATIVE_BONUS = 0.15;
/** Taken off an artist that began performing after the person's formative years: they could not have been heard then. */
const LATE_PENALTY = 0.3;

export function foldName(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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
  const home = foldName(homeCountry);
  return place.split(",").some((part) => {
    const p = foldName(part);
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
  const own = new Set(genreTagIdsOf(entity.tags));
  const seedGenres = new Set(ctx.seeds.flatMap((s) => s.genres).filter((g) => g.startsWith(GENRE_TAG_PREFIX)));
  let shared = 0;
  for (const g of seedGenres) if (own.has(g)) shared += 1;
  const genre = seedGenres.size > 0 ? Math.min(1, shared / Math.min(seedGenres.size, 2)) : 0;

  const from = ctx.birthYear + FORMATIVE_FROM;
  const to = ctx.birthYear + FORMATIVE_TO;
  const started = typeof entity.properties?.start_year === "number" ? entity.properties.start_year : undefined;
  const formative = started !== undefined && started >= from - 5 && started <= to;
  let era = 0;
  // An artist who died before the person's youth is no less loved for it (their records played on), so only the start counts.
  if (formative) era += FORMATIVE_BONUS;
  else if (started !== undefined && started > to) era -= LATE_PENALTY;

  const country = bornInCountry(entity, ctx.homeCountry) ? COUNTRY_BONUS : 0;
  return { score: base + GENRE_BONUS * genre + era + country, genre, formative };
}
