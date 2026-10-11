/**
 * NDJSON streaming helpers shared by the plan and adapt routes. The agent's
 * trace events stream to the browser as they happen, then the final result.
 */
import type { StreamEvent } from "@/lib/session/types";

export function ndjsonResponse(run: (send: (event: StreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await run(send);
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Unexpected error" });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function jsonError(status: number, message: string, details?: unknown): Response {
  return Response.json({ error: message, details }, { status });
}
