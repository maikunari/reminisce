/**
 * The model writes each card's prompt after the deck is dealt. These tests
 * drive both transports with recorded and hand-made responses: the Anthropic
 * Messages API (Claude Haiku 4.5, recorded from the real API against the
 * synthetic catalogue) and the OpenAI-compatible chat completions shape.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { adaptPrompts, adaptSession, planPrompts, planSession } from "@/lib/agent";
import { applyPromptUpdate, isAnthropicBaseUrl, LLM_MAX_TOKENS, WRITE_PROMPTS_TOOL, writePrompts } from "@/lib/agent/policies/llm";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import { PRESETS } from "@/lib/session/presets";

const qloo = new QlooClient({ mode: "fixture" });
const NOW = new Date("2026-10-11T00:00:00Z");
const michiko = PRESETS.find((p) => p.id === "michiko")!.person;
const frank = PRESETS.find((p) => p.id === "frank")!.person;
const fixtureEnv = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "fixture" });
const haikuEnv = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "live", LLM_API_KEY: "sk-ant-test", LLM_BASE_URL: "https://api.anthropic.com/v1", LLM_MODEL: "claude-haiku-4-5" });
const openAiEnv = readServerEnv({ QLOO_MODE: "fixture", LLM_MODE: "live", LLM_API_KEY: "test-key", LLM_BASE_URL: "https://llm.example/v1", LLM_MODEL: "some-model" });

const recorded = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "unit", "fixtures", "haiku-write-prompts.json"), "utf8")) as {
  cards: { title: string; domain: string }[];
  response: Record<string, unknown>;
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function respondWith(body: unknown, status = 200) {
  const captured: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    captured.push({ url: String(input), headers, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, captured };
}

function chatCompletion(args: unknown, extra: { content?: string | null; finish_reason?: string; noCall?: boolean } = {}) {
  return {
    choices: [
      {
        finish_reason: extra.finish_reason ?? "tool_calls",
        message: {
          role: "assistant",
          content: extra.content ?? null,
          tool_calls: extra.noCall ? undefined : [{ id: "call_1", type: "function", function: { name: WRITE_PROMPTS_TOOL, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

async function michikoPlan() {
  return planSession(michiko, { env: fixtureEnv, qloo, now: NOW });
}

describe("choosing the transport from LLM_BASE_URL alone", () => {
  it("uses the Messages API for api.anthropic.com and chat completions for anything else", () => {
    expect(isAnthropicBaseUrl("https://api.anthropic.com/v1")).toBe(true);
    expect(isAnthropicBaseUrl("https://api.anthropic.com")).toBe(true);
    expect(isAnthropicBaseUrl("https://api.openai.com/v1")).toBe(false);
    expect(isAnthropicBaseUrl("https://openrouter.ai/api/v1")).toBe(false);
    expect(isAnthropicBaseUrl("not a url")).toBe(false);
  });
});

describe("Claude Haiku 4.5 through the Messages API (recorded response)", () => {
  it("asks for one forced write_prompts call and puts every prompt on its card", async () => {
    const plan = await michikoPlan();
    expect(plan.cards.map((c) => c.title)).toEqual(recorded.cards.map((c) => c.title));
    const { fetchImpl, captured } = respondWith(recorded.response);
    const update = await planPrompts(michiko, plan, { env: haikuEnv, fetchImpl });

    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers["x-api-key"]).toBe("sk-ant-test");
    expect(request.body.model).toBe("claude-haiku-4-5");
    expect(request.body.max_tokens).toBe(LLM_MAX_TOKENS);
    expect(request.body.tool_choice).toEqual({ type: "tool", name: WRITE_PROMPTS_TOOL });
    // Cards go by short refs, never by 36-character ids.
    const user = JSON.stringify(request.body.messages);
    expect(user).toContain("c1 · singer or band · Yujiro Ishihara");
    expect(user).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    expect(update?.prompts).toHaveLength(plan.cards.length);
    const cards = applyPromptUpdate(plan.cards, update!);
    expect(cards.every((c) => c.promptSource === "llm")).toBe(true);
    expect(cards.find((c) => c.title === "Dotonbori")?.prompt).toMatch(/Dotonbori/);
    expect(update!.trace.at(-1)).toMatchObject({ kind: "tool_result", tool: WRITE_PROMPTS_TOOL, policy: "llm" });
    expect(update!.trace.at(-1)?.summary).toMatch(/^The model wrote 9 conversation prompts/);
  });

  it("treats a reply cut off at max_tokens as a failure at once, keeping the templates", async () => {
    const plan = await michikoPlan();
    const { fetchImpl, captured } = respondWith({ ...recorded.response, stop_reason: "max_tokens" });
    const update = await planPrompts(michiko, plan, { env: haikuEnv, fetchImpl });
    expect(captured).toHaveLength(1);
    expect(update?.prompts).toEqual([]);
    expect(update?.trace.at(-1)).toMatchObject({ kind: "note", summary: "Prompts kept from the template set: the model ran out of tokens." });
  });

  it("keeps the templates when the API answers with an error", async () => {
    const plan = await michikoPlan();
    const { fetchImpl } = respondWith({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529);
    const update = await planPrompts(michiko, plan, { env: haikuEnv, fetchImpl });
    expect(update?.prompts).toEqual([]);
    expect(update?.trace.at(-1)?.summary).toMatch(/the model responded 529/);
  });
});

describe("an OpenAI-compatible endpoint", () => {
  it("forces the write_prompts function and maps refs back to cards", async () => {
    const plan = await michikoPlan();
    const { fetchImpl, captured } = respondWith(chatCompletion({ prompts: [{ ref: "c2", prompt: "Did you see Tora-san at the cinema? Who went with you?" }, { ref: "c9", prompt: "Tell me about Chiemi Eri." }] }));
    const update = await planPrompts(michiko, plan, { env: openAiEnv, fetchImpl });
    expect(captured[0]?.url).toBe("https://llm.example/v1/chat/completions");
    expect(captured[0]?.headers.authorization).toBe("Bearer test-key");
    expect(captured[0]?.body.tool_choice).toEqual({ type: "function", function: { name: WRITE_PROMPTS_TOOL } });
    expect(update?.prompts.map((p) => p.cardId)).toEqual([plan.cards[1]!.id, plan.cards[8]!.id]);
    expect(update?.trace.at(-1)?.summary).toMatch(/wrote 2 conversation prompts in [\d.]+ s; 7 kept from the template set$/);
  });

  it("treats finish_reason=length as a failure, with no second request", async () => {
    const plan = await michikoPlan();
    const { fetchImpl, captured } = respondWith(chatCompletion({ prompts: [] }, { finish_reason: "length" }));
    const update = await planPrompts(michiko, plan, { env: openAiEnv, fetchImpl });
    expect(captured).toHaveLength(1);
    expect(update?.prompts).toEqual([]);
    expect(update?.trace.at(-1)?.summary).toBe("Prompts kept from the template set: the model ran out of tokens.");
  });

  it("treats a reply with no tool call as a failure at once, and never shows its leaked markup", async () => {
    const plan = await michikoPlan();
    const leaked = '<｜DSML｜invoke name="write_prompts"><｜DSML｜parameter name="prompts">[{"ref": "c1", "prompt": "Tell me"}]';
    const { fetchImpl, captured } = respondWith(chatCompletion(null, { noCall: true, content: leaked, finish_reason: "stop" }));
    const update = await planPrompts(michiko, plan, { env: openAiEnv, fetchImpl });
    expect(captured).toHaveLength(1);
    expect(update?.prompts).toEqual([]);
    expect(update?.trace.map((e) => e.summary)).toEqual(["Prompts kept from the template set: the model made no tool call."]);
  });

  it("drops prompts that carry markup or ids, and refs it was not given", async () => {
    const plan = await michikoPlan();
    const { fetchImpl } = respondWith(
      chatCompletion({
        prompts: [
          { ref: "c1", prompt: 'Tell me about {"entity_id": "x"}' },
          { ref: "c2", prompt: "Tell me about 368435b1-0000-4000-8000-000000000001, please." },
          { ref: "c3", prompt: "Do you know this place? What was Dotonbori like when you were young?" },
          { ref: "c42", prompt: "Tell me about the card that does not exist." },
        ],
      }),
    );
    const update = await planPrompts(michiko, plan, { env: openAiEnv, fetchImpl });
    expect(update?.prompts.map((p) => p.cardId)).toEqual([plan.cards[2]!.id]);
  });

  it("gives up when its time is spent, without waiting for the model", async () => {
    const plan = await michikoPlan();
    const hanging = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const started = Date.now();
    const update = await writePrompts({ phase: "plan", person: michiko, youthWindow: plan.youthWindow, cards: plan.cards }, { env: openAiEnv, fetchImpl: hanging, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(update.prompts).toEqual([]);
    expect(update.trace.at(-1)?.summary).toMatch(/^Prompts kept from the template set: the model request failed/);
  });
});

describe("when the model is asked", () => {
  it("never, when no model is configured", async () => {
    const plan = await michikoPlan();
    expect(await planPrompts(michiko, plan, { env: fixtureEnv })).toBeUndefined();
    expect(plan.cards.every((c) => c.promptSource === "template")).toBe(true);
  });

  it("only after the deck is dealt from Qloo: planning makes no model call", async () => {
    const { fetchImpl, captured } = respondWith(chatCompletion({ prompts: [] }));
    const plan = await planSession(frank, { env: openAiEnv, qloo, now: NOW, fetchImpl });
    expect(captured).toHaveLength(0);
    expect(plan.planner).toBe("deterministic");
    expect(plan.cards.length).toBeGreaterThanOrEqual(8);
  });

  it("for a re-tune, only for the new cards, and told what lit them up", async () => {
    const plan = await planSession(frank, { env: fixtureEnv, qloo, now: NOW });
    const person = { ...frank, favorites: plan.favorites };
    const liked = plan.cards[0]!;
    const input = { person, cards: plan.cards, feedback: { cardId: liked.id, reaction: "lit_up" as const }, currentIndex: 1 };
    const result = await adaptSession(input, { env: fixtureEnv, qloo, now: NOW });
    expect(result.replacements.length).toBeGreaterThan(0);
    const { fetchImpl, captured } = respondWith(chatCompletion({ prompts: result.replacements.map((_c, i) => ({ ref: `c${i + 1}`, prompt: "Tell me about singing along at home." })) }));
    const update = await adaptPrompts(input, result, { env: openAiEnv, fetchImpl, now: NOW });
    const user = JSON.stringify(captured[0]?.body.messages);
    expect(user).toContain(`They just lit up at \\"${liked.title}\\"`);
    expect(user).not.toContain(`c${result.replacements.length + 1} ·`);
    expect(update?.prompts.map((p) => p.cardId)).toEqual(result.replacements.map((c) => c.id));
  });
});
