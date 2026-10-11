import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PLAN_MAX_CARDS, PLAN_MIN_CARDS } from "@/lib/agent/tools";
import { PLAN_MAX_CARDS as MAX, PLAN_MIN_CARDS as MIN, deckSizeLabel, numberWord } from "@/lib/session/deck";

describe("deck size", () => {
  it("is one number for the planner and the copy", () => {
    expect(PLAN_MIN_CARDS).toBe(MIN);
    expect(PLAN_MAX_CARDS).toBe(MAX);
    expect(MIN).toBeLessThan(MAX);
  });

  it("spells the range for people", () => {
    expect(deckSizeLabel()).toBe(`${numberWord(MIN)} to ${numberWord(MAX)}`);
    expect(deckSizeLabel("en")).toBe("eight to ten");
    expect(deckSizeLabel("es")).toBe("ocho a diez");
    expect(deckSizeLabel("ja")).toBe("8〜10");
    expect(numberWord(13)).toBe("13");
  });

  it("is what the home page prints, not a hard-coded number", () => {
    const page = readFileSync(new URL("../../src/app/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("deckSizeLabel()");
    expect(page).not.toMatch(/deck of (nine|eight|ten|\d+) cards/);
  });
});
