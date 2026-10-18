import { describe, expect, it } from "vitest";

import { FLOW_EVENTS, PHASES, TRANSITIONS, allReacted, applyFlow, flowPatch, phaseOf, transition, type FlowEvent, type SessionPhase } from "@/lib/session/flow";
import type { Card, Session } from "@/lib/session/types";

const card = (id: string, reaction?: Card["reaction"]) => ({ id, reaction }) as Card;

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    person: { name: "Frank", birthYear: 1945, hometown: "Chicago", favorites: [], language: "en" },
    youthWindow: { start: 1960, end: 1975, ageFrom: 15, ageTo: 30 },
    ageBucket: "55_and_older",
    cards: [card("a"), card("b")],
    trace: [],
    status: "ready",
    planner: "deterministic",
    qlooMode: "fixture",
    currentIndex: 0,
    ...over,
  };
}

describe("session flow: transitions", () => {
  it("follows the whole path from planning to closed, and back out of the ending", () => {
    const path: [SessionPhase, FlowEvent, SessionPhase][] = [
      ["planning", "deal", "overview"],
      ["overview", "start", "in_session"],
      ["in_session", "finish", "complete"],
      ["complete", "close", "closed"],
      ["closed", "reopen", "complete"],
      ["complete", "resume", "in_session"],
      ["planning", "fail", "failed"],
      ["failed", "retry", "planning"],
    ];
    for (const [from, event, to] of path) expect(transition(from, event), `${from} --${event}-->`).toBe(to);
  });

  it("ignores every event a phase has no move for, in every phase", () => {
    for (const phase of PHASES) {
      for (const event of FLOW_EVENTS) {
        const to = transition(phase, event);
        if (TRANSITIONS[phase][event]) expect(to).toBe(TRANSITIONS[phase][event]);
        else expect(to, `${phase} --${event}-->`).toBe(phase);
      }
    }
  });

  it("cannot end a session that has not started, or skip the overview", () => {
    expect(transition("overview", "finish")).toBe("overview");
    expect(transition("planning", "start")).toBe("planning");
    expect(transition("planning", "finish")).toBe("planning");
    expect(transition("failed", "deal")).toBe("failed");
  });

  it("can only leave the ending through the screens that belong to it", () => {
    expect(transition("complete", "start")).toBe("complete");
    expect(transition("closed", "resume")).toBe("closed");
    expect(transition("closed", "finish")).toBe("closed");
    expect(transition("in_session", "close")).toBe("in_session");
  });
});

describe("session flow: reading the phase back from what is saved", () => {
  it("derives each phase from the saved fields", () => {
    expect(phaseOf(session({ cards: [], status: "planning" }))).toBe("planning");
    expect(phaseOf(session({ cards: [], status: "error" }))).toBe("failed");
    expect(phaseOf(session({ overview: true }))).toBe("overview");
    expect(phaseOf(session({ overview: false }))).toBe("in_session");
    expect(phaseOf(session({ overview: false, ending: "complete" }))).toBe("complete");
    expect(phaseOf(session({ overview: false, ending: "closed" }))).toBe("closed");
  });

  it("opens a session saved before the overview and the ending existed in the session", () => {
    expect(phaseOf(session({ overview: undefined, ending: undefined }))).toBe("in_session");
  });

  it("is still in the ending after a reload", () => {
    const ended = applyFlow(applyFlow(session({ overview: false }), "finish"), "close");
    const reloaded = JSON.parse(JSON.stringify(ended)) as Session;
    expect(phaseOf(reloaded)).toBe("closed");
    expect(phaseOf(applyFlow(reloaded, "reopen"))).toBe("complete");
  });
});

describe("session flow: applying events to a session", () => {
  it("moves a session through the flow and saves the fields that say where it is", () => {
    let s = session({ cards: [], status: "planning" });
    expect(flowPatch(phaseOf(s), "deal")).toMatchObject({ status: "ready", overview: true });
    s = { ...s, cards: [card("a"), card("b")], ...flowPatch("planning", "deal") };
    expect(phaseOf(s)).toBe("overview");
    s = applyFlow(s, "start");
    expect(phaseOf(s)).toBe("in_session");
    expect(s.overview).toBe(false);
    s = applyFlow(s, "finish");
    expect(phaseOf(s)).toBe("complete");
    expect(s.ending).toBe("complete");
    s = applyFlow(s, "resume");
    expect(phaseOf(s)).toBe("in_session");
    expect(s.ending).toBeUndefined();
  });

  it("returns the very same session when the event does not apply", () => {
    const s = session({ overview: true });
    expect(applyFlow(s, "finish")).toBe(s);
    expect(applyFlow(s, "close")).toBe(s);
    expect(flowPatch("overview", "finish")).toEqual({});
  });

  it("a failed build can be retried and dealt again", () => {
    const failed = { ...session({ cards: [] }), ...flowPatch("planning", "fail") };
    expect(phaseOf(failed)).toBe("failed");
    const retried = applyFlow(failed, "retry");
    expect(phaseOf(retried)).toBe("planning");
    const dealt = { ...retried, cards: [card("a")], ...flowPatch("planning", "deal") };
    expect(phaseOf(dealt)).toBe("overview");
  });
});

describe("session flow: when the session ends by itself", () => {
  it("only when every card has a reaction", () => {
    expect(allReacted([card("a", "lit_up"), card("b", "not_this")])).toBe(true);
    expect(allReacted([card("a", "lit_up"), card("b")])).toBe(false);
    expect(allReacted([])).toBe(false);
  });
});
