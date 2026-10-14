import { planSession } from "@/lib/agent";
import { LoopError } from "@/lib/agent/loop";
import { jsonError, ndjsonResponse } from "@/lib/api/stream";
import { looksLikeBot } from "@/lib/guard/botid";
import { openGuard, presetSnapshotFor, rememberPreset } from "@/lib/guard/runtime";
import { replaySnapshot } from "@/lib/guard/snapshots";
import { PlanRequestSchema } from "@/lib/session/schemas";
import type { TraceEvent } from "@/lib/session/types";

export const maxDuration = 60;

/**
 * Builds a session. Streams NDJSON: `{type:"trace"}` events as the agent
 * works, then one `{type:"plan"}` with the result (or `{type:"error"}`).
 * Nothing personal is stored server-side; the only thing kept is a preset's
 * plan for the day, so the next visitor gets it replayed.
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
      send({ type: "plan", result: await replaySnapshot(snapshot, emit) });
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
    await rememberPreset(person, result, guard);
    const notice = guard.notice();
    send({ type: "plan", result: notice ? { ...result, notice } : result });
  });
}
