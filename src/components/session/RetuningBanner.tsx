"use client";

import { cleanNarration } from "@/lib/session/narration";
import type { TraceEvent } from "@/lib/session/types";

/** One sentence under the status line and a 2px indeterminate rule. Nothing pulses. */
export function RetuningBanner({ events, label }: { events: TraceEvent[]; label: string }) {
  const latest = events.filter((e) => (e.kind === "narration" && cleanNarration(e.summary)) || e.kind === "tool_result").at(-1);
  return (
    <div role="status" aria-live="polite" className="min-w-0 flex-1" data-testid="retuning-banner">
      <p className="notice">{label}</p>
      {latest ? <p className="mt-1 truncate pl-5 text-sm text-ink-500">{latest.summary}</p> : null}
      <div className="progress mt-3" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}
