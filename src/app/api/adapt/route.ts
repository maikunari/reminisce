import { adaptSession } from "@/lib/agent";
import { jsonError, ndjsonResponse } from "@/lib/api/stream";
import { AdaptRequestSchema } from "@/lib/session/schemas";
import type { Card } from "@/lib/session/types";

export const maxDuration = 60;

/**
 * Re-tunes upcoming cards after one reaction. Streams NDJSON trace events,
 * then `{type:"adapt"}` with the replacements.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body must be JSON");
  }
  const parsed = AdaptRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid adapt request", parsed.error.issues);
  const { person, cards, feedback, currentIndex } = parsed.data;
  return ndjsonResponse(async (send) => {
    const result = await adaptSession(
      { person, cards: cards as unknown as Card[], feedback, currentIndex },
      { emit: (event) => send({ type: "trace", event }) },
    );
    send({ type: "adapt", result });
  });
}
