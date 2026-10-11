import type { Language } from "@/lib/session/types";

import { en } from "./en";
import { es } from "./es";
import { ja } from "./ja";
import type { Dictionary } from "./types";

export const DICTIONARIES: Record<Language, Dictionary> = { en, es, ja };

/** The strings for a session language; English when the language is unknown. */
export function dictionary(language: Language | undefined): Dictionary {
  return (language && DICTIONARIES[language]) || en;
}

export type { Dictionary };
