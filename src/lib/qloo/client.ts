/**
 * Qloo hackathon API client.
 *
 * - Base URL: https://hackathon.api.qloo.com (the only host hackathon keys work on)
 * - Auth:     `X-Api-Key` header
 * - Endpoints used: GET /v2/insights, GET /search, GET /v2/tags
 *
 * Docs: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
 *
 * `mode: "live"` calls the API; `mode: "fixture"` serves recorded responses and
 * falls back to the synthetic catalog. The mode is a pure environment switch
 * (see src/lib/env.ts); nothing else in the app changes between the two.
 *
 * In live mode two optional layers sit in front of the network:
 *
 * - `cache` stores successful responses (on Vercel, the Data Cache; see
 *   next-cache.ts), so a repeated request costs nothing and is reported with
 *   `cached: true`.
 * - `guard` meters the requests the cache does not answer and decides whether
 *   a failed request surfaces as an error or is answered by the synthetic
 *   catalog instead (reported with `fallback`).
 */
import { readServerEnv, type QlooMode } from "../env";
import {
  canonicalRequestKey,
  findRecordedFixture,
  getSyntheticQloo,
  writeRecordedFixture,
  type QlooPath,
  type QlooRequest,
} from "./fixtures";
import {
  buildInsightsParams,
  buildSearchParams,
  buildTagsParams,
  toQueryString,
  type InsightsRequest,
} from "./params";
import { sharedQlooLimiter, type RateLimiter } from "./limiter";
import type { QlooInsightsResponse, QlooSearchResponse, QlooTagsResponse } from "./types";

export type QlooSource = "live" | "recorded" | "synthetic";

/** Why a live request was answered by the synthetic catalog instead. */
export type QlooFallbackReason = "budget" | "error";

export interface QlooResult<T> {
  request: QlooRequest;
  body: T;
  source: QlooSource;
  status: number;
  durationMs: number;
  warnings: string[];
  /** True when a live response came from the response cache rather than the API. */
  cached?: boolean;
  /** Set when the live API was not called and the synthetic catalog answered instead. */
  fallback?: QlooFallbackReason;
}

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly request: QlooRequest,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "QlooError";
  }
}

/** Stores successful live responses, keyed by the canonical request, so repeats cost nothing. */
export interface QlooResponseCache {
  /** Return the stored value for `key`, or run `produce`, store its value and return it. A thrown error is never stored. */
  wrap<T>(key: string, produce: () => Promise<T>): Promise<T>;
}

/** Meters live requests and decides what a failure turns into. */
export interface QlooGuardHooks {
  /** Before each live request the cache did not answer. Return false to serve the synthetic catalog instead. */
  allowLive?(req: QlooRequest): Promise<boolean> | boolean;
  /** When a live request fails. Return true to serve the synthetic catalog instead of throwing. */
  fallbackOnError?(error: QlooError, req: QlooRequest): boolean;
  /** Called whenever the synthetic catalog answered in place of the live API. */
  onFallback?(req: QlooRequest, reason: QlooFallbackReason, error?: QlooError): void;
}

export interface QlooClientOptions {
  mode: QlooMode;
  apiKey?: string;
  baseUrl?: string;
  /** When true, live responses are also written to fixtures/recorded. */
  record?: boolean;
  recordedRoot?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Live mode only: response cache in front of the network. */
  cache?: QlooResponseCache;
  /** Live mode only: budget and failure handling around each uncached request. */
  guard?: QlooGuardHooks;
  /**
   * Live mode only: paces network requests to the key's rate limit. Defaults
   * to the process-wide limiter; a client with an injected `fetchImpl` (a test
   * double) is unpaced unless one is passed.
   */
  limiter?: RateLimiter;
  /** Wait before asking again after a 429. */
  retryDelayMs?: number;
}

/** A 429 is asked again once after this long, rather than handed to the offline catalog at once. */
export const QLOO_RETRY_DELAY_MS = 300;

interface LiveAnswer {
  status: number;
  body: unknown;
}

/** Raised inside the cache wrapper so a non-200 answer passes through without being stored. */
class UncacheableAnswer extends Error {
  constructor(readonly answer: LiveAnswer) {
    super("uncacheable");
  }
}

/** Raised when the guard declines a live request; always answered by the synthetic catalog. */
class QlooBudgetDeclined extends Error {
  constructor(readonly request: QlooRequest) {
    super(`Qloo ${request.path} declined: daily budget spent`);
    this.name = "QlooBudgetDeclined";
  }
}

export class QlooClient {
  readonly mode: QlooMode;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly record: boolean;
  private readonly recordedRoot: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cache: QlooResponseCache | undefined;
  private readonly guard: QlooGuardHooks | undefined;
  private readonly limiter: RateLimiter | undefined;
  private readonly retryDelayMs: number;

  constructor(opts: QlooClientOptions) {
    this.mode = opts.mode;
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://hackathon.api.qloo.com").replace(/\/+$/, "");
    this.record = opts.record ?? false;
    this.recordedRoot = opts.recordedRoot;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.cache = opts.cache;
    this.guard = opts.guard;
    this.limiter = opts.limiter ?? (opts.mode === "live" && !opts.fetchImpl ? sharedQlooLimiter() : undefined);
    this.retryDelayMs = opts.retryDelayMs ?? QLOO_RETRY_DELAY_MS;
    if (this.mode === "live" && !this.apiKey) {
      throw new Error("QLOO_API_KEY is required when QLOO_MODE=live");
    }
  }

  async search(
    query: string,
    opts: { types?: readonly string[]; take?: number; deadline?: number } = {},
  ): Promise<QlooResult<QlooSearchResponse>> {
    const params = buildSearchParams({ query, types: opts.types, take: opts.take });
    const result = await this.request<QlooSearchResponse>({ path: "/search", params }, [], opts.deadline);
    // The search endpoint answers 404 for "no results"; normalise to an empty list.
    if (!Array.isArray(result.body?.results)) {
      result.body = { ...(result.body ?? {}), results: [] };
    }
    return result;
  }

  async searchTags(
    query: string,
    opts: { parentTypes?: readonly string[]; tagTypes?: readonly string[]; take?: number; deadline?: number } = {},
  ): Promise<QlooResult<QlooTagsResponse>> {
    const params = buildTagsParams({ query, parentTypes: opts.parentTypes, tagTypes: opts.tagTypes, take: opts.take });
    const result = await this.request<QlooTagsResponse>({ path: "/v2/tags", params }, [], opts.deadline);
    const tags = result.body?.results?.tags;
    if (!Array.isArray(tags)) {
      result.body = { success: true, results: { tags: [] } };
    }
    return result;
  }

  async insights(req: InsightsRequest, opts: { deadline?: number } = {}): Promise<QlooResult<QlooInsightsResponse>> {
    const { params, warnings } = buildInsightsParams(req);
    const result = await this.request<QlooInsightsResponse>({ path: "/v2/insights", params }, warnings, opts.deadline);
    if (!Array.isArray(result.body?.results?.entities)) {
      result.body = { ...(result.body ?? { success: true }), results: { entities: [] } } as QlooInsightsResponse;
    }
    return result;
  }

  /** `deadline` (epoch ms) caps a live request's timeout at the time left before it. */
  async request<T>(req: QlooRequest, warnings: string[], deadline?: number): Promise<QlooResult<T>> {
    const started = Date.now();
    if (this.mode === "fixture") {
      const recorded = await findRecordedFixture<T>(req, this.recordedRoot);
      if (recorded) {
        return {
          request: req,
          body: recorded.body,
          source: "recorded",
          status: recorded._meta.status,
          durationMs: Date.now() - started,
          warnings,
        };
      }
      const body = this.synthetic<T>(req);
      return { request: req, body, source: "synthetic", status: 200, durationMs: Date.now() - started, warnings };
    }

    let ran = false;
    const live = async (): Promise<LiveAnswer> => {
      ran = true;
      if (this.guard?.allowLive && !(await this.guard.allowLive(req))) throw new QlooBudgetDeclined(req);
      return this.fetchLive(req, deadline);
    };
    try {
      const answer = this.cache ? await this.throughCache(req, live) : await live();
      return {
        request: req,
        body: answer.body as T,
        source: "live",
        status: answer.status,
        durationMs: Date.now() - started,
        warnings,
        cached: !ran,
      };
    } catch (error) {
      const reason = this.fallbackReason(error, req);
      if (!reason) throw error;
      this.guard?.onFallback?.(req, reason, error instanceof QlooError ? error : undefined);
      const body = this.synthetic<T>(req);
      return { request: req, body, source: "synthetic", status: 200, durationMs: Date.now() - started, warnings, fallback: reason };
    }
  }

  private fallbackReason(error: unknown, req: QlooRequest): QlooFallbackReason | undefined {
    if (error instanceof QlooBudgetDeclined) return "budget";
    if (error instanceof QlooError && this.guard?.fallbackOnError?.(error, req)) return "error";
    return undefined;
  }

  /** Only 200 answers are stored; a 404 "no results" from /search passes through uncached. */
  private async throughCache(req: QlooRequest, live: () => Promise<LiveAnswer>): Promise<LiveAnswer> {
    try {
      return await this.cache!.wrap(canonicalRequestKey(req), async () => {
        const answer = await live();
        if (answer.status !== 200) throw new UncacheableAnswer(answer);
        return answer;
      });
    } catch (error) {
      if (error instanceof UncacheableAnswer) return error.answer;
      throw error;
    }
  }

  /** One network request, paced by the limiter; a 429 is asked again once after a short wait while time allows. */
  private async fetchLive(req: QlooRequest, deadline: number | undefined): Promise<LiveAnswer> {
    const once = () => (this.limiter ? this.limiter.run(() => this.fetchOnce(req, deadline)) : this.fetchOnce(req, deadline));
    try {
      return await once();
    } catch (error) {
      const timeLeft = deadline === undefined ? Infinity : deadline - Date.now();
      if (!(error instanceof QlooError) || error.status !== 429 || timeLeft < this.retryDelayMs * 2) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs));
      return once();
    }
  }

  private async fetchOnce(req: QlooRequest, deadline: number | undefined): Promise<LiveAnswer> {
    const timeoutMs = deadline === undefined ? this.timeoutMs : Math.min(this.timeoutMs, deadline - Date.now());
    if (timeoutMs <= 0) throw new QlooError(`Qloo ${req.path} skipped: time budget exhausted`, 0, req);
    const url = `${this.baseUrl}${req.path}?${toQueryString(req.params)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        // The response cache (if any) wraps this call; the framework's own fetch cache stays out of it.
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new QlooError(`Qloo ${req.path} request failed: ${message}`, 0, req);
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!response.ok && !(req.path === "/search" && response.status === 404)) {
      throw new QlooError(`Qloo ${req.path} responded ${response.status}`, response.status, req, body);
    }
    if (this.record) {
      await writeRecordedFixture(req, response.status, body, this.recordedRoot);
    }
    return { status: response.status, body };
  }

  private synthetic<T>(req: QlooRequest): T {
    const engine = getSyntheticQloo();
    switch (req.path as QlooPath) {
      case "/search":
        return engine.search(req.params) as T;
      case "/v2/tags":
        return engine.tags(req.params) as T;
      case "/v2/insights":
        return engine.insights(req.params) as T;
      default:
        throw new QlooError(`No synthetic fixture for ${req.path}`, 404, req);
    }
  }
}

let cached: QlooClient | null = null;

/** Process-wide client configured from the environment, with no cache or guard. */
export function getQlooClient(): QlooClient {
  if (cached) return cached;
  const env = readServerEnv();
  cached = new QlooClient({ mode: env.qlooMode, apiKey: env.qlooApiKey, baseUrl: env.qlooBaseUrl });
  return cached;
}

/** Test hook. */
export function resetQlooClient(): void {
  cached = null;
}
