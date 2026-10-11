import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { GENERIC_WORLD, SyntheticQloo, worldsOf } from "@/lib/qloo/fixtures";
import { PLAN_MAX_CARDS, PLAN_MIN_CARDS } from "@/lib/session/deck";
import { PRESETS } from "@/lib/session/presets";
import type { Person } from "@/lib/session/types";

const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const qloo = new QlooClient({ mode: "fixture" });
const NOW = new Date("2026-10-11T00:00:00Z");
const engine = new SyntheticQloo();

function person(name: string, birthYear: number, hometown: string, favorites: string[]): Person {
  return { name, birthYear, hometown, favorites: favorites.map((n) => ({ name: n })), language: "en" };
}

async function plan(p: Person) {
  return planSession(p, { env, qloo, now: NOW });
}

/** Authoring worlds of every card in a deck; fails loudly if a card is not from the synthetic catalog. */
function worldsOfDeck(cards: { entityId: string; title: string }[]): string[][] {
  return cards.map((c) => {
    const hints = engine.hintsFor(c.entityId);
    if (!hints) throw new Error(`${c.title} is not in the synthetic catalog`);
    return worldsOf(hints);
  });
}

describe("regional synthetic catalogue", () => {
  it("Rosa, born 1948 in Mexico City, who loved Pedro Infante, gets a Mexican deck seeded by him", async () => {
    const result = await plan(person("Rosa", 1948, "Mexico City", ["Pedro Infante"]));
    expect(result.cards.length).toBeGreaterThanOrEqual(PLAN_MIN_CARDS);
    expect(result.cards.length).toBeLessThanOrEqual(PLAN_MAX_CARDS);
    const seed = result.favorites[0];
    expect(seed?.name).toBe("Pedro Infante");
    expect(seed?.entityId).toMatch(/^ffffffff-/);
    for (const worlds of worldsOfDeck(result.cards)) expect(worlds).toContain("latam");
    const titles = result.cards.map((c) => c.title);
    expect(titles).not.toContain("The Beatles");
    expect(titles).not.toContain("Eiffel Tower");
    expect(titles).not.toContain("Café de Flore");
    expect(titles).toContain("Jorge Negrete");
    for (const card of result.cards) {
      expect(card.signals.seedNames).toContain("Pedro Infante");
      expect(card.why).toContain("Pedro Infante");
      const hints = engine.hintsFor(card.entityId)!;
      if (hints.countries) expect(hints.countries).toContain("MX");
    }
    const byDomain = new Map(result.cards.map((c) => [c.domain, c]));
    expect(engine.hintsFor(byDomain.get("dining")!.entityId)?.localities).toContain("mexico_city");
    expect(engine.hintsFor(byDomain.get("place")!.entityId)?.localities).toContain("mexico_city");
    expect(byDomain.get("film")?.signals.params["filter.release_country"]).toBe("Mexico");
    expect(byDomain.get("tv")?.signals.params["filter.release_country"]).toBe("Mexico");
    const explained = result.cards.filter((c) => (c.signals.explainability?.[seed!.entityId!] ?? 0) > 0);
    expect(explained.length).toBeGreaterThanOrEqual(5);
  });

  it("a town the catalogue does not know, in a country it does, gets the country's music but nobody else's streets", async () => {
    const result = await plan(person("Lupe", 1950, "Puebla, Mexico", ["Pedro Infante"]));
    expect(result.cards.length).toBeGreaterThanOrEqual(PLAN_MIN_CARDS);
    for (const worlds of worldsOfDeck(result.cards)) expect(worlds).toContain("latam");
    const domains = new Set(result.cards.map((c) => c.domain));
    expect(domains.has("dining")).toBe(false);
    expect(domains.has("place")).toBe(false);
    expect(domains.has("music")).toBe(true);
    expect(domains.has("film")).toBe(true);
  });

  it("a favourite alone can place someone: an unknown town plus Pedro Infante still means Mexico", async () => {
    const result = await plan(person("Chuy", 1949, "Smallville", ["Pedro Infante"]));
    for (const worlds of worldsOfDeck(result.cards)) expect(worlds).toContain("latam");
    expect(new Set(result.cards.map((c) => c.domain)).has("place")).toBe(false);
  });

  it.each([
    ["Nena", 1947, "Manila", "Pilita Corrales", "ph"],
    ["Elsie", 1946, "Cebu", "", "ph"],
    ["Doris", 1944, "London", "The Beatles", "uk"],
    ["Jim", 1949, "Liverpool", "The Beatles", "uk"],
    ["Mary", 1950, "Sheffield", "", "uk"],
    ["Asha", 1950, "Mumbai", "Lata Mangeshkar", "in"],
    ["Ravi", 1948, "Delhi", "", "in"],
    ["Sun-hee", 1951, "Seoul", "Lee Mi-ja", "kr"],
    ["Mei", 1949, "Hong Kong", "Teresa Teng", "zh"],
    ["Ling", 1950, "Taipei", "Teresa Teng", "zh"],
    ["Kate", 1955, "Santiago de Cuba", "", "latam"],
    ["Bob", 1946, "Boston", "", "us"],
  ])("%s, born %i in %s (loved %s), gets a deck from the %s world", async (name, birthYear, hometown, favorite, world) => {
    const result = await plan(person(name, birthYear, hometown, favorite ? [favorite] : []));
    expect(result.cards.length).toBeGreaterThanOrEqual(PLAN_MIN_CARDS);
    expect(new Set(result.cards.map((c) => c.domain)).size).toBeGreaterThanOrEqual(3);
    for (const worlds of worldsOfDeck(result.cards)) expect(worlds).toContain(world);
    if (favorite) {
      expect(result.favorites[0]?.entityId).toBeDefined();
      for (const card of result.cards) expect(card.signals.seedNames).toContain(favorite);
    }
  });

  it("the presets still get their own worlds end to end", async () => {
    const michiko = await plan(PRESETS.find((p) => p.id === "michiko")!.person);
    for (const worlds of worldsOfDeck(michiko.cards)) expect(worlds).toContain("jp");
    const frank = await plan(PRESETS.find((p) => p.id === "frank")!.person);
    for (const worlds of worldsOfDeck(frank.cards)) expect(worlds).toContain("us");
  });

  it("a hometown outside every regional world gets international names, never another region's", async () => {
    for (const p of [person("Maria", 1948, "Madrid", ["Julio Iglesias"]), person("Hans", 1948, "Berlin", []), person("Ingrid", 1950, "Stockholm", ["ABBA"])]) {
      const result = await plan(p);
      expect(result.cards.length).toBeGreaterThanOrEqual(PLAN_MIN_CARDS);
      for (const card of result.cards) {
        const hints = engine.hintsFor(card.entityId)!;
        const local = p.hometown === "Madrid" && (hints.localities ?? []).includes("madrid");
        expect(worldsOf(hints).includes(GENERIC_WORLD) || local, `${card.title} for ${p.name}`).toBe(true);
      }
    }
  });
});

describe("hometown resolution", () => {
  it("resolves catalogue cities and their other names", () => {
    for (const [query, key] of [
      ["Mexico City", "mexico_city"],
      ["Ciudad de México", "mexico_city"],
      ["CDMX", "mexico_city"],
      ["Bombay", "mumbai"],
      ["Pusan", "busan"],
      ["Peking", "beijing"],
      ["Maynila", "manila"],
      ["Osaka, Japan", "osaka"],
      ["london", "london"],
    ] as const) {
      const l = engine.resolveLocality(query);
      expect(l?.key, query).toBe(key);
      expect(l?.inferred).toBeUndefined();
    }
  });

  it("infers the country and so the world for towns it does not list", () => {
    for (const [query, code, world] of [
      ["Puebla, Mexico", "MX", "latam"],
      ["Puebla", "MX", "latam"],
      ["Jalisco", "MX", "latam"],
      ["Legazpi", "PH", "ph"],
      ["Sheffield", "GB", "uk"],
      ["Cork", "IE", "uk"],
      ["Pune", "IN", "in"],
      ["Ulsan", "KR", "kr"],
      ["Taichung", "TW", "zh"],
      ["Boston", "US", "us"],
      ["Berlin", "DE", "generic"],
    ] as const) {
      const l = engine.resolveLocality(query);
      expect(l?.inferred, query).toBe(true);
      expect(l?.properties?.geocode?.country_code, query).toBe(code);
      expect(l?.world, query).toBe(world);
    }
  });

  it("does not mistake a town for a catalogue city in another country", () => {
    expect(engine.resolveLocality("Santiago de Cuba")?.properties?.geocode?.country_code).toBe("CU");
    expect(engine.resolveLocality("London, Ontario")?.properties?.geocode?.country_code).toBe("CA");
    expect(engine.resolveLocality("Hyderabad, Pakistan")?.properties?.geocode?.country_code).toBe("PK");
    expect(engine.resolveLocality("Santiago")?.key).toBe("santiago");
    expect(engine.resolveLocality("Santiago de Chile")?.key).toBe("santiago");
  });

  it("commits to a catalogue city only for its own name, never a lookalike town", () => {
    for (const [query, key] of [
      ["Osaka, Japan", "osaka"],
      ["London, England", "london"],
      ["London, UK", "london"],
      ["Chicago, Illinois", "chicago"],
      ["Chicago, Illinois, United States", "chicago"],
      ["Hollywood", "los_angeles"],
    ] as const) {
      const l = engine.resolveLocality(query);
      expect(l?.key, query).toBe(key);
      expect(l?.inferred, query).toBeUndefined();
    }
    for (const [query, code] of [
      ["Atlanta", "US"],
      ["Dallas", "US"],
      ["Orlando", "US"],
      ["Lagos", undefined],
      ["Lagos, Nigeria", undefined],
      ["Casablanca", undefined],
      ["New Orleans, LA", "US"],
      ["Baton Rouge, LA", "US"],
      ["La Jolla", undefined],
      ["La Crosse, Wisconsin", "US"],
      ["Hollywood, Florida", "US"],
      ["Brooklyn Park, Minnesota", "US"],
      ["Rio Grande City", undefined],
      ["Chester", "GB"],
      ["London, Ontario", "CA"],
      ["Santiago de Cuba", "CU"],
      ["L", undefined],
      ["Los", undefined],
      ["San Juan", "PR"],
      ["Puebla, Mexico", "MX"],
      ["Buffalo, New York", "US"],
      ["Albany, New York", "US"],
      ["Las Cruces, New Mexico", "US"],
      ["La Paz, Bolivia", "BO"],
    ] as const) {
      const l = engine.resolveLocality(query);
      expect(l?.inferred, query).toBe(true);
      expect(l?.properties?.geocode?.country_code, query).toBe(code);
    }
  });

  it("offers an inferred locality to the autocomplete, and a plain unknown town to nobody", () => {
    const puebla = engine.search({ query: "Puebla", types: "urn:entity:locality", take: "5" });
    expect(puebla.results[0]?.name).toBe("Puebla");
    expect(puebla.results[0]?.disambiguation).toBe("Puebla, Mexico");
    expect(engine.search({ query: "Smallville", types: "urn:entity:locality", take: "5" }).results).toEqual([]);
    const pedro = engine.search({ query: "Pedro Inf", types: "urn:entity:artist", take: "5" });
    expect(pedro.results[0]?.name).toBe("Pedro Infante");
    expect(engine.search({ query: "鄧麗君", take: "5" }).results[0]?.name).toBe("Teresa Teng");
  });
});

