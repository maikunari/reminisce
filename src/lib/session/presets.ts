import type { Person } from "./types";

export interface Preset {
  id: string;
  person: Person;
  /** Short line under the name on the home page. */
  blurb: string;
  /** Two-letter flag-free locale hint used for the card art accent. */
  accent: "ember" | "sea";
}

/**
 * Two judges-ready people. Different decades, different hometowns, different
 * seed artists, so the sessions differ culturally end to end.
 */
export const PRESETS: Preset[] = [
  {
    id: "michiko",
    person: {
      name: "Michiko",
      birthYear: 1950,
      hometown: "Osaka",
      favorites: [{ name: "Hibari Misora" }],
      language: "en",
      presetId: "michiko",
    },
    blurb: "Born 1950, grew up in Osaka, loved Hibari Misora.",
    accent: "ember",
  },
  {
    id: "frank",
    person: {
      name: "Frank",
      birthYear: 1945,
      hometown: "Chicago",
      favorites: [{ name: "Frank Sinatra" }],
      language: "en",
      presetId: "frank",
    },
    blurb: "Born 1945, grew up in Chicago, loved Frank Sinatra.",
    accent: "sea",
  },
];

export function findPreset(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
