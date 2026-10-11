/**
 * Global daily budget and circuit breaker.
 *
 * One counter per kind and UTC day in Redis (`INCR` + `EXPIRE`), shared by
 * every function instance, so the spend of the whole demo is bounded no
 * matter how many visitors there are. Decisions, not errors: a caller asks
 * for a unit and gets back whether it is within today's cap. Once a kind is
 * known to be spent for the day, this process remembers it and stops asking.
 *
 * Fail-safe direction: with no Redis configured there is no budget (every
 * request is allowed). With Redis configured but failing, the cheap path is
 * taken for a short cool-down, because the point of the budget is to protect
 * paid quotas, and a store that cannot answer cannot protect them.
 */
import type { EnvSource } from "@/lib/env";

import type { RedisLike } from "./redis";

export type BudgetKind = "llm:plan" | "llm:adapt" | "qloo";

export type BudgetLimits = Record<BudgetKind, number>;

/** Tuned to a $10 to $20 model credit over three weeks of judging; see the README. */
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  "llm:plan": 40,
  "llm:adapt": 120,
  qloo: 600,
};

export const BUDGET_ENV_NAMES: Record<BudgetKind, string> = {
  "llm:plan": "BUDGET_LLM_PLANS_PER_DAY",
  "llm:adapt": "BUDGET_LLM_ADAPTS_PER_DAY",
  qloo: "BUDGET_QLOO_CALLS_PER_DAY",
};

/** Counters outlive their day by this much so a request straddling midnight still finds its key. */
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

/** An integer sets the cap; "unlimited" removes it; anything else keeps the default. */
export function readBudgetLimits(env: EnvSource = process.env): BudgetLimits {
  const limits = { ...DEFAULT_BUDGET_LIMITS };
  for (const kind of Object.keys(BUDGET_ENV_NAMES) as BudgetKind[]) {
    const raw = (env[BUDGET_ENV_NAMES[kind]] ?? "").trim().toLowerCase();
    if (raw === "unlimited" || raw === "off") limits[kind] = Infinity;
    else if (/^\d+$/.test(raw)) limits[kind] = Number(raw);
  }
  return limits;
}

export interface BudgetDecision {
  kind: BudgetKind;
  allowed: boolean;
  /** Units used today, including the one just taken; 0 when nothing was counted. */
  used: number;
  limit: number;
  reason: "within" | "spent" | "unlimited" | "unconfigured" | "error";
  day: string;
}

export interface Budget {
  /** Take one unit of today's budget for `kind`, if any is left. */
  take(kind: BudgetKind, now?: Date): Promise<BudgetDecision>;
  /** Report today's standing for `kind` without taking a unit. */
  check(kind: BudgetKind, now?: Date): Promise<BudgetDecision>;
}

export interface BudgetOptions {
  redis: RedisLike | null;
  limits?: BudgetLimits;
  keyPrefix?: string;
  /** After a Redis failure, how long every decision is "error" without asking again. */
  errorCooldownMs?: number;
  onError?: (error: unknown) => void;
}

/** UTC calendar day, the unit of every budget. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function budgetCounterKey(kind: BudgetKind, day: string, prefix = "reminisce:"): string {
  return `${prefix}budget:${kind}:${day}`;
}

export function createBudget(opts: BudgetOptions): Budget {
  const limits = opts.limits ?? DEFAULT_BUDGET_LIMITS;
  const prefix = opts.keyPrefix ?? "reminisce:";
  const cooldown = opts.errorCooldownMs ?? 60_000;
  const spentOn = new Map<BudgetKind, string>();
  let errorUntil = 0;

  async function ask(kind: BudgetKind, now: Date, take: boolean): Promise<BudgetDecision> {
    const day = dayKey(now);
    const limit = limits[kind];
    if (!Number.isFinite(limit)) return { kind, allowed: true, used: 0, limit, reason: "unlimited", day };
    if (!opts.redis) return { kind, allowed: true, used: 0, limit, reason: "unconfigured", day };
    if (spentOn.get(kind) === day) return { kind, allowed: false, used: limit, limit, reason: "spent", day };
    if (Date.now() < errorUntil) return { kind, allowed: false, used: 0, limit, reason: "error", day };
    const key = budgetCounterKey(kind, day, prefix);
    try {
      if (take) {
        const [count] = await opts.redis.pipeline([
          ["INCR", key],
          ["EXPIRE", key, COUNTER_TTL_SECONDS],
        ]);
        const used = Number(count ?? 0);
        const allowed = used <= limit;
        if (!allowed) spentOn.set(kind, day);
        return { kind, allowed, used, limit, reason: allowed ? "within" : "spent", day };
      }
      const [count] = await opts.redis.pipeline([["GET", key]]);
      const used = Number(count ?? 0);
      // A check asks whether one more unit would still fit.
      const allowed = used < limit;
      if (!allowed) spentOn.set(kind, day);
      return { kind, allowed, used, limit, reason: allowed ? "within" : "spent", day };
    } catch (error) {
      errorUntil = Date.now() + cooldown;
      opts.onError?.(error);
      return { kind, allowed: false, used: 0, limit, reason: "error", day };
    }
  }

  return {
    take: (kind, now = new Date()) => ask(kind, now, true),
    check: (kind, now = new Date()) => ask(kind, now, false),
  };
}
