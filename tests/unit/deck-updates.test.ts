import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { applyPrompts, applyReplacements } from "@/lib/session/deck-updates";
import { cleanNarration, withCleanNarration } from "@/lib/session/narration";
import { planningProgress } from "@/lib/session/planning-progress";
import { PRESETS } from "@/lib/session/presets";
import type { Card, TraceEvent } from "@/lib/session/types";

const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const qloo = new QlooClient({ mode: "fixture" });
const NOW = new Date("2026-10-11T00:00:00Z");
const frank = PRESETS.find((p) => p.id === "frank")!.person;

async function deck(): Promise<Card[]> {
  return (await planSession(frank, { env, qloo, now: NOW })).cards;
}

function replacement(card: Card, n: number): Card {
  return { ...card, id: `new_${n}`, entityId: `new-entity-${n}`, title: `New ${n}`, addedBy: "adapt", replacedEntityId: card.entityId };
}

describe("a re-tune landing on a deck in use", () => {
  it("never swaps the card the deck moved on to, or any before it", async () => {
    const cards = await deck();
    const tapped = cards.map((c, i) => (i === 0 ? { ...c, reaction: "lit_up" as const } : c));
    const replacements = [replacement(cards[1]!, 1), replacement(cards[2]!, 2), replacement(cards[4]!, 4)];
    const { cards: next, applied } = applyReplacements(tapped, replacements, 1);
    expect(next[1]).toBe(tapped[1]);
    expect(next[2]?.title).toBe("New 2");
    expect(next[4]?.title).toBe("New 4");
    expect(applied.map((c) => c.title)).toEqual(["New 2", "New 4"]);
  });

  it("protects wherever the caregiver has got to, and cards with a reaction", async () => {
    const cards = (await deck()).map((c, i) => (i === 3 ? { ...c, reaction: "not_this" as const } : c));
    const { cards: next, applied } = applyReplacements(cards, [replacement(cards[3]!, 3), replacement(cards[5]!, 5), replacement(cards[6]!, 6)], 5);
    expect(next.slice(0, 6)).toEqual(cards.slice(0, 6));
    expect(applied.map((c) => c.title)).toEqual(["New 6"]);
  });

  it("never brings in a card the deck already holds, or two for one slot", async () => {
    const cards = await deck();
    const dup = { ...replacement(cards[4]!, 4), entityId: cards[7]!.entityId };
    const twice = [replacement(cards[5]!, 5), { ...replacement(cards[5]!, 55), entityId: "other" }];
    const { cards: next, applied } = applyReplacements(cards, [dup, ...twice], 1);
    expect(next[4]).toBe(cards[4]);
    expect(next[5]?.title).toBe("New 5");
    expect(applied).toHaveLength(1);
    expect(new Set(next.map((c) => c.entityId)).size).toBe(next.length);
  });
});

describe("the model's prompts landing on a deck in use", () => {
  it("replace the templates on the current card and those ahead, not on cards passed or reacted to", async () => {
    const cards = (await deck()).map((c, i) => (i === 4 ? { ...c, reaction: "lit_up" as const } : c));
    const prompts = cards.map((c, i) => ({ cardId: c.id, prompt: `Model prompt ${i}` }));
    const next = applyPrompts(cards, prompts, 2);
    expect(next.slice(0, 2)).toEqual(cards.slice(0, 2));
    expect(next[2]).toMatchObject({ prompt: "Model prompt 2", promptSource: "llm" });
    expect(next[4]).toBe(cards[4]);
    expect(next[5]).toMatchObject({ prompt: "Model prompt 5", promptSource: "llm" });
  });

  it("leave cards they do not name alone", async () => {
    const cards = await deck();
    expect(applyPrompts(cards, [{ cardId: "nope", prompt: "x" }], 0)).toEqual(cards);
  });
});

describe("narration fit to show", () => {
  const dsml = '<｜DSML｜invoke name="plan_session"><｜DSML｜parameter name="cards" string="false">[{"entity_id": "368435B1-1C2B-4A2E-9F3E-0123456789AB"';

  it("keeps a plain sentence and drops markup, JSON, ids and runaway text", () => {
    expect(cleanNarration("  Asking Qloo for films from 1960 to 1975. ")).toBe("Asking Qloo for films from 1960 to 1975.");
    expect(cleanNarration(dsml)).toBeUndefined();
    expect(cleanNarration('{"cards": []}')).toBeUndefined();
    expect(cleanNarration("Picking 368435b1-1c2b-4a2e-9f3e-0123456789ab next.")).toBeUndefined();
    expect(cleanNarration("Using urn:entity:artist")).toBeUndefined();
    expect(cleanNarration("<tool_call>plan</tool_call>")).toBeUndefined();
    expect(cleanNarration("word ".repeat(80))).toBeUndefined();
    expect(cleanNarration("")).toBeUndefined();
    expect(cleanNarration(undefined)).toBeUndefined();
  });

  it("is what the planning screen shows: an unfit line never replaces the last good one", () => {
    const events: TraceEvent[] = [
      { id: "1", at: 1, phase: "plan", kind: "narration", summary: "Asking Qloo for the music of Osaka." },
      { id: "2", at: 2, phase: "plan", kind: "narration", summary: dsml },
    ];
    expect(planningProgress(events).narration).toBe("Asking Qloo for the music of Osaka.");
    expect(withCleanNarration(events).map((e) => e.id)).toEqual(["1"]);
  });
});
