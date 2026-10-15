import { describe, expect, it } from "vitest";

import { LLM_MAX_STEPS, planSession } from "@/lib/agent";
import { LLM_MAX_TOKENS } from "@/lib/agent/policies/llm";
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
      expect(card.signals.params["signal.demographics.age"]).toBe("55_and_older");
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

describe("planSession (LLM policy, fixture Qloo)", () => {
  const llmEnv = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "live", LLM_API_KEY: "test-key" });

  function toolCall(name: string, args: unknown) {
    return { id: `call_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
  }

  it("validates the domain mix on the committed cards, not on cards beyond the cap", async () => {
    let turn = 0;
    const requests: { max_tokens?: number; messages: { role: string; content: string | null }[] }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { max_tokens?: number; messages: { role: string; content: string | null }[] };
      requests.push(body);
      const tools = body.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content ?? "{}") as Record<string, unknown>);
      const ids = (i: number) => ((tools[i]?.entities ?? []) as { entity_id: string }[]).map((e) => e.entity_id);
      let calls;
      turn += 1;
      if (turn === 1) {
        calls = [
          toolCall("qloo_insights", { filter_type: "urn:entity:artist", signal_location_query: "Chicago", take: 6 }),
          toolCall("qloo_insights", { filter_type: "urn:entity:movie", signal_location_query: "Chicago", release_year_min: 1960, release_year_max: 1975, take: 6 }),
          toolCall("qloo_insights", { filter_type: "urn:entity:destination", signal_location_query: "Chicago", take: 4 }),
        ];
      } else {
        const music = ids(0).map((id) => ({ entity_id: id, domain: "music", prompt: "Tell me about this song." }));
        const film = ids(1).map((id) => ({ entity_id: id, domain: "film", prompt: "Tell me about this film." }));
        const trips = ids(2).map((id) => ({ entity_id: id, domain: "destination", prompt: "Tell me about this trip." }));
        const cards =
          turn === 2
            ? [...music.slice(0, 5), ...film.slice(0, 5), ...trips.slice(0, 2)]
            : [...music.slice(0, 4), ...film.slice(0, 3), ...trips.slice(0, 2)];
        calls = [toolCall("plan_session", { cards })];
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await planSession(frank, { env: llmEnv, qloo, now: NOW, fetchImpl });

    expect(result.planner).toBe("llm");
    expect(turn).toBe(3);
    const rejected = result.trace.find((e) => e.tool === "plan_session" && e.kind === "error");
    expect(rejected?.summary).toMatch(/at least 3 domains in the first 10 cards, got 2/);
    expect(result.cards).toHaveLength(9);
    expect(new Set(result.cards.map((c) => c.domain)).size).toBe(3);
    expect(result.cards.every((c) => c.promptSource === "llm")).toBe(true);
    expect(result.trace.filter((e) => e.kind === "tool_call").every((e) => e.policy === "llm")).toBe(true);
    // Spend caps: a bounded completion, and a prompt that asks for the Qloo calls in one turn.
    expect(requests.every((r) => r.max_tokens === LLM_MAX_TOKENS)).toBe(true);
    expect(requests[0]?.messages[0]?.content).toMatch(/parallel tool calls in one turn/);
  });

  it("hands over to the deterministic planner once the model has used its step cap", async () => {
    let completions = 0;
    const fetchImpl = (async () => {
      completions += 1;
      const calls = [toolCall("qloo_search_tags", { query: "restaurant", parent_type: "urn:entity:place" })];
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await planSession(frank, { env: llmEnv, qloo, now: NOW, fetchImpl });
    expect(completions).toBe(LLM_MAX_STEPS.plan);
    expect(result.planner).toBe("deterministic");
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(result.trace.some((e) => e.kind === "note" && /stopped after 12 steps/.test(e.summary))).toBe(true);
  });

  it("labels the scripted fallback's steps and template prompts", async () => {
    const result = await plan(frank);
    expect(result.cards.every((c) => c.promptSource === "template")).toBe(true);
    expect(result.trace.filter((e) => e.kind === "tool_call").every((e) => e.policy === "scripted")).toBe(true);
  });
});
