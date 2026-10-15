import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { RateLimiter } from "@/lib/qloo/limiter";
import type { Person } from "@/lib/session/types";

import { liveQlooFake } from "./helpers/live-qloo";

const NOW = new Date("2026-10-14T00:00:00Z");
const scriptedEnv = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" });
const frank: Person = { name: "Frank", birthYear: 1945, hometown: "Chicago", favorites: [{ name: "Frank Sinatra" }], language: "en", pronoun: "he" };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("RateLimiter", () => {
  it("keeps at most four requests in flight", async () => {
    const limiter = new RateLimiter({ maxInFlight: 4, perSecond: 100 });
    let inFlight = 0;
    let peak = 0;
    const task = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      await tick();
      inFlight -= 1;
    };
    await Promise.all(Array.from({ length: 10 }, () => limiter.run(task)));
    expect(peak).toBe(4);
  });

  it("starts at most five requests in any rolling second", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      maxInFlight: 10,
      perSecond: 5,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        await tick();
        clock += ms;
      },
    });
    const started: number[] = [];
    await Promise.all(Array.from({ length: 7 }, () => limiter.run(async () => void started.push(clock))));
    expect(started.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(started[5]).toBeGreaterThanOrEqual(1_000);
    expect(started[6]).toBeGreaterThanOrEqual(1_000);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("frees the slot when a request fails", async () => {
    const limiter = new RateLimiter({ maxInFlight: 1, perSecond: 100 });
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});

describe("live Qloo client and the rate limit", () => {
  it("asks again once after a 429 instead of answering from the offline catalog", async () => {
    const fake = liveQlooFake();
    let first = true;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (first) {
        first = false;
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const fallbacks: string[] = [];
    const qloo = new QlooClient({
      mode: "live",
      apiKey: "test",
      fetchImpl,
      retryDelayMs: 5,
      guard: { fallbackOnError: () => true, onFallback: (_req, reason) => void fallbacks.push(reason) },
    });
    const res = await qloo.search("Frank Sinatra", { types: ["urn:entity:artist"] });
    expect(res.source).toBe("live");
    expect(res.body.results[0]?.name).toBe("Frank Sinatra");
    expect(fallbacks).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it("falls back only when the second try is also refused", async () => {
    const limited = (async () => new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 })) as unknown as typeof fetch;
    let attempts = 0;
    const counting = (async (input: string | URL | Request, init?: RequestInit) => {
      attempts += 1;
      return limited(input, init);
    }) as unknown as typeof fetch;
    const fallbacks: string[] = [];
    const qloo = new QlooClient({ mode: "live", apiKey: "test", fetchImpl: counting, retryDelayMs: 5, guard: { fallbackOnError: () => true, onFallback: (_r, reason) => void fallbacks.push(reason) } });
    const res = await qloo.search("Frank Sinatra");
    expect(attempts).toBe(2);
    expect(res.source).toBe("synthetic");
    expect(fallbacks).toEqual(["error"]);
  });

  it("plans with every domain's Insights call in flight together, paced to four at a time", async () => {
    const fake = liveQlooFake();
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const qloo = new QlooClient({ mode: "live", apiKey: "test", fetchImpl, limiter: new RateLimiter({ maxInFlight: 4, perSecond: 1_000 }) });
    const result = await planSession(frank, { env: scriptedEnv, qloo, now: NOW });
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(peak).toBe(4);
    // The six Insights calls are announced before any of them answers.
    const insightsEvents = result.trace.filter((e) => e.tool === "qloo_insights");
    const firstResult = insightsEvents.findIndex((e) => e.kind === "tool_result");
    expect(insightsEvents.slice(0, firstResult).filter((e) => e.kind === "tool_call")).toHaveLength(6);
  });
});
