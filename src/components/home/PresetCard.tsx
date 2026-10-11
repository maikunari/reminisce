"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Preset } from "@/lib/session/presets";
import { createSessionShell } from "@/lib/session/storage";
import { useCurrentYear } from "@/lib/client/hooks";
import { YOUTH_AGE_TO, computeYouthWindow } from "@/lib/session/youth-window";

const ACCENT: Record<Preset["accent"], string> = {
  ember: "from-ember-600 via-ember-500 to-gold-600",
  sea: "from-sea-700 via-sea-600 to-plum-600",
};

export function PresetCard({ preset }: { preset: Preset }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Prerender can't read the clock; both presets' windows ended decades ago, so the
  // uncapped window is exact there and the client re-checks after hydration.
  const year = useCurrentYear();
  const window = computeYouthWindow(preset.person.birthYear, year ?? preset.person.birthYear + YOUTH_AGE_TO);
  const initial = [...preset.person.name][0] ?? "?";

  const start = () => {
    setBusy(true);
    const session = createSessionShell(preset.person);
    router.push(`/session/${session.id}`);
  };

  return (
    <article className="group flex overflow-hidden rounded-card bg-white shadow-card ring-1 ring-cream-300 transition-shadow hover:shadow-lift">
      <div className={`relative flex w-24 shrink-0 items-center justify-center bg-gradient-to-br sm:w-40 ${ACCENT[preset.accent]}`} aria-hidden="true">
        <span className="font-display text-6xl italic text-white drop-shadow sm:text-8xl">{initial}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 sm:p-6">
        <h3 className="font-display text-3xl font-semibold text-ink-900">{preset.person.name}</h3>
        <p className="text-lg leading-snug text-ink-700">{preset.blurb}</p>
        <p className="text-base text-ink-500">
          Ages 15 to 30: {window.start} to {window.end}
        </p>
        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={start}
            disabled={busy}
            data-testid={`preset-${preset.id}`}
            className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ember-600 px-6 text-xl font-bold text-white shadow-card transition hover:bg-ember-700 disabled:opacity-70 sm:w-auto"
          >
            {busy ? "Opening…" : `Try ${preset.person.name}'s session`}
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
}
