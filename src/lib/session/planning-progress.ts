/**
 * What the planning screen shows, derived from the agent's trace: one state
 * per domain that only ever moves forward (waiting, asking, then found or
 * empty), so the screen updates in place instead of scrolling a log.
 */
import { cleanNarration } from "./narration";
import { DOMAINS, type Domain, type TraceEvent, type TracePreviewItem } from "./types";

export type DomainStatus = "waiting" | "asking" | "found" | "empty";

export interface DomainProgress {
  domain: Domain;
  status: DomainStatus;
  /** The first few names Qloo returned, best first. */
  items: TracePreviewItem[];
  /** How many came back in all. */
  count: number;
}

export interface PlanningProgress {
  domains: DomainProgress[];
  /** Qloo requests so far, including the ones a call made while widening. */
  qlooCalls: number;
  /** Domains with an answer, found or empty. */
  settled: number;
  /** The agent's latest line of narration, if any. */
  narration?: string;
}

const TYPE_DOMAIN: Record<string, Domain> = {
  "urn:entity:artist": "music",
  "urn:entity:movie": "film",
  "urn:entity:tv_show": "tv",
  "urn:entity:destination": "destination",
};

/** The domain of an Insights event; older traces (a replayed snapshot) carry only the request. */
function domainOf(event: TraceEvent): Domain | undefined {
  if (event.domain) return event.domain;
  const params = event.qloo?.params;
  if (!params || event.qloo?.path !== "/v2/insights") return undefined;
  const type = params["filter.type"] ?? "";
  if (type === "urn:entity:place") return /restaurant/.test(params["filter.tags"] ?? "") ? "dining" : "place";
  return TYPE_DOMAIN[type];
}

export function planningProgress(events: TraceEvent[]): PlanningProgress {
  const byDomain = new Map<Domain, DomainProgress>(DOMAINS.map((d) => [d, { domain: d, status: "waiting", items: [], count: 0 }]));
  let qlooCalls = 0;
  let narration: string | undefined;
  for (const event of events) {
    if (event.qloo) qlooCalls += 1;
    if (event.kind === "narration") narration = cleanNarration(event.summary) ?? narration;
    const domain = domainOf(event);
    if (!domain) continue;
    const state = byDomain.get(domain)!;
    if (event.kind === "tool_call") {
      if (state.status === "waiting") state.status = "asking";
      continue;
    }
    if (event.kind === "error") {
      if (state.status !== "found") state.status = "empty";
      continue;
    }
    if (event.kind !== "tool_result" || !event.qloo) continue;
    // A widening step carries no preview: the call is still working.
    const final = event.preview !== undefined;
    const count = final ? Math.max(event.preview!.length, event.qloo.resultCount) : event.qloo.resultCount;
    if (final && event.preview!.length > 0) {
      // Keep the first answer that filled the sleeve; a later call for the same domain only adds to the count.
      if (state.status !== "found") state.items = event.preview!;
      state.status = "found";
      state.count = Math.max(state.count, count);
    } else if (!final && count > 0 && !event.summary.includes("asking again")) {
      // A replayed trace from before previews: there is an answer, without names.
      state.status = "found";
      state.count = Math.max(state.count, count);
    } else if (final && state.status !== "found") {
      state.status = "empty";
    }
  }
  const domains = [...byDomain.values()];
  return { domains, qlooCalls, settled: domains.filter((d) => d.status === "found" || d.status === "empty").length, narration };
}
