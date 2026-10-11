/**
 * After a reaction the deck moves on by itself: long enough to read the
 * notice, short enough that nobody reaches for "Next". Pure helpers so the
 * timing and the target card can be unit tested without a browser.
 */
export const AUTO_ADVANCE_DELAY_MS = 1400;

/** With reduced motion there is no slide to wait for, only a beat to read the notice. */
export const AUTO_ADVANCE_DELAY_REDUCED_MS = 900;

export function autoAdvanceDelay(reducedMotion: boolean): number {
  return reducedMotion ? AUTO_ADVANCE_DELAY_REDUCED_MS : AUTO_ADVANCE_DELAY_MS;
}

/**
 * The card to show after reacting at `index`: the next one that has no
 * reaction yet, or null when nothing is left ahead (the keepsake takes over).
 */
export function nextCardIndex(cards: readonly { reaction?: string }[], index: number): number | null {
  for (let i = index + 1; i < cards.length; i++) if (!cards[i]?.reaction) return i;
  return null;
}
