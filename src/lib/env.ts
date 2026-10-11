/**
 * Server-side environment resolution. Never import from client components.
 */
export type QlooMode = "live" | "fixture";
export type LlmMode = "live" | "fixture";

export interface ServerEnv {
  qlooMode: QlooMode;
  qlooApiKey: string;
  qlooBaseUrl: string;
  llmMode: LlmMode;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
}

export const QLOO_HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";

/** Any string map works: process.env, a test stub, or a parsed .env file. */
export type EnvSource = Record<string, string | undefined>;

function pick(env: EnvSource, key: string): string {
  return (env[key] ?? "").trim();
}

export function resolveQlooMode(env: EnvSource = process.env): QlooMode {
  const explicit = pick(env, "QLOO_MODE").toLowerCase();
  if (explicit === "live" || explicit === "fixture") return explicit;
  return pick(env, "QLOO_API_KEY") ? "live" : "fixture";
}

export function resolveLlmMode(env: EnvSource = process.env): LlmMode {
  const explicit = pick(env, "LLM_MODE").toLowerCase();
  if (explicit === "live" || explicit === "fixture") return explicit;
  return pick(env, "LLM_API_KEY") ? "live" : "fixture";
}

export function readServerEnv(env: EnvSource = process.env): ServerEnv {
  return {
    qlooMode: resolveQlooMode(env),
    qlooApiKey: pick(env, "QLOO_API_KEY"),
    qlooBaseUrl: pick(env, "QLOO_BASE_URL") || QLOO_HACKATHON_BASE_URL,
    llmMode: resolveLlmMode(env),
    llmBaseUrl: (pick(env, "LLM_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""),
    llmApiKey: pick(env, "LLM_API_KEY"),
    llmModel: pick(env, "LLM_MODEL") || "gpt-4o-mini",
  };
}
