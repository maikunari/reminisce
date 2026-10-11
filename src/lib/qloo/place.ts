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

/**
 * Whether a typed hometown names this place: one of its names is the whole
 * text, or leads it with every comma-separated qualifier naming the place's
 * own region or country ("Osaka, Japan", "Chicago, Illinois"). "Hollywood,
 * Florida", "La Jolla" or "New Orleans, LA" are other places.
 */
export function namesPlace(typed: string, names: string[], namesHome: (qualifier: string) => boolean): boolean {
  const [head = "", ...qualifiers] = typed.split(",");
  const named = names.map(phrase);
  if (named.includes(phrase(typed))) return true;
  return qualifiers.length > 0 && named.includes(phrase(head)) && qualifiers.every((q) => namesHome(phrase(q)));
}
