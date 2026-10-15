/**
 * The "session ready" overview between planning and the first card: the
 * lineup the caregiver can trim or reorder before starting. Pure, so the
 * rules are unit tested without a browser. The deck holds no spares, so
 * "reshuffle" reorders what is there and "drop" removes a card for good.
 */
import { PLAN_MIN_DOMAINS } from "./deck";
import { DOMAINS, type Card, type Domain } from "./types";

/** A session never drops below this many cards. */
export const OVERVIEW_MIN_CARDS = PLAN_MIN_DOMAINS;

export function canDrop(cards: readonly unknown[]): boolean {
  return cards.length > OVERVIEW_MIN_CARDS;
}

/** The deck without one card; unchanged when that would leave too few. */
export function dropCard(cards: Card[], cardId: string): Card[] {
  if (!canDrop(cards) || !cards.some((c) => c.id === cardId)) return cards;
  return cards.filter((c) => c.id !== cardId);
}

/** Puts a dropped card back at the place it had (or the end), unless the deck already holds it. */
export function restoreCard(cards: Card[], card: Card, index: number): Card[] {
  if (cards.some((c) => c.id === card.id || c.entityId === card.entityId)) return cards;
  const at = Math.max(0, Math.min(cards.length, index));
  return [...cards.slice(0, at), card, ...cards.slice(at)];
}

/** A new order for the same cards (Fisher-Yates); never the order it started in when there is another one. */
export function shuffleCards(cards: Card[], random: () => number = Math.random): Card[] {
  if (cards.length < 2) return cards;
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = [...cards];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
    if (next.some((c, i) => c !== cards[i])) return next;
  }
  return [...cards.slice(1), cards[0]!];
}

export interface LineupGroup {
  domain: Domain;
  /** Each card with its place in the session, so the order stays visible when the lineup is grouped. */
  entries: { card: Card; position: number }[];
}

/** The lineup grouped by kind of memory, in the usual domain order, skipping kinds with no card. */
export function groupByDomain(cards: readonly Card[]): LineupGroup[] {
  return DOMAINS.map((domain) => ({
    domain,
    entries: cards.flatMap((card, i) => (card.domain === domain ? [{ card, position: i + 1 }] : [])),
  })).filter((g) => g.entries.length > 0);
}
