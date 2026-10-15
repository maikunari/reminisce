/**
 * Regression tests for the first live-Qloo session (2026-10-14): Frank,
 * Chicago, 1960 to 1975, loved Frank Sinatra. On the real API the TV and
 * landmark calls came back empty, the model retried them until it ran out of
 * steps and time, and no session appeared. The fake API in helpers/live-qloo.ts
 * answers the way the recorded live responses did.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { planSession } from "@/lib/agent";
import { LoopError } from "@/lib/agent/loop";
import { rankFavoriteHits } from "@/lib/agent/tools";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { planningProgress } from "@/lib/session/planning-progress";
import type { Person, TraceEvent } from "@/lib/session/types";

import { FAKE_IDS, liveQlooFake } from "./helpers/live-qloo";

const NOW = new Date("2026-10-14T00:00:00Z");
const scriptedEnv = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" });

const frank: Person = { name: "Frank", birthYear: 1945, hometown: "Chicago", favorites: [{ name: "Frank Sinatra" }], language: "en", pronoun: "he" };
const michiko: Person = { name: "Michiko", birthYear: 1950, hometown: "Osaka", favorites: [{ name: "Hibari Misora" }], language: "ja", pronoun: "she" };

function liveClient() {
  const fake = liveQlooFake();
  return { fake, qloo: new QlooClient({ mode: "live", apiKey: "test", fetchImpl: fake.fetch }) };
}

function eraOf(person: Person) {
  return { film: [person.birthYear + 15, person.birthYear + 30], tv: [person.birthYear + 10, person.birthYear + 30] } as const;
}

function expectInEra(cards: { domain: string; year?: number; title: string }[], person: Person) {
  const era = eraOf(person);
  for (const card of cards) {
    if (card.domain !== "film" && card.domain !== "tv") continue;
    const [lo, hi] = card.domain === "film" ? era.film : era.tv;
    expect(card.year, card.title).toBeGreaterThanOrEqual(lo);
    expect(card.year, card.title).toBeLessThanOrEqual(hi);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live Qloo: Frank, Chicago, 1960 to 1975 (deterministic planner)", () => {
  it("fills every domain, keeping TV in the era by asking again without the hometown signal", async () => {
    const { fake, qloo } = liveClient();
    const result = await planSession(frank, { env: scriptedEnv, qloo, now: NOW });

    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(new Set(result.cards.map((c) => c.domain))).toEqual(new Set(["music", "film", "tv", "dining", "place", "destination"]));
    expectInEra(result.cards, frank);
    const tv = result.cards.find((c) => c.domain === "tv")!;
    expect(tv.signals.params["signal.location.query"]).toBeUndefined();
    expect(tv.signals.params["filter.release_year.min"]).toBe("1955");
    expect(result.trace.some((e) => e.summary === "0 TV shows; asking again without the hometown signal")).toBe(true);
    // Landmarks come from the attraction and landmark tags, tuned by age rather than the seed.
    const place = result.cards.find((c) => c.domain === "place")!;
    expect(place.title).toMatch(/^Old Theatre/);
    expect(place.signals.params["filter.tags"]).toBe("urn:tag:genre:place:tourist_attraction,urn:tag:genre:place:landmark");
    expect(place.signals.params["signal.interests.entities"]).toBeUndefined();
    // A modest number of calls: one search per favorite and hometown, six insights and one widening; tag ids are known.
    expect(fake.calls.length).toBeLessThanOrEqual(9);
    expect(fake.calls.some((c) => c.path === "/v2/tags")).toBe(false);
  });

  it("streams a domain and a preview with each Insights result so the planning view fills in place", async () => {
    const { qloo } = liveClient();
    const events: TraceEvent[] = [];
    await planSession(frank, { env: scriptedEnv, qloo, now: NOW, emit: (e) => events.push(e) });
    const progress = planningProgress(events);
    expect(progress.domains.map((d) => d.status)).toEqual(["found", "found", "found", "found", "found", "found"]);
    expect(progress.domains.find((d) => d.domain === "tv")?.items[0]?.year).toBeGreaterThanOrEqual(1955);
    expect(progress.qlooCalls).toBe(events.filter((e) => e.qloo).length);
  });
});

describe("live Qloo: favorites and failures", () => {
  it("seeds Hibari Misora with the artist record, not the bare person record Qloo lists first", async () => {
    const hits = [
      { name: "Hibari Misora", types: ["urn:entity:person"], popularity: undefined },
      { name: "Misora Hibari", types: ["urn:entity:artist"], popularity: 0.61 },
      { name: "Hibari Misora Memorial House", types: ["urn:entity:place"], popularity: undefined },
    ];
    expect(rankFavoriteHits("Hibari Misora", hits)[0]?.name).toBe("Misora Hibari");
    // An exact artist match stays first.
    expect(rankFavoriteHits("Frank Sinatra", [{ name: "Frank Sinatra", types: ["urn:entity:artist"], popularity: 0.99 }, { name: "Frank Sinatra", types: ["urn:entity:person"], popularity: 0.9 }])[0]?.types).toEqual([
      "urn:entity:artist",
    ]);

    const { qloo } = liveClient();
    const result = await planSession(michiko, { env: scriptedEnv, qloo, now: NOW });
    expect(result.favorites[0]?.entityId).toBe(FAKE_IDS.HIBARI_ARTIST);
    const music = result.cards.filter((c) => c.domain === "music");
    expect(music.length).toBeGreaterThan(0);
    for (const card of music) expect(card.title).toMatch(/^Enka Singer/);
    // Osaka's locality comes back in Japanese; its country is still read, so films are Japanese releases first.
    expect(result.cards.find((c) => c.domain === "film")?.signals.params["filter.release_country"] ?? "Japan").toBe("Japan");
    expectInEra(result.cards, michiko);
  });

  it("leaves out artists who started after the youth window, even when the city alone answers", async () => {
    const { qloo } = liveClient();
    const unresolved: Person = { ...michiko, favorites: [{ name: "Hibari Misora", entityId: FAKE_IDS.HIBARI_PERSON }] };
    const result = await planSession(unresolved, { env: scriptedEnv, qloo, now: NOW });
    // Bands formed in 1985 and later cannot be from a 1965-1980 youth.
    expect(result.cards.some((c) => /^Modern Band/.test(c.title))).toBe(false);
  });

  it("keeps the first answer when a widening step fails", async () => {
    const fake = liveQlooFake();
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:movie" && !url.searchParams.get("signal.location.query")) {
        return new Response(JSON.stringify({ errors: [{ message: "bad request" }] }), { status: 400 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const qloo = new QlooClient({ mode: "live", apiKey: "test", fetchImpl: failing });
    // Osaka films with a location signal come back empty; the widening step fails; the session still builds.
    const result = await planSession(michiko, { env: scriptedEnv, qloo, now: NOW });
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(result.cards.some((c) => c.domain === "film")).toBe(false);
  });
});

describe("live Qloo: running out of time", () => {
  /** Each Qloo request takes `ms` of agent time, so the run hits its deadline part-way. */
  function slowClock(ms: number) {
    let now = Date.parse("2026-10-14T00:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    return (fetchImpl: typeof fetch) =>
      (async (input: string | URL | Request, init?: RequestInit) => {
        now += ms;
        return fetchImpl(input, init);
      }) as unknown as typeof fetch;
  }

  it("commits what Qloo already returned when the deterministic planner runs out of time", async () => {
    const fake = liveQlooFake();
    const slow = slowClock(6_000);
    const qloo = new QlooClient({ mode: "live", apiKey: "test", fetchImpl: slow(fake.fetch) });
    const events: TraceEvent[] = [];
    const result = await planSession(frank, { env: scriptedEnv, qloo, now: NOW, emit: (e) => events.push(e) });
    expect(result.cards.length).toBeGreaterThanOrEqual(5);
    expect(events.some((e) => e.kind === "narration" && /Out of time for more Qloo calls/.test(e.summary))).toBe(true);
  });

  it("reports an empty session, not a crash, when Qloo returned too little before the deadline", async () => {
    const empty = (async () => new Response(JSON.stringify({ success: true, results: { entities: [] } }), { status: 200 })) as unknown as typeof fetch;
    const slow = slowClock(7_300);
    const qloo = new QlooClient({ mode: "live", apiKey: "test", fetchImpl: slow(empty) });
    const error = await planSession(frank, { env: scriptedEnv, qloo, now: NOW }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoopError);
    expect((error as LoopError).reason).toBe("empty");
  });
});

/**
 * Replays the real live responses recorded while fixing this (git-ignored:
 * the hackathon terms keep Qloo data out of public repositories). Runs
 * wherever fixtures/live/ holds them; record more with
 * `QLOO_API_KEY=… npm run record -- --live`.
 */
const LIVE_DIR = process.env.REMINISCE_LIVE_FIXTURES ?? path.join(process.cwd(), "fixtures", "live");
describe.skipIf(!existsSync(LIVE_DIR))("recorded live Qloo responses", () => {
  const people: Person[] = [
    frank,
    michiko,
    { name: "Rosa", birthYear: 1948, hometown: "Mexico City", favorites: [{ name: "Pedro Infante" }], language: "es", pronoun: "she" },
  ];
  it.each(people.map((p) => [p.name, p] as const))("%s gets a full, in-era session from the recorded answers", async (_name, person) => {
    const qloo = new QlooClient({ mode: "fixture", recordedRoot: LIVE_DIR });
    const result = await planSession(person, { env: readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" }), qloo, now: NOW });
    expect(result.cards.every((c) => c.signals.source === "recorded")).toBe(true);
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(new Set(result.cards.map((c) => c.domain)).size).toBeGreaterThanOrEqual(5);
    expectInEra(result.cards, person);
  });
});
