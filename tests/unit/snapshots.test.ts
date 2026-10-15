import { describe, expect, it } from "vitest";

import { planSession } from "@/lib/agent";
import { readServerEnv } from "@/lib/env";
import { describeRecordedAt, isFullStrength, loadSnapshot, matchingPreset, REPLAY_MAX_MS, REPLAY_SPACING_MS, replaySnapshot, snapshotKey, storeSnapshot } from "@/lib/guard/snapshots";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";
import type { TraceEvent } from "@/lib/session/types";

import { FakeRedis } from "./helpers/fake-redis";

const env = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const qloo = new QlooClient({ mode: "fixture" });
const RECORDED = new Date("2026-11-05T09:14:00Z");
const michiko = PRESETS.find((p) => p.id === "michiko")!.person;

describe("matchingPreset", () => {
  it("recognises a preset only when the person still matches it", () => {
    expect(matchingPreset(michiko)?.id).toBe("michiko");
    expect(matchingPreset({ ...michiko, name: "michiko " })?.id).toBe("michiko");
    expect(matchingPreset({ ...michiko, favorites: [{ name: "Hibari Misora" }, { name: "Tora-san" }] })).toBeUndefined();
    expect(matchingPreset({ ...michiko, hometown: "Kyoto" })).toBeUndefined();
    expect(matchingPreset({ ...michiko, presetId: undefined })).toBeUndefined();
    expect(matchingPreset({ ...michiko, presetId: "frank" })).toBeUndefined();
  });
});

describe("isFullStrength", () => {
  const liveEnv = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "k", LLM_MODE: "live", LLM_API_KEY: "k" });
  const guard = (over: Partial<Parameters<typeof isFullStrength>[1]> = {}) => ({ env: liveEnv, degraded: { llm: false, qloo: false }, fallbacks: { budget: 0, error: 0 }, ...over });

  it("keeps a full deck from live, undegraded Qloo whoever wrote the prompts", async () => {
    const result = await planSession(michiko, { env, qloo, now: RECORDED });
    expect(result.planner).toBe("deterministic");
    expect(isFullStrength(result, guard())).toBe(true);
    expect(isFullStrength({ ...result, planner: "llm" }, guard())).toBe(true);
    expect(isFullStrength(result, guard({ env: { ...liveEnv, llmMode: "fixture" } }))).toBe(true);
    // The model's allowance being spent only means template prompts; the cards are as good.
    expect(isFullStrength(result, guard({ degraded: { llm: true, qloo: false } }))).toBe(true);
  });

  it("refuses a degraded, offline or short run", async () => {
    const result = await planSession(michiko, { env, qloo, now: RECORDED });
    expect(isFullStrength(result, guard({ degraded: { llm: false, qloo: true } }))).toBe(false);
    expect(isFullStrength(result, guard({ fallbacks: { budget: 0, error: 1 } }))).toBe(false);
    expect(isFullStrength(result, guard({ fallbacks: { budget: 1, error: 0 } }))).toBe(false);
    expect(isFullStrength(result, guard({ env: { ...liveEnv, qlooMode: "fixture" } }))).toBe(false);
    expect(isFullStrength({ ...result, cards: result.cards.slice(0, 7) }, guard())).toBe(false);
  });
});

describe("preset snapshots", () => {
  it("round-trips a plan through Redis with a one-day TTL and reads it back while fresh", async () => {
    const redis = new FakeRedis();
    const result = await planSession(michiko, { env, qloo, now: RECORDED });
    await storeSnapshot(redis, "michiko", result, RECORDED);
    expect(redis.ttls.get(snapshotKey("michiko"))).toBe(24 * 60 * 60);
    const later = new Date(RECORDED.getTime() + 6 * 60 * 60 * 1000);
    const snapshot = await loadSnapshot(redis, "michiko", later);
    expect(snapshot?.recordedAt).toBe(RECORDED.toISOString());
    expect(snapshot?.result.cards.map((c) => c.entityId)).toEqual(result.cards.map((c) => c.entityId));
    expect(snapshot?.result.trace).toHaveLength(result.trace.length);
  });

  it("treats a stale, missing, foreign or unreadable snapshot as none, and never throws", async () => {
    const redis = new FakeRedis();
    const result = await planSession(michiko, { env, qloo, now: RECORDED });
    await storeSnapshot(redis, "michiko", result, RECORDED);
    const nextDay = new Date(RECORDED.getTime() + 25 * 60 * 60 * 1000);
    expect(await loadSnapshot(redis, "michiko", nextDay)).toBeNull();
    expect(await loadSnapshot(redis, "frank", RECORDED)).toBeNull();
    redis.store.set(snapshotKey("frank"), "{not json");
    expect(await loadSnapshot(redis, "frank", RECORDED)).toBeNull();
    redis.store.set(snapshotKey("frank"), JSON.stringify({ version: 2, presetId: "michiko", recordedAt: RECORDED.toISOString(), result }));
    expect(await loadSnapshot(redis, "frank", RECORDED)).toBeNull();
    redis.failWith = new Error("down");
    expect(await loadSnapshot(redis, "michiko", RECORDED)).toBeNull();
  });

  it("replays the trace in order behind an honest note, paced but bounded, and marks the plan", async () => {
    const redis = new FakeRedis();
    const result = await planSession(michiko, { env, qloo, now: RECORDED });
    const snapshot = await storeSnapshot(redis, "michiko", result, RECORDED);
    const emitted: TraceEvent[] = [];
    const sleeps: number[] = [];
    const replayed = await replaySnapshot(snapshot, (e) => emitted.push(e), { spacingMs: 150, maxMs: 3_000, sleep: async (ms) => void sleeps.push(ms) });
    expect(emitted[0]).toMatchObject({ kind: "note", phase: "plan" });
    expect(emitted[0]?.summary).toContain("Replayed from a live Qloo run at 09:14 UTC on 5 November");
    expect(emitted.slice(1).map((e) => e.id)).toEqual(result.trace.map((e) => e.id));
    expect(sleeps).toHaveLength(result.trace.length);
    expect(sleeps.every((ms) => ms > 0 && ms <= 150)).toBe(true);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3_000);
    expect(replayed.replayedAt).toBe(RECORDED.toISOString());
    expect(replayed.trace).toEqual(emitted);
    expect(replayed.cards).toEqual(result.cards);
  });

  it("never keeps or replays narration that is not fit to show, and opens a preset in about a second", async () => {
    const redis = new FakeRedis();
    const result = await planSession(michiko, { env, qloo, now: RECORDED });
    const leak: TraceEvent = { id: "leak", at: 1, phase: "plan", kind: "narration", policy: "llm", summary: '<｜DSML｜invoke name="plan_session"><｜DSML｜parameter name="cards">[{"entity_id": "x"}]' };
    const snapshot = await storeSnapshot(redis, "michiko", { ...result, trace: [...result.trace, leak] }, RECORDED);
    expect(snapshot.result.trace.some((e) => e.id === "leak")).toBe(false);
    // An older snapshot that still carries one is cleaned on the way out.
    const sleeps: number[] = [];
    const emitted: TraceEvent[] = [];
    const replayed = await replaySnapshot({ ...snapshot, result: { ...snapshot.result, trace: [...snapshot.result.trace, leak] } }, (e) => emitted.push(e), { sleep: async (ms) => void sleeps.push(ms) });
    expect(emitted.some((e) => e.id === "leak")).toBe(false);
    expect(replayed.trace.some((e) => e.id === "leak")).toBe(false);
    expect(REPLAY_SPACING_MS).toBe(40);
    expect(sleeps.every((ms) => ms <= 40)).toBe(true);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(REPLAY_MAX_MS);
  });

  it("describes the recorded time in UTC", () => {
    expect(describeRecordedAt("2026-11-05T09:14:00Z")).toBe("09:14 UTC on 5 November");
    expect(describeRecordedAt("not a date")).toBe("an earlier time today");
  });
});

describe("snapshot keys", () => {
  it("belong to the deployment that recorded them", async () => {
    const { snapshotPrefix } = await import("@/lib/guard/runtime");
    expect(snapshotPrefix({ VERCEL_DEPLOYMENT_ID: "dpl_abc" })).toBe("reminisce:dpl_abc:");
    expect(snapshotPrefix({})).toBe("reminisce:");
    expect(snapshotKey("michiko", snapshotPrefix({ VERCEL_DEPLOYMENT_ID: "dpl_abc" }))).toBe("reminisce:dpl_abc:preset:michiko:v2");
  });
});
