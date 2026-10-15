import { describe, expect, it } from "vitest";

import { OVERVIEW_MIN_CARDS, canDrop, dropCard, groupByDomain, restoreCard, shuffleCards } from "@/lib/session/overview";
import type { Card, Domain } from "@/lib/session/types";

function card(n: number, domain: Domain): Card {
  return { id: `c${n}`, entityId: `e${n}`, domain, title: `Card ${n}` } as Card;
}

const deck = [card(1, "music"), card(2, "film"), card(3, "music"), card(4, "dining"), card(5, "place"), card(6, "film")];

describe("the session overview lineup", () => {
  it("groups cards by kind in the usual order and keeps each card's place in the session", () => {
    const groups = groupByDomain(deck);
    expect(groups.map((g) => g.domain)).toEqual(["music", "film", "dining", "place"]);
    expect(groups[0]!.entries.map((e) => e.position)).toEqual([1, 3]);
    expect(groups[1]!.entries.map((e) => e.card.id)).toEqual(["c2", "c6"]);
    expect(groupByDomain([])).toEqual([]);
  });

  it("drops one card, and puts it back where it was", () => {
    const fewer = dropCard(deck, "c3");
    expect(fewer.map((c) => c.id)).toEqual(["c1", "c2", "c4", "c5", "c6"]);
    expect(restoreCard(fewer, deck[2]!, 2).map((c) => c.id)).toEqual(deck.map((c) => c.id));
    expect(restoreCard(deck, deck[2]!, 2)).toBe(deck);
    expect(restoreCard(fewer, deck[2]!, 99).at(-1)!.id).toBe("c3");
  });

  it("never drops below the minimum or an unknown card", () => {
    const small = deck.slice(0, OVERVIEW_MIN_CARDS);
    expect(canDrop(small)).toBe(false);
    expect(dropCard(small, "c1")).toBe(small);
    expect(dropCard(deck, "nope")).toBe(deck);
  });

  it("reorders the same cards, never leaving the order unchanged, without touching the input", () => {
    const before = deck.map((c) => c.id);
    for (const random of [() => 0, () => 0.999, () => 0.5, Math.random]) {
      const next = shuffleCards(deck, random);
      expect(next.map((c) => c.id).sort()).toEqual([...before].sort());
      expect(next.map((c) => c.id)).not.toEqual(before);
    }
    expect(deck.map((c) => c.id)).toEqual(before);
    expect(shuffleCards([deck[0]!])).toEqual([deck[0]]);
  });
});
