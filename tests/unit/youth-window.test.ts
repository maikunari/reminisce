import { describe, expect, it } from "vitest";

import { ageBucketFor, computeYouthWindow, describeDecade } from "@/lib/session/youth-window";

const NOW = new Date("2026-10-11T00:00:00Z");

describe("computeYouthWindow", () => {
  it("maps a birth year to the years they were 15 to 30", () => {
    expect(computeYouthWindow(1950, NOW)).toEqual({ start: 1965, end: 1980, ageFrom: 15, ageTo: 30 });
    expect(computeYouthWindow(1945, NOW)).toEqual({ start: 1960, end: 1975, ageFrom: 15, ageTo: 30 });
  });
  it("never runs past the current year", () => {
    expect(computeYouthWindow(2000, NOW)).toEqual({ start: 2015, end: 2026, ageFrom: 15, ageTo: 30 });
    expect(computeYouthWindow(2008, NOW).end).toBe(2026);
    expect(computeYouthWindow(2008, NOW).start).toBe(2023);
  });
  it("rejects non-integers", () => {
    expect(() => computeYouthWindow(1950.5, NOW)).toThrow(RangeError);
  });
});

describe("ageBucketFor", () => {
  it("uses the documented signal.demographics.age buckets", () => {
    expect(ageBucketFor(1950, NOW)).toBe("55_and_older");
    expect(ageBucketFor(1971, NOW)).toBe("55_and_older");
    expect(ageBucketFor(1972, NOW)).toBe("45_to_54");
    expect(ageBucketFor(1985, NOW)).toBe("35_to_44");
    expect(ageBucketFor(1994, NOW)).toBe("30_to_34");
    expect(ageBucketFor(1998, NOW)).toBe("25_to_29");
    expect(ageBucketFor(2005, NOW)).toBe("24_and_younger");
  });
});

describe("describeDecade", () => {
  it("formats decades", () => {
    expect(describeDecade(1967)).toBe("1960s");
    expect(describeDecade(1970)).toBe("1970s");
  });
});
