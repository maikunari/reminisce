/**
 * Regression for Mike's 2026-10-17 test: his dad loves Lonnie Donegan (British
 * skiffle, 1950s) and was offered Dolly Parton, Tom Jones and the Beatles. A
 * seeded artist call must stay with the seed: skiffle and late-1950s UK acts
 * first, the famous names of a whole generation not in their place.
 */
import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";
import type { Card, Person } from "@/lib/session/types";

import { seededQlooFake, type SeededQlooOptions } from "./helpers/seeded-qloo";

const NOW = new Date("2026-10-17T00:00:00Z");
const liveEnv = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" });
const fixtureEnv = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });

const dad: Person = { name: "Dad", birthYear: 1940, hometown: "London", favorites: [{ name: "Lonnie Donegan" }], language: "en", pronoun: "he" };

const SKIFFLE_ACTS = ["Chas McDevitt", "The Vipers Skiffle Group", "Johnny Duncan", "Tommy Steele", "Nancy Whiskey", "Wally Whyton"];
const MAINSTREAM_ACTS = ["Dolly Parton", "Tom Jones", "The Beatles", "The Rolling Stones", "Cliff Richard"];

function musicOf(cards: Card[]): string[] {
  return cards.filter((c) => c.domain === "music").map((c) => c.title);
}

async function planLive(options: SeededQlooOptions = {}) {
  const fake = seededQlooFake(options);
  const qloo = new QlooClient({ mode: "live", apiKey: "test", fetchImpl: fake.fetch });
  const result = await planSession(dad, { env: liveEnv, qloo, now: NOW });
  return { result, fake, music: musicOf(result.cards) };
}

describe("a seed that is not mainstream leads the suggestions (live-like Qloo)", () => {
  it("deals skiffle and late-1950s UK acts for Lonnie Donegan, not the Beatles, Tom Jones or Dolly Parton", async () => {
    const { music, result } = await planLive();
    expect(music.length).toBeGreaterThanOrEqual(3);
    expect(music.filter((t) => SKIFFLE_ACTS.includes(t)).length).toBeGreaterThanOrEqual(3);
    for (const title of MAINSTREAM_ACTS) expect(music, title).not.toContain(title);
    expect(SKIFFLE_ACTS).toContain(music[0]);
    // The seed was resolved to the artist entity, not the bare person record that shares its name.
    expect(result.favorites[0]?.entityId).toBe("33333333-0000-4000-8000-000000000002");
  });

  it("asks for the seed alone plus the hometown: no age bucket, and a popularity cap just above the seed's", async () => {
    const { fake } = await planLive();
    const artistCall = fake.calls.find((c) => c.path === "/v2/insights" && c.params["filter.type"] === "urn:entity:artist")!;
    expect(artistCall.params["signal.interests.entities"]).toBe("33333333-0000-4000-8000-000000000002");
    expect(artistCall.params["signal.location.query"]).toBe("London");
    expect(artistCall.params["signal.demographics.age"]).toBeUndefined();
    expect(artistCall.params["filter.popularity.max"]).toBe("0.84");
  });

  it("still puts the seed's neighbourhood first when Qloo ignores the popularity cap", async () => {
    const { music } = await planLive({ ignoreCap: true });
    expect(SKIFFLE_ACTS).toContain(music[0]);
    expect(music.slice(0, 3).every((t) => SKIFFLE_ACTS.includes(t))).toBe(true);
    for (const title of ["Dolly Parton", "Tom Jones", "The Beatles"]) expect(music.slice(0, 3)).not.toContain(title);
  });

  it("lifts the cap, and only then, when the capped answer is too thin", async () => {
    const { fake, music } = await planLive({ skiffleActs: 1 });
    const artistCalls = fake.calls.filter((c) => c.path === "/v2/insights" && c.params["filter.type"] === "urn:entity:artist");
    expect(artistCalls[0]!.params["filter.popularity.max"]).toBe("0.84");
    expect(artistCalls.length).toBeGreaterThan(1);
    expect(artistCalls[1]!.params["filter.popularity.max"]).toBeUndefined();
    // Even uncapped, the two skiffle acts that exist still come before the famous.
    expect(SKIFFLE_ACTS).toContain(music[0]);
    expect(SKIFFLE_ACTS).toContain(music[1]);
  });

  it("says which favorite a card came from, in the card and nowhere it was not chosen for", async () => {
    const { result } = await planLive();
    const music = result.cards.filter((c) => c.domain === "music");
    for (const card of music) expect(card.becauseOf).toBe("Lonnie Donegan");
    for (const card of result.cards.filter((c) => c.domain === "dining" || c.domain === "place")) expect(card.becauseOf).toBeUndefined();
  });
});

describe("the synthetic catalogue agrees (fixture Qloo)", () => {
  it("gives Lonnie Donegan's fan the skiffle acts, from London or from Glasgow", async () => {
    for (const hometown of ["London", "Glasgow"]) {
      const result = await planSession({ ...dad, hometown }, { env: fixtureEnv, qloo: new QlooClient({ mode: "fixture" }), now: NOW });
      const music = musicOf(result.cards);
      expect(music.filter((t) => SKIFFLE_ACTS.includes(t)).length, hometown).toBeGreaterThanOrEqual(3);
      for (const title of MAINSTREAM_ACTS) expect(music, `${hometown}: ${title}`).not.toContain(title);
    }
  });
});

describe("the presets are no worse for it (fixture Qloo)", () => {
  for (const preset of PRESETS) {
    it(`${preset.person.name} still gets a music run built on ${preset.person.favorites[0]!.name}`, async () => {
      const result = await planSession(preset.person, { env: fixtureEnv, qloo: new QlooClient({ mode: "fixture" }), now: NOW });
      const music = result.cards.filter((c) => c.domain === "music");
      expect(music.length).toBeGreaterThanOrEqual(3);
      for (const card of music) {
        expect(card.becauseOf).toBe(preset.person.favorites[0]!.name);
        expect(card.signals.params["signal.demographics.age"]).toBeUndefined();
        expect(card.signals.params["signal.interests.entities"]).toBe(result.favorites[0]!.entityId);
      }
      expect(result.cards.length).toBeGreaterThanOrEqual(8);
    });
  }
});
