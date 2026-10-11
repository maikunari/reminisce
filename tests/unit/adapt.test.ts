import { describe, expect, it } from "vitest";

import { adaptSession, planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";

const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const qloo = new QlooClient({ mode: "fixture" });
const NOW = new Date("2026-10-11T00:00:00Z");
const frank = PRESETS.find((p) => p.id === "frank")!.person;

async function planned() {
  const plan = await planSession(frank, { env, qloo, now: NOW });
  return { plan, person: { ...frank, favorites: plan.favorites } };
}

describe("adaptSession", () => {
  it("re-queries Qloo with the liked entity as an added signal and replaces only upcoming cards", async () => {
    const { plan, person } = await planned();
    const liked = plan.cards[0]!;
    const result = await adaptSession({ person, cards: plan.cards, feedback: { cardId: liked.id, reaction: "lit_up" }, currentIndex: 0 }, { env, qloo, now: NOW });
    expect(result.replacements.length).toBeGreaterThanOrEqual(1);
    expect(result.replacements.length).toBeLessThanOrEqual(3);
    const existing = new Set(plan.cards.map((c) => c.entityId));
    for (const r of result.replacements) {
      expect(r.addedBy).toBe("adapt");
      expect(existing.has(r.entityId)).toBe(false);
      const replaced = plan.cards.findIndex((c) => c.entityId === r.replacedEntityId);
      expect(replaced).toBeGreaterThan(0);
      expect(plan.cards[replaced]?.reaction).toBeUndefined();
      expect(r.signals.params["signal.interests.entities"]).toContain(liked.entityId);
      expect(r.signals.params["filter.exclude.entities"]).toContain(liked.entityId);
    }
    const domains = new Set(result.replacements.map((r) => r.domain));
    expect(domains.has(liked.domain)).toBe(true);
    expect(domains.size).toBeGreaterThanOrEqual(2);
    expect(result.trace.every((e) => e.phase === "adapt")).toBe(true);
    expect(result.trace.filter((e) => e.qloo?.path === "/v2/insights").length).toBeGreaterThanOrEqual(2);
  });

  it("steers away from a card that did not land", async () => {
    const { plan, person } = await planned();
    const disliked = plan.cards[1]!;
    const result = await adaptSession({ person, cards: plan.cards, feedback: { cardId: disliked.id, reaction: "not_this" }, currentIndex: 1 }, { env, qloo, now: NOW });
    expect(result.replacements.length).toBeGreaterThanOrEqual(1);
    for (const r of result.replacements) {
      expect(r.domain).not.toBe(disliked.domain);
      expect(r.signals.params["filter.exclude.entities"]).toContain(disliked.entityId);
      const replaced = plan.cards.find((c) => c.entityId === r.replacedEntityId);
      expect(replaced?.domain).toBe(disliked.domain);
    }
  });

  it("does nothing when there is nothing upcoming", async () => {
    const { plan, person } = await planned();
    const last = plan.cards[plan.cards.length - 1]!;
    const result = await adaptSession({ person, cards: plan.cards, feedback: { cardId: last.id, reaction: "lit_up" }, currentIndex: plan.cards.length - 1 }, { env, qloo, now: NOW });
    expect(result.replacements).toEqual([]);
    expect(result.trace.some((e) => /No upcoming cards/.test(e.summary))).toBe(true);
  });

  it("keeps at least three domains in the deck after replacements", async () => {
    const { plan, person } = await planned();
    let cards = plan.cards;
    for (let i = 0; i < 3; i++) {
      const target = cards[i]!;
      const result = await adaptSession({ person, cards, feedback: { cardId: target.id, reaction: "lit_up" }, currentIndex: i }, { env, qloo, now: NOW });
      const byReplaced = new Map(result.replacements.map((r) => [r.replacedEntityId, r]));
      cards = cards.map((c, idx) => (idx === i ? { ...c, reaction: "lit_up" as const } : (byReplaced.get(c.entityId) ?? c)));
      expect(new Set(cards.map((c) => c.entityId)).size).toBe(cards.length);
    }
    expect(new Set(cards.map((c) => c.domain)).size).toBeGreaterThanOrEqual(3);
  });
});
