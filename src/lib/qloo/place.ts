import regionsData from "../../../fixtures/synthetic/regions.json";

const COUNTRIES = (regionsData as { countries: { code: string; name: string; keywords: string[] }[] }).countries;

/** Case- and accent-insensitive form of a name: "Ciudad de México" -> "ciudad de mexico". */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Whole-token match: "mexico city" contains the token "mexico", "new mexico" too, "mexicali" does not. */
export function tokens(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** A name reduced to its folded words, for whole-name comparison. */
export function phrase(text: string): string {
  return tokens(text).join(" ");
}

/** What a locality is known by: a Qloo search hit or a catalogue entry. */
export interface PlaceNames {
  name: string;
  akas?: string[];
  disambiguation?: string;
  country_code?: string;
  admin1_region?: string;
}

function namesPlace(typed: string, names: string[], home: string[]): boolean {
  const [head = "", ...rest] = typed.split(",");
  const qualifiers = rest.map(phrase).filter((q) => q.length > 0);
  const named = names.map(phrase);
  if (named.includes(phrase(typed))) return true;
  return qualifiers.length > 0 && named.includes(phrase(head)) && qualifiers.every((q) => home.includes(q));
}

/**
 * Whether a typed hometown names this place: its name or an aka is the whole
 * text, or leads it with every comma-separated qualifier naming the place's
 * own region or country ("Osaka, Japan", "Chicago, Illinois"). "Hollywood,
 * Florida", "La Jolla" or "New Orleans, LA" are other places. A nickname or
 * district ("Hollywood", "Brooklyn") also names towns elsewhere in the
 * country, so only the place's own name takes a bare country word
 * ("Chicago, USA", "Tokyo, Nippon").
 */
export function isTypedPlace(typed: string, place: PlaceNames): boolean {
  const country = COUNTRIES.find((c) => c.code === place.country_code?.toUpperCase());
  const home = [place.admin1_region, country?.name, country?.code, ...(place.disambiguation?.split(",") ?? [])]
    .filter((n): n is string => n !== undefined)
    .map(phrase);
  return (
    namesPlace(typed, [place.name, ...(place.akas ?? [])], home) ||
    namesPlace(typed, [place.name], [...home, ...(country?.keywords ?? []).map(phrase)])
  );
}
