import type { Domain } from "./types";

/**
 * One ink per domain. Used only for the sleeves, the 10px swatch beside a
 * domain label, and the current-card rule; never as a fill behind text.
 */
export const DOMAIN_INK: Record<Domain, { swatch: string; hex: string }> = {
  music: { swatch: "bg-ember-700", hex: "#8e3814" },
  film: { swatch: "bg-plum-700", hex: "#5b3760" },
  tv: { swatch: "bg-dusk-700", hex: "#444e5c" },
  dining: { swatch: "bg-ochre-700", hex: "#7d5210" },
  place: { swatch: "bg-moss-700", hex: "#46603f" },
  destination: { swatch: "bg-sea-700", hex: "#2b5f6e" },
};
