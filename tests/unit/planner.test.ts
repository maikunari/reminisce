import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";
import { DOMAIN_INFO, type Person } from "@/lib/session/types";

const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const qloo = new QlooClient({ mode: "fixture" });
const NOW = new Date("2026-10-11T00:00:00Z");
const michiko = PRESETS.find((p) => p.id === "michiko")!.person;
const frank = PRESETS.find((p) => p.id === "frank")!.person;

async function plan(person: Person) {
  return planSession(person, { env, qloo, now: NOW });
}

describe("planSession (deterministic planner, fixture Qloo)", () => {
  it("builds 8 to 10 cards across at least 3 domains with no duplicates", async () => {
    for (const person of [michiko, frank]) {
      const result = await plan(person);
      expect(result.planner).toBe("deterministic");
      expect(result.qlooMode).toBe("fixture");
      expect(result.cards.length).toBeGreaterThanOrEqual(8);
      expect(result.cards.length).toBeLessThanOrEqual(10);
      expect(new Set(result.cards.map((c) => c.domain)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(result.cards.map((c) => c.entityId)).size).toBe(result.cards.length);
      for (const card of result.cards) {
        expect(card.title.length).toBeGreaterThan(0);
        expect(card.prompt.length).toBeGreaterThan(10);
        // A readable fragment: "artists close to Hibari Misora, tuned to Osaka, for people 55 and older".
        expect(card.why).toMatch(/^(artists|films|shows|places to eat|places|destinations)\b/);
        expect(card.why).not.toMatch(/\b[0-9a-f]{8}\b/);
        expect(card.why).not.toMatch(/urn:|^Qloo|, \(|, close to/);
        expect(card.signals.params["filter.type"]).toBe(DOMAIN_INFO[card.domain].qlooType);
        expect(card.signals.affinity).not.toBeNull();
      }
    }
  });

  it("resolves favorites to Qloo ids and uses them as signal.interests.entities", async () => {
    const result = await plan(michiko);
    const seed = result.favorites[0];
    expect(seed?.entityId).toBeDefined();
    const music = result.cards.filter((c) => c.domain === "music");
    expect(music.length).toBeGreaterThan(0);
    for (const card of music) {
      expect(card.signals.params["signal.interests.entities"]).toContain(seed!.entityId);
      expect(card.signals.params["signal.location.query"]).toBe("Osaka");
      // The age bucket is left out of a seeded artist call: it would pull in what every 55 and older likes.
      expect(card.signals.params["signal.demographics.age"]).toBeUndefined();
      expect(card.signals.seedNames).toEqual(["Hibari Misora"]);
      expect(card.signals.explainability?.[seed!.entityId!]).toBeGreaterThan(0);
    }
  });

  it("computes the youth window and applies it to films", async () => {
    const result = await plan(michiko);
    expect(result.youthWindow).toEqual({ start: 1965, end: 1980, ageFrom: 15, ageTo: 30 });
    expect(result.ageBucket).toBe("55_and_older");
    const films = result.cards.filter((c) => c.domain === "film");
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) {
      expect(film.year).toBeGreaterThanOrEqual(1965);
      expect(film.year).toBeLessThanOrEqual(1980);
      expect(film.signals.yearRange).toEqual([1965, 1980]);
      expect(film.signals.params["filter.release_country"]).toBe("Japan");
    }
  });

  it("filters dining and places to the hometown", async () => {
    const result = await plan(frank);
    const local = result.cards.filter((c) => c.domain === "dining" || c.domain === "place");
    expect(local.length).toBeGreaterThanOrEqual(2);
    for (const card of local) expect(card.signals.params["filter.location.query"]).toBe("Chicago");
    const dining = result.cards.find((c) => c.domain === "dining");
    expect(dining?.signals.params["filter.tags"]).toContain("restaurant");
  });

  it("produces clearly different sessions for the two presets", async () => {
    const [a, b] = await Promise.all([plan(michiko), plan(frank)]);
    const aIds = new Set(a.cards.map((c) => c.entityId));
    expect(b.cards.some((c) => aIds.has(c.entityId))).toBe(false);
    expect(a.cards.map((c) => c.title)).not.toEqual(b.cards.map((c) => c.title));
  });

  it("is deterministic and records every Qloo call in the trace", async () => {
    const [a, b] = await Promise.all([plan(frank), plan(frank)]);
    expect(a.cards.map((c) => c.entityId)).toEqual(b.cards.map((c) => c.entityId));
    const qlooCalls = a.trace.filter((e) => e.qloo);
    expect(qlooCalls.length).toBeGreaterThanOrEqual(8);
    expect(qlooCalls.map((e) => e.qloo!.path)).toEqual(expect.arrayContaining(["/search", "/v2/insights"]));
    expect(a.trace.some((e) => e.tool === "plan_session" && e.kind === "tool_result")).toBe(true);
    expect(a.trace.every((e) => e.phase === "plan")).toBe(true);
  });

  it("keeps raw URNs and parameter names out of the trace summaries", async () => {
    const result = await plan(michiko);
    for (const e of result.trace) {
      expect(e.summary).not.toMatch(/urn:|filter\.[a-z]|signal\.[a-z]|_and_older|_to_\d/);
    }
  });

  it("still plans when a favorite cannot be resolved and writes prompts in the chosen language", async () => {
    const result = await plan({ name: "Maria", birthYear: 1948, hometown: "Madrid", favorites: [{ name: "Julio Iglesias" }, { name: "Nobody Known" }], language: "es" });
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(result.favorites.find((f) => f.name === "Nobody Known")?.entityId).toBeUndefined();
    expect(result.cards.every((c) => /[¿?]/.test(c.prompt))).toBe(true);
    expect(result.trace.some((e) => e.kind === "narration" && /no entity for "Nobody Known"/.test(e.summary))).toBe(true);
  });
});

describe("planSession (labels)", () => {
  it("labels the scripted steps and template prompts", async () => {
    const result = await plan(frank);
    expect(result.cards.every((c) => c.promptSource === "template")).toBe(true);
    expect(result.trace.filter((e) => e.kind === "tool_call").every((e) => e.policy === "scripted")).toBe(true);
  });
});
