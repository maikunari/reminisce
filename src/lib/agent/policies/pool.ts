/**
 * Choosing the deck, shared by the scripted planner and the pool planner.
 *
 * The pool planner commits a session from what Qloo has already returned in
 * this run, with no new calls. It takes over when the model runs out of time
 * or steps after fetching enough, or when the scripted planner runs out of
 * time part-way, so the caregiver gets a deck built from real results instead
 * of an error or a second round of the same Qloo calls.
 */
import { entityAffinity } from "@/lib/qloo/types";
import { DOMAIN_INFO, type Domain } from "@/lib/session/types";

import type { Policy, PolicyStep, ToolCall } from "../loop";
import { newCallId } from "../loop";
import { distinctArtistIds, type PoolEntry, type ToolContext } from "../tools";

/** Cards per domain before the deck tops up round-robin: music leads, every other domain gets a seat. */
export const DECK_QUOTA: { domain: Domain; want: number }[] = [
  { domain: "music", want: 3 },
  { domain: "film", want: 2 },
  { domain: "dining", want: 1 },
  { domain: "place", want: 1 },
  { domain: "destination", want: 1 },
  { domain: "tv", want: 1 },
];
export const DECK_TARGET = 9;

/** Round-robin interleave so consecutive cards change domain. */
export function interleave(groups: { domain: Domain; ids: string[] }[], limit: number): { domain: Domain; entity_id: string }[] {
  const out: { domain: Domain; entity_id: string }[] = [];
  const queues = groups.map((g) => ({ domain: g.domain, ids: [...g.ids] }));
  while (out.length < limit && queues.some((q) => q.ids.length > 0)) {
    for (const q of queues) {
      const id = q.ids.shift();
      if (id !== undefined) out.push({ domain: q.domain, entity_id: id });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Fill each domain's quota from its best ids, top up round-robin to the target, then interleave. */
export function chooseDeck(candidates: Partial<Record<Domain, string[]>>, target = DECK_TARGET): { domain: Domain; entity_id: string }[] {
  const chosen = new Set<string>();
  const groups = DECK_QUOTA.map((q) => ({ domain: q.domain, ids: [] as string[] }));
  const takeFrom = (index: number, n: number) => {
    for (const id of candidates[DECK_QUOTA[index]!.domain] ?? []) {
      if (n <= 0) break;
      if (chosen.has(id)) continue;
      chosen.add(id);
      groups[index]!.ids.push(id);
      n -= 1;
    }
  };
  DECK_QUOTA.forEach((q, i) => takeFrom(i, q.want));
  for (let round = 0; chosen.size < target && round < 12; round++) {
    const before = chosen.size;
    DECK_QUOTA.forEach((_q, i) => {
      if (chosen.size < target) takeFrom(i, 1);
    });
    if (chosen.size === before) break;
  }
  return interleave(groups, target);
}

function domainOf(entry: PoolEntry): Domain | undefined {
  if (entry.domain) return entry.domain;
  return (Object.keys(DOMAIN_INFO) as Domain[]).find((d) => d !== "dining" && DOMAIN_INFO[d].qlooType === entry.qlooType);
}

/** The deck the pool can make right now, best affinity first within each domain. */
export function deckFromPool(ctx: ToolContext): { domain: Domain; entity_id: string }[] {
  const candidates: Partial<Record<Domain, string[]>> = {};
  const entries = ctx.pool
    .all()
    .slice()
    .sort((a, b) => (b.fit ?? entityAffinity(b.entity) ?? 0) - (a.fit ?? entityAffinity(a.entity) ?? 0) || a.rank - b.rank);
  for (const entry of entries) {
    const domain = domainOf(entry);
    if (!domain) continue;
    (candidates[domain] ??= []).push(entry.entity.entity_id);
  }
  if (candidates.music) candidates.music = distinctArtistIds(candidates.music, ctx.pool);
  return chooseDeck(candidates);
}

/** One step: commit the deck the pool can make, or stop if it is empty. */
export class PoolPlanPolicy implements Policy {
  readonly kind = "deterministic" as const;
  private asked = false;

  constructor(
    private readonly ctx: ToolContext,
    private readonly narration: string,
    /** Below this many cards the pool is not a session; the policy stops instead. */
    private readonly minCards = 1,
  ) {}

  async next(): Promise<PolicyStep> {
    if (this.asked) return { done: true };
    this.asked = true;
    const cards = deckFromPool(this.ctx);
    if (cards.length === 0 || cards.length < this.minCards) return { done: true };
    const call: ToolCall = { id: newCallId(), name: "plan_session", args: { cards } };
    return { narration: this.narration, toolCalls: [call] };
  }

  /** Nothing to learn: the one call it makes is the commit. */
  observe(): void {}
}
