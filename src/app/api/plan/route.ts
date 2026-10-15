import { planPrompts, planSession } from "@/lib/agent";
import { LoopError } from "@/lib/agent/loop";
import { applyPromptUpdate, type PromptUpdate } from "@/lib/agent/policies/llm";
import { jsonError, ndjsonResponse } from "@/lib/api/stream";
import { looksLikeBot } from "@/lib/guard/botid";
import { openGuard, presetSnapshotFor, rememberPreset } from "@/lib/guard/runtime";
import { replaySnapshot } from "@/lib/guard/snapshots";
import { PlanRequestSchema } from "@/lib/session/schemas";
import type { PlanResult, StreamEvent, TraceEvent } from "@/lib/session/types";

export const maxDuration = 60;

/** The plan with the model's prompts in place, as it is kept for a preset's replay. */
function withPrompts(result: PlanResult, update: PromptUpdate): PlanResult {
  if (update.prompts.length === 0) return { ...result, trace: [...result.trace, ...update.trace] };
  return { ...result, cards: applyPromptUpdate(result.cards, update), trace: [...result.trace, ...update.trace], planner: "llm" };
}

function sendPrompts(send: (event: StreamEvent) => void, update: PromptUpdate): void {
  send({ type: "prompts", prompts: update.prompts, trace: update.trace });
}

/**
 * Builds a session. Streams NDJSON: `{type:"trace"}` events as the agent
 * works, then one `{type:"plan"}` the moment Qloo's answers make a deck (or
 * `{type:"error"}`), then, when a model is configured, one `{type:"prompts"}`
 * with the model-written prompts for those cards. Nothing personal is stored
 * server-side; the only thing kept is a preset's plan for the day, so the
 * next visitor gets it replayed.
 */
export async function POST(request: Request): Promise<Response> {
  if (await looksLikeBot()) return jsonError(403, "Automated requests are not allowed");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body must be JSON");
  }
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid person", parsed.error.issues);
  const { person } = parsed.data;
  return ndjsonResponse(async (send) => {
    const emit = (event: TraceEvent) => send({ type: "trace", event });
    const snapshot = await presetSnapshotFor(person);
    if (snapshot) {
      const replayed = await replaySnapshot(snapshot, emit);
      send({ type: "plan", result: replayed });
      // A day's first run whose prompts stayed templates gets the model's now, and keeps them for the rest of the day.
      if (replayed.cards.every((c) => c.promptSource === "template")) {
        const guard = await openGuard("plan");
        const update = await planPrompts(person, replayed, { env: guard.env });
        if (update) {
          sendPrompts(send, update);
          if (update.prompts.length > 0) await rememberPreset(person, withPrompts(snapshot.result, update), guard, new Date(snapshot.recordedAt));
        }
      }
      return;
    }
    const guard = await openGuard("plan");
    let result;
    try {
      result = await planSession(person, { env: guard.env, qloo: guard.qloo, notes: guard.notes, emit });
    } catch (error) {
      // Too little came back from Qloo to make a session: the client shows its kind empty state.
      if (error instanceof LoopError && error.reason === "empty") return send({ type: "error", code: "empty", message: error.message });
      throw error;
    }
    const notice = guard.notice();
    if (notice) result = { ...result, notice };
    // Deal now; the model's prompts follow and replace the templates in place.
    send({ type: "plan", result });
    const update = await planPrompts(person, result, { env: guard.env });
    if (update) {
      sendPrompts(send, update);
      result = withPrompts(result, update);
    }
    await rememberPreset(person, result, guard);
  });
}
