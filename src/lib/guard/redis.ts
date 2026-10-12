/**
 * A minimal client for the Upstash Redis REST API, enough for counters and
 * small JSON values. No SDK: one POST per pipeline, a short timeout, and a
 * thrown error on anything unexpected so callers can fail in the direction
 * they choose.
 *
 * Docs: https://upstash.com/docs/redis/features/restapi
 */
import type { EnvSource } from "@/lib/env";

export type RedisCommand = (string | number)[];
export type RedisReply = string | number | null | RedisReply[];

export interface RedisLike {
  /** Run commands in one round trip; replies come back in order. Not atomic. */
  pipeline(commands: RedisCommand[]): Promise<RedisReply[]>;
}

export interface UpstashRedisOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class UpstashRedis implements RedisLike {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: UpstashRedisOptions) {
    this.url = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 1_500;
  }

  async pipeline(commands: RedisCommand[]): Promise<RedisReply[]> {
    if (commands.length === 0) return [];
    const response = await this.fetchImpl(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(this.timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Upstash responded ${response.status}`);
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || data.length !== commands.length) throw new Error("Upstash returned an unexpected pipeline response");
    return data.map((entry: { result?: RedisReply; error?: string }, i) => {
      if (entry && typeof entry === "object" && typeof entry.error === "string") {
        throw new Error(`Upstash ${String(commands[i]?.[0] ?? "command")}: ${entry.error}`);
      }
      return entry?.result ?? null;
    });
  }
}

function pick(env: EnvSource, key: string): string {
  return (env[key] ?? "").trim();
}

/**
 * The Vercel Marketplace integration injects either UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL / KV_REST_API_TOKEN; both work.
 * Returns null when neither pair is set, and every caller treats null as
 * "no budget, no snapshots": local development, tests and fixture mode run
 * exactly as before.
 */
export function redisFromEnv(env: EnvSource = process.env, opts: Omit<UpstashRedisOptions, "url" | "token"> = {}): UpstashRedis | null {
  const url = pick(env, "UPSTASH_REDIS_REST_URL") || pick(env, "KV_REST_API_URL");
  const token = pick(env, "UPSTASH_REDIS_REST_TOKEN") || pick(env, "KV_REST_API_TOKEN");
  if (!url || !token) return null;
  return new UpstashRedis({ url, token, ...opts });
}
