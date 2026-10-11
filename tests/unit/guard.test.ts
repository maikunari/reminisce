import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { searchCacheControl } from "@/lib/api/cache-control";
import { readServerEnv } from "@/lib/env";
import { GUARD_COPY, createGuard, isFallbackWorthy, type GuardDeps } from "@/lib/guard";
import { createBudget, type Budget, type BudgetDecision, type BudgetKind } from "@/lib/guard/budget";
import { QlooClient, QlooError, type QlooGuardHooks, type QlooResponseCache } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";

import { FakeRedis } from "./helpers/fake-redis";

const NOW = new Date("2026-11-05T10:00:00Z");
const frank = PRESETS.find((p) => p.id === "frank")!.person;
const liveEnv = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "qloo-key", LLM_MODE: "live", LLM_API_KEY: "llm-key" });

const okInsights = { success: true, results: { entities: [{ name: "Live Artist", entity_id: "11111111-aaaa-4bbb-8ccc-000000000001", type: "urn:entity", subtype: "urn:entity:artist", query: { affinity: 0.9 } }] } };

function respond(status: number, body: unknown = okInsights): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}

function countingFetch(status: number, body: unknown = okInsights) {
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function memoryCache(): QlooResponseCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async wrap(key, produce) {
      if (store.has(key)) return store.get(key) as never;
      const value = await produce();
      store.set(key, value);
      return value;
    },
  };
}

/** A budget whose answers are scripted per kind, recording what was asked. */
function scriptedBudget(answers: Partial<Record<BudgetKind, Partial<BudgetDecision>>>): Budget & { asked: { kind: BudgetKind; op: "take" | "check" }[] } {
  const asked: { kind: BudgetKind; op: "take" | "check" }[] = [];
  const answer = (kind: BudgetKind, op: "take" | "check"): BudgetDecision => {
    asked.push({ kind, op });
    return { kind, allowed: true, used: 1, limit: 10, reason: "within", day: "2026-11-05", ...answers[kind] };
  };
  return { asked, take: async (kind) => answer(kind, "take"), check: async (kind) => answer(kind, "check") };
}

function deps(budget: Budget, fetchImpl: typeof fetch, extra: Partial<GuardDeps> = {}): GuardDeps {
  return {
    env: liveEnv,
    budget,
    liveClient: (hooks: QlooGuardHooks) => new QlooClient({ mode: "live", apiKey: "qloo-key", fetchImpl, guard: hooks }),
    fixtureClient: () => new QlooClient({ mode: "fixture" }),
    now: NOW,
    ...extra,
  };
}

describe("createGuard: the degradation ladder", () => {
  it("runs at full strength when both budgets are within their caps", async () => {
    const budget = scriptedBudget({});
    const guard = await createGuard("plan", deps(budget, respond(200)));
    expect(guard.env.llmMode).toBe("live");
    expect(guard.qloo.mode).toBe("live");
    expect(guard.notes).toEqual([]);
    expect(guard.degraded).toEqual({ llm: false, qloo: false });
    expect(guard.notice()).toBeUndefined();
    expect(budget.asked).toEqual([
      { kind: "llm:plan", op: "take" },
      { kind: "qloo", op: "check" },
    ]);
  });

  it("switches to the deterministic planner, with a note, when the model budget is spent", async () => {
    const budget = scriptedBudget({ "llm:plan": { allowed: false, reason: "spent" } });
    const guard = await createGuard("plan", deps(budget, respond(200)));
    expect(guard.env.llmMode).toBe("fixture");
    expect(guard.degraded.llm).toBe(true);
    expect(guard.notes).toEqual([GUARD_COPY.llmSpent]);
    expect(guard.qloo.mode).toBe("live");
    // The model side never shows a banner: the panel already labels template prompts.
    expect(guard.notice()).toBeUndefined();
  });

  it("serves the whole session from the offline catalog, with a banner, when the Qloo budget is spent", async () => {
    const budget = scriptedBudget({ qloo: { allowed: false, reason: "spent" } });
    const guard = await createGuard("plan", deps(budget, respond(200)));
    expect(guard.qloo.mode).toBe("fixture");
    expect(guard.degraded.qloo).toBe(true);
    expect(guard.notes).toEqual([GUARD_COPY.qlooSpentNote]);
    expect(guard.notice()).toBe(GUARD_COPY.qlooSpentBanner);
    const adapt = await createGuard("adapt", deps(scriptedBudget({ qloo: { allowed: false, reason: "spent" } }), respond(200)));
    expect(adapt.notice()).toBe(GUARD_COPY.adaptBudget);
    expect(adapt.env.llmMode).toBe("live");
  });

  it("takes the cheap path, worded honestly, when the budget store cannot answer", async () => {
    const budget = scriptedBudget({ "llm:plan": { allowed: false, reason: "error" }, qloo: { allowed: false, reason: "error" } });
    const guard = await createGuard("plan", deps(budget, respond(200)));
    expect(guard.notes).toEqual([GUARD_COPY.llmUnknown, GUARD_COPY.qlooUnknownNote]);
    expect(guard.notice()).toBe(GUARD_COPY.qlooUnknownBanner);
  });

  it("asks only the per-call hook for autocomplete, and never the model budget", async () => {
    const budget = scriptedBudget({});
    const guard = await createGuard("search", deps(budget, respond(200)));
    expect(budget.asked).toEqual([]);
    await guard.qloo.search("sinatra");
    expect(budget.asked).toEqual([{ kind: "qloo", op: "take" }]);
  });

  it("leaves fixture mode alone: no Qloo budget questions, no live client", async () => {
    const budget = scriptedBudget({});
    const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
    const guard = await createGuard("plan", deps(budget, respond(200), { env }));
    expect(guard.qloo.mode).toBe("fixture");
    expect(budget.asked).toEqual([]);
    expect(guard.notice()).toBeUndefined();
  });
});

describe("guarded live client", () => {
  it("answers from the synthetic catalog when a live call is over budget, and says so", async () => {
    const redis = new FakeRedis();
    const budget = createBudget({ redis, limits: { "llm:plan": 100, "llm:adapt": 100, qloo: 1 } });
    const { calls, fetchImpl } = countingFetch(200);
    const guard = await createGuard("plan", deps(budget, fetchImpl));
    const first = await guard.qloo.insights({ type: "urn:entity:artist", take: 1 });
    expect(first.source).toBe("live");
    const second = await guard.qloo.insights({ type: "urn:entity:movie", take: 1 });
    expect(second.source).toBe("synthetic");
    expect(second.fallback).toBe("budget");
    expect(calls).toHaveLength(1);
    expect(guard.fallbacks).toEqual({ budget: 1, error: 0 });
    expect(guard.notice()).toBe(GUARD_COPY.qlooPartBudget);
  });

  it("answers from the synthetic catalog when Qloo is unavailable, but still surfaces a client error", async () => {
    const guard = await createGuard("plan", deps(scriptedBudget({}), respond(429, { error: "slow down" })));
    const res = await guard.qloo.insights({ type: "urn:entity:artist", take: 2 });
    expect(res.source).toBe("synthetic");
    expect(res.fallback).toBe("error");
    expect(res.body.results.entities.length).toBeGreaterThan(0);
    expect(guard.fallbacks).toEqual({ budget: 0, error: 1 });
    expect(guard.notice()).toBe(GUARD_COPY.qlooPartError);
    const adapt = await createGuard("adapt", deps(scriptedBudget({}), respond(503)));
    await adapt.qloo.search("sinatra");
    expect(adapt.notice()).toBe(GUARD_COPY.adaptError);

    const forbidden = await createGuard("plan", deps(scriptedBudget({}), respond(403, { error: "bad key" })));
    await expect(forbidden.qloo.insights({ type: "urn:entity:artist" })).rejects.toBeInstanceOf(QlooError);
    expect(isFallbackWorthy(new QlooError("x", 403, { path: "/search", params: {} }))).toBe(false);
    for (const status of [0, 408, 429, 500, 502, 503]) expect(isFallbackWorthy(new QlooError("x", status, { path: "/search", params: {} }))).toBe(true);
  });

  it("still builds a full deck when every live call fails", async () => {
    const guard = await createGuard("plan", deps(scriptedBudget({}), respond(500)));
    const result = await planSession(frank, { env: guard.env, qloo: guard.qloo, notes: guard.notes, now: NOW });
    expect(result.cards.length).toBeGreaterThanOrEqual(8);
    expect(result.cards.every((c) => c.signals.source === "synthetic")).toBe(true);
    expect(result.qlooMode).toBe("live");
    expect(guard.fallbacks.error).toBeGreaterThanOrEqual(8);
    expect(guard.notice()).toBe(GUARD_COPY.qlooPartError);
  });

  it("records the guard's notes at the top of the trace", async () => {
    const guard = await createGuard("plan", deps(scriptedBudget({ "llm:plan": { allowed: false, reason: "spent" } }), respond(200)));
    const result = await planSession(frank, { env: guard.env, qloo: new QlooClient({ mode: "fixture" }), notes: guard.notes, now: NOW });
    expect(result.trace[0]).toMatchObject({ kind: "note", summary: GUARD_COPY.llmSpent, phase: "plan" });
    expect(result.planner).toBe("deterministic");
  });
});

describe("response cache in front of the live client", () => {
  it("serves a repeat request from the cache without calling Qloo or the budget", async () => {
    const cache = memoryCache();
    const { calls, fetchImpl } = countingFetch(200);
    let budgetAsks = 0;
    const client = new QlooClient({ mode: "live", apiKey: "k", fetchImpl, cache, guard: { allowLive: () => (budgetAsks += 1) > 0 } });
    const first = await client.insights({ type: "urn:entity:artist", signals: { locationQuery: "Osaka" }, take: 3 });
    const second = await client.insights({ type: "urn:entity:artist", signals: { locationQuery: "Osaka" }, take: 3 });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.body).toEqual(first.body);
    expect(calls).toHaveLength(1);
    expect(budgetAsks).toBe(1);
    await client.insights({ type: "urn:entity:artist", signals: { locationQuery: "Chicago" }, take: 3 });
    expect(calls).toHaveLength(2);
  });

  it("stores only successful answers: a no-results search and a failure are fetched again", async () => {
    const cache = memoryCache();
    const notFound = countingFetch(404, { error: "No results" });
    const client = new QlooClient({ mode: "live", apiKey: "k", fetchImpl: notFound.fetchImpl, cache });
    expect((await client.search("zzz")).body.results).toEqual([]);
    expect((await client.search("zzz")).body.results).toEqual([]);
    expect(notFound.calls).toHaveLength(2);
    expect(cache.store.size).toBe(0);

    const failing = countingFetch(500, { error: "boom" });
    const broken = new QlooClient({ mode: "live", apiKey: "k", fetchImpl: failing.fetchImpl, cache });
    await expect(broken.insights({ type: "urn:entity:artist" })).rejects.toBeInstanceOf(QlooError);
    await expect(broken.insights({ type: "urn:entity:artist" })).rejects.toBeInstanceOf(QlooError);
    expect(failing.calls).toHaveLength(2);
    expect(cache.store.size).toBe(0);
  });

  it("turns a network failure into a QlooError the guard can act on", async () => {
    const client = new QlooClient({
      mode: "live",
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      guard: { fallbackOnError: isFallbackWorthy },
    });
    const res = await client.search("sinatra");
    expect(res.source).toBe("synthetic");
    expect(res.fallback).toBe("error");
  });
});

describe("autocomplete cache headers", () => {
  it("lets the CDN keep real answers for a day and drops fallback answers quickly", () => {
    expect(searchCacheControl({})).toBe("public, max-age=120, s-maxage=86400, stale-while-revalidate=604800");
    expect(searchCacheControl({ fallback: "budget" })).toBe("private, max-age=60");
    expect(searchCacheControl({ fallback: "error" })).toBe("private, max-age=60");
  });
});
