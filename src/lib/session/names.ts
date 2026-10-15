/**
 * How a card's title reads on screen. Qloo returns some artists under their
 * native script only (岩崎宏美) and some Japanese cities with their municipal
 * suffix ("Kobe-shi"). The stored card is left as Qloo gave it; this is the
 * reading copy.
 */
import type { Card, Language } from "./types";

const LATIN = /\p{Script=Latin}/u;
const NAME = String.raw`\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){1,3}`;
/** "前川清 (Kiyoshi Maekawa) is…" */
const PARENTHETICAL = new RegExp(String.raw`\((${NAME})\)`, "u");
/** "Hiromi Iwasaki is a Japanese singer…" */
const LEADING = new RegExp(String.raw`^(${NAME})\s+(?:is|was)\b`, "u");

export interface DisplayName {
  title: string;
  /** The title as Qloo wrote it, when the reading title is a romanisation of it. */
  native?: string;
}

/** "Kobe-shi" → "Kobe". Only a Latin-script name with the suffix; anything else is left alone. */
export function stripMunicipalSuffix(title: string): string {
  const match = /^(.*\p{L})-shi$/u.exec(title.trim());
  return match && LATIN.test(match[1]!) ? match[1]! : title;
}

/** The Latin-script name a description gives for a title that has none, or null. */
export function romanisedName(title: string, description: string | undefined): string | null {
  if (LATIN.test(title) || !description) return null;
  const hit = PARENTHETICAL.exec(description.slice(0, 120)) ?? LEADING.exec(description);
  return hit ? hit[1]! : null;
}

/** The title to show for a card in a session in `language`. Japanese readers keep the native title. */
export function displayName(card: Pick<Card, "title" | "description">, language: Language | undefined): DisplayName {
  const title = stripMunicipalSuffix(card.title);
  if (language === "ja") return { title };
  const roman = romanisedName(title, card.description);
  return roman ? { title: roman, native: title } : { title };
}
