/**
 * A stand-in for the live Qloo hackathon API that answers the way the real one
 * did on 2026-10-14, when the public demo first ran on live Qloo and the
 * captain's Frank session (Chicago, 1960 to 1975, loved Frank Sinatra) stalled.
 *
 * The behaviours are copied from recorded live responses; the entities are
 * invented (the hackathon terms keep Qloo data out of public repositories, so
 * the real recordings stay in the git-ignored fixtures/live/):
 *
 * - TV shows: none at all for a location signal combined with release years;
 *   the same request without the location signal returns shows from the era,
 *   and one with no year filter leads with a 2018 Chicago drama.
 * - Films: a location signal with years works for Chicago, returns nothing for Osaka.
 * - Search: "Hibari Misora" puts a bare person record (no popularity) ahead of
 *   the artist "Misora Hibari". Insights rejects that id with a 400 unless a
 *   location signal is present, in which case it silently ignores it and
 *   answers for the city alone (modern bands).
 * - Landmarks: the seed's taste plus landmark tags returns almost nothing; the
 *   tourist-attraction and landmark genre tags without the seed return the sights.
 * - Artists carry start_year; a city-only answer is full of bands formed long after.
 */
interface FakeEntity {
  entity_id: string;
  name: string;
  subtype?: string;
  popularity?: number;
  properties?: Record<string, unknown>;
  query?: { affinity: number };
}

export interface LiveQlooFake {
  fetch: typeof fetch;
  /** Every request made, as path plus parameters. */
  calls: { path: string; params: Record<string, string> }[];
}

const SINATRA = "11111111-0000-4000-8000-000000000001";
const HIBARI_PERSON = "22222222-0000-4000-8000-000000000001";
const HIBARI_ARTIST = "22222222-0000-4000-8000-000000000002";

function entity(prefix: string, i: number, name: string, properties: Record<string, unknown> = {}, affinity = 0.95 - i * 0.01): FakeEntity {
  return {
    entity_id: `${prefix}-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name,
    popularity: 0.9 - i * 0.01,
    properties,
    query: { affinity },
  };
}

/** TV shows from 1950 to 2020, a few per year, plus the 2018 Chicago drama that led the no-years answer. */
const SHOWS: FakeEntity[] = [
  entity("cccccccc", 0, "South Side Drama", { release_year: 2018, release_country: ["United States"] }, 0.99),
  ...Array.from({ length: 70 }, (_, i) => entity("cccccccc", i + 1, `Family Hour ${1950 + i}`, { release_year: 1950 + i, release_country: ["United States"] }, 0.9 - i * 0.001)),
];

const FILMS: FakeEntity[] = Array.from({ length: 70 }, (_, i) => entity("dddddddd", i, `Picture Show ${1950 + i}`, { release_year: 1950 + i, release_country: ["United States"] }, 0.92 - i * 0.001));

const CROONERS: FakeEntity[] = Array.from({ length: 12 }, (_, i) => entity("eeeeeeee", i, `Crooner ${i + 1}`, { start_year: 1940 + i * 2 }));
const MODERN_BANDS: FakeEntity[] = Array.from({ length: 25 }, (_, i) => entity("ffffffff", i, `Modern Band ${i + 1}`, { start_year: 1985 + i }));
const ENKA: FakeEntity[] = Array.from({ length: 25 }, (_, i) => entity("abababab", i, `Enka Singer ${i + 1}`, { start_year: 1950 + i }));

const RESTAURANTS = Array.from({ length: 8 }, (_, i) => entity("12121212", i, `Supper Club ${i + 1}`, { geocode: { name: "Chicago" } }));
const SIGHTS = Array.from({ length: 8 }, (_, i) => entity("13131313", i, `Old Theatre ${i + 1}`, { geocode: { name: "Chicago" } }));
const DESTINATIONS = Array.from({ length: 8 }, (_, i) => entity("14141414", i, `Seaside Town ${i + 1}`));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function insights(params: Record<string, string>): Response {
  const type = params["filter.type"];
  const take = Number(params.take ?? 10);
  const seeds = (params["signal.interests.entities"] ?? "").split(",").filter(Boolean);
  const location = params["signal.location.query"];
  const min = params["filter.release_year.min"] ? Number(params["filter.release_year.min"]) : undefined;
  const max = params["filter.release_year.max"] ? Number(params["filter.release_year.max"]) : undefined;
  const inYears = (e: FakeEntity) => {
    const year = e.properties?.release_year as number;
    return (min === undefined || year >= min) && (max === undefined || year <= max);
  };
  const exclude = new Set((params["filter.exclude.entities"] ?? "").split(",").filter(Boolean));
  const answer = (list: FakeEntity[]) => json({ success: true, results: { entities: list.filter((e) => !exclude.has(e.entity_id)).slice(0, take) } });

  if (seeds.length > 0 && seeds.every((s) => s === HIBARI_PERSON)) {
    if (!location) return json({ errors: [{ message: "All of the provided signal.interests.entities were invalid" }] }, 400);
    // A location signal makes Qloo ignore the unusable seed and answer for the city alone.
    if (type === "urn:entity:artist") return answer(MODERN_BANDS);
  }
  switch (type) {
    case "urn:entity:artist":
      return answer(seeds.includes(HIBARI_ARTIST) ? ENKA : CROONERS);
    case "urn:entity:tv_show":
      if (location && (min !== undefined || max !== undefined)) return answer([]);
      return answer(SHOWS.filter(inYears));
    case "urn:entity:movie":
      if (location && location !== "Chicago" && (min !== undefined || max !== undefined)) return answer([]);
      return answer(FILMS.filter(inYears));
    case "urn:entity:place": {
      const tags = params["filter.tags"] ?? "";
      if (tags.includes("restaurant")) return answer(RESTAURANTS);
      if (tags.includes("urn:tag:genre:place:tourist_attraction") && seeds.length === 0) return answer(SIGHTS);
      return answer(SIGHTS.slice(0, 1));
    }
    case "urn:entity:destination":
      return answer(DESTINATIONS);
    default:
      return answer([]);
  }
}

function search(params: Record<string, string>): Response {
  const query = (params.query ?? "").toLowerCase();
  const locality = (params.types ?? "").includes("urn:entity:locality");
  if (locality && query === "chicago") {
    return json({
      results: [
        {
          entity_id: "99999999-0000-4000-8000-000000000001",
          name: "Chicago",
          types: ["urn:entity:locality"],
          disambiguation: "Chicago, West Chicago Township, Cook County, Illinois, United States of America",
          properties: { akas: [{ value: "Chicago" }] },
        },
      ],
    });
  }
  if (locality && query === "osaka") {
    return json({
      results: [
        {
          entity_id: "99999999-0000-4000-8000-000000000002",
          name: "大阪市",
          types: ["urn:entity:locality"],
          disambiguation: "大阪市, 大阪府, 近畿地方, 日本",
          properties: { akas: [{ value: "大阪市/大阪" }, { value: "Osaka" }] },
        },
      ],
    });
  }
  if (query === "frank sinatra") {
    return json({
      results: [
        { entity_id: SINATRA, name: "Frank Sinatra", types: ["urn:entity:artist"], popularity: 0.999 },
        { entity_id: "11111111-0000-4000-8000-000000000002", name: "Frank Sinatra", types: ["urn:entity:person"], popularity: 0.91 },
      ],
    });
  }
  if (query === "hibari misora") {
    return json({
      results: [
        { entity_id: HIBARI_PERSON, name: "Hibari Misora", types: ["urn:entity:person"] },
        { entity_id: HIBARI_ARTIST, name: "Misora Hibari", types: ["urn:entity:artist"], popularity: 0.61 },
        { entity_id: "22222222-0000-4000-8000-000000000003", name: "Hibari Misora Memorial House", types: ["urn:entity:place"] },
      ],
    });
  }
  return json({ results: [] }, 404);
}

function tags(params: Record<string, string>): Response {
  const query = params["filter.query"] ?? "";
  const ids: Record<string, string[]> = {
    restaurant: ["urn:tag:genre:place:restaurant", "urn:tag:category:place:restaurant"],
    "tourist attraction": ["urn:tag:genre:place:tourist_attraction", "urn:tag:category:place:tourist_attraction", "urn:tag:genre:place:hotel:tourist_attraction"],
    landmark: ["urn:tag:genre:place:landmark", "urn:tag:category:place:landmark", "urn:tag:setting:qloo:landmark"],
  };
  return json({ success: true, results: { tags: (ids[query] ?? []).map((id) => ({ id, name: query, type: "urn:tag:genre:place" })) } });
}

export function liveQlooFake(): LiveQlooFake {
  const calls: LiveQlooFake["calls"] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ path: url.pathname, params });
    if (url.pathname === "/v2/insights") return insights(params);
    if (url.pathname === "/search") return search(params);
    if (url.pathname === "/v2/tags") return tags(params);
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export const FAKE_IDS = { SINATRA, HIBARI_PERSON, HIBARI_ARTIST };
