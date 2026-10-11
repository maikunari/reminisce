import { describe, expect, it } from "vitest";

import { readServerEnv, resolveLlmMode, resolveQlooMode } from "@/lib/env";
import { QlooClient, QlooError } from "@/lib/qloo/client";

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

describe("environment switches", () => {
  it("auto-selects live only when a key is present, and honours explicit modes", () => {
    expect(resolveQlooMode({})).toBe("fixture");
    expect(resolveQlooMode({ QLOO_API_KEY: "k" })).toBe("live");
    expect(resolveQlooMode({ QLOO_API_KEY: "k", QLOO_MODE: "fixture" })).toBe("fixture");
    expect(resolveLlmMode({ LLM_API_KEY: "k" })).toBe("live");
    expect(resolveLlmMode({ LLM_MODE: "fixture", LLM_API_KEY: "k" })).toBe("fixture");
    const env = readServerEnv({ QLOO_API_KEY: "k", LLM_BASE_URL: "https://example.com/v1/" });
    expect(env.qlooBaseUrl).toBe("https://hackathon.api.qloo.com");
    expect(env.llmBaseUrl).toBe("https://example.com/v1");
  });
});

describe("QlooClient live mode", () => {
  it("requires a key", () => {
    expect(() => new QlooClient({ mode: "live" })).toThrow(/QLOO_API_KEY/);
  });

  it("calls the hackathon host with the X-Api-Key header and documented params", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const client = new QlooClient({
      mode: "live",
      apiKey: "secret",
      fetchImpl: mockFetch((url, init) => {
        calls.push({ url, headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})) });
        return { status: 200, body: { success: true, results: { entities: [{ name: "X", entity_id: "1", type: "urn:entity", subtype: "urn:entity:artist", query: { affinity: 0.5 } }] } } };
      }),
    });
    const res = await client.insights({ type: "urn:entity:artist", signals: { entities: ["abc"], locationQuery: "Osaka" }, take: 3 });
    expect(res.source).toBe("live");
    expect(res.body.results.entities[0]?.name).toBe("X");
    expect(calls[0]?.url).toBe("https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Aartist&signal.interests.entities=abc&signal.location.query=Osaka&take=3");
    expect(calls[0]?.headers["X-Api-Key"]).toBe("secret");
  });

  it("treats a 404 from /search as no results and other errors as QlooError", async () => {
    const client = new QlooClient({
      mode: "live",
      apiKey: "secret",
      fetchImpl: mockFetch((url) => (url.includes("/search") ? { status: 404, body: { error: "No results" } } : { status: 403, body: { error: "forbidden" } })),
    });
    const search = await client.search("nothing");
    expect(search.body.results).toEqual([]);
    await expect(client.insights({ type: "urn:entity:video_game" })).rejects.toBeInstanceOf(QlooError);
  });
});

describe("QlooClient deadline", () => {
  const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;

  it("cuts a request started near the deadline short instead of waiting the default timeout", async () => {
    const client = new QlooClient({ mode: "live", apiKey: "secret", fetchImpl: hangingFetch, timeoutMs: 15_000 });
    const started = Date.now();
    await expect(client.insights({ type: "urn:entity:artist" }, { deadline: started + 80 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not start a request once the deadline has passed", async () => {
    let called = false;
    const client = new QlooClient({
      mode: "live",
      apiKey: "secret",
      fetchImpl: (() => {
        called = true;
        return hangingFetch("");
      }) as unknown as typeof fetch,
    });
    await expect(client.search("Sinatra", { deadline: Date.now() - 1 })).rejects.toBeInstanceOf(QlooError);
    expect(called).toBe(false);
  });

  it("leaves fixture mode unaffected by an elapsed deadline", async () => {
    const client = new QlooClient({ mode: "fixture" });
    const res = await client.insights({ type: "urn:entity:artist", take: 1 }, { deadline: Date.now() - 1 });
    expect(res.source).toBe("synthetic");
  });
});

describe("QlooClient fixture mode", () => {
  it("is a pure switch: same calls, synthetic source, no network", async () => {
    const client = new QlooClient({ mode: "fixture", fetchImpl: (() => { throw new Error("network used"); }) as unknown as typeof fetch });
    const res = await client.insights({ type: "urn:entity:artist", signals: { locationQuery: "Chicago" }, take: 2 });
    expect(res.source).toBe("synthetic");
    expect(res.body.results.entities).toHaveLength(2);
    expect(res.request.path).toBe("/v2/insights");
  });
});
