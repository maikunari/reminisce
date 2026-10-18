/**
 * Regression for Mike's 2026-10-17 test: his dad loves Lonnie Donegan (British
 * skiffle, 1950s) and was offered Dolly Parton, Tom Jones and the Beatles. A
 * seeded artist call must stay with the seed: skiffle and late-1950s UK acts
 * first, the famous names of a whole generation not in their place. Probed live
 * on 2026-10-19, what drowns the seed is the hometown signal.
 */
import { describe, expect, it } from "vitest";

import { adaptSession, planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";
import type { Card, Person } from "@/lib/session/types";

import { DONEGAN, seededQlooFake, type SeededQlooOptions } from "./helpers/seeded-qloo";

const NOW = new Date("2026-10-17T00:00:00Z");
const liveEnv = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" });
const fixtureEnv = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });

const dad: Person = { name: "Dad", birthYear: 1940, hometown: "London", favorites: [{ name: "Lonnie Donegan" }], language: "en", pronoun: "he" };

const SKIFFLE_ACTS = ["Chas McDevitt", "The Vipers Skiffle Group", "Johnny Duncan", "Tommy Steele", "Nancy Whiskey", "Wally Whyton"];
const MAINSTREAM_ACTS = ["Dolly Parton", "Tom Jones", "The Beatles", "The Rolling Stones", "Cliff Richard"];

function musicOf(cards: Card[]): string[] {
  return cards.filter((c) => c.domain === "music").map((c) => c.title);
}

function liveClient(options: SeededQlooOptions = {}) {
  const fake = seededQlooFake(options);
  return { fake, qloo: new QlooClient({ mode: "live", apiKey: "test", fetchImpl: fake.fetch }) };
}

async function planLive(options: SeededQlooOptions = {}) {
  const { fake, qloo } = liveClient(options);
  const result = await planSession(dad, { env: liveEnv, qloo, now: NOW });
  return { result, fake, music: musicOf(result.cards) };
}

const artistCalls = (fake: ReturnType<typeof seededQlooFake>) => fake.calls.filter((c) => c.path === "/v2/insights" && c.params["filter.type"] === "urn:entity:artist");

describe("a seed that is not mainstream leads the suggestions (live-like Qloo)", () => {
  it("deals skiffle and late-1950s UK acts for Lonnie Donegan, not the Beatles, Tom Jones or Dolly Parton", async () => {
    const { music, result } = await planLive();
    expect(music.length).toBeGreaterThanOrEqual(3);
    expect(music.filter((t) => SKIFFLE_ACTS.includes(t)).length).toBeGreaterThanOrEqual(3);
    for (const title of MAINSTREAM_ACTS) expect(music, title).not.toContain(title);
    expect(SKIFFLE_ACTS).toContain(music[0]);
    // The seed was resolved to the artist entity, not the bare person record that shares its name.
    expect(result.favorites[0]?.entityId).toBe(DONEGAN);
  });

  it("asks for the seed alone: no hometown signal, no age bucket, no popularity cap", async () => {
    const { fake } = await planLive();
    const call = artistCalls(fake)[0]!;
    expect(call.params["signal.interests.entities"]).toBe(DONEGAN);
    expect(call.params["signal.location.query"]).toBeUndefined();
    expect(call.params["signal.demographics.age"]).toBeUndefined();
    expect(call.params["filter.popularity.max"]).toBeUndefined();
    expect(artistCalls(fake)).toHaveLength(1);
  });

  it("orders by the person's years, country and the seed's music genre, not by fame or mood tags", async () => {
    // The stand-in's seed-only answer still leads with the Beatles, and every act carries the mood tag "Loyal".
    const { music } = await planLive();
    expect(music.slice(0, 3).every((t) => SKIFFLE_ACTS.includes(t))).toBe(true);
  });

  it("brings the hometown back only when the seed alone is too thin", async () => {
    const { fake, music } = await planLive({ seedOnlyActs: 2 });
    const calls = artistCalls(fake);
    expect(calls[0]!.params["signal.location.query"]).toBeUndefined();
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[1]!.params["signal.location.query"]).toBe("London");
    expect(calls[1]!.params["signal.interests.entities"]).toBe(DONEGAN);
    // The two acts the seed alone found still come first, ahead of what the hometown pulled in.
    expect(SKIFFLE_ACTS).toContain(music[0]);
    expect(SKIFFLE_ACTS).toContain(music[1]);
  });

  it("does not fail when an artist carries a tag with no name, as live Qloo sometimes sends", async () => {
    const { music, result } = await planLive({ namelessTag: true });
    expect(music.length).toBeGreaterThanOrEqual(3);
    expect(music).toContain("Chas McDevitt");
    expect(result.trace.some((e) => e.kind === "error")).toBe(false);
    for (const card of result.cards) expect(card.tags.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
  });

  it("does not name the favorite on its own cards, since the why-line already does", async () => {
    const { result } = await planLive();
    for (const card of result.cards) expect(card.becauseOf).toBeUndefined();
    const music = result.cards.find((c) => c.domain === "music")!;
    expect(music.why).toContain("Lonnie Donegan");
  });

  it("names the liked card a re-tune leans on, under the typed name of the favorite when that is the seed", async () => {
    const { result } = await planLive();
    const liked = result.cards.find((c) => c.domain === "music")!;
    const { qloo } = liveClient();
    const person = { ...dad, favorites: result.favorites };
    const adapted = await adaptSession(
      { person, cards: result.cards.map((c) => (c.id === liked.id ? { ...c, reaction: "lit_up" as const } : c)), feedback: { cardId: liked.id, reaction: "lit_up" }, currentIndex: 0 },
      { env: liveEnv, qloo, now: NOW },
    );
    const leaning = adapted.replacements.filter((r) => r.becauseOf);
    expect(leaning.length).toBeGreaterThanOrEqual(1);
    for (const r of leaning) expect(r.becauseOf).toBe(liked.title);
    for (const r of adapted.replacements) expect(r.becauseOf).not.toBe("Lonnie Donegan");
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
        expect(card.signals.params["signal.demographics.age"]).toBeUndefined();
        expect(card.signals.params["signal.interests.entities"]).toBe(result.favorites[0]!.entityId);
        expect(card.signals.seedNames).toEqual([preset.person.favorites[0]!.name]);
      }
      expect(result.cards.length).toBeGreaterThanOrEqual(8);
    });
  }
});
