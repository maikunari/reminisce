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
    blurb: "Grew up with Hibari Misora on the radio, Tora-san at the pictures, and the crab sign over Dotonbori.",
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
    blurb: "Sinatra on the hi-fi, the Rat Pack at the Chicago Theatre, steak at Gene & Georgetti.",
    art: "film",
  },
];

export function findPreset(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
