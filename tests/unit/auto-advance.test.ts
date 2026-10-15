import { describe, expect, it } from "vitest";

import { AUTO_ADVANCE_DELAY_MS, AUTO_ADVANCE_DELAY_REDUCED_MS, autoAdvanceDelay, nextCardIndex } from "@/lib/session/auto-advance";

describe("auto-advance after a reaction", () => {
  it("moves to the next card that has no reaction yet", () => {
    const cards = [{ reaction: "lit_up" }, {}, {}, {}];
    expect(nextCardIndex(cards, 0)).toBe(1);
    expect(nextCardIndex([{ reaction: "lit_up" }, { reaction: "not_this" }, {}], 0)).toBe(2);
  });

  it("skips cards already reacted to, going forward only", () => {
    const cards = [{}, { reaction: "lit_up" }, { reaction: "not_this" }, { reaction: "lit_up" }];
    expect(nextCardIndex(cards, 1)).toBeNull();
    expect(nextCardIndex(cards, 3)).toBeNull();
  });

  it("stops at the end so the keepsake can take over", () => {
    expect(nextCardIndex([{ reaction: "lit_up" }], 0)).toBeNull();
    expect(nextCardIndex([], 0)).toBeNull();
  });

  it("pauses only for a beat to see the tap land, shorter when motion is reduced", () => {
    expect(autoAdvanceDelay(false)).toBe(AUTO_ADVANCE_DELAY_MS);
    expect(autoAdvanceDelay(true)).toBe(AUTO_ADVANCE_DELAY_REDUCED_MS);
    expect(AUTO_ADVANCE_DELAY_REDUCED_MS).toBeLessThanOrEqual(AUTO_ADVANCE_DELAY_MS);
    expect(AUTO_ADVANCE_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(AUTO_ADVANCE_DELAY_MS).toBeLessThanOrEqual(1000);
  });
});
