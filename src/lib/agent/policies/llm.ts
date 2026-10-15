/**
 * The model's part of a session: writing each card's conversation prompt.
 *
 * Qloo chooses the cards and the deck is dealt with template prompts the
 * moment its answers are in; this runs afterwards, off the caregiver's
 * critical path, and its prompts replace the templates in place. One
 * completion with one forced tool call: a reply that runs out of tokens or
 * makes no tool call is a failure at once, and a failure costs nothing
 * visible because the template prompts are already on the cards.
 *
 * Two transports, chosen by LLM_BASE_URL alone:
 * - api.anthropic.com: the Messages API through the official SDK (Claude Haiku 4.5);
 * - anything else: POST {LLM_BASE_URL}/chat/completions, the OpenAI-compatible
 *   shape most providers speak.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ServerEnv } from "@/lib/env";
import { cleanNarration, hasMarkup } from "@/lib/session/narration";
import { LANGUAGES, type Card, type Domain, type Person, type Reaction, type TraceEvent, type YouthWindow } from "@/lib/session/types";

import { traceEvent } from "../loop";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Output cap per completion. Ten prompts of at most 25 words each are about
 * 600 tokens of tool input; the cap bounds a runaway completion, not the work.
 */
export const LLM_MAX_TOKENS = 1500;

/** How long the model may take: a plan's nine prompts, or a re-tune's one to three. */
export const PROMPT_TIMEOUT_MS = { plan: 15_000, adapt: 8_000 } as const;

export const WRITE_PROMPTS_TOOL = "write_prompts";

export const WritePromptsArgs = z.object({
  prompts: z
    .array(
      z.object({
        ref: z.string().describe("The card's ref from the list, e.g. c1."),
        prompt: z.string().describe("The conversation prompt for that card, in the person's language. One open question, at most 25 words."),
      }),
    )
    .max(14),
});

function inputSchema(): Record<string, unknown> {
  const out = z.toJSONSchema(WritePromptsArgs, { target: "draft-7" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

const TOOL_DESCRIPTION = "Give every card in the list its conversation prompt. Call once, with one entry per card ref.";

export interface PromptRequest {
  phase: "plan" | "adapt";
  person: Person;
  youthWindow: YouthWindow;
  /** The cards to write for; each gets a short ref (c1, c2...) in the request instead of its id. */
  cards: Card[];
  /** Re-tunes: the reaction that brought these cards in. */
  feedback?: { title: string; reaction: Reaction };
}

export interface PromptUpdate {
  prompts: { cardId: string; prompt: string }[];
  /** What happened, for the Why Qloo timeline; also says so when the templates were kept. */
  trace: TraceEvent[];
}

export interface PromptWriterOptions {
  env: ServerEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Epoch-ms deadline; the request's timeout is capped by the time left. */
  deadline?: number;
}

function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? "English";
}

export function buildSystemPrompt(): string {
  return [
    "You write the conversation prompts for Reminisce, a 20-minute reminiscence session that a caregiver leads with a person living with dementia.",
    "Each card is something Qloo's taste graph chose from the person's youth: a singer or band, a film, a television show, a place to eat, a place in their hometown, or a trip.",
    `Call ${WRITE_PROMPTS_TOOL} once with a prompt for every card ref you are given.`,
    "",
    "Each prompt: in the language named below, warm and unhurried, one open question of at most 25 words that invites a story (\"Tell me about...\", \"Did you ever...\"). Never quiz or test memory (no \"Do you remember...?\" or \"Did you know...?\"), and never mention dementia, illness or age.",
    "Facts: use only what a card tells you. Name a year or a decade only when the card gives it, and never say an artist was popular in a decade the card does not give.",
    "A place to eat or a place in the hometown may be newer than the person's youth: never say they went there back then. Ask whether they know it, and about the hometown or that kind of place when they were young.",
    "Use each card's title exactly as it is written, in the same script: never translate it or swap in another title you think it means.",
    "Call an artist by name rather than he, she or they.",
  ].join("\n");
}

const DOMAIN_WORD: Record<Domain, string> = {
  music: "singer or band",
  film: "film",
  tv: "television show",
  dining: "place to eat",
  place: "place in the hometown",
  destination: "trip",
};

function cardLine(card: Card, index: number): string {
  const bits = [`c${index + 1}`, DOMAIN_WORD[card.domain], card.title];
  if (card.domain === "music" && card.startYear) bits.push(`performing since ${card.startYear}`);
  if ((card.domain === "film" || card.domain === "tv") && card.year) bits.push(`released ${card.year}`);
  if (card.subtitle) bits.push(card.subtitle);
  if (card.description) bits.push(card.description.slice(0, 160));
  return bits.join(" · ");
}

export function buildUserPrompt(req: PromptRequest): string {
  const p = req.person;
  const lines = [
    `Person: ${p.name}, born ${p.birthYear}, grew up in ${p.hometown}. Loved: ${p.favorites.map((f) => f.name).join(", ") || "not given"}.`,
    `Their youth: ${req.youthWindow.start} to ${req.youthWindow.end}. Write in ${languageName(p.language)}.`,
  ];
  if (req.feedback) {
    lines.push(
      req.feedback.reaction === "lit_up"
        ? `They just lit up at "${req.feedback.title}"; these cards were added to follow that thread.`
        : `"${req.feedback.title}" did not land; these cards were added to try something else.`,
    );
  }
  lines.push("", "Cards:", ...req.cards.map(cardLine));
  return lines.join("\n");
}

/** A prompt is kept only if it reads as a sentence to say aloud: no markup, ids or runaway text. */
function cleanPrompt(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length < 8 || line.length > 300 || hasMarkup(line)) return undefined;
  return line;
}

interface Completion {
  /** The tool call's arguments, or undefined when the model made none. */
  args?: unknown;
  /** Any text the model wrote beside the call. */
  text?: string;
}

export function isAnthropicBaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}

async function completeAnthropic(opts: PromptWriterOptions, system: string, user: string, timeoutMs: number): Promise<Completion> {
  const { env } = opts;
  const client = new Anthropic({
    apiKey: env.llmApiKey,
    baseURL: env.llmBaseUrl.replace(/\/v1\/?$/, ""),
    fetch: opts.fetchImpl,
    maxRetries: 0,
    timeout: timeoutMs,
  });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: env.llmModel,
      max_tokens: LLM_MAX_TOKENS,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{ name: WRITE_PROMPTS_TOOL, description: TOOL_DESCRIPTION, input_schema: inputSchema() as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name: WRITE_PROMPTS_TOOL },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new LlmError(`responded ${error.status ?? "with an error"}`, error.status);
    throw new LlmError(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.stop_reason === "max_tokens") throw new LlmError("ran out of tokens");
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === WRITE_PROMPTS_TOOL);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ");
  return { args: call?.input, text };
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
  error?: { message?: string };
}

async function completeOpenAi(opts: PromptWriterOptions, system: string, user: string, timeoutMs: number): Promise<Completion> {
  const { env } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${env.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.llmApiKey}` },
      body: JSON.stringify({
        model: env.llmModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [{ type: "function", function: { name: WRITE_PROMPTS_TOOL, description: TOOL_DESCRIPTION, parameters: inputSchema() } }],
        tool_choice: { type: "function", function: { name: WRITE_PROMPTS_TOOL } },
        temperature: 0.4,
        max_tokens: LLM_MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new LlmError(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = await response.text();
  let data: ChatResponse;
  try {
    data = JSON.parse(raw) as ChatResponse;
  } catch {
    throw new LlmError(`returned non-JSON (${response.status})`, response.status);
  }
  if (!response.ok) throw new LlmError(`responded ${response.status}`, response.status);
  const choice = data.choices?.[0];
  if (!choice?.message) throw new LlmError("returned no choices");
  if (choice.finish_reason === "length") throw new LlmError("ran out of tokens");
  const call = choice.message.tool_calls?.find((c) => c.function?.name === WRITE_PROMPTS_TOOL);
  let args: unknown;
  if (call) {
    try {
      args = JSON.parse(call.function?.arguments ?? "");
    } catch {
      throw new LlmError("wrote arguments that were not JSON");
    }
  }
  return { args, text: choice.message.content ?? undefined };
}

/**
 * Ask the model for the cards' prompts. Never throws: on any failure the
 * update has no prompts and its trace says the templates were kept.
 */
export async function writePrompts(req: PromptRequest, opts: PromptWriterOptions): Promise<PromptUpdate> {
  const { env, deadline } = opts;
  const phase = req.phase;
  const trace: TraceEvent[] = [];
  const add = (event: Omit<TraceEvent, "id" | "at">) => trace.push(traceEvent({ ...event, policy: "llm" }));
  if (req.cards.length === 0) return { prompts: [], trace };
  const started = Date.now();
  try {
    const budget = opts.timeoutMs ?? PROMPT_TIMEOUT_MS[phase];
    const timeoutMs = deadline === undefined ? budget : Math.min(budget, deadline - Date.now());
    if (timeoutMs <= 0) throw new LlmError("had no time left");
    const system = buildSystemPrompt();
    const user = buildUserPrompt(req);
    const completion = isAnthropicBaseUrl(env.llmBaseUrl) ? await completeAnthropic(opts, system, user, timeoutMs) : await completeOpenAi(opts, system, user, timeoutMs);
    const narration = cleanNarration(completion.text);
    if (narration) add({ phase, kind: "narration", summary: narration });
    if (completion.args === undefined) throw new LlmError("made no tool call");
    const parsed = WritePromptsArgs.safeParse(completion.args);
    if (!parsed.success) throw new LlmError("wrote arguments in the wrong shape");
    const prompts: PromptUpdate["prompts"] = [];
    const done = new Set<string>();
    for (const entry of parsed.data.prompts) {
      const card = req.cards[Number(entry.ref.replace(/^c/i, "")) - 1];
      const prompt = cleanPrompt(entry.prompt);
      if (!card || !prompt || done.has(card.id)) continue;
      done.add(card.id);
      prompts.push({ cardId: card.id, prompt });
    }
    if (prompts.length === 0) throw new LlmError("wrote no usable prompts");
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    add({
      phase,
      kind: "tool_result",
      tool: WRITE_PROMPTS_TOOL,
      summary: `The model wrote ${prompts.length} conversation prompt${prompts.length === 1 ? "" : "s"} in ${seconds} s${prompts.length < req.cards.length ? `; ${req.cards.length - prompts.length} kept from the template set` : ""}`,
    });
    return { prompts, trace };
  } catch (error) {
    const reason = error instanceof LlmError ? error.message : error instanceof Error ? error.message : String(error);
    add({ phase, kind: "note", summary: `Prompts kept from the template set: the model ${reason}.` });
    return { prompts: [], trace };
  }
}

/** The cards with the update's prompts in place, marked as model-written. */
export function applyPromptUpdate(cards: Card[], update: Pick<PromptUpdate, "prompts">): Card[] {
  const byId = new Map(update.prompts.map((p) => [p.cardId, p.prompt]));
  return cards.map((c) => {
    const prompt = byId.get(c.id);
    return prompt ? { ...c, prompt, promptSource: "llm" as const } : c;
  });
}
