import { describe, expect, it } from "vitest";

import { artistFit, bornInCountry, type SeedProfile } from "@/lib/agent/relevance";
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

  it("puts a megastar behind on-genre, on-era peers of similar affinity, even for a well-known seed", () => {
    const sinatra = { birthYear: 1945, seeds: [{ name: "Frank Sinatra", genres: ["urn:tag:genre:music:traditional_pop"] }], homeCountry: "United States" };
    const crooner = { start: 1950, place: "New Jersey, United States", tags: [genre("traditional_pop")] };
    const ranked = [
      artist("Megastar", { ...crooner, popularity: 0.99, affinity: 0.72 }),
      artist("Peer One", { ...crooner, popularity: 0.92, affinity: 0.7 }),
      artist("Peer Two", { ...crooner, popularity: 0.6, affinity: 0.68 }),
    ]
      .map((e) => ({ name: e.name, score: artistFit(e, sinatra).score }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.name);
    expect(ranked).toEqual(["Peer One", "Peer Two", "Megastar"]);
  });

  it("still ranks a household name first when it is the clearly better fit", () => {
    const famous = artistFit(artist("Lonnie Donegan Band", { popularity: 0.99, start: 1956, place: "Glasgow, Scotland, United Kingdom", tags: [genre("skiffle"), genre("folk")], affinity: 0.7 }), ctx);
    const offGenre = artistFit(artist("Quiet Jazz", { popularity: 0.3, start: 1956, place: "Tennessee, United States", tags: [genre("jazz")], affinity: 0.7 }), ctx);
    expect(famous.score).toBeGreaterThan(offGenre.score);
  });

  it("marks every household name down alike, so a run of them keeps its order", () => {
    const sinatra = { birthYear: 1925, seeds: [{ name: "Frank Sinatra", genres: ["urn:tag:genre:music:traditional_pop"] }], homeCountry: "United States" };
    const cole = artistFit(artist("Nat King Cole", { popularity: 1, start: 1936, tags: [genre("traditional_pop")], affinity: 0.8 }), sinatra);
    const martin = artistFit(artist("Dean Martin", { popularity: 0.99, start: 1946, tags: [genre("traditional_pop")], affinity: 0.75 }), sinatra);
    expect(cole.score).toBeGreaterThan(martin.score);
    expect(cole.score - martin.score).toBeCloseTo(0.05);
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
