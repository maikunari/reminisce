"use client";

import type { TraceEvent } from "@/lib/session/types";

export function RetuningBanner({ events, label }: { events: TraceEvent[]; label: string }) {
  const latest = events.filter((e) => e.kind === "narration" || e.kind === "tool_result").slice(-2);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-4 rounded-2xl bg-ink-900 px-5 py-4 text-white shadow-lift"
      data-testid="retuning-banner"
    >
      <span className="relative mt-1 flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-ember-500" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-ember-500" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold">{label}</p>
        <ul className="mt-1 space-y-0.5 text-base text-white/80">
          {latest.map((e) => (
            <li key={e.id} className="truncate">
              {e.summary}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
