import { describe, expect, it } from "vitest";

import { MAX_CALLS_PER_PERSON, checkPlan, type SmokeSpec } from "../../scripts/smoke-checks";
import type { QlooEntity } from "@/lib/qloo/types";
import type { Card, Domain, Person, PlanResult, TraceEvent } from "@/lib/session/types";

const person: Person = { name: "Dad", birthYear: 1940, hometown: "London", favorites: [{ name: "Lonnie Donegan" }], language: "en" };
const spec: SmokeSpec = { person, homeCountry: "United Kingdom", era: { country: "United Kingdom", before: 1965 } };

function card(id: string, domain: Domain, extra: Partial<Card> = {}): Card {
  return { id, entityId: id, domain, title: id, tags: [], why: "", prompt: "", promptSource: "template", addedBy: "plan", signals: {} as Card["signals"], ...extra };
}

function entity(id: string, properties: QlooEntity["properties"]): QlooEntity {
  return { name: id, entity_id: id, type: "urn:entity", subtype: "x", properties };
}

function qlooEvent(source: "live" | "recorded" = "live"): TraceEvent {
  return { id: "e", at: 0, phase: "plan", kind: "tool_result", summary: "", qloo: { path: "/v2/insights", params: {}, source, status: 200, durationMs: 1, resultCount: 1, warnings: [] } };
}

function plan(cards: Card[], trace: TraceEvent[] = [qlooEvent()]): PlanResult {
  return { cards, trace, qlooMode: "live" } as PlanResult;
}

const good = [card("fury", "music", { startYear: 1958 }), card("help", "film"), card("panorama", "tv")];
const goodEntities = new Map([
  ["fury", entity("fury", { place_of_birth: "Liverpool, England, United Kingdom" })],
  ["help", entity("help", { release_country: ["United Kingdom", "United States"] })],
]);

describe("smoke checks", () => {
  it("passes a deck with a pre-1965 UK act and a UK film", () => {
    const report = checkPlan(spec, plan(good), goodEntities);
    expect(report.failures).toEqual([]);
    expect(report.liveCalls).toBe(1);
    expect(report.lines).toHaveLength(3);
  });

  it("fails a deck with no music card", () => {
    const report = checkPlan({ ...spec, era: undefined }, plan(good.filter((c) => c.domain !== "music")), goodEntities);
    expect(report.failures).toContain("no music card");
  });

  it("fails when the only films are from elsewhere (the widened Star Wars deck)", () => {
    const entities = new Map(goodEntities).set("help", entity("help", { release_country: ["United States"] }));
    const report = checkPlan(spec, plan(good), entities);
    expect(report.failures.join("\n")).toContain("no United Kingdom film");
  });

  it("fails when no music card is a UK act from before 1965", () => {
    const modern = [card("fury", "music", { startYear: 1985 }), card("help", "film")];
    expect(checkPlan(spec, plan(modern), goodEntities).failures.join("\n")).toContain("no United Kingdom act that started before 1965");
    const foreign = new Map(goodEntities).set("fury", entity("fury", { place_of_birth: "Chicago, Illinois, United States" }));
    expect(checkPlan(spec, plan(good), foreign).failures.join("\n")).toContain("no United Kingdom act that started before 1965");
  });

  it("fails on an error event, on answers that were not live, and on a runaway call count", () => {
    const failed: TraceEvent = { id: "x", at: 0, phase: "plan", kind: "error", summary: "qloo_insights failed: boom" };
    expect(checkPlan(spec, plan(good, [qlooEvent(), failed]), goodEntities).failures).toContain("error event: qloo_insights failed: boom");
    expect(checkPlan(spec, plan(good, [qlooEvent("recorded")]), goodEntities).failures.join("\n")).toContain("not the live API");
    const many = Array.from({ length: MAX_CALLS_PER_PERSON + 1 }, () => qlooEvent());
    expect(checkPlan(spec, plan(good, many), goodEntities).failures.join("\n")).toContain("live Qloo calls");
  });
});
