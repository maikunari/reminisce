"use client";

import type { Preset } from "@/lib/session/presets";

import { useStartPreset } from "./use-start-preset";

function Button({ preset, primary }: { preset: Preset; primary: boolean }) {
  const { start, busy } = useStartPreset(preset);
  const name = preset.person.name;
  return (
    <button type="button" onClick={start} disabled={busy} data-testid={`hero-preset-${preset.id}`} className={`btn ${primary ? "btn-primary" : "btn-outline"}`}>
      {busy ? "Opening…" : `Try ${name}'s session`}
      {!busy ? <span aria-hidden="true">→</span> : null}
    </button>
  );
}

/** One tap from the first screen to a working session, for someone with no one to enter. */
export function HeroPresets({ presets }: { presets: Preset[] }) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {presets.map((preset, i) => (
        <Button key={preset.id} preset={preset} primary={i === 0} />
      ))}
    </div>
  );
}
