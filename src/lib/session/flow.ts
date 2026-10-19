/**
 * The session's flow as one named state and a table of transitions, not a set
 * of flags read against each other.
 *
 *   planning --deal--> overview --start--> in_session --finish--> complete
 *      |  ^
 *     fail retry
 *      v  |
 *    failed
 *
 * Only what must survive a reload is stored on the Session (`status`,
 * `overview`, `ending`); `phaseOf` reads the phase back from them, so a
 * session saved before the ending existed still opens where it was. An event
 * that does not apply in the current phase changes nothing.
 */
import type { Session } from "./types";

export const PHASES = ["planning", "failed", "overview", "in_session", "complete"] as const;
export type SessionPhase = (typeof PHASES)[number];

export const FLOW_EVENTS = ["deal", "fail", "retry", "start", "finish"] as const;
export type FlowEvent = (typeof FLOW_EVENTS)[number];

/** The only legal moves; a missing entry means the event does nothing in that phase. */
export const TRANSITIONS: Record<SessionPhase, Partial<Record<FlowEvent, SessionPhase>>> = {
  /** The plan is being built; the deal puts the lineup on screen, a failure stops it. */
  planning: { deal: "overview", fail: "failed" },
  failed: { retry: "planning" },
  /** The lineup, before the first card. */
  overview: { start: "in_session" },
  /** Cards are being shown; the caregiver (or the last reaction) ends the session. */
  in_session: { finish: "complete" },
  /** "Session complete": thanks, what lit them up, the printable summary. "Done" leaves the page. */
  complete: {},
};

export function transition(phase: SessionPhase, event: FlowEvent): SessionPhase {
  return TRANSITIONS[phase][event] ?? phase;
}

type FlowFields = Pick<Session, "status" | "cards" | "overview" | "ending">;

/** The phase a session is in, from the fields that are saved with it. */
export function phaseOf(s: FlowFields): SessionPhase {
  if (s.status === "error") return "failed";
  if (s.cards.length === 0) return "planning";
  if (s.overview) return "overview";
  if (s.ending === "complete") return "complete";
  return "in_session";
}

/** The saved fields that put a session in `phase`. */
function fieldsFor(phase: SessionPhase): Pick<Session, "status" | "overview" | "ending"> {
  switch (phase) {
    case "planning":
      return { status: "planning", overview: undefined, ending: undefined };
    case "failed":
      return { status: "error", overview: undefined, ending: undefined };
    case "overview":
      return { status: "ready", overview: true, ending: undefined };
    case "in_session":
      return { status: "ready", overview: false, ending: undefined };
    case "complete":
      return { status: "ready", overview: false, ending: "complete" };
  }
}

/**
 * The changes to save when `event` happens in `from`; empty when it does not
 * apply. `from` is passed rather than read, because the deal and a failure
 * arrive in the same update that fills in the cards.
 */
export function flowPatch(from: SessionPhase, event: FlowEvent): Partial<Session> {
  const to = transition(from, event);
  return to === from ? {} : fieldsFor(to);
}

/** The session after `event`, or the same session when the event does not apply to its phase. */
export function applyFlow(session: Session, event: FlowEvent): Session {
  const patch = flowPatch(phaseOf(session), event);
  return Object.keys(patch).length === 0 ? session : { ...session, ...patch };
}

/** True once every card has a reaction: the cue for the session to end by itself. */
export function allReacted(cards: readonly { reaction?: string }[]): boolean {
  return cards.length > 0 && cards.every((c) => c.reaction);
}
