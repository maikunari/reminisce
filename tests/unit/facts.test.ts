/**
 * The facts a card states must be true: no prompt claims a decade for an
 * artist, films and shows come from the person's country, and a place that may
 * be newer than their youth is never said to have been there back then.
 */
import { describe, expect, it } from "vitest";

import { adaptSession, planSession } from "@/lib/agent";
import { offlinePrompt } from "@/lib/agent/prompts";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";
import type { Language, Person } from "@/lib/session/types";

import { liveQlooFake } from "./helpers/live-qloo";

const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const qloo = new QlooClient({ mode: "fixture" });
const NOW = new Date("2026-10-11T00:00:00Z");
const michiko = PRESETS.find((p) => p.id === "michiko")!.person;
const ruth: Person = { name: "Ruth", birthYear: 1938, hometown: "Boston", favorites: [{ name: "Patti Page" }], language: "en", pronoun: "she" };
const ids = Array.from({ length: 40 }, (_, i) => `ffffffff-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("music prompts", () => {
  it("never claim a decade, in any language, whatever year Qloo gives the artist", () => {
    for (const entityId of ids) {
      for (const language of ["en", "es", "ja"] as Language[]) {
        const prompt = offlinePrompt({ domain: "music", language, title: "Bette Midler", entityId, person: { ...ruth, language } });
        expect(prompt).not.toMatch(/19\d\d|\d0s|everywhere|por todas partes|どこでも流れ/);
        expect(prompt).not.toContain("{");
      }
    }
  });

  it("keep three questions per language to pick from", () => {
    for (const language of ["en", "es", "ja"] as Language[]) {
      const seen = new Set(ids.map((entityId) => offlinePrompt({ domain: "music", language, title: "Patti Page", entityId, person: { ...ruth, language } })));
      expect(seen.size).toBe(3);
    }
  });
});

describe("places that may be newer than the person's youth", () => {
  it("are asked about through the hometown, in every language", () => {
    for (const language of ["en", "es", "ja"] as Language[]) {
      const seen = new Set<string>();
      for (const entityId of ids) {
        const prompt = offlinePrompt({ domain: "place", language, title: "Cloud Gate", entityId, person: { ...ruth, hometown: "Chicago", language } });
        seen.add(prompt);
        expect(prompt).toContain("Chicago");
        expect(prompt).not.toMatch(/What was it like when you were young|Was the weather good|¿Cómo era cuando usted era joven\?|若い頃はどんな場所でしたか/);
      }
      expect(seen.size).toBe(3);
    }
  });

  it("restaurants are never said to have served the person back then", () => {
    for (const language of ["en", "es", "ja"] as Language[]) {
      for (const entityId of ids) {
        const prompt = offlinePrompt({ domain: "dining", language, title: "Park Side Grille", entityId, person: { ...ruth, language } });
        expect(prompt).not.toMatch(/Something from Park Side Grille|Algo de Park Side Grille/);
      }
    }
  });
});

describe("the home country's films and shows", () => {
  it("stay the rule when a re-tune asks Qloo for more films", async () => {
    const plan = await planSession(michiko, { env, qloo, now: NOW });
    const person = { ...michiko, favorites: plan.favorites };
    const index = plan.cards.findIndex((c) => c.domain === "film");
    expect(index).toBeGreaterThanOrEqual(0);
    const result = await adaptSession({ person, cards: plan.cards, feedback: { cardId: plan.cards[index]!.id, reaction: "lit_up" }, currentIndex: index }, { env, qloo, now: NOW });
    const films = result.replacements.filter((c) => c.domain === "film");
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) expect(film.signals.params["filter.release_country"]).toBe("Japan");
    const filmCalls = result.trace.filter((e) => e.qloo?.params["filter.type"] === "urn:entity:movie");
    for (const e of filmCalls) expect(e.qloo!.params["filter.release_country"]).toBe("Japan");
  });

  it("are not swapped for foreign ones when the home country has a few", async () => {
    const fake = liveQlooFake();
    const homeFilm = { entity_id: "dddddddd-1111-4000-8000-000000000001", name: "Osaka Story", properties: { release_year: 1970, release_country: ["Japan"] }, query: { affinity: 0.9 } };
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:movie") {
        const country = url.searchParams.get("filter.release_country");
        const entities = country === "Japan" ? [homeFilm] : [{ ...homeFilm, entity_id: "dddddddd-1111-4000-8000-000000000002", name: "Star Battles", properties: { release_year: 1977, release_country: ["United States"] } }];
        return new Response(JSON.stringify({ success: true, results: { entities } }), { status: 200 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const live = new QlooClient({ mode: "live", apiKey: "test", fetchImpl });
    const osaka: Person = { name: "Michiko", birthYear: 1950, hometown: "Osaka", favorites: [{ name: "Hibari Misora" }], language: "ja", pronoun: "she" };
    const result = await planSession(osaka, { env: readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" }), qloo: live, now: NOW });
    expect(result.cards.some((c) => c.title === "Star Battles")).toBe(false);
    expect(result.cards.find((c) => c.domain === "film")?.title).toBe("Osaka Story");
  });

  it("never include another country's television, even when the home country has none", async () => {
    const fake = liveQlooFake();
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:tv_show") {
        const entities = url.searchParams.get("filter.release_country")
          ? []
          : [{ entity_id: "cccccccc-1111-4000-8000-000000000001", name: "Science Hour", properties: { release_year: 1974, release_country: ["United States"] }, query: { affinity: 0.9 } }];
        return new Response(JSON.stringify({ success: true, results: { entities } }), { status: 200 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const live = new QlooClient({ mode: "live", apiKey: "test", fetchImpl });
    const osaka: Person = { name: "Michiko", birthYear: 1950, hometown: "Osaka", favorites: [{ name: "Hibari Misora" }], language: "ja", pronoun: "she" };
    const result = await planSession(osaka, { env: readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" }), qloo: live, now: NOW });
    expect(result.cards.some((c) => c.domain === "tv")).toBe(false);
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
  });

  it("count a show as home television only when the home country made it", async () => {
    const fake = liveQlooFake();
    const show = (id: string, name: string, countries: string[]) => ({ entity_id: id, name, properties: { release_year: 1974, release_country: countries }, query: { affinity: 0.9 } });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:tv_show") {
        const entities = [show("cccccccc-2222-4000-8000-000000000001", "Science Hour", ["United States", "Japan"]), show("cccccccc-2222-4000-8000-000000000002", "Osaka Family", ["Japan"])];
        return new Response(JSON.stringify({ success: true, results: { entities } }), { status: 200 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const live = new QlooClient({ mode: "live", apiKey: "test", fetchImpl });
    const osaka: Person = { name: "Michiko", birthYear: 1950, hometown: "Osaka", favorites: [{ name: "Hibari Misora" }], language: "ja", pronoun: "she" };
    const result = await planSession(osaka, { env: readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" }), qloo: live, now: NOW });
    expect(result.cards.filter((c) => c.domain === "tv").map((c) => c.title)).toEqual(["Osaka Family"]);
  });
});

