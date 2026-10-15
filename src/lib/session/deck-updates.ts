/**
 * How late-arriving results land in a deck the caregiver is already using.
 * The deck never waits for them, so they must never change a card that has
 * been shown, reacted to, or is about to be shown. Pure, so the rules are
 * unit tested without a browser.
 */
import type { Card } from "./types";

/**
 * The model's prompts in place of the templates, on the card in front of the
 * caregiver and the ones ahead; a card already passed or reacted to keeps the
 * words that were read aloud.
 */
export function applyPrompts(cards: Card[], prompts: { cardId: string; prompt: string }[], currentIndex: number): Card[] {
  const byId = new Map(prompts.map((p) => [p.cardId, p.prompt]));
  return cards.map((c, i) => {
    const prompt = byId.get(c.id);
    if (!prompt || i < currentIndex || c.reaction) return c;
    return { ...c, prompt, promptSource: "llm" };
  });
}

/**
 * A re-tune's replacements, each taking the place of the card it names, but
 * only for cards after `protectedIndex` (the card the deck moved on to when
 * the caregiver tapped, or wherever they have got to since) that have no
 * reaction, and never bringing in a card the deck already holds.
 */
export function applyReplacements(cards: Card[], replacements: Card[], protectedIndex: number): { cards: Card[]; applied: Card[] } {
  const present = new Set(cards.map((c) => c.entityId));
  const byReplaced = new Map<string, Card>();
  for (const r of replacements) {
    if (!r.replacedEntityId || present.has(r.entityId) || byReplaced.has(r.replacedEntityId)) continue;
    byReplaced.set(r.replacedEntityId, r);
    present.add(r.entityId);
  }
  const applied: Card[] = [];
  const next = cards.map((c, i) => {
    const r = byReplaced.get(c.entityId);
    if (!r || i <= protectedIndex || c.reaction) return c;
    applied.push(r);
    return r;
  });
  return { cards: next, applied };
}
