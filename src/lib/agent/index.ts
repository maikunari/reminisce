/**
 * Entry points for the planning and adaptation agent.
 *
 * Policy selection is a pure environment switch: LLM_MODE=live (or an LLM key)
 * drives the loop with the model; otherwise, or on any LLM failure, the
 * deterministic policy produces the same shape of result through the same
 * tools, so the app works end to end with no keys at all.
 */
import { readServerEnv, type ServerEnv } from "@/lib/env";
import { getQlooClient, type QlooClient } from "@/lib/qloo/client";
import type {
  AdaptResult,
  Card,
  Favorite,
  Person,
  PlanResult,
  Reaction,
  TraceEvent,
} from "@/lib/session/types";
import { ageBucketFor, computeYouthWindow } from "@/lib/session/youth-window";

import { LoopError, runLoop, traceEvent, type Policy } from "./loop";
import { LlmPolicy } from "./policies/llm";
import { PoolPlanPolicy } from "./policies/pool";
import { ScriptedAdaptPolicy, ScriptedPlanPolicy } from "./policies/scripted";
import { EntityPool, PLAN_MIN_CARDS, type ToolContext, type ToolFinal } from "./tools";

export interface AgentOptions {
  emit?: (event: TraceEvent) => void;
  env?: ServerEnv;
  qloo?: QlooClient;
  now?: Date;
  fetchImpl?: typeof fetch;
  /** Notes to record before the first step, e.g. why a cheaper planner was chosen. */
  notes?: string[];
}

/**
 * Total agent time per request. Leaves headroom under the routes' maxDuration
 * of 60 s, and keeps the wait on the planning screen reasonable.
 */
export const AGENT_BUDGET_MS = 45_000;
/** Time held back from the LLM loop so the scripted fallback can still finish (a full live run takes about 6 s). */
export const FALLBACK_RESERVE_MS = 15_000;
/** A commit from the pool makes no Qloo calls; it gets this long past whatever deadline the run had. */
export const POOL_COMMIT_GRACE_MS = 3_000;
/** The fewest cards a session built from a part-finished run may have; fewer, and the caregiver sees the empty state. */
export const POOL_MIN_CARDS = 5;
/**
 * Completions the model may use before the deterministic planner takes over.
 * Each completion re-sends the whole history, so the cap bounds spend roughly
 * quadratically; the prompt asks for parallel tool calls so a plan fits well
 * inside it (searches, tags, insights, commit).
 */
export const LLM_MAX_STEPS = { plan: 12, adapt: 8 } as const;

interface Run {
  final: ToolFinal;
  planner: "llm" | "deterministic";
  ctx: ToolContext;
}

async function runWithFallback(
  makeCtx: (deadline: number) => ToolContext,
  env: ServerEnv,
  emit: (event: TraceEvent) => void,
  fetchImpl: typeof fetch | undefined,
  phase: "plan" | "adapt",
  deadline: number,
): Promise<Run> {
  if (env.llmMode === "live" && env.llmApiKey) {
    const llmDeadline = deadline - FALLBACK_RESERVE_MS;
    const ctx = makeCtx(llmDeadline);
    try {
      const policy: Policy = new LlmPolicy({ env, ctx, fetchImpl, deadline: llmDeadline });
      const { final } = await runLoop({ policy, ctx, emit, maxSteps: LLM_MAX_STEPS[phase] });
      return { final, planner: "llm", ctx };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit(
        traceEvent({
          phase,
          kind: "note",
          summary: `LLM planner unavailable (${message}). Switching to the deterministic planner; same tools, fixed rules.`,
        }),
      );
      // The model usually stops after Qloo has answered: build from those answers
      // rather than asking Qloo the same things again.
      if (phase === "plan") {
        const final = await commitFromPool(ctx, emit, "Qloo has already answered enough; choosing the cards from those results.", PLAN_MIN_CARDS);
        if (final) return { final, planner: "deterministic", ctx };
      }
    }
  }
  const ctx = makeCtx(deadline);
  const policy: Policy = phase === "plan" ? new ScriptedPlanPolicy(ctx) : new ScriptedAdaptPolicy(ctx);
  try {
    const { final } = await runLoop({ policy, ctx, emit, maxSteps: 30 });
    return { final, planner: "deterministic", ctx };
  } catch (error) {
    if (phase !== "plan" || !(error instanceof LoopError)) throw error;
    const final = await commitFromPool(ctx, emit, "Out of time for more Qloo calls; choosing the cards from what came back.", POOL_MIN_CARDS);
    if (final) return { final, planner: "deterministic", ctx };
    throw new LoopError(`Qloo returned too little to build a session (${error.message})`, "empty");
  }
}

/** Commit a plan from the entities this run already fetched, with no new Qloo calls; undefined when there are too few. */
async function commitFromPool(ctx: ToolContext, emit: (event: TraceEvent) => void, narration: string, minCards: number): Promise<ToolFinal | undefined> {
  if (ctx.pool.size < minCards) return undefined;
  const poolCtx: ToolContext = { ...ctx, deadline: Date.now() + POOL_COMMIT_GRACE_MS };
  try {
    const { final } = await runLoop({ policy: new PoolPlanPolicy(poolCtx, narration, minCards), ctx: poolCtx, emit, maxSteps: 2 });
    return final.kind === "plan" ? final : undefined;
  } catch {
    return undefined;
  }
}

function baseContext(
  person: Person,
  qloo: QlooClient,
  now: Date,
  phase: "plan" | "adapt",
  knownCards: Card[] = [],
): Omit<ToolContext, "existingCards" | "feedback" | "deadline"> {
  // Every id the loop may use as a seed must have a name, or the "why" line
  // would print an id prefix: favorites resolved earlier and cards already dealt.
  const names = new Map<string, string>();
  for (const f of person.favorites) if (f.entityId) names.set(f.entityId, f.name);
  for (const c of knownCards) names.set(c.entityId, c.title);
  return {
    qloo,
    person,
    favorites: person.favorites.map((f) => ({ ...f })),
    language: person.language,
    youthWindow: computeYouthWindow(person.birthYear, now),
    ageBucket: ageBucketFor(person.birthYear, now),
    phase,
    pool: new EntityPool(),
    names,
    now,
  };
}

/** Build a full session plan for a person. Streams trace events via `emit`. */
export async function planSession(person: Person, opts: AgentOptions = {}): Promise<PlanResult> {
  const env = opts.env ?? readServerEnv();
  const qloo = opts.qloo ?? getQlooClient();
  const now = opts.now ?? new Date();
  const deadline = Date.now() + AGENT_BUDGET_MS;
  const trace: TraceEvent[] = [];
  const emit = (event: TraceEvent) => {
    trace.push(event);
    opts.emit?.(event);
  };
  for (const note of opts.notes ?? []) emit(traceEvent({ phase: "plan", kind: "note", summary: note }));
  const makeCtx = (deadline: number): ToolContext => ({ ...baseContext(person, qloo, now, "plan"), existingCards: [], deadline });
  const run = await runWithFallback(makeCtx, env, emit, opts.fetchImpl, "plan", deadline);
  if (run.final.kind !== "plan") throw new LoopError("planner committed the wrong kind of result", "no-final");
  return {
    youthWindow: run.ctx.youthWindow,
    ageBucket: run.ctx.ageBucket,
    cards: run.final.cards,
    trace,
    planner: run.planner,
    qlooMode: qloo.mode,
    favorites: run.ctx.favorites,
  };
}

export interface AdaptInput {
  person: Person;
  cards: Card[];
  feedback: { cardId: string; reaction: Reaction };
  currentIndex: number;
}

/** Re-plan upcoming cards after one piece of caregiver feedback. */
export async function adaptSession(input: AdaptInput, opts: AgentOptions = {}): Promise<AdaptResult> {
  const env = opts.env ?? readServerEnv();
  const qloo = opts.qloo ?? getQlooClient();
  const now = opts.now ?? new Date();
  const deadline = Date.now() + AGENT_BUDGET_MS;
  const trace: TraceEvent[] = [];
  const emit = (event: TraceEvent) => {
    trace.push(event);
    opts.emit?.(event);
  };
  const cardIndex = input.cards.findIndex((c) => c.id === input.feedback.cardId);
  const card = input.cards[cardIndex];
  if (!card) throw new Error("feedback card not found in session");
  for (const note of opts.notes ?? []) emit(traceEvent({ phase: "adapt", kind: "note", summary: note }));
  const cards = input.cards.map((c, i) => (i === cardIndex ? { ...c, reaction: input.feedback.reaction } : c));
  const currentIndex = Math.max(input.currentIndex, cardIndex);
  const upcoming = cards.filter((c, i) => i > currentIndex && !c.reaction);
  if (upcoming.length === 0) {
    emit(traceEvent({ phase: "adapt", kind: "note", summary: "No upcoming cards left to re-tune." }));
    return { replacements: [], trace, planner: "deterministic" };
  }
  const makeCtx = (deadline: number): ToolContext => ({
    ...baseContext(input.person, qloo, now, "adapt", cards),
    existingCards: cards,
    deadline,
    feedback: { card: { ...card, reaction: input.feedback.reaction }, reaction: input.feedback.reaction, currentIndex },
  });
  try {
    const run = await runWithFallback(makeCtx, env, emit, opts.fetchImpl, "adapt", deadline);
    if (run.final.kind !== "adapt") throw new LoopError("adapter committed the wrong kind of result", "no-final");
    return { replacements: run.final.replacements, trace, planner: run.planner };
  } catch (error) {
    if (error instanceof LoopError && error.reason === "no-final") {
      // The policy decided nothing should change (for example, Qloo returned nothing new).
      return { replacements: [], trace, planner: "deterministic" };
    }
    throw error;
  }
}

export type { Favorite };
