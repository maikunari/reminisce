/**
 * The per-request guard: which planner and which Qloo client this request
 * gets, decided from today's budget, plus the words the caregiver sees when
 * the answer is "the cheaper one".
 *
 * The degradation ladder, from the review:
 *   model budget spent  -> deterministic planner, template prompts (labelled in the panel)
 *   Qloo budget spent   -> synthetic catalog for the whole session, with a quiet banner
 *   Qloo call fails     -> synthetic catalog for that call, with a quiet banner
 * Never an error page.
 */
import type { ServerEnv } from "@/lib/env";
import type { QlooClient, QlooError, QlooGuardHooks } from "@/lib/qloo/client";

import type { Budget, BudgetDecision } from "./budget";

export type GuardKind = "plan" | "adapt" | "search";

export interface GuardDeps {
  env: ServerEnv;
  budget: Budget;
  /** Builds the live client with these hooks attached; called at most once per request. */
  liveClient: (hooks: QlooGuardHooks) => QlooClient;
  fixtureClient: () => QlooClient;
  now?: Date;
}

export interface Guard {
  /** The environment the agent should run with; `llmMode` is "fixture" when the model budget is spent. */
  readonly env: ServerEnv;
  readonly qloo: QlooClient;
  /** Trace notes explaining a degraded run, emitted before the agent's first step. */
  readonly notes: string[];
  readonly degraded: { llm: boolean; qloo: boolean };
  /** Live calls answered by the synthetic catalog during this request. */
  readonly fallbacks: { budget: number; error: number };
  /** One caregiver-facing line for the session header when the Qloo side was degraded, else undefined. */
  notice(): string | undefined;
}

/** Statuses that mean "Qloo could not answer right now", worth a quiet fallback rather than an error. */
export function isFallbackWorthy(error: QlooError): boolean {
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export const GUARD_COPY = {
  llmSpent: "Today's allowance of model-written sessions is used up, so the deterministic planner is building this one: the same Qloo calls, with prompts from the template set.",
  llmUnknown: "Reminisce couldn't check today's model allowance, so the deterministic planner is building this session: the same Qloo calls, with prompts from the template set.",
  qlooSpentNote: "Today's allowance of live Qloo calls is used up, so this session is built from the offline catalog.",
  qlooUnknownNote: "Reminisce couldn't check today's Qloo allowance, so this session is built from the offline catalog.",
  qlooSpentBanner: "Reminisce has had a busy day. This session uses the offline catalog; Qloo returns tomorrow.",
  qlooUnknownBanner: "Reminisce couldn't check its daily allowance, so this session uses the offline catalog for now.",
  qlooPartBudget: "Reminisce has had a busy day. Part of this session uses the offline catalog; Qloo returns tomorrow.",
  qlooPartError: "Qloo was briefly unavailable, so part of this session comes from the offline catalog.",
  adaptBudget: "Qloo's daily allowance is used up, so these cards come from the offline catalog.",
  adaptUnknown: "Reminisce couldn't check its daily allowance, so these cards come from the offline catalog for now.",
  adaptError: "Qloo was briefly unavailable, so these cards come from the offline catalog.",
} as const;

export async function createGuard(kind: GuardKind, deps: GuardDeps): Promise<Guard> {
  const now = deps.now ?? new Date();
  const notes: string[] = [];
  const degraded = { llm: false, qloo: false };
  const fallbacks = { budget: 0, error: 0 };
  let env = deps.env;

  if (kind !== "search" && env.llmMode === "live" && env.llmApiKey) {
    const decision = await deps.budget.take(kind === "plan" ? "llm:plan" : "llm:adapt", now);
    if (!decision.allowed) {
      degraded.llm = true;
      env = { ...env, llmMode: "fixture" };
      notes.push(decision.reason === "error" ? GUARD_COPY.llmUnknown : GUARD_COPY.llmSpent);
    }
  }

  let qloo: QlooClient;
  let qlooDecision: BudgetDecision | undefined;
  if (env.qlooMode !== "live") {
    qloo = deps.fixtureClient();
  } else {
    // Plans and adaptations ask up front so a spent day is consistently offline;
    // autocomplete relies on the per-call hook alone.
    qlooDecision = kind === "search" ? undefined : await deps.budget.check("qloo", now);
    if (qlooDecision && !qlooDecision.allowed) {
      degraded.qloo = true;
      qloo = deps.fixtureClient();
      notes.push(qlooDecision.reason === "error" ? GUARD_COPY.qlooUnknownNote : GUARD_COPY.qlooSpentNote);
    } else {
      qloo = deps.liveClient({
        allowLive: async () => (await deps.budget.take("qloo", now)).allowed,
        fallbackOnError: (error) => isFallbackWorthy(error),
        onFallback: (_req, reason) => {
          fallbacks[reason] += 1;
        },
      });
    }
  }

  return {
    env,
    qloo,
    notes,
    degraded,
    fallbacks,
    notice() {
      if (degraded.qloo) {
        const unknown = qlooDecision?.reason === "error";
        if (kind === "adapt") return unknown ? GUARD_COPY.adaptUnknown : GUARD_COPY.adaptBudget;
        return unknown ? GUARD_COPY.qlooUnknownBanner : GUARD_COPY.qlooSpentBanner;
      }
      if (fallbacks.budget > 0) return kind === "adapt" ? GUARD_COPY.adaptBudget : GUARD_COPY.qlooPartBudget;
      if (fallbacks.error > 0) return kind === "adapt" ? GUARD_COPY.adaptError : GUARD_COPY.qlooPartError;
      return undefined;
    },
  };
}
