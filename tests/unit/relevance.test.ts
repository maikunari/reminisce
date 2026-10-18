import { describe, expect, it } from "vitest";

import { artistFit, bornInCountry, type SeedProfile } from "@/lib/agent/relevance";
import { buildInsightsParams } from "@/lib/qloo/params";
import { genreTagIdsOf, type QlooEntity, type QlooTag } from "@/lib/qloo/types";

function artist(name: string, over: { tags?: Partial<QlooTag>[]; popularity?: number; start?: number; born?: string; place?: string; affinity?: number } = {}): QlooEntity {
  return {
    name,
    entity_id: `ffffffff-0000-4000-8000-${name.length.toString().padStart(12, "0")}`,
    type: "urn:entity",
    subtype: "urn:entity:artist",
    popularity: over.popularity,
    tags: (over.tags ?? []) as QlooTag[],
    properties: { start_year: over.start, date_of_birth: over.born, place_of_birth: over.place },
    query: { affinity: over.affinity ?? 0.7 },
  };
}

const genre = (slug: string) => ({ id: `urn:tag:genre:music:${slug}`, name: slug });
const mood = (name: string) => ({ id: `urn:tag:audience:qloo:${name.toLowerCase()}`, name });
const skiffle: SeedProfile = { name: "Lonnie Donegan", genres: ["urn:tag:genre:music:skiffle", "urn:tag:genre:music:folk"] };

describe("genreTagIdsOf", () => {
  it("keeps music genre ids only, and survives tags with no name or no id", () => {
    const tags = [genre("skiffle"), mood("Loyal"), { type: "urn:tag:voice_type:qloo" }, { name: "Nostalgic" }, genre("skiffle"), { id: "URN:TAG:GENRE:MUSIC:Folk", name: "Folk" }];
    expect(genreTagIdsOf(tags)).toEqual(["urn:tag:genre:music:skiffle", "urn:tag:genre:music:folk"]);
    expect(genreTagIdsOf(undefined)).toEqual([]);
  });
});

describe("artistFit", () => {
  const ctx = { birthYear: 1940, seeds: [skiffle], homeCountry: "United Kingdom" };

  it("puts a same-genre act from the formative years above an off-genre one with a higher affinity", () => {
    const near = artistFit(artist("Chas McDevitt", { start: 1956, place: "Glasgow, Scotland, United Kingdom", tags: [genre("skiffle"), genre("folk")], affinity: 0.6 }), ctx);
    const other = artistFit(artist("Rock Band", { start: 1960, place: "Liverpool, England, United Kingdom", tags: [genre("rock")], affinity: 0.7 }), ctx);
    expect(near.genre).toBe(1);
    expect(near.formative).toBe(true);
    expect(near.score).toBeGreaterThan(other.score);
  });

  it("reads genre from music genre tags only: shared mood tags are not a genre", () => {
    const moody = artistFit(artist("Moody", { start: 1956, tags: [mood("Loyal"), mood("Nostalgic")] }), { ...ctx, seeds: [{ name: "Seed", genres: [] }] });
    const seedWithMoods = artistFit(artist("Moody", { start: 1956, tags: [mood("Loyal"), mood("Nostalgic")] }), ctx);
    expect(moody.genre).toBe(0);
    expect(seedWithMoods.genre).toBe(0);
  });

  it("does not crash on, or count, a tag with no name and no id", () => {
    const withNameless = artistFit(artist("Herbie", { start: 1956, tags: [{ type: "urn:tag:voice_type:qloo" }, genre("skiffle")] }), ctx);
    const without = artistFit(artist("Herbie", { start: 1956, tags: [genre("skiffle")] }), ctx);
    expect(withNameless.score).toBe(without.score);
  });

  it("has no popularity term: a household name of the person's own era is as welcome as a quiet one", () => {
    const sinatra = { birthYear: 1945, seeds: [{ name: "Frank Sinatra", genres: ["urn:tag:genre:music:traditional_pop"] }], homeCountry: "United States" };
    const famous = artistFit(artist("Nat King Cole", { popularity: 1, start: 1935, tags: [genre("traditional_pop")] }), sinatra);
    const quiet = artistFit(artist("Quiet Crooner", { popularity: 0.3, start: 1935, tags: [genre("traditional_pop")] }), sinatra);
    expect(famous.score).toBe(quiet.score);
  });

  it("marks down an act that started after the formative years", () => {
    const late = artistFit(artist("Late", { start: 1995 }), ctx);
    const onTime = artistFit(artist("OnTime", { start: 1958 }), ctx);
    expect(onTime.score).toBeGreaterThan(late.score);
  });

  it("does not mark down an artist who died before the person's youth", () => {
    const gone = artistFit({ ...artist("Gone", { start: 1935 }), properties: { start_year: 1935, year_of_death: 1953 } }, ctx);
    const living = artistFit(artist("Living", { start: 1935 }), ctx);
    expect(gone.score).toBe(living.score);
  });

  it("leans toward artists from the home country", () => {
    const home = artistFit(artist("Home", { start: 1958, place: "Cardiff, Wales, United Kingdom" }), ctx);
    const away = artistFit(artist("Away", { start: 1958, place: "Tennessee, United States" }), ctx);
    expect(home.score).toBeGreaterThan(away.score);
  });
});

describe("bornInCountry", () => {
  it("reads a place of birth in the way Qloo writes it", () => {
    expect(bornInCountry(artist("a", { place: "Glasgow, Scotland, United Kingdom" }), "United Kingdom")).toBe(true);
    expect(bornInCountry(artist("a", { place: "Glasgow, Scotland" }), "United Kingdom")).toBe(true);
    expect(bornInCountry(artist("a", { place: "Tennessee, United States" }), "United Kingdom")).toBe(false);
    expect(bornInCountry(artist("a", { place: "Osaka, Japan" }), undefined)).toBe(false);
    expect(bornInCountry(artist("a", {}), "Japan")).toBe(false);
  });
});

describe("filter.popularity.max", () => {
  it("is still a documented parameter, sent as a fraction rather than rounded to a whole number", () => {
    const { params, warnings } = buildInsightsParams({ type: "urn:entity:artist", filters: { popularityMax: 0.84 } });
    expect(params["filter.popularity.max"]).toBe("0.84");
    expect(warnings).toEqual([]);
  });
});
