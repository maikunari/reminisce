"use client";

import type { Person, TraceEvent, YouthWindow } from "@/lib/session/types";

interface Props {
  person: Person;
  youthWindow: YouthWindow;
  events: TraceEvent[];
}

/** Shown while the agent is building the deck: blank sleeves on the table, and the plan as it happens. */
export function PlanningView({ person, youthWindow, events }: Props) {
  const lines = events.filter((e) => e.kind !== "tool_call").slice(-6);
  const qlooCalls = events.filter((e) => e.qloo).length;
  return (
    <section aria-live="polite" aria-busy="true" className="grid min-h-[60vh] gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12" data-testid="planning-view">
      <div className="relative mx-auto aspect-square w-full max-w-[420px]" aria-hidden="true">
        <div className="sleeve-blank absolute top-[8%] left-0 aspect-square w-[58%] -rotate-[5deg]" />
        <div className="sleeve-blank absolute top-0 right-0 aspect-square w-1/2 rotate-[4deg]" />
        <div className="sleeve-blank absolute bottom-0 left-[24%] aspect-square w-[56%] -rotate-[1.5deg]" />
      </div>
      <div>
        <p className="label">Building {person.name}&apos;s session</p>
        <h2 className="balance mt-3 text-3xl sm:text-4xl">
          Asking Qloo what {person.hometown} loved from {youthWindow.start} to {youthWindow.end}
        </h2>
        <p className="mt-3 text-md text-ink-500">
          {qlooCalls} Qloo call{qlooCalls === 1 ? "" : "s"} so far. Seeds: {person.favorites.map((f) => f.name).join(", ") || "none"}.
        </p>
        <div className="progress mt-6" aria-hidden="true">
          <i />
        </div>
        <ol className="mt-6 divide-y divide-paper-200" data-testid="planning-trace">
          {lines.map((e) => (
            <li key={e.id} className={`py-2.5 text-md ${e.kind === "narration" ? "font-display text-ink-700 italic" : "text-ink-900"}`}>
              {e.summary}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
