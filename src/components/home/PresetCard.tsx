"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Sleeve } from "@/components/Sleeve";
import { useCurrentYear } from "@/lib/client/hooks";
import type { Preset } from "@/lib/session/presets";
import { createSessionShell } from "@/lib/session/storage";
import { pronounsFor } from "@/lib/session/types";
import { YOUTH_AGE_TO, computeYouthWindow } from "@/lib/session/youth-window";

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function PresetCard({ preset }: { preset: Preset }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { person } = preset;
  // Prerender can't read the clock; both presets' windows ended decades ago, so the
  // uncapped window is exact there and the client re-checks after hydration.
  const year = useCurrentYear();
  const window = computeYouthWindow(person.birthYear, year ?? person.birthYear + YOUTH_AGE_TO);
  const pronouns = pronounsFor(person.pronoun);

  const start = () => {
    setBusy(true);
    const session = createSessionShell(person);
    router.push(`/session/${session.id}`);
  };

  return (
    <article className="surface grid gap-6 p-6 min-[520px]:grid-cols-[160px_minmax(0,1fr)]">
      <Sleeve
        domain={preset.art}
        title={person.name}
        label={`${person.hometown} · ${window.start}–${String(window.end).slice(2)}`}
        className="aspect-square w-[160px] rounded-md border border-paper-300 text-[13px]"
      />
      <div className="min-w-0">
        <p className="label">
          Born {person.birthYear} · {person.hometown}
        </p>
        <h3 className="mt-0.5 text-2xl">{person.name}</h3>
        <p className="mt-2 text-md leading-[1.45] text-ink-700">{preset.blurb}</p>
        <p className="label mt-3">
          {capitalize(pronouns.possessive)} years 15 to 30 · {window.start} to {window.end}
        </p>
        <button type="button" onClick={start} disabled={busy} data-testid={`preset-${preset.id}`} className="btn btn-outline mt-4 w-full min-[520px]:w-auto">
          {busy ? "Opening…" : `Begin with ${person.name}`}
          {!busy ? <span aria-hidden="true">→</span> : null}
        </button>
      </div>
    </article>
  );
}
