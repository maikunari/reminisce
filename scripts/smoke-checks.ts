/**
 * What the live smoke test (scripts/smoke-live.ts) asserts about one planned
 * session. Pure, so tests/unit/smoke-checks.test.ts can run it offline.
 */
import { bornInCountry, foldName } from "../src/lib/agent/relevance";
import type { QlooEntity } from "../src/lib/qloo/types";
import type { Card, Person, PlanResult } from "../src/lib/session/types";

export interface SmokeSpec {
  person: Person;
  /** The country name Qloo uses in release_country; a film of this country must be in the deck. */
  homeCountry: string;
  /** A music card for an act from `country` that started before `before` must be in the deck. */
  era?: { country: string; before: number };
}

export interface SmokeReport {
  failures: string[];
  /** One line per card, for the compact listing. */
  lines: string[];
  liveCalls: number;
}

/** More Qloo calls than this for one person means the planner has started fanning out; about 15 is normal. */
export const MAX_CALLS_PER_PERSON = 30;

function describe(card: Card): string {
  const bits = [card.domain === "music" && card.startYear ? `from ${card.startYear}` : undefined, card.subtitle].filter(Boolean);
  return `${card.domain.padEnd(11)} ${card.title}${bits.length > 0 ? `  (${bits.join(" · ")})` : ""}`;
}

export function checkPlan(spec: SmokeSpec, plan: PlanResult, entities: ReadonlyMap<string, QlooEntity>): SmokeReport {
  const failures: string[] = [];
  const cards = plan.cards;
  const entityOf = (card: Card) => entities.get(card.entityId);

  const errors = plan.trace.filter((e) => e.kind === "error");
  for (const e of errors) failures.push(`error event: ${e.summary}`);

  if (plan.qlooMode !== "live") failures.push(`planned in ${plan.qlooMode} mode, not live`);
  const notLive = plan.trace.filter((e) => e.qloo && e.qloo.source !== "live");
  if (notLive.length > 0) failures.push(`${notLive.length} Qloo call(s) answered by ${[...new Set(notLive.map((e) => e.qloo!.source))].join("/")}, not the live API`);

  const music = cards.filter((c) => c.domain === "music");
  if (music.length === 0) failures.push("no music card");

  const home = foldName(spec.homeCountry);
  const homeFilms = cards.filter((c) => {
    if (c.domain !== "film") return false;
    const countries = entityOf(c)?.properties?.release_country;
    return Array.isArray(countries) && countries.some((x) => foldName(String(x)) === home);
  });
  if (homeFilms.length === 0) failures.push(`no ${spec.homeCountry} film (films: ${cards.filter((c) => c.domain === "film").map((c) => c.title).join(", ") || "none"})`);

  if (spec.era) {
    const { country, before } = spec.era;
    const acts = music.filter((c) => {
      const entity = entityOf(c);
      return entity !== undefined && bornInCountry(entity, country) && c.startYear !== undefined && c.startYear < before;
    });
    if (acts.length === 0) failures.push(`no ${country} act that started before ${before} (music: ${music.map((c) => `${c.title} ${c.startYear ?? "?"}`).join(", ") || "none"})`);
  }

  const liveCalls = plan.trace.filter((e) => e.qloo && !e.qloo.cached).length;
  if (liveCalls > MAX_CALLS_PER_PERSON) failures.push(`${liveCalls} live Qloo calls, over the ${MAX_CALLS_PER_PERSON} a person should cost`);

  return { failures, lines: cards.map(describe), liveCalls };
}
