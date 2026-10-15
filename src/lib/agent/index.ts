/**
 * Entry points for the planning and adaptation agent.
 *
 * Qloo is asked first, by fixed rules that make every domain's call at once,
 * and the deck is dealt with template prompts as soon as the answers are in.
 * The model, when one is configured (LLM_MODE=live or an LLM key), then
 * writes each card's prompt and the new prompts replace the templates in
 * place, so the model is never on the caregiver's critical path and a model
 * failure costs nothing visible. With no keys at all the app works end to end.
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
import { writePrompts, type PromptUpdate } from "./policies/llm";
import { PoolPlanPolicy } from "./policies/pool";
import { ScriptedAdaptPolicy, ScriptedPlanPolicy } from "./policies/scripted";
import { EntityPool, type ToolContext, type ToolFinal } from "./tools";

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
 * Time for the Qloo part of a request. A full live run takes about 2 s; the
 * rest is headroom for a slow Qloo, and with the model's prompt time after it
 * the whole request stays under the routes' maxDuration of 60 s.
 */
export const AGENT_BUDGET_MS = 40_000;
/** A commit from the pool makes no Qloo calls; it gets this long past whatever deadline the run had. */
export const POOL_COMMIT_GRACE_MS = 3_000;
/** The fewest cards a session built from a part-finished run may have; fewer, and the caregiver sees the empty state. */
export const POOL_MIN_CARDS = 5;

interface Run {
  final: ToolFinal;
  ctx: ToolContext;
}

async function runScripted(makeCtx: (deadline: number) => ToolContext, emit: (event: TraceEvent) => void, phase: "plan" | "adapt", deadline: number): Promise<Run> {
  const ctx = makeCtx(deadline);
  const policy: Policy = phase === "plan" ? new ScriptedPlanPolicy(ctx) : new ScriptedAdaptPolicy(ctx);
  try {
    const { final } = await runLoop({ policy, ctx, emit, maxSteps: 30 });
    return { final, ctx };
  } catch (error) {
    if (phase !== "plan" || !(error instanceof LoopError)) throw error;
    const final = await commitFromPool(ctx, emit, "Out of time for more Qloo calls; choosing the cards from what came back.", POOL_MIN_CARDS);
    if (final) return { final, ctx };
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

/** Whether a model is configured to write prompts. */
export function modelConfigured(env: ServerEnv): boolean {
  return env.llmMode === "live" && Boolean(env.llmApiKey);
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
  const run = await runScripted(makeCtx, emit, "plan", deadline);
  if (run.final.kind !== "plan") throw new LoopError("planner committed the wrong kind of result", "no-final");
  return {
    youthWindow: run.ctx.youthWindow,
    ageBucket: run.ctx.ageBucket,
    cards: run.final.cards,
    trace,
    planner: "deterministic",
    qlooMode: qloo.mode,
    favorites: run.ctx.favorites,
  };
}

/**
 * The model's prompts for a dealt plan, or undefined when no model is
 * configured. Never throws; a failed attempt comes back with no prompts and a
 * trace note.
 */
export async function planPrompts(person: Person, plan: Pick<PlanResult, "cards" | "youthWindow">, opts: Pick<AgentOptions, "env" | "fetchImpl"> = {}): Promise<PromptUpdate | undefined> {
  const env = opts.env ?? readServerEnv();
  if (!modelConfigured(env)) return undefined;
  return writePrompts({ phase: "plan", person, youthWindow: plan.youthWindow, cards: plan.cards }, { env, fetchImpl: opts.fetchImpl });
}

export interface AdaptInput {
  person: Person;
  cards: Card[];
  feedback: { cardId: string; reaction: Reaction };
  currentIndex: number;
}

/** Re-plan upcoming cards after one piece of caregiver feedback. */
export async function adaptSession(input: AdaptInput, opts: AgentOptions = {}): Promise<AdaptResult> {
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
  // The plan's films and shows carry the home country it found; re-tunes keep to it.
  const homeCountry = cards.map((c) => c.signals.params["filter.release_country"]?.split(",")[0]).find((c): c is string => !!c);
  const makeCtx = (deadline: number): ToolContext => ({
    ...baseContext(input.person, qloo, now, "adapt", cards),
    homeCountry,
    existingCards: cards,
    deadline,
    feedback: { card: { ...card, reaction: input.feedback.reaction }, reaction: input.feedback.reaction, currentIndex },
  });
  try {
    const run = await runScripted(makeCtx, emit, "adapt", deadline);
    if (run.final.kind !== "adapt") throw new LoopError("adapter committed the wrong kind of result", "no-final");
    return { replacements: run.final.replacements, trace, planner: "deterministic" };
  } catch (error) {
    if (error instanceof LoopError && error.reason === "no-final") {
      // The policy decided nothing should change (for example, Qloo returned nothing new).
      return { replacements: [], trace, planner: "deterministic" };
    }
    throw error;
  }
}

/** The model's prompts for a re-tune's new cards, or undefined when no model is configured. */
export async function adaptPrompts(
  input: Pick<AdaptInput, "person" | "cards" | "feedback">,
  result: Pick<AdaptResult, "replacements">,
  opts: Pick<AgentOptions, "env" | "fetchImpl" | "now"> = {},
): Promise<PromptUpdate | undefined> {
  const env = opts.env ?? readServerEnv();
  if (!modelConfigured(env) || result.replacements.length === 0) return undefined;
  const card = input.cards.find((c) => c.id === input.feedback.cardId);
  return writePrompts(
    {
      phase: "adapt",
      person: input.person,
      youthWindow: computeYouthWindow(input.person.birthYear, opts.now ?? new Date()),
      cards: result.replacements,
      feedback: card ? { title: card.title, reaction: input.feedback.reaction } : undefined,
    },
    { env, fetchImpl: opts.fetchImpl },
  );
}

export type { Favorite };
