/**
 * A stand-in for the live Qloo API in the way Mike's 2026-10-17 test showed it
 * answering for a seed that is not mainstream: his dad's Lonnie Donegan (British
 * skiffle, 1950s). With the person's age bucket in the request the answer was
 * what every 55 and older likes (Dolly Parton, Tom Jones, the Beatles), the
 * seed counted for little; without it the seed leads, but a popularity pull
 * still puts the biggest names first until they are capped off.
 *
 * It models that reported behaviour; it is not a recording, and the entities
 * are real public names with invented ids and popularity scores. Everything
 * but artists is answered by the Frank-and-Chicago stand-in in live-qloo.ts.
 */
import { liveQlooFake, type LiveQlooFake } from "./live-qloo";

export const DONEGAN_PERSON = "33333333-0000-4000-8000-000000000001";
export const DONEGAN = "33333333-0000-4000-8000-000000000002";

interface Act {
  name: string;
  popularity: number;
  /** How close the act is to Lonnie Donegan, 0 to 1. */
  near: number;
  start: number;
  tags: string[];
  born: string;
  place: string;
}

const SKIFFLE = ["Skiffle", "Folk"];

export const ACTS: Act[] = [
  { name: "The Beatles", popularity: 0.99, near: 0.35, start: 1960, tags: ["Rock", "Pop"], born: "1940-10-09", place: "Liverpool, England, United Kingdom" },
  { name: "Dolly Parton", popularity: 0.97, near: 0.1, start: 1959, tags: ["Country", "Pop"], born: "1946-01-19", place: "Tennessee, United States" },
  { name: "Tom Jones", popularity: 0.93, near: 0.2, start: 1963, tags: ["Pop", "Soul"], born: "1940-06-07", place: "Pontypridd, Wales, United Kingdom" },
  { name: "Cliff Richard", popularity: 0.9, near: 0.4, start: 1958, tags: ["Pop", "Rock"], born: "1940-10-14", place: "Lucknow, India" },
  { name: "The Rolling Stones", popularity: 0.97, near: 0.3, start: 1962, tags: ["Rock", "Blues"], born: "1943-07-26", place: "London, England, United Kingdom" },
  { name: "Tommy Steele", popularity: 0.58, near: 0.82, start: 1956, tags: ["Skiffle", "Pop"], born: "1936-12-17", place: "London, England, United Kingdom" },
  { name: "Chas McDevitt", popularity: 0.31, near: 0.92, start: 1956, tags: SKIFFLE, born: "1934-11-04", place: "Glasgow, Scotland, United Kingdom" },
  { name: "The Vipers Skiffle Group", popularity: 0.3, near: 0.9, start: 1956, tags: SKIFFLE, born: "1934-01-01", place: "London, England, United Kingdom" },
  { name: "Johnny Duncan", popularity: 0.33, near: 0.88, start: 1956, tags: SKIFFLE, born: "1932-10-07", place: "Tennessee, United States" },
  { name: "Nancy Whiskey", popularity: 0.27, near: 0.86, start: 1956, tags: SKIFFLE, born: "1935-05-02", place: "Glasgow, Scotland, United Kingdom" },
];

const MAINSTREAM = ["The Beatles", "Tom Jones", "Dolly Parton", "Cliff Richard", "The Rolling Stones"];

export interface SeededQlooOptions {
  /** Answer as if `filter.popularity.max` were not understood. */
  ignoreCap?: boolean;
  /** Keep only this many of the skiffle acts in the catalogue, so the capped answer is thin. */
  skiffleActs?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function entityOf(act: Act, affinity: number) {
  const index = ACTS.indexOf(act);
  return {
    entity_id: `33333333-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    name: act.name,
    subtype: "urn:entity:artist",
    popularity: act.popularity,
    tags: act.tags.map((name) => ({ id: `urn:tag:genre:music:${name.toLowerCase()}`, name })),
    properties: { start_year: act.start, date_of_birth: act.born, place_of_birth: act.place },
    query: { affinity, explainability: { entities: { [DONEGAN]: act.near } } },
  };
}

export function seededQlooFake(options: SeededQlooOptions = {}): LiveQlooFake {
  const base = liveQlooFake();
  const calls: LiveQlooFake["calls"] = [];
  const catalogue = ACTS.filter((a) => !a.tags.includes("Skiffle") || a.name === "Tommy Steele" || options.skiffleActs === undefined || ACTS.filter((x) => x.tags.includes("Skiffle") && x.name !== "Tommy Steele").indexOf(a) < options.skiffleActs);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ path: url.pathname, params });
    if (url.pathname === "/search") {
      const query = (params.query ?? "").toLowerCase();
      if (query === "lonnie donegan") {
        return json({
          results: [
            { entity_id: DONEGAN_PERSON, name: "Lonnie Donegan", types: ["urn:entity:person"] },
            { entity_id: DONEGAN, name: "Lonnie Donegan", types: ["urn:entity:artist"], popularity: 0.74, tags: [{ id: "urn:tag:genre:music:skiffle", name: "Skiffle" }, { id: "urn:tag:genre:music:folk", name: "Folk" }] },
          ],
        });
      }
      if ((params.types ?? "").includes("urn:entity:locality") && query === "london") {
        return json({
          results: [
            {
              entity_id: "99999999-0000-4000-8000-000000000003",
              name: "London",
              types: ["urn:entity:locality"],
              disambiguation: "London, Greater London, England, United Kingdom",
              properties: { akas: [{ value: "London" }] },
            },
          ],
        });
      }
    }
    if (url.pathname === "/v2/insights" && params["filter.type"] === "urn:entity:artist") {
      const take = Number(params.take ?? 10);
      const exclude = new Set((params["filter.exclude.entities"] ?? "").split(",").filter(Boolean));
      const cap = options.ignoreCap || params["filter.popularity.max"] === undefined ? 1 : Number(params["filter.popularity.max"]);
      const pool = params["signal.demographics.age"]
        ? // The age bucket drowns the seed: what that whole crowd likes, in order of fame.
          catalogue.filter((a) => MAINSTREAM.includes(a.name)).sort((a, b) => b.popularity - a.popularity)
        : // The seed leads, with a pull toward the famous.
          catalogue.filter((a) => a.popularity <= cap).sort((a, b) => 0.4 * b.near + 0.6 * b.popularity - (0.4 * a.near + 0.6 * a.popularity));
      const entities = pool.map((a) => entityOf(a, Math.round((0.4 * a.near + 0.6 * a.popularity) * 100) / 100)).filter((e) => !exclude.has(e.entity_id)).slice(0, take);
      return json({ success: true, results: { entities } });
    }
    return base.fetch(input, init);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}
