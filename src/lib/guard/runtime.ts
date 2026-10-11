/**
 * Production wiring for the guard: one Redis client, one budget and one
 * response cache per process, read from the environment. Route handlers
 * import this; everything else takes its dependencies as arguments.
 */
import { readServerEnv, type ServerEnv } from "@/lib/env";
import { QlooClient, type QlooGuardHooks } from "@/lib/qloo/client";
import { createNextQlooCache } from "@/lib/qloo/next-cache";
import type { Person, PlanResult } from "@/lib/session/types";

import { createBudget, readBudgetLimits, type Budget } from "./budget";
import { createGuard, type Guard, type GuardKind } from "./index";
import { redisFromEnv, type UpstashRedis } from "./redis";
import { loadSnapshot, matchingPreset, storeSnapshot, type PresetSnapshot } from "./snapshots";

interface Runtime {
  redis: UpstashRedis | null;
  budget: Budget;
  cache: ReturnType<typeof createNextQlooCache>;
  fixture: QlooClient;
}

let runtime: Runtime | null = null;

function getRuntime(): Runtime {
  if (runtime) return runtime;
  const redis = redisFromEnv();
  runtime = {
    redis,
    budget: createBudget({
      redis,
      limits: readBudgetLimits(),
      onError: (error) => console.error("[budget] Redis unavailable; taking the cheap path", error),
    }),
    cache: createNextQlooCache(),
    fixture: new QlooClient({ mode: "fixture" }),
  };
  return runtime;
}

/** Test hook. */
export function resetGuardRuntime(): void {
  runtime = null;
}

export function openGuard(kind: GuardKind, env: ServerEnv = readServerEnv()): Promise<Guard> {
  const rt = getRuntime();
  return createGuard(kind, {
    env,
    budget: rt.budget,
    liveClient: (hooks: QlooGuardHooks) => new QlooClient({ mode: "live", apiKey: env.qlooApiKey, baseUrl: env.qlooBaseUrl, cache: rt.cache, guard: hooks }),
    fixtureClient: () => rt.fixture,
  });
}

/** Today's snapshot for this person, when they are a preset and Qloo is configured live. */
export async function presetSnapshotFor(person: Person, env: ServerEnv = readServerEnv(), now = new Date()): Promise<PresetSnapshot | null> {
  const rt = getRuntime();
  if (!rt.redis || env.qlooMode !== "live") return null;
  const preset = matchingPreset(person);
  if (!preset) return null;
  return loadSnapshot(rt.redis, preset.id, now);
}

/**
 * Keep a preset's plan for the rest of the day, but only a full-strength one:
 * a run that was degraded or fell back would be replayed all day otherwise.
 */
export async function rememberPreset(person: Person, result: PlanResult, guard: Guard, now = new Date()): Promise<boolean> {
  const rt = getRuntime();
  if (!rt.redis || guard.env.qlooMode !== "live" || guard.degraded.llm || guard.degraded.qloo) return false;
  if (guard.fallbacks.budget > 0 || guard.fallbacks.error > 0 || result.cards.length < 8) return false;
  const preset = matchingPreset(person);
  if (!preset) return false;
  try {
    await storeSnapshot(rt.redis, preset.id, result, now);
    return true;
  } catch (error) {
    console.error("[snapshots] could not store preset snapshot", error);
    return false;
  }
}
