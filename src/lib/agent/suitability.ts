/**
 * What may be dealt into a deck: no mature films or shows, and no artist twice.
 *
 * Reminisce sits across a table from someone with dementia, so a title whose
 * Qloo tags read "Prostitute", "Rape" or "Erotic realism" is left out however
 * well it scores. Qloo also lists one artist under two entities (Yukihiro
 * Takahashi and 高橋幸宏), so two cards are the same artist when any name,
 * alias or romanisation they carry agrees.
 */
import type { QlooEntity } from "@/lib/qloo/types";
import { romanisedName } from "@/lib/session/names";

/** Qloo tag names (lower case, whole tag) that mark a film or show as adult. */
const MATURE_TAGS = new Set([
  "mature",
  "adult",
  "adult film",
  "pornography",
  "pornographic",
  "erotic",
  "erotica",
  "erotic realism",
  "erotic thriller",
  "pink film",
  "softcore",
  "nudity",
  "explicit sex",
  "sexual violence",
  "sexual exploitation",
  "sexual favor",
  "sexually explicit",
  "rape",
  "prostitute",
  "prostitution",
  "brothel",
  "sex work",
  "comfort women",
  "incest",
]);

/** Whole words in a title that no gentle conversation starts from. */
const MATURE_TITLE_WORDS = /\b(prostitutes?|prostitution|prostituta|brothel|whores?|porn|porno|pornography|erotic|erotica|erótica?|rape|incest|orgy)\b|売春|娼婦|春婦|ポルノ|官能|情痴|強姦|レイプ/iu;

/** Titles the audit found in decks that no tag or word alone is trusted to catch. */
const MATURE_TITLES = new Set([
  "story of a prostitute",
  "春婦伝",
  "funeral parade of roses",
  "薔薇の葬列",
  "the red angel",
  "red angel",
  "赤い天使",
]);

const MATURE_RATINGS = new Set(["nc-17", "x", "r18", "r18+", "r-18", "r-18+", "18", "18+", "ao", "ma", "tv-ma"]);

function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim();
}

/** True when a film or show should never be dealt to the person. */
export function isMatureTitle(entity: QlooEntity): boolean {
  const name = fold(entity.name);
  if (MATURE_TITLES.has(name) || MATURE_TITLE_WORDS.test(name)) return true;
  if ((entity.tags ?? []).some((t) => MATURE_TAGS.has(fold(t.name)))) return true;
  const rating = entity.properties?.content_rating;
  return typeof rating === "string" && MATURE_RATINGS.has(fold(rating));
}

/** Letters and digits only, so "Yukihiro  Takahashi" and "yukihiro-takahashi" agree. */
function squash(text: string): string {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A Latin name in either order: "Takahashi Yukihiro" is "Yukihiro Takahashi". */
function nameKeys(name: string): string[] {
  const keys = [squash(name)];
  const words = fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 2 && /^[\p{Script=Latin}\p{N}]+$/u.test(words.join(""))) keys.push([...words].reverse().join(""));
  return keys.filter((k) => k.length > 0);
}

/** Every name an artist goes by: its title, Qloo's aliases and a romanisation in its description. */
export function artistKeys(artist: { name: string; description?: string; aliases?: unknown }): Set<string> {
  const names = [artist.name];
  if (Array.isArray(artist.aliases)) for (const a of artist.aliases) if (typeof a === "string") names.push(a);
  const roman = romanisedName(artist.name, artist.description);
  if (roman) names.push(roman);
  return new Set(names.flatMap(nameKeys));
}

/** The artists already on cards, by the names a card carries (its title and any romanisation in its description). */
export function ledgerOfCards(cards: { domain: string; title: string; description?: string }[]): ArtistLedger {
  const ledger = new ArtistLedger();
  for (const c of cards) if (c.domain === "music") ledger.claim(artistKeys({ name: c.title, description: c.description }));
  return ledger;
}

export function artistKeysOf(entity: QlooEntity): Set<string> {
  const p = entity.properties;
  return artistKeys({ name: entity.name, description: p?.description ?? p?.short_description, aliases: p?.aliases });
}

/** Hands out each artist once: `claim` is false when a name already seen belongs to the same artist. */
export class ArtistLedger {
  private readonly seen = new Set<string>();

  has(keys: Set<string>): boolean {
    for (const k of keys) if (this.seen.has(k)) return true;
    return false;
  }

  claim(keys: Set<string>): boolean {
    for (const k of keys) if (this.seen.has(k)) return false;
    for (const k of keys) this.seen.add(k);
    return true;
  }
}
