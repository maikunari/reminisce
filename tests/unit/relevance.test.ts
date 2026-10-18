import { describe, expect, it } from "vitest";

import { artistFit, bornInCountry, popularityCapFor, type SeedProfile } from "@/lib/agent/relevance";
import { buildInsightsParams } from "@/lib/qloo/params";
import type { QlooEntity } from "@/lib/qloo/types";

function artist(name: string, over: Partial<QlooEntity> & { start?: number; born?: string; place?: string } = {}): QlooEntity {
  return {
    name,
    entity_id: `ffffffff-0000-4000-8000-${name.length.toString().padStart(12, "0")}`,
    type: "urn:entity",
    subtype: "urn:entity:artist",
    popularity: over.popularity,
    tags: (over.tags ?? []).length ? over.tags : [],
    properties: { start_year: over.start, date_of_birth: over.born, place_of_birth: over.place },
    query: over.query ?? { affinity: 0.7 },
  };
}

const skiffle: SeedProfile = { name: "Lonnie Donegan", popularity: 0.74, tags: ["skiffle", "folk"] };
const tag = (name: string) => ({ id: `urn:tag:${name}`, name });

describe("popularityCapFor", () => {
  it("allows a little above the least famous seed", () => {
    expect(popularityCapFor([skiffle])).toBe(0.84);
    expect(popularityCapFor([skiffle, { name: "The Beatles", popularity: 0.99, tags: [] }])).toBe(0.84);
  });

  it("does not cap for a seed whose popularity is unknown, or one so famous the cap would exclude no one", () => {
    expect(popularityCapFor([{ name: "?", tags: [] }])).toBeUndefined();
    expect(popularityCapFor([])).toBeUndefined();
    expect(popularityCapFor([{ name: "Frank Sinatra", popularity: 0.99, tags: [] }])).toBeUndefined();
  });

  it("never caps tighter than half, so a very niche seed still finds neighbours", () => {
    expect(popularityCapFor([{ name: "Obscure", popularity: 0.05, tags: [] }])).toBe(0.5);
  });
});

describe("artistFit", () => {
  const ctx = { birthYear: 1940, seeds: [skiffle], homeCountry: "United Kingdom" };

  it("puts a same-genre act from the formative years above a famous one outside the genre", () => {
    const near = artistFit(artist("Chas McDevitt", { popularity: 0.31, start: 1956, place: "Glasgow, Scotland, United Kingdom", tags: [tag("Skiffle"), tag("Folk")], query: { affinity: 0.6 } }), ctx);
    const famous = artistFit(artist("The Beatles", { popularity: 0.99, start: 1960, place: "Liverpool, England, United Kingdom", tags: [tag("Rock")], query: { affinity: 0.7 } }), ctx);
    expect(near.genre).toBe(1);
    expect(near.formative).toBe(true);
    expect(near.score).toBeGreaterThan(famous.score);
  });

  it("puts a household name below on-genre, on-era acts even when the seed is famous too", () => {
    const famousSeed = { birthYear: 1940, seeds: [{ name: "Famous Seed", popularity: 0.92, tags: ["skiffle", "folk"] }], homeCountry: "United Kingdom" };
    expect(popularityCapFor(famousSeed.seeds)).toBeUndefined();
    const beatles = artistFit(artist("The Beatles", { popularity: 0.99, start: 1960, place: "Liverpool, England, United Kingdom", tags: [tag("Skiffle"), tag("Rock")], query: { affinity: 0.95 } }), famousSeed);
    const vipers = artistFit(artist("The Vipers", { popularity: 0.6, start: 1956, place: "London, England, United Kingdom", tags: [tag("Skiffle"), tag("Folk")], query: { affinity: 0.5 } }), famousSeed);
    const duncan = artistFit(artist("Johnny Duncan", { popularity: 0.9, start: 1957, tags: [tag("Skiffle"), tag("Folk")], query: { affinity: 0.6 } }), famousSeed);
    expect(vipers.score).toBeGreaterThan(beatles.score);
    expect(duncan.score).toBeGreaterThan(beatles.score);
  });

  it("does not punish an act for being about as famous as the seed", () => {
    const peer = artistFit(artist("Peer", { popularity: 0.78, start: 1956, tags: [tag("Skiffle")] }), ctx);
    const quiet = artistFit(artist("Quiet", { popularity: 0.3, start: 1956, tags: [tag("Skiffle")] }), ctx);
    expect(peer.score).toBeCloseTo(quiet.score, 5);
  });

  it("marks down an act that started after the formative years", () => {
    const late = artistFit(artist("Late", { popularity: 0.5, start: 1995 }), ctx);
    const onTime = artistFit(artist("OnTime", { popularity: 0.5, start: 1958 }), ctx);
    expect(onTime.score).toBeGreaterThan(late.score);
  });

  it("does not mark down an artist who died before the person's youth", () => {
    const gone = artistFit({ ...artist("Gone", { popularity: 0.5, start: 1935 }), properties: { start_year: 1935, year_of_death: 1953 } }, ctx);
    const living = artistFit(artist("Living", { popularity: 0.5, start: 1935 }), ctx);
    expect(gone.score).toBe(living.score);
  });

  it("leans toward artists from the home country", () => {
    const home = artistFit(artist("Home", { popularity: 0.5, start: 1958, place: "Cardiff, Wales, United Kingdom" }), ctx);
    const away = artistFit(artist("Away", { popularity: 0.5, start: 1958, place: "Tennessee, United States" }), ctx);
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
  it("is sent as a fraction, not rounded to a whole number", () => {
    const { params, warnings } = buildInsightsParams({ type: "urn:entity:artist", filters: { popularityMax: 0.84 } });
    expect(params["filter.popularity.max"]).toBe("0.84");
    expect(warnings).toEqual([]);
  });
});
