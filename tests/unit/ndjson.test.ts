import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpError, isBlocked, postNdjson } from "@/lib/client/ndjson";

afterEach(() => vi.unstubAllGlobals());

describe("postNdjson errors", () => {
  it("throws an HttpError carrying the status and the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Automated requests are not allowed" }), { status: 403 })));
    const error = await postNdjson("/api/plan", {}, () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
    expect(isBlocked(error)).toBe(true);
  });
  it("does not treat other failures as a bot block", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const error = await postNdjson("/api/plan", {}, () => {}).catch((e: unknown) => e);
    expect((error as Error).message).toBe("Request failed (500)");
    expect(isBlocked(error)).toBe(false);
    expect(isBlocked(new Error("x"))).toBe(false);
  });
});
