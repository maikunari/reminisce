"use client";

import type { Person, TraceEvent, YouthWindow } from "@/lib/session/types";

interface Props {
  person: Person;
  youthWindow: YouthWindow;
  events: TraceEvent[];
}

/** Shown while the agent is building the deck: the person, and the plan as it happens. */
export function PlanningView({ person, youthWindow, events }: Props) {
  const lines = events.filter((e) => e.kind !== "tool_call").slice(-6);
  const qlooCalls = events.filter((e) => e.qloo).length;
  return (
    <section aria-live="polite" aria-busy="true" className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="planning-view">
      <div className="relative" aria-hidden="true">
        <div className="skeleton absolute inset-x-6 top-6 h-[26rem] rotate-[-3deg] rounded-card opacity-60" />
        <div className="skeleton absolute inset-x-3 top-3 h-[26rem] rotate-[1.5deg] rounded-card opacity-80" />
        <div className="skeleton relative h-[26rem] rounded-card" />
      </div>
      <div>
        <p className="inline-flex items-center gap-2 rounded-full bg-ember-100 px-4 py-1.5 text-base font-bold text-ember-700">
          <span className="relative flex h-3 w-3" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-ember-600" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-ember-600" />
          </span>
          Building {person.name}&apos;s session
        </p>
        <h2 className="mt-4 font-display text-4xl font-semibold text-ink-900">
          Asking Qloo what {person.hometown} loved from {youthWindow.start} to {youthWindow.end}
        </h2>
        <p className="mt-3 text-lg text-ink-500">
          {qlooCalls} Qloo call{qlooCalls === 1 ? "" : "s"} so far. Seeds: {person.favorites.map((f) => f.name).join(", ") || "none"}.
        </p>
        <ol className="mt-6 space-y-2" data-testid="planning-trace">
          {lines.map((e) => (
            <li key={e.id} className="animate-rise flex items-start gap-3 text-lg text-ink-700">
              <span className={`mt-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${e.kind === "narration" ? "bg-ember-600" : e.kind === "error" ? "bg-ink-700" : "bg-sage-600"}`} aria-hidden="true" />
              <span>{e.summary}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
