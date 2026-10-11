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
 */
import { readServerEnv, type QlooMode } from "../env";
import {
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
import type { QlooInsightsResponse, QlooSearchResponse, QlooTagsResponse } from "./types";

export type QlooSource = "live" | "recorded" | "synthetic";

export interface QlooResult<T> {
  request: QlooRequest;
  body: T;
  source: QlooSource;
  status: number;
  durationMs: number;
  warnings: string[];
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

export interface QlooClientOptions {
  mode: QlooMode;
  apiKey?: string;
  baseUrl?: string;
  /** When true, live responses are also written to fixtures/recorded. */
  record?: boolean;
  recordedRoot?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class QlooClient {
  readonly mode: QlooMode;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly record: boolean;
  private readonly recordedRoot: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: QlooClientOptions) {
    this.mode = opts.mode;
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://hackathon.api.qloo.com").replace(/\/+$/, "");
    this.record = opts.record ?? false;
    this.recordedRoot = opts.recordedRoot;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (this.mode === "live" && !this.apiKey) {
      throw new Error("QLOO_API_KEY is required when QLOO_MODE=live");
    }
  }

  async search(
    query: string,
    opts: { types?: readonly string[]; take?: number } = {},
  ): Promise<QlooResult<QlooSearchResponse>> {
    const params = buildSearchParams({ query, types: opts.types, take: opts.take });
    const result = await this.request<QlooSearchResponse>({ path: "/search", params }, []);
    // The search endpoint answers 404 for "no results"; normalise to an empty list.
    if (!Array.isArray(result.body?.results)) {
      result.body = { ...(result.body ?? {}), results: [] };
    }
    return result;
  }

  async searchTags(
    query: string,
    opts: { parentTypes?: readonly string[]; tagTypes?: readonly string[]; take?: number } = {},
  ): Promise<QlooResult<QlooTagsResponse>> {
    const params = buildTagsParams({ query, parentTypes: opts.parentTypes, tagTypes: opts.tagTypes, take: opts.take });
    const result = await this.request<QlooTagsResponse>({ path: "/v2/tags", params }, []);
    const tags = result.body?.results?.tags;
    if (!Array.isArray(tags)) {
      result.body = { success: true, results: { tags: [] } };
    }
    return result;
  }

  async insights(req: InsightsRequest): Promise<QlooResult<QlooInsightsResponse>> {
    const { params, warnings } = buildInsightsParams(req);
    const result = await this.request<QlooInsightsResponse>({ path: "/v2/insights", params }, warnings);
    if (!Array.isArray(result.body?.results?.entities)) {
      result.body = { ...(result.body ?? { success: true }), results: { entities: [] } } as QlooInsightsResponse;
    }
    return result;
  }

  async request<T>(req: QlooRequest, warnings: string[]): Promise<QlooResult<T>> {
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

    const url = `${this.baseUrl}${req.path}?${toQueryString(req.params)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
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
    return {
      request: req,
      body: body as T,
      source: "live",
      status: response.status,
      durationMs: Date.now() - started,
      warnings,
    };
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

/** Process-wide client configured from the environment. */
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
