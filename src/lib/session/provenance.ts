import type { QlooSource } from "./types";

/**
 * How the UI describes where a Qloo response came from. One place, so the
 * Why Qloo panel, the timeline, the dictionaries and any snapshot or replay
 * feature agree, and so a live session never carries a label that sounds
 * canned. Other languages translate these keys in their dictionaries.
 */
export interface ProvenanceStrings {
  /** One line per source, for the request table of a card. */
  source: Record<QlooSource, string>;
  /** One or two words per source, for the timeline rows. */
  sourceWord: Record<QlooSource, string>;
  /** The session-level phrase in the panel header. */
  mode: { live: string; recorded: string; mixed: string; synthetic: string };
  /** A preset replayed from an earlier live run (the abuse guard's snapshots): the header line and the source row. */
  replayedRun: (when: string) => string;
  sourceReplayedRun: (when: string) => string;
  /** Appended to a timeline row when a live response came from the response cache. */
  cached: string;
}

export const PROVENANCE_EN: ProvenanceStrings = {
  source: {
    live: "Live Qloo response",
    recorded: "Replayed from a saved Qloo response",
    synthetic: "Demo catalogue, shaped like a Qloo response",
  },
  sourceWord: {
    live: "live",
    recorded: "saved response",
    synthetic: "demo catalogue",
  },
  mode: {
    live: "live Qloo API",
    recorded: "replayed from saved Qloo responses",
    mixed: "demo catalogue and saved Qloo responses",
    synthetic: "demo catalogue",
  },
  replayedRun: (when) => `Replayed from a live Qloo run at ${when}; nothing was fetched for this session.`,
  sourceReplayedRun: (when) => `Live Qloo response, replayed from a run at ${when}`,
  cached: "cached",
};

/**
 * Live sessions say nothing extra: "live Qloo API" is the normal case, not a
 * disclosure. Everything else says plainly that the answers were replayed.
 */
export function sessionModeLabel(mode: "live" | "fixture", sources: Iterable<QlooSource>, strings: ProvenanceStrings = PROVENANCE_EN): string {
  if (mode === "live") return strings.mode.live;
  const set = new Set(sources);
  if (set.size === 1 && set.has("recorded")) return strings.mode.recorded;
  if (set.has("recorded")) return strings.mode.mixed;
  return strings.mode.synthetic;
}
