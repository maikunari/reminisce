/**
 * OpenAI-compatible tool-calling policy. Works with any provider that speaks
 * POST {LLM_BASE_URL}/chat/completions with `tools` (OpenAI, OpenRouter,
 * Groq, Together, Ollama, vLLM...).
 */
import type { ServerEnv } from "@/lib/env";
import { DOMAIN_INFO, DOMAINS, LANGUAGES } from "@/lib/session/types";

import type { Policy, PolicyStep, ToolCall } from "../loop";
import { TOOL_DEFINITIONS, type ToolContext, type ToolName, type ToolOutcome } from "../tools";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  error?: { message?: string };
}

export interface LlmPolicyOptions {
  env: ServerEnv;
  ctx: ToolContext;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Epoch-ms deadline; each request's timeout is capped by the time left. */
  deadline?: number;
  temperature?: number;
}

function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? "English";
}

export function buildSystemPrompt(): string {
  const domains = DOMAINS.map((d) => `${d} (${DOMAIN_INFO[d].qlooType})`).join(", ");
  return [
    "You are Reminisce, an agent that builds a 20-minute reminiscence session for a person living with dementia, for a caregiver to lead.",
    "You must use the Qloo taste graph through the tools provided; never invent entities or ids.",
    "",
    "Procedure for planning:",
    "1. Resolve each favorite with qloo_search_entity, and the hometown with qloo_search_entity using types [\"urn:entity:locality\"].",
    "2. Use qloo_search_tags before any filter_tags (for example a restaurant tag for dining, a landmark tag for places).",
    "3. Call qloo_insights for at least four of: urn:entity:artist, urn:entity:movie, urn:entity:tv_show, urn:entity:place (dining: filter_location_query = hometown plus a restaurant tag), urn:entity:place (landmarks: filter_location_query = hometown), urn:entity:destination.",
    "   Always pass signal_entities (the resolved favorites), signal_location_query (the hometown) and signal_age. For movie and tv_show also pass release_year_min/max from the youth window.",
    "4. Finish by calling plan_session with 8 to 10 cards across at least 3 domains, highest affinity first, mixing domains so consecutive cards differ.",
    `   Domains: ${domains}.`,
    "",
    "Procedure for adapting after feedback:",
    "- If the person lit up: call qloo_insights again for the same domain AND one other domain with the liked entity added to signal_entities, excluding entities already in the session, then call adapt_session to replace up to 3 upcoming cards.",
    "- If a card did not land: call qloo_insights for a different domain, excluding that entity, then adapt_session to replace the next cards of the disliked domain.",
    "",
    "Conversation prompts: write each card's prompt in the person's language, warm and unhurried, one open question of at most 25 words that invites a story (\"Tell me about...\"). Never quiz or test memory, never mention dementia.",
    "Keep any narration to one short sentence per step. Only ids returned by qloo_insights in this run may be used in plan_session or adapt_session.",
  ].join("\n");
}

export function buildUserPrompt(ctx: ToolContext): string {
  const p = ctx.person;
  const lines = [
    `Person: ${p.name}, born ${p.birthYear}, grew up in ${p.hometown}.`,
    `Favorites: ${p.favorites.map((f) => (f.entityId ? `${f.name} (id ${f.entityId})` : f.name)).join("; ") || "none given"}.`,
    `Youth window (ages ${ctx.youthWindow.ageFrom} to ${ctx.youthWindow.ageTo}): ${ctx.youthWindow.start} to ${ctx.youthWindow.end}.`,
    `Age bucket today: ${ctx.ageBucket}. Prompt language: ${languageName(ctx.language)}.`,
  ];
  if (ctx.phase === "adapt" && ctx.feedback) {
    const fb = ctx.feedback;
    lines.push(
      "",
      `Feedback: card "${fb.card.title}" (${fb.card.domain}, id ${fb.card.entityId}) -> ${fb.reaction === "lit_up" ? "they lit up" : "not this one"}.`,
      `Current card index: ${fb.currentIndex}. Session cards in order:`,
      ...ctx.existingCards.map(
        (c, i) => `${i}. [${c.domain}] ${c.title} (id ${c.entityId})${c.reaction ? ` reaction=${c.reaction}` : ""}${i > fb.currentIndex && !c.reaction ? " upcoming" : ""}`,
      ),
      "Re-tune the upcoming cards now.",
    );
  } else {
    lines.push("", "Plan the session now.");
  }
  return lines.join("\n");
}

export class LlmPolicy implements Policy {
  readonly kind = "llm" as const;
  private readonly messages: ChatMessage[];
  private nudges = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: LlmPolicyOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.messages = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(opts.ctx) },
    ];
  }

  async next(): Promise<PolicyStep> {
    const message = await this.complete();
    this.messages.push(message);
    const calls = (message.tool_calls ?? []).map<ToolCall>((tc) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: tc.function.name as ToolName,
      args: parseArgs(tc.function.arguments),
    }));
    const narration = message.content?.trim() || undefined;
    if (calls.length > 0) return { narration, toolCalls: calls };
    this.nudges += 1;
    if (this.nudges > 2) return { narration, done: true };
    this.messages.push({
      role: "user",
      content:
        this.opts.ctx.phase === "adapt"
          ? "Continue by calling a tool. Finish with adapt_session."
          : "Continue by calling a tool. Finish with plan_session.",
    });
    return { narration, toolCalls: [] };
  }

  observe(call: ToolCall, outcome: ToolOutcome): void {
    let content = JSON.stringify(outcome.result);
    if (content.length > 16_000) content = `${content.slice(0, 16_000)}…(truncated)`;
    this.messages.push({ role: "tool", tool_call_id: call.id, content });
  }

  private async complete(): Promise<ChatMessage> {
    const { env, deadline } = this.opts;
    const timeoutMs = deadline === undefined ? this.timeoutMs : Math.min(this.timeoutMs, deadline - Date.now());
    if (timeoutMs <= 0) throw new LlmError("LLM time budget exhausted");
    let response: Response;
    try {
      response = await this.fetchImpl(`${env.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.llmApiKey}`,
        },
        body: JSON.stringify({
          model: env.llmModel,
          messages: this.messages,
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
          temperature: this.opts.temperature ?? 0.4,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new LlmError(`LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let data: ChatResponse;
    try {
      data = JSON.parse(text) as ChatResponse;
    } catch {
      throw new LlmError(`LLM returned non-JSON (${response.status})`, response.status);
    }
    if (!response.ok) {
      throw new LlmError(`LLM responded ${response.status}: ${data.error?.message ?? text.slice(0, 200)}`, response.status);
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new LlmError("LLM response had no choices");
    return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls };
  }
}

function parseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __parse_error: `could not parse arguments: ${raw.slice(0, 120)}` };
  }
}
