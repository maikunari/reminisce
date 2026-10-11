/**
 * A small tool-calling loop. A Policy decides the next tool calls (an LLM, or
 * the deterministic planner); the loop executes them, records a trace, and
 * stops when plan_session / adapt_session commits a result.
 */
import type { TraceEvent } from "@/lib/session/types";

import { executeTool, isToolName, type ToolContext, type ToolFinal, type ToolName, type ToolOutcome } from "./tools";

export interface ToolCall {
  id: string;
  name: ToolName;
  args: unknown;
}

export interface PolicyStep {
  /** Free-text thinking to show in the trace. */
  narration?: string;
  toolCalls?: ToolCall[];
  /** The policy has nothing more to do. */
  done?: boolean;
}

export interface Policy {
  readonly kind: "llm" | "deterministic";
  next(): Promise<PolicyStep>;
  observe(call: ToolCall, outcome: ToolOutcome): void;
}

export interface LoopOptions {
  policy: Policy;
  ctx: ToolContext;
  emit: (event: TraceEvent) => void;
  maxSteps?: number;
}

export class LoopError extends Error {
  constructor(
    message: string,
    readonly reason: "no-final" | "max-steps" | "budget" | "policy",
  ) {
    super(message);
    this.name = "LoopError";
  }
}

let counter = 0;
export function traceEvent(partial: Omit<TraceEvent, "id" | "at">): TraceEvent {
  counter += 1;
  return { id: `t${Date.now().toString(36)}${counter}`, at: Date.now(), ...partial };
}

function summariseArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return undefined;
  return args as Record<string, unknown>;
}

export async function runLoop(opts: LoopOptions): Promise<{ final: ToolFinal; steps: number }> {
  const { policy, ctx } = opts;
  const { deadline } = ctx;
  const tag = policy.kind === "llm" ? "llm" : "scripted";
  const emit = (event: TraceEvent) => opts.emit({ ...event, policy: tag });
  const maxSteps = opts.maxSteps ?? 24;
  let steps = 0;
  let final: ToolFinal | undefined;

  while (steps < maxSteps) {
    if (Date.now() > deadline) throw new LoopError("agent budget exceeded", "budget");
    steps += 1;
    const step = await policy.next();
    if (step.narration) {
      emit(traceEvent({ phase: ctx.phase, kind: "narration", summary: step.narration }));
    }
    for (const call of step.toolCalls ?? []) {
      if (!isToolName(call.name)) {
        const outcome: ToolOutcome = {
          ok: false,
          result: { ok: false, error: `unknown tool ${call.name}` },
          summary: `unknown tool ${call.name}`,
        };
        emit(traceEvent({ phase: ctx.phase, kind: "error", tool: call.name, summary: outcome.summary }));
        policy.observe(call, outcome);
        continue;
      }
      if (Date.now() > deadline) throw new LoopError("agent budget exceeded", "budget");
      emit(traceEvent({ phase: ctx.phase, kind: "tool_call", tool: call.name, args: summariseArgs(call.args), summary: describeCall(call) }));
      let outcome: ToolOutcome;
      try {
        outcome = await executeTool(call.name, call.args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome = { ok: false, result: { ok: false, error: message }, summary: `${call.name} failed: ${message}` };
      }
      emit(
        traceEvent({
          phase: ctx.phase,
          kind: outcome.ok ? "tool_result" : "error",
          tool: call.name,
          summary: outcome.summary,
          qloo: outcome.qloo,
        }),
      );
      policy.observe(call, outcome);
      if (outcome.final) final = outcome.final;
    }
    if (final) return { final, steps };
    if (step.done) break;
  }
  if (steps >= maxSteps) throw new LoopError(`agent stopped after ${maxSteps} steps without committing`, "max-steps");
  throw new LoopError("agent finished without committing a session", "no-final");
}

const TYPE_WORD: Record<string, string> = {
  "urn:entity:artist": "artists",
  "urn:entity:movie": "films",
  "urn:entity:tv_show": "television shows",
  "urn:entity:place": "places",
  "urn:entity:destination": "destinations",
  "urn:entity:locality": "cities",
  "urn:entity:book": "books",
  "urn:entity:person": "people",
  "urn:entity:brand": "brands",
  "urn:entity:podcast": "podcasts",
  "urn:entity:video_game": "video games",
};

const AGE_WORD: Record<string, string> = {
  "24_and_younger": "24 and younger",
  "25_to_29": "25 to 29",
  "30_to_34": "30 to 34",
  "35_to_44": "35 to 44",
  "45_to_54": "45 to 54",
  "55_and_older": "55 and older",
};

function typeWord(type: unknown): string {
  const key = String(type ?? "");
  return TYPE_WORD[key] ?? key.replace("urn:entity:", "").replace(/_/g, " ");
}

/** One readable line per tool call for the trace; no URNs, no parameter names. */
function describeCall(call: ToolCall): string {
  const a = (call.args ?? {}) as Record<string, unknown>;
  switch (call.name) {
    case "qloo_search_entity": {
      const types = Array.isArray(a.types) ? a.types.map(typeWord).join(", ") : "";
      return `Searching Qloo for "${String(a.query ?? "")}"${types ? ` among ${types}` : ""}`;
    }
    case "qloo_search_tags":
      return `Searching Qloo tags for "${String(a.query ?? "")}"${a.parent_type ? ` on ${typeWord(a.parent_type)}` : ""}`;
    case "qloo_insights": {
      const bits: string[] = [];
      if (Array.isArray(a.signal_entities) && a.signal_entities.length > 0) bits.push(`${a.signal_entities.length} seed${a.signal_entities.length === 1 ? "" : "s"}`);
      if (a.signal_location_query) bits.push(`tuned to ${String(a.signal_location_query)}`);
      if (a.filter_location_query) bits.push(`in ${String(a.filter_location_query)}`);
      if (a.release_year_min || a.release_year_max) bits.push(`${String(a.release_year_min ?? "")} to ${String(a.release_year_max ?? "")}`);
      if (a.signal_age) bits.push(`for people ${AGE_WORD[String(a.signal_age)] ?? String(a.signal_age).replace(/_/g, " ")}`);
      return `Asking Qloo Insights for ${typeWord(a.filter_type)}${bits.length > 0 ? `: ${bits.join(", ")}` : ""}`;
    }
    case "plan_session":
      return `Committing ${Array.isArray(a.cards) ? a.cards.length : 0} cards`;
    case "adapt_session":
      return `Replacing ${Array.isArray(a.replacements) ? a.replacements.length : 0} upcoming card${Array.isArray(a.replacements) && a.replacements.length === 1 ? "" : "s"}`;
    default:
      return call.name;
  }
}

export function newCallId(): string {
  counter += 1;
  return `call_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
