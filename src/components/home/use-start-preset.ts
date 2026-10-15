"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Preset } from "@/lib/session/presets";
import { createSessionShell } from "@/lib/session/storage";

/** Open a prepared person's session: the shell is saved here, and planning runs on the session page. */
export function useStartPreset(preset: Preset): { start: () => void; busy: boolean } {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const start = () => {
    setBusy(true);
    const session = createSessionShell(preset.person);
    router.push(`/session/${session.id}`);
  };
  return { start, busy };
}
