import type { Domain, Person } from "./types";

export interface Preset {
  id: string;
  person: Person;
  /** Two lines under the name on the home page. */
  blurb: string;
  /** Which sleeve stands in for their portrait on the home page. */
  art: Domain;
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
      pronoun: "she",
      presetId: "michiko",
    },
    blurb: "Grew up in Osaka with Hibari Misora on the radio. Qloo sets the table with the singers, films and places Osaka loved when she was young.",
    art: "music",
  },
  {
    id: "frank",
    person: {
      name: "Frank",
      birthYear: 1945,
      hometown: "Chicago",
      favorites: [{ name: "Frank Sinatra" }],
      language: "en",
      pronoun: "he",
      presetId: "frank",
    },
    blurb: "Grew up in Chicago with Frank Sinatra on the hi-fi. Qloo sets the table with the singers, films and places Chicago loved when he was young.",
    art: "film",
  },
];

export function findPreset(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
