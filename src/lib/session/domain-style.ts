import type { Domain } from "./types";

/** Tailwind class fragments per domain; all pairs meet WCAG AA. */
export const DOMAIN_STYLE: Record<
  Domain,
  { chip: string; solid: string; soft: string; ring: string; gradient: string; text: string }
> = {
  music: {
    chip: "bg-ember-100 text-ember-700",
    solid: "bg-ember-600 text-white",
    soft: "bg-ember-100",
    ring: "ring-ember-600",
    gradient: "from-ember-600 via-ember-500 to-gold-600",
    text: "text-ember-700",
  },
  film: {
    chip: "bg-plum-100 text-plum-700",
    solid: "bg-plum-600 text-white",
    soft: "bg-plum-100",
    ring: "ring-plum-600",
    gradient: "from-plum-700 via-plum-600 to-ember-600",
    text: "text-plum-700",
  },
  tv: {
    chip: "bg-dusk-100 text-dusk-700",
    solid: "bg-dusk-600 text-white",
    soft: "bg-dusk-100",
    ring: "ring-dusk-600",
    gradient: "from-dusk-700 via-dusk-600 to-sea-600",
    text: "text-dusk-700",
  },
  dining: {
    chip: "bg-gold-100 text-gold-700",
    solid: "bg-gold-600 text-white",
    soft: "bg-gold-100",
    ring: "ring-gold-600",
    gradient: "from-gold-700 via-gold-600 to-ember-500",
    text: "text-gold-700",
  },
  place: {
    chip: "bg-sage-100 text-sage-700",
    solid: "bg-sage-600 text-white",
    soft: "bg-sage-100",
    ring: "ring-sage-600",
    gradient: "from-sage-700 via-sage-600 to-sea-600",
    text: "text-sage-700",
  },
  destination: {
    chip: "bg-sea-100 text-sea-700",
    solid: "bg-sea-600 text-white",
    soft: "bg-sea-100",
    ring: "ring-sea-600",
    gradient: "from-sea-700 via-sea-600 to-sage-600",
    text: "text-sea-700",
  },
};
