import { describe, expect, it } from "vitest";

import { BUDGET_ENV_NAMES, DEFAULT_BUDGET_LIMITS, budgetCounterKey, createBudget, dayKey, readBudgetLimits } from "@/lib/guard/budget";
import { UpstashRedis, redisFromEnv } from "@/lib/guard/redis";

import { FakeRedis } from "./helpers/fake-redis";

const DAY_ONE = new Date("2026-11-05T10:00:00Z");
const DAY_TWO = new Date("2026-11-06T00:00:01Z");

describe("Upstash REST client", () => {
  it("posts a pipeline with the bearer token and unwraps the results", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const redis = new UpstashRedis({
      url: "https://example.upstash.io/",
      token: "tok",
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify([{ result: 7 }, { result: 1 }]), { status: 200 });
      }) as typeof fetch,
    });
    const replies = await redis.pipeline([
      ["INCR", "k"],
      ["EXPIRE", "k", 10],
    ]);
    expect(replies).toEqual([7, 1]);
    expect(seen[0]?.url).toBe("https://example.upstash.io/pipeline");
    expect((seen[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual([
      ["INCR", "k"],
      ["EXPIRE", "k", 10],
    ]);
  });

  it("throws on an HTTP failure or a per-command error, never returning a partial answer", async () => {
    const failing = new UpstashRedis({ url: "https://x", token: "t", fetchImpl: (async () => new Response("nope", { status: 500 })) as typeof fetch });
    await expect(failing.pipeline([["GET", "k"]])).rejects.toThrow(/500/);
    const erroring = new UpstashRedis({
      url: "https://x",
      token: "t",
      fetchImpl: (async () => new Response(JSON.stringify([{ error: "WRONGTYPE" }]), { status: 200 })) as typeof fetch,
    });
    await expect(erroring.pipeline([["GET", "k"]])).rejects.toThrow(/WRONGTYPE/);
  });

  it("is configured from either Vercel integration variable pair, and absent otherwise", () => {
    expect(redisFromEnv({})).toBeNull();
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: "https://a", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeInstanceOf(UpstashRedis);
    expect(redisFromEnv({ KV_REST_API_URL: "https://b", KV_REST_API_TOKEN: "t" })).toBeInstanceOf(UpstashRedis);
    expect(redisFromEnv({ KV_REST_API_URL: "https://b" })).toBeNull();
  });
});

describe("budget limits", () => {
  it("defaults, accepts whole numbers, and understands unlimited", () => {
    expect(readBudgetLimits({})).toEqual(DEFAULT_BUDGET_LIMITS);
    const limits = readBudgetLimits({ [BUDGET_ENV_NAMES["llm:plan"]]: "5", [BUDGET_ENV_NAMES.qloo]: "unlimited", [BUDGET_ENV_NAMES["llm:adapt"]]: "lots" });
    expect(limits["llm:plan"]).toBe(5);
    expect(limits.qloo).toBe(Infinity);
    expect(limits["llm:adapt"]).toBe(DEFAULT_BUDGET_LIMITS["llm:adapt"]);
  });

  it("keys counters by kind and UTC day", () => {
    expect(dayKey(new Date("2026-11-05T23:59:59Z"))).toBe("2026-11-05");
    expect(budgetCounterKey("llm:plan", "2026-11-05")).toBe("reminisce:budget:llm:plan:2026-11-05");
  });
});

describe("daily budget", () => {
  it("is unlimited and silent when no Redis is configured", async () => {
    const budget = createBudget({ redis: null });
    const decision = await budget.take("llm:plan", DAY_ONE);
    expect(decision).toMatchObject({ allowed: true, reason: "unconfigured" });
    expect((await budget.check("qloo", DAY_ONE)).allowed).toBe(true);
  });

  it("counts units per day, denies past the cap, and stops asking Redis once the day is spent", async () => {
    const redis = new FakeRedis();
    const budget = createBudget({ redis, limits: { "llm:plan": 2, "llm:adapt": 10, qloo: 10 } });
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: true, used: 1, limit: 2, reason: "within" });
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: true, used: 2 });
    expect(redis.ttls.get(budgetCounterKey("llm:plan", "2026-11-05"))).toBe(2 * 24 * 60 * 60);
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: false, used: 3, reason: "spent" });
    const before = redis.calls.length;
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: false, reason: "spent" });
    expect(await budget.check("llm:plan", DAY_ONE)).toMatchObject({ allowed: false, reason: "spent" });
    expect(redis.calls.length).toBe(before);
    // Other kinds are untouched, and a new day starts fresh.
    expect((await budget.take("qloo", DAY_ONE)).allowed).toBe(true);
    expect(await budget.take("llm:plan", DAY_TWO)).toMatchObject({ allowed: true, used: 1 });
  });

  it("check reports whether one more unit would fit without taking it", async () => {
    const redis = new FakeRedis();
    const budget = createBudget({ redis, limits: { "llm:plan": 10, "llm:adapt": 10, qloo: 1 } });
    expect(await budget.check("qloo", DAY_ONE)).toMatchObject({ allowed: true, used: 0 });
    expect(redis.store.size).toBe(0);
    await budget.take("qloo", DAY_ONE);
    expect(await budget.check("qloo", DAY_ONE)).toMatchObject({ allowed: false, used: 1, reason: "spent" });
  });

  it("takes the cheap path for a cool-down when Redis fails, instead of throwing", async () => {
    const redis = new FakeRedis();
    redis.failWith = new Error("connection reset");
    const errors: unknown[] = [];
    const budget = createBudget({ redis, errorCooldownMs: 60_000, onError: (e) => errors.push(e) });
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: false, reason: "error" });
    expect(errors).toHaveLength(1);
    redis.failWith = null;
    const before = redis.calls.length;
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: false, reason: "error" });
    expect(redis.calls.length).toBe(before);
    const recovered = createBudget({ redis, errorCooldownMs: 0 });
    expect((await recovered.take("llm:plan", DAY_ONE)).allowed).toBe(true);
  });

  it("never touches Redis for an unlimited kind", async () => {
    const redis = new FakeRedis();
    const budget = createBudget({ redis, limits: { "llm:plan": Infinity, "llm:adapt": 1, qloo: 1 } });
    expect(await budget.take("llm:plan", DAY_ONE)).toMatchObject({ allowed: true, reason: "unlimited" });
    expect(redis.calls).toHaveLength(0);
  });
});
