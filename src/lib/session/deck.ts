/**
 * The size of a deck, in one place: the planner's validator, the home page
 * copy and the tests all read these so the numbers cannot drift apart.
 */
export const PLAN_MIN_CARDS = 8;
export const PLAN_MAX_CARDS = 10;
export const PLAN_MIN_DOMAINS = 3;

const WORDS: Record<string, string[]> = {
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"],
  es: ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"],
};

/** "eight", "diez"; digits beyond twelve, and always digits in Japanese. */
export function numberWord(n: number, language = "en"): string {
  return WORDS[language]?.[n] ?? String(n);
}

/** "eight to ten", "ocho a diez", "8〜10". */
export function deckSizeLabel(language = "en"): string {
  if (language === "ja") return `${PLAN_MIN_CARDS}〜${PLAN_MAX_CARDS}`;
  const joiner = language === "es" ? " a " : " to ";
  return `${numberWord(PLAN_MIN_CARDS, language)}${joiner}${numberWord(PLAN_MAX_CARDS, language)}`;
}
