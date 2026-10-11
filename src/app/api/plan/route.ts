import { planSession } from "@/lib/agent";
import { jsonError, ndjsonResponse } from "@/lib/api/stream";
import { PlanRequestSchema } from "@/lib/session/schemas";

export const maxDuration = 60;

/**
 * Builds a session. Streams NDJSON: `{type:"trace"}` events as the agent
 * works, then one `{type:"plan"}` with the result (or `{type:"error"}`).
 * Nothing is stored server-side.
 */
export async function POST(request: Request): Promise<Response> {
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
    const result = await planSession(person, { emit: (event) => send({ type: "trace", event }) });
    send({ type: "plan", result });
  });
}
